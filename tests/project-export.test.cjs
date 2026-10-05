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
const { usePictures } = require('../src/renderer/src/engine/pictureStore.ts')
const { exportConfiguration, importConfiguration } = require('../src/renderer/src/engine/projectTransfer.ts')
const { parseExportPackage, hardwareError, controlStrategiesError } = require('../src/renderer/src/engine/projectExport.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), pictures: usePictures.getState(), window: global.window }
  const storage = new Map()
  global.window = { alert: () => {}, confirm: () => true, localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    run()
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    usePictures.setState(before.pictures, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

const json = (value) => JSON.parse(JSON.stringify(value))
const set = (name, entries) => ({ name, description: `${name} set`, entries })

test('DV09-084 Physical Network export round-trips through a blank project', () => fixture(() => {
  const original = json(useStore.getState().hardware)
  const out = exportConfiguration('physical-network')
  assert.ok(out.text, JSON.stringify(out))
  assert.equal(out.fileName, 'PhysicalNetwork.batchlive-export.json')
  useStore.getState().newProject('blank')
  assert.notDeepEqual(json(useStore.getState().hardware), original)
  const result = importConfiguration(out.text)
  assert.equal(result.kind, 'physical-network')
  assert.deepEqual(json(useStore.getState().hardware), original)
}))

test('DV09-084 Control Strategies export round-trips modules, equipment, SFCs and areas', () => fixture(() => {
  const s = useStore.getState()
  const original = json({ areas: s.areas, modules: s.modules, equipment: s.equipment, sfcs: s.sfcs, phases: s.phases })
  const out = exportConfiguration('control-strategies')
  assert.equal(out.fileName, 'ControlStrategies.batchlive-export.json')
  useStore.getState().newProject('blank')
  assert.notDeepEqual(json(useStore.getState().modules), original.modules)
  const result = importConfiguration(out.text)
  assert.equal(result.kind, 'control-strategies')
  const after = useStore.getState()
  assert.deepEqual(json({ areas: after.areas, modules: after.modules, equipment: after.equipment, sfcs: after.sfcs, phases: after.phases }), original)
  assert.deepEqual(after.moduleLifecycle, {}, 'saved/deployed lifecycle records are reset by an import')
  assert.deepEqual(after.alarms, [])
}))

test('DV09-084 Named Sets NS-T101 and phase_failures export separately and import into the configured set only', () => fixture(() => {
  const s = useStore.getState()
  assert.equal(s.createNamedSet('NS-T101'), true)
  assert.equal(s.createNamedSet('phase_failures'), true)
  const ns = set('NS-T101', [
    { name: 'STARTUP', value: 1, visible: true, userSelectable: true },
    { name: 'SHUTDOWN', value: 2, visible: true, userSelectable: true }
  ])
  assert.equal(useStore.getState().applyNamedSetProperties(useStore.getState().namedSets.configured['NS-T101'], ns), true)
  const faults = set('phase_failures', [{ name: 'NO FLOW', value: 7, visible: true, userSelectable: false }])
  assert.equal(useStore.getState().applyNamedSetProperties(useStore.getState().namedSets.configured.phase_failures, faults), true)

  const only = exportConfiguration('named-sets', ['NS-T101'])
  const both = exportConfiguration('named-sets', ['NS-T101', 'phase_failures'])
  assert.equal(only.fileName, 'NS-T101.batchlive-export.json')
  assert.equal(exportConfiguration('named-sets', []).error, 'Select at least one Named Set to export')
  assert.match(exportConfiguration('named-sets', ['MISSING']).error, /does not exist/)

  useStore.getState().newProject('blank')
  assert.deepEqual(Object.keys(useStore.getState().namedSets.configured), [])
  assert.match(importConfiguration(only.text).summary, /NS-T101/)
  assert.deepEqual(Object.keys(useStore.getState().namedSets.configured), ['NS-T101'])
  assert.match(importConfiguration(both.text).summary, /phase_failures/)
  assert.deepEqual(json(useStore.getState().namedSets.configured['NS-T101'].entries), ns.entries)
  assert.deepEqual(json(useStore.getState().namedSets.configured.phase_failures.entries), faults.entries)
  assert.deepEqual(useStore.getState().namedSets.deployed, {}, 'import does not deploy; Changed Setup Data is still required')
}))

test('DV09-084 operator pictures export and import with validation of every element', () => fixture(() => {
  usePictures.getState().createPicture('Ovw_ref')
  const id = usePictures.getState().addElement('OVW_REF', { type: 'datalink', x: 10, y: 10, tag: 'FIC-101', param: 'PV', label: true })
  assert.ok(id)
  const original = json(usePictures.getState().pictures.OVW_REF)
  const out = exportConfiguration('pictures', ['OVW_REF'])
  assert.equal(out.fileName, 'OVW_REF.batchlive-export.json')
  assert.match(exportConfiguration('pictures', []).error, /at least one picture/)
  assert.match(exportConfiguration('pictures', ['Nope']).error, /does not exist/)
  usePictures.getState().deletePicture('OVW_REF')
  assert.equal(usePictures.getState().pictures.OVW_REF, undefined)
  assert.equal(importConfiguration(out.text).kind, 'pictures')
  assert.deepEqual(json(usePictures.getState().pictures.OVW_REF), original)
}))

test('DV09-084 import rejects malformed, tampered and unsupported packages without changing the project', () => fixture(() => {
  const state = useStore.getState()
  const hardware = exportConfiguration('physical-network').text
  const strategies = exportConfiguration('control-strategies').text
  const pkg = (text, edit) => { const value = JSON.parse(text); edit(value); return JSON.stringify(value) }
  const before = { hardware: state.hardware, modules: state.modules, areas: state.areas, sets: state.namedSets }

  const bad = [
    ['not json', /invalid JSON/],
    [JSON.stringify({ hello: 1 }), /not a BatchLive export/],
    [pkg(hardware, (v) => { v.version = 9 }), /Unsupported export version/],
    [pkg(hardware, (v) => { v.kind = 'galaxy' }), /unknown kind/],
    [pkg(hardware, (v) => { delete v.data }), /incomplete/],
    [pkg(hardware, (v) => { v.data.carriers[Object.keys(v.data.carriers)[0]].controllerTag = 'GONE' }), /unknown controller/],
    [pkg(hardware, (v) => { v.data.baseplates[Object.keys(v.data.baseplates)[0]].channels.pop() }), /exactly 8 channels/],
    [pkg(strategies, (v) => { const k = Object.keys(v.data.modules)[0]; v.data.modules[k].tag = 'WRONG' }), /tag does not match/],
    [pkg(strategies, (v) => { const k = Object.keys(v.data.modules)[0]; v.data.modules[k].type = 'SPACESHIP' }), /unknown type/],
    [pkg(strategies, (v) => { const k = Object.keys(v.data.modules)[0]; v.data.modules[k].area = 'NOWHERE' }), /area that is not in the package/],
    [pkg(strategies, (v) => { v.data.areas = [] }), /list of plant areas/],
    [pkg(strategies, (v) => { v.data.areas = ['FEED', 'FEED'] }), /unique/]
  ]
  for (const [text, pattern] of bad) {
    const result = importConfiguration(text)
    assert.match(result.error, pattern, text.slice(0, 80))
  }

  const sets = { format: 'batchlive-export', version: 1, kind: 'named-sets', name: 'X', exportedAt: 1,
    data: JSON.stringify({ version: 1, definitions: [{ name: 'X', description: '', entries: [
      { name: 'A', value: 1, visible: true, userSelectable: true }, { name: 'B', value: 1, visible: true, userSelectable: true }] }] }) }
  assert.match(importConfiguration(JSON.stringify(sets)).error, /Duplicate Named Set value/)
  const pics = { format: 'batchlive-export', version: 1, kind: 'pictures', name: 'P', exportedAt: 1, data: { P: { name: 'P', elements: [{ id: 'x', type: 'banana' }] } } }
  assert.ok(importConfiguration(JSON.stringify(pics)).error)
  assert.match(importConfiguration(JSON.stringify({ ...pics, data: {} })).error, /no pictures/)

  const after = useStore.getState()
  assert.equal(after.hardware, before.hardware)
  assert.equal(after.modules, before.modules)
  assert.equal(after.areas, before.areas)
  assert.equal(after.namedSets, before.sets)
  assert.ok(after.eventLog.some((e) => e.category === 'DIAGNOSTIC' && /rejected/.test(e.description)), 'rejections are journaled')
}))

test('DV09-084 export and import require the Can Configure key', () => fixture(() => {
  const good = exportConfiguration('control-strategies').text
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(exportConfiguration('physical-network').error, /Access Denied/)
  assert.match(importConfiguration(good).error, /Access Denied/)
}))

test('DV09-084 pure validators accept an exported package and expose parse errors', () => fixture(() => {
  const hardware = JSON.parse(exportConfiguration('physical-network').text)
  assert.equal(hardwareError(hardware.data), null)
  assert.match(hardwareError(null), /missing/)
  const strategies = JSON.parse(exportConfiguration('control-strategies').text)
  assert.equal(controlStrategiesError(strategies.data), null)
  assert.ok(parseExportPackage(JSON.stringify(strategies)).package)
}))

test('zustand selectors in components never allocate a new array or object per render', () => {
  const path = require('node:path')
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'src')
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : [])
  const offenders = []
  for (const file of walk(dir)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/use(?:Store|Pictures|Security|Ui)\(\s*\(?s\)?\s*=>\s*(Object\.(?:keys|values|entries)\(|\[\.\.\.)/g)) {
      offenders.push(`${path.basename(file)}: ${m[0]}`)
    }
  }
  assert.deepEqual(offenders, [], 'a selector that returns a fresh array causes "Maximum update depth exceeded" (React #185)')
})
