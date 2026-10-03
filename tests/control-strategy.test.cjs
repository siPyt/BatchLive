const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

// Compile the production engine with the project's existing TypeScript dependency.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  module._compile(outputText, filename)
}

const { buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
const { makeDefaultHardware, computeBadTags } = require('../src/renderer/src/engine/hardware.ts')
const { stepPlant } = require('../src/renderer/src/engine/simulate.ts')
const {
  appliedPidOutput, configurePidIo, pidIoPatchError, readAnalogSignal
} = require('../src/renderer/src/engine/analogStrategy.ts')
const {
  createSplitter, configureSplitter, executeSplitter, refreshSplitterStatus
} = require('../src/renderer/src/engine/splitter.ts')
const {
  avoidSavedBlockOverlaps, buildControlDiagram, connectedModuleTags
} = require('../src/renderer/src/engine/controlDiagram.ts')
const { moduleExecutionOrder } = require('../src/renderer/src/engine/fb.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')

function plant(splitRange = false) {
  const state = { ...buildInitialPlant(), hardware: makeDefaultHardware(), speed: 1 }
  if (!splitRange) {
    for (const m of Object.values(state.modules)) {
      if (m.type === 'PID' && m.io.splitter) m.io = configurePidIo(m, { splitRange: false })
    }
  }
  return state
}

function configure(state, tag, patch) {
  const m = state.modules[tag]
  assert.equal(pidIoPatchError(m, patch, state.modules), null)
  m.io = configurePidIo(m, patch)
}

test.beforeEach(() => test.mock.method(Math, 'random', () => 0.5))
test.afterEach(() => test.mock.restoreAll())

test('every PID is initialized with an executable AI1/PID1/AO1 path', () => {
  const state = plant()
  for (const m of Object.values(state.modules).filter(m => m.type === 'PID')) {
    assert.equal(m.io.ai.out, m.pv)
    assert.equal(m.io.ao.out, m.out)
    assert.equal(m.io.aiConnected && m.io.aoConnected && m.io.bkcalConnected, true)
  }
})

test('AI manual input drives PID.IN rather than the physical sensor', () => {
  const state = plant()
  configure(state, 'TIC-401', { inputMode: 'MAN', inputManual: 30 })
  const next = stepPlant(state, 0.1)
  const m = next.modules['TIC-401']
  assert.equal(m.io.ai.out, 30)
  assert.equal(m.pv, 30)
  assert.notEqual(m.io.ai.raw, 30)
  assert.ok(m.out > state.modules['TIC-401'].out)
  assert.equal(m.io.ao.out, m.out)
  assert.equal(state.modules['TIC-401'].io.ai.out, state.modules['TIC-401'].pv)
})

test('AO manual output drives the process and sends BKCAL to PID', () => {
  const state = plant()
  const initial = state.modules['TIC-401']
  configure(state, initial.tag, { outputMode: 'MAN', outputManual: 10 })
  const next = stepPlant(state, 0.1)
  const m = next.modules[initial.tag]
  assert.equal(m.io.ao.out, 10)
  assert.equal(m.actualMode, 'IMAN')
  assert.equal(m.mode, 'AUTO')
  assert.equal(m.out, 10)
  const target = m.pvMin + 0.1 * (m.pvMax - m.pvMin)
  assert.equal(m.io.ai.raw, initial.io.ai.raw + (target - initial.io.ai.raw) * 0.025)
})

test('AO limits constrain the actual process input and back-calculate the integral', () => {
  const state = plant()
  const m = state.modules['TIC-401']
  m.mode = 'MAN'
  m.out = 90
  configure(state, m.tag, { outputHigh: 25 })
  const next = stepPlant(state, 0.1).modules[m.tag]
  assert.equal(next.out, 90)
  assert.equal(next.io.ao.out, 25)
  assert.equal(next.io.ao.limited, true)
  assert.equal(next._integral, Math.max(-100, m._integral - 65))
  const target = m.pvMin + 0.25 * (m.pvMax - m.pvMin)
  assert.equal(next.io.ai.raw, m.io.ai.raw + (target - m.io.ai.raw) * 0.025)
})

test('disconnecting AI produces bad PID input; reconnecting restores it', () => {
  let state = plant()
  configure(state, 'TIC-401', { aiConnected: false })
  state = stepPlant(state, 0.1)
  assert.equal(state.modules['TIC-401'].pvBad, true)
  assert.equal(state.modules['TIC-401'].actualMode, 'IMAN')
  configure(state, 'TIC-401', { aiConnected: true })
  state = stepPlant(state, 0.1)
  assert.equal(state.modules['TIC-401'].pvBad, false)
  assert.equal(state.modules['TIC-401'].actualMode, 'AUTO')
})

test('disconnecting PID.OUT -> AO.CAS_IN holds the field output, not a pretend live wire', () => {
  const state = plant()
  configure(state, 'TIC-401', { aoConnected: false })
  const next = stepPlant(state, 0.1).modules['TIC-401']
  assert.equal(next.io.ao.out, state.modules['TIC-401'].io.ao.out)
  assert.equal(next.io.ao.bad, true)
  assert.equal(next.actualMode, 'IMAN')
})

test('BKCAL disconnection prevents the AO manual mode from forcing PID IMAN', () => {
  const state = plant()
  configure(state, 'TIC-401', {
    inputMode: 'MAN', inputManual: 30, outputMode: 'MAN',
    outputManual: 10, bkcalConnected: false
  })
  const next = stepPlant(state, 0.1).modules['TIC-401']
  assert.equal(next.actualMode, 'AUTO')
  assert.equal(next.io.ao.out, 10)
  assert.notEqual(next.out, 10)
})

test('external measured-value and output references execute the selected parameter', () => {
  const state = plant()
  const source = state.modules['II-201']
  configure(state, 'TIC-401', { inputSource: { tag: source.tag, parameter: 'PV' } })
  const next = stepPlant(state, 0.1)
  assert.equal(next.modules['TIC-401'].pv, next.modules[source.tag].pv)
  configure(state, 'TIC-401', { outputSource: { tag: 'AGIT-WARN-LIM', parameter: 'OUT' } })
  const actual = stepPlant(state, 0.1)
  assert.equal(actual.modules['TIC-401'].io.ao.out, Math.min(100, actual.modules['AGIT-WARN-LIM'].out))
  assert.equal(actual.modules['TIC-401'].actualMode, 'IMAN')
  assert.equal(readAnalogSignal({ tag: 'TIC-401', parameter: 'OUT' }, state.modules).value,
    state.modules['TIC-401'].out)
})

test('pulled AI CHARM freezes measurement and propagates quality in the same scan', () => {
  const state = plant()
  state.hardware.baseplates['CB-01'].channels[6].pulled = true
  const next = stepPlant(state, 0.1).modules['TIC-201']
  assert.equal(next.io.ai.bad, true)
  assert.equal(next.pvBad, true)
  assert.equal(next.pv, state.modules['TIC-201'].pv)
  assert.equal(next.actualMode, 'IMAN')
})

test('pulled AO CHARM holds the applied field output and does not mark AI bad', () => {
  const state = plant()
  state.hardware.baseplates['CB-01'].channels[7].pulled = true
  const faults = computeBadTags(state.hardware)
  assert.equal(faults.badOutTags.has('TIC-201'), true)
  assert.equal(faults.badPvTags.has('TIC-201'), false)
  const m = state.modules['TIC-201']
  m.mode = 'MAN'
  m.out = 95
  const next = stepPlant(state, 0.1).modules[m.tag]
  assert.equal(next.io.ao.out, m.io.ao.out)
  assert.equal(next.io.ao.bad, true)
  assert.equal(next.pvBad, false)
})

test('old project modules gain the explicit strategy without mutating previous snapshots', () => {
  const state = plant()
  delete state.modules['TIC-401'].io
  const next = stepPlant(state, 0.1)
  assert.equal(state.modules['TIC-401'].io, undefined)
  assert.ok(next.modules['TIC-401'].io)
  assert.notEqual(next.modules['TIC-201'].io, state.modules['TIC-201'].io)
  assert.notEqual(next.modules['TIC-201'].io.ai, state.modules['TIC-201'].io.ai)
})

test('invalid limits and missing or discrete sources are rejected explicitly', () => {
  const state = plant()
  const m = state.modules['TIC-401']
  for (const patch of [
    { outputLow: 70, outputHigh: 30 },
    { outputHigh: Infinity },
    { inputManual: NaN },
    { inputSource: { tag: 'MISSING', parameter: 'PV' } },
    { outputSource: { tag: 'P-401', parameter: 'OUT' } }
  ]) assert.ok(pidIoPatchError(m, patch, state.modules))
  assert.equal(readAnalogSignal({ tag: 'MISSING', parameter: 'PV' }, state.modules).bad, true)
})

const feedback = (value, patch = {}) => ({
  value, invited: true, bad: false, limit: 'NONE', ...patch
})
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `expected ${actual} to equal ${expected}`)

