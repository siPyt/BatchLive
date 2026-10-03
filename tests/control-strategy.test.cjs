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
const { nextAreaName } = require('../src/renderer/src/engine/areas.ts')
const { usePictures, resolvePictureTarget } = require('../src/renderer/src/engine/pictureStore.ts')
const { moduleNameError, isValidDeltaVTag } = require('../src/renderer/src/engine/naming.ts')
const { compareAlarmRank } = require('../src/renderer/src/utils/format.ts')
const { findDst, channelConfigurationError } = require('../src/renderer/src/engine/traditionalIo.ts')

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

function withAreaProject(run) {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousWindow = global.window
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    useStore.getState().newProject('pharma')
    run(useStore.getState(), alerts)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
}

test('DV09 page 110: module names enforce the exact character and 16-character boundaries', () => {
  for (const tag of ['A', '1A', '$A-_1', 'A'.repeat(16)]) {
    assert.equal(moduleNameError(tag), null)
    assert.equal(isValidDeltaVTag(tag), true)
  }
  for (const tag of ['', '123', '$_-', 'A'.repeat(17), 'A B', 'A.B', 'A/B', 'A:B', '\u00c4']) {
    assert.ok(moduleNameError(tag), tag)
    assert.equal(isValidDeltaVTag(tag), false)
  }
})

test('module creation normalizes tags and rejects invalid or duplicate writes without false success', () => {
  withAreaProject((store, alerts) => {
    const spec = { tag: ' 1a_$- ', type: 'DI', area: 'FEED', description: 'Course name boundary' }
    assert.equal(store.createModule(spec), true)
    assert.equal(spec.tag, ' 1a_$- ')
    const created = useStore.getState().modules['1A_$-']
    assert.equal(created.tag, '1A_$-')
    assert.equal(store.createModule({ ...spec, tag: 'A'.repeat(16) }), true)
    const before = useStore.getState().modules
    const rev = useStore.getState().rev
    const successes = useStore.getState().eventLog.filter(e => e.description === 'Module created').length
    for (const tag of ['', '123', 'A'.repeat(17), 'TWO WORDS', '1a_$-']) {
      assert.equal(store.createModule({ ...spec, tag }), false)
    }
    assert.equal(useStore.getState().modules, before)
    assert.equal(useStore.getState().modules['1A_$-'], created)
    assert.equal(useStore.getState().rev, rev)
    assert.equal(alerts.length, 5)
    assert.match(alerts.at(-1), /already exists/)
    assert.equal(useStore.getState().eventLog.filter(e => e.description === 'Module created').length, successes)
    assert.equal(useStore.getState().eventLog.filter(e => e.category === 'DIAGNOSTIC').length, 5)
  })
})

test('denied module creation returns false and leaves the configuration unchanged', () => {
  withAreaProject((store, alerts) => {
    useSecurity.setState({ currentUser: 'OperatorA' })
    const before = useStore.getState()
    assert.equal(store.createModule({ tag: 'DV09-DI', type: 'DI', area: 'FEED', description: 'Denied' }), false)
    assert.equal(useStore.getState(), before)
    assert.match(useSecurity.getState().lastDenied, /Access Denied.*Can Configure/)
    assert.equal(alerts.length, 0)
  })
})

test('DV09 page 181: alarm ranking applies all four rules in source order', () => {
  const base = { id: 'base', moduleTag: 'DV09', type: 'HI', priority: 'ADVISORY',
    time: 1, active: true, acknowledged: false }
  const pairs = [
    [base, { ...base, acknowledged: true, priority: 'CRITICAL', time: 99 }],
    [{ ...base, active: false }, { ...base, acknowledged: true, priority: 'CRITICAL' }],
    [base, { ...base, active: false, priority: 'CRITICAL', time: 99 }],
    [{ ...base, priority: 'CRITICAL' }, { ...base, time: 99 }],
    [{ ...base, priority: 'WARNING' }, { ...base, time: 99 }],
    [{ ...base, time: 99 }, base]
  ]
  for (const [first, second] of pairs) {
    assert.ok(compareAlarmRank(first, second) < 0)
    assert.ok(compareAlarmRank(second, first) > 0)
    assert.deepEqual([second, first].sort(compareAlarmRank), [first, second])
  }
  assert.equal(compareAlarmRank(base, { ...base }), 0)
})

function discreteCourseProject(store) {
  store.newProject('blank')
  assert.equal(store.createArea('PLANT_AREA_A'), true)
  assert.equal(store.createController('CTLR', 'DV09 discrete I/O training'), true)
  assert.equal(store.commissionController('CTLR'), true)
  for (const [slot, type] of [[1, 'AI'], [2, 'AO'], [3, 'DI'], [4, 'DO']]) {
    assert.equal(store.addTraditionalCard('CTLR', slot, type), true)
  }
  const assignments = [
    [1, 1, 'LT-1'], [1, 2, 'FT-2'], [2, 1, 'LY-1'], [2, 2, 'FY-2'],
    [3, 1, 'LSO-1'], [3, 2, 'XI-2'], [4, 1, 'XV-1'], [4, 2, 'ZX-2']
  ]
  for (const [slot, channel, dst] of assignments) {
    assert.equal(store.configureTraditionalChannel(`CTLR/C0${slot}`, channel, { dst, enabled: true }), true)
  }
  assert.equal(store.createModule({ tag: 'XV-101', type: 'DO', area: 'PLANT_AREA_A', description: 'Course block valve' }), true)
  assert.equal(store.createModule({ tag: 'XVSTAT-101', type: 'DI', area: 'PLANT_AREA_A', description: 'Course valve status' }), true)
  assert.equal(store.bindDiscreteDst('XV-101', 'XV-1'), true)
  assert.equal(store.bindDiscreteDst('XVSTAT-101', 'LSO-1'), true)
  assert.equal(store.configureTraditionalChannel('CTLR/C03', 1,
    { dst: 'LSO-1', enabled: true, tiebackDst: 'XV-1' }), true)
  store.tick(0.1)
  store.tick(0.1)
}

test('DV09 page 91: exact eight DST assignments remain independent from module tags', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    const hw = useStore.getState().hardware
    for (const [dst, type, slot, channel] of [
      ['LT-1', 'AI', 1, 1], ['FT-2', 'AI', 1, 2], ['LY-1', 'AO', 2, 1], ['FY-2', 'AO', 2, 2],
      ['LSO-1', 'DI', 3, 1], ['XI-2', 'DI', 3, 2], ['XV-1', 'DO', 4, 1], ['ZX-2', 'DO', 4, 2]
    ]) {
      const target = findDst(hw, dst)
      assert.equal(target.card.type, type)
      assert.equal(target.card.slot, slot)
      assert.equal(target.channel.channel, channel)
      assert.equal(target.channel.enabled, true)
    }
    assert.equal(hw.discreteBindings['XV-101'], 'XV-1')
    assert.equal(hw.discreteBindings['XVSTAT-101'], 'LSO-1')
    assert.equal(Object.keys(hw.traditionalCards).length, 4)
    assert.ok(Object.values(hw.traditionalCards).every(card => card.channels.length === 8))
    assert.equal(store.autoSenseController('CTLR'), true)
    assert.equal(useStore.getState().hardware.controllers.CTLR.lastAutoSense.channelsDetected, 32)
    assert.equal(useStore.getState().hardware.controllers.CTLR.lastAutoSense.channelsBound, 2)
  })
})

test('DV09 pages 120 and 155: SP_D drives card4ch1 and DI reads the actual preceding-scan tieback', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    const before = useStore.getState()
    store.toggleDO('XV-101')
    assert.equal(useStore.getState().modules['XV-101'].commanded, true)
    assert.equal(useStore.getState().modules['XV-101'].state, false)
    store.tick(0.1)
    let next = useStore.getState()
    assert.equal(findDst(next.hardware, 'XV-1').channel.value, 1)
    assert.equal(findDst(next.hardware, 'LSO-1').channel.value, 1)
    assert.equal(next.modules['XV-101'].state, true)
    assert.equal(next.modules['XVSTAT-101'].state, false)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['XVSTAT-101'].state, true)
    assert.equal(useStore.getState().modules['XVSTAT-101'].ioBad, false)
    assert.equal(findDst(before.hardware, 'XV-1').channel.value, 0)
    assert.equal(before.modules['XV-101'].commanded, false)
    store.toggleDO('XV-101')
    store.tick(0.1)
    store.tick(0.1)
    next = useStore.getState()
    assert.equal(next.modules['XVSTAT-101'].state, false)
    assert.equal(findDst(next.hardware, 'XV-1').channel.value, 0)
  })
})

