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
const { compareAlarmRank, alarmRank, priorityRank, alarmColumnText, alarmParameter, ALARM_COLUMNS } = require('../src/renderer/src/utils/format.ts')
const { findDst, channelConfigurationError, advanceTraditionalIo, sampleAnalogInputs } = require('../src/renderer/src/engine/traditionalIo.ts')
const { useUi } = require('../src/renderer/src/ui/uiStore.ts')
const { savedAoStorageKey } = require('../src/renderer/src/engine/moduleLifecycle.ts')
const { moduleDownloadStatus } = require('../src/renderer/src/engine/downloadStatus.ts')

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
  const savedConfiguration = new Map()
  global.window = { alert: message => alerts.push(message), localStorage: {
    setItem: (key, value) => savedConfiguration.set(key, value),
    getItem: key => savedConfiguration.get(key) ?? null
  } }
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

test('DV09-038/039 arbitrary numeric priority rank (4-15) overrides the class default without changing color/label', () => {
  const base = { id: 'base', moduleTag: 'DV09', type: 'HI', priority: 'ADVISORY',
    time: 1, active: true, acknowledged: false }
  assert.equal(alarmRank({ priority: 'ADVISORY' }), priorityRank('ADVISORY'))
  assert.equal(alarmRank({ priority: 'ADVISORY', rank: 12 }), 12)
  // An ADVISORY alarm with an explicit rank above WARNING's class default (11) outranks it.
  const boostedAdvisory = { ...base, priority: 'ADVISORY', rank: 14 }
  const plainWarning = { ...base, priority: 'WARNING', time: 1 }
  assert.ok(compareAlarmRank(boostedAdvisory, plainWarning) < 0)
  assert.deepEqual([plainWarning, boostedAdvisory].sort(compareAlarmRank), [boostedAdvisory, plainWarning])
  // Two same-class alarms with explicit ranks sort by rank, not just the shared class.
  const lowCritical = { ...base, priority: 'CRITICAL', rank: 5 }
  const highCritical = { ...base, priority: 'CRITICAL', rank: 15 }
  assert.ok(compareAlarmRank(highCritical, lowCritical) < 0)
  // Equal explicit ranks still fall back to the newer-timestamp rule.
  const older = { ...base, priority: 'CRITICAL', rank: 10, time: 1 }
  const newer = { ...base, priority: 'CRITICAL', rank: 10, time: 99 }
  assert.ok(compareAlarmRank(newer, older) < 0)
})

test('DV09-038/039 setAlarmLimit validates and applies an explicit numeric priority rank', () => {
  withAreaProject((store, alerts) => {
    analogCourseProject(store)
    store.setAlarmLimit('LI-101', 'HI', { rank: 3 })
    assert.match(alerts.at(-1), /4 to 15/)
    assert.equal(useStore.getState().modules['LI-101'].alarms.find(a => a.type === 'HI').rank, undefined)
    store.setAlarmLimit('LI-101', 'HI', { rank: 4.5 })
    assert.match(alerts.at(-1), /4 to 15/)
    store.setAlarmLimit('LI-101', 'HI', { rank: 12 })
    assert.equal(useStore.getState().modules['LI-101'].alarms.find(a => a.type === 'HI').rank, 12)
    store.setAlarmLimit('LI-101', 'HI', { rank: null })
    assert.equal(useStore.getState().modules['LI-101'].alarms.find(a => a.type === 'HI').rank, undefined,
      'rank: null clears the explicit override back to the class default')
  })
})

test('DV09-040 alarm list columns expose typed, selectable/reorderable, truthful values', () => {
  const alarm = { id: 'LI-101.HI', moduleTag: 'LI-101', moduleDesc: 'Course tank level', type: 'HI',
    label: 'HI', priority: 'WARNING', rank: 13, value: 950, unit: 'gal',
    active: true, acknowledged: false, time: Date.UTC(2026, 0, 1, 12, 0, 0) }
  const module = { tag: 'LI-101', type: 'AI', description: 'Course tank level', area: 'FEED',
    equipmentModule: 'EM-FEED-SUPPLY', pv: 950, unit: 'gal', pvMin: 0, pvMax: 1000, decimals: 0, alarms: [] }
  assert.equal(alarmColumnText('module', alarm, module), 'LI-101')
  assert.equal(alarmColumnText('description', alarm, module), 'Course tank level')
  assert.equal(alarmColumnText('alarm', alarm, module), 'HI')
  assert.equal(alarmColumnText('value', alarm, module), '950.0 gal')
  assert.equal(alarmColumnText('priority', alarm, module), 'WARNING')
  assert.equal(alarmColumnText('rank', alarm, module), '13')
  assert.equal(alarmColumnText('area', alarm, module), 'FEED')
  assert.equal(alarmColumnText('partOf', alarm, module), 'EM-FEED-SUPPLY')
  assert.equal(alarmColumnText('parameter', alarm, module), 'PV')
  // AI modules carry no controllerTag in this model; Node is truthfully "—", never fabricated.
  assert.equal(alarmColumnText('node', alarm, module), '—')
  // A deployed AO/PID/MOTOR/VALVE module's real controllerTag is shown when present.
  const deployed = { ...module, type: 'AO', controllerTag: 'CTLR-01' }
  assert.equal(alarmColumnText('node', alarm, deployed), 'CTLR-01')
  // An alarm whose module no longer exists (e.g. deleted) never fabricates area/node/part-of.
  assert.equal(alarmColumnText('area', alarm, undefined), '—')
  assert.equal(alarmColumnText('node', alarm, undefined), '—')
  assert.equal(alarmColumnText('partOf', alarm, undefined), '—')
  assert.equal(alarmParameter({ ...alarm, type: 'FAIL' }), 'STATUS')
  assert.equal(alarmParameter({ ...alarm, type: 'CUSTOM' }), '—')
  assert.deepEqual(ALARM_COLUMNS.map(c => c.key),
    ['timeIn', 'module', 'description', 'alarm', 'value', 'priority', 'rank', 'area', 'node', 'partOf', 'parameter'])
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

test('DV09 p265: configured 2.6s filter stays offline until atomic filter-only card transfer', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('LT-1', 0)
    store.setTraditionalInput('FT-2', 0)
    store.tick(0.1)
    assert.equal(store.configureInputFilter('CTRL1/C01', 2, 2.6), true)
    assert.equal(findDst(useStore.getState().hardware, 'FT-2').channel.filterSeconds, undefined)
    store.setTraditionalInput('FT-2', 1000)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LOOP-101'].pv, 1000)
    store.setTraditionalInput('FT-2', 0)
    store.tick(0.1)
    assert.equal(store.downloadInputFilters('CTRL1/C01'), true)
    const before = useStore.getState().hardware
    store.setTraditionalInput('FT-2', 1000)
    store.tick(2.6)
    const next = useStore.getState()
    const signal = findDst(next.hardware, 'FT-2').channel.filteredValue
    assert.ok(Math.abs(signal - 1000 * (1 - Math.exp(-1))) < 1e-9)
    assert.equal(findDst(before, 'FT-2').channel.filteredValue, 0)
    assert.equal(next.modules['LOOP-101'].pv, 0, 'module samples preceding scan readback')
    store.tick(0.1)
    assert.ok(Math.abs(useStore.getState().modules['LOOP-101'].pv - signal) < 1e-9)
    assert.equal(findDst(useStore.getState().hardware, 'LT-1').channel.filterSeconds, 0)
    assert.equal(store.configureInputFilter('CTRL1/C01', 2, 0), true)
    assert.equal(findDst(useStore.getState().hardware, 'FT-2').channel.filterSeconds, 2.6)
    assert.equal(store.downloadInputFilters('CTRL1/C01'), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LOOP-101'].pv, 1000)
  })
})

test('input filter is scan-partition invariant, speed-scaled and holds finite bad-channel memory', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('FT-2', 0)
    store.tick(0.1)
    store.configureInputFilter('CTRL1/C01', 2, 2.6)
    store.downloadInputFilters('CTRL1/C01')
    store.setTraditionalInput('FT-2', 1000)
    const state = useStore.getState()
    const one = advanceTraditionalIo(state.hardware, state.modules, 2.6)
    let split = state.hardware
    for (let i = 0; i < 26; i++) split = advanceTraditionalIo(split, state.modules, 0.1)
    const value = findDst(one, 'FT-2').channel.filteredValue
    assert.ok(Math.abs(findDst(split, 'FT-2').channel.filteredValue - value) < 1e-9)
    useStore.setState({ speed: 2 })
    store.tick(1.3)
    assert.ok(Math.abs(findDst(useStore.getState().hardware, 'FT-2').channel.filteredValue - value) < 1e-9)
    const card = one.traditionalCards['CTRL1/C01']
    const bad = { ...one, traditionalCards: { ...one.traditionalCards,
      [card.id]: { ...card, channels: card.channels.map(c => c.channel === 2 ? { ...c, value: NaN } : c) } } }
    const held = advanceTraditionalIo(bad, state.modules, 10)
    assert.equal(findDst(held, 'FT-2').channel.bad, true)
    assert.equal(findDst(held, 'FT-2').channel.filteredValue, value)
    const modules = { ...state.modules, 'LOOP-101': { ...state.modules['LOOP-101'] } }
    sampleAnalogInputs(held, modules)
    assert.equal(modules['LOOP-101'].pvBad, true)
    const repaired = { ...held, traditionalCards: { ...held.traditionalCards,
      [card.id]: { ...held.traditionalCards[card.id], channels: held.traditionalCards[card.id].channels.map(c =>
        c.channel === 2 ? { ...c, value: 0 } : c) } } }
    const recovered = advanceTraditionalIo(repaired, modules, 2.6)
    assert.equal(findDst(recovered, 'FT-2').channel.bad, false)
    assert.ok(Math.abs(findDst(recovered, 'FT-2').channel.filteredValue - value / Math.E) < 1e-9)
    assert.equal(findDst(advanceTraditionalIo(one, modules, 0), 'FT-2').channel.filteredValue, value)
    for (const dt of [-1, NaN, Infinity]) {
      assert.equal(findDst(advanceTraditionalIo(one, modules, dt), 'FT-2').channel.filteredValue, value)
    }
  })
})