test('WFI presets execute five blocks with feedforward and all three back-calculation paths', () => {
  const state = plant(true)
  for (const [tag, flow] of [['TIC-401', 'FI-401'], ['TIC-411', 'FI-411']]) {
    const m = state.modules[tag]
    close(appliedPidOutput(m), m.out)
    assert.ok(m.io.splitter.balTimeSec >= 2 * m.reset)
    const graph = buildControlDiagram([tag, flow], state.modules)
    assert.deepEqual(Object.values(graph.blocks).map(block => block.type),
      ['AI', 'PID', 'SPLTR', 'AO', 'AO', 'AI'])
    assert.equal(graph.wires.length, 8)
    assert.equal(graph.wires.filter(wire => wire.feedback).length, 3)
    assert.equal(graph.wires.find(wire => wire.which === 'ff').fromTag, flow)
    assert.equal(graph.wires.find(wire => wire.which === 'ao2').fromPort, 'out2')
    configure(state, tag, { splitter: { feedback2Connected: false, inputConnected: false } })
    const disconnected = buildControlDiagram([tag, flow], state.modules)
    assert.equal(disconnected.wires.length, 6)
    assert.equal(disconnected.wires.some(wire => wire.which === 'splitterFeedback2'), false)
    assert.equal(disconnected.wires.some(wire => wire.which === 'splitter'), false)
  }
})

