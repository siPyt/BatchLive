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
function motor() { return useStore.getState().modules['MTR-102'] }
function condition(name) { return motor().ownedBlocks[name] }
function channel(dst) { return findDst(useStore.getState().hardware, dst).channel }
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
    assert.equal(s.createController('CTLR', 'Exact course motor prerequisites'), true)
    s.commissionController('CTLR')
    for (const [slot, type] of [[1, 'AI'], [2, 'AO'], [3, 'DI'], [4, 'DO']]) {
      assert.equal(s.addTraditionalCard('CTLR', slot, type), true)
    }
    for (const [id, number, dst, tiebackDst] of [
      ['CTLR/C02', 1, 'LY-1'], ['CTLR/C01', 1, 'LT-1', 'LY-1'],
      ['CTLR/C04', 1, 'XV-1'], ['CTLR/C03', 1, 'LSO-1', 'XV-1'],
      ['CTLR/C04', 2, 'ZX-2'], ['CTLR/C03', 2, 'XI-2', 'ZX-2']
    ]) assert.equal(s.configureTraditionalChannel(id, number, { dst, enabled: true, tiebackDst }), true)
    for (const [tag, type] of [['LI-101', 'AI'], ['LEVEL-101', 'AO'], ['XV-101', 'DO'], ['XVSTAT-101', 'DI']]) {
      assert.equal(s.createModule({ tag, type, area: 'FEED', description: tag,
        unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
    }
    assert.equal(s.bindAnalogDst('LI-101', 'input', 'LT-1'), true)
    assert.equal(s.bindDiscreteDst('XV-101', 'XV-1'), true)
    assert.equal(s.bindDiscreteDst('XVSTAT-101', 'LSO-1'), true)
    assert.equal(s.enableModuleLifecycle('LEVEL-101'), true)
    assert.equal(s.addAoParameter('LEVEL-101', 'CAS_SP', 500), true)
    assert.equal(s.connectAoParameter('LEVEL-101', 'CAS_SP'), true)
    assert.equal(s.editModuleDraft('LEVEL-101', { controllerTag: 'CTLR', outputDst: 'LY-1',
      pvMin: 0, pvMax: 1000, spLow: 0, spHigh: 1000, mode: 'CAS' }), true)
    assert.equal(s.saveModuleConfiguration('LEVEL-101'), true)
    assert.equal(s.downloadModule('LEVEL-101', 'FULL'), true)
    assert.equal(s.setModuleOnline('LEVEL-101', true), true)
    s.tick(.1)
    assert.equal(s.createMotorTemplate('MTR-102', 'FEED'), true)
    s.setFbConfig('MTR-102/CND1', { expr: "'//XVSTAT-101/DI1/PV_D' = 0", delaySec: 0 })
    s.setFbConfig('MTR-102/CND2', { expr: "'//LI-101/AI1/PV' < 50", delaySec: 4 })
    s.setFbInput('MTR-102/AND1', 'in1', { kind: 'ref', tag: 'XVSTAT-101', value: 0 })
    assert.equal(s.editDeviceDraft('MTR-102', { controllerTag: 'CTLR',
      inputDst: 'XI-2', outputDst: 'ZX-2' }), true)
    assert.equal(s.saveDeviceConfiguration('MTR-102'), true)
    assert.equal(s.downloadDeviceConfiguration('MTR-102'), true)
    assert.equal(s.setDeviceOnline('MTR-102', true), true)
    s.toggleDO('XV-101')
    s.tick(.1)
    s.tick(.1)
    s.resetDevice('MTR-102')
    assert.equal(s.setFbSafety('MTR-102/BFI1', 'RESET_IN', true), true)
    s.tick(.1)
    assert.equal(useStore.getState().modules['LI-101'].pv, 500)
    assert.equal(motor().interlock, false)
    assert.equal(motor().locked, false)
    assert.equal(alerts.length, 0)
    run(s)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
function start(s) {
  s.startMotor('MTR-102')
  s.tick(.1)
  assert.equal(channel('ZX-2').value, 1)
  assert.equal(motor().running, false)
  s.tick(.1)
  assert.equal(motor().running, true)
}
function level(s, value) {
  assert.equal(s.setAoParameter('LEVEL-101', 'CAS_SP', value), true)
  s.tick(.1)
  assert.equal(channel('LY-1').value, value / 10)
  s.tick(.1)
  assert.equal(useStore.getState().modules['LI-101'].pv, value)
}
test('DV09 p234: 500gal permits operation; closing actual DO/DI valve trips immediately and requires motor reset', () => fixture(s => {
  start(s)
  s.toggleDO('XV-101')
  s.tick(.1)
  assert.equal(motor().interlock, false)
  s.tick(.1)
  assert.equal(useStore.getState().modules['XVSTAT-101'].state, false)
  assert.equal(condition('BFI1').firstOut, 1)
  assert.equal(motor().interlock, true)
  assert.equal(motor().permissiveOk, false)
  assert.equal(channel('ZX-2').value, 0)
  assert.equal(motor().running, true)
  s.tick(.1)
  assert.equal(motor().running, false)
  s.toggleDO('XV-101')
  s.tick(.1)
  s.tick(.1)
  assert.equal(motor().interlock, false)
  assert.equal(motor().locked, true)
  s.startMotor('MTR-102')
  s.tick(.1)
  assert.equal(channel('ZX-2').value, 0)
  s.resetDevice('MTR-102')
  start(s)
}))
test('DV09 p234: actual saved LEVEL-101 CAS_SP10 becomes 1%/10gal and trips only after four continuous seconds', () => fixture(s => {
  start(s)
  level(s, 10)
  for (let scan = 0; scan < 38; scan++) s.tick(.1)
  assert.equal(condition('CND2').out, 0)
  assert.equal(motor().interlock, false)
  assert.equal(channel('ZX-2').value, 1)
  s.tick(.1)
  assert.equal(condition('CND2').out, 1)
  assert.equal(condition('BFI1').firstOut, 2)
  assert.equal(motor().locked, true)
  assert.equal(channel('ZX-2').value, 0)
  assert.equal(motor().running, true)
  s.tick(.1)
  assert.equal(motor().running, false)
  level(s, 500)
  assert.equal(motor().interlock, false)
  assert.equal(motor().locked, true)
  assert.equal(condition('BFI1').firstOut, 2)
  s.setFbSafety('MTR-102/BFI1', 'RESET_IN', true)
  s.tick(.1)
  assert.equal(condition('BFI1').firstOut, 0)
  assert.equal(motor().locked, true)
  s.resetDevice('MTR-102')
  start(s)
}))
test('exact course scale retains 50gal boundary; Bad tied-back level fails safe and recovery needs a fresh four seconds', () => fixture(s => {
  start(s)
  level(s, 50)
  for (let scan = 0; scan < 50; scan++) s.tick(.1)
  assert.equal(condition('CND2').out, 0)
  assert.equal(motor().interlock, false)
  level(s, 10)
  s.tick(2)
  assert.equal(s.configureTraditionalChannel('CTLR/C01', 1,
    { dst: 'LT-1', enabled: false, tiebackDst: 'LY-1' }), true)
  s.tick(.1)
  assert.equal(useStore.getState().modules['LI-101'].pvBad, true)
  assert.equal(condition('CND2').bad, true)
  assert.equal(condition('NOT1').bad, true)
  assert.equal(motor().interlock, true)
  assert.equal(channel('ZX-2').value, 0)
  assert.equal(s.configureTraditionalChannel('CTLR/C01', 1,
    { dst: 'LT-1', enabled: true, tiebackDst: 'LY-1' }), true)
  s.tick(.1)
  for (let scan = 0; scan < 39; scan++) s.tick(.1)
  assert.equal(condition('CND2').out, 0)
  s.tick(.1)
  assert.equal(condition('CND2').out, 1)
}))
