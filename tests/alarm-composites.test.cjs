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
const { ALARM_FIELDS, ALARM_FIELD_LOCK, ALARM_STATE_CODE, alarmFieldWriteError, parseAlarmFieldPath } = require('../src/renderer/src/engine/alarmFields.ts')

const TAG = 'LI-901'
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: (m) => alerts.push(m) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    const s = useStore.getState()
    s.newProject('blank')
    assert.equal(s.createArea('LVL'), true)
    assert.equal(s.createModule({ tag: TAG, type: 'AI', area: 'LVL', description: 'Composite fixture', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
    run(s, alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const read = (field, type = 'HI') => useStore.getState().readAlarmFieldValue(`${TAG}.ALM[${type}].${field}`)
const value = (field, type) => { const r = read(field, type); assert.ok('value' in r, JSON.stringify(r)); return r.value }
const write = (field, v, type = 'HI') => useStore.getState().writeAlarmField(`${TAG}.ALM[${type}].${field}`, v)
/** Put the HI alarm into a real active, unacknowledged state in the alarm list. */
function trip(s) {
  assert.equal(s.writeAlarmField(`${TAG}.ALM[HI].ENAB`, true), true)
  useStore.setState((st) => ({
    alarms: [...st.alarms.filter((a) => a.id !== `${TAG}.HI`), {
      id: `${TAG}.HI`, moduleTag: TAG, moduleDesc: 'Composite fixture', type: 'HI', label: 'HI', priority: 'WARNING',
      value: 900, unit: 'gal', active: true, acknowledged: false, time: st.time
    }]
  }))
}
const setAlarm = (patch) => useStore.setState((st) => ({ alarms: st.alarms.map((a) => (a.id === `${TAG}.HI` ? { ...a, ...patch } : a)) }))

test('DV09-042 every composite field is a supported alarm path with the right lock and read/write kind', () => {
  assert.deepEqual(ALARM_FIELDS, ['ENAB', 'PRI', 'PRIAD', 'MACK', 'CUALM', 'LAALM', 'CV', 'NALM', 'INV', 'OPSUP', 'SUPTMO', 'SUPTMR'])
  assert.deepEqual(ALARM_STATE_CODE, { NORMAL: 0, ACTIVE_UNACK: 1, ACTIVE_ACK: 2, RTN_UNACK: 3 })
  assert.equal(ALARM_FIELD_LOCK.OPSUP, 'ALARMS')
  assert.equal(ALARM_FIELD_LOCK.SUPTMO, 'SYSTEM_RECORDS')
  for (const f of ['CUALM', 'LAALM', 'CV', 'NALM', 'INV', 'SUPTMR']) {
    assert.equal(ALARM_FIELD_LOCK[f], null, `${f} is read-only`)
    assert.match(alarmFieldWriteError({ [TAG]: { alarms: [{ type: 'HI' }] } }, `${TAG}.ALM[HI].${f}`, 1), /read-only computed field/)
  }
  assert.deepEqual(parseAlarmFieldPath(`${TAG}.ALM[HI].SUPTMR`), { tag: TAG, type: 'HI', field: 'SUPTMR' })
})

test('DV09-042 CUALM and LAALM follow the numeric state codes through trip, acknowledge and return to normal', () => fixture((s) => {
  assert.equal(value('CUALM'), 0)
  assert.equal(value('LAALM'), 0)
  assert.equal(value('NALM'), 0)
  trip(s)
  assert.equal(value('CUALM'), 1, 'active unacknowledged')
  assert.equal(value('LAALM'), 1)
  assert.equal(value('NALM'), 1)
  assert.equal(write('MACK', true), true)
  assert.equal(value('CUALM'), 2, 'active acknowledged')
  assert.equal(value('LAALM'), 2)
  setAlarm({ active: false })
  assert.equal(value('CUALM'), 0, 'the current alarm is gone')
  assert.equal(value('NALM'), 0)
  assert.equal(value('LAALM'), 3, 'an acknowledged-then-normal alarm is cleared by the engine; an unacknowledged one stays latched')
  setAlarm({ acknowledged: true })
  useStore.setState((st) => ({ alarms: st.alarms.filter((a) => a.id !== `${TAG}.HI`) }))
  assert.equal(value('LAALM'), 0, 'an acknowledged return to normal is cleared')
}))

test('DV09-042 CV, INV and ENAB: the monitored value, invalid when disabled or the PV is bad', () => fixture((s) => {
  useStore.setState((st) => ({ modules: { ...st.modules, [TAG]: { ...st.modules[TAG], pv: 123 } } }))
  assert.equal(write('ENAB', true), true)
  assert.equal(value('CV'), 123)
  assert.equal(value('INV'), false)
  assert.equal(write('ENAB', false), true)
  assert.equal(value('INV'), true, 'a disabled alarm is not valid')
  assert.equal(write('ENAB', true), true)
  assert.equal(value('INV'), false)
  useStore.setState((st) => ({ modules: { ...st.modules, [TAG]: { ...st.modules[TAG], pvBad: true } } }))
  assert.equal(value('INV'), true, 'a bad PV makes the alarm invalid')
  assert.match(read('CV', 'NOPE').error, /not a configured alarm/)
}))

test('DV09-042 operator suppression: OPSUP, SUPTMO and SUPTMR with a real timer; distinct from acknowledge, disable and shelve list', () => fixture((s) => {
  assert.equal(value('OPSUP'), false)
  assert.equal(value('SUPTMO'), 60, 'the default suppression time-out is 60 minutes')
  assert.equal(value('SUPTMR'), 0)
  assert.equal(write('OPSUP', true), false, 'there is nothing to suppress while the alarm is normal')
  trip(s)
  assert.equal(write('SUPTMO', 0), false)
  assert.equal(write('SUPTMO', 0.5), false)
  assert.equal(write('SUPTMO', 5000), false)
  assert.equal(write('SUPTMO', 30), true)
  assert.equal(value('SUPTMO'), 30)
  assert.equal(write('OPSUP', true), true)
  assert.equal(value('OPSUP'), true)
  assert.equal(value('SUPTMR'), 30, 'the timer starts at the time-out')
  assert.equal(value('CUALM'), 1, 'suppression does not acknowledge or clear the alarm')
  assert.equal(useStore.getState().alarms.find((a) => a.id === `${TAG}.HI`).acknowledged, false)
  assert.equal(value('INV'), false, 'suppression is not disabling')
  useStore.setState({ time: useStore.getState().time + 10 * 60000 })
  assert.equal(value('SUPTMR'), 20, 'the timer counts down with simulated time')
  useStore.setState({ time: useStore.getState().time + 25 * 60000 })
  assert.equal(value('SUPTMR'), 0, 'an expired suppression has no time left')
  assert.equal(write('OPSUP', false), true)
  assert.equal(value('OPSUP'), false)
  assert.equal(write('OPSUP', 'yes'), false)
}))

test('DV09-042 suppression and time-out writes need their locks and every write is journaled', () => fixture((s) => {
  trip(s)
  useSecurity.setState({ currentUser: 'Supervisor1' })
  assert.equal(write('OPSUP', true), true, 'Supervisor1 holds the Alarms key')
  assert.equal(write('SUPTMO', 15), false, 'SUPTMO is a system record and needs that key')
  assert.match(useSecurity.getState().lastDenied, /System Records/)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(write('OPSUP', false), true, 'operators hold the Alarms key')
  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(write('SUPTMO', 15), true)
  const log = useStore.getState().eventLog.map((e) => e.description)
  assert.ok(log.some((d) => /OPSUP := true/.test(d)))
  assert.ok(log.some((d) => /SUPTMO = 15/.test(d)))
  assert.ok(log.some((d) => /shelved for 60 min/.test(d)) || log.some((d) => /shelved/.test(d)))
}))

test('DV09-042 a new project clears the configured suppression times', () => fixture((s) => {
  trip(s)
  assert.equal(write('SUPTMO', 10), true)
  s.newProject('blank')
  assert.deepEqual(useStore.getState().alarmSuppressMinutes, {})
}))
