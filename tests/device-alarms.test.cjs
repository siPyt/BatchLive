const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, filename)
}
require.extensions['.tsx'] = require.extensions['.ts']
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { useSystem } = require('../src/renderer/src/engine/systemPreferences.ts')
const { useUi } = require('../src/renderer/src/ui/uiStore.ts')
const act = require('../src/renderer/src/engine/fieldbusActions.ts')
const da = require('../src/renderer/src/engine/deviceAlarms.ts')
const { alarmCategory, alarmEligible } = require('../src/renderer/src/utils/format.ts')

const CARD = 'CTRL1/C05'
function fixture(run) {
  const previous = useSystem.getState()
  useSystem.setState({ features: { fieldbus: true, signaturePolicies: true } })
  try {
    fixtureBase(run)
  } finally {
    useSystem.setState(previous, true)
  }
}
function fixtureBase(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), ui: useUi.getState(), window: global.window }
  global.window = { alerts: [], alert(m) { this.alerts.push(m) }, localStorage: { getItem: () => null, setItem: () => {} } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    const s = useStore.getState()
    s.newProject('blank')
    assert.equal(s.createArea('PLANT_AREA_A'), true)
    assert.equal(s.createArea('PLANT_AREA_B'), true)
    assert.equal(s.createController('CTRL1', 'alarm fixture'), true)
    assert.equal(s.commissionController('CTRL1'), true)
    assert.equal(act.addH1Card('CTRL1', 5, false), null)
    assert.equal(act.configureH1Port(CARD, 'P01', { enabled: true }), null)
    assert.equal(act.downloadH1Card(CARD), null)
    run(s)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    useUi.setState(before.ui, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const card = () => useStore.getState().hardware.h1Cards[CARD]
const dev = (tag = 'PT-1') => card().ports.P01.devices[tag]
const alarms = () => useStore.getState().alarms
const alarm = (tag, kind) => alarms().find((a) => a.id === da.deviceAlarmId(tag, kind))
const ok = (value, message) => assert.equal(value, null, message ?? String(value))
const run = (s, seconds) => { useStore.setState({ running: true }); for (let i = 0; i < Math.round(seconds / 0.1); i++) s.tick(0.1) }
function commission(tag = 'PT-1', address = 20, catalogId = 'VI-PT100', revision = 2) {
  ok(act.addFfDevice(CARD, 'P01', tag, address, catalogId, revision, revision))
  const r = act.attachFieldDevice(CARD, { port: 'P01', catalogId, address, revision, ddRevision: revision })
  ok(act.commissionFfDevice(CARD, tag, r.id, 'commissioning'))
  return r.id
}

test('DV09-121/122 defaults: Not Communicating, Failed, Maintenance and Advisory on; Abnormal off; numeric priorities', () => fixture((s) => {
  commission()
  const s0 = dev().alarms.settings
  assert.deepEqual(Object.entries(s0).map(([k, v]) => [k, v.enabled]), [['NOT_COMM', true], ['ABNORMAL', false], ['FAILED', true], ['MAINTENANCE', true], ['ADVISORY', true]])
  assert.deepEqual(da.DEVICE_ALARM_LABEL, { NOT_COMM: 'NOT COMMUNICATING', ABNORMAL: 'ABNORMAL', FAILED: 'FAILED', MAINTENANCE: 'MAINTENANCE', ADVISORY: 'ADVISORY' })
  assert.deepEqual([4, 7, 8, 11, 12, 15].map(da.rankPriority), ['ADVISORY', 'ADVISORY', 'WARNING', 'WARNING', 'CRITICAL', 'CRITICAL'])
  assert.match(act.configureDeviceAlarm(CARD, 'PT-1', 'FAILED', { rank: 3 }), /4 to 15/)
  assert.match(act.configureDeviceAlarm(CARD, 'PT-1', 'FAILED', { rank: 7.5 }), /4 to 15/)
  assert.match(act.configureDeviceAlarm(CARD, 'PT-1', 'FAILED', { rank: 16 }), /4 to 15/)
  assert.match(act.configureDeviceAlarm(CARD, 'PT-1', 'BOGUS', { rank: 9 }), /Unknown device alarm/)
  assert.match(act.configureDeviceAlarm(CARD, 'NOPE', 'FAILED', { rank: 9 }), /does not exist/)
}))

test('DV09-123 Enable Device Alarms is a prerequisite: nothing trips while it is off', () => fixture((s) => {
  const id = commission()
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { faults: { failed: true, maintenance: true } }))
  run(s, 2)
  assert.equal(alarms().filter(da.isDeviceAlarm).length, 0)
  assert.equal(da.deviceAlarmCondition(card(), dev(), 'P01', 'FAILED', useStore.getState().hardware).blockedBy, 'Enable Device Alarms on the H1 card')
  ok(act.enableDeviceAlarms(CARD, true))
  run(s, 1)
  assert.equal(alarm('PT-1', 'FAILED').active, true)
  assert.equal(alarm('PT-1', 'MAINTENANCE').active, true)
  ok(act.enableDeviceAlarms(CARD, false))
  run(s, 1)
  assert.equal(alarm('PT-1', 'FAILED').active, false, 'turning the prerequisite off returns the alarm to normal')
}))

