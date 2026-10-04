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
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const {
  savedSfcKey, sfcDraftDirty, sfcNeedsDownload, sfcEditorDefinition, parseSavedSfc, serializeSavedSfc
} = require('../src/renderer/src/engine/sfcLifecycle.ts')
const NAME = 'LIFE-TEST'
function steps(value = 50) {
  return [{ id: 'first', name: 'FIRST', actions: [{ kind: 'sp', tag: 'FIC-101', value, qualifier: 'N' }],
    transition: { kind: 'timer', seconds: 10 } }]
}
function withProject(run) {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousWindow = global.window
  const storage = new Map()
  const alerts = []
  global.window = { alert: message => alerts.push(message), localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null })
    const store = useStore.getState()
    store.newProject('pharma')
    store.setMode('FIC-101', 'AUTO')
    store.createSfc(NAME, 'FEED')
    store.setSfcSteps(NAME, steps())
    assert.equal(store.enableSfcLifecycle(NAME), true)
    run(store, storage, alerts)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
}
function lifecycle() { return useStore.getState().sfcLifecycle[NAME] }
function deploy(store) {
  assert.equal(store.configureSfcController(NAME, 'CTLR-01'), true)
  assert.equal(store.saveSfc(NAME), true)
  assert.equal(store.downloadSavedSfc(NAME), true)
  assert.equal(store.setSfcOnline(NAME, true), true)
}

test('managed SFC drafts, Save, Download and Online remain separate and only deployed commands execute', () => {
  withProject((store, storage) => {
    const originalRuntime = useStore.getState().sfcs[NAME]
    const initialSp = useStore.getState().modules['FIC-101'].sp
    store.sfcCommand(NAME, 'run')
    assert.equal(useStore.getState().sfcs[NAME], originalRuntime)
    assert.equal(store.setSfcOnline(NAME, true), false)
    store.setSfcSteps(NAME, steps(60))
    assert.equal(useStore.getState().sfcs[NAME], originalRuntime)
    assert.equal(lifecycle().draft.steps[0].actions[0].value, 60)
    assert.equal(sfcDraftDirty(lifecycle()), true)
    assert.equal(store.configureSfcController(NAME, 'CTLR-01'), true)
    assert.equal(store.saveSfc(NAME), true)
    assert.equal(sfcDraftDirty(lifecycle()), false)
    assert.equal(sfcNeedsDownload(lifecycle()), true)
    assert.equal(useStore.getState().modules['FIC-101'].sp, initialSp)
    assert.equal(useStore.getState().sfcs[NAME], originalRuntime)
    assert.deepEqual(parseSavedSfc(storage.get(savedSfcKey(NAME)), useStore.getState().modules).configuration, lifecycle().saved)
    assert.equal(store.downloadSavedSfc(NAME), true)
    assert.equal(useStore.getState().sfcs[NAME].status, 'READY')
    assert.equal(useStore.getState().modules['FIC-101'].sp, initialSp)
    assert.notEqual(lifecycle().draft.steps, lifecycle().saved.steps)
    assert.notEqual(lifecycle().saved.steps, lifecycle().deployed.steps)
    assert.notEqual(lifecycle().deployed.steps, useStore.getState().sfcs[NAME].steps)
    assert.equal(store.setSfcOnline(NAME, true), true)
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].status, 'RUNNING')
    assert.equal(useStore.getState().modules['FIC-101'].sp, 60)
    assert.equal(lifecycle().draft.steps[0].actions[0].value, 60)
    store.sfcCommand(NAME, 'reset')
    store.setSfcOnline(NAME, false)
    store.setSfcSteps(NAME, steps(70))
    assert.equal(useStore.getState().sfcs[NAME].steps[0].actions[0].value, 60)
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(store.setSfcOnline(NAME, true), true)
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    assert.equal(useStore.getState().modules['FIC-101'].sp, 60)
  })
})