test('disabled output holds hardware feedback instead of coloring the command as a successful output', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    assert.equal(store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: false }), true)
    store.toggleDO('XV-101')
    store.tick(0.1)
    store.tick(0.1)
    let next = useStore.getState()
    assert.equal(next.modules['XV-101'].commanded, true)
    assert.equal(next.modules['XV-101'].state, false)
    assert.equal(next.modules['XV-101'].ioBad, true)
    assert.equal(next.modules['XVSTAT-101'].ioBad, true)
    assert.equal(findDst(next.hardware, 'XV-1').channel.value, 0)
    assert.equal(store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true }), true)
    store.tick(0.1)
    store.tick(0.1)
    next = useStore.getState()
    assert.equal(next.modules['XV-101'].state, true)
    assert.equal(next.modules['XVSTAT-101'].state, true)
    assert.equal(next.modules['XVSTAT-101'].ioBad, false)
  })
})

test('controller power loss freezes channels, propagates Bad and recovers on power restoration', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    assert.equal(store.setControllerConfiguration('CTLR', { coldRestartMinutes: 5 }), true)
    store.toggleDO('XV-101')
    store.tick(0.1); store.tick(0.1)
    assert.equal(store.simulateControllerPowerLoss('CTLR'), true)
    store.toggleDO('XV-101')
    store.tick(0.1); store.tick(0.1)
    let next = useStore.getState()
    assert.equal(next.modules['XV-101'].commanded, false)
    assert.equal(next.modules['XV-101'].state, true)
    assert.equal(next.modules['XVSTAT-101'].state, true)
    assert.equal(next.modules['XVSTAT-101'].ioBad, true)
    assert.equal(store.restoreControllerPower('CTLR'), true)
    store.tick(0.1); store.tick(0.1)
    next = useStore.getState()
    assert.equal(next.modules['XVSTAT-101'].state, false)
    assert.equal(next.modules['XVSTAT-101'].ioBad, false)
  })
})

test('discrete OOS holds output and rejects operator writes; AUTO recovers', () => {
  withAreaProject((store, alerts) => {
    discreteCourseProject(store)
    store.toggleDO('XV-101')
    store.tick(0.1); store.tick(0.1)
    assert.equal(store.setDiscreteMode('XV-101', 'OOS'), true)
    store.toggleDO('XV-101')
    assert.match(alerts.at(-1), /AUTO.*SP_D/)
    assert.equal(useStore.getState().modules['XV-101'].commanded, true)
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['XV-101'].ioBad, true)
    assert.equal(useStore.getState().modules['XVSTAT-101'].ioBad, true)
    assert.equal(findDst(useStore.getState().hardware, 'XV-1').channel.value, 1)
    assert.equal(store.setDiscreteMode('XV-101', 'AUTO'), true)
    assert.equal(useStore.getState().modules['XV-101'].ioBad, true)
    store.toggleDO('XV-101')
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['XVSTAT-101'].state, false)
    assert.equal(useStore.getState().modules['XV-101'].ioBad, false)
  })
})

test('DV09 page 124: ON VALUE 0 alarm is active on closed feedback and returns on open; disabled/OOS clears', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    assert.equal(store.configureDiscreteAlarm('XVSTAT-101', false, true), true)
    store.tick(0.1)
    assert.equal(useStore.getState().alarms.find(a => a.moduleTag === 'XVSTAT-101').active, true)
    assert.ok(useStore.getState().eventLog.some(e => e.tag === 'XVSTAT-101' && e.category === 'ALARM'))
    store.toggleDO('XV-101'); store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().alarms.find(a => a.moduleTag === 'XVSTAT-101').active, false)
    store.toggleDO('XV-101'); store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().alarms.find(a => a.moduleTag === 'XVSTAT-101').active, true)
    assert.equal(store.configureDiscreteAlarm('XVSTAT-101', false, false), true)
    store.tick(0.1)
    assert.equal(useStore.getState().alarms.find(a => a.moduleTag === 'XVSTAT-101').active, false)
    store.configureDiscreteAlarm('XVSTAT-101', false, true)
    store.setDiscreteMode('XVSTAT-101', 'OOS'); store.tick(0.1)
    assert.equal(useStore.getState().alarms.find(a => a.moduleTag === 'XVSTAT-101').active, false)
  })
})

test('manual input simulation refuses tieback override and accepts only Boolean DI values', () => {
  withAreaProject((store, alerts) => {
    discreteCourseProject(store)
    assert.equal(store.setTraditionalInput('LSO-1', 1), false)
    assert.match(alerts.at(-1), /Disconnect.*tieback/)
    assert.equal(store.configureTraditionalChannel('CTLR/C03', 1, { dst: 'LSO-1', enabled: true }), true)
    for (const value of [NaN, Infinity, -1, 0.5, 2]) assert.equal(store.setTraditionalInput('LSO-1', value), false)
    assert.equal(store.setTraditionalInput('LSO-1', 1), true)
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['XVSTAT-101'].state, true)
    assert.equal(store.setTraditionalInput('LSO-1', 0), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['XVSTAT-101'].state, false)
    assert.equal(store.setTraditionalInput('XV-1', 1), false)
    assert.equal(store.setTraditionalInput('', 1), false)
  })
})

test('traditional DST length boundaries and input-only tieback directions are validated explicitly', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    const hw = useStore.getState().hardware
    assert.equal(channelConfigurationError(hw, 'CTLR/C03', 3, { dst: 'A'.repeat(16), enabled: true }), null)
    assert.match(channelConfigurationError(hw, 'CTLR/C03', 3, { dst: 'A'.repeat(17), enabled: true }), /1-16/)
    assert.match(channelConfigurationError(hw, 'CTLR/C03', 3, { dst: '1234', enabled: true }), /letter/)
    assert.equal(channelConfigurationError(hw, 'CTLR/C03', 3, { dst: 'A_$-1', enabled: true }), null)
    assert.equal(channelConfigurationError(hw, 'CTLR/C01', 1,
      { dst: 'LT-1', enabled: true, tiebackDst: 'LY-1' }), null)
    assert.match(channelConfigurationError(hw, 'CTLR/C02', 1,
      { dst: 'LY-1', enabled: true, tiebackDst: 'LT-1' }), /Only input/)
    assert.equal(findDst(hw, ''), undefined)
  })
})

test('unbound legacy DO remains immediate; rapid toggles use commanded rather than held feedback', () => {
  withAreaProject(store => {
    const initial = useStore.getState().modules['HS-201'].commanded
    store.toggleDO('HS-201')
    assert.equal(useStore.getState().modules['HS-201'].state, !initial)
    store.toggleDO('HS-201')
    assert.equal(useStore.getState().modules['HS-201'].state, initial)
    discreteCourseProject(store)
    store.toggleDO('XV-101')
    store.toggleDO('XV-101')
    assert.equal(useStore.getState().modules['XV-101'].commanded, false)
    store.tick(0.1)
    assert.equal(findDst(useStore.getState().hardware, 'XV-1').channel.value, 0)
  })
})

test('traditional configuration rejects invalid slots, duplicate DSTs and wrong-direction/multiple output bindings', () => {
  withAreaProject((store, alerts) => {
    discreteCourseProject(store)
    const before = useStore.getState().hardware
    const successes = useStore.getState().eventLog.filter(e => e.category === 'CONFIGURE').length
    for (const slot of [0, 9, 1.5, NaN, 4]) assert.equal(store.addTraditionalCard('CTLR', slot, 'DO'), false)
    assert.equal(store.addTraditionalCard('MISSING', 1, 'DO'), false)
    assert.equal(store.configureTraditionalChannel('CTLR/C03', 3, { dst: 'XV-1', enabled: true }), false)
    assert.equal(store.configureTraditionalChannel('CTLR/C03', 3, { dst: '', enabled: true }), false)
    assert.equal(store.configureTraditionalChannel('CTLR/C03', 3, { dst: 'NO SPACE', enabled: true }), false)
    assert.equal(store.configureTraditionalChannel('MISSING', 1, { dst: 'TEST', enabled: true }), false)
    assert.equal(store.bindDiscreteDst('XV-101', 'LSO-1'), false)
    assert.equal(store.bindDiscreteDst('XVSTAT-101', 'XV-1'), false)
    assert.equal(store.bindDiscreteDst('MISSING', 'XV-1'), false)
    assert.equal(useStore.getState().hardware, before)
    assert.equal(useStore.getState().eventLog.filter(e => e.category === 'CONFIGURE').length, successes)
    assert.equal(alerts.length, 13)
    store.createModule({ tag: 'OTHER-DO', type: 'DO', area: 'PLANT_AREA_A', description: 'Second writer' })
    assert.equal(store.bindDiscreteDst('OTHER-DO', 'XV-1'), false)
    assert.match(alerts.at(-1), /already has a writer/)
  })
})

