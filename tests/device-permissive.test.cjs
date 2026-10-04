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
const { devicePermissiveSignal } = require('../src/renderer/src/engine/simulate.ts')
const { moduleExecutionOrder } = require('../src/renderer/src/engine/fb.ts')
const { connectedModuleTags, buildControlDiagram } = require('../src/renderer/src/engine/controlDiagram.ts')
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('blank')
    useStore.setState({ running: true })
    for (const [tag, type, fbType] of [
      ['MTR-102', 'MOTOR'], ['XV-TEST', 'VALVE'], ['PERMIT', 'FB', 'AND'], ['VALVE-OPEN', 'DI'], ['LEVEL-OK', 'DI']
    ]) assert.equal(store.createModule({ tag, type, fbType, area: 'FEED', description: 'Permissive test' }), true)
    store.setFbInput('PERMIT', 'in1', { kind: 'ref', tag: 'VALVE-OPEN', value: 0 })
    store.setFbInput('PERMIT', 'in2', { kind: 'ref', tag: 'LEVEL-OK', value: 0 })
    store.setDeviceOptions('MTR-102', { permissiveRequired: true, resetRequired: true })
    store.setDeviceOptions('XV-TEST', { permissiveRequired: true })
    useStore.setState(s => ({ modules: { ...s.modules,
      'MTR-102': { ...s.modules['MTR-102'], confirmTimeSec: .2 },
      'XV-TEST': { ...s.modules['XV-TEST'], confirmTimeSec: .2 }
    } }))
    run(store, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function input(tag, state, patch = {}) {
  useStore.setState(s => ({ modules: { ...s.modules, [tag]: { ...s.modules[tag], state, ...patch } } }))
}
function module(tag) { return useStore.getState().modules[tag] }
test('upstream AND executes before motor/valve and live permit gates real start/open feedback', () => {
  fixture(store => {
    assert.equal(store.setPermissiveSource('MTR-102', 'PERMIT'), true)
    assert.equal(store.setPermissiveSource('XV-TEST', 'PERMIT'), true)
    store.startMotor('MTR-102')
    store.openValve('XV-TEST')
    store.tick(.1)
    assert.equal(module('MTR-102').running, false)
    assert.equal(module('XV-TEST').open, false)
    input('VALVE-OPEN', true)
    store.tick(.1)
    assert.equal(module('MTR-102').permissiveOk, false)
    input('LEVEL-OK', true)
    store.tick(.1)
    assert.equal(module('PERMIT').out, 1)
    assert.equal(module('MTR-102').permissiveOk, true)
    assert.equal(module('MTR-102').running, false)
    store.tick(.1)
    assert.equal(module('MTR-102').running, true)
    assert.equal(module('XV-TEST').open, true)
  })
})
test('permissive loss denies a new start, not a shutdown; an interlock remains an independent trip requiring reset', () => {
  fixture(store => {
    store.setPermissiveSource('MTR-102', 'PERMIT')
    input('VALVE-OPEN', true)
    input('LEVEL-OK', true)
    store.startMotor('MTR-102')
    store.tick(.2)
    assert.equal(module('MTR-102').running, true)
    input('LEVEL-OK', false)
    store.tick(.1)
    assert.equal(module('MTR-102').permissiveOk, false)
    assert.equal(module('MTR-102').running, true)
    store.toggleInterlock('MTR-102')
    store.tick(.1)
    assert.equal(module('MTR-102').running, false)
    assert.equal(module('MTR-102').locked, true)
    store.toggleInterlock('MTR-102')
    store.resetDevice('MTR-102')
    store.tick(.2)
    assert.equal(module('MTR-102').locked, false)
    assert.equal(module('MTR-102').running, false)
    input('LEVEL-OK', true)
    store.tick(.2)
    assert.equal(module('MTR-102').running, true)
  })
})
test('Bad and OOS DI feedback propagates through a held high logic output and denies the permit', () => {
  for (const patch of [{ ioBad: true }, { mode: 'OOS' }]) fixture(store => {
    store.setPermissiveSource('MTR-102', 'PERMIT')
    input('VALVE-OPEN', true)
    input('LEVEL-OK', true)
    store.tick(.1)
    assert.equal(module('PERMIT').out, 1)
    if (patch.ioBad) {
      store.createController('CTLR', 'Permissive quality test')
      store.commissionController('CTLR')
      assert.equal(store.addTraditionalCard('CTLR', 1, 'DI'), true)
      assert.equal(store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'PERMIT-DI', enabled: false }), true)
      assert.equal(store.bindDiscreteDst('LEVEL-OK', 'PERMIT-DI'), true)
    } else input('LEVEL-OK', true, patch)
    store.startMotor('MTR-102')
    store.tick(.2)
    assert.equal(module('PERMIT').out, 1)
    assert.equal(module('PERMIT').bad, true)
    assert.equal(module('MTR-102').permissiveOk, false)
    assert.equal(module('MTR-102').running, false)
    assert.deepEqual(devicePermissiveSignal(module('MTR-102'), useStore.getState().modules), { value: 0, bad: true })
    if (patch.ioBad) {
      assert.equal(store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'PERMIT-DI', enabled: true }), true)
      assert.equal(store.setTraditionalInput('PERMIT-DI', 1), true)
      store.tick(.1)
    } else input('LEVEL-OK', true, { ioBad: false, mode: 'AUTO' })
    store.tick(.2)
    assert.equal(module('MTR-102').running, true)
  })
})
test('missing, nonfinite and Bad/OOS source values never masquerade as an active permissive', () => {
  fixture(store => {
    const state = useStore.getState()
    const device = { ...module('MTR-102'), permissiveSource: 'SOURCE' }
    for (const source of [undefined,
      { type: 'FB', out: NaN }, { type: 'FB', out: Infinity },
      { type: 'FB', out: 1, bad: true }, { type: 'AI', pv: 150, pvBad: true },
      { type: 'PID', pv: 150, pvBad: true }, { type: 'AO', out: 100, actualMode: 'OOS' },
      { type: 'DI', state: true, mode: 'OOS' }, { type: 'DO', state: true, ioBad: true }
    ]) assert.deepEqual(devicePermissiveSignal(device, { ...state.modules, ...(source ? { SOURCE: source } : {}) }),
      { value: 0, bad: true })
    store.setPermissiveSource('MTR-102', 'PERMIT')
    store.deleteModule('PERMIT')
    store.startMotor('MTR-102')
    store.tick(.2)
    assert.equal(module('MTR-102').permissiveOk, false)
    assert.equal(module('MTR-102').running, false)
  })
})
test('configuration rejects missing/self/wrong-type targets atomically, and locked engineers cannot write', () => {
  fixture((store, alerts) => {
    const before = module('MTR-102')
    for (const [target, source] of [['MTR-102', 'MISSING'], ['MTR-102', 'MTR-102'],
      ['PERMIT', 'LEVEL-OK'], ['MISSING', 'PERMIT'], ['MTR-102', '']]) {
      assert.equal(store.setPermissiveSource(target, source), false)
      assert.equal(module('MTR-102'), before)
    }
    assert.equal(alerts.length, 5)
    assert.equal(useStore.getState().eventLog.filter(event =>
      event.category === 'DIAGNOSTIC' && event.description.startsWith('Permissive wiring rejected')).length, 5)
    useSecurity.setState({ locked: true })
    assert.equal(store.setPermissiveSource('MTR-102', 'PERMIT'), false)
    assert.equal(module('MTR-102'), before)
    useSecurity.setState({ locked: false })
    assert.equal(store.setPermissiveSource('MTR-102', 'PERMIT'), true)
    assert.equal(before.permissiveSource, undefined)
  })
})
test('disconnect clears the inherited permit and restores explicit manual control without a hidden wire', () => {
  fixture(store => {
    store.setPermissiveSource('MTR-102', 'PERMIT')
    input('VALVE-OPEN', true)
    input('LEVEL-OK', true)
    store.tick(.1)
    assert.equal(module('MTR-102').permissiveOk, true)
    assert.equal(store.setPermissiveSource('MTR-102', undefined), true)
    assert.equal(module('MTR-102').permissiveOk, false)
    store.startMotor('MTR-102')
    store.tick(.2)
    assert.equal(module('MTR-102').running, false)
    store.setPermissive('MTR-102', true)
    store.tick(.2)
    assert.equal(module('MTR-102').running, true)
    assert.equal(buildControlDiagram(connectedModuleTags(useStore.getState().modules, 'MTR-102'),
      useStore.getState().modules).wires.some(wire => wire.which === 'permissive'), false)
  })
})
test('connected strategy and JSON persistence preserve the exact permit wire and execution dependency', () => {
  fixture(store => {
    store.setPermissiveSource('MTR-102', 'PERMIT')
    const modules = JSON.parse(JSON.stringify(useStore.getState().modules))
    const order = moduleExecutionOrder(modules)
    assert.ok(order.indexOf('LEVEL-OK') < order.indexOf('PERMIT'))
    assert.ok(order.indexOf('PERMIT') < order.indexOf('MTR-102'))
    const tags = connectedModuleTags(modules, 'MTR-102')
    assert.ok(tags.includes('PERMIT') && tags.includes('VALVE-OPEN') && tags.includes('LEVEL-OK'))
    assert.ok(buildControlDiagram(tags, modules).wires.some(wire =>
      wire.fromTag === 'PERMIT' && wire.toTag === 'MTR-102' && wire.which === 'permissive'))
    assert.equal(modules['MTR-102'].permissiveSource, 'PERMIT')
  })
})
