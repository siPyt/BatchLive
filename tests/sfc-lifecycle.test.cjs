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
const { useUi } = require('../src/renderer/src/ui/uiStore.ts')
const {
  savedSfcKey, sfcDraftDirty, sfcNeedsDownload, sfcEditorDefinition, parseSavedSfc, serializeSavedSfc,
  sfcConfiguredMetadata
} = require('../src/renderer/src/engine/sfcLifecycle.ts')
const NAME = 'LIFE-TEST'
function steps(value = 50) {
  return [{ id: 'first', name: 'FIRST', actions: [{ kind: 'sp', tag: 'FIC-101', value, qualifier: 'N' }],
    transition: { kind: 'timer', seconds: 10 } }]
}
function withProject(run) {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousUi = useUi.getState()
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
    useUi.setState(previousUi, true)
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

test('New SFC algorithm creates one atomic offline module and does not run before saved deployment', () => {
  withProject(store => {
    const snapshots = []
    const unsubscribe = useStore.subscribe(state => {
      if (state.sfcs['NEW-SFC']) snapshots.push(!!state.sfcLifecycle['NEW-SFC'])
    })
    try { assert.equal(store.createSfc(' new-sfc ', 'FEED', { managed: true }), true) }
    finally { unsubscribe() }
    assert.ok(snapshots.length > 0)
    assert.ok(snapshots.every(Boolean))
    const runtime = useStore.getState().sfcs['NEW-SFC']
    const managed = () => useStore.getState().sfcLifecycle['NEW-SFC']
    assert.equal(runtime.status, 'READY')
    assert.equal(managed().online, false)
    assert.equal(managed().saved, undefined)
    assert.equal(managed().deployed, undefined)
    assert.equal(managed().draft.controllerTag, '')
    assert.notEqual(managed().draft.steps, runtime.steps)
    assert.equal(store.saveSfc('NEW-SFC'), false)
    store.setSfcSteps('NEW-SFC', steps(67))
    const sp = useStore.getState().modules['FIC-101'].sp
    store.sfcCommand('NEW-SFC', 'run')
    assert.equal(useStore.getState().sfcs['NEW-SFC'], runtime)
    assert.equal(useStore.getState().modules['FIC-101'].sp, sp)
    assert.equal(store.configureSfcController('NEW-SFC', 'CTLR-01'), true)
    assert.equal(store.saveSfc('NEW-SFC'), true)
    assert.equal(useStore.getState().modules['FIC-101'].sp, sp)
    assert.equal(store.downloadSavedSfc('NEW-SFC'), true)
    assert.equal(useStore.getState().modules['FIC-101'].sp, sp)
    assert.equal(store.setSfcOnline('NEW-SFC', true), true)
    store.sfcCommand('NEW-SFC', 'run')
    store.tick(.1)
    assert.equal(useStore.getState().modules['FIC-101'].sp, 67)
  })
})

test('algorithm creation rejects invalid/shared names, stale areas, denied keys and FlexLock without partial modules', () => {
  withProject((store, storage, alerts) => {
    const before = useStore.getState()
    for (const [name, area] of [['FIC-101', 'FEED'], [NAME.toLowerCase(), 'FEED'],
      ['', 'FEED'], ['BAD/NAME', 'FEED'], ['ABCDEFGHIJKLMNOPQ', 'FEED'], ['NEW-SFC', 'DELETED_AREA']]) {
      assert.equal(store.createSfc(name, area, { managed: true }), false)
      assert.equal(useStore.getState().sfcs, before.sfcs)
      assert.equal(useStore.getState().sfcLifecycle, before.sfcLifecycle)
    }
    useSecurity.setState({ currentUser: 'Supervisor1' })
    assert.equal(store.createSfc('NEW-SFC', 'FEED', { managed: true }), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.createSfc('NEW-SFC', 'FEED', { managed: true }), false)
    assert.equal(store.createModule({ tag: 'NEW-FBD', type: 'AI', area: 'FEED', description: '' }), false)
    assert.equal(useStore.getState().sfcs, before.sfcs)
    assert.equal(useStore.getState().sfcLifecycle, before.sfcLifecycle)
    assert.equal(useStore.getState().modules, before.modules)
    useSecurity.setState({ locked: false })
    assert.equal(store.createSfc('NEW-SFC', 'FEED', { managed: true }), true)
    assert.equal(store.createModule({ tag: 'new-sfc', type: 'AI', area: 'FEED', description: '' }), false)
    assert.equal(useStore.getState().modules['NEW-SFC'], undefined)
    assert.equal(store.createModule({ tag: 'NEW-FBD', type: 'AI', area: 'FEED', description: '' }), true)
    assert.equal(useStore.getState().sfcLifecycle['NEW-FBD'], undefined)
    assert.ok(alerts.length >= 7)
    assert.equal(storage.size, 0)
  })
})

test('Explorer SFC opening selects the requested chart, rejects missing targets and resets project navigation', () => {
  withProject(store => {
    assert.equal(store.createSfc('NEW-SFC', 'FEED', { managed: true }), true)
    assert.equal(useUi.getState().openSfc(' new-sfc '), true)
    assert.equal(useUi.getState().display, 'sfc')
    assert.equal(useUi.getState().sfcName, 'NEW-SFC')
    assert.equal(useUi.getState().selectedTag, 'NEW-SFC')
    const previous = useUi.getState()
    assert.equal(useUi.getState().openSfc('MISSING-SFC'), false)
    assert.equal(useUi.getState(), previous)
    useUi.getState().navigate('explorer')
    assert.equal(useUi.getState().openSfc(NAME), true)
    assert.equal(useUi.getState().sfcName, NAME)
    useUi.getState().resetToOverview()
    assert.equal(useUi.getState().display, 'overview')
    assert.equal(useUi.getState().sfcName, null)
    assert.equal(useUi.getState().selectedTag, null)
    assert.equal(store.createSfc('LEGACY-SFC', 'FEED'), true)
    assert.equal(useStore.getState().sfcLifecycle['LEGACY-SFC'], undefined)
  })
})

test('SFC description and equipment membership survive creation Properties Save Load and Download without early runtime changes', () => {
  withProject((store, storage) => {
    store.createEquipmentModule('FEED_TEST', 'Feed equipment', 'FEED')
    assert.equal(store.createSfc('META-SFC', 'FEED', {
      managed: true, description: 'Tank startup', equipmentModule: 'FEED_TEST'
    }), true)
    const record = () => useStore.getState().sfcLifecycle['META-SFC']
    const runtime = () => useStore.getState().sfcs['META-SFC']
    assert.deepEqual([runtime().description, record().draft.description, record().draft.equipmentModule],
      ['Tank startup', 'Tank startup', 'FEED_TEST'])
    store.setSfcSteps('META-SFC', steps())
    const originalRuntime = runtime()
    const before = record().draft
    assert.equal(store.configureSfcProperties('META-SFC', {
      description: 'Tank startup and shutdown', equipmentModule: undefined, controllerTag: 'CTLR-01'
    }, before), true)
    assert.equal(runtime(), originalRuntime, 'property commit does not rewrite undeployed runtime')
    assert.deepEqual(sfcConfiguredMetadata(runtime(), record()), {
      area: 'FEED', description: 'Tank startup and shutdown', equipmentModule: undefined
    })
    assert.equal(sfcEditorDefinition(runtime(), record()).description, 'Tank startup and shutdown')
    assert.equal(store.saveSfc('META-SFC'), true)
    const saved = record().saved
    assert.equal(JSON.parse(storage.get(savedSfcKey('META-SFC'))).configuration.description, saved.description)
    assert.equal(store.configureSfcProperties('META-SFC', { description: 'Unsaved', equipmentModule: 'FEED_TEST' }), true)
    assert.equal(store.loadSavedSfc('META-SFC'), true)
    assert.equal(record().draft.description, saved.description)
    assert.equal(record().draft.equipmentModule, undefined)
    assert.equal(runtime(), originalRuntime)
    assert.equal(store.downloadSavedSfc('META-SFC'), true)
    assert.equal(runtime().description, saved.description)
    assert.equal(runtime().equipmentModule, undefined)
    assert.equal(runtime().status, 'READY')
    assert.equal(runtime().actionStates && Object.keys(runtime().actionStates).length, 0)
    assert.notEqual(record().draft, record().saved)
    assert.notEqual(record().saved, record().deployed)
    assert.equal(store.configureSfcProperties('META-SFC', { description: 'Next deployment', equipmentModule: 'FEED_TEST' }), true)
    assert.equal(runtime().description, saved.description)
    assert.equal(sfcConfiguredMetadata(runtime(), record()).description, 'Next deployment')
    assert.equal(store.saveSfc('META-SFC'), true)
    assert.equal(store.downloadSavedSfc('META-SFC'), true)
    assert.equal(runtime().equipmentModule, 'FEED_TEST')
    assert.equal(store.setSfcOnline('META-SFC', true), true)
    assert.equal(sfcEditorDefinition(runtime(), record()).description, 'Next deployment')
  })
})

test('SFC property commits reject stale invalid cross-area running Online locked and denied edits atomically', () => {
  withProject(store => {
    store.createEquipmentModule('FEED_TEST', 'Feed equipment', 'FEED')
    store.createEquipmentModule('REACT_TEST', 'Reactor equipment', 'REACTOR')
    const initial = lifecycle().draft
    assert.equal(store.configureSfcProperties(NAME, { description: 'Saved description', equipmentModule: 'FEED_TEST' }, initial), true)
    const good = lifecycle().draft
    for (const patch of [
      { controllerTag: 'NO_CONTROLLER', description: 'Must not apply' },
      { equipmentModule: 'MISSING' }, { equipmentModule: 'REACT_TEST' },
      { equipmentModule: '' }, { description: null }, { controllerTag: undefined }, { name: 'RENAMED' }
    ]) {
      assert.equal(store.configureSfcProperties(NAME, patch, good), false)
      assert.equal(lifecycle().draft, good)
    }
    assert.equal(store.configureSfcProperties(NAME, { description: 'Stale overwrite' }, initial), false)
    assert.equal(lifecycle().draft, good)
    useSecurity.setState({ locked: true })
    assert.equal(store.configureSfcProperties(NAME, { description: 'Locked' }, good), false)
    useSecurity.setState({ locked: false, currentUser: 'Supervisor1' })
    assert.equal(store.configureSfcProperties(NAME, { description: 'Denied' }, good), false)
    useSecurity.setState({ currentUser: 'admin' })
    deploy(store)
    const online = lifecycle().draft
    assert.equal(store.configureSfcProperties(NAME, { description: 'Online' }, online), false)
    store.sfcCommand(NAME, 'run')
    assert.equal(store.setSfcOnline(NAME, false), true)
    assert.equal(store.configureSfcProperties(NAME, { description: 'Running' }, online), false)
    assert.equal(lifecycle().draft, online)
    assert.equal(store.createSfc('INVALID_META', 'FEED', { managed: true, equipmentModule: 'REACT_TEST' }), false)
    assert.equal(useStore.getState().sfcs.INVALID_META, undefined)
    assert.equal(useStore.getState().sfcLifecycle.INVALID_META, undefined)
  })
})

test('saved SFC metadata schema remains backward compatible and equipment deletion or bad reload cannot replace deployment', () => {
  withProject((store, storage) => {
    const legacy = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01', steps: steps() }
    assert.equal(parseSavedSfc(serializeSavedSfc(legacy), useStore.getState().modules).error, undefined)
    for (const metadata of [{ description: 42 }, { equipmentModule: null }, { equipmentModule: 'BAD/NAME' }]) {
      assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: { ...legacy, ...metadata } }),
        useStore.getState().modules).error)
    }
    store.createEquipmentModule('FEED_TEST', 'Feed equipment', 'FEED')
    store.configureSfcProperties(NAME, { equipmentModule: 'FEED_TEST', description: 'Description before deletion' })
    deploy(store)
    assert.equal(store.setSfcOnline(NAME, false), true)
    const deployed = lifecycle().deployed
    const runtime = useStore.getState().sfcs[NAME]
    const savedText = storage.get(savedSfcKey(NAME))
    store.deleteEquipmentModule('FEED_TEST')
    assert.equal(lifecycle().draft.equipmentModule, undefined)
    assert.equal(lifecycle().deployed, deployed, 'deleted project equipment does not rewrite deployed configuration')
    assert.equal(useStore.getState().sfcs[NAME], runtime)
    assert.equal(sfcDraftDirty(lifecycle()), true)
    assert.equal(store.loadSavedSfc(NAME), false, 'old persisted equipment reference is unavailable')
    assert.equal(lifecycle().draft.equipmentModule, undefined)
    assert.equal(lifecycle().deployed, deployed)
    assert.equal(storage.get(savedSfcKey(NAME)), savedText, 'a rejected Load cannot rewrite saved storage')
    assert.equal(store.saveSfc(NAME), true)
    assert.equal(store.downloadSavedSfc(NAME), true)
    assert.equal(useStore.getState().sfcs[NAME].equipmentModule, undefined)
    assert.equal(useStore.getState().sfcs[NAME].description, 'Description before deletion')
    store.createEquipmentModule('FEED_TEST', 'Feed equipment', 'FEED')
    store.configureSfcProperties(NAME, { equipmentModule: 'FEED_TEST' })
    store.renameArea('FEED', 'FEED_RENAMED')
    assert.deepEqual([lifecycle().draft.area, useStore.getState().equipment.FEED_TEST.area],
      ['FEED_RENAMED', 'FEED_RENAMED'])
    assert.equal(store.saveSfc(NAME), true)
  })
})

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