test('in-use DST rename and invalid tiebacks are rejected without partial mutation', () => {
  withAreaProject((store, alerts) => {
    discreteCourseProject(store)
    const before = useStore.getState().hardware
    for (const [card, channel, patch] of [
      ['CTLR/C04', 1, { dst: 'RENAMED', enabled: true }],
      ['CTLR/C03', 1, { dst: 'RENAMED', enabled: true }],
      ['CTLR/C04', 1, { dst: 'XV-1', enabled: true, tiebackDst: 'LSO-1' }],
      ['CTLR/C03', 1, { dst: 'LSO-1', enabled: true, tiebackDst: 'LT-1' }],
      ['CTLR/C03', 1, { dst: 'LSO-1', enabled: true, tiebackDst: 'MISSING' }]
    ]) assert.equal(store.configureTraditionalChannel(card, channel, patch), false)
    assert.equal(useStore.getState().hardware, before)
    assert.equal(alerts.length, 5)
    store.bindDiscreteDst('XVSTAT-101', '')
    store.configureTraditionalChannel('CTLR/C03', 1, { dst: 'LSO-1', enabled: true })
    store.bindDiscreteDst('XV-101', '')
    assert.equal(store.configureTraditionalChannel('CTLR/C04', 1, { dst: ' new-dst ', enabled: true }), true)
    assert.equal(findDst(useStore.getState().hardware, 'NEW-DST').channel.enabled, true)
  })
})

test('traditional writes require their correct keys and cannot replace existing pharma CHARM bindings', () => {
  withAreaProject((store, alerts) => {
    assert.equal(store.addTraditionalCard('CTLR-01', 4, 'DO'), true)
    assert.equal(store.configureTraditionalChannel('CTLR-01/C04', 1, { dst: 'COURSE-OUT', enabled: true }), true)
    const baseline = useStore.getState()
    assert.equal(store.bindDiscreteDst('HS-201', 'COURSE-OUT'), false)
    assert.match(alerts.at(-1), /already has a CHARM/)
    assert.equal(useStore.getState().modules, baseline.modules)
    useSecurity.setState({ currentUser: 'OperatorA' })
    const before = useStore.getState()
    assert.equal(store.addTraditionalCard('CTLR-01', 3, 'DI'), false)
    assert.equal(store.configureTraditionalChannel('CTLR-01/C04', 1, { dst: 'OTHER', enabled: true }), false)
    assert.equal(store.bindDiscreteDst('HS-201', ''), false)
    assert.equal(store.setTraditionalInput('MISSING', 1), false)
    assert.equal(store.configureDiscreteAlarm('LSH-101', false, true), false)
    assert.equal(useStore.getState(), before)
  })
})

test('deleting a bound module releases its writer and project reset removes training cards and bindings', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    store.deleteModule('XV-101')
    assert.equal(useStore.getState().hardware.discreteBindings['XV-101'], undefined)
    store.createModule({ tag: 'OTHER-DO', type: 'DO', area: 'PLANT_AREA_A', description: 'Replacement writer' })
    assert.equal(store.bindDiscreteDst('OTHER-DO', 'XV-1'), true)
    store.newProject('pharma')
    assert.equal(useStore.getState().hardware.traditionalCards, undefined)
    assert.equal(useStore.getState().hardware.discreteBindings, undefined)
    assert.equal(useStore.getState().modules['XV-101'].type, 'VALVE')
  })
})

test('multiple DI readers share one input while bad quality reaches downstream function blocks', () => {
  withAreaProject(store => {
    discreteCourseProject(store)
    store.createModule({ tag: 'SECOND-DI', type: 'DI', area: 'PLANT_AREA_A', description: 'Second reader' })
    assert.equal(store.bindDiscreteDst('SECOND-DI', 'LSO-1'), true)
    store.createModule({ tag: 'STATUS-AND', type: 'FB', fbType: 'AND', area: 'PLANT_AREA_A', description: 'Status consumer' })
    store.setFbInput('STATUS-AND', 'in1', { kind: 'ref', tag: 'XVSTAT-101', value: 0 })
    store.setFbInput('STATUS-AND', 'in2', { kind: 'const', value: 1 })
    store.toggleDO('XV-101'); store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['SECOND-DI'].state, true)
    assert.equal(useStore.getState().modules['STATUS-AND'].bad, false)
    store.setDiscreteMode('XV-101', 'OOS')
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['SECOND-DI'].state, true)
    assert.equal(useStore.getState().modules['SECOND-DI'].ioBad, true)
    assert.equal(useStore.getState().modules['STATUS-AND'].bad, true)
  })
})

test('blank project and isolated course-named modules execute without nonexistent pharma physics', () => {
  withAreaProject(store => {
    store.newProject('blank')
    store.tick(0.1)
    assert.deepEqual(useStore.getState().modules, {})
    store.createModule({ tag: 'FIC-101', type: 'PID', area: 'FEED', description: 'Isolated loop' })
    for (let scan = 0; scan < 20; scan++) store.tick(0.1)
    assert.ok(Number.isFinite(useStore.getState().modules['FIC-101'].pv))
    assert.ok(Number.isFinite(useStore.getState().modules['FIC-101'].out))
    assert.equal(Object.keys(useStore.getState().modules).length, 1)
  })
})

function analogCourseProject(store, split = false) {
  store.newProject('blank')
  assert.equal(store.createArea('PLANT_AREA_A'), true)
  assert.equal(store.createController('CTRL1', 'DV09 analog signal fixture'), true)
  assert.equal(store.commissionController('CTRL1'), true)
  assert.equal(store.addTraditionalCard('CTRL1', 1, 'AI'), true)
  assert.equal(store.addTraditionalCard('CTRL1', 2, 'AO'), true)
  for (const [slot, channel, dst] of [[1, 1, 'LT-1'], [1, 2, 'FT-2'], [2, 1, 'LY-1'], [2, 2, 'FY-2']]) {
    assert.equal(store.configureTraditionalChannel(`CTRL1/C0${slot}`, channel, { dst, enabled: true }), true)
  }
  assert.equal(store.createModule({ tag: 'LI-101', type: 'AI', area: 'PLANT_AREA_A',
    description: 'Course input', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
  assert.equal(store.createModule({ tag: 'LOOP-101', type: 'PID', area: 'PLANT_AREA_A',
    description: 'Analog path fixture, not LEVEL-101 AO', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
  assert.equal(store.bindAnalogDst('LI-101', 'input', 'LT-1'), true)
  assert.equal(store.bindAnalogDst('LOOP-101', 'input', 'FT-2'), true)
  assert.equal(store.bindAnalogDst('LOOP-101', 'output', 'LY-1'), true)
  if (split) {
    assert.equal(store.setPidIo('LOOP-101', { splitRange: true }), true)
    assert.equal(store.bindAnalogDst('LOOP-101', 'output2', 'FY-2'), true)
  }
  store.tick(0.1)
  store.tick(0.1)
}

function standaloneAoCourseProject(store) {
  analogCourseProject(store)
  store.deleteModule('LOOP-101')
  assert.equal(store.createModule({ tag: 'LEVEL-101', type: 'AO', area: 'PLANT_AREA_A',
    description: 'Course standalone output', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
  assert.equal(store.bindAnalogDst('LEVEL-101', 'output', 'LY-1'), true)
  assert.equal(store.addAoParameter('LEVEL-101', 'CAS_SP', 500), true)
  assert.equal(store.connectAoParameter('LEVEL-101', 'CAS_SP'), true)
  store.tick(0.1)
}

test('LEVEL-101 is a standalone AO with an actual Floating Point CAS_SP wire and engineering scale', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    const state = useStore.getState()
    const m = state.modules['LEVEL-101']
    assert.equal(m.type, 'AO')
    assert.equal(m.io, undefined)
    assert.deepEqual([m.pvMin, m.pvMax, m.spLow, m.spHigh, m.unit], [0, 1000, 0, 1000, 'gal'])
    assert.deepEqual(m.parameters.CAS_SP, { type: 'FLOAT', value: 500 })
    assert.deepEqual([m.mode, m.actualMode, m.sp, m.out, m.pv, m.bad], ['CAS', 'CAS', 500, 50, 500, false])
    assert.equal(findDst(state.hardware, 'LY-1').channel.value, 50)
    const diagram = buildControlDiagram(['LEVEL-101'], state.modules)
    assert.deepEqual(Object.keys(diagram.blocks), ['LEVEL-101/CAS_SP', 'LEVEL-101'])
    assert.equal(diagram.blocks['LEVEL-101'].name, 'AO1')
    assert.equal(diagram.blocks['LEVEL-101/CAS_SP'].parameter, 'CAS_SP')
    assert.deepEqual(diagram.wires, [{ key: 'LEVEL-101.standaloneCas', fromTag: 'LEVEL-101/CAS_SP',
      fromPort: 'out', toTag: 'LEVEL-101', which: 'standaloneCas' }])
  })
})

test('standalone AO CAS_SP range endpoints and SP limiting drive the actual channel', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    for (const [value, sp, out, limited] of [[0, 0, 0, false], [1000, 1000, 100, false],
      [-10, 0, 0, true], [1500, 1000, 100, true]]) {
      assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', value), true)
      store.tick(0.1)
      const m = useStore.getState().modules['LEVEL-101']
      assert.deepEqual([m.sp, m.out, m.limited, m.bad], [sp, out, limited, false])
      assert.equal(findDst(useStore.getState().hardware, 'LY-1').channel.value, out)
    }
    assert.equal(store.configureStandaloneAo('LEVEL-101', { spLow: 100, spHigh: 950 }), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 95)
  })
})

test('standalone AO AUTO/MAN/OOS are distinct from CAS with held field output', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    assert.equal(store.setStandaloneAoMode('LEVEL-101', 'AUTO'), true)
    assert.equal(store.setStandaloneAoValue('LEVEL-101', 700), true)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', 555), true)
    store.tick(0.1)
    let m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.sp, m.out, m.parameters.CAS_SP.value, m.actualMode], [700, 70, 555, 'AUTO'])
    assert.equal(store.setStandaloneAoMode('LEVEL-101', 'MAN'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].manualOutput, 70)
    assert.equal(store.setStandaloneAoValue('LEVEL-101', 25), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 25)
    store.setStandaloneAoMode('LEVEL-101', 'OOS')
    store.tick(0.1)
    m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.out, m.pv, m.bad, m.actualMode], [25, 250, true, 'OOS'])
    assert.equal(findDst(useStore.getState().hardware, 'LY-1').channel.value, 25)
    store.setStandaloneAoMode('LEVEL-101', 'CAS')
    store.tick(0.1)
    assert.ok(Math.abs(useStore.getState().modules['LEVEL-101'].out - 55.5) < 1e-9)
  })
})