test('default staged actuators preserve the standard strategy process response', () => {
  let standard = plant()
  let split = plant(true)
  for (let scan = 0; scan < 25; scan++) {
    standard = stepPlant(standard, 0.1)
    split = stepPlant(split, 0.1)
    for (const tag of ['TIC-401', 'TIC-411']) {
      close(split.modules[tag].out, standard.modules[tag].out)
      close(appliedPidOutput(split.modules[tag]), appliedPidOutput(standard.modules[tag]))
      close(split.modules[tag].io.ai.raw, standard.modules[tag].io.ai.raw)
    }
    for (const key of Object.keys(standard.process)) {
      if (typeof standard.process[key] === 'number') close(split.process[key], standard.process[key])
    }
  }
})

test('SPLTR computes two independent coordinate curves, clamps and supports overlaps and gaps', () => {
  const state = createSplitter()
  for (const [sp, out1, out2] of [[-10, 0, 0], [25, 50, 0], [50, 100, 0],
    [75, 100, 50], [110, 100, 100]]) {
    executeSplitter(state, { value: sp, bad: false }, feedback(0), feedback(0), 1)
    close(state.out1, out1)
    close(state.out2, out2)
    close(state.bkcal, Math.max(0, Math.min(100, sp)))
  }
  const overlap = configureSplitter(state, { inArray: [0, 60, 40, 100] })
  executeSplitter(overlap, { value: 50, bad: false }, feedback(0), feedback(0), 1)
  close(overlap.out1, 100 * 50 / 60)
  close(overlap.out2, 100 * 10 / 60)
  const gap = configureSplitter(state, { inArray: [0, 40, 60, 100] })
  executeSplitter(gap, { value: 50, bad: false }, feedback(0), feedback(0), 1)
  close(gap.out1, 100)
  close(gap.out2, 0)
})

test('heat/cool curves follow the reference negative slope and 49-51 deadband', () => {
  const state = configureSplitter(createSplitter(), {
    inArray: [0, 49, 51, 100], outArray: [100, 0, 0, 100]
  })
  for (const [sp, out1, out2] of [[0, 100, 0], [24.5, 50, 0], [49, 0, 0],
    [50, 0, 0], [51, 0, 0], [75.5, 0, 50], [100, 0, 100]]) {
    executeSplitter(state, { value: sp, bad: false }, feedback(0), feedback(0), 1)
    close(state.out1, out1)
    close(state.out2, out2)
  }
})

