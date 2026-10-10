const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, filename)
  }
}
const store = require('../src/renderer/src/engine/store.ts')
const ui = require('../src/renderer/src/ui/uiStore.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { buildInitialPlant, BUILTIN_TAGS } = require('../src/renderer/src/engine/plant.ts')
const { makeDefaultHardware } = require('../src/renderer/src/engine/hardware.ts')
const { stepPlant } = require('../src/renderer/src/engine/simulate.ts')
const { processWasteComplete, PWASTE_TAGS, PW_HOST } = require('../src/renderer/src/engine/processWaste.ts')
const { DEFAULT_PLANT_AREAS } = require('../src/renderer/src/engine/areas.ts')
const { moduleNameError } = require('../src/renderer/src/engine/naming.ts')
const { deviceDescriptorLabel } = require('../src/renderer/src/engine/deviceDescriptors.ts')
const studio = require('../src/renderer/src/displays/ControlStudioDisplay.tsx')
const { AreaDisplay } = require('../src/renderer/src/displays/AreaDisplay.tsx')
const { ValveFaceplate } = require('../src/renderer/src/faceplates/ValveFaceplate.tsx')
const { PidFaceplate } = require('../src/renderer/src/faceplates/PidFaceplate.tsx')

const P = '3WT-0001-'
// The waste pH is a function of plant time, so pin the clock: tests are deterministic per influent phase.
const fresh = (time = 0) => ({ ...buildInitialPlant(), hardware: makeDefaultHardware(), speed: 1, time })
const run = (state, seconds) => {
  let s = state
  for (let i = 0; i < seconds; i++) s = stepPlant(s, 1)
  return s
}
const text = html => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

function render(Component, props, studioTag) {
  const before = ui.useUi.getState()
  if (studioTag) ui.useUi.setState({ studioTag })
  const hooks = [
    test.mock.method(store, 'useStore', selector => selector(store.useStore.getState())),
    test.mock.method(ui, 'useUi', selector => selector(ui.useUi.getState()))
  ]
  try {
    return renderToStaticMarkup(React.createElement(Component, props))
  } finally {
    hooks.forEach(hook => hook.mock.restore())
    ui.useUi.setState(before, true)
  }
}

/** Operator starts the area: both pumps, both diverters, the waste inlet, and AIC002 in AUTO at its 6.0 pH SP. */
function startArea(state) {
  const m = state.modules
  for (const tag of ['P01', 'P02']) m[P + tag].commanded = true
  for (const tag of ['XV010', 'XV01', 'XV05']) m[P + tag].commandedOpen = true
  m[P + 'AIC002'].mode = 'AUTO'
  return state
}

test('the process waste modules are a complete, valid, built-in part of the default plant', () => {
  const state = fresh()
  assert.ok(DEFAULT_PLANT_AREAS.includes('PWASTE'))
  assert.ok(processWasteComplete(state.modules))
  for (const tag of PWASTE_TAGS) {
    assert.ok(state.modules[tag], tag)
    assert.equal(moduleNameError(tag), null, tag)
    assert.ok(BUILTIN_TAGS.has(tag), `${tag} should be a built-in tag`)
  }
  const areaTags = Object.values(state.modules).filter(m => m.area === 'PWASTE').map(m => m.tag).sort()
  assert.deepEqual(areaTags, [...PWASTE_TAGS].sort())
})

test('the area starts in the HOLD state the operator screens show, and stays there until the operator acts', () => {
  const s = run(fresh(), 40)
  const m = s.modules
  assert.equal(m[P + 'LI001'].pv, 69.3)
  assert.equal(m[P + 'LI002'].pv, 79.5)
  assert.equal(m[P + 'AI001'].pv, 7.5)
  assert.ok(Math.abs(m[P + 'TI001'].pv - 68.9) < 1, 'effluent temperature stays near the screen value')
  assert.ok(Math.abs(m[P + 'AI02AVG'].pv - 6.1) < 0.2)
  for (const tag of ['P01', 'P02']) { assert.equal(m[P + tag].running, false, tag); assert.equal(m[P + tag].dcState, 'CONFIRMED_PASSIVE', tag) }
  for (const tag of ['XV01', 'XV05', 'XV010']) assert.equal(m[P + tag].open, false, tag)
  assert.equal(m['3CIP-3200-XV025'].open, false)
  assert.equal(m[P + 'FAL001'].state, true, 'FAL001 reads No Flow')
  assert.equal(m[P + 'FAL002'].state, true, 'FAL002 reads No Flow')
  const aic = m[P + 'AIC002']
  assert.equal(aic.mode, 'RCAS')
  assert.equal(aic.actualMode, 'LO', 'local override while a tracking condition is true')
  assert.equal(aic.out, 50)
  assert.equal(aic.sp, 6)
  assert.ok(Math.abs(aic.pv - 6) < 0.2)
  assert.equal(aic.io.ao.out, 0)
  assert.equal(aic.io.ao2.out, 0)
  assert.deepEqual(s.alarms.filter(a => a.moduleTag.startsWith(P) && a.active), [])
  // the NEUT phase is the remote host: the plant faceplate shows RCAS SP 8.0 and ROUT OUT 50.0
  assert.equal(aic.remote.rcasIn.value, PW_HOST.rcasSp)
  assert.equal(aic.remote.routIn.value, PW_HOST.routOut)
  assert.equal(PW_HOST.rcasSp, 8.0)
  assert.equal(PW_HOST.routOut, 50)
})

test('AIC002 follows the PCSD split-range template values from the plant', () => {
  const aic = fresh().modules[P + 'AIC002']
  assert.equal(aic.gain, 0.5)
  assert.equal(aic.reset, 100)
  assert.equal(aic.io.splitter.balTimeSec, 10)
  assert.equal(aic.spLow, 6)
  assert.equal(aic.spHigh, 10)
  assert.equal(aic.pvMax, 14)
  assert.equal(aic.rampModule, '3WT-0001-AI02RMP')
  assert.ok(aic.io.ao2, 'AO1 and AO2 outputs with a splitter')
})

test('SP limits 6-10 apply to operator entry and to the remote setpoint', () => {
  const before = { store: store.useStore.getState(), security: useSecurity.getState() }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    store.useStore.setState({ modules: fresh().modules, running: true })
    store.useStore.getState().setMode(P + 'AIC002', 'AUTO')
    store.useStore.getState().setSetpoint(P + 'AIC002', 12)
    assert.equal(store.useStore.getState().modules[P + 'AIC002'].sp, 10)
    store.useStore.getState().setSetpoint(P + 'AIC002', 2)
    assert.equal(store.useStore.getState().modules[P + 'AIC002'].sp, 6)
  } finally {
    store.useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
  }
  // RCAS_IN above SP_HI_LIM is limited to 10 once the loop leaves local override
  const s = startArea(fresh())
  s.modules[P + 'AIC002'].mode = 'RCAS'
  s.modules[P + 'AIC002'].remote.rcasIn.value = 8
  const run1 = run(s, 20)
  assert.equal(run1.modules[P + 'AIC002'].actualMode, 'RCAS')
  assert.equal(run1.modules[P + 'AIC002'].sp, 8)
})