test('input filter rejects invalid configuration, denied keys and unavailable controller atomically', () => {
  withAreaProject((store, alerts) => {
    analogCourseProject(store)
    const before = useStore.getState().hardware
    for (const seconds of [-1, NaN, Infinity]) assert.equal(store.configureInputFilter('CTRL1/C01', 2, seconds), false)
    assert.equal(store.configureInputFilter('CTRL1/C02', 1, 2.6), false)
    assert.equal(store.configureInputFilter('CTRL1/C01', 9, 2.6), false)
    assert.equal(store.downloadInputFilters('MISSING'), false)
    assert.equal(useStore.getState().hardware, before)
    assert.equal(alerts.length, 6)
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.configureInputFilter('CTRL1/C01', 2, 2.6), false)
    assert.equal(store.downloadInputFilters('CTRL1/C01'), false)
    assert.equal(useStore.getState().hardware, before)
    useSecurity.setState({ currentUser: 'admin' })
    store.configureInputFilter('CTRL1/C01', 2, 2.6)
    const configured = useStore.getState().hardware
    const card = configured.traditionalCards['CTRL1/C01']
    const corrupt = { ...configured, traditionalCards: { ...configured.traditionalCards,
      [card.id]: { ...card, channels: card.channels.map(c => c.channel === 1 ?
        { ...c, configuredFilterSeconds: NaN } : c) } } }
    useStore.setState({ hardware: corrupt })
    assert.equal(store.downloadInputFilters(card.id), false)
    assert.equal(useStore.getState().hardware, corrupt, 'invalid other channel cannot partially apply CH2')
    assert.match(alerts.at(-1), /invalid time or readback/)
    useStore.setState({ hardware: configured })
    store.simulateControllerPowerLoss('CTRL1')
    const down = useStore.getState().hardware
    assert.equal(store.downloadInputFilters('CTRL1/C01'), false)
    assert.equal(useStore.getState().hardware, down)
    assert.match(alerts.at(-1), /available commissioned controller/)
  })

})

test('AI filter holds on disabled/controller-down signals and handles extreme finite values without overflow', () => {
  withAreaProject(store => {
    analogCourseProject(store)
    store.setTraditionalInput('FT-2', -1e308)
    store.tick(0.1)
    store.configureInputFilter('CTRL1/C01', 2, 2.6)
    store.downloadInputFilters('CTRL1/C01')
    store.setTraditionalInput('FT-2', 1e308)
    store.tick(2.6)
    const value = findDst(useStore.getState().hardware, 'FT-2').channel.filteredValue
    assert.ok(Number.isFinite(value))
    assert.ok(Math.abs(value / 1e308 - (1 - 2 / Math.E)) < 1e-12)
    store.configureTraditionalChannel('CTRL1/C01', 2, { dst: 'FT-2', enabled: false })
    store.tick(5)
    assert.equal(findDst(useStore.getState().hardware, 'FT-2').channel.filteredValue, value)
    assert.equal(useStore.getState().modules['LOOP-101'].pvBad, true)
    store.configureTraditionalChannel('CTRL1/C01', 2, { dst: 'FT-2', enabled: true })
    store.simulateControllerPowerLoss('CTRL1')
    store.tick(5)
    assert.equal(findDst(useStore.getState().hardware, 'FT-2').channel.filteredValue, value)
    store.restoreControllerPower('CTRL1')
    store.commissionController('CTRL1')
    store.tick(0.1)
    assert.equal(findDst(useStore.getState().hardware, 'FT-2').channel.bad, false)
  })
})

test('AI filter uses percent tieback before receiving scale and reseeds on raw-domain changes', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    store.setTraditionalInput('LT-1', 900)
    store.tick(0.1)
    store.configureInputFilter('CTRL1/C01', 1, 2.6)
    store.downloadInputFilters('CTRL1/C01')
    store.configureTraditionalChannel('CTRL1/C01', 1, { dst: 'LT-1', enabled: true, tiebackDst: 'LY-1' })
    const state = useStore.getState()
    const output = findDst(state.hardware, 'LY-1').channel.value
    assert.equal(findDst(state.hardware, 'LT-1').channel.filteredValue, output)
    store.tick(0.1)
    store.tick(0.1)
    assert.ok(Math.abs(useStore.getState().modules['LI-101'].pv - output * 10) < 1e-9)
  })
})

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
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, true)
    assert.equal(evalCondition({ kind: 'out', tag: 'LEVEL-101', op: '>=', value: 50 }, useStore.getState(), 0), false)
    store.setStandaloneAoMode('LEVEL-101', 'CAS')
    for (let scan = 0; scan < 5; scan++) store.tick(0.1)
    const point = useStore.getState().trend.at(-1)
    assert.equal(point.values['LEVEL-101.PV'], 500)
    assert.equal(point.values['LEVEL-101.SP'], 500)
    assert.equal(point.values['LEVEL-101.OUT'], 50)
  })
})

function savedAoCourseProject(store) {
  standaloneAoCourseProject(store)
  assert.equal(store.enableModuleLifecycle('LEVEL-101'), true)
  assert.equal(store.editModuleDraft('LEVEL-101', { mode: 'CAS', sp: 500,
    parameter: { name: 'CAS_SP', value: 500 } }), true)
  assert.equal(store.saveModuleConfiguration('LEVEL-101'), true)
  assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
  assert.equal(moduleDownloadStatus(useStore.getState(), 'LEVEL-101').status, 'MATCH')
  store.tick(0.1)
}

function secondSavedAo(store) {
  assert.equal(store.createModule({ tag: 'SECOND-AO', type: 'AO', area: 'PLANT_AREA_A',
    description: 'Second controller-owned output', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
  assert.equal(store.bindAnalogDst('SECOND-AO', 'output', 'FY-2'), true)
  assert.equal(store.addAoParameter('SECOND-AO', 'CAS_SP', 250), true)
  assert.equal(store.connectAoParameter('SECOND-AO', 'CAS_SP'), true)
  assert.equal(store.enableModuleLifecycle('SECOND-AO'), true)
  assert.equal(store.editModuleDraft('SECOND-AO', { controllerTag: 'CTRL1', mode: 'CAS' }), true)
  assert.equal(store.saveModuleConfiguration('SECOND-AO'), true)
}

test('controller-owned AO replay restores final Full plus Partial values atomically without incorporating newer saved or draft data', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    secondSavedAo(store)
    assert.equal(store.downloadControllerAos('CTRL1'), true)
    store.editModuleDraft('LEVEL-101', { downloadBehavior: 'ALL' })
    store.saveModuleConfiguration('LEVEL-101')
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setStandaloneAoValue('LEVEL-101', 600)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), true)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 900 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.editModuleDraft('SECOND-AO', { parameter: { name: 'CAS_SP', value: 800 } })
    store.setStandaloneAoValue('LEVEL-101', 700)
    store.setAoParameter('SECOND-AO', 'CAS_SP', 750)
    store.tick(.1)
    const before = useStore.getState()
    const stored = window.localStorage.getItem(savedAoStorageKey('LEVEL-101'))
    const expected = Object.fromEntries(Object.entries(before.moduleLifecycle).map(([tag, r]) => [tag, r.lastGoodDownload]))
    let writes = 0
    const unsubscribe = useStore.subscribe((next, prev) => { if (next.moduleLifecycle !== prev.moduleLifecycle) writes++ })
    assert.equal(store.resendControllerAoDownloads('CTRL1', expected), true)
    unsubscribe()
    const after = useStore.getState()
    assert.equal(writes, 1)
    assert.equal(after.rev, before.rev + 1)
    assert.equal(after.modules['LI-101'], before.modules['LI-101'])
    for (const tag of ['LEVEL-101', 'SECOND-AO']) {
      for (const key of ['saved', 'draft', 'deployed', 'lastGoodDownload', 'restartDownload', 'savedRevision', 'deployedRevision']) {
        assert.equal(after.moduleLifecycle[tag][key], before.moduleLifecycle[tag][key])
      }
    }
    assert.equal(window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), stored)
    assert.equal(moduleDownloadStatus(after, 'LEVEL-101').status, moduleDownloadStatus(before, 'LEVEL-101').status)
    store.tick(.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].mode, 'AUTO')
    assert.equal(useStore.getState().modules['LEVEL-101'].sp, 600)
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 555)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 60)
    assert.equal(useStore.getState().modules['SECOND-AO'].out, 25)
  })
})

