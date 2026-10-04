const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { advanceSfcs, sfcStepsError, evalCondition, resetSfcBooleanActions } = require('../src/renderer/src/engine/sfc.ts')
const { sfcParameterError } = require('../src/renderer/src/engine/sfcParameters.ts')
const { parseSfcAssignment, parseSfcBooleanAction, parseSfcCondition, assignmentExpression, conditionExpression } =
  require('../src/renderer/src/engine/sfcExpressions.ts')
const { cloneSfcConfiguration, serializeSavedSfc, parseSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const { pictureNamedSignal } = require('../src/renderer/src/engine/pictureNamedSets.ts')
const NAME = 'BOOL-SFC'
const parameters = () => ({ ACTIVE: { type: 'BOOLEAN', value: false }, OTHER: { type: 'BOOLEAN', value: false },
  UNTOUCHED: { type: 'BOOLEAN', value: true } })
const action = (qualifier = 'N', seconds = .2) => ({
  kind: 'boolean', tag: NAME, parameter: 'ACTIVE', qualifier, name: 'FLAG', seconds
})
const step = (id, actions = [], seconds = 100) => ({ id, name: id, actions, transition: { kind: 'timer', seconds } })
const chart = state => state.sfcs[NAME]
const value = (state, name = 'ACTIVE') => chart(state).parameters[name].value
const context = state => ({ name: NAME, parameters: chart(state).parameters, sets: {} })
function make(steps) {
  return { ...useStore.getState(), sfcs: { [NAME]: {
    name: NAME, area: 'FEED', status: 'RUNNING', active: 0, elapsed: 0, parameters: parameters(), steps
  } } }
}
function scan(state, dt = .1) { return { ...state, ...advanceSfcs(state, state.modules, dt) } }
test('Boolean references are a separate action type, not assignments; conditions and formatters round trip', () => {
  const state = make([step('a')])
  for (const expression of ["'ACTIVE'", "'active.CV'"]) {
    assert.deepEqual(parseSfcBooleanAction(expression, context(state)).value,
      { kind: 'boolean', tag: NAME, parameter: 'ACTIVE' })
  }
  const parsed = parseSfcBooleanAction("'ACTIVE.CV'", context(state)).value
  assert.equal(assignmentExpression(parsed), "'ACTIVE.CV'")
  assert.ok(parseSfcAssignment("'ACTIVE.CV'", state.modules, context(state)).error)
  for (const expression of ["'ACTIVE' := TRUE", "'MESSAGE'", "'OTHER/ACTIVE'", "'ACTIVE.CV' := 1", 'ACTIVE']) {
    assert.ok(parseSfcBooleanAction(expression, context(state)).error, expression)
  }
  for (const literal of ['TRUE', 'FALSE', '0', '1']) {
    const result = parseSfcCondition(`'ACTIVE.CV' = ${literal}`, state.modules, context(state))
    assert.deepEqual(result.value, { kind: 'boolean', parameter: 'ACTIVE', value: ['TRUE', '1'].includes(literal) })
    assert.deepEqual(parseSfcCondition(conditionExpression(result.value), state.modules, context(state)).value, result.value)
  }
  assert.ok(parseSfcCondition("'ACTIVE.CV' = 2", state.modules, context(state)).error)
  assert.ok(parseSfcBooleanAction("'ACTIVE'").error)
})
test('N drives TRUE while active, FALSE on transition and completion, and leaves unreferenced parameters unchanged', () => {
  const initial = make([step('a', [action()], .2), step('b', [], .1)])
  let state = scan(initial)
  assert.equal(value(state), true)
  assert.equal(value(initial), false)
  assert.equal(evalCondition({ kind: 'boolean', parameter: 'ACTIVE', value: true }, state, 0, context(state)), true)
  state = scan(state)
  assert.equal(chart(state).active, 1)
  assert.equal(value(state), false)
  assert.equal(value(state, 'UNTOUCHED'), true)
  state = scan(state)
  assert.equal(chart(state).status, 'COMPLETE')
  assert.equal(value(state), false)
})
test('P drives one scan, D waits and L expires at the exact threshold rather than retaining TRUE', () => {
  for (const [qualifier, expected] of [['P', [false, true, false]], ['D', [false, true, true]], ['L', [true, false, false]]]) {
    let state = make([step('a', [action(qualifier)])])
    for (const active of expected) {
      state = scan(state)
      assert.equal(value(state), active, qualifier)
    }
  }
})
test('stored S and SD survive departure while pending DS cancels; SL expires after departure', () => {
  for (const [qualifier, expected] of [['S', [true, true, true]], ['SD', [false, true, true]],
    ['DS', [false, false, false]], ['D', [false, false, false]], ['SL', [true, false, false]]]) {
    let state = make([step('a', [action(qualifier)], .1), step('b')])
    for (const active of expected) {
      state = scan(state)
      assert.equal(value(state), active, qualifier)
    }
  }
})
test('active DS survives departure; reset and completion turn stored Boolean outputs off', () => {
  let state = make([step('a', [action('DS')], .2), step('b', [], .2)])
  state = scan(scan(state))
  assert.equal(chart(state).active, 1)
  assert.equal(value(state), true)
  state = scan(scan(state))
  assert.equal(chart(state).status, 'COMPLETE')
  assert.equal(value(state), false)
  state = make([step('a', [action('S')], .1), step('reset', [action('R')])])
  assert.equal(sfcStepsError(chart(state).steps, state.modules, context(state)), null)
  state = scan(state)
  assert.equal(chart(state).active, 1)
  assert.equal(value(state), false)
  assert.ok(Object.values(chart(state).actionStates).every(runtime => !runtime.active))
})
test('HOLD freezes Boolean and timer; reset clears only referenced outputs without mutating prior parameters', () => {
  let state = scan(make([step('a', [action('SL', .4)])]))
  const before = chart(state)
  state = { ...state, sfcs: { [NAME]: { ...before, status: 'HELD' } } }
  assert.deepEqual(chart(scan(state, 10)), chart(state))
  const reset = resetSfcBooleanActions(before)
  assert.equal(reset.ACTIVE.value, false)
  assert.equal(reset.UNTOUCHED.value, true)
  assert.equal(before.parameters.ACTIVE.value, true)
  state = { ...state, sfcs: { [NAME]: { ...chart(state), status: 'RUNNING' } } }
  state = scan(state, .3)
  assert.equal(value(state), false)
})
test('Boolean flags are aggregated by output, not action name, and unrelated flags stay independent', () => {
  let state = make([step('a', [
    { ...action('P', 0), name: 'PULSE' }, { ...action('N'), name: 'CONTINUOUS' },
    { ...action('D', .3), name: 'OTHER', parameter: 'OTHER' }
  ])])
  state = scan(scan(state))
  assert.equal(value(state), true)
  assert.equal(value(state, 'OTHER'), false)
  state = scan(state)
  assert.equal(value(state, 'OTHER'), true)
})
test('parallel Boolean outputs have independent lifetimes, all-branch join and conflict rejection', () => {
  const steps = [
    { ...step('fork'), transition: { kind: 'always' }, parallelNextSteps: ['a', 'b'] },
    { ...step('a', [action()], .2), nextStep: 'join' },
    { ...step('b', [{ ...action(), parameter: 'OTHER', name: 'OTHER' }], .4), nextStep: 'join' },
    { ...step('join', [], .1), joinFrom: ['a', 'b'], nextStep: null }
  ]
  let state = make(steps)
  assert.equal(sfcStepsError(steps, state.modules, context(state)), null)
  state = scan(state)
  assert.equal(value(state), true)
  assert.equal(value(state, 'OTHER'), true)
  state = scan(state, .2)
  assert.equal(value(state), false)
  assert.equal(value(state, 'OTHER'), true)
  assert.deepEqual(chart(state).joinArrivals, { join: ['a'] })
  state = scan(state, .2)
  assert.equal(value(state, 'OTHER'), false)
  assert.deepEqual(chart(state).activeSteps, { join: 0 })
  steps[2].actions[0].parameter = 'ACTIVE'
  assert.match(sfcStepsError(steps, state.modules, context(state)), /conflict|write|output/i)
})
test('saved schema clones Boolean parameters and rejects wrong types, missing references and foreign owners', () => {
  const state = make([step('a', [action()])])
  const configuration = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01',
    parameters: parameters(), steps: chart(state).steps }
  const clone = cloneSfcConfiguration(configuration)
  clone.parameters.ACTIVE.value = true
  assert.equal(configuration.parameters.ACTIVE.value, false)
  assert.deepEqual(parseSavedSfc(serializeSavedSfc(configuration), state.modules).configuration, cloneSfcConfiguration(configuration))
  for (const invalid of [{ type: 'BOOLEAN', value: 1 }, { type: 'BOOLEAN', value: 'false' }]) {
    assert.ok(sfcParameterError({ ACTIVE: invalid }, {}))
    assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: {
      ...configuration, parameters: { ...configuration.parameters, ACTIVE: invalid }
    } }), state.modules).error)
  }
  assert.ok(sfcStepsError([step('a', [{ ...action(), tag: 'OTHER-SFC' }])], state.modules, context(state)))
  assert.ok(sfcStepsError([step('a', [{ ...action(), parameter: 'MISSING' }])], state.modules, context(state)))
  assert.equal(evalCondition({ kind: 'boolean', parameter: 'MISSING', value: false }, state, 0, context(state)), false)
})
test('managed Boolean configuration, Properties, Save/Download/Online and reset isolate draft/default/runtime and Named Set entry', () => {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const storage = new Map()
  const alerts = []
  global.window = { alert: message => alerts.push(message), localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('pharma')
    assert.equal(store.createSfc(NAME, 'FEED', { managed: true }), true)
    let draft = useStore.getState().sfcLifecycle[NAME].draft
    assert.equal(store.configureSfcParameter(NAME, 'ACTIVE', { type: 'BOOLEAN', value: false }, draft), true)
    assert.equal(store.configureSfcParameter(NAME, 'OTHER', { type: 'BOOLEAN', value: false }, draft), false)
    draft = useStore.getState().sfcLifecycle[NAME].draft
    store.setSfcSteps(NAME, [step('a', [action('S')])])
    draft = useStore.getState().sfcLifecycle[NAME].draft
    assert.equal(store.configureSfcParameter(NAME, 'ACTIVE', { type: 'NAMED_SET', namedSet: 'MISSING', value: 0 }, draft), false)
    assert.equal(store.configureSfcController(NAME, 'CTLR-01'), true)
    assert.equal(store.saveSfc(NAME), true)
    assert.equal(store.downloadSavedSfc(NAME), true)
    assert.equal(store.setSfcOnline(NAME, true), true)
    store.sfcCommand(NAME, 'run')
    useStore.setState(scan(useStore.getState()))
    assert.equal(value(useStore.getState()), true)
    assert.equal(useStore.getState().sfcLifecycle[NAME].draft.parameters.ACTIVE.value, false)
    assert.equal(useStore.getState().sfcLifecycle[NAME].saved.parameters.ACTIVE.value, false)
    assert.equal(store.writeSfcNamedValue(NAME, 'ACTIVE', 1), false)
    assert.ok(pictureNamedSignal({ tag: NAME, path: 'ACTIVE.CV' }, useStore.getState()).error)
    store.sfcCommand(NAME, 'reset')
    assert.equal(value(useStore.getState()), false)
    assert.equal(chart(useStore.getState()).status, 'READY')
    assert.ok(alerts.length >= 3)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
})