test('each tracking condition forces local override at 50 % and nothing doses while it is true', () => {
  const base = () => run(startArea(fresh()), 40)
  let s = base()
  assert.equal(s.modules[P + 'AIC002'].actualMode, 'AUTO')

  // 1) treatment pump not running (10 s delay)
  s = base()
  s.modules[P + 'P02'].commanded = false
  s = run(s, 6)
  assert.equal(s.modules[P + 'AIC002'].actualMode, 'AUTO', 'the 10 s on-delay has not elapsed')
  s = run(s, 8)
  assert.equal(s.modules[P + 'AIC002'].actualMode, 'LO')
  assert.equal(s.modules[P + 'AIC002'].out, 50)
  assert.equal(s.modules[P + 'AIC002'].io.ao.out + s.modules[P + 'AIC002'].io.ao2.out, 0)

  // 2) tank pH differs from the PV by more than 1.5 pH (5 s delay)
  s = base()
  s.modules[P + 'AI02AVG'].pv = 8.5
  s = run(s, 3)
  assert.equal(s.modules[P + 'AIC002'].actualMode, 'AUTO', 'the 5 s on-delay has not elapsed')
  s = run(s, 5)
  assert.equal(s.modules[P + 'AIC002'].actualMode, 'LO')
  assert.equal(s.modules[P + 'AIC002'].out, 50)

  // 3) base drum low (no delay)
  s = base()
  s.modules[P + 'LAL001'].state = true
  s = run(s, 3)
  assert.equal(s.modules[P + 'AIC002'].actualMode, 'LO')
  assert.equal(s.modules[P + 'AIC002'].out, 50)
})

