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

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.window = { alert: () => {}, confirm: () => true }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null, lockAssignments: {} })
    const s = useStore.getState()
    s.newProject('blank')
    if (!useStore.getState().areas.includes('DRYING')) assert.equal(s.createArea('DRYING'), true)
    assert.equal(s.createModule({ tag: 'FEED-01', type: 'MOTOR', area: 'FEED', description: 'Feed pump' }), true)
    assert.equal(s.createModule({ tag: 'DRY-01', type: 'MOTOR', area: 'DRYING', description: 'Dryer fan' }), true)
    run(() => useStore.getState().modules, () => useSecurity.getState())
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

test('DV09-079 an area-restricted operator can operate only modules in the granted area', () => fixture((modules, sec) => {
  assert.equal(sec().addUser({ name: 'OperatorB', fullName: 'Op B', password: 'x', locks: ['CONTROL', 'ALARMS'], areas: ['FEED'] }), true)
  useSecurity.setState({ currentUser: 'OperatorB' })

  useStore.getState().startMotor('FEED-01')
  assert.equal(modules()['FEED-01'].commanded, true, 'correct area: allowed')

  useStore.getState().startMotor('DRY-01')
  assert.equal(modules()['DRY-01'].commanded, false, 'wrong area: denied')
  assert.match(sec().lastDenied, /Start DRY-01 requires the area key for DRYING/)

  useStore.getState().stopMotor('FEED-01')
  assert.equal(modules()['FEED-01'].commanded, false)
}))

test('DV09-079 an unrestricted user (sitewide) can operate every area', () => fixture((modules) => {
  useSecurity.setState({ currentUser: 'Supervisor1' })
  useStore.getState().startMotor('FEED-01')
  useStore.getState().startMotor('DRY-01')
  assert.equal(modules()['FEED-01'].commanded, true)
  assert.equal(modules()['DRY-01'].commanded, true)
}))

test('DV09-079 an operator without the Tuning key is denied tuning even in the right area; Supervisor1 tunes sitewide', () => fixture((modules, sec) => {
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(sec().requireLock('TUNING', 'Tune FEED-01'), false)
  assert.match(sec().lastDenied, /Tuning key/)
  useSecurity.setState({ currentUser: 'Supervisor1' })
  assert.equal(sec().requireLock('TUNING', 'Tune FEED-01'), true)
  assert.equal(sec().requireLock('TUNING', 'Tune DRY-01'), true)
  assert.equal(sec().requireLock('CAN_DOWNLOAD', 'Download module DRY-01'), true, 'Supervisor1 has download capability')
  assert.equal(sec().users.find((u) => u.name === 'Supervisor1').areas, undefined, 'Supervisor1 keys are sitewide')
}))

test('DV09-079 group area keys grant access to a restricted member; removal revokes it at once', () => fixture((modules, sec) => {
  assert.equal(sec().addUser({ name: 'OperatorC', fullName: 'Op C', password: 'x', locks: ['CONTROL'], areas: ['FEED'] }), true)
  assert.equal(sec().createGroup('DryingOps', ''), null)
  assert.equal(sec().setGroupAreas('DryingOps', ['DRYING']), null)
  assert.equal(sec().addGroupMember('DryingOps', 'OperatorC'), null)
  useSecurity.setState({ currentUser: 'OperatorC' })
  useStore.getState().startMotor('DRY-01')
  assert.equal(modules()['DRY-01'].commanded, true, 'group area key opens DRYING')

  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(sec().removeGroupMember('DryingOps', 'OperatorC'), null)
  useSecurity.setState({ currentUser: 'OperatorC' })
  useStore.getState().stopMotor('DRY-01')
  assert.equal(modules()['DRY-01'].commanded, true, 'after removal the stop is denied')
}))

test('DV09-079 area keys do not restrict configuration functions or untargeted alarm acknowledgement', () => fixture((modules, sec) => {
  assert.equal(sec().addUser({ name: 'OperatorD', fullName: 'Op D', password: 'x', locks: ['CONTROL', 'ALARMS', 'CAN_CONFIGURE'], areas: ['FEED'] }), true)
  useSecurity.setState({ currentUser: 'OperatorD' })
  assert.equal(sec().requireLock('ALARMS', 'Acknowledge alarm'), true)
  assert.equal(sec().requireLock('CAN_CONFIGURE', 'Delete module DRY-01'), true, 'functions are governed by their lock, not area')
}))

test('DV09-079 workstation download: new users and key changes apply to logon only after Download Workstation', () => fixture((modules, sec) => {
  const store = new Map()
  global.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  try {
    assert.equal(sec().workstation, null)
    assert.equal(sec().workstationPending(), true)
    assert.equal(sec().downloadWorkstation(), null)
    assert.equal(sec().workstationPending(), false)

    assert.equal(sec().addUser({ name: 'OperatorE', fullName: 'Op E', password: 'pw', locks: ['CONTROL'] }), true)
    assert.equal(sec().workstationPending(), true)
    assert.equal(sec().loginStatus('OperatorE', 'pw'), 'not-downloaded')
    assert.equal(sec().login('OperatorE', 'pw'), false)
    assert.match(sec().lastDenied, /not downloaded to this workstation/)

    assert.equal(sec().downloadWorkstation(), null)
    assert.equal(sec().loginStatus('OperatorE', 'pw'), 'ok')
    assert.equal(sec().login('OperatorE', 'pw'), true)

    useSecurity.setState({ currentUser: 'admin' })
    assert.equal(sec().setUserLocks('OperatorE', ['CONTROL', 'TUNING']), undefined)
    useSecurity.setState({ currentUser: 'OperatorE' })
    assert.equal(sec().hasLock('TUNING'), false, 'a key granted after the last download is not active on this workstation')
    useSecurity.setState({ currentUser: 'admin' })
    assert.equal(sec().downloadWorkstation(), null)
    useSecurity.setState({ currentUser: 'OperatorE' })
    assert.equal(sec().hasLock('TUNING'), true, 'after Download Workstation the key is active')
    assert.ok(store.get('batchlive.workstation.security'), 'the downloaded workstation is persisted')
  } finally {
    delete global.localStorage
  }
}))

test('DV09-079 downloading a workstation requires the Can Download key', () => fixture((modules, sec) => {
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(sec().downloadWorkstation(), /Can Download/)
  assert.equal(sec().workstation, null)
  useSecurity.setState({ currentUser: 'Supervisor1' })
  assert.equal(sec().downloadWorkstation(), null)
}))

test('DV09-079 a downloaded workstation is restored when the application restarts', () => {
  const store = new Map()
  global.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  const modulePath = require.resolve('../src/renderer/src/engine/security.ts')
  const saved = require.cache[modulePath]
  try {
    delete require.cache[modulePath]
    const first = require(modulePath).useSecurity
    first.getState().addUser({ name: 'Persisted', fullName: 'P', password: 'pw', locks: ['CONTROL'] })
    assert.equal(first.getState().downloadWorkstation(), null)
    delete require.cache[modulePath]
    const second = require(modulePath).useSecurity
    assert.ok(second.getState().workstation)
    assert.equal(second.getState().users.some((u) => u.name === 'Persisted'), true)
    assert.equal(second.getState().login('Persisted', 'pw'), true)
  } finally {
    delete global.localStorage
    require.cache[modulePath] = saved
  }
})