test('controller-owned AO replay rejects stale transfer/membership and invalid later member without partial replay', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    secondSavedAo(store)
    store.downloadControllerAos('CTRL1')
    const before = useStore.getState()
    const reviewed = Object.fromEntries(Object.entries(before.moduleLifecycle).map(([tag, r]) => [tag, r.lastGoodDownload]))
    assert.equal(store.resendControllerAoDownloads('CTRL1', { 'LEVEL-101': reviewed['LEVEL-101'] }), false)
    assert.equal(useStore.getState().modules, before.modules)
    store.downloadModule('SECOND-AO', 'FULL')
    const current = useStore.getState()
    assert.equal(store.resendControllerAoDownloads('CTRL1', reviewed), false)
    assert.equal(useStore.getState().modules, current.modules)
    useStore.setState({ moduleLifecycle: { ...current.moduleLifecycle,
      'SECOND-AO': { ...current.moduleLifecycle['SECOND-AO'], replayFullRequired: true } } })
    const invalid = useStore.getState()
    assert.equal(store.resendControllerAoDownloads('CTRL1'), false)
    assert.equal(useStore.getState().modules, invalid.modules)
    assert.equal(useStore.getState().hardware, invalid.hardware)
    assert.equal(useStore.getState().moduleLifecycle, invalid.moduleLifecycle)
    useStore.setState({ moduleLifecycle: { ...current.moduleLifecycle, 'SECOND-AO': {
      ...current.moduleLifecycle['SECOND-AO'], lastGoodDownload: {
        ...current.moduleLifecycle['SECOND-AO'].lastGoodDownload, controllerTag: 'MISSING' } } } })
    const badTarget = useStore.getState()
    assert.equal(store.resendControllerAoDownloads('CTRL1'), false)
    assert.equal(useStore.getState().modules, badTarget.modules)
    assert.equal(useStore.getState().moduleLifecycle, badTarget.moduleLifecycle)
  })
})

test('controller-owned AO replay follows deployed ownership, excludes unsent new modules and enforces availability/access/recommission guards', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.createController('OTHER', 'Later database assignment')
    store.commissionController('OTHER')
    store.editModuleDraft('LEVEL-101', { controllerTag: 'OTHER' })
    store.saveModuleConfiguration('LEVEL-101')
    secondSavedAo(store)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 700)
    store.tick(.1)
    const before = useStore.getState()
    assert.equal(store.resendControllerAoDownloads('MISSING'), false)
    assert.equal(store.resendControllerAoDownloads('OTHER'), false)
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.resendControllerAoDownloads('CTRL1'), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.resendControllerAoDownloads('CTRL1'), false)
    useSecurity.setState({ locked: false })
    useStore.setState({ hardware: { ...before.hardware, controllers: { ...before.hardware.controllers,
      CTRL1: { ...before.hardware.controllers.CTRL1, primary: 'FAILED', secondary: 'FAILED' } } } })
    assert.equal(store.resendControllerAoDownloads('CTRL1'), false)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    useStore.setState({ hardware: before.hardware })
    assert.equal(store.resendControllerAoDownloads('CTRL1'), true)
    assert.equal(useStore.getState().modules['SECOND-AO'], before.modules['SECOND-AO'])
    store.tick(.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(useStore.getState().modules['LEVEL-101'].controllerTag, 'CTRL1')
    assert.deepEqual(useStore.getState().modules['SECOND-AO'], before.modules['SECOND-AO'])
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].saved.controllerTag, 'OTHER')
    store.decommissionController('CTRL1')
    store.commissionController('CTRL1')
    const recommissioned = useStore.getState()
    assert.equal(store.resendControllerAoDownloads('CTRL1'), false)
    assert.equal(useStore.getState().modules, recommissioned.modules)
    assert.equal(useStore.getState().moduleLifecycle, recommissioned.moduleLifecycle)
  })
})

test('controller-scoped AO Full transfer commits every saved module once without downloading other algorithms', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    secondSavedAo(store)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 700)
    store.tick(.1)
    const before = useStore.getState()
    const expected = Object.fromEntries(Object.entries(before.moduleLifecycle).map(([tag, record]) => [tag, record.saved]))
    const stored = window.localStorage.getItem(savedAoStorageKey('LEVEL-101'))
    let writes = 0
    const unsubscribe = useStore.subscribe((next, previous) => {
      if (next.moduleLifecycle !== previous.moduleLifecycle) writes++
    })
    assert.equal(store.downloadControllerAos('CTRL1', expected), true)
    unsubscribe()
    const after = useStore.getState()
    assert.equal(writes, 1)
    assert.equal(after.rev, before.rev + 1)
    assert.equal(after.modules['LI-101'], before.modules['LI-101'])
    assert.equal(after.sfcs, before.sfcs)
    assert.equal(after.pidLifecycle, before.pidLifecycle)
    assert.equal(after.deviceLifecycle, before.deviceLifecycle)
    assert.equal(after.sfcLifecycle, before.sfcLifecycle)
    assert.equal(window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), stored)
    for (const tag of ['LEVEL-101', 'SECOND-AO']) {
      assert.equal(after.moduleLifecycle[tag].saved, before.moduleLifecycle[tag].saved)
      assert.equal(after.moduleLifecycle[tag].draft, before.moduleLifecycle[tag].draft)
      assert.equal(after.moduleLifecycle[tag].deployedRevision, before.moduleLifecycle[tag].savedRevision)
      assert.equal(moduleDownloadStatus(after, tag).status, 'MATCH')
    }
    store.tick(.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(useStore.getState().modules['SECOND-AO'].out, 25)
  })
})

test('controller-scoped AO Full rejects the whole batch for invalid member, changed scope or changed saved revision', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    const first = useStore.getState().moduleLifecycle['LEVEL-101'].saved
    secondSavedAo(store)
    const expected = { 'LEVEL-101': first, 'SECOND-AO': useStore.getState().moduleLifecycle['SECOND-AO'].saved }
    const before = useStore.getState()
    assert.equal(store.downloadControllerAos('CTRL1', { 'LEVEL-101': first }), false)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    store.editModuleDraft('SECOND-AO', { parameter: { name: 'CAS_SP', value: 900 } })
    const dirty = useStore.getState()
    assert.equal(store.downloadControllerAos('CTRL1', expected), false)
    assert.equal(useStore.getState().modules, dirty.modules)
    assert.equal(useStore.getState().hardware, dirty.hardware)
    assert.equal(useStore.getState().moduleLifecycle, dirty.moduleLifecycle)
    store.saveModuleConfiguration('SECOND-AO')
    const saved = useStore.getState()
    assert.equal(store.downloadControllerAos('CTRL1', expected), false)
    assert.equal(useStore.getState().modules, saved.modules)
    assert.equal(useStore.getState().moduleLifecycle, saved.moduleLifecycle)
    assert.equal(store.downloadControllerAos('CTRL1'), true)
    store.tick(.1)
    assert.equal(useStore.getState().modules['SECOND-AO'].out, 90)
  })
})

test('controller-scoped AO Full rejects missing/down/empty/locked/denied controllers and refreshes opted-in replay memory', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), true)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 400 } })
    store.saveModuleConfiguration('LEVEL-101')
    const before = useStore.getState()
    assert.equal(store.downloadControllerAos('MISSING'), false)
    store.createController('EMPTY', 'No managed AO scope')
    store.commissionController('EMPTY')
    assert.equal(store.downloadControllerAos('EMPTY'), false)
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.downloadControllerAos('CTRL1'), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.downloadControllerAos('CTRL1'), false)
    useSecurity.setState({ locked: false })
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      CTRL1: { ...hardware.controllers.CTRL1, primary: 'FAILED', secondary: 'FAILED' } } } })
    assert.equal(store.downloadControllerAos('CTRL1'), false)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    useStore.setState({ hardware })
    assert.equal(store.downloadControllerAos('CTRL1'), true)
    const record = useStore.getState().moduleLifecycle['LEVEL-101']
    assert.equal(record.lastGoodDownload.module.parameters.CAS_SP.value, 400)
    assert.equal(record.restartDownload.module.parameters.CAS_SP.value, 400)
    assert.equal(record.restartMemoryRequired, false)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 700)
    store.tick(.1)
    assert.equal(store.restartModule('LEVEL-101'), true)
    store.tick(.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 40)
  })
})

test('AO download verification is read-only and stale confirmation cannot transfer newer saved configuration', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 600 } })
    store.saveModuleConfiguration('LEVEL-101')
    const before = useStore.getState()
    const expected = before.moduleLifecycle['LEVEL-101'].saved
    const stored = window.localStorage.getItem(savedAoStorageKey('LEVEL-101'))
    assert.equal(store.verifyAoDownload('LEVEL-101', 'PARTIAL'), true)
    const verified = useStore.getState()
    for (const key of ['modules', 'hardware', 'moduleLifecycle', 'sfcs', 'downloadStatusChecks']) {
      assert.equal(verified[key], before[key])
    }
    assert.equal(window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), stored)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 900 } })
    store.saveModuleConfiguration('LEVEL-101')
    const current = useStore.getState()
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL', expected), false)
    assert.equal(useStore.getState().modules, current.modules)
    assert.equal(useStore.getState().moduleLifecycle, current.moduleLifecycle)
    assert.equal(store.verifyAoDownload('LEVEL-101', 'PARTIAL'), true)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL', current.moduleLifecycle['LEVEL-101'].saved), true)
    store.tick(.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 90)
    assert.ok(useStore.getState().eventLog.some(event => event.description.includes('verification passed')))
  })
})

