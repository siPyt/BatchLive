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
const rh = require('../src/renderer/src/engine/remoteHost.ts')

const TAG = 'TIC-401'
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    useStore.setState({ running: true })
    run(useStore.getState())
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const m = () => useStore.getState().modules[TAG]
const tick = (n = 1, dt = 1) => { for (let i = 0; i < n; i++) useStore.getState().tick(dt) }
const setTarget = (mode) => useStore.setState({ modules: { ...useStore.getState().modules, [TAG]: { ...m(), mode } } })

test('DV09-055 host signals are fresh only when Good, finite, and within the timeout', () => {
  const fresh = { value: 5, good: true, ageSec: 3 }
  assert.equal(rh.hostSignalFresh(fresh, 10), true)
  assert.equal(rh.hostSignalFresh({ ...fresh, ageSec: 10 }, 10), true, 'exactly at the timeout is still fresh')
  assert.equal(rh.hostSignalFresh({ ...fresh, ageSec: 10.001 }, 10), false)
  assert.equal(rh.hostSignalFresh({ ...fresh, good: false }, 10), false)
  assert.equal(rh.hostSignalFresh({ ...fresh, value: NaN }, 10), false)
  assert.equal(rh.hostSignalFresh(rh.emptyHostSignal(), 10), false)
  assert.equal(rh.hostSignalFresh({ ...fresh, ageSec: null }, 10), false, 'a never-written signal survives JSON as null')
  assert.equal(rh.hostSignalStatus(rh.emptyHostSignal(), 10), 'No host data yet')
  assert.equal(rh.hostSignalStatus({ ...fresh, good: false }, 10), 'Bad')
  assert.equal(rh.hostSignalStatus({ ...fresh, ageSec: 12 }, 10), 'Stale (12 s old)')
  assert.equal(rh.hostSignalStatus(fresh, 10), 'Good')
})

test('DV09-055 host writes are range-checked: RCAS_IN in PV units, ROUT_IN in percent; timeout 1-3600 s', () => {
  const pid = { pvMin: 20, pvMax: 120 }
  assert.equal(rh.hostWriteError(pid, 'RCAS_IN', 20), null)
  assert.equal(rh.hostWriteError(pid, 'RCAS_IN', 120), null)
  assert.match(rh.hostWriteError(pid, 'RCAS_IN', 19.9), /PV range 20 to 120/)
  assert.match(rh.hostWriteError(pid, 'RCAS_IN', 121), /PV range/)
  assert.equal(rh.hostWriteError(pid, 'ROUT_IN', 0), null)
  assert.equal(rh.hostWriteError(pid, 'ROUT_IN', 100), null)
  assert.match(rh.hostWriteError(pid, 'ROUT_IN', 100.1), /between 0 and 100/)
  assert.match(rh.hostWriteError(pid, 'ROUT_IN', -1), /between 0 and 100/)
  assert.match(rh.hostWriteError(pid, 'ROUT_IN', NaN), /finite/)
  for (const ok of [1, 10, 3600]) assert.equal(rh.hostTimeoutError(ok), null)
  for (const bad of [0, 0.5, 3601, NaN]) assert.match(rh.hostTimeoutError(bad), /between 1 and 3600/)
})

test('DV09-055 ageing advances only finite ages and keeps identity when nothing changes', () => {
  const remote = rh.newRemoteHost()
  assert.equal(rh.ageRemoteHost(remote, 5), remote, 'never-written inputs stay never-written')
  assert.equal(rh.ageRemoteHost(remote, 0), remote)
  const written = rh.writeHostSignal(remote, 'RCAS_IN', 50)
  const aged = rh.ageRemoteHost(written, 4)
  assert.equal(aged.rcasIn.ageSec, 4)
  assert.equal(aged.routIn.ageSec, Infinity)
  assert.equal(written.rcasIn.ageSec, 0, 'the previous object is untouched')
  assert.equal(rh.markHostBad(written, 'RCAS_IN').rcasIn.good, false)
})

test('DV09-055 RCAS: sheds to AUTO without host data, follows RCAS_IN while fresh, sheds again when stale, returns on a new write', () => fixture(() => {
  const s = useStore.getState()
  setTarget('RCAS')
  tick(2)
  assert.deepEqual([m().mode, m().actualMode], ['RCAS', 'AUTO'], 'no host data: normal shed to AUTO')
  assert.equal(s.writeRemoteHost(TAG, 'RCAS_IN', 61), null)
  tick(1)
  assert.deepEqual([m().mode, m().actualMode, m().sp], ['RCAS', 'RCAS', 61])
  assert.equal(s.writeRemoteHost(TAG, 'RCAS_IN', 64), null)
  tick(1)
  assert.equal(m().sp, 64)
  tick(9)
  assert.equal(m().actualMode, 'RCAS', '9 s after the write is within the 10 s timeout')
  tick(2)
  assert.deepEqual([m().mode, m().actualMode], ['RCAS', 'AUTO'], 'host stopped writing: stale data sheds')
  assert.equal(m().sp, 64, 'the last setpoint is held in AUTO')
  s.writeRemoteHost(TAG, 'RCAS_IN', 70)
  tick(1)
  assert.deepEqual([m().actualMode, m().sp], ['RCAS', 70])
}))