test('standalone AO disconnect holds actual readback with Bad and reconnect recovers', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    store.connectAoParameter('LEVEL-101', undefined)
    store.tick(0.1)
    let m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.out, m.bad, m.actualMode], [50, true, 'OOS'])
    assert.equal(buildControlDiagram(['LEVEL-101'], useStore.getState().modules).wires.length, 0)
    assert.equal(store.setStandaloneAoValue('LEVEL-101', 80), false)
    store.connectAoParameter('LEVEL-101', 'CAS_SP')
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, false)
    store.configureTraditionalChannel('CTRL1/C02', 1, { dst: 'LY-1', enabled: false })
    store.setAoParameter('LEVEL-101', 'CAS_SP', 800)
    store.tick(0.1)
    m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.out, m.bad, m.actualMode], [50, true, 'OOS'])
    store.configureTraditionalChannel('CTRL1/C02', 1, { dst: 'LY-1', enabled: true })
    store.tick(0.1)
    assert.deepEqual([useStore.getState().modules['LEVEL-101'].out,
      useStore.getState().modules['LEVEL-101'].bad], [80, false])
  })
})

test('standalone AO controller failure holds hardware and propagates Bad to reference consumers', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    store.createModule({ tag: 'AO-MONITOR', type: 'FB', fbType: 'ADD', area: 'PLANT_AREA_A', description: 'Read output' })
    store.setFbInput('AO-MONITOR', 'in1', { kind: 'ref', tag: 'LEVEL-101', parameter: 'OUT', value: 0 })
    store.tick(0.1)
    assert.equal(useStore.getState().modules['AO-MONITOR'].out, 50)
    assert.equal(readAnalogSignal({ tag: 'LEVEL-101', parameter: 'PV' }, useStore.getState().modules).value, 500)
    store.setControllerConfiguration('CTRL1', { coldRestartMinutes: 5 })
    store.simulateControllerPowerLoss('CTRL1')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 900)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(useStore.getState().modules['AO-MONITOR'].bad, true)
    assert.equal(readAnalogSignal({ tag: 'LEVEL-101', parameter: 'OUT' }, useStore.getState().modules).bad, true)
    store.restoreControllerPower('CTRL1')
    for (let scan = 0; scan < 3; scan++) store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 90)
    assert.equal(useStore.getState().modules['AO-MONITOR'].bad, false)
  })
})

test('standalone AO validation rejects nonfinite, missing and invalid configuration without mutating snapshots', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    const before = useStore.getState().modules['LEVEL-101']
    assert.equal(store.createModule({ tag: 'INVALID-AO', type: 'AO', area: 'PLANT_AREA_A',
      description: 'Invalid range', pvMin: 1000, pvMax: 0 }), false)
    assert.equal(useStore.getState().modules['INVALID-AO'], undefined)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', NaN), false)
    assert.equal(store.setAoParameter('LEVEL-101', 'MISSING', 555), false)
    assert.equal(store.addAoParameter('LEVEL-101', 'CAS_SP', 500), false)
    assert.equal(store.addAoParameter('LEVEL-101', 'AO1', 500), false)
    assert.equal(store.addAoParameter('LEVEL-101', 'BAD NAME', 500), false)
    assert.equal(store.connectAoParameter('LEVEL-101', 'MISSING'), false)
    for (const patch of [{ pvMax: 0 }, { pvMin: Infinity }, { spLow: -1 }, { spHigh: 1001 },
      { spLow: 900, spHigh: 100 }]) assert.equal(store.configureStandaloneAo('LEVEL-101', patch), false)
    assert.equal(useStore.getState().modules['LEVEL-101'], before)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', 555), true)
    assert.equal(before.parameters.CAS_SP.value, 500)
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 555)
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    assert.equal(store.setStandaloneAoValue('LEVEL-101', 1001), false)
    store.setStandaloneAoMode('LEVEL-101', 'MAN')
    assert.equal(store.setStandaloneAoValue('LEVEL-101', -1), false)
    assert.equal(store.setStandaloneAoValue('LEVEL-101', Infinity), false)
  })
})

test('standalone AO binds only AO output DSTs, shares writer exclusion and releases on deletion', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    assert.equal(store.bindAnalogDst('LEVEL-101', 'input', 'LT-1'), false)
    assert.equal(store.bindAnalogDst('LEVEL-101', 'output2', 'FY-2'), false)
    assert.equal(store.bindAnalogDst('LEVEL-101', 'output', 'LT-1'), false)
    store.createModule({ tag: 'OTHER-AO', type: 'AO', area: 'PLANT_AREA_A', description: 'Second writer' })
    assert.equal(store.bindAnalogDst('OTHER-AO', 'output', 'LY-1'), false)
    assert.equal(store.configureTraditionalChannel('CTRL1/C02', 1, { dst: 'RENAMED' }), false)
    store.deleteModule('LEVEL-101')
    assert.equal(useStore.getState().hardware.analogBindings['LEVEL-101'], undefined)
    assert.equal(store.bindAnalogDst('OTHER-AO', 'output', 'LY-1'), true)
  })
})

test('simulated analog tieback maps AO percent to LI-101 PV_SCALE on the following scan', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    assert.equal(store.configureTraditionalChannel('CTRL1/C01', 1, { dst: 'LT-1', enabled: true, tiebackDst: 'LY-1' }), true)
    assert.equal(store.setTraditionalInput('LT-1', 123), false)
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 500)
    assert.equal(findDst(useStore.getState().hardware, 'LT-1').channel.value, 50)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 950)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 500)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 950)
    store.setStandaloneAoMode('LEVEL-101', 'OOS')
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 950)
    assert.equal(useStore.getState().modules['LI-101'].pvBad, true)
    store.setStandaloneAoMode('LEVEL-101', 'CAS')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 100)
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 100)
    assert.equal(useStore.getState().modules['LI-101'].pvBad, false)
  })
})