test('verified AO downloads recheck targets, dirty drafts, permission and lock before committing', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    const expected = useStore.getState().moduleLifecycle['LEVEL-101'].saved
    assert.equal(store.verifyAoDownload('LEVEL-101', 'FULL'), true)
    const before = useStore.getState()
    const hardware = before.hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      CTRL1: { ...hardware.controllers.CTRL1, primary: 'FAILED', secondary: 'FAILED' } } } })
    assert.equal(store.downloadModule('LEVEL-101', 'FULL', expected), false)
    assert.equal(store.verifyAoDownload('LEVEL-101', 'FULL'), false)
    useStore.setState({ hardware })
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.verifyAoDownload('LEVEL-101', 'FULL'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL', expected), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.verifyAoDownload('LEVEL-101', 'FULL'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL', expected), false)
    useSecurity.setState({ locked: false })
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 700 } })
    const dirty = useStore.getState()
    assert.equal(store.downloadModule('LEVEL-101', 'FULL', expected), false)
    assert.equal(store.verifyAoDownload('LEVEL-101', 'FULL'), false)
    assert.equal(useStore.getState().modules, dirty.modules)
    assert.equal(useStore.getState().moduleLifecycle, dirty.moduleLifecycle)
  })
})

test('p97 AO restart-memory-only update captures last transfers, not newer saved or working values, and powers real restart', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { downloadBehavior: 'ALL' })
    store.saveModuleConfiguration('LEVEL-101')
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setStandaloneAoValue('LEVEL-101', 600)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    store.downloadModule('LEVEL-101', 'PARTIAL')
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 900 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 777)
    const before = useStore.getState()
    const record = before.moduleLifecycle['LEVEL-101']
    const stored = window.localStorage.getItem(savedAoStorageKey('LEVEL-101'))
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), true)
    const after = useStore.getState()
    assert.equal(after.modules, before.modules)
    assert.equal(after.hardware, before.hardware)
    assert.equal(after.sfcs, before.sfcs)
    const memory = after.moduleLifecycle['LEVEL-101']
    for (const key of ['draft', 'saved', 'deployed', 'nvm', 'lastGoodDownload']) assert.equal(memory[key], record[key])
    assert.notEqual(memory.restartDownload, record.lastGoodDownload)
    assert.deepEqual([memory.restartDownload.module.mode, memory.restartDownload.module.sp,
      memory.restartDownload.module.parameters.CAS_SP.value], ['AUTO', 600, 555])
    assert.equal(window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), stored)
    assert.equal(store.restartModule('LEVEL-101'), true)
    assert.deepEqual([useStore.getState().modules['LEVEL-101'].mode,
      useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value], ['AUTO', 555])
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].saved.module.parameters.CAS_SP.value, 900)
    store.tick(.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 60)
  })
})

test('opt-in AO restart snapshot requires refresh after Partial; Full refreshes and power recovery consumes it', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.updateControllerAoRestartMemory('CTRL1')
    const initialMemory = useStore.getState().moduleLifecycle['LEVEL-101'].restartDownload
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 800 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.downloadModule('LEVEL-101', 'PARTIAL')
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].restartDownload, initialMemory)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].restartMemoryRequired, true)
    const runtime = useStore.getState().modules['LEVEL-101']
    assert.equal(store.restartModule('LEVEL-101'), false)
    assert.equal(useStore.getState().modules['LEVEL-101'], runtime)
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), true)
    assert.equal(store.restartModule('LEVEL-101'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 800)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 400 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.downloadModule('LEVEL-101', 'FULL')
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].restartDownload.module.parameters.CAS_SP.value, 400)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].restartMemoryRequired, false)
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      CTRL1: { ...hardware.controllers.CTRL1, coldRestartMinutes: 5 } } } })
    store.setAoParameter('LEVEL-101', 'CAS_SP', 700)
    assert.equal(store.simulateControllerPowerLoss('CTRL1'), true)
    assert.equal(store.restoreControllerPower('CTRL1'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 400)
    assert.equal(store.decommissionController('CTRL1'), true)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].restartDownload, undefined)
  })
})

test('AO memory update rejects missing/empty/down/locked/denied controllers atomically', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    const before = useStore.getState()
    assert.equal(store.updateControllerAoRestartMemory('MISSING'), false)
    const hardware = before.hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      CTRL1: { ...hardware.controllers.CTRL1, primary: 'FAILED', secondary: 'FAILED' } } } })
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), false)
    useStore.setState({ hardware })
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), false)
    useSecurity.setState({ locked: false })
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    assert.equal(useStore.getState().modules, before.modules)
    store.createController('EMPTY-CTRL', 'No managed AO')
    store.commissionController('EMPTY-CTRL')
    assert.equal(store.updateControllerAoRestartMemory('EMPTY-CTRL'), false)
    const record = useStore.getState().moduleLifecycle['LEVEL-101']
    useStore.setState({ moduleLifecycle: { ...useStore.getState().moduleLifecycle,
      'SECOND-AO': { ...record, lastGoodDownload: undefined } } })
    const recordsBefore = useStore.getState().moduleLifecycle
    assert.equal(store.updateControllerAoRestartMemory('CTRL1'), false,
      'one invalid owned module rejects the entire memory update')
    assert.equal(useStore.getState().moduleLifecycle, recordsBefore)
  })
})

test('p98 AO last-good replay excludes subsequent saved/draft edits and restores actual transferred defaults only', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    const snapshot = useStore.getState().moduleLifecycle['LEVEL-101'].lastGoodDownload
    assert.equal(snapshot.module.parameters.CAS_SP.value, 500)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 900 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 950 } })
    store.setAoParameter('LEVEL-101', 'CAS_SP', 700)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 70)
    const before = useStore.getState()
    const stored = window.localStorage.getItem(savedAoStorageKey('LEVEL-101'))
    assert.ok(stored)
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), true)
    const after = useStore.getState()
    const record = after.moduleLifecycle['LEVEL-101']
    assert.equal(record.saved, before.moduleLifecycle['LEVEL-101'].saved)
    assert.equal(record.draft, before.moduleLifecycle['LEVEL-101'].draft)
    assert.equal(record.deployed, before.moduleLifecycle['LEVEL-101'].deployed)
    assert.equal(record.lastGoodDownload, snapshot)
    assert.equal(record.savedRevision, before.moduleLifecycle['LEVEL-101'].savedRevision)
    assert.equal(record.deployedRevision, before.moduleLifecycle['LEVEL-101'].deployedRevision)
    assert.equal(record.draft.module.parameters.CAS_SP.value, 950)
    assert.equal(record.saved.module.parameters.CAS_SP.value, 900)
    assert.equal(window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), stored)
    for (const [tag, module] of Object.entries(before.modules)) {
      if (tag !== 'LEVEL-101') assert.equal(after.modules[tag], module)
    }
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(snapshot.module.parameters.CAS_SP.value, 500)
  })
})

test('p98 Full plus Partial replay captures preserved block/user values at transfer, not later live or saved values', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { downloadBehavior: 'ALL' })
    store.saveModuleConfiguration('LEVEL-101')
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setStandaloneAoValue('LEVEL-101', 600)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), true)
    const snapshot = useStore.getState().moduleLifecycle['LEVEL-101'].lastGoodDownload
    assert.deepEqual([snapshot.module.mode, snapshot.module.sp, snapshot.module.parameters.CAS_SP.value], ['AUTO', 600, 555])
    const configured = useStore.getState().moduleLifecycle['LEVEL-101'].saved
    assert.equal(configured.module.parameters.CAS_SP.value, 500)
    store.setStandaloneAoMode('LEVEL-101', 'CAS')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 888)
    store.tick(0.1)
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), true)
    assert.deepEqual([useStore.getState().modules['LEVEL-101'].mode,
      useStore.getState().modules['LEVEL-101'].sp,
      useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value], ['AUTO', 600, 555])
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 60)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].saved, configured)
  })
})

test('last-good replay failures preserve runtime/snapshot and recommission requires a fresh Full, not Partial or replay', () => {
  withAreaProject((store, alerts) => {
    assert.equal(store.resendLastGoodModuleDownload('MISSING'), false)
    savedAoCourseProject(store)
    const before = useStore.getState()
    useStore.setState({ hardware: { ...before.hardware, controllers: { ...before.hardware.controllers,
      CTRL1: { ...before.hardware.controllers.CTRL1, primary: 'FAILED', secondary: 'FAILED' } } } })
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), false)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    useStore.setState({ hardware: before.hardware })
    useSecurity.setState({ currentUser: 'OperatorA', locked: false })
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), false)
    useSecurity.setState({ locked: false })
    assert.equal(store.decommissionController('CTRL1'), true)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].lastGoodDownload, undefined)
    assert.equal(store.commissionController('CTRL1'), true)
    assert.equal(moduleDownloadStatus(useStore.getState(), 'LEVEL-101').status, 'NO_CONFIGURATION')
    assert.equal(useStore.getState().modules['LEVEL-101'].downloaded, false)
    assert.equal(store.setModuleOnline('LEVEL-101', true), false)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', 800), false)
    const recommissioned = useStore.getState().hardware
    useStore.setState({ hardware: { ...recommissioned, controllers: { ...recommissioned.controllers,
      CTRL1: { ...recommissioned.controllers.CTRL1, coldRestartMinutes: 5 } } } })
    assert.equal(store.simulateControllerPowerLoss('CTRL1'), true)
    assert.equal(store.restoreControllerPower('CTRL1'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].downloaded, false,
      'power recovery must not bypass the fresh-Full requirement')
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    assert.equal(store.resendLastGoodModuleDownload('LEVEL-101'), true)
    assert.ok(alerts.length >= 4)
  })
})

