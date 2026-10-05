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
const { reconcileAlarm } = require('../src/renderer/src/engine/simulate.ts')
const fmt = require('../src/renderer/src/utils/format.ts')
const { modulePath } = require('../src/renderer/src/engine/hierarchy.ts')

const limit = (over = {}) => ({ type: 'HI', label: 'HI', priority: 'WARNING', enabled: true, limit: 85, ...over })

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const db = new Map()
  global.localStorage = { getItem: (k) => db.get(k) ?? null, setItem: (k, v) => db.set(k, String(v)) }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    run(db)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

test('DV09-040 a tripped alarm captures its message and Time Last at activation', () => {
  const list = []
  reconcileAlarm(list, 'TIC-1', 'Reactor temperature', limit(), true, 90.2, 'degC', 1000)
  assert.equal(list[0].message, 'HI limit 85 degC')
  assert.equal(list[0].time, 1000)
  assert.equal(list[0].timeLast, 1000)
  const noLimit = []
  reconcileAlarm(noLimit, 'P-1', 'Pump', { type: 'FAIL', label: 'FAIL', priority: 'CRITICAL', enabled: true }, true, 1, '', 5)
  assert.equal(noLimit[0].message, 'FAIL', 'alarms without a limit use their label, nothing is invented')
  const unitless = []
  reconcileAlarm(unitless, 'X', 'x', limit({ limit: 4 }), true, 5, '', 1)
  assert.equal(unitless[0].message, 'HI limit 4')
})

test('DV09-040 Time Last follows the most recent state change while Time In stays the activation time', () => {
  const list = []
  reconcileAlarm(list, 'TIC-1', 'T', limit(), true, 90, 'degC', 1000)
  reconcileAlarm(list, 'TIC-1', 'T', limit(), true, 91, 'degC', 2000)
  assert.deepEqual([list[0].time, list[0].timeLast], [1000, 1000], 'staying active changes neither')
  reconcileAlarm(list, 'TIC-1', 'T', limit(), false, 80, 'degC', 3000)
  assert.deepEqual([list[0].active, list[0].time, list[0].timeLast], [false, 1000, 3000], 'return to normal stamps Time Last')
  reconcileAlarm(list, 'TIC-1', 'T', limit(), false, 79, 'degC', 4000)
  assert.equal(list[0].timeLast, 3000, 'staying normal does not move it')
  reconcileAlarm(list, 'TIC-1', 'T', limit(), true, 92, 'degC', 5000)
  assert.deepEqual([list[0].time, list[0].timeLast, list[0].acknowledged], [5000, 5000, false], 're-activation restarts both')
})

test('DV09-040 acknowledging stamps Time Last from the simulation clock', () => fixture(() => {
  const s = useStore.getState()
  const alarm = { id: 'A.HI', moduleTag: 'A', moduleDesc: 'a', type: 'HI', label: 'HI', priority: 'WARNING', value: 1, unit: '', active: true, acknowledged: false, time: 100, timeLast: 100 }
  const other = { ...alarm, id: 'B.HI', moduleTag: 'B' }
  useStore.setState({ alarms: [alarm, other], time: 7000 })
  s.ackAlarm('A.HI')
  const after = useStore.getState().alarms
  assert.deepEqual([after[0].acknowledged, after[0].timeLast, after[0].time], [true, 7000, 100])
  assert.equal(after[1].timeLast, 100)
  useStore.setState({ time: 9000 })
  s.ackAll()
  const all = useStore.getState().alarms
  assert.equal(all.find(a => a.id === 'A.HI').timeLast, 7000, 'already acknowledged alarms keep their stamp')
  assert.equal(all.find(a => a.id === 'B.HI').timeLast, 9000)
}))

test('DV09-040 the new columns are typed, optional, selectable and render truthful text', () => {
  const keys = fmt.ALARM_COLUMNS.map(c => c.key)
  for (const key of ['message', 'timeLast', 'unit']) {
    const column = fmt.ALARM_COLUMNS.find(c => c.key === key)
    assert.ok(column, key)
    assert.equal(column.defaultVisible, false)
    assert.ok(!fmt.DEFAULT_ALARM_COLUMNS.includes(key))
  }
  assert.equal(new Set(keys).size, keys.length)
  const base = { id: 'X.HI', moduleTag: 'X', moduleDesc: 'x', type: 'HI', label: 'HI', priority: 'WARNING', value: 1, unit: 'degC', active: true, acknowledged: false, time: 1_000_000 }
  assert.equal(fmt.alarmColumnText('message', { ...base, message: 'HI limit 85 degC' }, undefined), 'HI limit 85 degC')
  assert.equal(fmt.alarmColumnText('message', base, undefined), 'HI', 'older alarms fall back to the label')
  assert.equal(fmt.alarmColumnText('timeLast', { ...base, timeLast: 2_000_000 }, undefined), fmt.clockString(2_000_000))
  assert.equal(fmt.alarmColumnText('timeLast', base, undefined), fmt.clockString(1_000_000), 'no stamp: shows Time In, not a made-up time')
  assert.equal(fmt.alarmColumnText('unit', base, undefined), '—')
  assert.equal(fmt.alarmColumnText('unit', base, undefined, undefined, 'FEED_UNIT'), 'FEED_UNIT')
})

test('DV09-040 the Unit column comes from the equipment hierarchy of the alarming module', () => fixture(() => {
  const state = useStore.getState()
  const h = { areas: state.areas, processCells: state.processCells, units: state.units, equipment: state.equipment }
  const unit = (tag) => modulePath(state.modules[tag], h).unit
  assert.equal(unit('FIC-101'), 'FEED_UNIT')
  assert.equal(unit('LIC-201'), 'REACTOR_UNIT')
  const base = { id: 'FIC-101.HI', moduleTag: 'FIC-101', moduleDesc: 'x', type: 'HI', label: 'HI', priority: 'WARNING', value: 1, unit: '', active: true, acknowledged: false, time: 1 }
  assert.equal(fmt.alarmColumnText('unit', base, state.modules['FIC-101'], 'FEED', unit('FIC-101')), 'FEED_UNIT')
  useStore.getState().assignEquipmentUnit('EM-FEED-SUPPLY', null)
  const moved = useStore.getState()
  assert.equal(modulePath(moved.modules['FIC-101'], { areas: moved.areas, processCells: moved.processCells, units: moved.units, equipment: moved.equipment }).unit, undefined)
}))

test('DV09-040 persisted column sets accept the new keys and still drop unknown ones', () => fixture(() => {
  fmt.saveAlarmColumns(['timeIn', 'message', 'unit', 'timeLast', 'bogus'])
  assert.deepEqual(fmt.loadAlarmColumns(), ['timeIn', 'message', 'unit', 'timeLast'])
}))

test('DV09-040 live alarms from the plant carry a message and Time Last', () => fixture(() => {
  useStore.setState({ running: true })
  const alarmed = useStore.getState().modules['TIC-201']
  const alarms = alarmed.alarms.map(a => a.type === 'HI' ? { ...a, enabled: true, limit: alarmed.pvMin - 100 } : { ...a })
  assert.ok(alarms.some(a => a.type === 'HI'))
  const modules = { ...useStore.getState().modules, 'TIC-201': { ...alarmed, alarms } }
  useStore.setState({ modules })
  for (let i = 0; i < 5; i++) useStore.getState().tick(0.1)
  const live = useStore.getState().alarms.filter(a => a.moduleTag === 'TIC-201')
  assert.ok(live.length >= 1)
  assert.ok(live.every(a => typeof a.message === 'string' && a.message.length > 0 && typeof a.timeLast === 'number'))
}))
