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
const {
  alarmFieldPath, parseAlarmFieldPath, readAlarmField, alarmFieldWriteError, ALARM_FIELD_LOCK
} = require('../src/renderer/src/engine/alarmFields.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: (message) => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    s.newProject('blank')
    useStore.setState({ running: true })
    assert.equal(s.createArea('LVL'), true)
    assert.equal(s.createModule({ tag: 'LI-901', type: 'AI', area: 'LVL', description: 'Alarm field fixture', unit: 'gal', pvMin: 0, pvMax: 1000 }), true)
    run(s, alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

test('DV09-043 parseAlarmFieldPath accepts TAG.ALM[TYPE].FIELD case-insensitively and rejects malformed/unsupported paths', () => {
  assert.deepEqual(parseAlarmFieldPath('li-901.alm[hi].enab'), { tag: 'LI-901', type: 'HI', field: 'ENAB' })
  assert.deepEqual(parseAlarmFieldPath('LI-901.ALM[HI_HI].PRIAD'), { tag: 'LI-901', type: 'HI_HI', field: 'PRIAD' })
  assert.match(parseAlarmFieldPath('LI-901.ALM[HI]').error, /not a valid/)
  assert.match(parseAlarmFieldPath('LI-901.HI.ENAB').error, /not a valid/)
  assert.match(parseAlarmFieldPath('LI-901.ALM[HI].BOGUS').error, /not a supported alarm field/)
  assert.equal(alarmFieldPath('LI-901', 'HI', 'ENAB'), 'LI-901.ALM[HI].ENAB')
})

test('DV09-043 ALARM_FIELD_LOCK matches the course lock model: ENAB/PRIAD under SYSTEM_RECORDS, MACK under ALARMS, PRI read-only', () => {
  assert.equal(ALARM_FIELD_LOCK.ENAB, 'SYSTEM_RECORDS')
  assert.equal(ALARM_FIELD_LOCK.PRIAD, 'SYSTEM_RECORDS')
  assert.equal(ALARM_FIELD_LOCK.MACK, 'ALARMS')
  assert.equal(ALARM_FIELD_LOCK.PRI, null)
})

test('DV09-043 readAlarmField resolves ENAB/PRIAD/PRI and rejects reading the write-only MACK pulse', () => fixture(() => {
  const modules = useStore.getState().modules
  assert.deepEqual(readAlarmField(modules, 'LI-901.ALM[HI].ENAB'), { value: false })
  assert.deepEqual(readAlarmField(modules, 'LI-901.ALM[HI].PRIAD'), { value: null })
  assert.equal(readAlarmField(modules, 'LI-901.ALM[HI].PRI').value, 11) // WARNING class default rank
  assert.match(readAlarmField(modules, 'LI-901.ALM[HI].MACK').error, /write-only/)
  assert.match(readAlarmField(modules, 'GONE.ALM[HI].ENAB').error, /does not exist/)
  assert.match(readAlarmField(modules, 'LI-901.ALM[DV_HI].ENAB').error, /not a configured alarm/)
}))

test('DV09-043 alarmFieldWriteError validates each field independently of Locks & Keys', () => fixture(() => {
  const modules = useStore.getState().modules
  assert.equal(alarmFieldWriteError(modules, 'LI-901.ALM[HI].ENAB', true), null)
  assert.match(alarmFieldWriteError(modules, 'LI-901.ALM[HI].ENAB', 1), /Boolean/)
  assert.equal(alarmFieldWriteError(modules, 'LI-901.ALM[HI].PRIAD', 12), null)
  assert.equal(alarmFieldWriteError(modules, 'LI-901.ALM[HI].PRIAD', null), null)
  assert.match(alarmFieldWriteError(modules, 'LI-901.ALM[HI].PRIAD', 3), /4 to 15/)
  assert.match(alarmFieldWriteError(modules, 'LI-901.ALM[HI].PRIAD', 4.5), /4 to 15/)
  assert.match(alarmFieldWriteError(modules, 'LI-901.ALM[HI].PRI', 10), /read-only/)
  assert.equal(alarmFieldWriteError(modules, 'LI-901.ALM[HI].MACK', true), null)
  assert.match(alarmFieldWriteError(modules, 'LI-901.ALM[HI].MACK', false), /must be written true/)
}))

test('DV09-043 store.writeAlarmField enforces SYSTEM_RECORDS for ENAB/PRIAD and ALARMS for MACK, and applies validated writes', () => fixture((s, alerts) => {
  // ENAB: denied without SYSTEM_RECORDS, applied once granted.
  useSecurity.getState().setUserLocks('admin', useSecurity.getState().users.find((u) => u.name === 'admin').locks.filter((l) => l !== 'SYSTEM_RECORDS'))
  assert.equal(s.writeAlarmField('LI-901.ALM[HI].ENAB', true), false)
  assert.equal(useStore.getState().modules['LI-901'].alarms.find((a) => a.type === 'HI').enabled, false)
  assert.match(useSecurity.getState().lastDenied, /System Records/)
  useSecurity.getState().setUserLocks('admin', [...useSecurity.getState().users.find((u) => u.name === 'admin').locks, 'SYSTEM_RECORDS'])
  assert.equal(s.writeAlarmField('LI-901.ALM[HI].ENAB', true), true)
  assert.equal(useStore.getState().modules['LI-901'].alarms.find((a) => a.type === 'HI').enabled, true)

  // PRIAD: validated, then applied.
  assert.equal(s.writeAlarmField('LI-901.ALM[HI].PRIAD', 3), false)
  assert.match(alerts.at(-1), /4 to 15/)
  assert.equal(s.writeAlarmField('LI-901.ALM[HI].PRIAD', 9), true)
  assert.equal(useStore.getState().modules['LI-901'].alarms.find((a) => a.type === 'HI').rank, 9)

  // MACK: denied without ALARMS, then acknowledges a real active alarm once granted.
  useStore.setState((st) => ({
    alarms: [...st.alarms, {
      id: 'LI-901.HI', moduleTag: 'LI-901', moduleDesc: 'Alarm field fixture', type: 'HI',
      label: 'High', priority: 'WARNING', value: 999, unit: 'gal', active: true, acknowledged: false, time: Date.now()
    }]
  }))
  useSecurity.getState().setUserLocks('admin', useSecurity.getState().users.find((u) => u.name === 'admin').locks.filter((l) => l !== 'ALARMS'))
  assert.equal(s.writeAlarmField('LI-901.ALM[HI].MACK', true), false)
  assert.equal(useStore.getState().alarms.find((a) => a.id === 'LI-901.HI').acknowledged, false)
  useSecurity.getState().setUserLocks('admin', [...useSecurity.getState().users.find((u) => u.name === 'admin').locks, 'ALARMS'])
  assert.equal(s.writeAlarmField('LI-901.ALM[HI].MACK', true), true)
  assert.equal(useStore.getState().alarms.find((a) => a.id === 'LI-901.HI').acknowledged, true)

  // Malformed path and unconfigured alarm type are both rejected with a visible error.
  assert.equal(s.writeAlarmField('LI-901.HI.ENAB', true), false)
  assert.match(alerts.at(-1), /not a valid/)
  assert.equal(s.writeAlarmField('LI-901.ALM[DV_HI].ENAB', true), false)
  assert.match(alerts.at(-1), /not a configured alarm/)
}))