test('saved AO lifecycle is opt-in: enrollment holds, Save does not execute, Full download activates', () => {
  withAreaProject(store => {
    standaloneAoCourseProject(store)
    assert.equal(store.enableModuleLifecycle('LEVEL-101'), true)
    let state = useStore.getState()
    const record = state.moduleLifecycle['LEVEL-101']
    assert.equal(record.online, false)
    assert.equal(record.saved, undefined)
    assert.equal(state.modules['LEVEL-101'].downloaded, false)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', 800), false)
    assert.equal(store.setModuleOnline('LEVEL-101', true), false)
    assert.equal(store.uploadModule('LEVEL-101'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    assert.equal(store.setModuleOnline('LEVEL-101', true), false)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 50)
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, true)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 800 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.tick(0.1)
    state = useStore.getState()
    assert.equal(state.modules['LEVEL-101'].parameters.CAS_SP.value, 500)
    assert.equal(state.modules['LEVEL-101'].out, 50)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    store.tick(0.1)
    state = useStore.getState()
    assert.equal(state.modules['LEVEL-101'].out, 80)
    assert.equal(state.modules['LEVEL-101'].controllerTag, 'CTRL1')
    assert.equal(state.moduleLifecycle['LEVEL-101'].deployedRevision, 1)
    assert.equal(record.draft.module.parameters.CAS_SP.value, 500)
  })
})

test('DV09 p170 exact partial download outcomes: configured CAS500, critical AUTO500, all AUTO555', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    for (const [behavior, mode, value] of [['CONFIGURED', 'CAS', 500], ['CRITICAL', 'AUTO', 500],
      ['ALL', 'AUTO', 555]]) {
      store.setModuleOnline('LEVEL-101', false)
      assert.equal(store.editModuleDraft('LEVEL-101', { downloadBehavior: behavior }), true)
      assert.equal(store.saveModuleConfiguration('LEVEL-101'), true)
      store.setStandaloneAoMode('LEVEL-101', 'AUTO')
      store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
      store.tick(0.1)
      assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), true)
      const m = useStore.getState().modules['LEVEL-101']
      assert.deepEqual([m.mode, m.parameters.CAS_SP.value], [mode, value])
      const saved = useStore.getState().moduleLifecycle['LEVEL-101'].saved
      assert.deepEqual([saved.module.mode, saved.module.parameters.CAS_SP.value], ['CAS', 500])
    }
  })
})

test('Full download always applies configured values even when preservation policy is ALL', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { downloadBehavior: 'ALL' })
    store.saveModuleConfiguration('LEVEL-101')
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    assert.deepEqual([useStore.getState().modules['LEVEL-101'].mode,
      useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value], ['CAS', 500])
  })
})

test('offline AO edits and FBD/binding draft changes do not affect last-good runtime until download', () => {
  withAreaProject(store => {
    const { lifecycleDirty, lifecycleModules } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    const before = useStore.getState()
    assert.equal(store.addAoParameter('LEVEL-101', 'SECOND', 800), true)
    assert.equal(store.connectAoParameter('LEVEL-101', 'SECOND'), true)
    assert.equal(store.bindAnalogDst('LEVEL-101', 'output', 'FY-2'), true)
    let state = useStore.getState()
    assert.equal(state.hardware.analogBindings['LEVEL-101'].output, 'LY-1')
    assert.equal(state.modules['LEVEL-101'].casParameter, 'CAS_SP')
    assert.equal(state.modules['LEVEL-101'].parameters.SECOND, undefined)
    assert.equal(lifecycleModules(state)['LEVEL-101'].casParameter, 'SECOND')
    assert.equal(lifecycleDirty(state.moduleLifecycle['LEVEL-101']), true)
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    store.saveModuleConfiguration('LEVEL-101')
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), true)
    store.tick(0.1)
    state = useStore.getState()
    assert.equal(state.hardware.analogBindings['LEVEL-101'].output, 'FY-2')
    assert.equal(state.modules['LEVEL-101'].out, 80)
    assert.equal(findDst(state.hardware, 'FY-2').channel.value, 80)
    assert.equal(before.moduleLifecycle['LEVEL-101'].saved.module.parameters.SECOND, undefined)
    assert.equal(before.modules['LEVEL-101'].casParameter, 'CAS_SP')
  })
})

test('download verifies assignment, ownership and available controller without partially changing runtime', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.createController('CTRL2', 'Other assignment')
    store.commissionController('CTRL2')
    store.editModuleDraft('LEVEL-101', { controllerTag: 'CTRL2' })
    store.saveModuleConfiguration('LEVEL-101')
    let before = useStore.getState()
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    assert.equal(useStore.getState().modules['LEVEL-101'], before.modules['LEVEL-101'])
    assert.equal(useStore.getState().hardware, before.hardware)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].deployedRevision, 1)
    store.editModuleDraft('LEVEL-101', { controllerTag: 'CTRL1' })
    store.saveModuleConfiguration('LEVEL-101')
    store.simulateControllerPowerLoss('CTRL1')
    before = useStore.getState()
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    assert.equal(useStore.getState().modules['LEVEL-101'], before.modules['LEVEL-101'])
    store.restoreControllerPower('CTRL1')
    store.commissionController('CTRL1')
    store.createModule({ tag: 'OTHER-WRITER', type: 'AO', area: 'PLANT_AREA_A', description: 'Collision' })
    store.bindAnalogDst('OTHER-WRITER', 'output', 'FY-2')
    store.editModuleDraft('LEVEL-101', { outputDst: 'FY-2' })
    store.saveModuleConfiguration('LEVEL-101')
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), false)
    assert.equal(useStore.getState().hardware.analogBindings['LEVEL-101'].output, 'LY-1')
  })
})

test('online mode displays runtime and rejects offline configuration changes; operators do not alter saved defaults', () => {
  withAreaProject(store => {
    const { lifecycleModules } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    assert.equal(store.setModuleOnline('LEVEL-101', true), true)
    assert.equal(lifecycleModules(useStore.getState(), 'LEVEL-101'), useStore.getState().modules)
    const before = useStore.getState().moduleLifecycle['LEVEL-101']
    assert.equal(store.configureStandaloneAo('LEVEL-101', { spHigh: 900 }), false)
    assert.equal(store.bindAnalogDst('LEVEL-101', 'output', 'FY-2'), false)
    assert.equal(store.addAoParameter('LEVEL-101', 'OTHER', 500), false)
    assert.equal(store.connectAoParameter('LEVEL-101', undefined), false)
    assert.equal(store.saveModuleConfiguration('LEVEL-101'), false)
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    store.tick(0.1)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].saved.module.parameters.CAS_SP.value, 500)
    assert.equal(before.saved.module.mode, 'CAS')
    assert.equal(useStore.getState().modules['LEVEL-101'].mode, 'AUTO')
    store.setModuleOnline('LEVEL-101', false)
    assert.equal(lifecycleModules(useStore.getState(), 'LEVEL-101')['LEVEL-101'],
      useStore.getState().moduleLifecycle['LEVEL-101'].draft.module)
  })
})

test('DV09 p169 cold restart restores only when both deployed module and parameter flags are checked', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    for (const [restoreModule, restoreParameters, expected] of [
      [false, [], 500], [true, [], 500], [false, ['CAS_SP'], 500], [true, ['CAS_SP'], 555]
    ]) {
      store.setModuleOnline('LEVEL-101', false)
      store.editModuleDraft('LEVEL-101', { restoreModule, restoreParameters })
      store.saveModuleConfiguration('LEVEL-101')
      store.downloadModule('LEVEL-101', 'FULL')
      store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
      store.tick(0.1)
      assert.equal(store.restartModule('LEVEL-101'), true)
      store.tick(0.1)
      assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, expected)
      assert.ok(Math.abs(useStore.getState().modules['LEVEL-101'].out - expected / 10) < 1e-9)
    }
  })
})

test('saved but undownloaded restart flags/defaults cannot change deployed NVM behavior', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    store.tick(0.1)
    store.editModuleDraft('LEVEL-101', { restoreModule: true, restoreParameters: ['CAS_SP'],
      parameter: { name: 'CAS_SP', value: 800 } })
    store.saveModuleConfiguration('LEVEL-101')
    assert.equal(store.restartModule('LEVEL-101'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 500)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].saved.module.parameters.CAS_SP.value, 800)
  })
})

test('controller power-loss restart uses assigned AO NVM and timeout requires a fresh download', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { restoreModule: true, restoreParameters: ['CAS_SP'] })
    store.saveModuleConfiguration('LEVEL-101')
    store.downloadModule('LEVEL-101', 'FULL')
    store.setControllerConfiguration('CTRL1', { coldRestartMinutes: 5 })
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    store.simulateControllerPowerLoss('CTRL1')
    store.tick(0.1)
    store.restoreControllerPower('CTRL1')
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 555)
    store.setControllerConfiguration('CTRL1', { coldRestartMinutes: 0 })
    store.simulateControllerPowerLoss('CTRL1')
    store.restoreControllerPower('CTRL1')
    assert.equal(useStore.getState().modules['LEVEL-101'].downloaded, false)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].nvm, undefined)
    store.commissionController('CTRL1')
    store.setControllerConfiguration('CTRL1', { coldRestartMinutes: 5 })
    store.simulateControllerPowerLoss('CTRL1')
    store.restoreControllerPower('CTRL1')
    assert.equal(useStore.getState().modules['LEVEL-101'].downloaded, false)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, true)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', 800), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].bad, false)
  })
})