test('DV09-121 Not Communicating: only after the device was seen live; return to normal on recovery', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  const id = commission()
  run(s, 3)
  assert.equal(alarm('PT-1', 'NOT_COMM')?.active ?? false, false)
  ok(act.setFieldDevice(CARD, id, { communicating: false }))
  run(s, 1)
  const a = alarm('PT-1', 'NOT_COMM')
  assert.equal(a.active, true)
  assert.equal(a.type, 'CUSTOM')
  assert.equal(a.customType, 'DEVICE:NOT_COMM')
  assert.equal(a.priority, 'WARNING')
  assert.equal(alarmCategory(a), 'DEVICE', 'a device alarm is not a process alarm')
  assert.equal(da.isDeviceAlarm(a), true)
  ok(act.setFieldDevice(CARD, id, { communicating: true }))
  run(s, 35)
  assert.equal(alarm('PT-1', 'NOT_COMM').active, false, 'the LAS probes the address again and the device rejoins the live list')
  const log = useStore.getState().eventLog.filter((e) => e.tag === 'PT-1')
  assert.ok(log.some((e) => e.category === 'ALARM' && /NOT COMMUNICATING/.test(e.description)), 'the activation is journaled')
  assert.ok(log.some((e) => e.category === 'RTN'), 'the return to normal is journaled')
  useStore.getState().ackAlarm(a.id)
  assert.equal(alarm('PT-1', 'NOT_COMM'), undefined, 'acknowledged and normal clears the alarm')
}))

test('DV09-121 Abnormal is disabled by default; enabling, priority and the reporting prerequisite', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  const id = commission()
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { faults: { abnormal: true } }))
  run(s, 1)
  assert.equal(alarm('PT-1', 'ABNORMAL'), undefined, 'disabled by default')
  ok(act.configureDeviceAlarm(CARD, 'PT-1', 'ABNORMAL', { enabled: true, rank: 13 }))
  run(s, 1)
  assert.equal(alarm('PT-1', 'ABNORMAL').active, true)
  assert.equal(alarm('PT-1', 'ABNORMAL').priority, 'CRITICAL')
  assert.equal(alarm('PT-1', 'ABNORMAL').rank, 13)
  ok(act.configureDeviceAlarm(CARD, 'PT-1', 'ABNORMAL', { rank: 5 }))
  run(s, 1)
  assert.equal(alarm('PT-1', 'ABNORMAL').rank, 5)
  assert.equal(alarm('PT-1', 'ABNORMAL').priority, 'ADVISORY')
  ok(act.configureDeviceAlarm(CARD, 'PT-1', 'ABNORMAL', { enabled: false }))
  run(s, 1)
  assert.equal(alarm('PT-1', 'ABNORMAL'), undefined, 'disabling removes the alarm')
  ok(act.configureDeviceAlarm(CARD, 'PT-1', 'FAILED', {}))
  ok(act.setFieldDevice(CARD, id, { faults: { failed: true } }))
  ok(act.setFfMode(CARD, 'PT-1', 'RESOURCE', 'AUTO', 'x'))
  const withoutReports = JSON.parse(JSON.stringify(card()))
  withoutReports.ports.P01.devices['PT-1'].resource.features.reports = false
  useStore.setState((st) => ({ hardware: { ...st.hardware, h1Cards: { ...st.hardware.h1Cards, [CARD]: withoutReports } } }))
  run(s, 1)
  assert.equal(alarm('PT-1', 'FAILED')?.active ?? false, false, 'alert reporting disabled in the resource block blocks device-generated alerts')
  assert.match(da.deviceAlarmCondition(card(), dev(), 'P01', 'FAILED', useStore.getState().hardware).blockedBy, /reporting is disabled/)
}))