test('standalone AO nonzero scale and PID input tieback use independent receiving engineering scales', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    store.configureStandaloneAo('LEVEL-101', { pvMin: -100, pvMax: 900, spLow: -100, spHigh: 900 })
    store.setAoParameter('LEVEL-101', 'CAS_SP', 400)
    store.createModule({ tag: 'TIEBACK-PID', type: 'PID', area: 'PLANT_AREA_A', description: 'Scaled input',
      pvMin: 10, pvMax: 20, unit: 'bar' })
    store.bindAnalogDst('TIEBACK-PID', 'input', 'FT-2')
    store.configureTraditionalChannel('CTRL1/C01', 2, { dst: 'FT-2', enabled: true, tiebackDst: 'LY-1' })
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(useStore.getState().modules['LEVEL-101'].pv, 400)
    assert.equal(useStore.getState().modules['TIEBACK-PID'].io.ai.raw, 15)
    assert.equal(useStore.getState().modules['TIEBACK-PID'].pv, 15)
    assert.equal(store.configureTraditionalChannel('CTRL1/C01', 1, { dst: 'LT-1', enabled: true, tiebackDst: 'XV-1' }), false)
  })
})
test('standalone AO Bad reaches default FB output references and denied writes retain exact state', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    store.createModule({ tag: 'PLAIN-REF', type: 'FB', fbType: 'ADD', area: 'PLANT_AREA_A', description: 'Default output' })
    store.setFbInput('PLAIN-REF', 'in1', { kind: 'ref', tag: 'LEVEL-101', value: 0 })
    store.setStandaloneAoMode('LEVEL-101', 'OOS')
    store.tick(0.1)
    assert.equal(useStore.getState().modules['PLAIN-REF'].bad, true)
    useSecurity.setState({ currentUser: 'OperatorA' })
    const before = useStore.getState().modules['LEVEL-101']
    assert.equal(store.configureStandaloneAo('LEVEL-101', { spHigh: 900 }), false)
    assert.equal(store.addAoParameter('LEVEL-101', 'SECOND', 500), false)
    assert.equal(store.connectAoParameter('LEVEL-101', undefined), false)
    assert.equal(useStore.getState().modules['LEVEL-101'], before)
  })
})

test('standalone AO corruption holds finite readback with Bad and recovers without a stale latch', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    const before = useStore.getState()
    const m = before.modules['LEVEL-101']
    useStore.setState({ modules: { ...before.modules, 'LEVEL-101': { ...m,
      parameters: { ...m.parameters, CAS_SP: { type: 'FLOAT', value: NaN } } } } })
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, true)
    assert.equal(findDst(useStore.getState().hardware, 'LY-1').channel.bad, true)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 800)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 80)
    const state = useStore.getState()
    const card = state.hardware.traditionalCards['CTRL1/C02']
    useStore.setState({ hardware: { ...state.hardware, traditionalCards: {
      ...state.hardware.traditionalCards, [card.id]: { ...card,
        channels: card.channels.map(c => c.channel === 1 ? { ...c, value: NaN } : c) } } } })
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 80)
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, true)
  })
})

test('standalone AO outputs participate in PID cascade scaling, SFC actions and recorded trends', () => {
  withAreaProject(store => {
    const { applyAction, evalCondition, describeAction } = require('../src/renderer/src/engine/sfc.ts')
    standaloneAoCourseProject(store)
    store.createModule({ tag: 'AO-SLAVE', type: 'PID', area: 'PLANT_AREA_A', description: 'Cascade receiver',
      pvMin: 0, pvMax: 1000, unit: 'gal' })
    store.setCasSource('AO-SLAVE', 'LEVEL-101')
    store.setMode('AO-SLAVE', 'CAS')
    store.tick(0.1)
    assert.equal(useStore.getState().modules['AO-SLAVE'].sp, 500)
    assert.equal(store.setPidIo('AO-SLAVE', { inputSource: { tag: 'LEVEL-101', parameter: 'PV' } }), true)
    const diagram = buildControlDiagram(['LEVEL-101', 'AO-SLAVE'], useStore.getState().modules)
    assert.equal(diagram.wires.find(w => w.key === 'AO-SLAVE.pv').fromPort, 'pv')
    store.tick(0.1)
    assert.equal(useStore.getState().modules['AO-SLAVE'].pv, 500)
    assert.equal(store.setPidIo('AO-SLAVE', { inputSource: undefined }), true)
    store.setStandaloneAoMode('LEVEL-101', 'OOS')
    store.tick(0.1)
    assert.equal(useStore.getState().modules['AO-SLAVE'].actualMode, 'AUTO')
    const m = { ...useStore.getState().modules['LEVEL-101'] }
    applyAction(m, { kind: 'mode', tag: m.tag, mode: 'MAN' })
    applyAction(m, { kind: 'out', tag: m.tag, value: 25 })
    assert.deepEqual([m.mode, m.manualOutput], ['MAN', 25])
    assert.match(describeAction({ kind: 'out', tag: m.tag, value: 25 }, m), /AO1\/OUT.CV/)
    assert.equal(evalCondition({ kind: 'out', tag: 'LEVEL-101', op: '>=', value: 50 }, useStore.getState(), 0), true)
    store.setStandaloneAoMode('LEVEL-101', 'CAS')
    for (let scan = 0; scan < 5; scan++) store.tick(0.1)
    const point = useStore.getState().trend.at(-1)
    assert.equal(point.values['LEVEL-101.PV'], 500)
    assert.equal(point.values['LEVEL-101.SP'], 500)
    assert.equal(point.values['LEVEL-101.OUT'], 50)
  })
})

test('traditional AI channel drives LI-101 exactly without generic physics or drift', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    const before = useStore.getState()
    assert.equal(store.setTraditionalInput('LT-1', 725.5), true)
    store.tick(0.1)
    for (let scan = 0; scan < 20; scan++) store.tick(0.1)
    const next = useStore.getState()
    assert.equal(next.modules['LI-101'].pv, 725.5)
    assert.equal(next.modules['LI-101'].pvBad, false)
    assert.equal(findDst(next.hardware, 'LT-1').channel.value, 725.5)
    assert.equal(findDst(before.hardware, 'LT-1').channel.value, 0)
    assert.equal(before.modules['LI-101'].pv, 0)
    assert.equal(store.setTraditionalInput('LT-1', 1200), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 1000)
    assert.equal(store.setTraditionalInput('LT-1', -20), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 0)
  })
})

test('PID AI1 reads its named channel before execution and cannot be overwritten by process physics', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('FT-2', 432.1)
    store.tick(0.1)
    let m = useStore.getState().modules['LOOP-101']
    assert.equal(m.pv, 432.1)
    assert.equal(m.io.ai.raw, 432.1)
    assert.equal(m.io.ai.out, 432.1)
    assert.equal(m.pvBad, false)
    assert.equal(store.setPidIo('LOOP-101', { inputMode: 'MAN', inputManual: 222 }), true)
    store.tick(0.1)
    m = useStore.getState().modules['LOOP-101']
    assert.equal(m.pv, 222)
    assert.equal(m.io.ai.raw, 432.1)
    assert.equal(m.io.ai.rawBad, false)
    assert.equal(store.setPidIo('LOOP-101', { inputMode: 'AUTO' }), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LOOP-101'].pv, 432.1)
  })
})

test('AO1 writes real C02 CH1 percent output after execution and obeys limits and manual mode', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setMode('LOOP-101', 'MAN')
    store.setOutput('LOOP-101', 63)
    const before = useStore.getState()
    const previousSignal = findDst(before.hardware, 'LY-1').channel.value
    assert.notEqual(previousSignal, 63)
    store.tick(0.1)
    let next = useStore.getState()
    assert.equal(next.modules['LOOP-101'].io.ao.out, 63)
    assert.equal(findDst(next.hardware, 'LY-1').channel.value, 63)
    assert.equal(findDst(next.hardware, 'LY-1').channel.bad, false)
    assert.equal(findDst(before.hardware, 'LY-1').channel.value, previousSignal)
    assert.equal(store.setPidIo('LOOP-101', { outputHigh: 50 }), true)
    store.tick(0.1)
    assert.equal(findDst(useStore.getState().hardware, 'LY-1').channel.value, 50)
    assert.equal(store.setPidIo('LOOP-101', { outputMode: 'MAN', outputManual: 22 }), true)
    store.tick(0.1)
    assert.equal(findDst(useStore.getState().hardware, 'LY-1').channel.value, 22)
  })
})

test('disabled analog channels hold measurement and hardware output and recover without fictitious feedback', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('LT-1', 750)
    store.setTraditionalInput('FT-2', 600)
    store.setMode('LOOP-101', 'MAN')
    store.setOutput('LOOP-101', 40); store.tick(0.1)
    for (const [card, dst] of [['CTRL1/C01', 'LT-1'], ['CTRL1/C02', 'LY-1']]) {
      store.configureTraditionalChannel(card, 1, { dst, enabled: false })
    }
    store.setTraditionalInput('LT-1', 900)
    store.setOutput('LOOP-101', 80); store.tick(0.1)
    let next = useStore.getState()
    assert.equal(next.modules['LI-101'].pv, 750)
    assert.equal(next.modules['LI-101'].pvBad, true)
    assert.equal(next.modules['LOOP-101'].out, 80)
    assert.equal(next.modules['LOOP-101'].io.ao.out, 40)
    assert.equal(next.modules['LOOP-101'].io.ao.bad, true)
    assert.equal(findDst(next.hardware, 'LY-1').channel.value, 40)
    for (const [card, dst] of [['CTRL1/C01', 'LT-1'], ['CTRL1/C02', 'LY-1']]) {
      store.configureTraditionalChannel(card, 1, { dst, enabled: true })
    }
    store.tick(0.1); store.tick(0.1)
    next = useStore.getState()
    assert.equal(next.modules['LI-101'].pv, 900)
    assert.equal(next.modules['LI-101'].pvBad, false)
    assert.equal(findDst(next.hardware, 'LY-1').channel.value, 80)
    assert.equal(next.modules['LOOP-101'].io.ao.bad, false)
  })
})

