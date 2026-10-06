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
const { advanceSfcs, evalCondition, sfcStepsError, describeAction, describeCondition } = require('../src/renderer/src/engine/sfc.ts')
const { parseSfcCondition, parseSfcAssignment, conditionExpression, assignmentExpression } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { evalLogicNumber, logicError, LOGIC_MAX_LENGTH } = require('../src/renderer/src/engine/sfcLogic.ts')
const { cloneSfcConfiguration, parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')

const NAME = 'LOGIC-TEST'
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
const context = {
  name: NAME,
  parameters: { ACTIVE: { type: 'BOOLEAN', value: true }, PHASE: { type: 'NAMED_SET', namedSet: 'STAGES', value: 2 } },
  sets: { STAGES: { name: 'STAGES', description: '', entries: [{ name: 'FILL', value: 1 }, { name: 'HEAT', value: 2 }] } }
}
/** Build a state whose modules carry the given overrides, then evaluate an expression condition. */
function stateWith(patch = {}) {
  const base = useStore.getState()
  const modules = { ...base.modules }
  for (const [tag, fields] of Object.entries(patch)) modules[tag] = { ...modules[tag], ...fields }
  return { ...base, modules }
}
const run = (text, patch = {}, elapsed = 0) => evalCondition({ kind: 'expression', text }, stateWith(patch), elapsed, context)
const num = (text, patch = {}, elapsed = 0) => evalLogicNumber(text, stateWith(patch), elapsed, context)
const problem = (text, want = 'boolean') => logicError(text, useStore.getState().modules, context, want)
const LIC = "'^/LIC-101/PID1/PV.CV'"
const FIC = "'^/FIC-101/PID1/PV.CV'"

test('DV09-064 expressions: arithmetic precedence, parentheses and unary minus follow the grammar', () => fixture(() => {
  assert.equal(run('2 + 3 * 4 = 14'), true)
  assert.equal(run('(2 + 3) * 4 = 20'), true)
  assert.equal(run('10 - 4 - 3 = 3'), true)
  assert.equal(run('-2 * -3 = 6'), true)
  assert.equal(run('7 / 2 = 3.5'), true)
  assert.equal(run('0.1 + 0.2 = 0.3'), true, 'tolerant numeric equality')
  assert.equal(run('1e2 > 99'), true)
  assert.equal(run('2 <> 3'), true)
  assert.equal(run('2 != 2'), false)
  assert.equal(run('2 >= 2 AND 2 <= 2 AND NOT 2 > 2 AND NOT 2 < 2'), true)
}))

test('DV09-064 expressions: AND/OR/XOR/NOT precedence and TRUE/FALSE', () => fixture(() => {
  assert.equal(run('TRUE OR FALSE AND FALSE'), true, 'AND binds tighter than OR')
  assert.equal(run('(TRUE OR FALSE) AND FALSE'), false)
  assert.equal(run('NOT FALSE AND TRUE'), true)
  assert.equal(run('NOT (TRUE AND FALSE)'), true)
  assert.equal(run('TRUE XOR TRUE'), false)
  assert.equal(run('TRUE XOR FALSE'), true)
  assert.equal(run('true and not false'), true, 'keywords are case-insensitive')
}))

test('DV09-064 expressions: functions ABS SQRT ROUND MIN MAX and IF', () => fixture(() => {
  assert.equal(num('ABS(-4.5)'), 4.5)
  assert.equal(num('SQRT(16) + 1'), 5)
  assert.equal(num('ROUND(2.567, 1)'), 2.6)
  assert.equal(num('ROUND(2.5)'), 3)
  assert.equal(num('MIN(3, 1, 2)'), 1)
  assert.equal(num('MAX(3, 1, 2) * 2'), 6)
  assert.equal(num('IF(1 < 2, 10, 20)'), 10)
  assert.equal(num('IF(NOT (1 < 2), 10, 20)'), 20)
  assert.equal(num('SQRT(-1)'), null, 'invalid arithmetic is unknown, not NaN')
  assert.equal(num('1 / 0'), null, 'division by zero is unknown')
}))

test('DV09-064 expressions: module paths, two-sided comparisons, discrete values and T_ACTIVE', () => fixture(() => {
  assert.equal(run(`${LIC} > 10`, { 'LIC-101': { pv: 60 } }), true)
  assert.equal(run(`${LIC} > ${FIC}`, { 'LIC-101': { pv: 60 }, 'FIC-101': { pv: 40 } }), true)
  assert.equal(run(`${LIC} > ${FIC}`, { 'LIC-101': { pv: 30 }, 'FIC-101': { pv: 40 } }), false)
  assert.equal(run(`${LIC} - ${FIC} >= 15`, { 'LIC-101': { pv: 60 }, 'FIC-101': { pv: 45 } }), true)
  assert.equal(run(`ABS(${LIC} - ${FIC}) < 5 AND ${LIC} > 0`, { 'LIC-101': { pv: 50 }, 'FIC-101': { pv: 48 } }), true)
  assert.equal(run("'^/P-101/DC1/PV_D.CV' = 1", { 'P-101': { running: true } }), true)
  assert.equal(run("'^/P-101/DC1/PV_D.CV' = TRUE AND '^/XV-101/DC1/PV_D.CV' = FALSE", { 'P-101': { running: true }, 'XV-101': { open: false } }), true)
  assert.equal(run("'^/P-101/DC1/OUT_D.CV' <> 0", { 'P-101': { commanded: true } }), true)
  assert.equal(run('T_ACTIVE >= 5 AND T_ACTIVE < 9', {}, 6), true)
  assert.equal(run('T_ACTIVE >= 5 AND T_ACTIVE < 9', {}, 4), false)
  assert.equal(run('T_ACTIVE >= 0.3', {}, 0.1 + 0.2), true, 'fractional scan time reaches its deadline')
  assert.equal(run("'^/FIC-101/PID1/SP.CV' = 25 AND '^/FIC-101/PID1/OUT.CV' < 90", { 'FIC-101': { sp: 25, out: 40 } }), true)
}))

test('DV09-064 expressions: mode names and codes compare against actual and target modes', () => fixture(() => {
  assert.equal(run("'^/FIC-101/PID1/MODE.ACTUAL' = AUTO", { 'FIC-101': { actualMode: 'AUTO' } }), true)
  assert.equal(run("'^/FIC-101/PID1/MODE.ACTUAL' = 'cas' OR '^/FIC-101/PID1/MODE.ACTUAL' = AUTO", { 'FIC-101': { actualMode: 'CAS' } }), true)
  assert.equal(run("'^/FIC-101/PID1/MODE.ACTUAL' = 16", { 'FIC-101': { actualMode: 'AUTO' } }), true, 'numeric mode code')
  assert.equal(run("'^/FIC-101/PID1/MODE.TARGET' <> MAN", { 'FIC-101': { mode: 'AUTO' } }), true)
  assert.equal(run("'^/FIC-101/PID1/MODE.ACTUAL' <> LO", { 'FIC-101': { actualMode: 'AUTO' } }), true)
  assert.match(problem("'^/FIC-101/PID1/MODE.ACTUAL' = BOGUS"), /Unsupported actual mode/)
}))

test('DV09-064 expressions: local Boolean and Named Set parameters are read live', () => fixture(() => {
  assert.equal(run("'ACTIVE.CV' AND '^/LIC-101/PID1/PV.CV' > 0"), true)
  assert.equal(run("'ACTIVE' = TRUE"), true)
  assert.equal(run("NOT 'ACTIVE.CV'"), false)
  assert.equal(run("'PHASE' = 'STAGES:HEAT'"), true)
  assert.equal(run("'PHASE' = 'STAGES:FILL' OR 'ACTIVE.CV'"), true)
  assert.equal(run("'PHASE' <> 'STAGES:FILL'"), true)
  assert.match(problem("'PHASE' = 'STAGES:NOPE'"), /does not exist/)
  assert.match(problem("'PHASE' = 'OTHER:HEAT'"), /bound to STAGES/)
  assert.match(problem("'PHASE' = HEAT"), /SET:ENTRY/)
}))

test('DV09-064 expressions: three-valued logic - a Bad source never satisfies a transition', () => fixture(() => {
  const bad = { 'LIC-101': { pv: 60, pvBad: true } }
  assert.equal(run(`${LIC} > 10`, bad), false)
  assert.equal(run(`NOT (${LIC} > 10)`, bad), false, 'NOT of unknown stays unknown')
  assert.equal(run(`${LIC} > 10 OR TRUE`, bad), true, 'OR resolves when the other side decides')
  assert.equal(run(`${LIC} > 10 AND FALSE`, bad), false)
  assert.equal(run(`${LIC} > 10 AND TRUE`, bad), false, 'AND of unknown and true is unknown')
  assert.equal(run(`${LIC} <> 5`, bad), false)
  assert.equal(num(`${LIC} * 2`, bad), null)
  assert.equal(run("'^/P-101/DC1/PV_D.CV' = 1", { 'P-101': { running: true, ioInputBad: true } }), false)
  assert.equal(run(`${LIC} > 10`, { 'LIC-101': { pv: 60, actualMode: 'OOS' } }), false, 'OOS PID is bad')
}))

test('DV09-064 expressions: rejected syntax, types, references and limits', () => fixture(() => {
  assert.match(problem('(1 + 2 > 2'), /Expected '\)'/)
  assert.match(problem('1 + > 2'), /Unexpected/)
  assert.match(problem('1 < 2 < 3'), /chained/)
  assert.match(problem('FOO(1) > 0'), /Unknown function FOO/)
  assert.match(problem('ABS(1, 2) > 0'), /takes 1/)
  assert.match(problem('1 AND 2'), /true\/false/)
  assert.match(problem('TRUE + 1 > 0'), /numeric/)
  assert.match(problem('1 + 2'), /true or false/)
  assert.match(problem("TRUE > FALSE"), /compares numbers only/)
  assert.match(problem("'^/NOPE-1/PID1/PV.CV' > 0"), /does not exist/)
  assert.match(problem("'^/LIC-101/PID1/KP.CV' > 0"), /Unsupported path/)
  assert.match(problem("'MISSING' AND TRUE"), /Unknown|requires|reference/i)
  assert.match(problem('1 $ 2'), /Unexpected character/)
  assert.match(problem("'^/LIC-101/PID1/PV.CV > 0"), /closing quote/)
  assert.match(problem('1 + '.repeat(5) + '1 > 0 AND ' + 'x'.repeat(LOGIC_MAX_LENGTH)), /limited to/)
  assert.match(problem('('.repeat(60) + '1' + ')'.repeat(60) + ' > 0'), /nested too deeply/)
  assert.match(problem('IF(1 > 2, 3) > 0'), /takes 3/)
  assert.match(problem("IF(1, 2, 3) > 0"), /true\/false condition/)
  assert.equal(problem('1 + 2', 'number'), null)
  assert.match(problem('1 < 2', 'number'), /produce a number/)
}))

test('DV09-064 expressions: parseSfcCondition keeps simple forms and falls back to expressions', () => fixture(() => {
  const modules = useStore.getState().modules
  const parse = (text) => parseSfcCondition(text, modules, context)
  assert.equal(parse('T_ACTIVE >= 5').value.kind, 'timer')
  assert.equal(parse('TRUE').value.kind, 'always')
  assert.equal(parse("'^/LIC-101/AI1/PV.CV' > 5").value.kind, 'pv')
  assert.equal(parse("'^/FIC-101/PID1/MODE.ACTUAL' = AUTO").value.kind, 'mode')
  assert.equal(parse("'ACTIVE.CV' = TRUE").value.kind, 'boolean')
  assert.deepEqual(parse("'^/LIC-101/PID1/PV.CV' > 5 AND T_ACTIVE >= 2").value, { kind: 'expression', text: "'^/LIC-101/PID1/PV.CV' > 5 AND T_ACTIVE >= 2" })
  assert.equal(parse("'^/LIC-101/PID1/PV.CV' > '^/FIC-101/PID1/PV.CV'").value.kind, 'expression')
  assert.equal(parse("'^/LIC-101/PID1/PV.CV' > 5 + 3").value.kind, 'expression')
  assert.match(parse("'^/LIC-101/PID1/PV.CV' > 5 AND (").error, /Expected|ended unexpectedly|Unexpected/)
  assert.match(parse('banana').error, /Use TRUE, T_ACTIVE/, 'a plain non-expression keeps the simple-form error')
  const expression = parse("NOT ('^/P-101/DC1/PV_D.CV' = 1) OR T_ACTIVE >= 3").value
  assert.equal(conditionExpression(expression), "NOT ('^/P-101/DC1/PV_D.CV' = 1) OR T_ACTIVE >= 3")
  assert.equal(describeCondition(expression), "NOT ('^/P-101/DC1/PV_D.CV' = 1) OR T_ACTIVE >= 3")
  assert.equal(parse(conditionExpression(expression)).value.text, expression.text, 'round-trips through the Properties text')
}))

test('DV09-064 expressions: parseSfcAssignment accepts numeric SP/OUT expressions only', () => fixture(() => {
  const modules = useStore.getState().modules
  const parse = (text) => parseSfcAssignment(text, modules, context)
  const sp = parse("'^/FIC-101/PID1/SP.CV' := '^/LIC-101/PID1/PV.CV' * 0.5 + 10")
  assert.deepEqual(sp.value, { kind: 'sp', tag: 'FIC-101', value: 0, expression: "'^/LIC-101/PID1/PV.CV' * 0.5 + 10" })
  assert.equal(parse("'^/FIC-101/PID1/SP.CV' := 42").value.expression, undefined, 'literals stay literals')
  assert.equal(parse("'^/FIC-101/PID1/SP.CV' := 42").value.value, 42)
  assert.equal(parse("'^/FIC-101/PID1/OUT.CV' := MIN(80, '^/LIC-101/PID1/PV.CV')").value.kind, 'out')
  assert.match(parse("'^/FIC-101/PID1/SP.CV' := '^/LIC-101/PID1/PV.CV' > 5").error, /produce a number/)
  assert.match(parse("'^/FIC-101/PID1/SP.CV' := banana").error, /finite numeric literal/)
  assert.match(parse("'^/FIC-101/PID1/SP.CV' := '^/NOPE/PID1/PV.CV' + 1").error, /does not exist/)
  assert.equal(assignmentExpression(sp.value, modules['FIC-101']), "'^/FIC-101/PID1/SP.CV' := '^/LIC-101/PID1/PV.CV' * 0.5 + 10")
  assert.equal(describeAction(sp.value, modules['FIC-101']), "^/FIC-101/PID1/SP.CV := '^/LIC-101/PID1/PV.CV' * 0.5 + 10")
}))

test('DV09-064 expressions: an SFC runs expression transitions and recomputes expression assignments every scan', () => fixture((store) => {
  const modules = useStore.getState().modules
  const sp = parseSfcAssignment("'^/FIC-101/PID1/SP.CV' := IF('^/LIC-101/PID1/PV.CV' > 50, 80, '^/LIC-101/PID1/PV.CV' * 0.5)", modules, context).value
  const gate = parseSfcCondition("'^/LIC-101/PID1/PV.CV' >= 30 AND T_ACTIVE >= 0.3", modules, context).value
  assert.equal(gate.kind, 'expression')
  const steps = [
    { id: 'a', name: 'A', actions: [{ ...sp, qualifier: 'N' }], transition: gate, nextStep: 'b' },
    { id: 'b', name: 'B', actions: [], transition: { kind: 'always' }, nextStep: null }
  ]
  assert.equal(sfcStepsError(steps, modules, context), null)
  store.sfcCommand(NAME, 'reset')
  store.setSfcSteps(NAME, steps)
  store.sfcCommand(NAME, 'run')
  let state = { ...useStore.getState(), modules: { ...useStore.getState().modules, 'LIC-101': { ...useStore.getState().modules['LIC-101'], pv: 40 } } }
  const trace = []
  for (let i = 0; i < 6; i++) {
    state = { ...state, ...advanceSfcs(state, state.modules, 0.1) }
    trace.push(state.sfcs[NAME].steps[state.sfcs[NAME].active].id)
  }
  assert.equal(state.modules['FIC-101'].sp, 20, 'SP follows 0.5 x LIC-101 PV (40) while the step is active')
  assert.deepEqual(trace.slice(0, 2), ['a', 'a'], 'the gate waits for T_ACTIVE >= 0.3')
  assert.equal(state.sfcs[NAME].status, 'COMPLETE')
  // A level above 50 switches the IF branch on the next execution.
  const high = { ...state, modules: { ...state.modules, 'LIC-101': { ...state.modules['LIC-101'], pv: 60 } } }
  assert.equal(evalLogicNumber("IF('^/LIC-101/PID1/PV.CV' > 50, 80, 1)", high, 0, context), 80)
  // The gate never opens from a bad level.
  const badState = { ...useStore.getState(), modules: { ...useStore.getState().modules, 'LIC-101': { ...useStore.getState().modules['LIC-101'], pv: 40, pvBad: true } } }
  assert.equal(evalCondition(gate, badState, 5, context), false)
}))

test('DV09-064 expressions: Check rejects bad transition, route, delay and assignment expressions', () => fixture(() => {
  const modules = useStore.getState().modules
  const base = () => [{ id: 'a', name: 'A', actions: [{ kind: 'sp', tag: 'FIC-101', value: 1, qualifier: 'N' }], transition: { kind: 'always' }, nextStep: null }]
  assert.equal(sfcStepsError(base(), modules, context), null)
  const badTransition = base(); badTransition[0].transition = { kind: 'expression', text: '1 + ' }
  assert.ok(sfcStepsError(badTransition, modules, context))
  const badRoute = base(); badRoute[0].alternatives = [{ condition: { kind: 'expression', text: "'^/NOPE/PID1/PV.CV' > 1" }, nextStep: 'a' }]; badRoute[0].nextStep = null
  assert.ok(sfcStepsError(badRoute, modules, context))
  const badDelay = base(); badDelay[0].actions[0] = { ...badDelay[0].actions[0], qualifier: 'D', timingCondition: { kind: 'expression', text: 'T_ACTIVE' } }
  assert.match(sfcStepsError(badDelay, modules, context), /true or false/)
  const goodDelay = base(); goodDelay[0].actions[0] = { ...goodDelay[0].actions[0], qualifier: 'D', timingCondition: { kind: 'expression', text: 'T_ACTIVE >= 1 AND NOT FALSE' } }
  assert.equal(sfcStepsError(goodDelay, modules, context), null)
  const badAssignment = base(); badAssignment[0].actions[0].expression = "'^/NOPE/PID1/PV.CV' + 1"
  assert.match(sfcStepsError(badAssignment, modules, context), /does not exist/)
  const badType = base(); badType[0].actions[0].expression = 'TRUE'
  assert.match(sfcStepsError(badType, modules, context), /produce a number/)
}))

test('DV09-064 expressions: delay conditions drive timed qualifiers and survive Save/clone', () => fixture(() => {
  const modules = useStore.getState().modules
  const configuration = {
    name: NAME, area: 'FEED', controllerTag: 'CTLR-01',
    steps: [{
      id: 'a', name: 'A', nextStep: null,
      actions: [{ kind: 'sp', tag: 'FIC-101', value: 0, expression: "'^/LIC-101/PID1/PV.CV' / 2", qualifier: 'D',
        timingCondition: { kind: 'expression', text: "'^/LIC-101/PID1/PV.CV' > 20 AND T_ACTIVE >= 1" } }],
      transition: { kind: 'expression', text: "T_ACTIVE >= 2 OR '^/LIC-101/PID1/PV.CV' > 90" }
    }]
  }
  const copy = cloneSfcConfiguration(configuration)
  copy.steps[0].transition.text = 'changed'
  copy.steps[0].actions[0].expression = 'changed'
  assert.equal(configuration.steps[0].transition.text, "T_ACTIVE >= 2 OR '^/LIC-101/PID1/PV.CV' > 90")
  assert.equal(configuration.steps[0].actions[0].expression, "'^/LIC-101/PID1/PV.CV' / 2")
  const restored = parseSavedSfc(serializeSavedSfc(configuration), modules)
  assert.ok(!restored.error, restored.error)
  assert.deepEqual(restored.configuration, cloneSfcConfiguration(configuration))
  for (const mutate of [
    c => { c.steps[0].transition = { kind: 'expression', text: 5 } },
    c => { c.steps[0].transition = { kind: 'expression', text: '' } },
    c => { c.steps[0].actions[0].expression = 7 },
    c => { c.steps[0].actions[0].timingCondition = { kind: 'expression' } }
  ]) {
    const malformed = cloneSfcConfiguration(configuration)
    mutate(malformed)
    assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: malformed }), modules).error)
  }
}))