test('DV09-122 each PlantWeb alert is an independent cause with its own priority; process alarms are untouched', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  assert.equal(s.createModule({ tag: 'LI-1', type: 'AI', area: 'PLANT_AREA_A', description: 'level', unit: '%', pvMin: 0, pvMax: 100 }), true)
  const id = commission()
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { faults: { advisory: true } }))
  run(s, 1)
  assert.deepEqual(alarms().filter(da.isDeviceAlarm).map((a) => a.id), ['DEVALM.PT-1.ADVISORY'])
  assert.equal(alarm('PT-1', 'ADVISORY').rank, 7)
  ok(act.setFieldDevice(CARD, id, { faults: { failed: true, maintenance: true } }))
  run(s, 1)
  assert.deepEqual(alarms().filter(da.isDeviceAlarm).map((a) => a.id.split('.').pop()).sort(), ['ADVISORY', 'FAILED', 'MAINTENANCE'])
  assert.equal(alarm('PT-1', 'FAILED').priority, 'CRITICAL')
  assert.equal(alarm('PT-1', 'MAINTENANCE').priority, 'WARNING')
  assert.equal(alarms().filter((a) => !da.isDeviceAlarm(a)).every((a) => alarmCategory(a) !== 'DEVICE'), true)
  ok(act.setFieldDevice(CARD, id, { faults: { failed: false } }))
  run(s, 1)
  assert.equal(alarm('PT-1', 'FAILED').active, false)
  assert.equal(alarm('PT-1', 'MAINTENANCE').active, true, 'clearing one cause does not clear another')
}))

test('DV09-123 area association: inherited from the controller or taken from a chosen module; eligibility follows it', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  assert.equal(s.createModule({ tag: 'LI-B', type: 'AI', area: 'PLANT_AREA_B', description: 'b', unit: '%', pvMin: 0, pvMax: 100 }), true)
  const id = commission()
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { faults: { failed: true } }))
  run(s, 1)
  const a = () => alarm('PT-1', 'FAILED')
  const area = () => da.alarmArea(a(), useStore.getState().modules, useStore.getState().hardware)
  assert.equal(area(), undefined, 'no controller area assigned yet')
  assert.equal(alarmEligible(a(), area(), ['PLANT_AREA_A'], () => true), false, 'an unresolved area fails closed under a subscription')
  assert.equal(alarmEligible(a(), area(), null, () => true), true, 'unsubscribed workstations see everything')
  assert.match(act.setControllerArea('CTRL1', 'NOPE'), /does not exist/)
  ok(act.setControllerArea('CTRL1', 'PLANT_AREA_A'))
  assert.equal(area(), 'PLANT_AREA_A', 'inherited from the controller')
  assert.equal(alarmEligible(a(), area(), ['PLANT_AREA_A'], () => true), true)
  assert.equal(alarmEligible(a(), area(), ['PLANT_AREA_B'], () => true), false)
  assert.match(act.setDeviceAlarmArea(CARD, 'PT-1', 'MODULE', 'GONE'), /existing module/)
  ok(act.setDeviceAlarmArea(CARD, 'PT-1', 'MODULE', 'LI-B'))
  assert.equal(area(), 'PLANT_AREA_B', 'taken from the selected module')
  assert.equal(alarmEligible(a(), area(), ['PLANT_AREA_B'], (x) => x === 'PLANT_AREA_B'), true)
  assert.equal(alarmEligible(a(), area(), ['PLANT_AREA_B'], (x) => x === 'PLANT_AREA_A'), false, 'the user area key must match too')
  ok(act.setDeviceAlarmArea(CARD, 'PT-1', 'CONTROLLER'))
  assert.equal(area(), 'PLANT_AREA_A')
  ok(act.setControllerArea('CTRL1', null))
  assert.equal(area(), undefined)
}))