test('analog controller power loss freezes all bound signals and cold restart restores actual channels', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setControllerConfiguration('CTRL1', { coldRestartMinutes: 5 })
    store.setTraditionalInput('LT-1', 700); store.setTraditionalInput('FT-2', 650)
    store.setMode('LOOP-101', 'MAN'); store.setOutput('LOOP-101', 35); store.tick(0.1)
    store.simulateControllerPowerLoss('CTRL1')
    store.setTraditionalInput('FT-2', 800); store.setOutput('LOOP-101', 90); store.tick(0.1)
    let next = useStore.getState()
    assert.equal(next.modules['LOOP-101'].pv, 650)
    assert.equal(next.modules['LOOP-101'].pvBad, true)
    assert.equal(next.modules['LI-101'].pvBad, true)
    assert.equal(findDst(next.hardware, 'LY-1').channel.value, 35)
    store.restoreControllerPower('CTRL1'); store.tick(0.1); store.tick(0.1)
    next = useStore.getState()
    assert.equal(next.modules['LOOP-101'].pv, 800)
    assert.equal(next.modules['LOOP-101'].pvBad, false)
    assert.equal(findDst(next.hardware, 'LY-1').channel.value, 90)
  })
})

test('analog binding rejects wrong ports/types and duplicate writers including AO1 versus AO2 in one module', () => {
  withAreaProject((store, alerts) => {
    analogCourseProject(store, true)
    const before = useStore.getState().hardware
    const successCount = useStore.getState().eventLog.filter(e => e.category === 'CONFIGURE').length
    for (const [tag, port, dst] of [
      ['LI-101', 'output', 'LY-1'], ['LI-101', 'output2', 'FY-2'],
      ['LOOP-101', 'input', 'LY-1'], ['LOOP-101', 'output', 'LT-1'],
      ['LOOP-101', 'invalid', 'LY-1'], ['MISSING', 'input', 'LT-1'],
      ['LOOP-101', 'output2', 'LY-1'], ['LOOP-101', 'output', 'FY-2'],
      ['LOOP-101', 'input', 'MISSING']
    ]) assert.equal(store.bindAnalogDst(tag, port, dst), false)
    assert.equal(useStore.getState().hardware, before)
    assert.equal(useStore.getState().eventLog.filter(e => e.category === 'CONFIGURE').length, successCount)
    assert.equal(alerts.length, 9)
    store.createModule({ tag: 'OTHER-LOOP', type: 'PID', area: 'PLANT_AREA_A', description: 'Second writer' })
    assert.equal(store.bindAnalogDst('OTHER-LOOP', 'output', 'LY-1'), false)
    assert.equal(store.bindAnalogDst('OTHER-LOOP', 'output2', 'FY-2'), false)
    assert.equal(store.bindAnalogDst('OTHER-LOOP', 'input', ' lt-1 '), true)
    assert.equal(useStore.getState().hardware.analogBindings['OTHER-LOOP'].input, 'LT-1')
  })
})

test('analog referenced DST rename and removing a bound AO2 block require explicit disconnection', () => {
  withAreaProject((store, alerts) => {
    analogCourseProject(store, true)
    const before = useStore.getState()
    for (const [card, dst] of [['CTRL1/C01', 'NEW-IN'], ['CTRL1/C02', 'NEW-OUT']]) {
      assert.equal(store.configureTraditionalChannel(card, 1, { dst, enabled: true }), false)
    }
    assert.equal(store.setPidIo('LOOP-101', { splitRange: false }), false)
    assert.match(alerts.at(-1), /Disconnect.*AO2/)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().hardware, before.hardware)
    assert.equal(store.bindAnalogDst('LOOP-101', 'output2', ''), true)
    assert.equal(store.setPidIo('LOOP-101', { splitRange: false }), true)
    store.bindAnalogDst('LI-101', 'input', '')
    assert.equal(store.configureTraditionalChannel('CTRL1/C01', 1, { dst: 'NEW-IN', enabled: true }), true)
  })
})

test('analog writes cannot bypass permissions or take over baseline CHARM I/O', () => {
  withAreaProject((store, alerts) => {
    store.addTraditionalCard('CTLR-01', 1, 'AI')
    store.configureTraditionalChannel('CTLR-01/C01', 1, { dst: 'TEACH-IN', enabled: true })
    const before = useStore.getState()
    assert.equal(store.bindAnalogDst('FIC-101', 'input', 'TEACH-IN'), false)
    assert.match(alerts.at(-1), /CHARM binding/)
    assert.equal(useStore.getState().hardware, before.hardware)
    analogCourseProject(store)
    const fixture = useStore.getState()
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.bindAnalogDst('LI-101', 'input', ''), false)
    assert.equal(store.bindAnalogDst('LOOP-101', 'output', 'FY-2'), false)
    assert.equal(store.setTraditionalInput('LT-1', 800), false)
    assert.equal(useStore.getState(), fixture)
  })
})

test('AO2 independent channel failure does not mark healthy AO1 Bad or alter held readback', () => {
  withAreaProject(store => {
    analogCourseProject(store, true)
    store.setPidIo('LOOP-101', { splitter: { balTimeSec: 1 } })
    store.setMode('LOOP-101', 'MAN'); store.setOutput('LOOP-101', 75)
    store.tick(0.1)
    let next = useStore.getState()
    assert.equal(findDst(next.hardware, 'LY-1').channel.value, 100)
    assert.equal(findDst(next.hardware, 'FY-2').channel.value, 50)
    store.configureTraditionalChannel('CTRL1/C02', 2, { dst: 'FY-2', enabled: false })
    store.setOutput('LOOP-101', 90); store.tick(0.1)
    next = useStore.getState()
    assert.equal(next.modules['LOOP-101'].io.ao.bad, false)
    assert.equal(next.modules['LOOP-101'].io.ao2.bad, true)
    assert.equal(findDst(next.hardware, 'FY-2').channel.value, 50)
    assert.equal(findDst(next.hardware, 'LY-1').channel.bad, false)
    store.configureTraditionalChannel('CTRL1/C02', 2, { dst: 'FY-2', enabled: true })
    store.tick(0.1)
    assert.equal(findDst(useStore.getState().hardware, 'FY-2').channel.value, 50)
    assert.equal(useStore.getState().modules['LOOP-101'].io.ao2.bad, false)
    for (let scan = 0; scan < 12; scan++) store.tick(0.1)
    assert.ok(Math.abs(findDst(useStore.getState().hardware, 'FY-2').channel.value - 80) < 1e-9)
  })
})

test('analog input invalid quality propagates through both PV and OUT references, manual input remains usable', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('LT-1', 500); store.setTraditionalInput('FT-2', 450); store.tick(0.1)
    store.configureTraditionalChannel('CTRL1/C01', 1, { dst: 'LT-1', enabled: false })
    store.configureTraditionalChannel('CTRL1/C01', 2, { dst: 'FT-2', enabled: false })
    store.tick(0.1)
    let modules = useStore.getState().modules
    for (const parameter of ['PV', 'OUT']) {
      assert.equal(readAnalogSignal({ tag: 'LI-101', parameter }, modules).bad, true)
    }
    assert.equal(modules['LOOP-101'].pv, 450)
    assert.equal(modules['LOOP-101'].pvBad, true)
    store.setPidIo('LOOP-101', { inputMode: 'MAN', inputManual: 350 }); store.tick(0.1)
    modules = useStore.getState().modules
    assert.equal(modules['LOOP-101'].io.ai.rawBad, true)
    assert.equal(modules['LOOP-101'].pvBad, false)
    assert.equal(modules['LOOP-101'].pv, 350)
  })
})

test('analog auto-sense and deletion track actual ports and release writers for reuse', () => {
  withAreaProject(store => {
    analogCourseProject(store, true)
    assert.equal(store.autoSenseController('CTRL1'), true)
    let sense = useStore.getState().hardware.controllers.CTRL1.lastAutoSense
    assert.equal(sense.channelsDetected, 16)
    assert.equal(sense.channelsBound, 4)
    store.deleteModule('LOOP-101')
    assert.equal(useStore.getState().hardware.analogBindings['LOOP-101'], undefined)
    store.createModule({ tag: 'NEW-LOOP', type: 'PID', area: 'PLANT_AREA_A', description: 'Replacement' })
    assert.equal(store.bindAnalogDst('NEW-LOOP', 'output', 'LY-1'), true)
    store.autoSenseController('CTRL1')
    sense = useStore.getState().hardware.controllers.CTRL1.lastAutoSense
    assert.equal(sense.channelsBound, 2)
    store.newProject('pharma')
    assert.equal(useStore.getState().hardware.analogBindings, undefined)
    assert.equal(useStore.getState().modules['XV-101'].type, 'VALVE')
  })
})

