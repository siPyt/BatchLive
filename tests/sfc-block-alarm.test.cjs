const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useStore, sfcExpressionContext } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { advanceSfcs, sfcStepsError } = require('../src/renderer/src/engine/sfc.ts')
const { cloneSfcBlocks, sfcBlockConfigurationError, reconcileSfcAlarms, isSfcAlarm } = require('../src/renderer/src/engine/sfcBlocks.ts')
const { useUi } = require('../src/renderer/src/ui/uiStore.ts')
const { parseSfcBlockAction, parseSfcAssignment, assignmentExpression } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { cloneSfcConfiguration, parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const NAME = 'TIME-SFC'
const ID = `${NAME}.SFC.TIME_ALM`
const blocks = () => ({
  blocks: { TIMECHK: { type: 'ALARM', source: 'ACTION_TIME', op: '>', seconds: 30 } },
  alarmTypes: { TIMEOUT: { description: 'Sequence time exceeded', priority: 'WARNING' } },
  alarms: { TIME_ALM: { type: 'TIMEOUT', block: 'TIMECHK', enabled: true } }
})
const monitor = (qualifier = 'S') => ({ kind: 'block', tag: NAME, block: 'TIMECHK', name: 'TIME_MONITOR', qualifier })
const step = (id, actions = [], seconds = 1000) => ({ id, name: id, actions, transition: { kind: 'timer', seconds } })
const chart = state => state.sfcs[NAME]
function make(steps = [step('a', [monitor()])], configuration = blocks()) {
  return { ...useStore.getState(), sfcs: { [NAME]: { name: NAME, area: 'FEED', status: 'RUNNING',
    active: 0, elapsed: 0, ...configuration, steps } } }
}
function scan(state, dt = .1) {
  const next = { ...state, ...advanceSfcs(state, state.modules, dt), alarms: state.alarms.map(item => ({ ...item })) }
  reconcileSfcAlarms(next.alarms, next.sfcs, next.time)
  return next
}
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const storage = new Map()
  const alerts = []
  global.window = { alert: message => alerts.push(message), localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    useStore.getState().newProject('pharma')
    useStore.setState({ running: true })
    run(useStore.getState(), storage, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function configure(store, steps = [step('a', [monitor()])]) {
  assert.equal(store.createSfc(NAME, 'FEED', { managed: true }), true)
  assert.equal(store.configureSfcBlocks(NAME, blocks(), useStore.getState().sfcLifecycle[NAME].draft), true)
  store.setSfcSteps(NAME, steps)
  assert.equal(store.checkSfc(NAME), null)
  assert.equal(store.configureSfcController(NAME, 'CTLR-01'), true)
  assert.equal(store.saveSfc(NAME), true)
  assert.equal(store.downloadSavedSfc(NAME), true)
  assert.equal(store.setSfcOnline(NAME, true), true)
  store.sfcCommand(NAME, 'run')
}
test('Non-Boolean block references round trip independently of Boolean references and assignments', () => {
  const state = make()
  const context = { name: NAME, parameters: {}, sets: {}, blocks: chart(state).blocks }
  assert.deepEqual(parseSfcBlockAction("'TIMECHK'", context).value, { kind: 'block', tag: NAME, block: 'TIMECHK' })
  assert.equal(assignmentExpression(monitor()), "'TIMECHK'")
  for (const text of ["'MISSING'", "'TIMECHK.CV'", "'TIMECHK' := 1", "'OTHER/TIMECHK'", 'TIMECHK']) {
    assert.ok(parseSfcBlockAction(text, context).error, text)
  }
  assert.ok(parseSfcBlockAction("'TIMECHK'").error)
  assert.ok(parseSfcAssignment("'TIMECHK'", state.modules, context).error)
  assert.equal(sfcStepsError(chart(state).steps, state.modules, context), null)
  assert.ok(sfcStepsError([step('a', [{ ...monitor(), tag: 'OTHER' }])], state.modules, context))
  assert.ok(sfcStepsError([step('a', [{ ...monitor(), block: 'MISSING' }])], state.modules, context))
})
test('shared ALARM block execution triggers strictly above 30 seconds, not at a floating-point 300-scan deadline', () => {
  let state = make()
  const initial = state
  for (let count = 0; count < 300; count++) state = scan(state)
  assert.ok(Math.abs(chart(state).blockStates.TIMECHK.elapsed - 30) < 1e-10)
  assert.equal(chart(state).blockStates.TIMECHK.out, 0)
  assert.equal(state.alarms.some(alarm => alarm.id === ID), false)
  assert.equal(chart(initial).blockStates, undefined)
  state = scan(state)
  const alarm = state.alarms.find(alarm => alarm.id === ID)
  assert.equal(chart(state).blockStates.TIMECHK.out, 1)
  assert.equal(alarm.active, true)
  assert.equal(alarm.type, 'CUSTOM')
  assert.equal(alarm.customType, 'TIMEOUT')
  assert.equal(alarm.priority, 'WARNING')
  assert.equal(alarm.unit, 's')
  assert.ok(Math.abs(alarm.value - 30.1) < 1e-9)
})
test('no action activation or disabled alarm cannot fabricate a timeout; >= remains explicitly inclusive', () => {
  let state = scan(make([step('a')]), 100)
  assert.equal(state.alarms.some(alarm => alarm.id === ID), false)
  const configuration = blocks()
  configuration.alarms.TIME_ALM.enabled = false
  state = scan(make(undefined, configuration), 31)
  assert.equal(chart(state).blockStates.TIMECHK.out, 1)
  assert.equal(state.alarms.some(alarm => alarm.id === ID), false)
  configuration.blocks.TIMECHK.op = '>='
  configuration.alarms.TIME_ALM.enabled = true
  state = scan(make(undefined, configuration), 30)
  assert.equal(state.alarms.find(alarm => alarm.id === ID).active, true)
})
test('stored monitor continues once per scan across steps, while N departure and R reset clear activation/alarm', () => {
  let state = make([step('start', [monitor()], 5), step('wait')])
  state = scan(state, 5)
  assert.equal(chart(state).active, 1)
  state = scan(state, 25)
  assert.equal(state.alarms.some(alarm => alarm.id === ID), false)
  state = scan(state, .1)
  assert.equal(state.alarms.find(alarm => alarm.id === ID).active, true)
  state = make([step('start', [monitor('N')], 5), step('wait')])
  state = scan(scan(state, 5), 26)
  assert.equal(chart(state).blockStates.TIMECHK.active, false)
  assert.equal(state.alarms.some(alarm => alarm.id === ID), false)
  state = make([step('start', [monitor()], 31), step('reset', [monitor('R')])])
  state = scan(state, 30.1)
  assert.equal(state.alarms.find(alarm => alarm.id === ID).active, true)
  state = scan(state, .9)
  assert.equal(chart(state).blockStates.TIMECHK.active, false)
  assert.equal(state.alarms.find(alarm => alarm.id === ID).active, false)
})
test('HOLD and controller outage freeze monitor time/output; completion returns unacknowledged alarms to normal', () => {
  let state = scan(make([step('start', [monitor()], 40)]), 30.1)
  const before = chart(state).blockStates.TIMECHK
  state = { ...state, sfcs: { [NAME]: { ...chart(state), status: 'HELD' } } }
  assert.deepEqual(chart(scan(state, 10)).blockStates.TIMECHK, before)
  state = { ...state, sfcs: { [NAME]: { ...chart(state), status: 'RUNNING' } } }
  state = scan(state, 9.9)
  assert.equal(chart(state).status, 'COMPLETE')
  assert.equal(chart(state).blockStates.TIMECHK.active, false)
  assert.equal(state.alarms.find(alarm => alarm.id === ID).active, false)
  fixture(store => {
    configure(store)
    store.tick(30)
    const controller = useStore.getState().hardware.controllers['CTLR-01']
    useStore.setState({ hardware: { ...useStore.getState().hardware,
      controllers: { ...useStore.getState().hardware.controllers, 'CTLR-01': { ...controller, commissioned: false } } } })
    const elapsed = chart(useStore.getState()).blockStates.TIMECHK.elapsed
    store.tick(10)
    assert.equal(chart(useStore.getState()).blockStates.TIMECHK.elapsed, elapsed)
    assert.equal(useStore.getState().alarms.some(alarm => alarm.id === ID), false)
  })
})
test('parallel stored block clocks advance once per frame, and duplicate block owners reject even with distinct action names', () => {
  const steps = [
    { ...step('fork', [monitor()]), transition: { kind: 'always' }, parallelNextSteps: ['a', 'b'] },
    { ...step('a', [], 40), nextStep: 'join' }, { ...step('b', [], 50), nextStep: 'join' },
    { ...step('join'), joinFrom: ['a', 'b'] }
  ]
  let state = make(steps)
  const context = { name: NAME, parameters: {}, sets: {}, blocks: chart(state).blocks }
  assert.equal(sfcStepsError(steps, state.modules, context), null)
  state = scan(state, .1)
  state = scan(state, 30)
  assert.deepEqual(chart(state).activeSteps, { a: 30, b: 30 })
  assert.ok(Math.abs(chart(state).blockStates.TIMECHK.elapsed - 30.1) < 1e-9)
  assert.equal(state.alarms.find(alarm => alarm.id === ID).active, true)
  const duplicate = [step('a', [monitor()]), step('b', [{ ...monitor(), name: 'OTHER' }])]
  assert.match(sfcStepsError(duplicate, state.modules, context), /one owning/i)
})
test('custom alarm types, bindings and blocks are saved/deployed as independent configuration without live output', () => {
  const state = make()
  const configuration = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01', steps: chart(state).steps, ...blocks() }
  const clone = cloneSfcConfiguration(configuration)
  clone.blocks.TIMECHK.seconds = 5
  clone.alarmTypes.TIMEOUT.priority = 'CRITICAL'
  clone.alarms.TIME_ALM.enabled = false
  assert.equal(configuration.blocks.TIMECHK.seconds, 30)
  assert.equal(configuration.alarmTypes.TIMEOUT.priority, 'WARNING')
  assert.equal(configuration.alarms.TIME_ALM.enabled, true)
  assert.deepEqual(parseSavedSfc(serializeSavedSfc(configuration), state.modules).configuration, cloneSfcConfiguration(configuration))
  for (const field of [
    { blocks: { TIMECHK: { type: 'ACT', source: 'ACTION_TIME', op: '>', seconds: 30 } } },
    { blocks: { TIMECHK: { type: 'ALARM', source: 'ACTION_TIME', op: '>', seconds: -1 } } },
    { blocks: [] }, { alarmTypes: { TIMEOUT: { description: '', priority: 'WARNING' } } },
    { alarmTypes: { TIMEOUT: { description: 'Bad', priority: 'INVALID' } } },
    { alarms: { TIME_ALM: { type: 'MISSING', block: 'TIMECHK', enabled: true } } },
    { alarms: { TIME_ALM: { type: 'TIMEOUT', block: 'MISSING', enabled: true } } },
    { alarms: { TIME_ALM: { type: 'TIMEOUT', block: 'TIMECHK', enabled: 'true' } } }
  ]) {
    assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: { ...configuration, ...field } }), state.modules).error)
  }
  assert.equal(sfcBlockConfigurationError(blocks()), null)
  assert.notEqual(cloneSfcBlocks(configuration).blocks, configuration.blocks)
})
test('stale, locked, running and invalid block/type/alarm Properties reject atomically without changing saved deployment', () => {
  fixture(store => {
    configure(store)
    let lifecycle = useStore.getState().sfcLifecycle[NAME]
    const expected = lifecycle.draft
    assert.equal(store.configureSfcBlocks(NAME, blocks(), expected), false)
    store.sfcCommand(NAME, 'reset')
    assert.equal(store.setSfcOnline(NAME, false), true)
    lifecycle = useStore.getState().sfcLifecycle[NAME]
    const invalid = blocks()
    invalid.blocks.TIMECHK.seconds = NaN
    assert.equal(store.configureSfcBlocks(NAME, invalid, expected), false)
    assert.equal(useStore.getState().sfcLifecycle[NAME], lifecycle)
    useSecurity.setState({ locked: true })
    assert.equal(store.configureSfcBlocks(NAME, blocks(), expected), false)
    useSecurity.setState({ locked: false })
    const changed = blocks()
    changed.blocks.TIMECHK.seconds = 10
    assert.equal(store.configureSfcBlocks(NAME, changed, expected), true)
    assert.equal(store.configureSfcBlocks(NAME, blocks(), expected), false)
    lifecycle = useStore.getState().sfcLifecycle[NAME]
    assert.equal(lifecycle.saved.blocks.TIMECHK.seconds, 30)
    assert.equal(lifecycle.deployed.blocks.TIMECHK.seconds, 30)
    assert.equal(chart(useStore.getState()).blocks.TIMECHK.seconds, 30)
    assert.equal(lifecycle.draft.blocks.TIMECHK.seconds, 10)
    assert.equal(store.configureSfcBlocks(NAME, {}, lifecycle.draft), false)
    const unmanaged = { ...chart(make()), status: 'READY',
      parameters: { ACTIVE: { type: 'BOOLEAN', value: true } },
      steps: [step('edit', [monitor(), { kind: 'boolean', tag: NAME, parameter: 'ACTIVE',
        qualifier: 'S', name: 'ACTIVE_FLAG' }])],
      blockStates: { TIMECHK: { active: true, elapsed: 31, out: 1, bad: false } } }
    useStore.setState({ sfcs: { [NAME]: unmanaged }, sfcLifecycle: {} })
    assert.equal(store.applySfcStepProperties(NAME, unmanaged.steps[0], { name: 'edited' }), true)
    assert.deepEqual(chart(useStore.getState()).blockStates, {})
    assert.equal(chart(useStore.getState()).parameters.ACTIVE.value, false)
    assert.equal(chart(useStore.getState()).status, 'READY')
  })
})
test('real store alarms journal one ALARM/RTN edge, re-sound on retrigger, and support silence, shelving, ACK and reset', () => {
  fixture(store => {
    configure(store)
    store.tick(30)
    assert.equal(useStore.getState().alarms.some(alarm => alarm.id === ID), false)
    store.silenceHorn()
    store.tick(.1)
    let state = useStore.getState()
    assert.equal(state.hornSilenced, false)
    assert.equal(state.eventLog.filter(event => event.tag === NAME && event.category === 'ALARM').length, 1)
    const firstTime = state.alarms.find(alarm => alarm.id === ID).time
    store.tick(.1)
    assert.equal(useStore.getState().eventLog.filter(event => event.tag === NAME && event.category === 'ALARM').length, 1)
    store.shelveAlarm(ID, 60)
    assert.ok(useStore.getState().alarms.find(alarm => alarm.id === ID).shelvedUntil)
    store.unshelveAlarm(ID)
    assert.equal(useStore.getState().alarms.find(alarm => alarm.id === ID).shelvedUntil, undefined)
    store.sfcCommand(NAME, 'reset')
    store.tick(.1)
    assert.equal(useStore.getState().alarms.find(alarm => alarm.id === ID).active, false)
    assert.equal(useStore.getState().eventLog.filter(event => event.tag === NAME && event.category === 'RTN').length, 1)
    store.silenceHorn()
    store.sfcCommand(NAME, 'run')
    store.tick(30.1)
    state = useStore.getState()
    assert.equal(state.hornSilenced, false)
    assert.equal(state.eventLog.filter(event => event.tag === NAME && event.category === 'ALARM').length, 2)
    assert.ok(state.alarms.find(alarm => alarm.id === ID).time > firstTime)
    store.ackAlarm(ID)
    assert.equal(useStore.getState().alarms.find(alarm => alarm.id === ID).acknowledged, true)
    store.sfcCommand(NAME, 'reset')
    store.tick(.1)
    assert.equal(useStore.getState().alarms.some(alarm => alarm.id === ID), false)
    assert.ok(useStore.getState().eventLog.some(event => event.tag === NAME && event.category === 'ACK'))
  })
})
test('removing an SFC alarm returns an unacknowledged record to normal and clears an acknowledged one', () => {
  const state = scan(make(), 30.1)
  const alarms = state.alarms.map(alarm => ({ ...alarm }))
  reconcileSfcAlarms(alarms, {}, state.time + 100)
  assert.equal(alarms.find(alarm => alarm.id === ID).active, false)
  const retained = alarms.find(alarm => alarm.id === ID)
  assert.equal(isSfcAlarm(retained), true)
  assert.equal(isSfcAlarm({ ...retained, type: 'HI' }), false)
  assert.equal(isSfcAlarm({ ...retained, id: 'OTHER.CUSTOM' }), false)
  fixture((store, storage, alerts) => {
    const before = useUi.getState()
    assert.equal(useUi.getState().openSfc(retained.moduleTag), false)
    assert.equal(useUi.getState(), before)
    assert.match(alerts[0], /SFC not found/)
    assert.ok(useStore.getState().eventLog.some(event =>
      event.category === 'DIAGNOSTIC' && event.tag === NAME && event.description.includes('SFC not found')))
  })
  alarms.find(alarm => alarm.id === ID).acknowledged = true
  reconcileSfcAlarms(alarms, {}, state.time + 200)
  assert.equal(alarms.some(alarm => alarm.id === ID), false)
})
