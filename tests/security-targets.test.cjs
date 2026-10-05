const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity, ALL_LOCKS, LOCK_LABEL, USER_LOCKS } = require('../src/renderer/src/engine/security.ts')
const { SECURITY_TARGETS, findSecurityTarget } = require('../src/renderer/src/engine/securityTargets.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.window = { alert: () => {}, confirm: () => true }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null, lockAssignments: {} })
    run(() => useSecurity.getState())
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(e.name) ? [full] : []
  })
}

function literalCallSites() {
  const sites = []
  const call = /(?:requireLock|requireUnlockedKey|requireUnlockedLock)\(\s*'([A-Z_0-9]+)'\s*,\s*([`'])((?:(?!\2).)*)\2/g
  for (const file of sourceFiles(path.join(__dirname, '..', 'src', 'renderer', 'src'))) {
    if (/security(Targets)?\.ts$/.test(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(call)) {
      const action = m[3].replace(/\$\{[^?}]*\?\s*'([^']*)'[^}]*\}/g, '$1').replace(/\$\{[^}]*\}/g, 'X1')
      const actions = action === 'X1 X1' ? ['BYPASS X1', 'ARM_TRAP X1', 'RESET_IN X1'] : [action]
      for (const a of actions) sites.push({ file: path.basename(file), lock: m[1], action: a })
    }
  }
  return sites
}

test('DV09-074 the lock registry is typed: every course lock including User Lock 01-10 is present and labelled', () => {
  assert.equal(USER_LOCKS.length, 10)
  assert.deepEqual(USER_LOCKS.slice(0, 2), ['USER_LOCK_01', 'USER_LOCK_02'])
  assert.equal(LOCK_LABEL.USER_LOCK_10, 'User Lock 10')
  for (const lock of ALL_LOCKS) assert.ok(LOCK_LABEL[lock], `${lock} has a label`)
  assert.equal(new Set(ALL_LOCKS).size, ALL_LOCKS.length)
  assert.equal(ALL_LOCKS.length, 13 + 10)
})

test('DV09-075 every literal secured operation in the app is a registered parameter/field/function', () => {
  const sites = literalCallSites()
  assert.ok(sites.length > 80, `expected the full set of call sites, found ${sites.length}`)
  const unregistered = sites.filter((s) => !findSecurityTarget(s.lock, s.action))
  const ambiguous = sites.filter((s) => SECURITY_TARGETS.filter((t) => t.defaultLock === s.lock && t.pattern.test(s.action)).length > 1)
  assert.deepEqual(ambiguous, [], 'each secured operation belongs to exactly one target')
  assert.deepEqual(unregistered, [], 'every secured operation must be reassignable in Security Properties')
  const used = new Set(sites.map((s) => findSecurityTarget(s.lock, s.action)?.id))
  const alarmFieldIds = ['field-alm-enab', 'field-alm-mack']
  for (const t of SECURITY_TARGETS) {
    if (alarmFieldIds.includes(t.id)) continue
    assert.ok(used.has(t.id), `${t.id} matches at least one real call site`)
  }
  assert.equal(new Set(SECURITY_TARGETS.map((t) => t.id)).size, SECURITY_TARGETS.length)
})

test('DV09-075 alarm record fields resolve to field targets with the lock alarmFields.ts already requires', () => {
  assert.equal(findSecurityTarget('SYSTEM_RECORDS', 'Write TIC-401.ALM[HI].ENAB').id, 'field-alm-enab')
  assert.equal(findSecurityTarget('SYSTEM_RECORDS', 'Write TIC-401.ALM[HI].PRIAD').id, 'field-alm-enab')
  assert.equal(findSecurityTarget('ALARMS', 'Write TIC-401.ALM[HI].MACK').id, 'field-alm-mack')
  assert.equal(findSecurityTarget('CONTROL', 'Write TIC-401.ALM[HI].MACK'), undefined)
})

test('DV09-075 reassigning a parameter lock changes who can write it, across the real write path', () => fixture((sec) => {
  const store = useStore.getState()
  const sp0 = useStore.getState().modules['TIC-401'].sp
  const target = sp0 - 9

  useSecurity.setState({ currentUser: 'OperatorA' })
  store.setSetpoint('TIC-401', target)
  assert.equal(useStore.getState().modules['TIC-401'].sp, target, 'default: the Control key writes SP')

  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(sec().setTargetLock('param-sp', 'TUNING'), null)
  assert.equal(sec().lockFor('CONTROL', 'Set Setpoint TIC-401'), 'TUNING')

  useSecurity.setState({ currentUser: 'OperatorA' })
  useStore.getState().setSetpoint('TIC-401', target + 3)
  assert.equal(useStore.getState().modules['TIC-401'].sp, target, 'an operator without the reassigned key is denied')
  assert.match(sec().lastDenied, /Set Setpoint TIC-401 requires the Tuning key \(reassigned from Control\)/)

  useSecurity.setState({ currentUser: 'Supervisor1' })
  useStore.getState().setSetpoint('TIC-401', target + 3)
  assert.equal(useStore.getState().modules['TIC-401'].sp, target + 3, 'a user holding the reassigned key is allowed')

  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(sec().setTargetLock('param-sp', undefined), null)
  assert.deepEqual(sec().lockAssignments, {})
  useSecurity.setState({ currentUser: 'OperatorA' })
  useStore.getState().setSetpoint('TIC-401', target + 6)
  assert.equal(useStore.getState().modules['TIC-401'].sp, target + 6, 'restoring the default lock restores access')
}))

test('DV09-074/075 a custom User Lock can be assigned to a function and granted to a group', () => fixture((sec) => {
  assert.equal(sec().setTargetLock('fn-new-project', 'USER_LOCK_03'), null)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(sec().requireLock('CAN_CONFIGURE', 'New Project (blank)'), false)
  assert.match(sec().lastDenied, /User Lock 03/)

  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(sec().createGroup('Starters', ''), null)
  assert.equal(sec().setGroupLocks('Starters', ['USER_LOCK_03']), null)
  assert.equal(sec().addGroupMember('Starters', 'OperatorA'), null)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(sec().requireLock('CAN_CONFIGURE', 'New Project (blank)'), true, 'group-inherited custom key opens the function')
  assert.equal(sec().requireLock('CAN_CONFIGURE', 'Delete module X1'), false, 'other CAN_CONFIGURE functions are unchanged')
}))

test('DV09-075 reassignment itself requires System Admin and validates ids and locks', () => fixture((sec) => {
  assert.match(sec().setTargetLock('nope', 'CONTROL'), /Unknown secured item/)
  assert.match(sec().setTargetLock('param-sp', 'BOGUS'), /Unknown lock/)
  useSecurity.setState({ currentUser: 'Supervisor1' })
  assert.match(sec().setTargetLock('param-sp', 'TUNING'), /System Admin/)
  assert.deepEqual(sec().lockAssignments, {})
  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(sec().setTargetLock('param-sp', 'CONTROL'), null, 'assigning the default lock stores no override')
  assert.deepEqual(sec().lockAssignments, {})
}))

test('DV09-075 one family can be reassigned without touching a different default lock', () => fixture((sec) => {
  assert.equal(sec().setTargetLock('param-tune-test', 'DIAGNOSTIC'), null)
  assert.equal(sec().lockFor('TUNING', 'Test FIC-102'), 'DIAGNOSTIC')
  assert.equal(sec().lockFor('CONTROL', 'Test FIC-102'), 'CONTROL', 'the Control half of PID Tune Test keeps its lock')
  assert.equal(sec().lockFor('TUNING', 'Tune FIC-102'), 'TUNING')
}))
