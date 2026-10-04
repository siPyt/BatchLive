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
const {
  NAMED_SETS_STORAGE_KEY, namedSetError, namedSetChoices, changedNamedSets, namedSetTargetKey,
  parseNamedSets, serializeNamedSets
} = require('../src/renderer/src/engine/namedSets.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const controller = { kind: 'controller', tag: 'CTLR-01' }
const workstation = { kind: 'workstation' }
function courseSet(name = 'NS-T101') {
  return { name, description: 'Startup sequence commands', entries: [
    { name: 'STARTUP', value: 1, visible: true, userSelectable: true },
    { name: 'SELECT SEQUENCE', value: 255, visible: true, userSelectable: false }
  ] }
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
    useStore.getState().newProject('pharma')
    run(useStore.getState(), storage, alerts)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
}
function configure(store, name = 'NS-T101') {
  assert.equal(store.createNamedSet(name), true)
  const expected = useStore.getState().namedSets.configured[name]
  assert.equal(store.applyNamedSetProperties(expected, courseSet(name)), true)
}

test('NS-T101 keeps exact names, numbers and independent Visible/User Selectable flags', () => {
  const definition = courseSet()
  assert.equal(namedSetError(definition), null)
  assert.deepEqual(namedSetChoices(definition).map(entry => [entry.name, entry.value]), [['STARTUP', 1]])
  definition.entries.push({ name: 'startup', value: 2, visible: false, userSelectable: true })
  assert.equal(namedSetError(definition), null)
  assert.equal(definition.entries[2].userSelectable, true)
  assert.deepEqual(namedSetChoices(definition).map(entry => entry.name), ['STARTUP'])
  for (const invalid of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(namedSetError({ ...definition, entries: [{ ...definition.entries[0], value: invalid }] }))
  }
  assert.ok(namedSetError({ ...definition, entries: [...definition.entries, definition.entries[0]] }))
  assert.ok(namedSetError({ ...definition, entries: [{ ...definition.entries[0], name: ' STARTUP' }] }))
})

test('Named Set Properties persists isolated configuration without changing deployed setup or plant', () => {
  withProject((store, storage) => {
    const modules = useStore.getState().modules
    configure(store)
    const configured = useStore.getState().namedSets.configured
    assert.deepEqual(configured['NS-T101'], courseSet())
    assert.deepEqual(parseNamedSets(storage.get(NAMED_SETS_STORAGE_KEY)), { configured })
    assert.deepEqual(useStore.getState().namedSets.deployed, {})
    assert.equal(useStore.getState().modules, modules)
    assert.deepEqual(changedNamedSets(useStore.getState().namedSets, controller), ['NS-T101'])
    const candidate = courseSet()
    const expected = configured['NS-T101']
    assert.equal(store.applyNamedSetProperties(expected, candidate), true)
    candidate.entries[0].value = 99
    assert.equal(useStore.getState().namedSets.configured['NS-T101'].entries[0].value, 1)
    assert.equal(store.createNamedSet('NS-T101'), false)
    assert.equal(store.createNamedSet('ns-t101'), true)
  })
})

test('Changed Setup Data transfers only changed Named Sets independently per available target', () => {
  withProject(store => {
    configure(store)
    configure(store, 'NS-OTHER')
    assert.equal(store.downloadChangedNamedSets(controller), true)
    const oldController = useStore.getState().namedSets.deployed[namedSetTargetKey(controller)]
    assert.notEqual(oldController['NS-T101'], useStore.getState().namedSets.configured['NS-T101'])
    assert.equal(store.downloadChangedNamedSets(workstation), true)
    const oldWorkstation = useStore.getState().namedSets.deployed.WORKSTATION
    const expected = useStore.getState().namedSets.configured['NS-T101']
    const changed = courseSet()
    changed.entries.push({ name: 'SHUTDOWN', value: 2, visible: true, userSelectable: true })
    assert.equal(store.applyNamedSetProperties(expected, changed), true)
    assert.equal(oldController['NS-T101'].entries.length, 2)
    assert.equal(oldWorkstation['NS-T101'].entries.length, 2)
    assert.deepEqual(changedNamedSets(useStore.getState().namedSets, controller), ['NS-T101'])
    assert.equal(store.downloadChangedNamedSets(controller), true)
    const deployed = useStore.getState().namedSets.deployed[namedSetTargetKey(controller)]
    assert.equal(deployed['NS-T101'].entries.length, 3)
    assert.equal(deployed['NS-OTHER'], oldController['NS-OTHER'])
    assert.equal(useStore.getState().namedSets.deployed.WORKSTATION, oldWorkstation)
    assert.equal(store.downloadChangedNamedSets(controller), false)
  })
})

test('invalid, stale and storage-failed commits cannot mutate configuration or deployed setup', () => {
  withProject((store, storage) => {
    configure(store)
    assert.equal(store.downloadChangedNamedSets(controller), true)
    const state = useStore.getState().namedSets
    const saved = storage.get(NAMED_SETS_STORAGE_KEY)
    const expected = state.configured['NS-T101']
    const invalid = courseSet()
    invalid.entries[1].value = 1
    assert.equal(store.applyNamedSetProperties(expected, invalid), false)
    assert.equal(useStore.getState().namedSets, state)
    assert.equal(storage.get(NAMED_SETS_STORAGE_KEY), saved)
    global.window.localStorage.setItem = () => { throw new Error('quota exceeded') }
    assert.equal(store.applyNamedSetProperties(expected, courseSet()), false)
    assert.equal(store.createNamedSet('NS-FAILED'), false)
    assert.equal(useStore.getState().namedSets, state)
    global.window.localStorage.setItem = (key, value) => storage.set(key, value)
    assert.equal(store.applyNamedSetProperties(expected, courseSet()), true)
    const updated = useStore.getState().namedSets
    assert.equal(store.applyNamedSetProperties(expected, courseSet()), false)
    assert.equal(useStore.getState().namedSets, updated)
  })
})

test('Named Set writes enforce configuration/download keys and FlexLock; unavailable controllers reject', () => {
  withProject(store => {
    configure(store)
    const initial = useStore.getState().namedSets
    const expected = initial.configured['NS-T101']
    useSecurity.setState({ currentUser: 'OperatorA' })
    assert.equal(store.createNamedSet('NS-DENIED'), false)
    assert.equal(store.applyNamedSetProperties(expected, courseSet()), false)
    assert.equal(store.loadSavedNamedSets(), false)
    assert.equal(store.downloadChangedNamedSets(controller), false)
    assert.equal(useStore.getState().namedSets, initial)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(store.createNamedSet('NS-LOCKED'), false)
    assert.equal(store.applyNamedSetProperties(expected, courseSet()), false)
    assert.equal(store.loadSavedNamedSets(), false)
    assert.equal(store.downloadChangedNamedSets(workstation), false)
    assert.equal(useStore.getState().namedSets, initial)
    assert.match(useSecurity.getState().lastDenied, /unlocked workstation/)
    useSecurity.setState({ locked: false })
    assert.equal(store.downloadChangedNamedSets({ kind: 'controller', tag: 'MISSING' }), false)
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], commissioned: false } } } })
    assert.equal(store.downloadChangedNamedSets(controller), false)
    assert.equal(useStore.getState().namedSets, initial)
    assert.equal(store.downloadChangedNamedSets(workstation), true)
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], powerDownAt: 1 } } } })
    assert.equal(store.downloadChangedNamedSets(controller), false)
  })
})

