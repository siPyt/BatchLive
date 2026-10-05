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
const ap = require('../src/renderer/src/engine/alarmPriorities.ts')
const fmt = require('../src/renderer/src/utils/format.ts')
const { highestRankedAlarmState } = require('../src/renderer/src/engine/pictureDynamics.ts')

const alarm = (over = {}) => ({ id: 'A.HI', moduleTag: 'A', moduleDesc: 'a', type: 'HI', label: 'HI', priority: 'WARNING', value: 1, unit: '',
  active: true, acknowledged: false, time: 1, ...over })

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), pri: ap.useAlarmPriorities.getState().priorities, window: global.window }
  const db = new Map()
  global.localStorage = { getItem: (k) => db.get(k) ?? null, setItem: (k, v) => db.set(k, String(v)) }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    ap.useAlarmPriorities.getState().reset()
    useStore.getState().newProject('pharma')
    useStore.setState({ running: true })
    run(db)
  } finally {
    ap.useAlarmPriorities.getState().reset()
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const trip = (tag, type) => {
  const m = useStore.getState().modules[tag]
  const alarms = m.alarms.map(a => a.type === type ? { ...a, enabled: true, limit: m.pvMin - 100 } : { ...a })
  useStore.setState({ modules: { ...useStore.getState().modules, [tag]: { ...m, alarms } } })
}
const clear = (tag, type) => {
  const m = useStore.getState().modules[tag]
  const alarms = m.alarms.map(a => a.type === type ? { ...a, limit: m.pvMax + 1000 } : { ...a })
  useStore.setState({ modules: { ...useStore.getState().modules, [tag]: { ...m, alarms } } })
}
const run = (n = 3) => { for (let i = 0; i < n; i++) useStore.getState().tick(0.1) }
const live = (tag) => useStore.getState().alarms.filter(a => a.moduleTag === tag)

test('DV09-038 the default table matches the course: 15/11/7, log-only 3, nothing auto-acknowledged except LOG', () => {
  const t = ap.defaultPriorities()
  assert.deepEqual([t.CRITICAL.value, t.WARNING.value, t.ADVISORY.value, t.LOG.value], [15, 11, 7, 3])
  assert.deepEqual(ap.priorityTableErrors(t), [])
  for (const cls of ['CRITICAL', 'WARNING', 'ADVISORY']) assert.deepEqual([t[cls].autoAckNew, t[cls].autoAckInactive, t[cls].bannerShows], [false, false, 'NOT_HIDDEN'])
  assert.deepEqual([t.LOG.autoAckNew, t.LOG.autoAckInactive], [true, true])
  assert.deepEqual(ap.PRIORITY_CLASSES, ['CRITICAL', 'WARNING', 'ADVISORY', 'LOG'])
})

test('DV09-038 explicit ranks run 3 (log only) to 15 and the class follows the rank', () => {
  for (const ok of [3, 4, 9, 15]) assert.equal(ap.isValidAlarmRank(ok), true)
  for (const bad of [2, 16, 4.5, NaN, '5', null, undefined, 0]) assert.equal(ap.isValidAlarmRank(bad), false, String(bad))
  assert.match(ap.ALARM_RANK_ERROR, /3 \(log only\) to 15/)
  assert.equal(ap.priorityClassOf({ priority: 'CRITICAL', rank: 3 }), 'LOG')
  assert.equal(ap.priorityClassOf({ priority: 'CRITICAL', rank: 4 }), 'CRITICAL')
  assert.equal(ap.priorityClassOf({ priority: 'ADVISORY' }), 'ADVISORY')
  assert.equal(ap.isLogOnly({ priority: 'WARNING', rank: 3 }), true)
})

test('DV09-038 table validation: values 4-15, ordered, LOG fixed, valid wave names and banner modes', () => {
  const base = () => ap.defaultPriorities()
  const err = (mutate) => { const t = base(); mutate(t); return ap.priorityTableErrors(t) }
  assert.deepEqual(err(t => { t.CRITICAL.value = 14; t.WARNING.value = 9; t.ADVISORY.value = 4 }), [])
  assert.match(err(t => { t.ADVISORY.value = 3 })[0], /ADVISORY value must be a whole number from 4 to 15/)
  assert.match(err(t => { t.CRITICAL.value = 16 })[0], /CRITICAL value/)
  assert.match(err(t => { t.WARNING.value = 7.5 })[0], /WARNING value/)
  assert.match(err(t => { t.LOG.value = 4 })[0], /fixed at 3/)
  assert.match(err(t => { t.WARNING.value = 15 })[0], /ordered: Critical > Warning > Advisory/)
  assert.match(err(t => { t.ADVISORY.value = 11 })[0], /ordered/)
  assert.match(err(t => { t.CRITICAL.bannerShows = 'ROW' })[0], /Alarm Banner Shows/)
  assert.match(err(t => { t.WARNING.waveFile = 'sound.mp3' })[0], /wave file/)
  assert.match(err(t => { t.WARNING.waveFile = '../x.wav' })[0], /wave file/)
  assert.deepEqual(err(t => { t.WARNING.waveFile = 'My Alarm-2.wav' }), [])
  assert.deepEqual(err(t => { t.WARNING.waveFile = ap.SILENT_WAVE }), [])
  assert.match(err(t => { t.CRITICAL.autoAckNew = 'yes' })[0], /on or off/)
})

test('DV09-038 changing a class value changes the rank of alarms without an explicit rank, never those with one', () => fixture(() => {
  const P = () => ap.useAlarmPriorities.getState()
  assert.equal(fmt.alarmRank(alarm()), 11)
  assert.equal(P().setPriority('WARNING', { value: 12 }), null)
  assert.equal(fmt.alarmRank(alarm()), 12)
  assert.equal(fmt.priorityRank('WARNING'), 12)
  assert.equal(fmt.alarmRank(alarm({ rank: 9 })), 9)
  assert.equal(fmt.compareAlarmRank(alarm({ id: 'x', time: 1 }), alarm({ id: 'y', priority: 'CRITICAL', time: 1 })) > 0, true)
  assert.match(P().setPriority('WARNING', { value: 15 }), /ordered/)
  assert.equal(fmt.alarmRank(alarm()), 12, 'a rejected change leaves the table as it was')
  assert.match(P().setPriority('LOG', { value: 5 }), /fixed at 3/)
  P().reset()
  assert.equal(fmt.alarmRank(alarm()), 11)
}))

test('DV09-038 the table persists across a reload and needs Can Configure', () => fixture((db) => {
  const P = () => ap.useAlarmPriorities.getState()
  assert.equal(P().setPriority('ADVISORY', { value: 6, autoAckNew: true, waveFile: 'Soft.wav' }), null)
  assert.ok(JSON.parse(db.get('batchlive.alarmPriorities.v1')).ADVISORY.autoAckNew)
  ap.useAlarmPriorities.setState({ priorities: ap.defaultPriorities() })
  P().reload()
  assert.deepEqual([P().priorities.ADVISORY.value, P().priorities.ADVISORY.waveFile], [6, 'Soft.wav'])
  assert.equal(fmt.priorityRank('ADVISORY'), 6)
  db.set('batchlive.alarmPriorities.v1', '{"CRITICAL":{"value":2}}')
  P().reload()
  assert.equal(P().priorities.CRITICAL.value, 15, 'an invalid stored table falls back to the defaults')
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CAN_CONFIGURE: 'SYSTEM_ADMIN' } })
  assert.equal(P().setPriority('WARNING', { value: 10 }), 'Requires the Can Configure key')
  assert.equal(P().priorities.WARNING.value, 11)
}))

