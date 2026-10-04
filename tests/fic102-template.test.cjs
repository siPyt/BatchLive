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
const { applyAction } = require('../src/renderer/src/engine/sfc.ts')
const { usePictures } = require('../src/renderer/src/engine/pictureStore.ts')
const { pictureAlarmSignal, pictureModeSignal, pictureSignal, parseSavedPicture } = require('../src/renderer/src/engine/pictureDynamics.ts')
const { lifecyclePidModules, savedPidStorageKey } = require('../src/renderer/src/engine/pidLifecycle.ts')

function fic() { return useStore.getState().modules['FIC-102'] }
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(),
    ui: useUi.getState(), window: global.window }
  const local = new Map()
  global.window = {
    alerts: [],
    alert(message) { this.alerts.push(message) },
    localStorage: {
      getItem: key => local.get(key) ?? null,
      setItem: (key, value) => local.set(key, String(value))
    }
  }
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

test('p254 PID_LOOP Save, Full Download, controller binding and Online are isolated and persistent', () => fixture(store => {
  assert.equal(store.bindAnalogDst('FIC-102', 'input', 'FT-2'), true)
  assert.equal(store.bindAnalogDst('FIC-102', 'output', 'FY-2'), true)
  assert.equal(store.enablePidLifecycle('FIC-102'), true)
  let state = useStore.getState()
  assert.equal(state.modules['FIC-102'].mode, 'OOS')
  assert.equal(state.modules['FIC-102'].downloaded, false)
  assert.equal(state.pidLifecycle['FIC-102'].draft.controllerTag, 'CTRL1')
  assert.equal(lifecyclePidModules(state.modules, state.pidLifecycle, 'FIC-102')['FIC-102'].mode, 'AUTO',
    'Control Studio sees the offline draft while runtime stays OOS')
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), false)
  assert.equal(store.downloadPidModule('FIC-102'), false, 'unsaved configuration cannot download')

  assert.equal(store.editPidLifecycle('FIC-102', { outputDst: '' }), true)
  assert.equal(store.downloadPidModule('FIC-102'), false, 'dirty configuration cannot download')
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  const savedKey = savedPidStorageKey('FIC-102')
  const validSaved = global.window.localStorage.getItem(savedKey)
  const beforeBadLoad = useStore.getState().pidLifecycle['FIC-102'].draft
  global.window.localStorage.setItem(savedKey, '{invalid json')
  assert.equal(store.loadSavedPidConfiguration('FIC-102'), false)
  assert.equal(useStore.getState().pidLifecycle['FIC-102'].draft, beforeBadLoad,
    'malformed saved data leaves the offline draft unchanged')
  global.window.localStorage.setItem(savedKey, validSaved)
  assert.equal(store.editPidLifecycle('FIC-102', { outputDst: 'FY-2' }), true)
  assert.equal(store.loadSavedPidConfiguration('FIC-102'), true)
  assert.equal(useStore.getState().pidLifecycle['FIC-102'].draft.outputDst, '')
  assert.equal(store.editPidLifecycle('FIC-102', { outputDst: 'FY-2' }), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)

  assert.equal(store.createController('CTRL2', 'Unconfigured PID target'), true)
  assert.equal(store.commissionController('CTRL2'), true)
  assert.equal(store.editPidLifecycle('FIC-102', { controllerTag: 'CTRL2' }), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  const beforeFailedDownload = useStore.getState().modules['FIC-102']
  assert.equal(store.downloadPidModule('FIC-102'), false, 'I/O must belong to the assigned controller')
  assert.equal(useStore.getState().modules['FIC-102'], beforeFailedDownload, 'failed download retains the last-good runtime')

  assert.equal(store.editPidLifecycle('FIC-102', { controllerTag: 'CTRL1' }), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.downloadPidModule('FIC-102'), true)
  state = useStore.getState()
  assert.deepEqual(state.hardware.analogBindings['FIC-102'], { input: 'FT-2', output: 'FY-2' })
  assert.equal(state.modules['FIC-102'].downloaded, true)
  assert.equal(state.modules['FIC-102'].mode, 'OOS', 'download remains inhibited until Online')
  assert.equal(state.pidLifecycle['FIC-102'].deployedRevision, state.pidLifecycle['FIC-102'].savedRevision)
  assert.equal(store.editPidLifecycle('FIC-102', { outputDst: '' }), true)
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), false, 'stale deployment cannot go Online')
  assert.equal(store.editPidLifecycle('FIC-102', { outputDst: 'FY-2' }), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.downloadPidModule('FIC-102'), true)
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  store.setTraditionalInput('FT-2', 60)
  store.setRunning(true)
  store.tick(0.1)
  store.tick(0.1)
  const online = fic()
  assert.equal(online.mode, 'AUTO')
  assert.equal(online.pv, 60)
  assert.ok(online.out < 50)
  assert.equal(online.io.ao.bad, false)
  assert.equal(findDst(useStore.getState().hardware, 'FY-2').channel.value, online.io.ao.out)
  assert.equal(online.lifecycleOnline, true)

  assert.equal(store.setPidLifecycleOnline('FIC-102', false), true)
  const offline = fic()
  assert.equal(offline.mode, 'OOS')
  applyAction(offline, { kind: 'mode', tag: 'FIC-102', mode: 'AUTO' })
  assert.equal(offline.mode, 'OOS', 'SFC actions cannot bypass the Offline inhibit')
  const priorSp = offline.sp
  store.setSetpoint('FIC-102', 25)
  assert.equal(fic().sp, priorSp, 'operator write cannot modify offline runtime')
  assert.ok(global.window.alerts.some(message => message.includes('Go Online')))
}))