test('binding changes immediately mark unsampled input Bad and use actual hardware output readback', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.bindAnalogDst('LOOP-101', 'output', '')
    store.setMode('LOOP-101', 'MAN'); store.setOutput('LOOP-101', 90); store.tick(0.1)
    const before = useStore.getState()
    const physical = findDst(before.hardware, 'LY-1').channel.value
    assert.equal(before.modules['LOOP-101'].io.ao.out, 90)
    assert.notEqual(physical, 90)
    assert.equal(store.bindAnalogDst('LOOP-101', 'output', 'LY-1'), true)
    assert.equal(useStore.getState().modules['LOOP-101'].io.ao.out, physical)
    assert.equal(useStore.getState().modules['LOOP-101'].io.ao.bad, true)
    assert.equal(before.modules['LOOP-101'].io.ao.out, 90)
    assert.equal(before.modules['LOOP-101'].io.ao.bad, false)
    store.bindAnalogDst('LI-101', 'input', 'FT-2')
    assert.equal(useStore.getState().modules['LI-101'].pvBad, true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LOOP-101'].io.ao.out, 90)
    assert.equal(useStore.getState().modules['LOOP-101'].io.ao.bad, false)
    assert.equal(useStore.getState().modules['LI-101'].pvBad, false)
  })
})

test('missing bound input and output DSTs report Bad and hold instead of falling back to synthetic physics', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('LT-1', 700); store.setTraditionalInput('FT-2', 600)
    store.setMode('LOOP-101', 'MAN'); store.setOutput('LOOP-101', 40); store.tick(0.1)
    const snapshot = useStore.getState()
    useStore.setState({ hardware: { ...snapshot.hardware, traditionalCards: {} } })
    store.tick(0.1)
    const next = useStore.getState()
    assert.equal(next.modules['LI-101'].pv, 700)
    assert.equal(next.modules['LI-101'].pvBad, true)
    assert.equal(next.modules['LOOP-101'].pv, 600)
    assert.equal(next.modules['LOOP-101'].pvBad, true)
    assert.equal(next.modules['LOOP-101'].io.ao.out, 40)
    assert.equal(next.modules['LOOP-101'].io.ao.bad, true)
  })
})

test('DV09 page 172: LI-101 course HI950 and LO100 thresholds evaluate the bound LT-1 engineering signal', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    const initial = useStore.getState()
    assert.equal(initial.modules['LI-101'].alarms.find(a => a.type === 'HI').enabled, false)
    assert.equal(initial.modules['LI-101'].alarms.find(a => a.type === 'LO').enabled, false)
    store.setAlarmLimit('LI-101', 'HI', { limit: 950, enabled: true })
    store.setAlarmLimit('LI-101', 'LO', { limit: 100, enabled: true })
    assert.equal(initial.modules['LI-101'].alarms.find(a => a.type === 'HI').enabled, false)
    assert.equal(initial.modules['LI-101'].alarms.find(a => a.type === 'HI').limit, 900)
    for (const [value, hi, lo] of [[100, false, true], [100.1, false, false],
      [949.9, false, false], [950, true, false], [950.1, true, false]]) {
      store.setTraditionalInput('LT-1', value); store.tick(0.1)
      const s = useStore.getState()
      assert.equal(s.modules['LI-101'].pv, value)
      assert.equal(s.alarms.some(a => a.id === 'LI-101.HI' && a.active), hi)
      assert.equal(s.alarms.some(a => a.id === 'LI-101.LO' && a.active), lo)
    }
  })
})

test('invalid analog alarm writes leave limits intact and do not report false configuration success', () => {
  withAreaProject((store, alerts) => {
    analogCourseProject(store)
    const before = useStore.getState()
    const count = before.eventLog.filter(e => e.category === 'CONFIGURE').length
    store.setAlarmLimit('LI-101', 'HI', { limit: NaN })
    store.setAlarmLimit('LI-101', 'LO', { limit: Infinity })
    store.setAlarmLimit('LI-101', 'HI_HI', { limit: 999 })
    store.setAlarmLimit('MISSING', 'HI', { limit: 950 })
    assert.equal(alerts.length, 4)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().eventLog.filter(e => e.category === 'CONFIGURE').length, count)
  })
})

test('nonfinite loaded analog signal stays held and Bad in module, channel and PV BAD alarm', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('LT-1', 500); store.tick(0.1)
    const s = useStore.getState()
    const card = s.hardware.traditionalCards['CTRL1/C01']
    useStore.setState({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [card.id]: { ...card, channels: card.channels.map(c => c.channel === 1 ? { ...c, value: NaN } : c) } } } })
    store.tick(0.1)
    const next = useStore.getState()
    assert.equal(next.modules['LI-101'].pv, 500)
    assert.equal(next.modules['LI-101'].pvBad, true)
    assert.equal(findDst(next.hardware, 'LT-1').channel.bad, true)
    assert.equal(next.alarms.find(a => a.id === 'LI-101.PVBAD').active, true)
    assert.equal(store.setTraditionalInput('LT-1', NaN), false)
    assert.equal(store.setTraditionalInput('LT-1', 700), true)
    store.tick(0.1); store.tick(0.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 700)
    assert.equal(useStore.getState().modules['LI-101'].pvBad, false)
  })
})

test('invalid hardware output readback cannot inject NaN into applied output or process equations', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setMode('LOOP-101', 'MAN'); store.setOutput('LOOP-101', 40); store.tick(0.1)
    const s = useStore.getState()
    const card = s.hardware.traditionalCards['CTRL1/C02']
    useStore.setState({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [card.id]: { ...card, channels: card.channels.map(c => c.channel === 1 ? { ...c, value: NaN } : c) } } } })
    store.setOutput('LOOP-101', 80); store.tick(0.1)
    const m = useStore.getState().modules['LOOP-101']
    assert.equal(m.out, 80)
    assert.equal(m.io.ao.out, 40)
    assert.equal(m.io.ao.bad, true)
    assert.equal(appliedPidOutput(m), 40)
    assert.equal(findDst(useStore.getState().hardware, 'LY-1').channel.bad, true)
  })
})

test('DV09 pages 87-88: create AREA_A, rename PLANT_AREA_A and add PLANT_AREA_B', () => {
  withAreaProject(store => {
    const originalAreas = store.areas
    assert.equal(store.createArea('area_a'), true)
    assert.equal(store.renameArea('AREA_A', 'plant_area_a'), true)
    const generated = nextAreaName(useStore.getState().areas)
    assert.equal(generated, 'AREA1')
    assert.equal(store.createArea(generated), true)
    assert.equal(store.renameArea(generated, 'PLANT_AREA_B'), true)
    assert.deepEqual(useStore.getState().areas, [...originalAreas, 'PLANT_AREA_A', 'PLANT_AREA_B'])
    assert.ok(!useStore.getState().areas.includes('AREA_A'))
    assert.ok(useStore.getState().eventLog.some(e =>
      e.category === 'CONFIGURE' && e.description === 'Plant area renamed from AREA_A'))
    store.createModule({ tag: 'DV09-DI', type: 'DI', area: 'PLANT_AREA_A', description: 'Training input' })
    assert.equal(useStore.getState().modules['DV09-DI'].area, 'PLANT_AREA_A')
    assert.equal(originalAreas.includes('PLANT_AREA_A'), false)
  })
})

test('area rename atomically moves modules, equipment and SFCs without changing references or live values', () => {
  withAreaProject(store => {
    const original = useStore.getState()
    const module = original.modules['P-101']
    const wiring = original.hardware
    assert.equal(store.renameArea('FEED', 'PLANT_AREA_A'), true)
    const next = useStore.getState()
    assert.deepEqual(next.modules['P-101'], { ...module, area: 'PLANT_AREA_A' })
    assert.equal(module.area, 'FEED')
    assert.equal(next.equipment['EM-FEED-SUPPLY'].area, 'PLANT_AREA_A')
    assert.ok(Object.values(original.sfcs).some(s => s.area === 'FEED'))
    for (const [name, sfc] of Object.entries(original.sfcs)) {
      assert.deepEqual(next.sfcs[name], { ...sfc, area: sfc.area === 'FEED' ? 'PLANT_AREA_A' : sfc.area })
    }
    assert.equal(next.hardware, wiring)
    assert.equal(next.process, original.process)
    assert.equal(next.alarms, original.alarms)
    store.tick(0.1)
    assert.ok(useStore.getState().areas.includes('PLANT_AREA_A'))
    assert.equal(useStore.getState().modules['P-101'].area, 'PLANT_AREA_A')
  })
})

