const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useSecurity, accountState } = require('../src/renderer/src/engine/security.ts')
const pol = require('../src/renderer/src/engine/passwordPolicy.ts')

const DAY = pol.DAY_MS
function fixture(run) {
  const before = useSecurity.getState()
  useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null, workstation: null,
    passwordPolicy: pol.defaultPasswordPolicy() })
  try {
    run(() => useSecurity.getState())
  } finally {
    useSecurity.setState(before, true)
  }
}
const mk = (sec, name = 'Tech1', password = 'x') =>
  assert.equal(sec().addUser({ name, fullName: name, password, locks: ['CONTROL'] }), true)
const user = (sec, name = 'Tech1') => sec().users.find(u => u.name === name)

test('DV09-076 the default policy keeps the earlier behaviour (any non-blank password, no aging)', () => fixture((sec) => {
  assert.deepEqual(pol.passwordViolations(sec().passwordPolicy, 'u', 'a'), [])
  assert.deepEqual(pol.passwordViolations(sec().passwordPolicy, 'u', ''), ['The password cannot be blank'])
  mk(sec)
  assert.equal(sec().loginStatus('Tech1', 'x'), 'ok')
}))

test('DV09-076 policy values are validated at the boundaries', () => {
  const base = pol.defaultPasswordPolicy()
  assert.equal(pol.passwordPolicyError(base), null)
  assert.equal(pol.passwordPolicyError({ ...base, minLength: 64, maxAgeDays: 999, historyCount: 24 }), null)
  for (const bad of [{ minLength: 0 }, { minLength: 65 }, { minLength: 1.5 }, { maxAgeDays: -1 }, { maxAgeDays: 1000 },
    { historyCount: 25 }, { historyCount: -1 }, { requireDigit: 'yes' }, { forbidUserName: 1 }])
    assert.ok(pol.passwordPolicyError({ ...base, ...bad }), JSON.stringify(bad))
  assert.match(pol.passwordPolicyError({ ...base, minLength: 2, requireUpper: true, requireLower: true, requireDigit: true }), /cannot hold 3/)
})

test('DV09-076 complexity rules report every missing requirement', () => {
  const policy = { ...pol.defaultPasswordPolicy(), minLength: 8, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: true, forbidUserName: true }
  assert.deepEqual(pol.passwordViolations(policy, 'Tech1', 'abc'),
    ['at least 8 characters', 'an upper-case letter', 'a digit', 'a symbol'])
  assert.deepEqual(pol.passwordViolations(policy, 'Tech1', 'Str0ng!Pass'), [])
  assert.deepEqual(pol.passwordViolations(policy, 'Tech1', 'xTECH1x!A9a'), ['no part of the user name'])
  assert.match(pol.passwordPolicyMessage(['a digit', 'a symbol']), /must contain a digit, a symbol/)
  assert.equal(pol.passwordPolicyMessage([]), null)
})

test('DV09-076 policy applies when a user is created, changed or reset', () => fixture((sec) => {
  assert.equal(sec().setPasswordPolicy({ minLength: 8, requireDigit: true }), null)
  assert.equal(sec().addUser({ name: 'Weak', fullName: 'w', password: 'short', locks: [] }), false)
  assert.match(sec().lastDenied, /at least 8 characters, a digit/)
  assert.equal(sec().users.some(u => u.name === 'Weak'), false)
  mk(sec, 'Tech1', 'longenough1')
  assert.equal(sec().changePassword('Tech1', 'longenough1', 'nodigitshere'), 'The password must contain a digit')
  assert.equal(sec().changePassword('Tech1', 'longenough1', 'newpass12'), null)
  assert.equal(user(sec).password, 'newpass12')
  assert.equal(sec().resetPassword('Tech1', 'weak'), 'The password must contain at least 8 characters, a digit')
  assert.equal(sec().resetPassword('Tech1', 'resetpass9'), null)
  assert.equal(user(sec).mustChangePassword, true)
  assert.equal(sec().loginStatus('Tech1', 'resetpass9'), 'must-change')
  assert.equal(sec().changePassword('Tech1', 'resetpass9', 'finalpass3'), null)
  assert.equal(sec().loginStatus('Tech1', 'finalpass3'), 'ok')
}))

test('DV09-076 password history rejects reuse of the last N passwords and stores only fingerprints', () => fixture((sec) => {
  sec().setPasswordPolicy({ historyCount: 2 })
  mk(sec, 'Tech1', 'one')
  assert.equal(sec().changePassword('Tech1', 'one', 'two'), null)
  assert.equal(sec().changePassword('Tech1', 'two', 'three'), null)
  assert.match(sec().changePassword('Tech1', 'three', 'two'), /not used in the last 2 changes/)
  assert.match(sec().changePassword('Tech1', 'three', 'one'), /not used in the last 2 changes/)
  assert.equal(sec().changePassword('Tech1', 'three', 'four'), null)
  assert.equal(sec().changePassword('Tech1', 'four', 'one'), null, 'one has fallen out of the 2-deep window')
  const stored = JSON.stringify(user(sec).passwordHistory)
  for (const plain of ['"one"', '"two"', '"three"']) assert.ok(!stored.includes(plain))
  assert.equal(user(sec).passwordHistory.every(h => /^[0-9a-f]{64}$/.test(h)), true)
  assert.notEqual(pol.passwordFingerprint('a', 'pw'), pol.passwordFingerprint('b', 'pw'))
  sec().setPasswordPolicy({ historyCount: 0 })
  assert.equal(sec().changePassword('Tech1', 'one', 'two'), null, 'history off allows reuse')
}))