test('SPLTR invalid coordinates and timing force OOS and recover after correction', () => {
  const original = createSplitter(75)
  for (const patch of [
    { inArray: [0, 0, 50, 100] }, { inArray: [0, 50, 100, 100] },
    { inArray: [10, 50, 0, 100] }, { outArray: [NaN, 100, 0, 100] },
    { balTimeSec: -1 }, { spRateUp: Infinity }, { sp: NaN }, { mode: 'MAN' }
  ]) {
    let state = configureSplitter(original, patch)
    executeSplitter(state, { value: 50, bad: false }, feedback(0), feedback(0), 1)
    assert.equal(state.actualMode, 'OOS')
    assert.equal(state.status, 'BAD')
    assert.ok(state.error)
    assert.equal(state.out1, original.out1)
    state = configureSplitter(state, {
      inArray: [0, 50, 50, 100], outArray: [0, 100, 0, 100],
      balTimeSec: 40, spRateUp: 0, mode: 'CAS', sp: 75
    })
    executeSplitter(state, { value: 75, bad: false }, feedback(0), feedback(0), 1)
    assert.equal(state.error, null)
    assert.equal(state.actualMode, 'CAS')
    assert.equal(state.status, 'GOOD')
    assert.equal(state.out2, 50)
  }
})

test('LOCKVAL Y11 uses five percent span hysteresis rather than flickering at X12', () => {
  const state = configureSplitter(createSplitter(), { lockval: 'Y11' })
  for (const [sp, expected] of [[50, 100], [51, 0], [49, 0], [47, 94], [49, 98]]) {
    executeSplitter(state, { value: sp, bad: false }, feedback(0), feedback(0), 1)
    close(state.out1, expected)
  }
})

test('AUTO limits SP rate and retains the requested setpoint across scans', () => {
  let state = configureSplitter(createSplitter(20), { mode: 'AUTO', sp: 100, spRateUp: 5, spRateDown: 2 })
  assert.equal(state.sp, 20)
  for (const expected of [25, 30, 35]) {
    executeSplitter(state, { value: -999, bad: true }, feedback(0), feedback(0), 1)
    assert.equal(state.sp, expected)
    assert.equal(state.autoSp, 100)
    assert.equal(state.actualMode, 'AUTO')
  }
  state = configureSplitter(state, { sp: 0 })
  executeSplitter(state, { value: 99, bad: false }, feedback(0), feedback(0), 1)
  assert.equal(state.sp, 33)
  assert.equal(state.autoSp, 0)
})

test('bad or disconnected CAS input holds outputs and reconnecting recovers', () => {
  let state = createSplitter(75)
  for (const input of [{ value: 90, bad: true }, { value: NaN, bad: false }]) {
    executeSplitter(state, input, feedback(100), feedback(50), 1)
    assert.equal(state.actualMode, 'IMAN')
    assert.equal(state.status, 'BAD')
    assert.equal(state.out2, 50)
  }
  state = configureSplitter(state, { inputConnected: false })
  executeSplitter(state, { value: 90, bad: false }, feedback(100), feedback(50), 1)
  assert.equal(state.status, 'BAD')
  state = configureSplitter(state, { inputConnected: true })
  executeSplitter(state, { value: 90, bad: false }, feedback(100), feedback(50), 1)
  assert.equal(state.status, 'GOOD')
  assert.equal(state.out2, 80)
})

test('second actuator return to CAS balances smoothly over BAL_TIME', () => {
  const state = configureSplitter(createSplitter(75), { balTimeSec: 4 })
  executeSplitter(state, { value: 75, bad: false }, feedback(100), feedback(20, { invited: false }), 1)
  assert.equal(state.actualMode, 'CAS')
  assert.equal(state.out2, 20)
  for (const expected of [20, 27.5, 35, 42.5, 50]) {
    executeSplitter(state, { value: 75, bad: false }, feedback(100), feedback(state.out2), 1)
    close(state.out2, expected)
  }
})

