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
const { useUi } = require('../src/renderer/src/ui/uiStore.ts')
const { findDst } = require('../src/renderer/src/engine/traditionalIo.ts')
const { dstUsage } = require('../src/renderer/src/engine/dstUsage.ts')

function fic() { return useStore.getState().modules['FIC-102'] }
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(),
    ui: useUi.getState(), window: global.window }
  global.window = { alert: message => { throw new Error(message) } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('blank')
    assert.equal(store.createArea('PLANT_AREA_A'), true)
    assert.equal(store.createController('CTRL1', 'DV-09 FIC-102 template fixture'), true)
    assert.equal(store.commissionController('CTRL1'), true)
    assert.equal(store.addTraditionalCard('CTRL1', 1, 'AI'), true)
    assert.equal(store.addTraditionalCard('CTRL1', 2, 'AO'), true)
    assert.equal(store.configureTraditionalChannel('CTRL1/C01', 2, { dst: 'FT-2', enabled: true }), true)
    assert.equal(store.configureTraditionalChannel('CTRL1/C02', 2, { dst: 'FY-2', enabled: true }), true)
    assert.equal(store.createModule({ tag: 'FIC-102', type: 'PID', templateId: 'PID_LOOP',
      area: 'PLANT_AREA_A', description: 'REGULATORY CONTROL' }), true)
    run(store)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    useUi.setState(before.ui, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

test('p250/253 PID_LOOP creates the exact FIC-102 control template', () => fixture(() => {
  const m = fic()
  assert.deepEqual([m.tag, m.templateId, m.description, m.primaryDisplay, m.unit, m.pvMin, m.pvMax],
    ['FIC-102', 'PID_LOOP', 'REGULATORY CONTROL', 'TANK101', 'GPM', 0, 100])
  assert.deepEqual([m.gain, m.reset, m.rate, m.direct, m.outputAction, m.mode, m.normalMode],
    [0.5, 3, 0, false, 'INCREASE_TO_OPEN', 'AUTO', 'AUTO'])
  assert.deepEqual(m.alarms.filter(alarm => alarm.type === 'LO' || alarm.type === 'HI')
    .map(({ type, limit, enabled }) => [type, limit, enabled]), [['HI', 90, true], ['LO', 10, true]])
  assert.deepEqual(m.permittedModes, ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN', 'OOS'])
  assert.equal(m.io.aiConnected && m.io.aoConnected && m.io.bkcalConnected, true)
  const stored = JSON.parse(JSON.stringify(m))
  assert.deepEqual([stored.templateId, stored.primaryDisplay, stored.outputAction, stored.gain, stored.reset],
    ['PID_LOOP', 'TANK101', 'INCREASE_TO_OPEN', 0.5, 3])
  assert.equal(useUi.getState().openModuleDisplay('FIC-102', 'primary'), true)
  assert.equal(useUi.getState().display, 'builder')
  assert.equal(useUi.getState().builderPicture, 'TANK101')
}))

test('p251/255 FIC-102 occupies FT-2/FY-2 once and executes applied reverse-acting output', () => fixture(store => {
  const hw = useStore.getState().hardware
  assert.deepEqual(dstUsage(hw, useStore.getState().modules).byType.AI.referenced, 0)
  assert.deepEqual(dstUsage(hw, useStore.getState().modules).byType.AO.referenced, 0)
  assert.equal(store.bindAnalogDst('FIC-102', 'input', 'FT-2'), true)
  assert.equal(store.bindAnalogDst('FIC-102', 'output', 'FY-2'), true)
  assert.equal(store.bindAnalogDst('FIC-102', 'input', 'FT-2'), true)
  assert.equal(store.bindAnalogDst('FIC-102', 'output', 'FY-2'), true)
  assert.deepEqual([dstUsage(useStore.getState().hardware, useStore.getState().modules).byType.AI.referenced,
    dstUsage(useStore.getState().hardware, useStore.getState().modules).byType.AO.referenced], [1, 1])
  store.setTraditionalInput('FT-2', 60)
  store.setRunning(true)
  store.tick(0.1)
  store.tick(0.1)
  let m = fic()
  assert.equal(m.pv, 60)
  assert.ok(m.out < 50, 'reverse action reduces output as measured flow exceeds SP')
  assert.ok(m.out >= 0 && m.out <= 100, 'PID output remains bounded')
  assert.equal(m.io.ao.out, m.out)
  assert.equal(findDst(useStore.getState().hardware, 'FY-2').channel.value, m.io.ao.out)
  assert.equal(m.io.ao.bad, false)

  store.setTraditionalInput('FT-2', 9)
  store.tick(0.1)
  store.tick(0.1)
  m = fic()
  assert.equal(m.pv, 9)
  assert.ok(useStore.getState().alarms.some(alarm => alarm.moduleTag === 'FIC-102' &&
    alarm.type === 'LO' && alarm.active))
  store.setTraditionalInput('FT-2', 91)
  store.tick(0.1)
  store.tick(0.1)
  m = fic()
  assert.equal(m.pv, 91)
  assert.ok(useStore.getState().alarms.some(alarm => alarm.moduleTag === 'FIC-102' &&
    alarm.type === 'HI' && alarm.active))
}))

test('template IDs are validated while custom PID defaults remain unchanged', () => fixture(store => {
  let validationMessage
  global.window.alert = message => { validationMessage = message }
  assert.equal(store.createModule({ tag: 'NOT-PID', type: 'AI', templateId: 'PID_LOOP',
    area: 'PLANT_AREA_A', description: 'Invalid template use' }), false)
  assert.equal(validationMessage, 'PID_LOOP template can only create a PID module')
  assert.equal(store.createModule({ tag: 'PID-CUSTOM', type: 'PID',
    area: 'PLANT_AREA_A', description: 'Regular PID', unit: '%', pvMin: 0, pvMax: 200 }), true)
  const custom = useStore.getState().modules['PID-CUSTOM']
  assert.equal(custom.type, 'PID')
  assert.deepEqual([custom.unit, custom.pvMin, custom.pvMax, custom.gain, custom.reset, custom.templateId],
    ['%', 0, 200, 1, 20, undefined])
  assert.equal(custom.normalMode, undefined)
  assert.equal(custom.permittedModes, undefined)
  assert.equal(custom.rate, undefined)
}))