test('DV09-076 password aging forces a change after the maximum age and clears when changed', () => fixture((sec) => {
  sec().setPasswordPolicy({ maxAgeDays: 30 })
  mk(sec)
  const now = Date.now()
  const aged = (days, extra = {}) => useSecurity.setState({ users: sec().users.map(u => u.name === 'Tech1' ? { ...u, passwordChangedAt: now - days * DAY, ...extra } : u) })
  aged(29)
  assert.equal(sec().loginStatus('Tech1', 'x'), 'ok')
  aged(31)
  assert.equal(sec().loginStatus('Tech1', 'x'), 'must-change')
  assert.equal(sec().login('Tech1', 'x'), false)
  assert.match(sec().lastDenied, /must change the password/)
  assert.deepEqual(sec().authenticate('Tech1', 'x'), { ok: false, reason: 'The password must be changed first' })
  aged(31, { passwordNeverExpires: true })
  assert.equal(sec().loginStatus('Tech1', 'x'), 'ok')
  aged(31)
  assert.equal(sec().changePassword('Tech1', 'x', 'y'), null)
  assert.equal(sec().loginStatus('Tech1', 'y'), 'ok')
  assert.ok(Date.now() - user(sec).passwordChangedAt < 5000)
  useSecurity.setState({ users: sec().users.map(u => u.name === 'Tech1' ? { ...u, passwordChangedAt: undefined } : u) })
  assert.equal(sec().loginStatus('Tech1', 'y'), 'ok', 'unknown age is never treated as expired')
  assert.equal(pol.passwordDaysRemaining(sec().passwordPolicy, now - 10 * DAY, false, now), 20)
  assert.equal(pol.passwordDaysRemaining(sec().passwordPolicy, now - 40 * DAY, false, now), 0)
  assert.equal(pol.passwordDaysRemaining(sec().passwordPolicy, undefined, false, now), null)
  assert.equal(pol.passwordDaysRemaining({ ...sec().passwordPolicy, maxAgeDays: 0 }, now, false, now), null)
}))

test('DV09-076 account expiry refuses logons from the expiry instant and can be removed', () => fixture((sec) => {
  mk(sec)
  const now = Date.now()
  assert.equal(sec().setAccountExpiry('Tech1', now + DAY), null)
  assert.equal(sec().loginStatus('Tech1', 'x'), 'ok')
  assert.equal(sec().login('Tech1', 'x'), true)
  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(sec().setAccountExpiry('Tech1', now - 1), null)
  assert.equal(sec().loginStatus('Tech1', 'x'), 'expired')
  assert.equal(sec().login('Tech1', 'x'), false)
  assert.match(sec().lastDenied, /expired/)
  assert.deepEqual(sec().authenticate('Tech1', 'x'), { ok: false, reason: 'The account has expired' })
  assert.equal(sec().loginStatus('Tech1', 'wrong'), 'bad')
  assert.equal(accountState({ ...user(sec), accountExpires: 1000 }, sec().passwordPolicy, 1000), 'expired')
  assert.equal(accountState({ ...user(sec), accountExpires: 1000 }, sec().passwordPolicy, 999), 'ok')
  assert.equal(sec().setAccountExpiry('Tech1', null), null)
  assert.equal(sec().loginStatus('Tech1', 'x'), 'ok')
  assert.equal(user(sec).accountExpires, undefined)
  assert.equal(accountState({ disabled: true, accountExpires: 1 }, sec().passwordPolicy, 5), 'disabled')
}))

test('DV09-076 expiry/policy/reset mutations need System Admin and validate input', () => fixture((sec) => {
  mk(sec)
  assert.equal(sec().setAccountExpiry('Nobody', 5), 'User Nobody does not exist')
  assert.equal(sec().setAccountExpiry('Tech1', NaN), 'The expiry must be a valid date')
  assert.equal(sec().setAccountExpiry('Tech1', -5), 'The expiry must be a valid date')
  assert.equal(sec().setAccountExpiry('admin', Date.now() - 1000), 'The logged-on user cannot expire their own account')
  assert.equal(sec().setPasswordPolicy({ minLength: 0 }) !== null, true)
  assert.equal(sec().passwordPolicy.minLength, 1)
  assert.equal(sec().resetPassword('Nobody', 'x'), 'User Nobody does not exist')
  useSecurity.setState({ currentUser: 'Tech1' })
  assert.equal(sec().setAccountExpiry('Tech1', Date.now() + DAY), 'Requires the System Admin key')
  assert.equal(sec().setPasswordPolicy({ minLength: 12 }), 'Requires the System Admin key')
  assert.equal(sec().resetPassword('Tech1', 'zzz'), 'Requires the System Admin key')
  assert.equal(sec().passwordPolicy.minLength, 1)
  assert.equal(user(sec).accountExpires, undefined)
}))