test('first actuator return from both unavailable initializes upstream without an output bump', () => {
  const state = createSplitter(75)
  executeSplitter(state, { value: 75, bad: false }, feedback(40, { invited: false }),
    feedback(20, { bad: true }), 1)
  assert.equal(state.status, 'NOT_INVITED')
  assert.equal(state.bkcal, 20)
  executeSplitter(state, { value: 90, bad: false }, feedback(40), feedback(20, { bad: true }), 1)
  assert.equal(state.actualMode, 'CAS')
  assert.equal(state.out1, 40)
  assert.equal(state.bkcal, 20)
  assert.equal(state.out2, 20)
})

test('feedback limits propagate in the available branch slope direction', () => {
  const state = configureSplitter(createSplitter(25), {
    inArray: [0, 49, 51, 100], outArray: [100, 0, 0, 100]
  })
  const missing = feedback(0, { bad: true, invited: false })
  refreshSplitterStatus(state, feedback(0, { limit: 'LOW' }), missing)
  assert.equal(state.status, 'HIGH_LIMITED')
  refreshSplitterStatus(state, feedback(100, { limit: 'HIGH' }), missing)
  assert.equal(state.status, 'LOW_LIMITED')
  refreshSplitterStatus(state, missing, feedback(100, { limit: 'HIGH' }))
  assert.equal(state.status, 'HIGH_LIMITED')
  refreshSplitterStatus(state, missing, feedback(0, { limit: 'LOW' }))
  assert.equal(state.status, 'LOW_LIMITED')
  refreshSplitterStatus(state, feedback(40), feedback(60))
  assert.equal(state.status, 'GOOD')
  refreshSplitterStatus(state, feedback(100, { limit: 'HIGH' }), feedback(100, { limit: 'HIGH' }))
  assert.equal(state.status, 'HIGH_LIMITED')
})

test('both applied AO outputs, not PID command, drive the physical process', () => {
  const state = plant(true)
  const m = state.modules['TIC-401']
  m.mode = 'MAN'
  m.out = 75
  configure(state, m.tag, { outputMode: 'MAN', outputManual: 20, output2Mode: 'MAN', output2Manual: 40 })
  const next = stepPlant(state, 0.1).modules[m.tag]
  assert.equal(next.out, 75)
  assert.equal(next.io.ao.out, 20)
  assert.equal(next.io.ao2.out, 40)
  assert.equal(appliedPidOutput(next), 30)
  assert.equal(next.io.splitter.status, 'NOT_INVITED')
  const target = m.pvMin + 0.3 * (m.pvMax - m.pvMin)
  close(next.io.ai.raw, m.io.ai.raw + (target - m.io.ai.raw) * 0.025)
})

test('heat/cool actuator preset has a real opposite physical response', () => {
  const state = plant(true)
  const m = state.modules['TIC-401']
  m.mode = 'MAN'
  m.out = 0
  configure(state, m.tag, { actuation: 'HEAT_COOL' })
  let next = stepPlant(state, 0.1)
  assert.equal(next.modules[m.tag].io.ao.out, 100)
  assert.equal(next.modules[m.tag].io.ao2.out, 0)
  assert.equal(appliedPidOutput(next.modules[m.tag]), 0)
  next.modules[m.tag].out = 100
  next = stepPlant(next, 0.1)
  assert.equal(next.modules[m.tag].io.ao.out, 0)
  assert.equal(next.modules[m.tag].io.ao2.out, 100)
  assert.equal(appliedPidOutput(next.modules[m.tag]), 100)
})

test('one manual or failed branch permits control through the remaining actuator', () => {
  const state = plant(true)
  configure(state, 'TIC-401', { outputMode: 'MAN', outputManual: 80, output2High: 30 })
  let next = stepPlant(state, 0.1)
  assert.equal(next.modules['TIC-401'].actualMode, 'AUTO')
  assert.equal(next.modules['TIC-401'].io.ao.out, 80)
  configure(next, 'TIC-401', { output2Failed: true })
  next = stepPlant(next, 0.1)
  assert.equal(next.modules['TIC-401'].actualMode, 'IMAN')
  assert.equal(next.modules['TIC-401'].io.ao2.bad, true)
  assert.equal(next.modules['TIC-401'].io.splitter.status, 'NOT_INVITED')
  configure(next, 'TIC-401', { output2Failed: false })
  next = stepPlant(next, 0.1)
  assert.equal(next.modules['TIC-401'].io.ao2.bad, false)
  assert.equal(next.modules['TIC-401'].io.splitter.actualMode, 'CAS')
})