test('Properties commits edit only managed drafts and reject online, stale and active edits atomically', () => {
  withProject(store => {
    const runtime = useStore.getState().sfcs[NAME]
    const expected = lifecycle().draft.steps[0]
    assert.equal(store.applySfcStepProperties(NAME, expected, { actions: [{ kind: 'sp', tag: 'FIC-101', value: 55 }] }), true)
    assert.equal(useStore.getState().sfcs[NAME], runtime)
    assert.equal(lifecycle().draft.steps[0].actions[0].value, 55)
    const after = lifecycle()
    assert.equal(store.applySfcStepProperties(NAME, expected, { name: 'STALE' }), false)
    assert.equal(lifecycle(), after)
    const controllerExpected = lifecycle().draft
    assert.equal(store.configureSfcController(NAME, 'CTLR-01', controllerExpected), true)
    assert.equal(store.configureSfcController(NAME, '', controllerExpected), false)
    deploy(store)
    const deployed = lifecycle()
    store.setSfcSteps(NAME, steps(99))
    assert.equal(lifecycle(), deployed)
    assert.equal(store.applySfcStepProperties(NAME, deployed.draft.steps[0], { name: 'ONLINE' }), false)
    assert.equal(store.saveSfc(NAME), false)
    assert.equal(store.loadSavedSfc(NAME), false)
    store.sfcCommand(NAME, 'run')
    assert.equal(store.setSfcOnline(NAME, false), true)
    const offlineChart = sfcEditorDefinition(useStore.getState().sfcs[NAME], lifecycle())
    assert.equal(offlineChart.status, 'READY')
    assert.equal(offlineChart.elapsed, 0)
    assert.deepEqual(offlineChart.actionStates, {})
    const active = lifecycle()
    store.setSfcSteps(NAME, steps(99))
    assert.equal(store.configureSfcController(NAME, ''), false)
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(lifecycle(), active)
    assert.equal(useStore.getState().sfcs[NAME].status, 'RUNNING')
  })
})

test('SFC execution pauses on assigned controller loss, retains timers and resumes only deployed actions', () => {
  withProject(store => {
    deploy(store)
    store.sfcCommand(NAME, 'run')
    store.tick(0.5)
    const before = useStore.getState().sfcs[NAME]
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], powerDownAt: 1 } } } })
    store.tick(3)
    assert.equal(useStore.getState().sfcs[NAME], before)
    store.sfcCommand(NAME, 'run')
    assert.equal(useStore.getState().sfcs[NAME], before)
    useStore.setState({ hardware })
    store.tick(0.5)
    assert.equal(useStore.getState().sfcs[NAME].elapsed, 1)
    assert.equal(useStore.getState().modules['FIC-101'].sp, 50)
  })
})

test('Save/load/storage/schema/target failures and stale confirmations leave deployed SFC unchanged', () => {
  withProject((store, storage) => {
    deploy(store)
    store.setSfcOnline(NAME, false)
    const original = lifecycle()
    const runtime = useStore.getState().sfcs[NAME]
    global.window.localStorage.setItem = () => { throw new Error('storage full') }
    assert.equal(store.saveSfc(NAME), false)
    assert.equal(lifecycle(), original)
    global.window.localStorage.setItem = (key, value) => storage.set(key, value)
    storage.set(savedSfcKey(NAME), '{')
    assert.equal(store.loadSavedSfc(NAME), false)
    assert.equal(lifecycle(), original)
    global.window.localStorage.getItem = () => { throw new Error('storage blocked') }
    assert.equal(store.loadSavedSfc(NAME), false)
    assert.equal(lifecycle(), original)
    global.window.localStorage.getItem = key => storage.get(key) ?? null
    const oldSaved = lifecycle().saved
    assert.equal(store.saveSfc(NAME), true)
    const beforeStale = lifecycle()
    assert.equal(store.downloadSavedSfc(NAME, oldSaved), false)
    assert.equal(lifecycle(), beforeStale)
    assert.equal(useStore.getState().sfcs[NAME], runtime)
    assert.equal(store.configureSfcController(NAME, 'MISSING'), false)
    assert.equal(store.configureSfcController(NAME, ''), true)
    assert.equal(store.saveSfc(NAME), true)
    const unassigned = lifecycle()
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(lifecycle(), unassigned)
    const hardware = useStore.getState().hardware
    store.configureSfcController(NAME, 'CTLR-01')
    store.saveSfc(NAME)
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], commissioned: false } } } })
    const unavailable = lifecycle()
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(lifecycle(), unavailable)
    assert.equal(useStore.getState().sfcs[NAME], runtime)
  })
})

