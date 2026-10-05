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
const { moduleTrendPens, availableTrendPens } = require('../src/renderer/src/engine/trendPens.ts')
const { analyzePidTuneTest, pidTuneSample, pidTuneSignature } = require('../src/renderer/src/engine/pidTuneTest.ts')
const { moduleDownloadStatus } = require('../src/renderer/src/engine/downloadStatus.ts')

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

function mixedRegulatoryFixture(store) {
  store.bindAnalogDst('FIC-102', 'input', 'FT-2')
  store.bindAnalogDst('FIC-102', 'output', 'FY-2')
  assert.equal(store.enablePidLifecycle('FIC-102'), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.configureTraditionalChannel('CTRL1/C02', 1, { dst: 'LEVEL-OUT', enabled: true }), true)
  assert.equal(store.createModule({ tag: 'LEVEL-AO', type: 'AO', area: 'PLANT_AREA_A',
    description: 'Mixed scope AO', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
  assert.equal(store.bindAnalogDst('LEVEL-AO', 'output', 'LEVEL-OUT'), true)
  assert.equal(store.addAoParameter('LEVEL-AO', 'CAS_SP', 500), true)
  assert.equal(store.connectAoParameter('LEVEL-AO', 'CAS_SP'), true)
  assert.equal(store.enableModuleLifecycle('LEVEL-AO'), true)
  assert.equal(store.editModuleDraft('LEVEL-AO', { controllerTag: 'CTRL1', mode: 'CAS' }), true)
  assert.equal(store.saveModuleConfiguration('LEVEL-AO'), true)
}

function allManagedFixture(store) {
  mixedRegulatoryFixture(store)
  for (const [slot, type] of [[3, 'DI'], [4, 'DO']]) {
    assert.equal(store.addTraditionalCard('CTRL1', slot, type), true)
    for (let channel = 1; channel <= 2; channel++) {
      assert.equal(store.configureTraditionalChannel(`CTRL1/C0${slot}`, channel,
        { dst: `${type}-${channel}`, enabled: true }), true)
    }
  }
  for (const [tag, type, channel] of [['MIX-MTR', 'MOTOR', 1], ['MIX-XV', 'VALVE', 2]]) {
    assert.equal(store.createModule({ tag, type, area: 'PLANT_AREA_A', description: 'Managed scope fixture' }), true)
    assert.equal(store.enableDeviceLifecycle(tag), true)
    assert.equal(store.editDeviceDraft(tag, { controllerTag: 'CTRL1', inputDst: `DI-${channel}`,
      outputDst: `DO-${channel}`, resetRequired: false }), true)
    assert.equal(store.saveDeviceConfiguration(tag), true)
  }
  assert.equal(store.createSfc('MIX-SFC', 'PLANT_AREA_A', { managed: true }), true)
  store.setSfcSteps('MIX-SFC', [{ id: 'first', name: 'FIRST',
    actions: [{ kind: 'sp', tag: 'FIC-102', value: 80, qualifier: 'N' }],
    transition: { kind: 'timer', seconds: 10 } }])
  assert.equal(store.configureSfcController('MIX-SFC', 'CTRL1'), true)
  assert.equal(store.saveSfc('MIX-SFC'), true)
  store.setRunning(true)
  store.tick(.1)
}

test('managed controller Full commits AO/PID/motor/valve/SFC once with safe execution boundaries and no implicit SFC actions', () => fixture(store => {
  allManagedFixture(store)
  const before = useStore.getState()
  const review = { 'LEVEL-AO': before.moduleLifecycle['LEVEL-AO'].saved, 'FIC-102': before.pidLifecycle['FIC-102'].saved,
    'MIX-MTR': before.deviceLifecycle['MIX-MTR'].saved, 'MIX-XV': before.deviceLifecycle['MIX-XV'].saved,
    'MIX-SFC': before.sfcLifecycle['MIX-SFC'].saved }
  const pidStorage = window.localStorage.getItem(savedPidStorageKey('FIC-102'))
  let commits = 0
  const unsubscribe = useStore.subscribe((next, prev) => { if (next.modules !== prev.modules) commits++ })
  assert.equal(store.downloadControllerManagedModules('CTRL1', review), true)
  unsubscribe()
  const after = useStore.getState()
  assert.equal(commits, 1)
  assert.equal(after.rev, before.rev + 1)
  assert.equal(after.modules['FIC-102'].sp, before.modules['FIC-102'].sp)
  assert.equal(after.sfcs['MIX-SFC'].status, 'READY')
  assert.equal(after.sfcLifecycle['MIX-SFC'].online, false)
  assert.equal(after.pidLifecycle['FIC-102'].online, false)
  assert.equal(after.modules['FIC-102'].mode, 'OOS')
  for (const [tag, map] of Object.entries({ 'LEVEL-AO': 'moduleLifecycle', 'FIC-102': 'pidLifecycle',
    'MIX-MTR': 'deviceLifecycle', 'MIX-XV': 'deviceLifecycle', 'MIX-SFC': 'sfcLifecycle' })) {
    assert.equal(after[map][tag].saved, before[map][tag].saved)
    assert.equal(after[map][tag].draft, before[map][tag].draft)
    assert.equal(moduleDownloadStatus(after, tag).status, 'MATCH')
  }
  assert.equal(after.namedSets, before.namedSets)
  assert.equal(window.localStorage.getItem(savedPidStorageKey('FIC-102')), pidStorage)
  store.tick(.1)
  assert.equal(useStore.getState().modules['LEVEL-AO'].out, 50)
  assert.equal(useStore.getState().modules['MIX-MTR'].running, false)
  assert.equal(useStore.getState().modules['MIX-XV'].open, false)
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  assert.equal(store.setSfcOnline('MIX-SFC', true), true)
  store.sfcCommand('MIX-SFC', 'run')
  store.tick(.1)
  assert.equal(fic().sp, 80)
  store.startMotor('MIX-MTR')
  store.tick(.1)
  assert.equal(findDst(useStore.getState().hardware, 'DO-1').channel.value, 1)
  assert.equal(useStore.getState().modules['MIX-MTR'].running, false)
  assert.equal(store.setTraditionalInput('DI-1', 1), true)
  store.tick(.1)
  assert.equal(useStore.getState().modules['MIX-MTR'].running, true)
}))

test('managed controller Full rejects active/passive-channel device failures and late SFC failures without partial regulatory transfer', () => fixture(store => {
  allManagedFixture(store)
  const base = useStore.getState()
  const unchanged = () => {
    const before = useStore.getState()
    assert.equal(store.downloadControllerManagedModules('CTRL1'), false)
    for (const key of ['modules', 'hardware', 'sfcs', 'moduleLifecycle', 'pidLifecycle', 'deviceLifecycle', 'sfcLifecycle', 'rev']) {
      assert.equal(useStore.getState()[key], before[key])
    }
  }
  useStore.setState({ modules: { ...base.modules, 'MIX-MTR': { ...base.modules['MIX-MTR'], running: true } } })
  unchanged()
  useStore.setState({ modules: base.modules })
  store.setTraditionalInput('DI-1', 1)
  unchanged()
  store.setTraditionalInput('DI-1', 0)
  const passive = useStore.getState()
  useStore.setState({ sfcs: { ...passive.sfcs, 'MIX-SFC': { ...passive.sfcs['MIX-SFC'], status: 'HELD' } } })
  unchanged()
  useStore.setState({ sfcs: passive.sfcs, sfcLifecycle: { ...passive.sfcLifecycle,
    'MIX-SFC': { ...passive.sfcLifecycle['MIX-SFC'], online: true } } })
  unchanged()
  useStore.setState({ sfcLifecycle: passive.sfcLifecycle })
  store.setSfcSteps('MIX-SFC', [{ id: 'first', name: 'Changed',
    actions: [], transition: { kind: 'timer', seconds: 20 } }])
  unchanged()
  assert.equal(useStore.getState().modules['LEVEL-AO'].downloaded, false)
  assert.equal(useStore.getState().modules['FIC-102'].downloaded, false)
  assert.equal(useStore.getState().deviceLifecycle['MIX-MTR'].deployed, undefined)
}))

test('managed controller Full rejects stale complete scope, denied/locked/down targets and supports device/SFC-only controller batches', () => fixture(store => {
  allManagedFixture(store)
  const before = useStore.getState()
  assert.equal(store.downloadControllerManagedModules('CTRL1', { 'MIX-SFC': before.sfcLifecycle['MIX-SFC'].saved }), false)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(store.downloadControllerManagedModules('CTRL1'), false)
  useSecurity.setState({ currentUser: 'admin', locked: true })
  assert.equal(store.downloadControllerManagedModules('CTRL1'), false)
  useSecurity.setState({ locked: false })
  assert.equal(store.downloadControllerManagedModules('MISSING'), false)
  useStore.setState({ hardware: { ...before.hardware, controllers: { ...before.hardware.controllers,
    CTRL1: { ...before.hardware.controllers.CTRL1, primary: 'FAILED', secondary: 'FAILED' } } } })
  assert.equal(store.downloadControllerManagedModules('CTRL1'), false)
  assert.equal(useStore.getState().modules, before.modules)
  assert.equal(useStore.getState().deviceLifecycle, before.deviceLifecycle)
  useStore.setState({ hardware: before.hardware, moduleLifecycle: {}, pidLifecycle: {} })
  assert.equal(store.downloadControllerManagedModules('CTRL1'), true)
  assert.equal(useStore.getState().modules['LEVEL-AO'], before.modules['LEVEL-AO'])
  assert.equal(useStore.getState().modules['FIC-102'], before.modules['FIC-102'])
  assert.equal(useStore.getState().modules['MIX-MTR'].downloaded, true)
  assert.equal(useStore.getState().sfcs['MIX-SFC'].status, 'READY')
}))

test('mixed controller AO/PID Full commits once, preserves saved data and keeps PID held Offline until explicit Online', () => fixture(store => {
  mixedRegulatoryFixture(store)
  const before = useStore.getState()
  const savedText = window.localStorage.getItem(savedPidStorageKey('FIC-102'))
  const review = { 'LEVEL-AO': before.moduleLifecycle['LEVEL-AO'].saved, 'FIC-102': before.pidLifecycle['FIC-102'].saved }
  let writes = 0
  const unsubscribe = useStore.subscribe((next, prev) => {
    if (next.moduleLifecycle !== prev.moduleLifecycle || next.pidLifecycle !== prev.pidLifecycle) writes++
  })
  assert.equal(store.downloadControllerRegulatory('CTRL1', review), true)
  unsubscribe()
  const after = useStore.getState()
  assert.equal(writes, 1)
  assert.equal(after.rev, before.rev + 1)
  assert.equal(after.pidLifecycle['FIC-102'].saved, before.pidLifecycle['FIC-102'].saved)
  assert.equal(after.pidLifecycle['FIC-102'].draft, before.pidLifecycle['FIC-102'].draft)
  assert.equal(after.moduleLifecycle['LEVEL-AO'].saved, before.moduleLifecycle['LEVEL-AO'].saved)
  assert.equal(after.deviceLifecycle, before.deviceLifecycle)
  assert.equal(after.sfcLifecycle, before.sfcLifecycle)
  assert.equal(window.localStorage.getItem(savedPidStorageKey('FIC-102')), savedText)
  assert.equal(fic().mode, 'OOS')
  assert.equal(fic().downloaded, true)
  assert.equal(fic().lifecycleOnline, false)
  assert.equal(after.pidLifecycle['FIC-102'].online, false)
  assert.equal(moduleDownloadStatus(after, 'FIC-102').status, 'MATCH')
  assert.equal(moduleDownloadStatus(after, 'LEVEL-AO').status, 'MATCH')
  store.setRunning(true)
  store.tick(.1)
  assert.equal(useStore.getState().modules['LEVEL-AO'].out, 50)
  assert.equal(fic().actualMode, 'OOS')
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  store.setTraditionalInput('FT-2', 60)
  store.tick(.1); store.tick(.1)
  assert.equal(fic().pv, 60)
  assert.notEqual(fic().actualMode, 'OOS')
  assert.equal(findDst(useStore.getState().hardware, 'FY-2').channel.value, fic().io.ao.out)
}))

test('mixed controller AO/PID Full refuses invalid PID after AO preparation without partially transferring AO', () => fixture(store => {
  mixedRegulatoryFixture(store)
  assert.equal(store.editPidLifecycle('FIC-102', { inputDst: '' }), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  const before = useStore.getState()
  assert.equal(store.downloadControllerRegulatory('CTRL1'), false)
  for (const key of ['modules', 'moduleLifecycle', 'pidLifecycle', 'hardware', 'rev']) {
    assert.equal(useStore.getState()[key], before[key])
  }
  assert.equal(useStore.getState().modules['LEVEL-AO'].downloaded, false)
  assert.equal(fic().downloaded, false)
  assert.equal(store.editPidLifecycle('FIC-102', { inputDst: 'FT-2' }), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.downloadControllerRegulatory('CTRL1'), true)
}))

test('mixed controller AO/PID Full rejects stale scope/data, live PID, permission and lock; never uploads live tuning', () => fixture(store => {
  mixedRegulatoryFixture(store)
  const initial = useStore.getState()
  const review = { 'LEVEL-AO': initial.moduleLifecycle['LEVEL-AO'].saved, 'FIC-102': initial.pidLifecycle['FIC-102'].saved }
  assert.equal(store.downloadControllerRegulatory('CTRL1', { 'LEVEL-AO': review['LEVEL-AO'] }), false)
  assert.equal(useStore.getState().modules, initial.modules)
  store.savePidConfiguration('FIC-102')
  const changed = useStore.getState()
  assert.equal(store.downloadControllerRegulatory('CTRL1', review), false)
  assert.equal(useStore.getState().pidLifecycle, changed.pidLifecycle)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(store.downloadControllerRegulatory('CTRL1'), false)
  useSecurity.setState({ currentUser: 'admin', locked: true })
  assert.equal(store.downloadControllerRegulatory('CTRL1'), false)
  useSecurity.setState({ locked: false })
  assert.equal(store.downloadControllerRegulatory('MISSING'), false)
  assert.equal(useStore.getState().modules, initial.modules)
  assert.equal(store.downloadControllerRegulatory('CTRL1'), true)
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  assert.equal(store.setTuning('FIC-102', { gain: .9 }), true)
  const online = useStore.getState()
  assert.equal(store.downloadControllerRegulatory('CTRL1'), false)
  assert.equal(useStore.getState().modules, online.modules)
  assert.equal(useStore.getState().moduleLifecycle, online.moduleLifecycle)
  assert.equal(store.setPidLifecycleOnline('FIC-102', false), true)
  const stored = window.localStorage.getItem(savedPidStorageKey('FIC-102'))
  assert.equal(store.downloadControllerRegulatory('CTRL1'), true)
  assert.equal(fic().gain, .5)
  assert.equal(window.localStorage.getItem(savedPidStorageKey('FIC-102')), stored)
  assert.equal(useStore.getState().pidLifecycle['FIC-102'].saved.module.gain, .5)
}))

test('unchanged PID Save stays matched and permits Online without a redundant deployment; runtime tuning is not configured data', () => fixture(store => {
  store.bindAnalogDst('FIC-102', 'input', 'FT-2')
  store.bindAnalogDst('FIC-102', 'output', 'FY-2')
  assert.equal(store.enablePidLifecycle('FIC-102'), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.downloadPidModule('FIC-102'), true)
  const deployed = useStore.getState().pidLifecycle['FIC-102'].deployed
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  const record = useStore.getState().pidLifecycle['FIC-102']
  assert.notEqual(record.savedRevision, record.deployedRevision)
  assert.equal(moduleDownloadStatus(useStore.getState(), 'FIC-102').status, 'MATCH')
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  assert.equal(useStore.getState().pidLifecycle['FIC-102'].deployed, deployed)
  assert.equal(store.setTuning('FIC-102', { gain: 0.7 }), true)
  assert.equal(fic().gain, 0.7)
  assert.equal(useStore.getState().pidLifecycle['FIC-102'].saved.module.gain, 0.5)
  assert.equal(moduleDownloadStatus(useStore.getState(), 'FIC-102').status, 'MATCH')
}))

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

test('p259-264 PID_LOOP tuning uploads selected values and preserves configured defaults when none are selected', () => fixture(store => {
  store.bindAnalogDst('FIC-102', 'input', 'FT-2')
  store.bindAnalogDst('FIC-102', 'output', 'FY-2')
  assert.equal(store.enablePidLifecycle('FIC-102'), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.downloadPidModule('FIC-102'), true)
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)

  store.setTuning('FIC-102', { gain: 0.7, reset: 2.5, rate: 0 })
  let state = useStore.getState()
  assert.deepEqual([fic().gain, fic().reset, fic().rate], [0.7, 2.5, 0])
  assert.deepEqual([state.pidLifecycle['FIC-102'].saved.module.gain,
    state.pidLifecycle['FIC-102'].saved.module.reset, state.pidLifecycle['FIC-102'].saved.module.rate],
  [0.5, 3, 0], 'online changes remain distinct from configured defaults')

  assert.equal(store.uploadPidParameters('FIC-102', ['gain', 'reset']), true)
  state = useStore.getState()
  assert.deepEqual([state.pidLifecycle['FIC-102'].saved.module.gain,
    state.pidLifecycle['FIC-102'].saved.module.reset, state.pidLifecycle['FIC-102'].saved.module.rate],
  [0.7, 2.5, 0], 'only selected tuning values upload')
  assert.deepEqual([fic().gain, fic().reset, fic().rate], [0.7, 2.5, 0],
    'upload does not alter the running controller')
  assert.equal(state.pidLifecycle['FIC-102'].savedRevision,
    state.pidLifecycle['FIC-102'].deployedRevision + 1)
  const persisted = JSON.parse(global.window.localStorage.getItem(savedPidStorageKey('FIC-102')))
  assert.deepEqual([persisted.configuration.module.gain, persisted.configuration.module.reset,
    persisted.configuration.module.rate], [0.7, 2.5, 0], 'uploaded configured defaults persist')
  assert.equal(store.uploadPidParameters('FIC-102', []), true)
  assert.equal(useStore.getState().pidLifecycle['FIC-102'].savedRevision, state.pidLifecycle['FIC-102'].savedRevision,
    'selecting none does not revise or copy configured parameters')

  assert.equal(store.setPidLifecycleOnline('FIC-102', false), true)
  assert.equal(store.downloadPidModule('FIC-102'), true, 'download uses the selected uploaded defaults')
  state = useStore.getState()
  assert.deepEqual([state.pidLifecycle['FIC-102'].deployed.module.gain,
    state.pidLifecycle['FIC-102'].deployed.module.reset], [0.7, 2.5])

  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  store.setTuning('FIC-102', { gain: 0.9, reset: 2.2, rate: 0.4 })
  assert.equal(store.setPidLifecycleOnline('FIC-102', false), true)
  state = useStore.getState()
  const beforeNone = state.pidLifecycle['FIC-102'].saved
  assert.equal(store.downloadPidModule('FIC-102', []), true, 'an empty selection still completes the requested download')
  state = useStore.getState()
  assert.deepEqual([state.pidLifecycle['FIC-102'].saved.module.gain,
    state.pidLifecycle['FIC-102'].saved.module.reset, state.pidLifecycle['FIC-102'].saved.module.rate],
  [beforeNone.module.gain, beforeNone.module.reset, beforeNone.module.rate],
  'none-selected download retains all configured defaults')
  assert.ok(state.eventLog.some(event => event.tag === 'FIC-102' &&
    event.description.includes('No online PID_LOOP values selected for upload')))

  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  store.setTuning('FIC-102', { gain: 1.1, reset: 2.1, rate: 0.6 })
  assert.equal(store.setPidLifecycleOnline('FIC-102', false), true)
  assert.equal(store.downloadPidModule('FIC-102', ['gain']), true)
  state = useStore.getState()
  assert.deepEqual([state.pidLifecycle['FIC-102'].saved.module.gain,
    state.pidLifecycle['FIC-102'].saved.module.reset, state.pidLifecycle['FIC-102'].saved.module.rate],
  [1.1, 2.5, 0], 'download prompt applies only selected values')
  assert.deepEqual([state.pidLifecycle['FIC-102'].deployed.module.gain,
    state.pidLifecycle['FIC-102'].deployed.module.reset, state.pidLifecycle['FIC-102'].deployed.module.rate],
  [1.1, 2.5, 0], 'successful transfer deploys the resulting saved configuration')
}))

test('p258 FIC-102 detail tuning and PV/SP/OUT trends work for created course modules', () => fixture(store => {
  assert.equal(useUi.getState().openModuleDisplay('FIC-102', 'detail'), true)
  assert.equal(useUi.getState().pidDetailTag, 'FIC-102')
  store.setTuning('FIC-102', { gain: 0.7, reset: 2.5, rate: 0.2 })
  assert.deepEqual([fic().gain, fic().reset, fic().rate], [0.7, 2.5, 0.2])
  const before = fic()
  for (const invalid of [{ gain: NaN }, { rate: Infinity }, { reset: -1 }]) {
    store.setTuning('FIC-102', invalid)
    assert.equal(fic(), before, 'invalid tuning is rejected atomically')
  }
  useSecurity.setState({ locked: true })
  store.setTuning('FIC-102', { gain: 2 })
  assert.equal(fic(), before, 'workstation lock blocks tuning')
  useSecurity.setState({ locked: false, currentUser: 'OperatorA' })
  store.setTuning('FIC-102', { reset: 4 })
  assert.equal(fic(), before, 'Tuning key is required')
  useSecurity.setState({ currentUser: 'admin' })
  const pens = moduleTrendPens(fic())
  assert.deepEqual(pens.map(pen => [pen.key, pen.min, pen.max, pen.unit]), [
    ['FIC-102.PV', 0, 100, 'GPM'], ['FIC-102.SP', 0, 100, 'GPM'], ['FIC-102.OUT', 0, 100, '%']
  ])
  assert.equal(availableTrendPens(useStore.getState().modules).length, 3)
  store.setRunning(true)
  store.tick(1)
  const last = useStore.getState().trend.at(-1)
  assert.deepEqual(pens.map(pen => last.values[pen.key]), [fic().pv, fic().sp, fic().out],
    'all three plotted values come from the same real simulator sample')
  useUi.getState().closePidDetail()
  useUi.getState().focusTrend('FIC-102')
  assert.equal(useUi.getState().display, 'trend')
  assert.equal(useUi.getState().trendFocusTag, 'FIC-102')
  assert.equal(useUi.getState().pidDetailTag, null)
  usePictures.getState().createPicture('CUSTOM_DETAIL')
  assert.equal(usePictures.getState().assignModuleDisplays('FIC-102', 'TANK101', 'CUSTOM_DETAIL'), true)
  assert.equal(useUi.getState().openModuleDisplay('FIC-102', 'detail'), true)
  assert.equal(useUi.getState().builderPicture, 'CUSTOM_DETAIL', 'explicit custom detail assignment retains precedence')
}))

test('p265 process Test measures filtered PV and applied output before reviewed online tuning Update', () => fixture(store => {
  assert.equal(store.bindAnalogDst('FIC-102', 'input', 'FT-2'), true)
  assert.equal(store.bindAnalogDst('FIC-102', 'output', 'FY-2'), true)
  assert.equal(store.configureInputFilter('CTRL1/C01', 2, 2.6), true)
  assert.equal(store.downloadInputFilters('CTRL1/C01'), true)
  assert.equal(store.enablePidLifecycle('FIC-102'), true)
  assert.equal(store.savePidConfiguration('FIC-102'), true)
  assert.equal(store.downloadPidModule('FIC-102'), true)
  assert.equal(store.setPidLifecycleOnline('FIC-102', true), true)
  assert.equal(store.setMode('FIC-102', 'MAN'), true)
  store.setRunning(true)
  store.tick(0.5)
  assert.equal(store.setOutput('FIC-102', 30), true)
  store.tick(0.5)
  assert.equal(store.configureTraditionalChannel('CTRL1/C01', 2,
    { dst: 'FT-2', enabled: true, tiebackDst: 'FY-2' }), true)
  store.tick(0.5)
  store.tick(0.5)
  const samples = [pidTuneSample(fic(), useStore.getState().time)]
  const signature = pidTuneSignature(fic())
  assert.equal('error' in samples[0], false)
  assert.equal(store.setOutput('FIC-102', 40), true)
  for (let index = 0; index < 25; index++) {
    store.tick(0.5)
    const sample = pidTuneSample(fic(), useStore.getState().time)
    assert.equal('error' in sample, false)
    samples.push(sample)
  }
  const reviewed = analyzePidTuneTest(samples)
  assert.equal('error' in reviewed, false)
  assert.ok(reviewed.duration >= 10)
  assert.equal(reviewed.outputChange, 10)
  assert.ok(reviewed.pvSpan > 0)
  assert.equal(pidTuneSignature(fic()), signature, 'process response does not alter the test configuration signature')
  assert.equal(store.setTuning('FIC-102', { gain: 0.7, reset: 2.5, rate: 0 }), true)
  assert.deepEqual([fic().gain, fic().reset, fic().rate], [0.7, 2.5, 0])
  assert.notEqual(pidTuneSignature(fic()), signature, 'tuning updates invalidate prior capture provenance')
  assert.deepEqual([useStore.getState().pidLifecycle['FIC-102'].saved.module.gain,
    useStore.getState().pidLifecycle['FIC-102'].saved.module.reset], [0.5, 3],
    'Update is online only, not an unrequested upload')
  const before = fic()
  const hardware = useStore.getState().hardware
  const tag = useStore.getState().pidLifecycle['FIC-102'].deployed.controllerTag
  useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
    [tag]: { ...hardware.controllers[tag], primary: 'FAILED', secondary: 'FAILED' } } } })
  assert.equal(store.setTuning('FIC-102', { gain: 1 }), false)
  assert.equal(fic(), before, 'controller loss blocks Update even while Online remains requested')
  assert.match(pidTuneSample({ ...fic(), pvBad: true }, 10).error, /good PV/)
  assert.match(pidTuneSample({ ...fic(), mode: 'AUTO' }, 10).error, /MAN/)
  assert.match(pidTuneSample({ ...fic(), io: { ...fic().io, ao: { ...fic().io.ao, mode: 'MAN' } } }, 10).error, /single AO/)
}))

test('process Test review rejects short, absent, non-finite and unresponsive captures', () => {
  const sample = time => ({ time, pv: 50, requestedOut: 30, appliedOut: 30 })
  assert.match(analyzePidTuneTest([]).error, /three/)
  assert.match(analyzePidTuneTest([sample(0), sample(1000), sample(9000)]).error, /10 simulated/)
  assert.match(analyzePidTuneTest([sample(0), sample(5000), sample(10_000)]).error, /output step/)
  assert.match(analyzePidTuneTest([sample(0), sample(5000), { ...sample(10_000), appliedOut: 40 }]).error, /PV response/)
  assert.match(analyzePidTuneTest([sample(0), sample(0), sample(10_000)]).error, /time-ordered/)
  assert.match(analyzePidTuneTest([sample(0), sample(5000), { ...sample(10_000), pv: NaN }]).error, /finite/)
  assert.equal('error' in analyzePidTuneTest([
    { ...sample(0), appliedOut: 100 }, { ...sample(5000), appliedOut: 99.9, pv: 51 },
    { ...sample(10_000), appliedOut: 99.9, pv: 52 }
  ]), false, 'an exact 0.1% downward step must not fail because of floating-point subtraction')
})

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