test('DV09-123 repeat annunciation: only supported devices; an unacknowledged alarm re-sounds the horn', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  const pt = commission('PT-1', 20)
  const fv = commission('FV-1', 21, 'VI-FV300', 2)
  assert.match(act.setDeviceReannunciation(CARD, 'PT-1', true, 10), /does not support repeat annunciation/)
  assert.match(act.setDeviceReannunciation(CARD, 'FV-1', true, 2), /5 to 3600/)
  ok(act.setDeviceReannunciation(CARD, 'FV-1', true, 10))
  run(s, 3)
  ok(act.setFieldDevice(CARD, fv, { faults: { failed: true } }))
  run(s, 1)
  assert.equal(alarm('FV-1', 'FAILED').repeats ?? 0, 0)
  useStore.setState({ hornSilenced: true })
  const state = useStore.getState()
  for (let i = 0; i < 11 * 10; i++) { state.tick(0.1); useStore.setState({ time: useStore.getState().time }) }
  assert.ok(alarm('FV-1', 'FAILED').repeats >= 1, `repeated ${alarm('FV-1', 'FAILED').repeats}`)
  ok(act.setFieldDevice(CARD, pt, { faults: { failed: true } }))
  run(s, 14)
  assert.equal(alarm('PT-1', 'FAILED').repeats ?? 0, 0, 'a device without the capability never repeats')
  useStore.getState().ackAlarm('DEVALM.FV-1.FAILED')
  const repeats = alarm('FV-1', 'FAILED').repeats
  run(s, 12)
  assert.equal(alarm('FV-1', 'FAILED').repeats, repeats, 'an acknowledged alarm stops repeating')
}))

test('DV09-123 primary display must be an existing picture', () => fixture((s) => {
  commission()
  assert.match(act.setDevicePrimaryDisplay(CARD, 'PT-1', 'NOPE'), /does not exist/)
  ok(act.setDevicePrimaryDisplay(CARD, 'PT-1', 'tank101'))
  assert.equal(dev().alarms.primaryDisplay, 'TANK101')
  ok(act.setDevicePrimaryDisplay(CARD, 'PT-1', ''))
  assert.equal(dev().alarms.primaryDisplay, '')
}))

test('DV09-125 banner thresholds are strict and separate: process > 3, device > 7; the alarm list is independent', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  const id = commission()
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { faults: { advisory: true, maintenance: true } }))
  run(s, 1)
  const t = da.DEFAULT_BANNER_THRESHOLDS
  assert.deepEqual(t, { process: 3, device: 7 })
  const advisory = alarm('PT-1', 'ADVISORY')
  const maintenance = alarm('PT-1', 'MAINTENANCE')
  assert.equal(advisory.rank, 7)
  assert.equal(da.bannerVisible(advisory, t), false, 'priority 7 is not above the device threshold 7')
  assert.equal(da.bannerVisible(maintenance, t), true, 'priority 11 is above 7')
  assert.equal(da.bannerVisible(advisory, { process: 3, device: 6 }), true, 'lowering the device threshold to 6 admits advisory 7')
  assert.equal(da.bannerVisible(advisory, { process: 20, device: 6 }), true, 'the process threshold does not affect device alarms')
  const process = { id: 'LI.HI', moduleTag: 'LI', priority: 'ADVISORY', rank: 4, active: true, acknowledged: false, time: 1 }
  assert.equal(da.bannerVisible(process, t), true, 'process priority 4 is above 3')
  assert.equal(da.bannerVisible({ ...process, rank: 3 }, t), false)
  assert.equal(da.bannerVisible(process, { process: 4, device: 7 }), false)
  assert.equal(da.bannerVisible({ ...process, rank: undefined }, { process: 6, device: 0 }), true, 'a class default (advisory 7) is used when no explicit rank')
  assert.equal(alarms().filter(da.isDeviceAlarm).length >= 2, true, 'the alarm list is not filtered by the banner thresholds')
}))