test('upload captures online values into a separate unsaved draft without overwriting configuration', () => {
  withAreaProject(store => {
    const { lifecycleDirty } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    store.setModuleOnline('LEVEL-101', true)
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    const before = useStore.getState()
    assert.equal(store.uploadModule('LEVEL-101'), true)
    const record = useStore.getState().moduleLifecycle['LEVEL-101']
    assert.deepEqual([record.draft.module.mode, record.draft.module.parameters.CAS_SP.value], ['AUTO', 555])
    assert.deepEqual([record.saved.module.mode, record.saved.module.parameters.CAS_SP.value], ['CAS', 500])
    assert.equal(record.online, false)
    assert.equal(lifecycleDirty(record), true)
    assert.equal(useStore.getState().modules['LEVEL-101'], before.modules['LEVEL-101'])
  })
})

test('DV09-060 generic selective AO parameter upload writes only chosen parameters into the draft', () => {
  withAreaProject(store => {
    const { changedAoParameters, lifecycleDirty } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    store.setModuleOnline('LEVEL-101', true)
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 555)
    const runtime = () => useStore.getState().modules['LEVEL-101']
    assert.deepEqual(changedAoParameters(useStore.getState().moduleLifecycle['LEVEL-101'], runtime()), ['CAS_SP'])
    assert.equal(store.uploadAoParameters('LEVEL-101', ['MISSING_PARAM']), false,
      'an unsupported parameter name rejects the whole selection')
    assert.equal(store.uploadAoParameters('LEVEL-101', []), true, 'selecting none is a safe no-op')
    let record = useStore.getState().moduleLifecycle['LEVEL-101']
    assert.equal(record.draft.module.parameters.CAS_SP.value, 500, 'selecting none leaves the draft unchanged')
    const before = useStore.getState()
    assert.equal(store.uploadAoParameters('LEVEL-101', ['CAS_SP']), true)
    record = useStore.getState().moduleLifecycle['LEVEL-101']
    assert.equal(record.draft.module.parameters.CAS_SP.value, 555, 'selected parameter is uploaded into the draft')
    assert.equal(record.draft.module.mode, 'CAS',
      'unselected draft fields (mode) are untouched, unlike the blanket Upload to Draft')
    assert.deepEqual([record.saved.module.mode, record.saved.module.parameters.CAS_SP.value], ['CAS', 500],
      'saved configuration is unaffected; Save is still required to persist the draft')
    assert.equal(record.online, true, 'selective parameter upload does not force the module offline')
    assert.equal(lifecycleDirty(record), true)
    assert.equal(useStore.getState().modules['LEVEL-101'], before.modules['LEVEL-101'])
    assert.equal(store.uploadAoParameters('LEVEL-101', ['CAS_SP']), true,
      'an already-matching selection is a safe no-op')
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].draft.module.parameters.CAS_SP.value, 555)
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.uploadAoParameters('LEVEL-101', ['CAS_SP']), false)
    useSecurity.setState({ currentUser: 'admin' })
  })
})

test('module lifecycle requires configuration/download keys and cleans all state on deletion/reset', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    const before = useStore.getState().moduleLifecycle['LEVEL-101']
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.editModuleDraft('LEVEL-101', { mode: 'MAN' }), false)
    assert.equal(store.saveModuleConfiguration('LEVEL-101'), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), false)
    assert.equal(store.uploadModule('LEVEL-101'), false)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'], before)
    useSecurity.setState({ currentUser: 'admin' })
    store.deleteModule('LEVEL-101')
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'], undefined)
    savedAoCourseProject(store)
    store.newProject('pharma')
    assert.deepEqual(useStore.getState().moduleLifecycle, {})
    assert.equal(useStore.getState().modules['XV-101'].type, 'VALVE')
  })
})

test('persistent AO configuration survives a new project without reactivating runtime automatically', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 750 } })
    store.saveModuleConfiguration('LEVEL-101')
    store.newProject('blank')
    store.createArea('PLANT_AREA_A')
    store.createController('CTRL1', 'Restored prerequisites')
    store.commissionController('CTRL1')
    store.addTraditionalCard('CTRL1', 2, 'AO')
    store.configureTraditionalChannel('CTRL1/C02', 1, { dst: 'LY-1', enabled: true })
    store.createModule({ tag: 'LEVEL-101', type: 'AO', area: 'PLANT_AREA_A', description: 'Reopened',
      pvMin: 0, pvMax: 1000, unit: 'gal' })
    store.enableModuleLifecycle('LEVEL-101')
    assert.equal(store.loadSavedModuleConfiguration('LEVEL-101'), true)
    const record = useStore.getState().moduleLifecycle['LEVEL-101']
    assert.equal(record.saved.module.parameters.CAS_SP.value, 750)
    assert.equal(record.deployed, undefined)
    assert.equal(useStore.getState().modules['LEVEL-101'].downloaded, false)
    assert.equal(store.setModuleOnline('LEVEL-101', true), false)
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 75)
  })
})

test('persistent Save failure reports error without marking draft saved or changing runtime', () => {
  withAreaProject((store, alerts) => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { parameter: { name: 'CAS_SP', value: 750 } })
    const before = useStore.getState()
    global.window.localStorage.setItem = () => { throw new Error('Storage quota exceeded') }
    assert.equal(store.saveModuleConfiguration('LEVEL-101'), false)
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'], before.moduleLifecycle['LEVEL-101'])
    assert.equal(useStore.getState().modules['LEVEL-101'], before.modules['LEVEL-101'])
    assert.match(alerts.at(-1), /Save failed.*quota/)
  })
})

test('saved AO schema validation rejects corrupt, nonfinite, wrong-tag and stale parameter data', () => {
  withAreaProject((store, alerts) => {
    const { parseSavedAo, savedAoStorageKey } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    const valid = global.window.localStorage.getItem(savedAoStorageKey('LEVEL-101'))
    assert.equal(parseSavedAo(valid, 'LEVEL-101').module.type, 'AO')
    assert.throws(() => parseSavedAo(valid, 'WRONG-TAG'), /tag/)
    assert.throws(() => parseSavedAo('{', 'LEVEL-101'))
    for (const modify of [
      d => { d.version = 99 },
      d => { d.configuration.module.parameters.CAS_SP.value = null },
      d => { d.configuration.module.pvMax = 0 },
      d => { d.configuration.module.decimals = -1 },
      d => { d.configuration.module.alarms = [{ type: 'UNKNOWN', label: 'Invalid', enabled: true, priority: 'CRITICAL' }] },
      d => { d.configuration.module.casParameter = 'MISSING' },
      d => { d.configuration.restoreParameters = ['MISSING'] }
    ]) {
      const data = JSON.parse(valid)
      modify(data)
      global.window.localStorage.setItem(savedAoStorageKey('LEVEL-101'), JSON.stringify(data))
      const before = useStore.getState()
      assert.equal(store.loadSavedModuleConfiguration('LEVEL-101'), false)
      assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'], before.moduleLifecycle['LEVEL-101'])
      assert.equal(useStore.getState().modules['LEVEL-101'], before.modules['LEVEL-101'])
      assert.match(alerts.at(-1), /Load failed/)
    }
    const alarmConfig = JSON.parse(valid)
    alarmConfig.configuration.module.alarms = [{ type: 'PVBAD', label: 'PV BAD', enabled: true, priority: 'WARNING' }]
    assert.equal(parseSavedAo(JSON.stringify(alarmConfig), 'LEVEL-101').module.alarms[0].label, 'PV BAD')
  })
})

test('critical SP and manual-output restart restoration are individually selected and snapshots remain independent', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { restoreModule: true, restoreParameters: ['AO1/SP', 'AO1/OUT', 'AO1/MODE'] })
    store.saveModuleConfiguration('LEVEL-101')
    store.downloadModule('LEVEL-101', 'FULL')
    const before = useStore.getState().moduleLifecycle['LEVEL-101']
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.setStandaloneAoValue('LEVEL-101', 700)
    store.setStandaloneAoMode('LEVEL-101', 'MAN')
    store.setStandaloneAoValue('LEVEL-101', 25)
    store.tick(0.1)
    store.restartModule('LEVEL-101')
    store.tick(0.1)
    const m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.mode, m.sp, m.manualOutput, m.out], ['MAN', 700, 25, 25])
    assert.equal(before.saved.module.mode, 'CAS')
    assert.equal(before.saved.module.sp, 500)
    assert.equal(before.nvm.mode, 'CAS')
  })
})

test('OUT restart restoration uses the live OUT CV rather than inactive manual settings in CAS', () => {
  withAreaProject(store => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { mode: 'MAN', manualOutput: 10,
      restoreModule: true, restoreParameters: ['AO1/OUT'] })
    store.saveModuleConfiguration('LEVEL-101')
    store.downloadModule('LEVEL-101', 'FULL')
    store.setStandaloneAoMode('LEVEL-101', 'CAS')
    store.setAoParameter('LEVEL-101', 'CAS_SP', 600)
    store.tick(0.1)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 60)
    store.restartModule('LEVEL-101')
    store.tick(0.1)
    const m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.mode, m.manualOutput, m.out], ['MAN', 60, 60])
    assert.equal(useStore.getState().moduleLifecycle['LEVEL-101'].saved.module.manualOutput, 10)
  })
})