test('DV09-064 course syntax: absolute //TAG paths, MESSAGE.CV Named Set expressions and the workshop pulse-delay expressions', () => fixture(() => {
  const modules = useStore.getState().modules
  const parse = (text) => parseSfcCondition(text, modules, context)
  // Course 7009-8 p8-21: delay expression and action expression written with the // prefix.
  assert.equal(parse("'//FIC-101/PID1/MODE.ACTUAL' = MAN").value.kind, 'mode')
  assert.equal(run("'//FIC-101/PID1/MODE.ACTUAL' = MAN AND '//FIC-101/PID1/OUT.CV' < 5", { 'FIC-101': { actualMode: 'MAN', out: 0 } }), true)
  assert.equal(parse("'//XV-101/DC1/PV_D.CV' = 0").value.kind, 'valveOpen')
  const action = parseSfcAssignment("'//FIC-101/PID1/OUT.CV' := 0", modules, context)
  assert.deepEqual(action.value, { kind: 'out', tag: 'FIC-101', value: 0 })
  // p8-13 / p8-19: 'MESSAGE.CV' = 'NS-T101:STARTUP' with spaces and hyphens in the Named Set and entry names.
  const course = { name: NAME, parameters: { MESSAGE: { type: 'NAMED_SET', namedSet: 'NS-T101', value: 10 } },
    sets: { 'NS-T101': { name: 'NS-T101', description: '', entries: [{ name: 'SELECT SEQ', value: 0 }, { name: 'STARTUP', value: 10 }, { name: 'WAITING FOR BLK VLV TO OPEN', value: 20 }] } } }
  assert.equal(parseSfcCondition("'MESSAGE.CV' = 'NS-T101:STARTUP'", modules, course).value.kind, 'namedSet')
  assert.equal(parseSfcAssignment("'MESSAGE.CV' := 'NS-T101:SELECT SEQ'", modules, course).value.kind, 'namedSet')
  assert.equal(parseSfcCondition("'MESSAGE.CV' = 'NS-T101:STARTUP' OR 'MESSAGE.CV' = 'NS-T101:WAITING FOR BLK VLV TO OPEN'", modules, course).value.kind, 'expression')
  assert.equal(evalCondition({ kind: 'expression', text: "'MESSAGE.CV' = 'NS-T101:STARTUP' AND '//FIC-101/PID1/OUT.CV' >= 0" }, stateWith({ 'FIC-101': { out: 3 } }), 0, course), true)
}))