test('p256 FIC-102 picture entry writes bounded SP and only permits configured PID target modes', () => fixture(store => {
  const pictures = usePictures.getState()
  const spId = pictures.addElement('TANK101', { type: 'datalink', x: 24, y: 220,
    tag: 'FIC-102', path: 'PID1/SP', entry: { method: 'NUMERIC', fetchLimits: true, low: 0, high: 100 } })
  const modeId = pictures.addElement('TANK101', { type: 'datalink', x: 24, y: 250,
    tag: 'FIC-102', path: 'PID1/MODE.A_TARGET', entry: { method: 'PID_MODE' } })
  const actualId = pictures.addElement('TANK101', { type: 'datalink', x: 24, y: 265,
    tag: 'FIC-102', path: 'PID1/MODE.A_ACTUAL', flashWhenNotNormal: true })
  const alarmId = pictures.addElement('TANK101', { type: 'datalink', x: 24, y: 280,
    tag: 'FIC-102', path: 'ALARMS[1].A_LAALM', label: true })
  assert.ok(spId, global.window.alerts.at(-1))
  assert.ok(modeId, global.window.alerts.at(-1))
  assert.ok(actualId, global.window.alerts.at(-1))
  assert.ok(alarmId, global.window.alerts.at(-1))
  assert.deepEqual(pictureSignal(usePictures.getState().pictures.TANK101.elements.find(el => el.id === spId),
    useStore.getState().modules), { value: fic().sp, unit: 'GPM', bad: false, low: 0, high: 100, parameter: 'PID1/SP' })
  assert.deepEqual(pictureModeSignal({ tag: 'FIC-102', path: 'PID1/MODE.A_TARGET' },
    useStore.getState().modules), { current: 'AUTO', choices: fic().permittedModes })
  assert.deepEqual(pictureModeSignal({ tag: 'FIC-102', path: 'PID1/MODE.A_ACTUAL' },
    useStore.getState().modules), { current: 'AUTO', isNormal: true })
  const actualDatalink = usePictures.getState().pictures.TANK101.elements.find(el => el.id === actualId)
  assert.equal(pictures.configureDynamics('TANK101', actualId, { path: 'PID1/SP' }), false,
    'normal-mode flashing is restricted to the actual-mode datalink')
  assert.equal(usePictures.getState().pictures.TANK101.elements.find(el => el.id === actualId).path,
    actualDatalink.path)
  assert.deepEqual(pictureAlarmSignal({ tag: 'FIC-102', path: 'ALARMS[1].A_LAALM' },
    useStore.getState().modules, useStore.getState().alarms), { active: false, text: '' })

  assert.equal(pictures.writeNumericValue('TANK101', spId, 75), true)
  assert.equal(fic().sp, 75)
  assert.equal(pictures.writeNumericValue('TANK101', spId, 101), false)
  assert.equal(fic().sp, 75, 'out-of-range SP is rejected without changing the target')
  assert.equal(pictures.writeModeValue('TANK101', modeId, 'MAN'), true)
  assert.equal(fic().mode, 'MAN')
  assert.equal(store.setPidModeFields('FIC-102', { permittedModes: ['MAN', 'AUTO'] }), true)
  assert.deepEqual(pictureModeSignal({ tag: 'FIC-102', path: 'MODE.A_TARGET' },
    useStore.getState().modules), { current: 'MAN', choices: ['MAN', 'AUTO'] })
  assert.equal(pictures.writeModeValue('TANK101', modeId, 'CAS'), false)
  assert.equal(pictures.writeModeValue('TANK101', modeId, 'LO'), false)
  assert.equal(fic().mode, 'MAN', 'excluded and actual-only modes never change the target')

  assert.equal(pictures.savePicture('TANK101'), true)
  const saved = global.window.localStorage.getItem('batchlive.picture.v1.TANK101')
  const parsed = parseSavedPicture(saved, 'TANK101', useStore.getState().modules, useStore.getState())
  assert.deepEqual(parsed.elements.find(el => el.id === modeId).entry, { method: 'PID_MODE' })
  assert.equal(parsed.elements.find(el => el.id === actualId).flashWhenNotNormal, true)
  assert.equal(pictures.configureDynamics('TANK101', modeId, { entry: undefined }), true)
  assert.equal(pictures.loadPicture('TANK101'), true)
  assert.deepEqual(usePictures.getState().pictures.TANK101.elements.find(el => el.id === modeId).entry,
    { method: 'PID_MODE' })
  assert.equal(pictures.configureDynamics('TANK101', actualId, { flashWhenNotNormal: false }), true)
  assert.equal(pictures.loadPicture('TANK101'), true)
  assert.equal(usePictures.getState().pictures.TANK101.elements.find(el => el.id === actualId).flashWhenNotNormal,
    true)
  assert.equal(store.bindAnalogDst('FIC-102', 'input', 'FT-2'), true)
  assert.equal(store.bindAnalogDst('FIC-102', 'output', 'FY-2'), true)
  store.setTraditionalInput('FT-2', 9)
  store.setRunning(true)
  store.tick(0.1)
  store.tick(0.1)
  assert.equal(pictureModeSignal({ tag: 'FIC-102', path: 'PID1/MODE.A_ACTUAL' },
    useStore.getState().modules).isNormal, false)
  assert.deepEqual(pictureAlarmSignal({ tag: 'FIC-102', path: 'ALARMS[1].A_LAALM' },
    useStore.getState().modules, useStore.getState().alarms), { active: true, text: 'ALARM' })
  store.setTraditionalInput('FT-2', 50)
  store.tick(0.1)
  store.tick(0.1)
  assert.deepEqual(pictureAlarmSignal({ tag: 'FIC-102', path: 'ALARMS[1].A_LAALM' },
    useStore.getState().modules, useStore.getState().alarms), { active: false, text: '' })
  assert.equal(store.enablePidLifecycle('FIC-102'), true)
  const offlineSetpoint = fic().sp
  assert.equal(pictures.writeNumericValue('TANK101', spId, 60), false)
  assert.equal(pictures.writeModeValue('TANK101', modeId, 'AUTO'), false)
  assert.equal(fic().sp, offlineSetpoint, 'picture writes cannot bypass the Offline lifecycle inhibit')
}))
