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
const { findDst } = require('../src/renderer/src/engine/traditionalIo.ts')
const { parseDevice, savedDeviceKey } = require('../src/renderer/src/engine/deviceLifecycle.ts')
const { deviceDescriptorLabel, parseDeviceDescriptors } = require('../src/renderer/src/engine/deviceDescriptors.ts')
const mapping = { namedSet: 'NS-XV', passiveCommand: 0, activeCommand: 1, passiveFeedback: 2, activeFeedback: 3 }
const definition = { name: 'NS-XV', description: 'Four independent valve descriptors', entries: [
  { name: 'Hold', value: 0, visible: true, userSelectable: true },
  { name: 'Flush', value: 1, visible: true, userSelectable: true },
  { name: 'Holding', value: 2, visible: true, userSelectable: false },
  { name: 'Flushing', value: 3, visible: true, userSelectable: false }
] }
const controller = { kind: 'controller', tag: 'CTLR' }
const workstation = { kind: 'workstation' }
function valve() { return useStore.getState().modules['XV-OPTION'] }
function record() { return useStore.getState().deviceLifecycle['XV-OPTION'] }
function label(role, active) { return deviceDescriptorLabel(valve(), useStore.getState().namedSets, role, active) }
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = [], db = new Map()
  global.window = { alert: message => alerts.push(message), localStorage: {
    setItem: (key, value) => db.set(key, value), getItem: key => db.get(key) ?? null
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    s.newProject('blank')
    useStore.setState({ running: true })
    s.createController('CTLR', 'Optional valve descriptors')
    s.commissionController('CTLR')
    for (const [slot, type, dst] of [[3, 'DI', 'XI-4'], [4, 'DO', 'ZX-4']]) {
      assert.equal(s.addTraditionalCard('CTLR', slot, type), true)
      assert.equal(s.configureTraditionalChannel(`CTLR/C0${slot}`, 4, { dst, enabled: true }), true)
    }
    assert.equal(s.createModule({ tag: 'XV-OPTION', type: 'VALVE', area: 'FEED', description: 'Flush/Hold course valve' }), true)
    s.tick(.1)
    assert.equal(s.createNamedSet('NS-XV'), true)
    assert.equal(s.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-XV'], definition), true)
    assert.equal(s.enableDeviceLifecycle('XV-OPTION'), true)
    assert.equal(s.editDeviceDraft('XV-OPTION', { controllerTag: 'CTLR', inputDst: 'XI-4', outputDst: 'ZX-4',
      descriptors: mapping }), true)
    run(s, alerts, db)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
function deploy(s) {
  assert.equal(s.downloadChangedNamedSets(controller), true)
  assert.equal(s.downloadChangedNamedSets(workstation), true)
  assert.equal(s.saveDeviceConfiguration('XV-OPTION'), true)
  assert.equal(s.downloadDeviceConfiguration('XV-OPTION'), true)
  s.tick(.1)
}
test('four descriptor roles persist/deploy atomically and remain independent from actual SP_D/PV_D', () => fixture((s, _, db) => {
  assert.equal(valve().descriptors, undefined)
  assert.equal(s.saveDeviceConfiguration('XV-OPTION'), true)
  assert.deepEqual(parseDevice(db.get(savedDeviceKey('XV-OPTION')), 'XV-OPTION').descriptors, mapping)
  assert.equal(valve().descriptors, undefined)
  deploy(s)
  assert.notEqual(record().draft.descriptors, record().saved.descriptors)
  assert.notEqual(valve().descriptors, record().deployed.descriptors)
  assert.deepEqual([label('command', false).label, label('feedback', false).label], ['Hold', 'Holding'])
  s.openValve('XV-OPTION')
  s.tick(.1)
  assert.equal(findDst(useStore.getState().hardware, 'ZX-4').channel.value, 1)
  assert.equal(valve().open, false)
  assert.deepEqual([label('command', valve().commandedOpen).label, label('feedback', valve().open).label], ['Flush', 'Holding'])
  s.setTraditionalInput('XI-4', 1)
  s.tick(.1)
  assert.equal(valve().open, true)
  assert.equal(label('feedback', valve().open).label, 'Flushing')
  s.closeValve('XV-OPTION')
  s.tick(.1)
  assert.deepEqual([label('command', valve().commandedOpen).label, label('feedback', valve().open).label], ['Hold', 'Flushing'])
  assert.equal(findDst(useStore.getState().hardware, 'ZX-4').channel.value, 0)
  s.setTraditionalInput('XI-4', 0)
  s.tick(.1)
  assert.equal(label('feedback', valve().open).label, 'Holding')
}))
test('configured setup is not deployed setup: missing controller transfer rejects atomically; missing workstation blocks active entry but permits safe Hold', () => fixture((s, alerts) => {
  s.saveDeviceConfiguration('XV-OPTION')
  const before = valve()
  assert.equal(s.downloadDeviceConfiguration('XV-OPTION'), false)
  assert.equal(valve(), before)
  assert.match(alerts.at(-1), /Named Set/)
  s.downloadChangedNamedSets(controller)
  assert.equal(s.downloadDeviceConfiguration('XV-OPTION'), true)
  s.tick(.1)
  assert.ok(label('command', true).error)
  s.openValve('XV-OPTION')
  assert.equal(valve().commandedOpen, false)
  assert.match(alerts.at(-1), /Workstation setup/)
  s.closeValve('XV-OPTION')
  assert.equal(valve().commandedOpen, false)
  s.downloadChangedNamedSets(workstation)
  assert.equal(label('command', true).error, null)
  s.openValve('XV-OPTION')
  assert.equal(valve().commandedOpen, true)
}))
test('invalid/invisible/unselectable mappings reject with diagnostics; failed saved loads retain draft/runtime', () => fixture((s, alerts, db) => {
  const before = record().draft
  for (const bad of [
    { ...mapping, activeCommand: 0 }, { ...mapping, activeFeedback: NaN },
    { ...mapping, passiveFeedback: 99 }, { ...mapping, namedSet: 'MISSING' },
    { ...mapping, activeCommand: 3, activeFeedback: 1 }
  ]) {
    assert.equal(s.editDeviceDraft('XV-OPTION', { descriptors: bad }), false)
    assert.equal(record().draft, before)
  }
  assert.ok(alerts.length >= 5)
  assert.throws(() => parseDeviceDescriptors({ ...mapping, activeCommand: Infinity }), /safe integers/)
  assert.throws(() => parseDeviceDescriptors({ namedSet: 'NS-XV' }), /Malformed/)
  s.saveDeviceConfiguration('XV-OPTION')
  const saved = JSON.parse(db.get(savedDeviceKey('XV-OPTION')))
  saved.configuration.descriptors.passiveFeedback = 'Holding'
  db.set(savedDeviceKey('XV-OPTION'), JSON.stringify(saved))
  assert.equal(s.loadDeviceConfiguration('XV-OPTION'), false)
  assert.equal(record().draft, before)
  assert.equal(valve().descriptors, undefined)
}))
test('offline descriptor changes do not leak; explicit clear returns defaults only after Save/Full download', () => fixture(s => {
  deploy(s)
  s.setDeviceOnline('XV-OPTION', false)
  assert.equal(s.editDeviceDraft('XV-OPTION', { descriptors: undefined }), true)
  assert.equal(label('command', true).label, 'Flush')
  assert.ok(record().saved.descriptors)
  s.saveDeviceConfiguration('XV-OPTION')
  assert.equal(label('command', true).label, 'Flush')
  assert.equal(s.downloadDeviceConfiguration('XV-OPTION'), true)
  assert.equal(valve().descriptors, undefined)
  assert.equal(label('command', true).label, 'OPEN')
  assert.equal(label('feedback', false).label, 'Closed')
}))
test('Named Set edits stay configured until target transfer; workstation labels do not silently use offline definitions', () => fixture(s => {
  deploy(s)
  const changed = { ...definition, entries: definition.entries.map(entry => entry.value === 1 ? { ...entry, name: 'Wash' } : { ...entry }) }
  s.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-XV'], changed)
  assert.equal(label('command', true).label, 'Flush')
  s.downloadChangedNamedSets(controller)
  assert.equal(label('command', true).label, 'Flush')
  s.downloadChangedNamedSets(workstation)
  assert.equal(label('command', true).label, 'Wash')
}))
test('Bad held feedback retains actual descriptor with separate quality; workstation lock still denies active writes', () => fixture(s => {
  deploy(s)
  s.openValve('XV-OPTION')
  s.tick(.1)
  s.setTraditionalInput('XI-4', 1)
  s.tick(.1)
  s.configureTraditionalChannel('CTLR/C03', 4, { dst: 'XI-4', enabled: false })
  s.tick(.1)
  assert.equal(valve().ioInputBad, true)
  assert.equal(valve().open, true)
  assert.equal(label('feedback', valve().open).label, 'Flushing')
  s.closeValve('XV-OPTION')
  useSecurity.setState({ locked: true })
  s.openValve('XV-OPTION')
  assert.equal(valve().commandedOpen, false)
  useSecurity.setState({ locked: false })
  s.openValve('XV-OPTION')
  assert.equal(valve().commandedOpen, true)
  useSecurity.setState({ locked: true })
  s.closeValve('XV-OPTION')
  assert.equal(valve().commandedOpen, true)
}))
test('shared device command path preserves defaults and denies both motor directions while workstation is locked', () => fixture(s => {
  assert.equal(s.createModule({ tag: 'MTR-PLAIN', type: 'MOTOR', area: 'FEED', description: 'Unmanaged motor' }), true)
  useSecurity.setState({ locked: true })
  s.startMotor('MTR-PLAIN')
  assert.equal(useStore.getState().modules['MTR-PLAIN'].commanded, false)
  useSecurity.setState({ locked: false })
  s.startMotor('MTR-PLAIN')
  assert.equal(useStore.getState().modules['MTR-PLAIN'].commanded, true)
  useSecurity.setState({ locked: true })
  s.stopMotor('MTR-PLAIN')
  assert.equal(useStore.getState().modules['MTR-PLAIN'].commanded, true)
  useSecurity.setState({ locked: false })
  s.stopMotor('MTR-PLAIN')
  assert.equal(useStore.getState().modules['MTR-PLAIN'].commanded, false)
}))