test('preserving nonfinite live user values rejects download atomically instead of resetting silently', () => {
  withAreaProject((store, alerts) => {
    savedAoCourseProject(store)
    store.editModuleDraft('LEVEL-101', { downloadBehavior: 'ALL' })
    store.saveModuleConfiguration('LEVEL-101')
    const m = useStore.getState().modules['LEVEL-101']
    useStore.setState({ modules: { ...useStore.getState().modules, 'LEVEL-101': { ...m,
      parameters: { ...m.parameters, CAS_SP: { type: 'FLOAT', value: NaN } } } } })
    const before = useStore.getState()
    assert.equal(store.downloadModule('LEVEL-101', 'PARTIAL'), false)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().hardware, before.hardware)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    assert.match(alerts.at(-1), /Preserved runtime values are invalid/)
  })
})

test('managed AO online writes and Upload reject a down controller without changing live values', () => {
  withAreaProject((store, alerts) => {
    savedAoCourseProject(store)
    store.setStandaloneAoMode('LEVEL-101', 'AUTO')
    store.simulateControllerPowerLoss('CTRL1')
    const before = useStore.getState()
    assert.equal(store.setStandaloneAoMode('LEVEL-101', 'MAN'), false)
    assert.equal(store.setStandaloneAoValue('LEVEL-101', 750), false)
    assert.equal(store.setAoParameter('LEVEL-101', 'CAS_SP', 800), false)
    assert.equal(store.uploadModule('LEVEL-101'), false)
    assert.equal(useStore.getState().modules, before.modules)
    assert.equal(useStore.getState().moduleLifecycle, before.moduleLifecycle)
    assert.match(alerts.at(-1), /available assigned controller/)
  })
})

test('AO transfer and restart cannot revive renamed areas or deleted equipment memberships', () => {
  withAreaProject(store => {
    const { parseSavedAo, savedAoStorageKey } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    assert.equal(store.renameArea('PLANT_AREA_A', 'RENAMED_AREA'), true)
    store.createEquipmentModule('COURSE_EM', 'Project membership', 'RENAMED_AREA')
    store.setModuleEquipment('LEVEL-101', 'COURSE_EM')
    assert.equal(store.restartModule('LEVEL-101'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].area, 'RENAMED_AREA')
    assert.equal(useStore.getState().modules['LEVEL-101'].equipmentModule, 'COURSE_EM')
    assert.equal(store.saveModuleConfiguration('LEVEL-101'), true)
    const saved = parseSavedAo(global.window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), 'LEVEL-101')
    assert.equal(saved.module.area, 'RENAMED_AREA')
    assert.equal(saved.module.equipmentModule, 'COURSE_EM')
    store.deleteEquipmentModule('COURSE_EM')
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].equipmentModule, undefined)
    assert.equal(useStore.getState().modules['LEVEL-101'].area, 'RENAMED_AREA')
    assert.equal(store.restartModule('LEVEL-101'), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].equipmentModule, undefined)
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
  const originalUi = useUi.getState()
  try {
    withAreaProject((store, alerts) => {
      usePictures.setState({ pictures: { TANK101: { name: 'TANK101', elements: [] } } })
      run(usePictures.getState(), store, alerts)
    })
  } finally {
    usePictures.setState(originalPictures, true)
    useUi.setState(originalUi, true)
  }
}

function pictureAnalogFixture(pictures, store) {
  standaloneAoCourseProject(store)
  store.configureTraditionalChannel('CTRL1/C01', 1, { dst: 'LT-1', enabled: true, tiebackDst: 'LY-1' })
  const entry = pictures.addElement('TANK101', { type: 'datalink', x: 20, y: 20, tag: 'LEVEL-101', param: 'PV' })
  const fill = pictures.addElement('TANK101', { type: 'rectangle', x: 200, y: 50, tag: 'LI-101', width: 64, height: 160 })
  assert.equal(pictures.configureDynamics('TANK101', entry, { path: 'CAS_SP.F_CV',
    entry: { method: 'NUMERIC', fetchLimits: false, low: 0, high: 1000 } }), true)
  assert.equal(pictures.configureDynamics('TANK101', fill, { path: 'AI1/PV.F_CV',
    fill: { vertical: true, fetchLimits: true, low: 0, high: 1000 } }), true)
  return { entry, fill }
}

test('DV09 pp173-177 bounded picture entry drives actual LEVEL-101 output and LI-101 fill through scan tieback', () => {
  withPictureProject((pictures, store, alerts) => {
    const { pictureFill, pictureSignal } = require('../src/renderer/src/engine/pictureDynamics.ts')
    const { entry, fill } = pictureAnalogFixture(pictures, store)
    const element = id => usePictures.getState().pictures.TANK101.elements.find(e => e.id === id)
    for (const value of [0, 250.5, 1000]) {
      assert.equal(pictures.writeNumericValue('TANK101', entry, value), true)
      store.tick(0.1)
      store.tick(0.1)
      const m = useStore.getState().modules
      assert.ok(Math.abs(m['LEVEL-101'].out - value / 10) < 1e-9)
      assert.ok(Math.abs(m['LI-101'].pv - value) < 1e-9)
      assert.equal(pictureSignal(element(entry), m).value, value)
      assert.ok(Math.abs(pictureFill(element(fill), m).percent - value / 10) < 1e-9)
    }
    const before = useStore.getState().modules
    for (const invalid of [-0.1, 1000.1, NaN, Infinity]) {
      assert.equal(pictures.writeNumericValue('TANK101', entry, invalid), false)
      assert.equal(useStore.getState().modules, before)
      assert.match(alerts.at(-1), /finite value from 0 to 1000/)
    }
  })
})

test('fetched fill limits track the live engineering scale rather than stale default bounds', () => {
  withPictureProject((pictures, store) => {
    const { pictureFill } = require('../src/renderer/src/engine/pictureDynamics.ts')
    const { fill } = pictureAnalogFixture(pictures, store)
    const el = usePictures.getState().pictures.TANK101.elements.find(e => e.id === fill)
    const m = useStore.getState().modules['LI-101']
    const modules = { ...useStore.getState().modules, 'LI-101': { ...m, pv: 200, pvMin: -200, pvMax: 800, pvBad: false } }
    assert.equal(pictureFill(el, modules).percent, 40)
    const manual = { ...el, fill: { ...el.fill, fetchLimits: false } }
    assert.equal(pictureFill(manual, modules).percent, 20)
    for (const [pv, expected] of [[-400, 0], [1200, 100]]) {
      assert.equal(pictureFill(el, { ...modules, 'LI-101': { ...modules['LI-101'], pv } }).percent, expected)
    }
    assert.match(pictureFill(el, { ...modules, 'LI-101': { ...modules['LI-101'], pvMax: -200 } }).error, /limits/)
  })
})

test('picture fill holds real last-good input with Bad when the output channel fails', () => {
  withPictureProject((pictures, store) => {
    const { pictureFill } = require('../src/renderer/src/engine/pictureDynamics.ts')
    const { entry, fill } = pictureAnalogFixture(pictures, store)
    pictures.writeNumericValue('TANK101', entry, 750)
    store.tick(0.1); store.tick(0.1)
    store.configureTraditionalChannel('CTRL1/C02', 1, { dst: 'LY-1', enabled: false })
    pictures.writeNumericValue('TANK101', entry, 900)
    store.tick(0.1); store.tick(0.1)
    const el = usePictures.getState().pictures.TANK101.elements.find(e => e.id === fill)
    const result = pictureFill(el, useStore.getState().modules)
    assert.equal(result.percent, 75)
    assert.equal(result.bad, true)
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 900)
    assert.equal(useStore.getState().modules['LEVEL-101'].out, 75)
  })
})

test('read-only datalinks and unsupported numeric paths reject writes without proxying unrelated values', () => {
  withPictureProject((pictures, store, alerts) => {
    const { pictureSignal } = require('../src/renderer/src/engine/pictureDynamics.ts')
    standaloneAoCourseProject(store)
    const id = pictures.addElement('TANK101', { type: 'datalink', x: 0, y: 0, tag: 'LI-101', param: 'PV' })
    assert.equal(pictures.writeNumericValue('TANK101', id, 500), false)
    assert.match(alerts.at(-1), /no numeric entry/)
    assert.equal(pictures.configureDynamics('TANK101', id, { path: 'AI1/PV.F_CV',
      entry: { method: 'NUMERIC', fetchLimits: false, low: 0, high: 1000 } }), false)
    assert.match(alerts.at(-1), /Floating Point parameter/)
    for (const path of ['AI2/PV.F_CV', 'MISSING.CV', 'AI1/PV.CV']) {
      const source = pictureSignal({ tag: 'LEVEL-101', path }, useStore.getState().modules)
      assert.match(source.error, /Unsupported numeric source/)
    }
  })
})

