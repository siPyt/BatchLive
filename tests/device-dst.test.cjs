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
const { scanControllerIo } = require('../src/renderer/src/engine/hardware.ts')
const { evalCondition } = require('../src/renderer/src/engine/sfc.ts')
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('blank')
    useStore.setState({ running: true })
    for (const [tag, type] of [['MTR-102', 'MOTOR'], ['XV-TEST', 'VALVE'], ['OTHER', 'MOTOR'], ['DO-TEST', 'DO']]) {
      assert.equal(store.createModule({ tag, type, area: 'FEED', description: 'Device I/O test' }), true)
    }
    store.createController('CTLR', 'External device test')
    store.commissionController('CTLR')
    assert.equal(store.addTraditionalCard('CTLR', 3, 'DI'), true)
    assert.equal(store.addTraditionalCard('CTLR', 4, 'DO'), true)
    for (const [card, dst] of [['CTLR/C03', 'XI-2'], ['CTLR/C04', 'ZX-2']]) {
      assert.equal(store.configureTraditionalChannel(card, 2, { dst, enabled: true }), true)
    }
    useStore.setState(s => ({ modules: { ...s.modules,
      'MTR-102': { ...s.modules['MTR-102'], confirmTimeSec: .3 },
      'XV-TEST': { ...s.modules['XV-TEST'], confirmTimeSec: .3 }
    } }))
    store.tick(.1)
    run(store, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function module(tag = 'MTR-102') { return useStore.getState().modules[tag] }
function channel(dst) { return findDst(useStore.getState().hardware, dst).channel }
function bind(store, tag = 'MTR-102') {
  assert.equal(store.bindDeviceDst(tag, 'input', 'xi-2'), true)
  assert.equal(store.bindDeviceDst(tag, 'output', 'zx-2'), true)
}
function condition(kind, state, tag = 'MTR-102') {
  return evalCondition(kind === 'motorRunning' ? { kind, tag, running: state } : { kind, tag, open: state },
    useStore.getState(), 0)
}
test('XI-2 confirmation is independent of ZX-2 command; no elapsed time fabricates running feedback', () => {
  fixture(store => {
    bind(store)
    store.startMotor('MTR-102')
    for (let i = 0; i < 20; i++) store.tick(.1)
    assert.equal(channel('ZX-2').value, 1)
    assert.equal(channel('XI-2').value, 0)
    assert.equal(module().running, false)
    assert.equal(module().dcState, 'FAILED_ACTIVE')
    assert.equal(condition('motorRunning', true), false)
    assert.equal(store.setTraditionalInput('XI-2', 1), true)
    store.tick(.1)
    assert.equal(module().running, true)
    assert.equal(module().dcState, 'CONFIRMED_ACTIVE')
    assert.equal(condition('motorRunning', true), true)
    store.stopMotor('MTR-102')
    store.tick(.1)
    assert.equal(channel('ZX-2').value, 0)
    assert.equal(module().running, true)
    assert.equal(module().dcState, 'GOING_PASSIVE')
    store.tick(.3)
    assert.equal(module().dcState, 'FAILED_PASSIVE')
    store.setTraditionalInput('XI-2', 0)
    store.tick(.1)
    assert.equal(module().dcState, 'CONFIRMED_PASSIVE')
  })
})
test('only explicit simulated tieback closes the physical valve feedback loop', () => {
  fixture(store => {
    bind(store, 'XV-TEST')
    store.configureTraditionalChannel('CTLR/C03', 2, { dst: 'XI-2', enabled: true, tiebackDst: 'ZX-2' })
    store.tick(.1)
    store.openValve('XV-TEST')
    store.tick(.1)
    assert.equal(channel('ZX-2').value, 1)
    assert.equal(module('XV-TEST').open, false)
    store.tick(.1)
    assert.equal(module('XV-TEST').open, true)
    assert.equal(condition('valveOpen', true, 'XV-TEST'), true)
    store.closeValve('XV-TEST')
    store.tick(.1)
    assert.equal(module('XV-TEST').open, true)
    store.tick(.1)
    assert.equal(module('XV-TEST').open, false)
  })
})
test('permissive, interlock and reset constrain applied output without rewriting external feedback', () => {
  fixture(store => {
    bind(store)
    store.setDeviceOptions('MTR-102', { permissiveRequired: true, resetRequired: true })
    store.setPermissive('MTR-102', false)
    store.startMotor('MTR-102')
    store.tick(.1)
    assert.equal(channel('ZX-2').value, 0)
    store.setPermissive('MTR-102', true)
    store.tick(.1)
    assert.equal(channel('ZX-2').value, 1)
    store.setTraditionalInput('XI-2', 1)
    store.tick(.1)
    store.setPermissive('MTR-102', false)
    store.tick(.1)
    assert.equal(channel('ZX-2').value, 1)
    store.toggleInterlock('MTR-102')
    store.tick(.1)
    assert.equal(module().locked, true)
    assert.equal(module().running, true)
    assert.equal(channel('ZX-2').value, 0)
    store.resetDevice('MTR-102')
    store.tick(.1)
    assert.equal(module().locked, true)
    assert.equal(channel('ZX-2').value, 0)
    store.toggleInterlock('MTR-102')
    store.setTraditionalInput('XI-2', 0)
    store.resetDevice('MTR-102')
    store.tick(.1)
    assert.equal(module().locked, false)
    assert.equal(channel('ZX-2').value, 0)
  })
})
test('disabled DI holds last feedback with Bad quality; no SFC transition or field-fault reset hides failure', () => {
  fixture(store => {
    bind(store)
    store.startMotor('MTR-102')
    store.setTraditionalInput('XI-2', 1)
    store.tick(.1)
    store.configureTraditionalChannel('CTLR/C03', 2, { dst: 'XI-2', enabled: false })
    store.injectFault('MTR-102')
    store.tick(.1)
    assert.equal(module().running, true)
    assert.equal(module().ioInputBad, true)
    assert.equal(condition('motorRunning', true), false)
    assert.equal(condition('motorRunning', false), false)
    assert.equal(channel('ZX-2').value, 0)
    store.resetDevice('MTR-102')
    assert.equal(module().fault, true)
    assert.equal(module().ioInputBad, true)
    store.configureTraditionalChannel('CTLR/C03', 2, { dst: 'XI-2', enabled: true })
    store.tick(.1)
    store.tick(.1)
    assert.equal(module().ioInputBad, false)
    assert.equal(module().fault, true)
    store.injectFault('MTR-102')
    store.tick(.1)
    assert.equal(module().dcState, 'CONFIRMED_ACTIVE')
  })
})
test('disabled DO and controller loss cannot report successful confirmation, and recovery is physical', () => {
  fixture(store => {
    bind(store)
    store.configureTraditionalChannel('CTLR/C03', 2, { dst: 'XI-2', enabled: true, tiebackDst: 'ZX-2' })
    store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-2', enabled: false })
    store.startMotor('MTR-102')
    store.tick(.5)
    assert.equal(module().ioOutputBad, true)
    assert.equal(module().running, false)
    assert.equal(channel('ZX-2').value, 0)
    assert.equal(condition('motorRunning', true), false)
    store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-2', enabled: true })
    for (let i = 0; i < 3; i++) store.tick(.1)
    assert.equal(module().dcState, 'CONFIRMED_ACTIVE')
    assert.equal(store.simulateControllerPowerLoss('CTLR'), true)
    store.tick(.1)
    assert.equal(module().ioInputBad, true)
    assert.equal(module().ioOutputBad, true)
    assert.equal(condition('motorRunning', true), false)
    assert.equal(store.restoreControllerPower('CTLR'), true)
    store.tick(.1)
    assert.equal(module().ioOutputBad, true)
    store.commissionController('CTLR')
    for (let i = 0; i < 4; i++) store.tick(.1)
    assert.equal(module().dcState, 'CONFIRMED_ACTIVE')
  })
})
test('partial and missing channel configurations stay Bad rather than falling back to internal confirmation', () => {
  for (const port of ['input', 'output']) fixture(store => {
    store.bindDeviceDst('MTR-102', port, port === 'input' ? 'XI-2' : 'ZX-2')
    store.startMotor('MTR-102')
    store.tick(5)
    assert.equal(module().running, false)
    assert.equal(condition('motorRunning', true), false)
    assert.equal(port === 'input' ? module().ioOutputBad : module().ioInputBad, true)
    assert.equal(store.bindDeviceDst('MTR-102', port, ''), false)
    store.stopMotor('MTR-102')
    assert.equal(store.bindDeviceDst('MTR-102', port, ''), true)
    store.startMotor('MTR-102')
    store.tick(.5)
    assert.equal(module().running, true)
  })
})
test('one-writer validation works in both directions across DO and device bindings', () => {
  fixture((store, alerts) => {
    assert.equal(store.bindDiscreteDst('DO-TEST', 'ZX-2'), true)
    assert.equal(store.bindDeviceDst('MTR-102', 'output', 'ZX-2'), false)
    store.bindDiscreteDst('DO-TEST', '')
    assert.equal(store.bindDeviceDst('MTR-102', 'output', 'ZX-2'), true)
    assert.equal(store.bindDeviceDst('OTHER', 'output', 'ZX-2'), false)
    assert.equal(store.bindDiscreteDst('DO-TEST', 'ZX-2'), false)
    assert.equal(alerts.length, 3)
  })
})
test('DST references resist rename, count actual resources and are cleaned on module deletion', () => {
  fixture(store => {
    bind(store)
    assert.deepEqual(JSON.parse(JSON.stringify(useStore.getState().hardware)).deviceBindings,
      { 'MTR-102': { input: 'XI-2', output: 'ZX-2' } })
    assert.equal(store.configureTraditionalChannel('CTLR/C03', 2, { dst: 'XI-NEW', enabled: true }), false)
    assert.equal(store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-NEW', enabled: true }), false)
    const state = useStore.getState()
    assert.equal(scanControllerIo(state.hardware, 'CTLR', new Set(Object.keys(state.modules))).channelsBound, 2)
    assert.deepEqual(scanControllerIo(state.hardware, 'CTLR', new Set()).unresolvedBindings, ['MTR-102'])
    store.deleteModule('MTR-102')
    assert.equal(useStore.getState().hardware.deviceBindings['MTR-102'], undefined)
    assert.equal(store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-NEW', enabled: true }), true)
  })
})
test('configuration is atomic for wrong port/type/missing DST, CHARM conflicts and locked engineers', () => {
  fixture((store, alerts) => {
    const before = useStore.getState().hardware
    for (const args of [['MISSING', 'input', 'XI-2'], ['DO-TEST', 'input', 'XI-2'],
      ['MTR-102', 'input', 'ZX-2'], ['MTR-102', 'output', 'XI-2'],
      ['MTR-102', 'input', 'MISSING'], ['MTR-102', 'invalid', 'XI-2']]) {
      assert.equal(store.bindDeviceDst(...args), false)
      assert.equal(useStore.getState().hardware, before)
    }
    useSecurity.setState({ locked: true })
    assert.equal(store.bindDeviceDst('MTR-102', 'input', 'XI-2'), false)
    useSecurity.setState({ locked: false })
    useStore.setState(s => ({ hardware: { ...s.hardware, baseplates: {
      TEST: { channels: [{ boundTag: 'MTR-102' }] }
    } } }))
    assert.equal(store.bindDeviceDst('MTR-102', 'input', 'XI-2'), false)
    assert.equal(alerts.length, 7)
  })
})
test('failed output holds its last applied value distinctly from resolved command, with a real FAIL alarm', () => {
  fixture(store => {
    bind(store)
    store.startMotor('MTR-102')
    store.setTraditionalInput('XI-2', 1)
    store.tick(.1)
    assert.equal(module().appliedCommand, true)
    store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-2', enabled: false })
    store.stopMotor('MTR-102')
    store.tick(.1)
    assert.equal(module().outputCommand, false)
    assert.equal(module().appliedCommand, true)
    assert.equal(module().ioOutputBad, true)
    assert.equal(channel('ZX-2').value, 1)
    assert.equal(condition('motorRunning', true), false)
    const alarm = useStore.getState().alarms.find(alarm => alarm.moduleTag === 'MTR-102' && alarm.type === 'FAIL')
    assert.ok(alarm?.active)
    store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-2', enabled: true })
    store.setTraditionalInput('XI-2', 0)
    store.tick(.1)
    store.tick(.1)
    assert.equal(module().appliedCommand, false)
    assert.equal(module().dcState, 'CONFIRMED_PASSIVE')
    assert.equal(useStore.getState().alarms.find(item => item.id === alarm.id)?.active, false)
  })
})
test('missing and nonfinite feedback remains explicitly Bad even with previously confirmed feedback', () => {
  fixture(store => {
    bind(store)
    store.startMotor('MTR-102')
    store.setTraditionalInput('XI-2', 1)
    store.tick(.1)
    for (const value of [NaN, Infinity]) {
      useStore.setState(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
        'CTLR/C03': { ...s.hardware.traditionalCards['CTLR/C03'],
          channels: s.hardware.traditionalCards['CTLR/C03'].channels.map(c => c.channel === 2 ? { ...c, value } : c) }
      } } }))
      store.tick(.1)
      assert.equal(module().ioInputBad, true)
      assert.equal(module().running, true)
      assert.equal(condition('motorRunning', true), false)
    }
    useStore.setState(s => {
      const cards = { ...s.hardware.traditionalCards }
      delete cards['CTLR/C03']
      return { hardware: { ...s.hardware, traditionalCards: cards } }
    })
    store.tick(.1)
    assert.equal(module().ioInputBad, true)
    assert.equal(module().outputCommand, false)
    assert.equal(condition('motorRunning', false), false)
  })
})
test('a running or still-energized device cannot be rebound or deleted before physical stop confirmation', () => {
  fixture(store => {
    bind(store)
    store.startMotor('MTR-102')
    store.tick(.1)
    assert.equal(store.bindDeviceDst('MTR-102', 'output', ''), false)
    store.deleteModule('MTR-102')
    assert.ok(module())
    store.stopMotor('MTR-102')
    assert.equal(store.bindDeviceDst('MTR-102', 'output', ''), false)
    store.tick(.1)
    assert.equal(module().appliedCommand, false)
    assert.equal(store.bindDeviceDst('MTR-102', 'output', ''), true)
    store.deleteModule('MTR-102')
    assert.equal(module(), undefined)
  })
})