test('DV09-038 Auto Acknowledge New Alarms acknowledges at detection and journals it; a class without it is untouched', () => fixture(() => {
  const P = () => ap.useAlarmPriorities.getState()
  trip('TIC-201', 'HI')
  const cls = ap.priorityClassOf(useStore.getState().modules['TIC-201'].alarms.find(a => a.type === 'HI'))
  const other = cls === 'WARNING' ? 'CRITICAL' : 'WARNING'
  assert.equal(P().setPriority(other, { autoAckNew: true }), null)
  run()
  let a = live('TIC-201').find(x => x.type === 'HI')
  assert.deepEqual([a.active, a.acknowledged], [true, false], 'the option on another class does not apply')
  assert.ok(!useStore.getState().eventLog.some(e => /automatically acknowledged when detected/.test(e.description)))
  clear('TIC-201', 'HI')
  run()
  useStore.getState().ackAll()
  run()
  assert.equal(P().setPriority(cls, { autoAckNew: true }), null)
  trip('TIC-201', 'HI')
  run()
  a = live('TIC-201').find(x => x.type === 'HI')
  assert.deepEqual([a.active, a.acknowledged], [true, true])
  assert.ok(useStore.getState().eventLog.some(e => e.category === 'ACK' && e.tag === 'TIC-201' && /automatically acknowledged when detected/.test(e.description)))
}))

