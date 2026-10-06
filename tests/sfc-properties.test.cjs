const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  module._compile(outputText, filename)
}
const { buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
const { parseSfcAssignment, parseSfcCondition, assignmentExpression, conditionExpression } =
  require('../src/renderer/src/engine/sfcExpressions.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')

test('SFC expression assignments roundtrip real command paths without changing values or resolving feedback as command', () => {
  const modules = buildInitialPlant().modules
  modules['LEVEL-101'] = { tag: 'LEVEL-101', type: 'AO' }
  const actions = [
    { kind: 'mode', tag: 'FIC-101', mode: 'AUTO' },
    { kind: 'sp', tag: 'FIC-101', value: 50 },
    { kind: 'out', tag: 'FIC-101', value: 30 },
    { kind: 'motor', tag: 'P-101', run: true },
    { kind: 'valve', tag: 'XV-101', open: false },
    { kind: 'do', tag: 'HS-201', on: true },
    { kind: 'sp', tag: 'LEVEL-101', value: 500 },
    { kind: 'out', tag: 'LEVEL-101', value: 55.5 },
    { kind: 'mode', tag: 'LEVEL-101', mode: 'CAS' }
  ]
  const before = JSON.stringify(modules)
  for (const action of actions) {
    assert.deepEqual(parseSfcAssignment(assignmentExpression(action, modules[action.tag]), modules), { value: action })
  }
  assert.deepEqual(parseSfcAssignment("'fic-101/PID1/SP.CV' := 5e1", modules),
    { value: { kind: 'sp', tag: 'FIC-101', value: 50 } })
  for (const expression of [
    "'P-101/DC1/PV_D.CV' := 1", "'XV-101/DC1/PV_D.CV' := 0",
    "'FIC-101/AI1/PV.CV' := 50", "'LEVEL-101/PID1/SP.CV' := 500",
    "'HS-201/DO1/SP_D.CV' := 2", "'P-101/DC1/OUT_D.CV' := true",
    "'LEVEL-101/AO1/MODE.TARGET' := ROUT",
    "'FIC-101/PID1/SP.CV' := Infinity", "'FIC-101/PID1/SP.CV' := NaN",
    "'FIC-101/PID1/SP.CV' := ''", "'FIC-101/PID1/SP.CV' := 0x10",
    "'FIC-101/PID1/SP.CV\" := 50", "'UNKNOWN/PID1/SP.CV' := 50",
    "'MESSAGE' := 'NS-T101:SELECT SEQUENCE'"
  ]) assert.ok(parseSfcAssignment(expression, modules).error, expression)
  // The full expression language: a numeric expression is a valid SP/OUT assignment.
  assert.deepEqual(parseSfcAssignment("'FIC-101/PID1/SP.CV' := 50 + 1", modules).value,
    { kind: 'sp', tag: 'FIC-101', value: 0, expression: '50 + 1' })
  assert.equal(JSON.stringify(modules), before)
})

test('SFC transition and timing expressions roundtrip confirmed conditions and reject unsupported syntax explicitly', () => {
  const modules = buildInitialPlant().modules
  modules['LEVEL-101'] = { tag: 'LEVEL-101', type: 'AO' }
  const conditions = [
    { kind: 'always' }, { kind: 'timer', seconds: 2.6 },
    { kind: 'pv', tag: 'FIC-101', op: '>=', value: 50 },
    { kind: 'pv', tag: 'TI-402', op: '<', value: 10 },
    { kind: 'out', tag: 'FIC-101', op: '>', value: 30 },
    { kind: 'motorRunning', tag: 'P-101', running: false },
    { kind: 'valveOpen', tag: 'XV-101', open: true },
    { kind: 'pv', tag: 'LEVEL-101', op: '<=', value: 500 },
    { kind: 'out', tag: 'LEVEL-101', op: '>', value: 55.5 }
  ]
  for (const condition of conditions) {
    assert.deepEqual(parseSfcCondition(conditionExpression(condition, modules[condition.tag]), modules), { value: condition })
  }
  for (const expression of [
    'T_ACTIVE >= -1', 'T_ACTIVE >= Infinity', 'T_ACTIVE >= 1e',
    "'XV-101/DC1/PV_D.CV' = 2",
    "'FIC-101/PID1/OUT.CV' > NaN", "'FIC-101/PID1/OUT.CV' > 0x10",
    "'LEVEL-101/PID1/OUT.CV' > 30",
    "'MISSING/DC1/PV_D.CV' = 1", "'MESSAGE' = 'NS-T101:STARTUP'"
  ]) assert.ok(parseSfcCondition(expression, modules).error, expression)
  // Previously refused simple-form limits that the full expression language now accepts, stored as expressions.
  for (const expression of ['FALSE', "'FIC-101/PID1/OUT.CV' = 30", "'P-101/DC1/OUT_D.CV' = 1",
    "'P-101/DC1/PV_D.CV' = 1 AND 'XV-101/DC1/PV_D.CV' = 1"]) {
    assert.deepEqual(parseSfcCondition(expression, modules), { value: { kind: 'expression', text: expression } }, expression)
  }
})

function withSfc(run) {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousWindow = global.window
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('pharma')
    store.createSfc('PROPS-TEST', 'FEED')
    store.setSfcSteps('PROPS-TEST', [{ id: 'step', name: 'FIRST',
      actions: [{ kind: 'sp', tag: 'FIC-101', value: 50 }], transition: { kind: 'timer', seconds: 10 } }])
    run(store, alerts)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
}

test('SFC Properties applies one validated draft atomically and Check is read-only', () => {
  withSfc(store => {
    const before = useStore.getState()
    const step = before.sfcs['PROPS-TEST'].steps[0]
    const draft = { actions: [{ ...step.actions[0], name: 'FLOW', qualifier: 'P', seconds: 4,
      description: 'Set flow after delay', value: 60 }] }
    assert.equal(before.modules['FIC-101'].sp, useStore.getState().modules['FIC-101'].sp)
    assert.equal(store.applySfcStepProperties('PROPS-TEST', step, draft), true)
    const after = useStore.getState()
    assert.equal(after.modules, before.modules)
    assert.deepEqual(after.sfcs['PROPS-TEST'].steps[0].actions, draft.actions)
    assert.equal(before.sfcs['PROPS-TEST'].steps[0].actions[0].value, 50)
    assert.deepEqual(after.sfcs['PROPS-TEST'].actionStates, {})
    const rev = after.rev
    assert.equal(store.checkSfc('PROPS-TEST'), null)
    assert.equal(useStore.getState().rev, rev)
    assert.equal(useStore.getState().sfcs, after.sfcs)
    assert.equal(useStore.getState().modules, before.modules)
    assert.match(useStore.getState().eventLog.at(-1).description, /Check passed/)
  })
})

test('SFC Properties rejects invalid, stale, deleted, running and unauthorized edits without overwrites', () => {
  withSfc((store, alerts) => {
    const step = useStore.getState().sfcs['PROPS-TEST'].steps[0]
    const sfcs = useStore.getState().sfcs
    assert.equal(store.applySfcStepProperties('PROPS-TEST', step,
      { actions: [{ ...step.actions[0], qualifier: 'D', seconds: -1 }] }), false)
    assert.equal(useStore.getState().sfcs, sfcs)
    assert.match(alerts.at(-1), /finite and nonnegative/)
    assert.equal(store.applySfcStepProperties('PROPS-TEST', step, { transition: { kind: 'pv', tag: 'MISSING', op: '>', value: 1 } }), false)
    assert.equal(useStore.getState().sfcs, sfcs)
    store.setSfcSteps('PROPS-TEST', [{ ...step, name: 'EDITED ELSEWHERE' }])
    const changed = useStore.getState().sfcs
    assert.equal(store.applySfcStepProperties('PROPS-TEST', step, { name: 'STALE' }), false)
    assert.equal(useStore.getState().sfcs, changed)
    assert.match(alerts.at(-1), /changed while Properties/)
    const current = changed['PROPS-TEST'].steps[0]
    store.sfcCommand('PROPS-TEST', 'run')
    const running = useStore.getState().sfcs
    assert.equal(store.applySfcStepProperties('PROPS-TEST', current, { name: 'RUNNING EDIT' }), false)
    assert.equal(useStore.getState().sfcs, running)
    assert.match(alerts.at(-1), /Reset/)
    store.sfcCommand('PROPS-TEST', 'reset')
    useSecurity.setState({ currentUser: 'OperatorA' })
    const denied = useStore.getState().sfcs
    assert.equal(store.applySfcStepProperties('PROPS-TEST', current, { name: 'DENIED' }), false)
    assert.equal(useStore.getState().sfcs, denied)
    useSecurity.setState({ currentUser: 'admin' })
    store.deleteSfc('PROPS-TEST')
    const deleted = useStore.getState().sfcs
    assert.equal(store.applySfcStepProperties('PROPS-TEST', current, { name: 'DELETED' }), false)
    assert.equal(useStore.getState().sfcs, deleted)
    assert.match(alerts.at(-1), /no longer exists/)
  })
})

test('Check exposes invalid algorithms rather than changing or starting them', () => {
  withSfc(store => {
    const step = useStore.getState().sfcs['PROPS-TEST'].steps[0]
    store.setSfcSteps('PROPS-TEST', [{ ...step, actions: [{ ...step.actions[0], qualifier: 'R', name: 'NO-STORED' }] }])
    const before = useStore.getState()
    assert.match(store.checkSfc('PROPS-TEST'), /no stored action/)
    assert.equal(useStore.getState().sfcs, before.sfcs)
    assert.equal(useStore.getState().modules, before.modules)
    assert.match(useStore.getState().eventLog.at(-1).description, /Check failed/)
    store.setSfcSteps('PROPS-TEST', [])
    assert.match(store.checkSfc('PROPS-TEST'), /at least one step/)
    assert.match(store.checkSfc('MISSING'), /does not exist/)
  })
})