test('PID.OUT, PID.PV and sub-block references are distinct executable quantities', () => {
  const state = plant(true)
  const m = state.modules['TIC-401']
  for (const [block, parameter, expected] of [
    ['PID1', 'OUT', m.out], ['PID1', 'PV', m.pv], ['AI1', 'OUT', m.pv],
    ['AO1', 'OUT', m.io.ao.out], ['AO2', 'OUT', m.io.ao2.out],
    ['SPLTR1', 'OUT_1', m.io.splitter.out1], ['SPLTR1', 'OUT_2', m.io.splitter.out2]
  ]) assert.equal(readAnalogSignal({ tag: m.tag, block, parameter }, state.modules).value, expected)
  assert.equal(readAnalogSignal({ tag: m.tag, block: 'AO2', parameter: 'PV' }, state.modules).bad, true)
  assert.equal(readAnalogSignal({ tag: m.tag, block: 'SPLTR1', parameter: 'OUT' }, state.modules).bad, true)
  const consumer = { ...state.modules['AGIT-WARN-LIM'], tag: 'TEST-OUT', fbType: 'ADD',
    in1: { kind: 'ref', tag: m.tag, block: 'PID1', parameter: 'OUT', value: 0 },
    in2: { kind: 'const', value: 2 } }
  state.modules[consumer.tag] = consumer
  const next = stepPlant(state, 0.1)
  close(next.modules[consumer.tag].out, next.modules[m.tag].out + 2)
  const wire = buildControlDiagram([m.tag, consumer.tag], state.modules).wires.find(
    wire => wire.toTag === consumer.tag && wire.which === 'in1')
  assert.equal(wire.fromPort, 'out')
})

test('AO2 external source executes upstream first and cycles execute each module exactly once', () => {
  const state = plant(true)
  const source = { ...state.modules['AGIT-WARN-LIM'], tag: 'LATE-SOURCE', fbType: 'MANLD', gain: 42 }
  state.modules[source.tag] = source
  configure(state, 'TIC-401', { output2Source: { tag: source.tag, parameter: 'OUT' } })
  const order = moduleExecutionOrder(state.modules)
  assert.ok(order.indexOf(source.tag) < order.indexOf('TIC-401'))
  assert.ok(connectedModuleTags(state.modules, 'TIC-401').includes(source.tag))
  const next = stepPlant(state, 0.1)
  assert.equal(next.modules['TIC-401'].io.ao2.out, 42)
  const a = { ...source, tag: 'CYCLE-A', fbType: 'ADD', out: 10,
    in1: { kind: 'ref', tag: 'CYCLE-B', value: 0 }, in2: { kind: 'const', value: 1 } }
  const b = { ...a, tag: 'CYCLE-B', out: 20, in1: { kind: 'ref', tag: 'CYCLE-A', value: 0 } }
  state.modules[a.tag] = a
  state.modules[b.tag] = b
  const cycleOrder = moduleExecutionOrder(state.modules)
  assert.equal(cycleOrder.filter(tag => tag === a.tag || tag === b.tag).length, 2)
  const cycle = stepPlant(state, 0.1)
  assert.equal(cycle.modules[b.tag].out, 11)
  assert.equal(cycle.modules[a.tag].out, 12)
})