test('DV09-038 Auto Acknowledge When Inactive removes the alarm at return to normal without an operator', () => fixture(() => {
  trip('TIC-201', 'HI')
  const m0 = useStore.getState().modules['TIC-201'].alarms.find(a => a.type === 'HI')
  const cls = m0.rank === 3 ? 'LOG' : m0.priority
  ap.useAlarmPriorities.getState().setPriority(cls, { autoAckInactive: true })
  run()
  const a = live('TIC-201').find(x => x.type === 'HI')
  assert.deepEqual([a.active, a.acknowledged], [true, false], 'new alarms still need acknowledgement')
  clear('TIC-201', 'HI')
  run()
  assert.equal(live('TIC-201').find(x => x.type === 'HI'), undefined)
  assert.ok(useStore.getState().eventLog.some(e => e.category === 'ACK' && /on return to normal/.test(e.description)))
  assert.ok(useStore.getState().eventLog.some(e => e.category === 'RTN' && e.tag === 'TIC-201'))
}))

test('DV09-038 without the option an unacknowledged alarm stays visible after return to normal', () => fixture(() => {
  trip('TIC-201', 'HI')
  run()
  clear('TIC-201', 'HI')
  run()
  const a = live('TIC-201').find(x => x.type === 'HI')
  assert.deepEqual([a.active, a.acknowledged], [false, false])
}))

test('DV09-038 log-only (rank 3): journaled as event records, never shown, auto-acknowledged and cleared at return to normal', () => fixture(() => {
  const s = useStore.getState()
  s.setAlarmLimit('TIC-201', 'HI', { rank: 3 })
  assert.equal(useStore.getState().modules['TIC-201'].alarms.find(a => a.type === 'HI').rank, 3)
  trip('TIC-201', 'HI')
  run()
  const a = live('TIC-201').find(x => x.type === 'HI')
  assert.deepEqual([a.active, a.acknowledged, ap.isLogOnly(a)], [true, true, true], 'acknowledged at once')
  assert.equal(fmt.alarmEligible(a, 'REACTOR', null, () => true), false, 'not eligible for banner, counts or horn')
  assert.equal(fmt.moduleAlarm('TIC-201', [a]), null)
  assert.equal(highestRankedAlarmState('TIC-201', [a]), 'NORMAL')
  const log = useStore.getState().eventLog
  assert.ok(log.some(e => e.category === 'ALARM' && e.tag === 'TIC-201' && /HI alarm/.test(e.description)), 'an event record is journaled')
  clear('TIC-201', 'HI')
  run()
  assert.equal(live('TIC-201').find(x => x.type === 'HI'), undefined)
  assert.ok(useStore.getState().eventLog.some(e => e.category === 'RTN' && e.tag === 'TIC-201'))
  assert.equal(ap.audibleWave([a]), null)
}))

