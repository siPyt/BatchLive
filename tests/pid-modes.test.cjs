const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
const { makeDefaultHardware } = require('../src/renderer/src/engine/hardware.ts')
const { stepPlant } = require('../src/renderer/src/engine/simulate.ts')
const { configurePidIo, readAnalogSignal } = require('../src/renderer/src/engine/analogStrategy.ts')
const { evalCondition, sfcStepsError, applyAction } = require('../src/renderer/src/engine/sfc.ts')
const { parseSfcAssignment: parseActionExpression, parseSfcCondition: parseConditionExpression } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { parseSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const { pictureSignal } = require('../src/renderer/src/engine/pictureDynamics.ts')
const { pidModeFieldsError, pidNormalMode, pidPermittedModes, pidTargetAllowed } = require('../src/renderer/src/engine/pidModes.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const TAG = 'TIC-401'
function fixture() {
  const state = { ...buildInitialPlant(), hardware: makeDefaultHardware(), speed: 1 }
  const m = state.modules[TAG]
  m.io = configurePidIo(m, { splitRange: false, inputMode: 'MAN', inputManual: 10 })
  Object.assign(m, { sp: 100, out: 35, _integral: 35, gain: 5, reset: 1000, rate: 2,
    mode: 'AUTO', actualMode: 'AUTO', trackEnable: true, trackSource: 'TRACK',
    trackValue: 35, trackValueSource: undefined, ffEnable: false, casSource: undefined })
  m.io.ao.out = 35
  state.modules.TRACK = { tag: 'TRACK', type: 'DI', area: 'FEED', description: 'Tracking trigger',
    state: true, mode: 'AUTO', ioBad: false, alarms: [] }
  return state
}
function step(state) { return stepPlant(state, .1) }
test.beforeEach(() => test.mock.method(Math, 'random', () => .5))
test.afterEach(() => test.mock.restoreAll())

test('OOS stops PID math, holds output and reports Bad without poisoning AI1', () => {
  let state = fixture()
  const m = state.modules[TAG]
  m.mode = 'OOS'
  m._prevPv = 123
  m._dFilt = 17
  for (let scan = 0; scan < 5; scan++) state = step(state)
  const next = state.modules[TAG]
  assert.deepEqual([next.mode, next.actualMode, next.out, next._integral, next._prevPv, next._dFilt],
    ['OOS', 'OOS', 35, 35, 123, 17])
  assert.deepEqual([next.io.ai.out, next.io.ai.bad, next.pvBad], [10, false, false])
  assert.equal(next.io.ao.out, 35)
  assert.equal(next.io.ao.bad, true)
  for (const parameter of ['PV', 'OUT']) {
    assert.equal(readAnalogSignal({ tag: TAG, parameter }, state.modules).bad, true)
    assert.equal(pictureSignal({ tag: TAG, path: parameter }, state.modules).bad, true)
  }
  assert.equal(readAnalogSignal({ tag: TAG, block: 'AI1', parameter: 'OUT' }, state.modules).bad, false)
  assert.equal(pictureSignal({ tag: TAG, path: 'AI1/PV.CV' }, state.modules).bad, false)
  assert.equal(evalCondition({ kind: 'pv', tag: TAG, op: '<', value: 50 }, state, 0), false)
  assert.equal(evalCondition({ kind: 'out', tag: TAG, op: '>', value: 1 }, state, 0), false)
  assert.equal(evalCondition({ kind: 'mode', tag: TAG, mode: 'OOS' }, state, 0), true)
})

test('qualified tracking reports LO, retains target and releases without proportional/derivative kick', () => {
  let state = step(fixture())
  assert.deepEqual([state.modules[TAG].mode, state.modules[TAG].actualMode, state.modules[TAG].out],
    ['AUTO', 'LO', 35])
  assert.equal(state.modules[TAG].io.ao.bad, false)
  state.modules.TRACK.state = false
  state.modules[TAG].io.ai.manualValue = 50
  state = step(state)
  assert.equal(state.modules[TAG].actualMode, 'AUTO')
  assert.ok(Math.abs(state.modules[TAG].out - 35) < .1)
  assert.ok(state.modules[TAG]._integral < -100, 'Large proportional error needs an uncapped internal bias')
  state.modules[TAG].mode = 'OOS'
  state = step(state)
  const held = state.modules[TAG].out
  state.modules[TAG].io.ai.manualValue = 5
  state.modules[TAG].mode = 'AUTO'
  state = step(state)
  assert.equal(state.modules[TAG].actualMode, 'AUTO')
  assert.ok(Math.abs(state.modules[TAG].out - held) < .1)
})

test('LO is actual-only and releases to each existing target including cascade fallback', () => {
  for (const target of ['MAN', 'AUTO', 'CAS', 'RCAS', 'ROUT', 'IMAN']) {
    let state = fixture()
    state.modules[TAG].mode = target
    state.modules[TAG].casSource = 'TI-101'
    state.modules[TAG].casHealthy = true
    state = step(state)
    assert.equal(state.modules[TAG].mode, target)
    assert.equal(state.modules[TAG].actualMode, 'LO')
    state.modules.TRACK.state = false
    state = step(state)
    assert.equal(state.modules[TAG].actualMode, target)
    if (target === 'CAS' || target === 'RCAS') {
      state.modules[TAG].casHealthy = false
      state = step(state)
      assert.equal(state.modules[TAG].mode, target)
      assert.equal(state.modules[TAG].actualMode, 'AUTO')
    }
  }
})

test('Bad/missing triggers or tracking values hold applied output and publish a diagnostic', () => {
  for (const failure of ['bad-trigger', 'bad-false-trigger', 'missing-trigger', 'unassigned-trigger', 'bad-value', 'nonfinite-value']) {
    let state = step(fixture())
    if (failure === 'bad-trigger' || failure === 'bad-false-trigger') {
      state.modules.TRACK.ioBad = true
      state.modules.TRACK.mode = 'OOS'
      if (failure === 'bad-false-trigger') state.modules.TRACK.state = false
    } else if (failure === 'missing-trigger') delete state.modules.TRACK
    else if (failure === 'unassigned-trigger') state.modules[TAG].trackSource = undefined
    else {
      state.modules[TAG].trackValueSource = 'VALUE'
      state.modules.VALUE = failure === 'bad-value' ?
        { ...state.modules[TAG], tag: 'VALUE', mode: 'OOS', actualMode: 'OOS', trackEnable: false } :
        { ...state.modules['TI-101'], tag: 'VALUE', pv: NaN }
    }
    state = step(state)
    const m = state.modules[TAG]
    assert.equal(m.actualMode, 'IMAN', failure)
    assert.match(m.trackError, /missing or Bad/)
    assert.equal(m.io.ao.out, 35)
    assert.equal(m.io.ao.bad, true)
    assert.equal(readAnalogSignal({ tag: TAG, parameter: 'OUT' }, state.modules).bad, true)
    state.modules.TRACK = { tag: 'TRACK', type: 'DI', state: true, mode: 'AUTO', ioBad: false, alarms: [] }
    m.trackSource = 'TRACK'
    m.trackValueSource = undefined
    state = step(state)
    assert.equal(state.modules[TAG].actualMode, 'LO')
    assert.equal(state.modules[TAG].trackError, undefined)
  }
})

test('OOS preserves independent manual AO behavior and rejects stale PID feedforward/cascade data', () => {
  let state = fixture()
  state.modules[TAG].mode = 'OOS'
  state.modules[TAG].io.ao.mode = 'MAN'
  state.modules[TAG].io.ao.manualValue = 73
  state = step(state)
  assert.deepEqual([state.modules[TAG].actualMode, state.modules[TAG].out, state.modules[TAG].io.ao.out,
    state.modules[TAG].io.ao.bad], ['OOS', 35, 73, false])
  const receiver = state.modules['TIC-501']
  receiver.trackEnable = false
  receiver.mode = 'CAS'
  receiver.casSource = TAG
  receiver.casHealthy = true
  state = step(state)
  assert.equal(state.modules['TIC-501'].actualMode, 'AUTO')
  const receiving = state.modules['TIC-501']
  receiving.casSource = undefined
  receiving.mode = 'AUTO'
  receiving.ffEnable = true
  receiving.ffSource = TAG
  receiving.ffGain = 1
  state = step(state)
  assert.equal(state.modules['TIC-501'].actualMode, 'IMAN')
  assert.match(state.modules['TIC-501'].ffError, /Feedforward source/)
  assert.equal(state.modules['TIC-501'].io.ao.bad, true)
})

test('native target/actual numeric mode codes, OOS and LO persist through SFC validation', () => {
  const state = fixture()
  for (const [target, actual, mode] of [[1, 1, 'OOS'], [2, 2, 'IMAN'], [8, 8, 'MAN'],
    [16, 16, 'AUTO'], [48, 32, 'CAS'], [80, 64, 'RCAS'], [144, 128, 'ROUT']]) {
    assert.equal(parseActionExpression(`${TAG}/PID1/MODE.TARGET := ${target}`, state.modules).value.mode, mode)
    assert.equal(parseConditionExpression(`${TAG}/PID1/MODE.ACTUAL = ${actual}`, state.modules).value.mode, mode)
  }
  assert.equal(parseConditionExpression(`${TAG}/PID1/MODE.ACTUAL = 4`, state.modules).value.mode, 'LO')
  assert.ok(parseActionExpression(`${TAG}/PID1/MODE.TARGET := LO`, state.modules).error)
  assert.ok(parseActionExpression(`${TAG}/PID1/MODE.TARGET := 4`, state.modules).error)
  assert.ok(parseActionExpression(`${TAG}/PID1/MODE.TARGET := 32`, state.modules).error)
  assert.ok(parseActionExpression(`${TAG}/PID1/MODE.TARGET := 0x30`, state.modules).error)
  const steps = [{ id: 'S1', name: 'TRACKING', actions: [{ kind: 'mode', tag: TAG, mode: 'OOS' }],
    transition: { kind: 'mode', tag: TAG, mode: 'LO' } }]
  assert.equal(sfcStepsError(steps, state.modules), null)
  const payload = { version: 1, configuration: { name: 'PID-MODES', area: 'FEED', controllerTag: '', steps } }
  assert.equal(parseSavedSfc(JSON.stringify(payload), state.modules).configuration.steps[0].transition.mode, 'LO')
  steps[0].actions[0].mode = 'LO'
  assert.match(sfcStepsError(steps, state.modules), /Invalid.*target mode/)
  assert.ok(parseSavedSfc(JSON.stringify(payload), state.modules).error)
})

test('operator and SFC output entries cannot override LO/OOS; invalid setup and locked modes are rejected', () => {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: text => alerts.push(text) }
  try {
    useStore.setState({ ...step(fixture()), running: true })
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    s.setMode(TAG, 'LO')
    assert.equal(useStore.getState().modules[TAG].mode, 'AUTO')
    s.setMode(TAG, 'MAN')
    s.setOutput(TAG, 90)
    const m = useStore.getState().modules[TAG]
    assert.equal(m.out, 35)
    applyAction(m, { kind: 'out', tag: TAG, value: 90 })
    assert.equal(m.out, 35)
    const count = alerts.length
    for (const patch of [{ value: NaN }, { value: 101 }, { source: 'MISSING' },
      { source: TAG }, { enable: 'yes' }, { valueSource: null }, { source: undefined }]) s.setTracking(TAG, patch)
    assert.equal(alerts.length, count + 7)
    assert.equal(m.trackValue, 35)
    useSecurity.setState({ locked: true })
    s.setMode(TAG, 'OOS')
    assert.equal(useStore.getState().modules[TAG].mode, 'MAN')
    useSecurity.setState({ locked: false })
    s.setMode(TAG, 'OOS')
    s.tick(.1)
    s.setOutput(TAG, 60)
    assert.deepEqual([useStore.getState().modules[TAG].actualMode, useStore.getState().modules[TAG].out], ['OOS', 35])
    assert.ok(useStore.getState().eventLog.some(event => event.category === 'DIAGNOSTIC'))
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    global.window = before.window
  }
})

test('Normal is informational; Permitted constrains target, operator and SFC writes', () => {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: text => alerts.push(text) }
  try {
    useStore.setState({ ...fixture(), running: true })
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    let m = s.modules[TAG]
    assert.equal(pidNormalMode(m), 'AUTO')
    assert.deepEqual(pidPermittedModes(m), ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN', 'OOS'])
    assert.equal(pidModeFieldsError(m), null)
    assert.equal(s.setPidModeFields(TAG, { normalMode: 'OOS', permittedModes: ['AUTO', 'OOS'] }), true)
    m = useStore.getState().modules[TAG]
    assert.equal(pidNormalMode(m), 'OOS')
    assert.equal(pidModeFieldsError(m), null)
    assert.equal(m.actualMode, 'AUTO', 'normal metadata does not act on the controller algorithm')
    assert.equal(parseActionExpression(`${TAG}/PID1/MODE.TARGET := CAS`, useStore.getState().modules).error,
      'CAS is not in TIC-401 MODE.PERMITTED')
    assert.equal(parseActionExpression(`${TAG}/PID1/MODE.TARGET := 48`, useStore.getState().modules).error,
      'CAS is not in TIC-401 MODE.PERMITTED')
    assert.equal(parseActionExpression(`${TAG}/PID1/MODE.TARGET := OOS`, useStore.getState().modules).value.mode, 'OOS')
    const stepDef = mode => [{ id: 'M1', name: 'MODE', actions: [{ kind: 'mode', tag: TAG, mode }],
      transition: { kind: 'always' } }]
    assert.match(sfcStepsError(stepDef('CAS'), useStore.getState().modules), /non-permitted/)
    assert.equal(sfcStepsError(stepDef('OOS'), useStore.getState().modules), null)
    s.setMode(TAG, 'CAS')
    assert.equal(useStore.getState().modules[TAG].mode, 'AUTO')
    assert.match(alerts.at(-1), /not in MODE.PERMITTED/)
    const rejected = { ...m, mode: 'AUTO' }
    applyAction(rejected, { kind: 'mode', tag: TAG, mode: 'CAS' })
    assert.equal(rejected.mode, 'AUTO')
    const count = alerts.length
    assert.equal(s.setPidModeFields(TAG, { permittedModes: ['AUTO'] }), false,
      'the current normal mode may not be silently removed from the permitted list')
    assert.equal(s.setPidModeFields(TAG, { permittedModes: [] }), false)
    assert.equal(s.setPidModeFields(TAG, { permittedModes: ['AUTO', 'AUTO'] }), false)
    assert.equal(s.setPidModeFields(TAG, { normalMode: 'LO' }), false)
    assert.equal(s.setPidModeFields(TAG, { permittedModes: ['OOS'] }), false,
      'the active target may not be removed')
    assert.equal(alerts.length, count + 5)
    const malformed = { ...m, permittedModes: ['AUTO', 'BAD'] }
    assert.match(pidModeFieldsError(malformed), /invalid or duplicate/)
    assert.equal(pidTargetAllowed(malformed, 'AUTO'), false)
    assert.equal(s.setPidModeFields(TAG, { normalMode: 'AUTO', permittedModes: ['AUTO', 'OOS'] }), true,
      'Normal and Permitted can be updated atomically')
    assert.equal(useStore.getState().modules[TAG].actualMode, 'AUTO')
    assert.equal(s.setPidModeFields(TAG, { permittedModes: ['AUTO'] }), true)
    s.setMode(TAG, 'OOS')
    assert.equal(useStore.getState().modules[TAG].mode, 'AUTO')
    useSecurity.setState({ locked: true })
    assert.equal(s.setPidModeFields(TAG, { normalMode: 'AUTO' }), false)
    assert.equal(pidModeFieldsError(useStore.getState().modules[TAG]), null)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    global.window = before.window
  }
})

test('LO retains its requested output through split-range not-invited feedback and independent AO limits', () => {
  let state = fixture()
  let m = state.modules[TAG]
  m.io = configurePidIo(m, { splitRange: true, outputMode: 'MAN', outputManual: 73,
    output2Mode: 'MAN', output2Manual: 24 })
  state = step(state)
  m = state.modules[TAG]
  assert.equal(m.io.splitter.status, 'NOT_INVITED')
  assert.deepEqual([m.actualMode, m.out, m.io.ao.out], ['LO', 35, 73])
  state = fixture()
  state.modules[TAG].io.ao.highLimit = 20
  state = step(state)
  m = state.modules[TAG]
  assert.deepEqual([m.actualMode, m.out, m._integral, m.io.ao.out], ['LO', 35, 35, 20])
  state.modules.TRACK.state = false
  state = step(step(state))
  m = state.modules[TAG]
  assert.equal(m.actualMode, 'AUTO')
  assert.ok(m.out < 20.1)
  assert.equal(m.io.ao.out, 20)
  assert.ok(m._integral < -100)
})