test('saved SFC loads restore configuration only, preserve current area membership and require fresh download after reset', () => {
  withProject((store, storage) => {
    deploy(store)
    store.setSfcOnline(NAME, false)
    const deployed = lifecycle().deployed
    const runtime = useStore.getState().sfcs[NAME]
    store.setSfcSteps(NAME, steps(90))
    assert.equal(store.loadSavedSfc(NAME), true)
    assert.equal(lifecycle().draft.steps[0].actions[0].value, 50)
    assert.equal(lifecycle().deployed, deployed)
    assert.equal(useStore.getState().sfcs[NAME], runtime)
    assert.equal(store.renameArea('FEED', 'FEEDNEW'), true)
    assert.equal(lifecycle().draft.area, 'FEEDNEW')
    assert.equal(lifecycle().saved.area, 'FEEDNEW')
    assert.equal(lifecycle().deployed.area, 'FEEDNEW')
    assert.equal(JSON.parse(storage.get(savedSfcKey(NAME))).configuration.area, 'FEED')
    assert.equal(store.loadSavedSfc(NAME), true)
    assert.equal(lifecycle().draft.area, 'FEEDNEW')
    store.newProject('pharma')
    assert.deepEqual(useStore.getState().sfcLifecycle, {})
    store.createSfc(NAME, 'FEED')
    store.enableSfcLifecycle(NAME)
    assert.equal(store.loadSavedSfc(NAME), true)
    assert.equal(lifecycle().deployed, undefined)
    assert.equal(store.setSfcOnline(NAME, true), false)
    store.deleteSfc(NAME)
    assert.equal(useStore.getState().sfcLifecycle[NAME], undefined)
  })
})

test('SFC lifecycle permissions and FlexLock reject mutations without changing saved/deployed state', () => {
  withProject(store => {
    deploy(store)
    store.setSfcOnline(NAME, false)
    const initial = lifecycle()
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.configureSfcController(NAME, ''), false)
    assert.equal(store.saveSfc(NAME), false)
    assert.equal(store.loadSavedSfc(NAME), false)
    assert.equal(store.downloadSavedSfc(NAME), false)
    store.setSfcSteps(NAME, steps(99))
    assert.equal(lifecycle(), initial)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.configureSfcController(NAME, ''), false)
    assert.equal(store.saveSfc(NAME), false)
    assert.equal(store.loadSavedSfc(NAME), false)
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(store.setSfcOnline(NAME, true), false)
    store.sfcCommand(NAME, 'run')
    assert.equal(lifecycle(), initial)
    assert.equal(useStore.getState().sfcs[NAME].status, 'READY')
  })
})

test('saved SFC schema rejects malformed/unsupported actions and conditions instead of treating them as executable', () => {
  withProject(() => {
    const modules = useStore.getState().modules
    const valid = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01', steps: steps() }
    assert.deepEqual(parseSavedSfc(serializeSavedSfc(valid), modules).configuration.steps, valid.steps.map(step =>
      ({ ...step, actions: step.actions.map(action => ({ ...action, timingCondition: undefined })) })))
    for (const configuration of [
      { ...valid, steps: null }, { ...valid, steps: [{}] },
      { ...valid, steps: [{ ...steps()[0], actions: [{ kind: 'message', tag: NAME, value: 255 }] }] },
      { ...valid, steps: [{ ...steps()[0], transition: { kind: 'javascript', value: 'alert(1)' } }] },
      { ...valid, steps: [{ ...steps()[0], actions: [{ kind: 'sp', tag: 'MISSING', value: 5 }] }] },
      { ...valid, steps: [{ ...steps()[0], transition: { kind: 'timer', seconds: -1 } }] }
    ]) assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration }), modules).error)
    assert.ok(parseSavedSfc('{', modules).error)
    assert.ok(parseSavedSfc(JSON.stringify({ version: 2, configuration: valid }), modules).error)
  })
})

test('Check validates the offline draft, while invalid Save leaves the saved/deployed algorithm and plant untouched', () => {
  withProject((store, storage) => {
    deploy(store)
    store.setSfcOnline(NAME, false)
    const saved = lifecycle().saved
    const deployed = lifecycle().deployed
    const runtime = useStore.getState().sfcs[NAME]
    const modules = useStore.getState().modules
    const savedText = storage.get(savedSfcKey(NAME))
    store.setSfcSteps(NAME, [{ ...steps()[0], actions: [{ kind: 'sp', tag: 'MISSING', value: 1 }] }])
    assert.match(store.checkSfc(NAME), /Missing action module/)
    assert.equal(store.saveSfc(NAME), false)
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(lifecycle().saved, saved)
    assert.equal(lifecycle().deployed, deployed)
    assert.equal(storage.get(savedSfcKey(NAME)), savedText)
    assert.equal(useStore.getState().sfcs[NAME], runtime)
    assert.equal(useStore.getState().modules, modules)
    store.setSfcOnline(NAME, true)
    assert.equal(store.checkSfc(NAME), null)
  })
})
