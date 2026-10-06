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
const { advanceSfcs, sfcStepsError, sfcStepViews } = require('../src/renderer/src/engine/sfc.ts')
const { parseSfcCondition } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { placeholderStepViews } = require('../src/renderer/src/engine/sfcParameters.ts')
const { cloneSfcConfiguration, parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')

const NAME = 'CONFIRM-TEST'
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.window = { alert: () => {}, localStorage: { getItem: () => null, setItem: () => {} } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    useStore.getState().newProject('pharma')
    useStore.getState().createSfc(NAME, 'FEED')
    run(useStore.getState())
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
const context = { name: NAME, parameters: {}, sets: {} }
const modules = () => useStore.getState().modules
const error = (steps) => sfcStepsError(steps, modules(), context)
const SWITCH = "'//LSH-101/DI1/PV_D.CV' = 1"
const expr = (text) => ({ kind: 'expression', text })

/** Workshop shape: a confirmed action, then a transition that waits for the confirmation (course 7009-8 p8-24/26). */
function chart(confirm, extra = {}) {
  return [
    { id: 'close', name: 'CLOSE BLK VLV', actions: [{ kind: 'sp', tag: 'FIC-101', value: 10, qualifier: 'N', confirm, ...extra }],
      transition: expr("'PENDING_CONFIRMS.CV' = 0 AND NOT 'CONFIRM_FAIL.CV'"),
      alternatives: [{ condition: expr("'CONFIRM_FAIL.CV'"), nextStep: 'fail' }], nextStep: 'done' },
    { id: 'done', name: 'DONE', actions: [], transition: { kind: 'always' }, nextStep: null },
    { id: 'fail', name: 'FAILED', actions: [], transition: { kind: 'always' }, nextStep: null }
  ]
}
function runChart(steps, scans, mutate, dt = 0.1) {
  const store = useStore.getState()
  store.sfcCommand(NAME, 'reset')
  store.setSfcSteps(NAME, steps)
  store.sfcCommand(NAME, 'run')
  let state = useStore.getState()
  const trace = []
  for (let i = 0; i < scans; i++) {
    if (mutate) state = mutate(state, i)
    state = { ...state, ...advanceSfcs(state, state.modules, dt) }
    const sfc = state.sfcs[NAME]
    trace.push({ step: sfc.steps[sfc.active]?.id, status: sfc.status, views: sfcStepViews(sfc).find(view => view.id === 'close') })
  }
  return { trace, state }
}
const withSwitch = (state, on) => ({ ...state, modules: { ...state.modules, 'LSH-101': { ...state.modules['LSH-101'], state: on, mode: 'AUTO', ioBad: false } } })

test('DV09-067 Confirm tab: a step with confirmed actions must test a confirm parameter in its transition', () => fixture(() => {
  assert.equal(error(chart({ expression: SWITCH, timeout: 2 })), null)
  const bad = chart({ expression: SWITCH, timeout: 2 })
  bad[0].transition = { kind: 'timer', seconds: 1 }
  assert.match(error(bad), /must test PENDING_CONFIRMS, FAILED_CONFIRMS or CONFIRM_FAIL/)
  const okFailed = chart({ expression: SWITCH })
  okFailed[0].transition = expr("'FAILED_CONFIRMS.CV' = 0 AND 'PENDING_CONFIRMS.CV' = 0")
  assert.equal(error(okFailed), null)
}))

test('DV09-067 Confirm tab: expression, timeout and qualifier validation', () => fixture(() => {
  assert.match(error(chart({ expression: "'//NOPE/DI1/PV_D.CV' = 1" })), /^Confirm expression: Module NOPE does not exist/)
  assert.match(error(chart({ expression: '1 + 2' })), /Confirm expression: .*true or false/)
  assert.match(error(chart({ expression: SWITCH, timeout: -1 })), /finite and nonnegative/)
  assert.match(error(chart({ expression: SWITCH, timeout: 1, timeoutExpression: 'TRUE' })), /not both/)
  assert.match(error(chart({ expression: SWITCH, timeoutExpression: 'T_ACTIVE' })), /Confirm timeout expression: .*true or false/)
  assert.equal(error(chart({ expression: SWITCH, timeoutExpression: 'T_ACTIVE >= 1.5' })), null)
  const reset = chart(undefined)
  reset[0].actions = [{ kind: 'sp', tag: 'FIC-101', value: 1, qualifier: 'S', name: 'SETFLOW' }]
  reset[0].transition = { kind: 'timer', seconds: 1 }
  reset[1].actions = [{ kind: 'sp', tag: 'FIC-101', value: 1, qualifier: 'R', name: 'SETFLOW', confirm: { expression: SWITCH } }]
  assert.match(error(reset), /reset action cannot be confirmed/)
  assert.equal(error(chart({ expression: SWITCH, timeout: 3 }, { qualifier: 'P', seconds: 0 })), null, 'any non-reset qualifier can be confirmed')
}))

test('DV09-067 Confirm runtime: PENDING_CONFIRMS holds the step until the confirm expression is TRUE', () => fixture(() => {
  const { trace } = runChart(chart({ expression: SWITCH, timeout: 5 }), 8,
    (state, i) => withSwitch(state, i >= 4))
  assert.ok(trace.slice(0, 4).every(entry => entry.step === 'close'), 'stays on the step while the confirmation is pending')
  assert.equal(trace[0].views.pendingConfirms, 1)
  assert.equal(trace[0].views.failedConfirms, 0)
  const done = trace.findIndex(entry => entry.step === 'done' || entry.status === 'COMPLETE')
  assert.ok(done >= 4, 'moves on only after the switch confirms')
  assert.equal(trace.at(-1).status, 'COMPLETE')
  assert.equal(trace.at(-1).step, 'done', 'the success branch, not the failure branch')
}))

test('DV09-067 Confirm runtime: timeout sets CONFIRM_FAIL and takes the failure route', () => fixture(() => {
  const { trace } = runChart(chart({ expression: SWITCH, timeout: 0.3 }), 10, (state) => withSwitch(state, false))
  assert.ok(trace.slice(0, 2).every(entry => entry.step === 'close'), 'still pending before the timeout')
  const failed = trace.findIndex(entry => entry.step === 'fail')
  assert.ok(failed >= 3 && failed <= 5, 'fails once 0.3 s have elapsed since the action ran, got ' + failed)
  assert.equal(trace.at(-1).step, 'fail')
  assert.equal(trace.at(-1).status, 'COMPLETE')
}))

test('DV09-067 Confirm runtime: a timeout of 0 waits indefinitely', () => fixture(() => {
  const { trace } = runChart(chart({ expression: SWITCH, timeout: 0 }), 30, (state) => withSwitch(state, false))
  assert.ok(trace.every(entry => entry.step === 'close' && entry.views.failedConfirms === 0))
}))

test('DV09-067 Confirm runtime: a timeout expression fails the confirmation when it becomes TRUE', () => fixture(() => {
  const { trace } = runChart(chart({ expression: SWITCH, timeoutExpression: "'^/LIC-101/PID1/PV.CV' > 70" }), 8,
    (state, i) => ({ ...withSwitch(state, false), modules: { ...withSwitch(state, false).modules, 'LIC-101': { ...state.modules['LIC-101'], pv: i >= 3 ? 80 : 40 } } }))
  assert.ok(trace.slice(0, 3).every(entry => entry.step === 'close'))
  assert.equal(trace.at(-1).step, 'fail')
}))

test('DV09-067 Confirm runtime: the confirmation clock starts when a delayed action actually runs', () => fixture(() => {
  const steps = chart({ expression: SWITCH, timeout: 0.2 }, { qualifier: 'D', seconds: 0.5 })
  const { trace } = runChart(steps, 12, (state) => withSwitch(state, false))
  const failed = trace.findIndex(entry => entry.step === 'fail')
  assert.equal(failed, 6, 'fails 0.2 s after the 0.5 s delay ends (t = 0.7 s), got ' + failed)
  assert.ok(trace.slice(0, 5).every(entry => entry.views.failedConfirms === 0 && entry.views.pendingConfirms === 1))
}))

test('DV09-067 Confirm runtime: step parameters are readable by step name from another step', () => fixture(() => {
  const steps = chart({ expression: SWITCH, timeout: 5 })
  steps[0].transition = expr("'PENDING_CONFIRMS.CV' = 0")
  delete steps[0].alternatives
  steps[1].transition = { kind: 'always' }
  steps.splice(1, 0, { id: 'watch', name: 'WATCH', actions: [], transition: expr("'CLOSE_BLK_VLV/FAILED_CONFIRMS.CV' = 0 AND '//CLOSE BLK VLV/PENDING_CONFIRMS' = 0 AND 'CLOSE_BLK_VLV/TIME.CV' >= 0"), nextStep: 'done' })
  steps[0].nextStep = 'watch'
  assert.equal(error(steps), null)
  assert.match(error(steps.map((s, i) => i === 1 ? { ...s, transition: expr("'NO_SUCH_STEP/PENDING_CONFIRMS.CV' = 0") } : s)), /does not exist in this SFC/)
  const { trace } = runChart(steps, 12, (state, i) => withSwitch(state, i >= 2))
  assert.equal(trace.at(-1).status, 'COMPLETE')
}))

test('DV09-067 Confirm runtime: confirmations work inside parallel legs', () => fixture(() => {
  const steps = [
    { id: 'f', name: 'FORK', actions: [], transition: { kind: 'always' }, parallelNextSteps: ['close', 'b'] },
    { id: 'close', name: 'CLOSE BLK VLV', actions: [{ kind: 'sp', tag: 'FIC-101', value: 10, qualifier: 'N', confirm: { expression: SWITCH, timeout: 5 } }],
      transition: expr("'PENDING_CONFIRMS.CV' = 0"), nextStep: 'j' },
    { id: 'b', name: 'OTHER', actions: [{ kind: 'sp', tag: 'LIC-101', value: 40, qualifier: 'N' }], transition: { kind: 'timer', seconds: 0.1 }, nextStep: 'j' },
    { id: 'j', name: 'JOIN', actions: [], transition: { kind: 'always' }, joinFrom: ['close', 'b'], nextStep: null }
  ]
  assert.equal(error(steps), null)
  const { trace } = runChart(steps, 15, (state, i) => withSwitch(state, i >= 6))
  assert.ok(trace.slice(0, 5).every(entry => entry.status === 'RUNNING'), 'the join waits for the confirmation leg')
  assert.equal(trace.at(-1).status, 'COMPLETE')
}))

test('DV09-067 Confirm tab data is cloned, saved and schema-checked', () => fixture(() => {
  const configuration = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01', steps: chart({ expression: SWITCH, timeout: 2.5 }) }
  const copy = cloneSfcConfiguration(configuration)
  copy.steps[0].actions[0].confirm.timeout = 99
  assert.equal(configuration.steps[0].actions[0].confirm.timeout, 2.5, 'deep copy')
  const restored = parseSavedSfc(serializeSavedSfc(configuration), modules())
  assert.ok(!restored.error, restored.error)
  assert.deepEqual(restored.configuration, cloneSfcConfiguration(configuration))
  for (const mutate of [
    c => { c.steps[0].actions[0].confirm = { expression: '' } },
    c => { c.steps[0].actions[0].confirm = { expression: 5 } },
    c => { c.steps[0].actions[0].confirm = { expression: SWITCH, timeout: 'x' } },
    c => { c.steps[0].actions[0].confirm = 'yes' }
  ]) {
    const malformed = cloneSfcConfiguration(configuration)
    mutate(malformed)
    assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: malformed }), modules()).error)
  }
}))

test('DV09-067 the Properties parser resolves step parameters through the dialog context', () => fixture(() => {
  const steps = chart({ expression: SWITCH })
  const ctx = { ...context, steps: placeholderStepViews(steps), stepId: 'close' }
  assert.equal(parseSfcCondition("'PENDING_CONFIRMS.CV' = 0", modules(), ctx).value.kind, 'expression')
  assert.equal(parseSfcCondition("'CLOSE_BLK_VLV/CONFIRM_FAIL.CV'", modules(), ctx).error, undefined)
  assert.ok(parseSfcCondition("'PENDING_CONFIRMS.CV' = 0", modules(), context).error, 'unknown without a step context')
}))