test('DV09-055 RCAS needs no cascade source and CAS still does', () => fixture(() => {
  setTarget('RCAS')
  assert.equal(m().casSource, undefined)
  useStore.getState().writeRemoteHost(TAG, 'RCAS_IN', 66)
  tick(1)
  assert.equal(m().actualMode, 'RCAS')
  useStore.getState().writeRemoteHost(TAG, 'RCAS_IN', 66)
  useStore.setState({ modules: { ...useStore.getState().modules, [TAG]: { ...m(), mode: 'CAS', casHealthy: false } } })
  tick(1)
  assert.equal(m().actualMode, 'AUTO', 'CAS with an unhealthy source sheds; fresh host data does not stand in for it')
}))

test('DV09-055 a Bad host value sheds RCAS and ROUT immediately', () => fixture(() => {
  const s = useStore.getState()
  s.writeRemoteHost(TAG, 'RCAS_IN', 62)
  setTarget('RCAS')
  tick(1)
  assert.equal(m().actualMode, 'RCAS')
  assert.equal(s.writeRemoteHost(TAG, 'RCAS_IN', null), null)
  tick(1)
  assert.equal(m().actualMode, 'AUTO')
  assert.ok(useStore.getState().eventLog.some(e => e.tag === TAG && /marked RCAS_IN Bad/.test(e.description)))
  s.writeRemoteHost(TAG, 'ROUT_IN', 30)
  setTarget('ROUT')
  tick(1)
  assert.equal(m().actualMode, 'ROUT')
  s.writeRemoteHost(TAG, 'ROUT_IN', null)
  tick(1)
  assert.equal(m().actualMode, 'MAN')
}))

test('DV09-055 ROUT: OUT follows ROUT_IN while fresh, holds the last output in MAN when stale, and clamps to 0-100', () => fixture(() => {
  const s = useStore.getState()
  setTarget('ROUT')
  tick(1)
  assert.deepEqual([m().mode, m().actualMode], ['ROUT', 'MAN'], 'no host data: shed to MAN')
  assert.equal(s.writeRemoteHost(TAG, 'ROUT_IN', 37.5), null)
  tick(1)
  assert.deepEqual([m().actualMode, m().out], ['ROUT', 37.5])
  s.writeRemoteHost(TAG, 'ROUT_IN', 80)
  tick(1)
  assert.equal(m().out, 80)
  assert.match(s.writeRemoteHost(TAG, 'ROUT_IN', 101), /between 0 and 100/)
  assert.match(s.writeRemoteHost(TAG, 'ROUT_IN', -5), /between 0 and 100/)
  assert.equal(m().remote.routIn.value, 80, 'rejected writes change nothing')
  tick(11)
  assert.equal(m().actualMode, 'MAN')
  assert.equal(m().out, 80, 'bumpless: the shed holds the last host output')
}))

test('DV09-055 host inputs are stored but ignored outside RCAS/ROUT, and the timeout is configurable', () => fixture(() => {
  const s = useStore.getState()
  s.writeRemoteHost(TAG, 'RCAS_IN', 99)
  s.writeRemoteHost(TAG, 'ROUT_IN', 12)
  tick(2)
  assert.equal(m().actualMode, m().mode)
  assert.notEqual(m().sp, 99)
  assert.equal(s.setRemoteHostTimeout(TAG, 3), null)
  setTarget('RCAS')
  s.writeRemoteHost(TAG, 'RCAS_IN', 62)
  tick(3)
  assert.equal(m().actualMode, 'RCAS')
  tick(1)
  assert.equal(m().actualMode, 'AUTO', '4 s old with a 3 s timeout')
  assert.match(s.setRemoteHostTimeout(TAG, 0), /between 1 and 3600/)
  assert.equal(m().remote.timeoutSec, 3)
  assert.match(s.setRemoteHostTimeout('NOPE', 5), /does not exist/)
  assert.match(s.writeRemoteHost('NOPE', 'RCAS_IN', 5), /does not exist/)
  assert.match(s.writeRemoteHost('P-101', 'RCAS_IN', 5), /does not exist/, 'only PID modules have host inputs')
}))

test('DV09-055 host writes and timeout changes need their keys and are journaled', () => fixture(() => {
  const s = useStore.getState()
  s.writeRemoteHost(TAG, 'RCAS_IN', 60)
  assert.ok(useStore.getState().eventLog.some(e => /Remote host wrote RCAS_IN = 60/.test(e.description)))
  assert.ok(useStore.getState().eventLog.some(e => /Remote host write rejected|Remote host wrote/.test(e.description)))
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CONTROL: 'SYSTEM_ADMIN', CAN_CONFIGURE: 'SYSTEM_ADMIN' } })
  assert.equal(s.writeRemoteHost(TAG, 'RCAS_IN', 61), 'Requires the Control key')
  assert.equal(s.setRemoteHostTimeout(TAG, 30), 'Requires the Can Configure key')
  assert.equal(m().remote.rcasIn.value, 60)
  assert.equal(m().remote.timeoutSec, 10)
}))