test('DV09-038 Alarm Banner Shows collapses a module or unit to its highest-ranked alarm', () => {
  const r = (a) => fmt.alarmRank(a)
  const t = ap.defaultPriorities()
  const list = [alarm({ id: 'A.HI', moduleTag: 'A', rank: 9 }), alarm({ id: 'A.HH', moduleTag: 'A', rank: 12 }),
    alarm({ id: 'B.HI', moduleTag: 'B', rank: 8 }), alarm({ id: 'C.HI', moduleTag: 'C', rank: 6 })]
  const unitOf = (a) => ({ A: 'U1', B: 'U1', C: 'U2' })[a.moduleTag]
  assert.deepEqual(ap.collapseBanner(list, r, unitOf, t).map(a => a.id), list.map(a => a.id), 'Not Hidden keeps every alarm')
  t.WARNING.bannerShows = 'MODULE'
  assert.deepEqual(ap.collapseBanner(list, r, unitOf, t).map(a => a.id).sort(), ['A.HH', 'B.HI', 'C.HI'])
  t.WARNING.bannerShows = 'UNIT'
  assert.deepEqual(ap.collapseBanner(list, r, unitOf, t).map(a => a.id).sort(), ['A.HH', 'C.HI'])
  assert.deepEqual(ap.collapseBanner(list, r, () => undefined, t).map(a => a.id).sort(), ['A.HH', 'B.HI', 'C.HI'], 'no unit falls back to the module')
  t.WARNING.bannerShows = 'NOT_HIDDEN'
  t.CRITICAL.bannerShows = 'MODULE'
  const mixed = [alarm({ id: 'D.1', moduleTag: 'D', priority: 'CRITICAL' }), alarm({ id: 'D.2', moduleTag: 'D', priority: 'CRITICAL', rank: 14 }), alarm({ id: 'D.3', moduleTag: 'D' })]
  assert.deepEqual(ap.collapseBanner(mixed, r, unitOf, t).map(a => a.id).sort(), ['D.1', 'D.3'], 'each class collapses by its own setting')
})

test('DV09-038 audible alarms follow the highest unacknowledged class and its wave file', () => {
  const t = ap.defaultPriorities()
  const crit = alarm({ id: 'c', priority: 'CRITICAL' })
  const warn = alarm({ id: 'w' })
  const adv = alarm({ id: 'a', priority: 'ADVISORY' })
  assert.deepEqual(ap.audibleWave([warn, crit], t), { cls: 'CRITICAL', wave: 'Critical.wav' })
  assert.deepEqual(ap.audibleWave([warn, adv], t), { cls: 'WARNING', wave: 'Warning.wav' })
  assert.equal(ap.audibleWave([adv], t), null, 'advisory is silent by default')
  assert.equal(ap.audibleWave([{ ...crit, acknowledged: true }], t), null)
  assert.equal(ap.audibleWave([{ ...crit, active: false }], t), null)
  t.CRITICAL.waveFile = ap.SILENT_WAVE
  assert.equal(ap.audibleWave([crit, warn], t), null, 'a silenced class does not fall through to a lower one')
  t.ADVISORY.waveFile = 'Soft.wav'
  assert.deepEqual(ap.audibleWave([adv], t), { cls: 'ADVISORY', wave: 'Soft.wav' })
  assert.equal(ap.audibleWave([alarm({ rank: 3 })], t), null, 'log-only alarms never sound')
})

test('DV09-038 PRIAD can set the log-only level from the alarm field path', () => fixture(() => {
  const s = useStore.getState()
  assert.equal(s.writeAlarmField('TIC-201.ALM[HI].PRIAD', 3), true)
  assert.equal(useStore.getState().modules['TIC-201'].alarms.find(a => a.type === 'HI').rank, 3)
  assert.equal(s.writeAlarmField('TIC-201.ALM[HI].PRIAD', 2), false)
  assert.equal(s.writeAlarmField('TIC-201.ALM[HI].PRIAD', null), true)
}))