test('standalone palette SPLTR drives two external AOs and draws feedback once per branch', () => {
  const state = plant()
  const tag = 'TEST-SPLTR'
  state.modules[tag] = { ...state.modules['AGIT-WARN-LIM'], tag, fbType: 'SPLTR',
    in1: { kind: 'const', value: 75 }, splitter: createSplitter(75),
    bkcal1Source: { tag: 'TIC-401', block: 'AO1', parameter: 'OUT' },
    bkcal2Source: { tag: 'TIC-411', block: 'AO1', parameter: 'OUT' } }
  configure(state, 'TIC-401', { outputSource: { tag, parameter: 'OUT' } })
  configure(state, 'TIC-411', { outputSource: { tag, parameter: 'OUT_2' } })
  const next = stepPlant(state, 0.1)
  assert.equal(next.modules[tag].splitter.actualMode, 'CAS')
  assert.equal(next.modules[tag].out, 100)
  assert.equal(next.modules['TIC-401'].io.ao.out, 100)
  assert.equal(next.modules['TIC-411'].io.ao.out, 50)
  const graph = buildControlDiagram([tag, 'TIC-401', 'TIC-411'], next.modules)
  const wires = graph.wires.filter(wire => wire.toTag === tag)
  assert.equal(wires.length, 2)
  assert.ok(wires.every(wire => wire.feedback && wire.fromPort === 'bkcal'))
  assert.equal(graph.wires.find(wire => wire.toTag === 'TIC-401/AO1').fromPort, 'out1')
  assert.ok(connectedModuleTags(state.modules, tag).includes('TIC-411'))
})

test('splitter snapshots and configuration arrays stay independent between scans', () => {
  const state = plant(true)
  const next = stepPlant(state, 0.1)
  const before = state.modules['TIC-401'].io
  const after = next.modules['TIC-401'].io
  assert.notEqual(after.splitter, before.splitter)
  assert.notEqual(after.splitter.inArray, before.splitter.inArray)
  assert.notEqual(after.ao2, before.ao2)
  const coordinates = [0, 49, 51, 100]
  configure(next, 'TIC-401', { splitter: { inArray: coordinates } })
  coordinates[0] = 99
  assert.equal(next.modules['TIC-401'].io.splitter.inArray[0], 0)
  assert.deepEqual(before.splitter.inArray, [0, 50, 50, 100])
})

test('removing a source sub-block reports bad quality without drawing a nonexistent terminal', () => {
  const state = plant(true)
  configure(state, 'TIC-411', { inputSource: { tag: 'TIC-401', block: 'AO2', parameter: 'OUT' } })
  configure(state, 'TIC-401', { splitRange: false })
  const next = stepPlant(state, 0.1)
  assert.equal(next.modules['TIC-411'].pvBad, true)
  const graph = buildControlDiagram(connectedModuleTags(next.modules, 'TIC-411'), next.modules)
  assert.equal(graph.wires.some(wire => wire.fromTag === 'TIC-401/AO2'), false)
  for (const wire of graph.wires) {
    assert.ok(graph.blocks[wire.fromTag], `missing source ${wire.fromTag}`)
    assert.ok(graph.blocks[wire.toTag], `missing target ${wire.toTag}`)
  }
})

test('AO2-only controls are rejected on a standard strategy and nonfinite output holds BAD', () => {
  const state = plant()
  const m = state.modules['TIC-401']
  for (const patch of [{ output2Failed: true }, { ao2Connected: true },
    { actuation: 'HEAT_COOL' }, { output2Source: { tag: 'AGIT-WARN-LIM', parameter: 'OUT' } }]) {
    assert.ok(pidIoPatchError(m, patch, state.modules))
  }
  m.io.ao.mode = 'MAN'
  m.io.ao.manualValue = NaN
  const next = stepPlant(state, 0.1).modules[m.tag]
  assert.equal(next.io.ao.bad, true)
  assert.equal(next.io.ao.out, m.io.ao.out)
  assert.ok(Number.isFinite(next.io.ai.raw))
})

test('invalid nested SPLTR configuration holds both AOs and sheds PID in the same scan', () => {
  const state = plant(true)
  const m = state.modules['TIC-401']
  configure(state, m.tag, { splitter: { inArray: [0, 0, 50, 100] } })
  let next = stepPlant(state, 0.1)
  assert.equal(next.modules[m.tag].io.splitter.actualMode, 'OOS')
  assert.equal(next.modules[m.tag].actualMode, 'IMAN')
  assert.equal(next.modules[m.tag].mode, 'AUTO')
  assert.equal(next.modules[m.tag].io.ao.out, m.io.ao.out)
  assert.equal(next.modules[m.tag].io.ao2.out, m.io.ao2.out)
  assert.equal(next.modules[m.tag].io.ao.bad, true)
  configure(next, m.tag, { splitter: { inArray: [0, 50, 50, 100] } })
  next = stepPlant(next, 0.1)
  next = stepPlant(next, 0.1)
  assert.equal(next.modules[m.tag].io.splitter.error, null)
  assert.equal(next.modules[m.tag].actualMode, 'AUTO')
})