test('invalid, duplicate and missing area writes fail visibly without success journal entries', () => {
  withAreaProject((store, alerts) => {
    const originalAreas = store.areas
    const originalModules = store.modules
    assert.equal(store.createArea(''), false)
    assert.equal(store.createArea('two words'), false)
    assert.equal(store.createArea('feed'), false)
    assert.equal(store.renameArea('FEED', 'REACTOR'), false)
    assert.equal(store.renameArea('MISSING', 'AREA_A'), false)
    assert.equal(store.renameArea('FEED', ''), false)
    assert.equal(useStore.getState().areas, originalAreas)
    assert.equal(useStore.getState().modules, originalModules)
    assert.equal(alerts.length, 6)
    assert.ok(useStore.getState().eventLog.every(e => e.category === 'DIAGNOSTIC'))
    assert.equal(store.renameArea('FEED', 'FEED'), true)
    assert.equal(useStore.getState().areas, originalAreas)
  })
})

test('area configuration requires Can Configure and does not mutate denied operations', () => {
  withAreaProject(store => {
    useSecurity.setState({ currentUser: 'OperatorA', lastDenied: null })
    const before = useStore.getState()
    assert.equal(store.createArea('AREA_A'), false)
    assert.equal(store.renameArea('FEED', 'PLANT_AREA_A'), false)
    assert.equal(useStore.getState(), before)
    assert.match(useSecurity.getState().lastDenied, /Access Denied.*Can Configure/)
  })
})

test('new module, equipment and SFC configuration rejects nonexistent areas and project reset restores defaults', () => {
  withAreaProject((store, alerts) => {
    store.createModule({ tag: 'ORPHAN-DI', type: 'DI', area: 'MISSING', description: 'Training input' })
    store.createEquipmentModule('ORPHAN-EM', 'Training equipment', 'MISSING')
    store.createSfc('ORPHAN-SFC', 'MISSING')
    assert.equal(alerts.length, 3)
    assert.equal(useStore.getState().modules['ORPHAN-DI'], undefined)
    assert.equal(useStore.getState().equipment['ORPHAN-EM'], undefined)
    assert.equal(useStore.getState().sfcs['ORPHAN-SFC'], undefined)
    assert.equal(store.createArea('PLANT_AREA_B'), true)
    store.createEquipmentModule('DV09-EM', 'Training equipment', 'PLANT_AREA_B')
    store.createSfc('DV09-SFC', 'PLANT_AREA_B')
    assert.equal(useStore.getState().equipment['DV09-EM'].area, 'PLANT_AREA_B')
    assert.equal(useStore.getState().sfcs['DV09-SFC'].area, 'PLANT_AREA_B')
    assert.equal(nextAreaName(['AREA1', 'AREA3']), 'AREA2')
    store.newProject('blank')
    assert.ok(!useStore.getState().areas.includes('PLANT_AREA_B'))
    assert.deepEqual(useStore.getState().modules, {})
    assert.deepEqual(useStore.getState().equipment, {})
    assert.deepEqual(useStore.getState().sfcs, {})
  })
})

test('DV09 page 60: controller descriptions support 255 characters and reject 256', () => {
  withAreaProject(store => {
    assert.equal(store.createController('DV09-CTLR', 'x'.repeat(255)), true)
    assert.equal(useStore.getState().hardware.controllers['DV09-CTLR'].description.length, 255)
    assert.equal(store.createController('LONG-CTLR', 'x'.repeat(256)), false)
    assert.equal(useStore.getState().hardware.controllers['LONG-CTLR'], undefined)
  })
})

test('DV09 page 67: identify, network-redundant commission, auto-sense and five-minute cold restart are executable', () => {
  withAreaProject(store => {
    assert.equal(store.decommissionController('CTLR-01'), true)
    assert.equal(store.identifyController('CTLR-01', true), true)
    assert.equal(useStore.getState().hardware.controllers['CTLR-01'].identified, true)
    assert.equal(store.identifyController('CTLR-01', false), true)
    assert.equal(store.setControllerConfiguration('CTLR-01', { networkRedundant: true }), true)
    assert.equal(store.commissionController('CTLR-01'), true)
    let controller = useStore.getState().hardware.controllers['CTLR-01']
    assert.equal(controller.commissioned, true)
    assert.equal(controller.networkRedundant, true)
    assert.ok(controller.controlNetworkAddress)
    assert.equal(controller.lastAutoSense, null)
    assert.equal(store.autoSenseController('CTLR-01'), true)
    controller = useStore.getState().hardware.controllers['CTLR-01']
    assert.ok(controller.lastAutoSense.carriersScanned > 0)
    assert.ok(controller.lastAutoSense.channelsDetected > 0)
    assert.equal(store.setControllerConfiguration('CTLR-01', { coldRestartMinutes: 5 }), true)
    assert.equal(useStore.getState().hardware.controllers['CTLR-01'].coldRestartMinutes, 5)
    assert.equal(store.simulateControllerPowerLoss('CTLR-01'), true)
    store.tick(300)
    assert.equal(store.restoreControllerPower('CTLR-01'), true)
    assert.equal(useStore.getState().hardware.controllers['CTLR-01'].commissioned, true)
  })
})

function withPictureProject(run) {
  const originalPictures = usePictures.getState()
  try {
    withAreaProject((store, alerts) => {
      usePictures.setState({ pictures: { TANK101: { name: 'TANK101', elements: [] } } })
      run(usePictures.getState(), store, alerts)
    })
  } finally {
    usePictures.setState(originalPictures, true)
  }
}

test('DV09 page 136: Previous Ovw_ref.grf and Next alarmList.grf resolve to real displays', () => {
  withPictureProject(pictures => {
    const original = pictures.pictures.TANK101
    assert.equal(pictures.setPictureLinks('TANK101', 'Ovw_ref.grf', 'alarmList.grf'), true)
    const configured = usePictures.getState().pictures.TANK101
    assert.deepEqual(resolvePictureTarget(configured.previousPicture, usePictures.getState().pictures),
      { kind: 'display', display: 'overview' })
    assert.deepEqual(resolvePictureTarget(configured.nextPicture, usePictures.getState().pictures),
      { kind: 'display', display: 'alarms' })
    assert.equal(configured.elements, original.elements)
    assert.equal(original.previousPicture, undefined)
    assert.ok(useStore.getState().eventLog.some(e => e.category === 'CONFIGURE' && e.tag === 'TANK101'))
  })
})

test('custom picture links resolve case-insensitively with optional .grf and blanks remove links', () => {
  withPictureProject(pictures => {
    pictures.createPicture('TANK201')
    assert.equal(pictures.setPictureLinks('TANK101', '', ' tank201.grf '), true)
    assert.deepEqual(resolvePictureTarget('tank201.grf', usePictures.getState().pictures),
      { kind: 'picture', name: 'TANK201' })
    assert.equal(pictures.setPictureLinks('TANK101', '', ''), true)
    assert.equal(usePictures.getState().pictures.TANK101.nextPicture, '')
    assert.equal(resolvePictureTarget('', usePictures.getState().pictures), null)
  })
})

test('missing navigation targets and deleted pictures do not silently navigate or apply partial links', () => {
  withPictureProject((pictures, store, alerts) => {
    const before = usePictures.getState().pictures
    assert.equal(pictures.setPictureLinks('TANK101', 'Ovw_ref.grf', 'MISSING.grf'), false)
    assert.equal(usePictures.getState().pictures, before)
    assert.equal(pictures.setPictureLinks('MISSING', '', ''), false)
    assert.equal(alerts.length, 2)
    assert.ok(useStore.getState().eventLog.every(e => e.category === 'DIAGNOSTIC'))
    pictures.createPicture('TANK201')
    assert.equal(pictures.setPictureLinks('TANK101', '', 'TANK201'), true)
    pictures.deletePicture('TANK201')
    assert.equal(resolvePictureTarget('TANK201', usePictures.getState().pictures), null)
  })
})

test('picture navigation configuration requires Can Configure and preserves denied state', () => {
  withPictureProject(pictures => {
    useSecurity.setState({ currentUser: 'OperatorA' })
    const before = usePictures.getState()
    assert.equal(pictures.setPictureLinks('TANK101', 'Ovw_ref.grf', 'alarmList.grf'), false)
    assert.equal(usePictures.getState(), before)
    assert.match(useSecurity.getState().lastDenied, /Access Denied.*Can Configure/)
  })
})