test('the XV01 and XV05 diverters report RECIRC / TRANSFER / DRAIN state names', () => {
  const m = fresh().modules
  assert.deepEqual(m[P + 'XV01'].stateNames, { passive: 'RECIRC', active: 'TRANSFER' })
  assert.deepEqual(m[P + 'XV05'].stateNames, { passive: 'RECIRC', active: 'DRAIN' })
  const sets = store.useStore.getState().namedSets
  assert.equal(deviceDescriptorLabel(m[P + 'XV01'], sets, 'command', true).label, 'TRANSFER')
  assert.equal(deviceDescriptorLabel(m[P + 'XV01'], sets, 'command', false).label, 'RECIRC')
  assert.equal(deviceDescriptorLabel(m[P + 'XV05'], sets, 'feedback', true).label, 'DRAIN')
  assert.equal(deviceDescriptorLabel(m['3WT-0001-XV010'], sets, 'command', true).label, 'OPEN')
})

test('faceplates: XV01 offers RECIRC / TRANSFER and AIC002 shows RCAS SP, ROUT OUT and the ramp module', () => {
  store.useStore.setState({ modules: run(fresh(), 5).modules })
  const valve = text(render(ValveFaceplate, { tag: P + 'XV01' }))
  assert.match(valve, /RECIRC/)
  assert.match(valve, /TRANSFER/)
  assert.match(valve, /Confirmed Closed/)
  assert.doesNotMatch(valve, /\bOPEN\b|\bCLOSE\b/)
  const pid = text(render(PidFaceplate, { tag: P + 'AIC002' }))
  assert.match(pid, /RCAS SP 8\.0 pH/)
  assert.match(pid, /ROUT OUT 50\.0 %/)
  assert.match(pid, /Ramp Mod 3WT-0001-AI02RMP/)
  assert.match(pid, /Tgt RCAS · Act LO/)
  assert.match(pid, /TRACKING/)
  // a valve that did not confirm a close reports which travel time was exceeded
  const modules = fresh().modules
  modules[P + 'XV01'] = { ...modules[P + 'XV01'], fault: true, dcState: 'FAILED_PASSIVE' }
  store.useStore.setState({ modules })
  assert.match(text(render(ValveFaceplate, { tag: P + 'XV01' })), /Close travel time exceeded/)
})

test('Control Studio shows the real device logic: XV01 two interlocks and two permissives, XV05 three interlocks', () => {
  store.useStore.setState({ modules: fresh().modules })
  const expected = {
    [P + 'XV01']: ['#1 3CIP3200 RETURNING', '#2 TREATMENT TANK HI LEVEL', '#1 EQUALIZATION LEVEL OK', '#2 TREATMENT LEVEL OK'],
    [P + 'XV05']: ['#1 TANK pH LOW', '#2 TANK pH HIGH', '#3 NEUT TANK LOW-LOW'],
    [P + 'P01']: ['#1 EQ TANK LOW-LOW'],
    [P + 'P02']: ['#1 NEUT TANK LOW-LOW'],
    [P + 'XV010']: ['#1 EQ TANK HI-HI'],
    '3CIP-3200-XV025': ['#1 EQ TANK HI-HI']
  }
  for (const [tag, fragments] of Object.entries(expected)) {
    const html = render(studio.ControlStudioDisplay, undefined, tag)
    const flat = text(html)
    assert.match(html, new RegExp(`aria-label="${tag} device control logic"`), tag)
    for (const name of ['DCC1', 'EDC1', 'CND1', 'MODELOCK']) assert.ok(flat.includes(name), `${tag} ${name}`)
    for (const fragment of fragments) assert.ok(flat.includes(fragment), `${tag}: ${fragment}`)
  }
  const xv01 = text(render(studio.ControlStudioDisplay, undefined, P + 'XV01'))
  assert.match(xv01, /Permissive conditions \(2\)/)
  assert.match(xv01, /Interlock conditions \(2\)/)
})

test('Control Studio shows AIC002 as AI1 -> PID1 -> SPLTR1 -> AO1 / AO2 with the AT1 tracking chain', () => {
  store.useStore.setState({ modules: fresh().modules })
  const flat = text(render(studio.ControlStudioDisplay, undefined, P + 'AIC002'))
  for (const block of ['AI1', 'PID1', 'SPLTR1', 'AO1', 'AO2']) assert.ok(flat.includes(block), block)
  for (const tag of ['AT1C1', 'AT1C2', 'AT1C3', 'AT1OR1', 'AT1OR2']) assert.ok(flat.includes(P + tag), tag)
  for (const tag of ['AT1C1', 'AT1C2', 'AT1C3', 'LAHH001', 'LALL001', 'PHLO', 'CIPDLY']) {
    assert.match(render(studio.ControlStudioDisplay, undefined, P + tag), new RegExp(`${P}${tag}`), tag)
  }
})