test('configuration writes preserve errors, permissions, immutable state and diagnostic transitions', () => {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousWindow = global.window
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    const state = plant(true)
    state.modules['TEST-CONFIG'] = { ...state.modules['AGIT-WARN-LIM'],
      tag: 'TEST-CONFIG', fbType: 'SPLTR', splitter: createSplitter() }
    useStore.setState({ ...state, eventLog: [], trend: [] })
    const store = useStore.getState()
    const valid = { tag: 'TIC-401', block: 'AO1', parameter: 'OUT' }
    assert.equal(store.setSplitterConfig('TIC-401', { feedback2Source: valid }), false)
    assert.match(alerts.at(-1), /not a SPLTR/)
    assert.equal(store.setSplitterConfig('TEST-CONFIG', {
      feedback1Source: { ...valid, tag: 'MISSING' }, feedback2Source: valid
    }), false)
    assert.match(alerts.at(-1), /does not exist/)
    assert.equal(useStore.getState().modules['TEST-CONFIG'].bkcal2Source, undefined)
    assert.ok(useStore.getState().eventLog.every(entry => entry.category === 'DIAGNOSTIC'))

    const before = useStore.getState().modules['TIC-401'].io
    assert.equal(store.setPidIo('TIC-401', { splitter: { inArray: [0, 0, 50, 100] } }), true)
    assert.deepEqual(before.splitter.inArray, [0, 50, 50, 100])
    store.tick(0.1)
    assert.ok(useStore.getState().eventLog.some(entry => entry.category === 'DIAGNOSTIC' &&
      entry.tag === 'TIC-401' && entry.description.includes('configuration error')))
    const errors = useStore.getState().eventLog.filter(entry =>
      entry.category === 'DIAGNOSTIC' && entry.tag === 'TIC-401').length
    store.tick(0.1)
    assert.equal(useStore.getState().eventLog.filter(entry =>
      entry.category === 'DIAGNOSTIC' && entry.tag === 'TIC-401').length, errors)
    store.setPidIo('TIC-401', { splitter: { inArray: [0, 50, 50, 100] } })
    store.tick(0.1)
    assert.ok(useStore.getState().eventLog.some(entry =>
      entry.category === 'DIAGNOSTIC' && entry.description === 'SPLTR configuration restored'))

    useSecurity.setState({ currentUser: '__no_test_permissions__' })
    const protectedModule = useStore.getState().modules['TIC-401']
    assert.equal(store.setPidIo('TIC-401', { output2Failed: true }), false)
    assert.equal(useStore.getState().modules['TIC-401'], protectedModule)
    assert.match(useSecurity.getState().lastDenied, /Access Denied.*Can Configure/)
    assert.equal(alerts.length, 2)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
})

test('new strategy blocks avoid saved node positions without moving the saved layout', () => {
  const automatic = {
    PID: { x: 340, y: 48 }, SPLTR: { x: 624, y: 48 },
    AO1: { x: 908, y: 48 }, AO2: { x: 908, y: 183 }
  }
  const saved = { AO1: { x: 624, y: 48 }, AO2: { x: 624, y: 183 } }
  const sizes = {
    PID: { width: 188, height: 166 }, SPLTR: { width: 188, height: 115 },
    AO1: { width: 188, height: 81 }, AO2: { width: 188, height: 81 }
  }
  const result = avoidSavedBlockOverlaps(automatic, saved, sizes)
  assert.deepEqual(saved, { AO1: { x: 624, y: 48 }, AO2: { x: 624, y: 183 } })
  assert.deepEqual(automatic.SPLTR, { x: 624, y: 48 })
  assert.ok(result.SPLTR.y >= saved.AO2.y + sizes.AO2.height + 54)
  assert.deepEqual(result.PID, automatic.PID)
  assert.deepEqual(avoidSavedBlockOverlaps(automatic, {}, sizes), automatic)
})