test('DV09-125/126 banner settings: validation, save, initialization on startup and defaults on bad data', () => {
  const store = new Map()
  global.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const uiPath = require.resolve('../src/renderer/src/ui/uiStore.ts')
  const dPath = require.resolve('../src/renderer/src/engine/deviceAlarms.ts')
  try {
    assert.deepEqual(da.loadBannerThresholds(), { process: 3, device: 7 })
    for (const bad of [{ process: -1, device: 7 }, { process: 3, device: 16 }, { process: 3.5, device: 7 }, { process: NaN, device: 7 }]) {
      assert.match(da.bannerThresholdError(bad), /whole number from 0 to 15/)
      assert.match(useUi.getState().setBannerThresholds(bad), /whole number from 0 to 15/)
    }
    assert.equal(useUi.getState().setBannerThresholds({ process: 3, device: 6 }), null)
    assert.deepEqual(useUi.getState().bannerThresholds, { process: 3, device: 6 })
    assert.deepEqual(JSON.parse(store.get(da.BANNER_THRESHOLDS_KEY)), { process: 3, device: 6 })
    delete require.cache[uiPath]
    delete require.cache[dPath]
    const reloaded = require(uiPath).useUi
    assert.deepEqual(reloaded.getState().bannerThresholds, { process: 3, device: 6 }, 'saved settings run when the application starts')
    store.set(da.BANNER_THRESHOLDS_KEY, '{not json')
    assert.deepEqual(require(dPath).loadBannerThresholds(), { process: 3, device: 7 })
    store.set(da.BANNER_THRESHOLDS_KEY, JSON.stringify({ process: 99, device: 7 }))
    assert.deepEqual(require(dPath).loadBannerThresholds(), { process: 3, device: 7 })
    assert.equal(useUi.getState().setBannerThresholds({ process: 3, device: 7 }), null)
  } finally {
    delete global.localStorage
  }
})

test('DV09-123 the FFDEV_FP faceplate renders the device, its alarm states, settings and simulated conditions', () => fixture((s) => {
  ok(act.enableDeviceAlarms(CARD, true))
  const id = commission()
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { faults: { failed: true } }))
  run(s, 1)
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const storeModule = require('../src/renderer/src/engine/store.ts')
  const uiModule = require('../src/renderer/src/ui/uiStore.ts')
  const secModule = require('../src/renderer/src/engine/security.ts')
  test.mock.method(storeModule, 'useStore', (selector) => selector(useStore.getState()))
  test.mock.method(uiModule, 'useUi', (selector) => selector(useUi.getState()))
  test.mock.method(secModule, 'useSecurity', (selector) => selector(useSecurity.getState()))
  const { FfDeviceFaceplate } = require('../src/renderer/src/faceplates/FfDeviceFaceplate.tsx')
  const html = renderToStaticMarkup(React.createElement(FfDeviceFaceplate, { tag: 'PT-1', x: 10, y: 10 })).replace(/&gt;/g, '>').replace(/<!-- -->/g, '')
  assert.match(html, /FFDEV_FP/)
  assert.match(html, /PT-100 pressure transmitter/)
  assert.match(html, /Device alarms enabled/)
  assert.match(html, /data-device-alarm-row="FAILED"/)
  assert.match(html, /Active/)
  assert.match(html, /Enable Device Alarms/)
  assert.match(html, /Simulated device condition/)
  assert.match(html, /not supported by this device/)
  test.mock.restoreAll()
}))