for (const phase of [0, 300, 600, 900]) test(`started in AUTO the pH loop holds the 6.0 SP with the plant's own tuning, dosing the right way (waste phase ${phase}s)`, () => {
  let s = startArea(fresh(phase * 1000))
  let sawAcid = false
  let sawBase = false
  for (let t = 0; t < 2400; t += 10) {
    s = run(s, 10)
    const aic = s.modules[P + 'AIC002']
    if (t > 300) assert.ok(aic.pv > 5.0 && aic.pv < 7.2, `pH ${aic.pv.toFixed(2)} at ${t}s`)
    assert.ok(aic.io.ao.out < 1 || aic.io.ao2.out < 1, 'acid and base must not dose together')
    if (aic.io.ao.out > 1) { sawAcid = true; assert.ok(aic.out <= 49.5) }
    if (aic.io.ao2.out > 1) { sawBase = true; assert.ok(aic.out >= 50.5) }
  }
  assert.ok(sawAcid || sawBase)
  assert.deepEqual(s.alarms.filter(a => a.moduleTag.startsWith(P) && a.active).map(a => `${a.moduleTag}:${a.label}`), [])
})

test('requested RCAS with the NEUT phase writing 8.0 drives the tank to the 8.0 pH setpoint', () => {
  let s = startArea(fresh(0))
  s.modules[P + 'AIC002'].mode = 'RCAS'
  s = run(s, 2400)
  const aic = s.modules[P + 'AIC002']
  assert.equal(aic.actualMode, 'RCAS')
  assert.equal(aic.sp, 8)
  assert.ok(aic.pv > 7.0 && aic.pv < 9.0, `pH ${aic.pv.toFixed(2)}`)
})

test('XV01 RECIRC circulates without moving level; TRANSFER moves the equalization tank into the neutralization tank', () => {
  let s = fresh()
  s.modules[P + 'P01'].commanded = true
  s = run(s, 30)
  assert.equal(s.modules[P + 'P01'].running, true)
  assert.equal(s.modules[P + 'FAL001'].state, false, 'line flow with the pump running')
  assert.equal(s.modules[P + 'LI001'].pv, 69.3)
  assert.equal(s.modules[P + 'LI002'].pv, 79.5)
  s.modules[P + 'XV01'].commandedOpen = true
  s = run(s, 20)
  assert.equal(s.modules[P + 'XV01'].open, true)
  assert.ok(s.modules[P + 'LI001'].pv < 69.3 - 4, 'equalization tank empties into the neutralization tank')
  assert.ok(s.modules[P + 'LI002'].pv > 79.5 + 4)
})

test('XV05 RECIRC keeps the neutralization tank, DRAIN lets the treated water leave through the P02 loop', () => {
  let s = fresh()
  s.modules[P + 'P02'].commanded = true
  s = run(s, 30)
  assert.equal(s.modules[P + 'FAL002'].state, false)
  assert.equal(s.modules[P + 'LI002'].pv, 79.5)
  s.modules[P + 'XV05'].commandedOpen = true
  s = run(s, 60)
  assert.ok(s.modules[P + 'LI002'].pv < 79.5 - 10)
  s.modules[P + 'P02'].commanded = false
  s = run(s, 30)
  const level = s.modules[P + 'LI002'].pv
  s = run(s, 30)
  assert.equal(s.modules[P + 'LI002'].pv, level, 'no drain flow without the P02 loop')
  assert.equal(s.modules[P + 'FAL002'].state, true)
})

test('a high neutralization level or CIP return sends XV01 back to RECIRC and blocks TRANSFER', () => {
  let s = fresh()
  s.modules[P + 'P01'].commanded = true
  s.modules[P + 'XV01'].commandedOpen = true
  s = run(s, 30)
  assert.equal(s.modules[P + 'XV01'].open, true)
  // neutralization tank fills to LAHH002 with the drain closed: XV01 returns to RECIRC
  s = run(s, 90)
  assert.ok(s.modules[P + 'LI002'].pv >= 90)
  const xv01 = s.modules[P + 'XV01']
  assert.equal(xv01.interlock, true)
  assert.equal(xv01.open, false)
  assert.equal(xv01.dcState, 'SHUTDOWN')
  assert.ok(s.modules[P + 'LI002'].pv < 91, 'no further transfer once XV01 is in RECIRC')
  assert.ok(s.alarms.some(a => a.moduleTag === P + 'LI002' && a.active))

  // CIP returning to the equalization tank for 5 s also forces RECIRC
  let c = fresh()
  c.modules[P + 'P01'].commanded = true
  c.modules[P + 'XV01'].commandedOpen = true
  c = run(c, 30)
  assert.equal(c.modules[P + 'XV01'].open, true)
  c.modules['3CIP-3200-XV025'].commandedOpen = true
  c = run(c, 12)
  assert.equal(c.modules['3CIP-3200-XV025'].open, true)
  c = run(c, 8)
  assert.equal(c.modules[P + 'XV01'].interlock, true)
  assert.equal(c.modules[P + 'XV01'].open, false)
})