test('saved configuration load validates schema and preserves deployed copies; project reset clears session registry', () => {
  withProject((store, storage) => {
    configure(store)
    assert.equal(store.downloadChangedNamedSets(controller), true)
    const deployed = useStore.getState().namedSets.deployed
    store.newProject('pharma')
    assert.deepEqual(useStore.getState().namedSets, { configured: {}, deployed: {} })
    assert.equal(store.loadSavedNamedSets(), true)
    assert.deepEqual(useStore.getState().namedSets.configured['NS-T101'], courseSet())
    assert.deepEqual(useStore.getState().namedSets.deployed, {})
    useStore.setState({ namedSets: { configured: useStore.getState().namedSets.configured, deployed } })
    const state = useStore.getState().namedSets
    storage.set(NAMED_SETS_STORAGE_KEY, '{')
    assert.equal(store.loadSavedNamedSets(), false)
    assert.equal(useStore.getState().namedSets, state)
    global.window.localStorage.getItem = () => { throw new Error('storage blocked') }
    assert.equal(store.loadSavedNamedSets(), false)
    assert.equal(useStore.getState().namedSets, state)
    global.window.localStorage.getItem = key => storage.get(key) ?? null
    storage.set(NAMED_SETS_STORAGE_KEY, serializeNamedSets({}))
    assert.equal(store.loadSavedNamedSets(), true)
    assert.equal(useStore.getState().namedSets.deployed, deployed)
    assert.deepEqual(changedNamedSets(useStore.getState().namedSets, controller), ['NS-T101'])
    assert.equal(store.downloadChangedNamedSets(controller), true)
    assert.deepEqual(useStore.getState().namedSets.deployed[namedSetTargetKey(controller)], {})
  })
})

test('Named Set saved schema rejects malformed, duplicate or unsupported values without partial configuration', () => {
  const valid = courseSet()
  for (const input of [
    '{', JSON.stringify({ version: 2, definitions: [valid] }),
    JSON.stringify({ version: 1, definitions: [valid, valid] }),
    JSON.stringify({ version: 1, definitions: [{ ...valid, description: 1 }] }),
    JSON.stringify({ version: 1, definitions: [{ ...valid, entries: [{ ...valid.entries[0], visible: 'yes' }] }] }),
    JSON.stringify({ version: 1, definitions: [{ ...valid, entries: [{ ...valid.entries[0], value: 1.5 }] }] })
  ]) {
    const result = parseNamedSets(input)
    assert.ok(result.error)
    assert.equal(result.configured, undefined)
  }
})
