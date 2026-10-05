const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { createPhotoPlant, stepPhotoPlant, photoMeasurements, PHOTO_TANKS, PHOTO_TAGS, STILL } = require('../src/renderer/src/engine/photoPlant.ts')
const { stepPlant, resetDeviceLock } = require('../src/renderer/src/engine/simulate.ts')
const { buildBlankPlant, buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
const { makeBlankHardware } = require('../src/renderer/src/engine/hardware.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')

function manual(module, output) {
  module.mode = 'MAN'
  module.actualMode = 'MAN'
  module.out = output
  module.io.ao.out = output
  module.io.ao.target = output
}
function confirm(module) {
  if (module.type === 'MOTOR') { module.running = true; module.commanded = true }
  else { module.open = true; module.commandedOpen = true }
}

test('photographed units are distinct modules and coupled reservoirs, not aliases of the existing WFI plant', () => {
  const addon = createPhotoPlant()
  assert.equal(Object.keys(addon.state.tanks).length, 3)
  assert.ok(addon.modules['3T-8130-TIC011'])
  assert.ok(addon.modules['3T-8140-TIC011'])
  assert.ok(!addon.modules['TIC-401'])
  addon.state.tanks.n3.liters = 1234
  assert.equal(addon.state.tanks.n1.liters, 4200)
  assert.equal(photoMeasurements(addon.state)['3T-8130-LIC005'], 1234 / 7000 * 100)
})

test('still produces only with confirmed compressor, adequate feed, oil pressure and heating; bounded substeps conserve water', () => {
  const { state, modules } = createPhotoPlant()
  state.still.temperature = 104
  state.still.oilPressure = 30
  confirm(modules[`${STILL}-LUBE`])
  let next = stepPhotoPlant(state, modules, 10)
  assert.equal(next.still.production, 0)
  confirm(modules[`${STILL}-COMP`])
  const totalBefore = state.still.feedLiters + state.still.distillateLiters
  next = stepPhotoPlant(state, modules, 10)
  assert.ok(next.still.production > 0)
  assert.ok(Math.abs(next.still.feedLiters + next.still.distillateLiters - totalBefore) < 1e-8)
  assert.ok(next.still.feedLiters < state.still.feedLiters)
  assert.equal(state.still.feedLiters, 600)
  modules[`${STILL}-COMP`].fault = true
  assert.equal(stepPhotoPlant(state, modules, 10).still.production, 0)
})

test('distillate delivery is shared across real fill valves and preserves total volume; distribution drains only on feedback', () => {
  const { state, modules } = createPhotoPlant()
  confirm(modules[`${STILL}-DIST`])
  confirm(modules[`${STILL}-XV201`])
  for (const tank of PHOTO_TANKS) {
    confirm(modules[`${tank.prefix}-YV007`])
    manual(modules[`${tank.prefix}-LIC005`], 100)
  }
  const total = s => s.still.distillateLiters + Object.values(s.tanks).reduce((sum, tank) => sum + tank.liters, 0)
  const next = stepPhotoPlant(state, modules, 10)
  assert.ok(next.tanks.n3.liters > state.tanks.n3.liters)
  assert.equal(next.tanks.n3.liters, next.tanks.n1.liters)
  assert.ok(Math.abs(total(next) - total(state)) < 1e-8)
  modules['3T-8130-XC002'].commanded = true
  confirm(modules['3T-8130-YV014'])
  assert.equal(stepPhotoPlant(state, modules, 10).tanks.n3.liters, next.tanks.n3.liters)
  confirm(modules['3T-8130-XC002'])
  assert.ok(stepPhotoPlant(state, modules, 10).tanks.n3.liters < next.tanks.n3.liters)
})

test('sanitation requires continuous hot circulation for 600 seconds, restarts cold soak, and transitions through cooling', () => {
  const { state, modules } = createPhotoPlant()
  const tank = state.tanks.n3
  tank.temperature = 85
  tank.sanitation = 'SOAK'
  tank.soakSeconds = 599
  confirm(modules['3T-8130-XC002'])
  manual(modules['3T-8130-TIC011'], 75)
  modules['3T-8130-TIC011'].mode = 'AUTO'
  modules['3T-8130-TIC011'].actualMode = 'AUTO'
  let next = stepPhotoPlant(state, modules, 0.5)
  assert.equal(next.tanks.n3.sanitation, 'SOAK')
  next = stepPhotoPlant(state, modules, 1)
  assert.equal(next.tanks.n3.sanitation, 'COOLING')
  assert.equal(modules['3T-8130-TIC011'].sp, 25)
  tank.temperature = 70
  next = stepPhotoPlant(state, modules, 0.1)
  assert.equal(next.tanks.n3.sanitation, 'HEATING')
  assert.equal(next.tanks.n3.soakSeconds, 0)
  tank.sanitation = 'COOLING'
  tank.temperature = 29
  assert.equal(stepPhotoPlant(state, modules, 0.1).tanks.n3.sanitation, 'IDLE')
})

test('normal module execution enforces oil and dry-run interlocks and samples coupled physical measurements', () => {
  const addon = createPhotoPlant()
  let state = { ...buildBlankPlant(), modules: addon.modules, photoPlant: addon.state, hardware: makeBlankHardware() }
  state.modules[`${STILL}-COMP`].commanded = true
  state = stepPlant(state, 0.1)
  assert.equal(state.modules[`${STILL}-COMP`].running, false)
  assert.equal(state.modules[`${STILL}-COMP`].dcState, 'SHUTDOWN')
  state.photoPlant.tanks.n3.liters = 50
  state.modules['3T-8130-LIC005'].io.ai.raw = 50 / 7000 * 100
  state.modules['3T-8130-LIC005'].pv = 50 / 7000 * 100
  state.modules['3T-8130-XC002'].commanded = true
  state = stepPlant(state, 0.1)
  assert.equal(state.modules['3T-8130-XC002'].running, false)
  assert.equal(state.modules['3T-8130-XC002'].dcState, 'SHUTDOWN')
  assert.ok(Math.abs(state.modules['3T-8130-LIC005'].pv - 50 / 7000 * 100) < 1e-9)
  assert.equal(state.modules['3T-8130-AI015B'].pv, state.photoPlant.tanks.n3.conductivity)
})

test('shared steam loss affects reactor, autoclaves and photographed still; cooling loss prevents LYO chilling', () => {
  const addon = createPhotoPlant()
  const initial = buildInitialPlant()
  const base = { ...initial, hardware: makeBlankHardware(),
    modules: { ...initial.modules, ...addon.modules }, photoPlant: addon.state }
  manual(base.modules['TIC-201'], 100)
  manual(base.modules['TIC-501'], 100)
  manual(base.modules['TIC-601'], 0)
  manual(base.modules[`${STILL}-TIC102`], 100)
  const originalRandom = Math.random
  Math.random = () => 0.5
  try {
    const normal = stepPlant(base, 1)
    const failed = structuredClone(base)
    failed.photoPlant.utilities.steamPressure = 0
    failed.photoPlant.utilities.coolingAvailability = 0
    failed.modules['SB-STEAM'].commanded = false
    failed.modules['SB-STEAM'].running = false
    failed.modules['SB-COOLING'].commanded = false
    failed.modules['SB-COOLING'].running = false
    const lost = stepPlant(failed, 1)
    assert.ok(lost.process.reactorTemp < normal.process.reactorTemp)
    assert.ok(lost.modules['TIC-501'].pv < normal.modules['TIC-501'].pv)
    assert.ok(lost.modules['TIC-601'].pv > normal.modules['TIC-601'].pv)
    assert.ok(lost.photoPlant.still.temperature < normal.photoPlant.still.temperature)
    const electricOff = structuredClone(base)
    manual(electricOff.modules['TIC-801'], 100)
    electricOff.modules['HS-801'].commanded = false
    electricOff.modules['HS-801'].state = false
    const electricOn = structuredClone(electricOff)
    electricOn.modules['HS-801'].commanded = true
    electricOn.modules['HS-801'].state = true
    assert.ok(stepPlant(electricOff, 1).modules['TIC-801'].pv < stepPlant(electricOn, 1).modules['TIC-801'].pv)
    assert.equal(lost.modules['SB-STEAM-PRESS'].pv, 0)
    assert.equal(base.photoPlant.utilities.steamPressure, 4)
  } finally { Math.random = originalRandom }
})

test('N1 feeds the legacy WFI receiver; actual WFI and CIP feedback gates shared withdrawals and conserves available water', () => {
  const addon = createPhotoPlant()
  const modules = { ...buildInitialPlant().modules, ...addon.modules }
  const state = addon.state
  confirm(modules['3T-8120-XC002'])
  confirm(modules['3T-8120-YV014'])
  state.tanks.n1.conductivity = 2
  const next = stepPhotoPlant(state, modules, 1)
  assert.ok(next.utilities.legacyWfiLiters > state.utilities.legacyWfiLiters)
  assert.ok(next.utilities.legacyConductivity > state.utilities.legacyConductivity)
  assert.ok(Math.abs(next.tanks.n1.liters + next.utilities.legacyWfiLiters -
    state.tanks.n1.liters - state.utilities.legacyWfiLiters) < 1e-8)
  modules['3T-8120-YV014'].open = false
  for (const suffix of ['701', '711', '721']) {
    confirm(modules[`P-${suffix}`])
    confirm(modules[`XV-${suffix}`])
    manual(modules[`FIC-${suffix}`], 100)
  }
  state.utilities.legacyWfiLiters = 1
  const dry = stepPhotoPlant(state, modules, 1)
  assert.equal(dry.utilities.legacyWfiLiters, 0)
  assert.equal(dry.utilities.cipFlow['FIC-701'], 0)
  state.utilities.legacyWfiLiters = 100
  const supplying = stepPhotoPlant(state, modules, 1)
  assert.equal(supplying.utilities.cipFlow['FIC-701'], 40)
  assert.ok(Math.abs(supplying.utilities.legacyWfiLiters - (100 - 40 / 3.6 * 3)) < 1e-8)
  modules['P-401'].running = false
  const stopped = stepPhotoPlant(state, modules, 1)
  assert.equal(stopped.utilities.cipFlow['FIC-701'], 0)
  assert.equal(stopped.utilities.legacyWfiLiters, 100)
})

test('sanitation never overwrites operator MAN/OOS/tracking control on a phase transition', () => {
  const { state, modules } = createPhotoPlant()
  state.tanks.n3.sanitation = 'SOAK'
  state.tanks.n3.temperature = 85
  state.tanks.n3.soakSeconds = 599
  confirm(modules['3T-8130-XC002'])
  const loop = modules['3T-8130-TIC011']
  loop.mode = 'MAN'
  loop.sp = 42
  assert.equal(stepPhotoPlant(state, modules, 1).tanks.n3.sanitation, 'ABORTED')
  assert.equal(loop.sp, 42)
})

test('a cold plant can start through ordinary device/PID execution and deliver actually distilled water to all tanks', () => {
  const addon = createPhotoPlant()
  let state = { ...buildBlankPlant(), modules: addon.modules, photoPlant: addon.state, hardware: makeBlankHardware() }
  state.modules[`${STILL}-LUBE`].commanded = true
  state.modules[`${STILL}-XV100`].commandedOpen = true
  for (const tank of PHOTO_TANKS) state.modules[`${tank.prefix}-YV007`].commandedOpen = true
  let produced = false
  for (let second = 0; second < 900; second++) {
    if (state.photoPlant.still.oilPressure >= 15) {
      resetDeviceLock(state.modules[`${STILL}-COMP`])
      state.modules[`${STILL}-COMP`].commanded = true
    }
    if (state.photoPlant.still.temperature >= 96 && state.photoPlant.still.distillateLiters >= 20) {
      resetDeviceLock(state.modules[`${STILL}-DIST`])
      state.modules[`${STILL}-DIST`].commanded = true
      state.modules[`${STILL}-XV201`].commandedOpen = true
    }
    state = stepPlant(state, 1)
    produced ||= state.photoPlant.still.production > 0
    assert.ok(state.photoPlant.still.feedLiters >= 0 && state.photoPlant.still.feedLiters <= 1000)
    assert.ok(state.photoPlant.still.distillateLiters >= 0 && state.photoPlant.still.distillateLiters <= 500)
  }
  assert.equal(produced, true, JSON.stringify({ still: state.photoPlant.still, compressor: state.modules[`${STILL}-COMP`].dcState }))
  for (const tank of PHOTO_TANKS) {
    assert.ok(state.photoPlant.tanks[tank.id].liters > 4250, tank.id)
    assert.equal(state.modules[`${tank.prefix}-LIC005`].pv, state.photoPlant.tanks[tank.id].liters / 7000 * 100)
  }
})

test('coupled physics respects simulation speed and preserves its input state', () => {
  const addon = createPhotoPlant()
  const base = { ...buildBlankPlant(), modules: addon.modules, photoPlant: addon.state, hardware: makeBlankHardware() }
  base.modules[`${STILL}-LUBE`].commanded = true
  const before = structuredClone(base)
  const single = stepPlant(base, 1)
  const doubleSpeed = stepPlant({ ...base, speed: 2 }, 0.5)
  assert.deepEqual(doubleSpeed.photoPlant, single.photoPlant)
  assert.deepEqual(base, before)
})

test('add-on installation preserves existing runtime; collisions reject atomically; HOLD, trends and project reset remain correct', () => {
  const before = useStore.getState()
  const security = useSecurity.getState()
  const oldWindow = global.window
  global.window = { alert: () => {} }
  try {
    assert.ok(before.photoPlant, 'default plant installs the photographed units')
    assert.ok(before.modules['3WFI-8110-COMP'] && before.modules['TIC-401'])
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const legacyModules = Object.fromEntries(Object.entries(before.modules).filter(([tag]) => !PHOTO_TAGS.has(tag)))
    useStore.setState({ modules: legacyModules, photoPlant: undefined, areas: before.areas.filter(area => area !== 'PHOTO_WFI') })
    const legacy = useStore.getState()
    useSecurity.setState({ locked: true })
    assert.equal(useStore.getState().addPhotoPlant(), false)
    assert.equal(useStore.getState().modules, legacy.modules)
    useSecurity.setState({ locked: false })
    assert.equal(useStore.getState().addPhotoPlant(), true)
    assert.equal(useStore.getState().addPhotoPlant(), false)
    const installed = useStore.getState()
    for (const [tag, module] of Object.entries(legacy.modules)) assert.equal(installed.modules[tag], module, tag)
    assert.equal(installed.process, legacy.process)
    assert.equal(installed.batch, legacy.batch)
    assert.equal(installed.hardware, legacy.hardware)
    assert.equal(installed.photoPlant.tanks.n3.sanitation, 'IDLE')
    useSecurity.setState({ locked: true })
    assert.equal(useStore.getState().startPhotoTankSanitation('n3'), false)
    useSecurity.setState({ locked: false })
    useStore.setState({ running: false })
    useStore.getState().tick(1)
    assert.equal(useStore.getState().photoPlant, installed.photoPlant)
    assert.equal(useStore.getState().startPhotoTankSanitation('n3'), true)
    assert.equal(useStore.getState().modules['3T-8130-TIC011'].sp, 85)
    assert.equal(useStore.getState().cancelPhotoTankSanitation('n3'), true)
    assert.equal(useStore.getState().modules['3T-8130-TIC011'].sp, 25)
    useStore.setState({ running: true, speed: 1 })
    useStore.getState().tick(1)
    assert.ok(useStore.getState().trend.at(-1).values['3T-8130-TIC011.PV'] !== undefined)
    useStore.getState().newProject('blank')
    assert.equal(useStore.getState().photoPlant, undefined)
    useStore.getState().newProject('pharma')
    assert.ok(useStore.getState().photoPlant)
    assert.ok(useStore.getState().modules['3T-8140-LIC005'])
    useStore.setState({ ...legacy, modules: { ...legacy.modules, '3T-8130-TIC011': legacy.modules['TIC-401'] } }, true)
    const conflict = useStore.getState().modules
    assert.equal(useStore.getState().addPhotoPlant(), false)
    assert.equal(useStore.getState().modules, conflict)
    assert.equal(useStore.getState().photoPlant, undefined)
  } finally {
    useStore.setState(before, true)
    useSecurity.setState(security, true)
    global.window = oldWindow
  }
})

test('IMG_0604 still instruments are real: oil cooling, compressor current, drain/blowdown/waste, level valve, feed-water cooling and steam makeup', () => {
  const stillState = () => {
    const addon = createPhotoPlant()
    addon.state.still.oilPressure = 30
    return addon
  }
  const run = (addon, seconds) => { let state = addon.state; for (let i = 0; i < seconds; i++) state = stepPhotoPlant(state, addon.modules, 1); return state }

  // oil cooler: running lube+compressor without SV500 overheats; open SV500 with cooling water holds it lower
  const hot = stillState()
  confirm(hot.modules[`${STILL}-LUBE`]); confirm(hot.modules[`${STILL}-COMP`])
  const cooled = stillState()
  confirm(cooled.modules[`${STILL}-LUBE`]); confirm(cooled.modules[`${STILL}-COMP`]); confirm(cooled.modules[`${STILL}-SV500`])
  const hotState = run(hot, 200), cooledState = run(cooled, 200)
  assert.ok(hotState.still.oilTemperature > 60 && cooledState.still.oilTemperature < hotState.still.oilTemperature - 10)
  assert.equal(photoMeasurements(hotState)[`${STILL}-OIL-TEMP`], hotState.still.oilTemperature)
  assert.ok(hotState.still.compressorCurrent >= 6)
  const stopped = stillState()
  assert.equal(run(stopped, 5).still.compressorCurrent, 0)

  // drain, blowdown and waste valves remove water only on actual valve feedback
  const drain = stillState()
  const before = drain.state.still.feedLiters
  assert.equal(run(drain, 5).still.feedLiters, before)
  confirm(drain.modules[`${STILL}-XV200`])
  assert.ok(before - run(drain, 5).still.feedLiters >= 9.9)
  const blow = stillState()
  confirm(blow.modules[`${STILL}-FCV300`])
  const blown = run(blow, 10)
  assert.ok(Math.abs(before - blown.still.feedLiters - 1.5) < 1e-6)
  const waste = stillState()
  confirm(waste.modules[`${STILL}-DIST`]); confirm(waste.modules[`${STILL}-XV202`])
  const wasted = run(waste, 5)
  assert.ok(wasted.still.distillateLiters < 50 && wasted.tanks.n3.liters === 4200)

  // LCV200 throttles delivery to the storage tanks
  const delivery = (output) => {
    const addon = stillState()
    confirm(addon.modules[`${STILL}-DIST`]); confirm(addon.modules[`${STILL}-XV201`])
    for (const tank of PHOTO_TANKS) { confirm(addon.modules[`${tank.prefix}-YV007`]); manual(addon.modules[`${tank.prefix}-LIC005`], 100) }
    manual(addon.modules[`${STILL}-LIC200`], output)
    return run(addon, 5).tanks.n3.liters - 4200
  }
  assert.ok(delivery(100) > 0 && delivery(50) < delivery(100) && delivery(0) === 0)

  // PCV103 steam makeup heats the still; distillate cooling needs feed-water flow through TCV200
  const steam = stillState()
  const idle = run(stillState(), 60).still.temperature
  manual(steam.modules[`${STILL}-PIC103`], 100)
  assert.ok(run(steam, 60).still.temperature > idle)
  const coolNoFlow = stillState(), coolFlow = stillState()
  coolNoFlow.state.still.distillateTemperature = 100; coolFlow.state.still.distillateTemperature = 100
  manual(coolNoFlow.modules[`${STILL}-TIC200`], 100); manual(coolFlow.modules[`${STILL}-TIC200`], 100)
  confirm(coolFlow.modules[`${STILL}-XV100`]); manual(coolFlow.modules[`${STILL}-LIC100`], 100)
  assert.ok(run(coolFlow, 30).still.distillateTemperature < run(coolNoFlow, 30).still.distillateTemperature - 10)
  const m = photoMeasurements(run(coolFlow, 1))
  assert.equal(m[`${STILL}-TT200`], m[`${STILL}-TIC200`])
})