test('invalid experts reject atomically including unavailable fetched parameter limits and empty dimensions', () => {
  withPictureProject((pictures, store) => {
    const { entry, fill } = pictureAnalogFixture(pictures, store)
    const before = usePictures.getState().pictures
    for (const [id, patch] of [
      [entry, { entry: { method: 'NUMERIC', fetchLimits: true, low: 0, high: 1000 } }],
      [entry, { entry: { method: 'NUMERIC', fetchLimits: false, low: 1000, high: 0 } }],
      [fill, { width: 0 }], [fill, { height: NaN }], [fill, { color: 'invalid' }],
      [fill, { path: 'MISSING.CV' }], [fill, { path: '' }]
    ]) {
      assert.equal(pictures.configureDynamics('TANK101', id, patch), false)
      assert.equal(usePictures.getState().pictures, before)
    }
  })
})

test('dynamic configuration and numeric writes honor separate Can Configure and Control permissions', () => {
  withPictureProject((pictures, store) => {
    const { entry, fill } = pictureAnalogFixture(pictures, store)
    useSecurity.setState({ currentUser: 'OperatorA' })
    const before = usePictures.getState().pictures
    assert.equal(pictures.configureDynamics('TANK101', fill, { width: 100 }), false)
    assert.equal(pictures.updateElement('TANK101', fill, { tag: 'LEVEL-101' }), false)
    assert.equal(pictures.addElement('TANK101', { type: 'tank', x: 0, y: 0 }), null)
    assert.equal(pictures.savePicture('TANK101'), false)
    pictures.removeElement('TANK101', fill)
    pictures.deletePicture('TANK101')
    assert.equal(usePictures.getState().pictures, before)
    assert.equal(pictures.writeNumericValue('TANK101', entry, 600), true)
    useSecurity.setState({ currentUser: 'NO_CONTROL_USER' })
    const runtime = useStore.getState().modules
    assert.equal(pictures.writeNumericValue('TANK101', entry, 700), false)
    assert.equal(useStore.getState().modules, runtime)
  })
})

test('saved picture restores experts and tank elements without writing live module values', () => {
  withPictureProject((pictures, store) => {
    const { pictureStorageKey } = require('../src/renderer/src/engine/pictureStore.ts')
    const { entry } = pictureAnalogFixture(pictures, store)
    pictures.addElement('TANK101', { type: 'tank', x: 180, y: 24, tag: 'LI-101' })
    assert.equal(pictures.savePicture('TANK101'), true)
    pictures.writeNumericValue('TANK101', entry, 750)
    assert.equal(pictures.configureDynamics('TANK101', entry, {
      entry: { method: 'NUMERIC', fetchLimits: false, low: 0, high: 2000 } }), true)
    pictures.deletePicture('TANK101')
    assert.equal(pictures.loadPicture('TANK101'), true)
    const el = usePictures.getState().pictures.TANK101.elements.find(e => e.id === entry)
    assert.equal(el.entry.high, 1000)
    assert.ok(usePictures.getState().pictures.TANK101.elements.some(e => e.type === 'tank'))
    assert.equal(useStore.getState().modules['LEVEL-101'].parameters.CAS_SP.value, 750)
    assert.match(global.window.localStorage.getItem(pictureStorageKey('TANK101')), /"version":1/)
  })
})

test('picture storage quota and corrupt saved schemas report failure without replacing last-good picture', () => {
  withPictureProject((pictures, store, alerts) => {
    const { pictureStorageKey } = require('../src/renderer/src/engine/pictureStore.ts')
    pictureAnalogFixture(pictures, store)
    pictures.savePicture('TANK101')
    const key = pictureStorageKey('TANK101')
    const valid = global.window.localStorage.getItem(key)
    const before = usePictures.getState().pictures
    for (const edit of [
      p => { p.version = 0 },
      p => { p.picture.name = 'WRONG' },
      p => { p.picture.elements[0].entry.high = null },
      p => { p.picture.elements[1].path = 'UNSUPPORTED.CV' },
      p => { p.picture.elements[1].id = p.picture.elements[0].id }
    ]) {
      const data = JSON.parse(valid); edit(data)
      global.window.localStorage.setItem(key, JSON.stringify(data))
      assert.equal(pictures.loadPicture('TANK101'), false)
      assert.equal(usePictures.getState().pictures, before)
      assert.match(alerts.at(-1), /Picture Load failed/)
    }
    global.window.localStorage.setItem(key, valid)
    global.window.localStorage.setItem = () => { throw new Error('Quota exceeded') }
    assert.equal(pictures.savePicture('TANK101'), false)
    assert.equal(global.window.localStorage.getItem(key), valid)
    assert.equal(usePictures.getState().pictures, before)
    assert.match(alerts.at(-1), /Picture Save failed.*Quota/)
  })
})

test('module primary/detail assignments are independent and navigate actual named pictures in Run mode', () => {
  withPictureProject((pictures, store) => {
    standaloneAoCourseProject(store)
    pictures.createPicture('DETAIL101')
    assert.equal(pictures.assignModuleDisplays('LEVEL-101', ' tank101.grf ', 'detail101'), true)
    assert.equal(pictures.assignModuleDisplays('LI-101', 'Ovw_ref.grf', 'alarmList.grf'), true)
    const m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.primaryDisplay, m.detailDisplay], ['tank101.grf', 'detail101'])
    useUi.getState().resetToOverview()
    assert.equal(useUi.getState().openModuleDisplay('LEVEL-101', 'primary'), true)
    assert.equal(useUi.getState().builderPicture, 'TANK101')
    assert.equal(useUi.getState().builderRun, true)
    assert.equal(useUi.getState().openModuleDisplay('LEVEL-101', 'detail'), true)
    assert.equal(useUi.getState().builderPicture, 'DETAIL101')
    useUi.getState().back()
    assert.equal(useUi.getState().builderPicture, 'TANK101')
    useUi.getState().forward()
    assert.equal(useUi.getState().builderPicture, 'DETAIL101')
    assert.equal(useUi.getState().openModuleDisplay('LI-101', 'primary'), true)
    assert.equal(useUi.getState().display, 'overview')
    assert.equal(useUi.getState().openModuleDisplay('LI-101', 'detail'), true)
    assert.equal(useUi.getState().display, 'alarms')
    assert.equal(useStore.getState().modules['LEVEL-101'], m)
  })
})

test('missing/deleted/denied display assignments reject atomically without fallback navigation', () => {
  withPictureProject((pictures, store, alerts) => {
    standaloneAoCourseProject(store)
    pictures.assignModuleDisplays('LEVEL-101', 'TANK101', '')
    const modules = useStore.getState().modules
    assert.equal(pictures.assignModuleDisplays('LEVEL-101', 'Ovw_ref.grf', 'MISSING'), false)
    assert.equal(useStore.getState().modules, modules)
    assert.equal(pictures.assignModuleDisplays('MISSING', 'TANK101', ''), false)
    useUi.getState().resetToOverview()
    const before = useUi.getState()
    assert.equal(useUi.getState().openModuleDisplay('LEVEL-101', 'detail'), false)
    assert.equal(useUi.getState(), before)
    pictures.deletePicture('TANK101')
    assert.equal(useUi.getState().openModuleDisplay('LEVEL-101', 'primary'), false)
    assert.equal(useUi.getState(), before)
    assert.match(alerts.at(-1), /Picture not found/)
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(pictures.assignModuleDisplays('LEVEL-101', '', ''), false)
    assert.equal(useStore.getState().modules, modules)
    useSecurity.setState({ currentUser: 'admin' })
    assert.equal(pictures.assignModuleDisplays('LEVEL-101', '', ''), true)
    assert.equal(useStore.getState().modules['LEVEL-101'].primaryDisplay, undefined)
  })
})

test('AO Save captures project display metadata while transfer/restart cannot revive old references', () => {
  withPictureProject((pictures, store) => {
    const { parseSavedAo, savedAoStorageKey } = require('../src/renderer/src/engine/moduleLifecycle.ts')
    savedAoCourseProject(store)
    pictures.assignModuleDisplays('LEVEL-101', 'TANK101', 'alarmList.grf')
    assert.equal(store.saveModuleConfiguration('LEVEL-101'), true)
    const saved = parseSavedAo(global.window.localStorage.getItem(savedAoStorageKey('LEVEL-101')), 'LEVEL-101')
    assert.deepEqual([saved.module.primaryDisplay, saved.module.detailDisplay], ['TANK101', 'alarmList.grf'])
    pictures.assignModuleDisplays('LEVEL-101', '', 'Ovw_ref.grf')
    assert.equal(store.downloadModule('LEVEL-101', 'FULL'), true)
    assert.equal(store.restartModule('LEVEL-101'), true)
    const m = useStore.getState().modules['LEVEL-101']
    assert.deepEqual([m.primaryDisplay, m.detailDisplay], [undefined, 'Ovw_ref.grf'])
  })
})

test('picture history branches correctly across Studio and project reset clears assigned navigation state', () => {
  withPictureProject(pictures => {
    pictures.createPicture('DETAIL101')
    useUi.getState().resetToOverview()
    useUi.getState().openPicture('TANK101')
    useUi.getState().openStudio('LIC-101')
    useUi.getState().back()
    assert.equal(useUi.getState().builderPicture, 'TANK101')
    useUi.getState().openPicture('DETAIL101')
    assert.deepEqual(useUi.getState().history, ['overview', 'builder', 'builder'])
    assert.deepEqual(useUi.getState().pictureHistory, [null, 'TANK101', 'DETAIL101'])
    useUi.getState().resetToOverview()
    assert.deepEqual(useUi.getState().pictureHistory, [null])
    assert.equal(useUi.getState().builderPicture, null)
    useUi.getState().navigate('builder')
    assert.equal(useUi.getState().builderRun, false)
  })
})

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
