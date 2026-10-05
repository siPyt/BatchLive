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
const { compareModuleDownload, moduleDownloadStatus } = require('../src/renderer/src/engine/downloadStatus.ts')

function withProject(run) {
  const originalStore = useStore.getState()
  const originalSecurity = useSecurity.getState()
  const originalWindow = global.window
  const storage = new Map()
  const alerts = []
  global.window = { alert: message => alerts.push(message), localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('pharma')
    assert.equal(store.createSfc('STATUS-SFC', 'FEED', { managed: true }), true)
    store.setSfcSteps('STATUS-SFC', [{ id: 'first', name: 'FIRST', actions: [],
      transition: { kind: 'timer', seconds: 10 } }])
    assert.equal(store.configureSfcController('STATUS-SFC', 'CTLR-01'), true)
    run(store, storage, alerts)
  } finally {
    useStore.setState(originalStore, true)
    useSecurity.setState(originalSecurity, true)
    if (originalWindow === undefined) delete global.window
    else global.window = originalWindow
  }
}
const status = tag => moduleDownloadStatus(useStore.getState(), tag).status

test('managed module yellow/unknown/blue/clear states compare saved configuration, not editor drafts or revisions', () => {
  withProject((store, storage) => {
    const tag = 'STATUS-SFC'
    assert.equal(status(tag), 'NO_CONFIGURATION')
    assert.equal(store.updateModuleDownloadStatus(tag), true)
    assert.equal(status(tag), 'NO_CONFIGURATION')
    assert.equal(store.saveSfc(tag), true)
    assert.equal(status(tag), 'NO_CONFIGURATION')
    assert.equal(store.downloadSavedSfc(tag), true)
    assert.equal(status(tag), 'MATCH')
    assert.equal(store.configureSfcProperties(tag, { description: 'unsaved edit' }), true)
    assert.equal(status(tag), 'MATCH', 'unsaved draft is not the configuration database')
    assert.equal(store.saveSfc(tag), true)
    assert.equal(status(tag), 'UNKNOWN')
    const previous = useStore.getState()
    const storageBefore = [...storage]
    assert.equal(store.updateModuleDownloadStatus(tag), true)
    assert.equal(status(tag), 'DIFFERENT')
    const after = useStore.getState()
    for (const key of ['modules', 'hardware', 'sfcs', 'sfcLifecycle', 'pidLifecycle', 'deviceLifecycle',
      'moduleLifecycle', 'namedSets']) assert.equal(after[key], previous[key], `${key} unchanged by comparison`)
    assert.deepEqual([...storage], storageBefore)
    assert.ok(after.eventLog.some(event => event.description.includes('comparison only, no transfer')))
    assert.equal(store.configureSfcProperties(tag, { description: 'another saved edit' }), true)
    assert.equal(store.saveSfc(tag), true)
    assert.equal(status(tag), 'UNKNOWN', 'older checked configuration must not remain blue')
    assert.equal(store.updateModuleDownloadStatus(tag), true)
    assert.equal(status(tag), 'DIFFERENT')
    const deploymentBeforeFailure = useStore.getState().sfcLifecycle[tag].deployed
    assert.equal(store.downloadSavedSfc(tag, {}), false, 'stale transfer confirmation rejects')
    assert.equal(status(tag), 'DIFFERENT', 'failed transfer never clears blue')
    assert.equal(useStore.getState().sfcLifecycle[tag].deployed, deploymentBeforeFailure)
    assert.equal(store.downloadSavedSfc(tag), true)
    assert.equal(status(tag), 'MATCH', 'successful transfer clears the indicator')
    assert.equal(store.saveSfc(tag), true)
    assert.equal(status(tag), 'MATCH', 'saving unchanged configuration does not imply a difference')
    store.newProject('pharma')
    assert.deepEqual(useStore.getState().downloadStatusChecks, {})
  })
})

test('unavailable, unmanaged, unknown-tag, denied and locked status updates reject without transfers', () => {
  withProject((store, storage, alerts) => {
    const tag = 'STATUS-SFC'
    store.saveSfc(tag)
    store.downloadSavedSfc(tag)
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], primary: 'FAILED', secondary: 'FAILED' } } } })
    assert.equal(status(tag), 'UNKNOWN')
    const before = useStore.getState()
    const saved = [...storage]
    assert.equal(store.updateModuleDownloadStatus(tag), false)
    assert.equal(store.updateModuleDownloadStatus('MISSING'), false)
    assert.equal(store.updateModuleDownloadStatus('FIC-101'), false)
    assert.equal(status('FIC-101'), 'UNSUPPORTED', 'live modules must not masquerade as downloaded')
    useStore.setState({ hardware })
    useSecurity.setState({ currentUser: 'Supervisor1', locked: false })
    assert.equal(store.updateModuleDownloadStatus(tag), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.updateModuleDownloadStatus(tag), false)
    assert.equal(useStore.getState().sfcs, before.sfcs)
    assert.equal(useStore.getState().sfcLifecycle, before.sfcLifecycle)
    assert.equal(useStore.getState().downloadStatusChecks, before.downloadStatusChecks)
    assert.deepEqual([...storage], saved)
    assert.equal(alerts.length, 3)
  })
})

test('all four lifecycle families use structural comparison with optional-field and object-order normalization', () => {
  withProject(() => {
    const base = useStore.getState()
    const saved = { controllerTag: 'CTLR-01', nested: { first: 1, second: 2 }, list: [1, 2] }
    const deployed = { list: [1, 2], nested: { second: 2, first: 1 }, controllerTag: 'CTLR-01',
      optional: undefined }
    for (const family of ['moduleLifecycle', 'pidLifecycle', 'deviceLifecycle', 'sfcLifecycle']) {
      let state = { ...base, [family]: { ...base[family], TEST: { saved, deployed, draft: {}, online: false,
        savedRevision: 5, deployedRevision: 2 } } }
      assert.equal(moduleDownloadStatus(state, 'TEST').status, 'MATCH', family)
      state = { ...state, [family]: { ...state[family], TEST: { ...state[family].TEST,
        saved: { ...saved, nested: { first: 3, second: 2 } } } } }
      const comparison = compareModuleDownload(state, 'TEST')
      assert.equal(comparison.status, 'DIFFERENT')
      assert.equal(moduleDownloadStatus(state, 'TEST').status, 'UNKNOWN')
      state = { ...state, downloadStatusChecks: { TEST: { signature: comparison.signature } } }
      assert.equal(moduleDownloadStatus(state, 'TEST').status, 'DIFFERENT')
      state = { ...state, [family]: { ...state[family], TEST: { ...state[family].TEST, saved: undefined } } }
      assert.equal(moduleDownloadStatus(state, 'TEST').status, 'UNKNOWN')
      assert.ok(compareModuleDownload(state, 'TEST').error)
    }
  })
})