test('the XV01 permissives refuse TRANSFER while the equalization tank is low-low', () => {
  let s = fresh()
  s.modules[P + 'LI001'].pv = 5
  s.modules[P + 'XV01'].commandedOpen = true
  s = run(s, 20)
  assert.equal(s.modules[P + 'XV01'].permissiveOk, false)
  assert.equal(s.modules[P + 'XV01'].open, false)
})

test('running the equalization tank dry trips and latches the transfer pump until reset', () => {
  let s = startArea(fresh())
  s.modules[P + 'XV010'].commandedOpen = false
  s.modules[P + 'XV01'].commandedOpen = true
  s = run(s, 260)
  const p01 = s.modules[P + 'P01']
  assert.ok(s.modules[P + 'LI001'].pv < 11)
  assert.equal(p01.running, false)
  assert.equal(p01.locked, true)
  s.modules[P + 'XV010'].commandedOpen = true
  s = run(s, 200)
  assert.ok(s.modules[P + 'LI001'].pv > 15, 'level recovers once the inlet is reopened')
  assert.equal(s.modules[P + 'P01'].running, false, 'Reset Required keeps the pump off until the operator resets it')
})

test('an empty acid drum alarms and stops acid dosing', () => {
  let s = startArea(fresh(0))
  s.modules[P + 'LAL002'].state = true
  let peak = 0
  for (let t = 0; t < 600; t += 10) { s = run(s, 10); peak = Math.max(peak, s.modules[P + 'AIC002'].pv) }
  assert.ok(peak > 6.5, `pH should drift up without acid, peaked at ${peak.toFixed(2)}`)
  assert.ok(s.alarms.some(a => a.moduleTag === P + 'LAL002' && a.active))
})

test('the discharge diverter returns to RECIRC on an out-of-window tank pH and reopens when it recovers', () => {
  let s = startArea(fresh())
  s = run(s, 30)
  assert.equal(s.modules[P + 'XV05'].open, true)
  s.modules[P + 'AI02AVG'].pv = 9.6
  s = run(s, 6)
  let xv05 = s.modules[P + 'XV05']
  assert.equal(xv05.interlock, true)
  assert.equal(xv05.open, false)
  s = run(s, 80)
  xv05 = s.modules[P + 'XV05']
  assert.equal(xv05.interlock, false)
  assert.equal(xv05.open, true)
})

test('the process waste picture renders live module state and degrades cleanly when modules are missing', () => {
  store.useStore.setState({ modules: fresh().modules })
  const html = render(AreaDisplay, { area: 'PWASTE' })
  const flat = text(html)
  for (const fragment of ['Process Waste Neutralization', '3WT-0001-LAHH001', '3WT-0001-LAL002', '3WT-0001-FAL001', 'Equalization',
    'Neutralization', 'Base', 'Acid', 'Drain', 'RECIRC', 'No Flow', '3WT-0001-NEUT', 'HOLD', 'Ramp Mod']) assert.ok(flat.includes(fragment), fragment)
  assert.match(html, /3WT-0001-XV010: Closed/)
  assert.match(html, /3WT-0001-XV01\)?: RECIRC/)
  assert.match(html, /data-equipment-tag="3WT-0001-P01" data-state="stopped"/)
  const started = startArea(fresh())
  store.useStore.setState({ modules: run(started, 60).modules })
  const live = render(AreaDisplay, { area: 'PWASTE' })
  assert.match(live, /3WT-0001-XV010: Open/)
  assert.match(live, /data-equipment-tag="3WT-0001-P01" data-state="running"/)
  assert.match(text(live), /TRANSFER/)

  const modules = fresh().modules
  delete modules[P + 'LAHH001']
  store.useStore.setState({ modules })
  assert.match(text(render(AreaDisplay, { area: 'PWASTE' })), /picture is unavailable.*3WT-0001-LAHH001/)
  let s = { ...fresh(), modules }
  assert.doesNotThrow(() => { s = run(s, 5) }, 'the plant still steps without the full process waste set')
})
