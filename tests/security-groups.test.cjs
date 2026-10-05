const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useSecurity, effectiveLocks, effectiveAreas, groupsOf } = require('../src/renderer/src/engine/security.ts')

function fixture(run) {
  const before = useSecurity.getState()
  useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null })
  try {
    run(() => useSecurity.getState())
  } finally {
    useSecurity.setState(before, true)
  }
}

test('DV09-077 a group member inherits group keys immediately and loses them on removal', () => fixture((sec) => {
  assert.equal(sec().createGroup('Tuners', 'Loop tuning'), null)
  assert.equal(sec().setGroupLocks('Tuners', ['TUNING']), null)
  assert.equal(sec().addUser({ name: 'Tech1', fullName: 'Tech', password: 'x', locks: ['CONTROL'] }), true)
  const tech = () => sec().users.find((u) => u.name === 'Tech1')

  useSecurity.setState({ currentUser: 'Tech1' })
  assert.equal(sec().hasLock('TUNING'), false)
  useSecurity.setState({ currentUser: 'admin' })

  assert.equal(sec().addGroupMember('Tuners', 'Tech1'), null)
  assert.deepEqual(effectiveLocks(tech(), sec().groups), ['CONTROL', 'TUNING'])
  useSecurity.setState({ currentUser: 'Tech1' })
  assert.equal(sec().hasLock('TUNING'), true, 'inherited key takes effect at once')
  assert.equal(tech().locks.includes('TUNING'), false, 'the user own grants are untouched')
  useSecurity.setState({ currentUser: 'admin' })

  assert.equal(sec().setGroupLocks('Tuners', []), null)
  useSecurity.setState({ currentUser: 'Tech1' })
  assert.equal(sec().hasLock('TUNING'), false, 'changing group keys applies to members immediately')
  useSecurity.setState({ currentUser: 'admin' })

  assert.equal(sec().setGroupLocks('Tuners', ['TUNING']), null)
  assert.equal(sec().removeGroupMember('Tuners', 'Tech1'), null)
  useSecurity.setState({ currentUser: 'Tech1' })
  assert.equal(sec().hasLock('TUNING'), false)
  assert.equal(sec().hasLock('CONTROL'), true, 'independent user grants are retained')
}))

test('DV09-077 member and group validation rejects missing and duplicate entries', () => fixture((sec) => {
  assert.equal(sec().createGroup('G1', ''), null)
  assert.match(sec().createGroup('g1', ''), /already exists/)
  assert.match(sec().createGroup('  ', ''), /blank/)
  assert.match(sec().addGroupMember('G1', 'Nobody'), /does not exist/)
  assert.match(sec().addGroupMember('Missing', 'admin'), /Group Missing does not exist/)
  assert.equal(sec().addGroupMember('G1', 'admin'), null)
  assert.match(sec().addGroupMember('G1', 'admin'), /already a member/)
  assert.match(sec().removeGroupMember('G1', 'OperatorA'), /not a member/)
  assert.equal(sec().updateGroup('G1', { newName: 'G2', description: 'second' }), null)
  assert.deepEqual(sec().groups.find((g) => g.name === 'G2').members, ['admin'])
  assert.match(sec().updateGroup('G2', { newName: 'Operate' }), /already exists/)
  assert.equal(sec().deleteGroup('G2'), null)
  assert.match(sec().deleteGroup('G2'), /does not exist/)
}))

test('DV09-077 group area keys extend a restricted member only; deleting a user drops memberships', () => fixture((sec) => {
  assert.equal(sec().createGroup('FeedOps', ''), null)
  assert.equal(sec().setGroupAreas('FeedOps', ['FEED']), null)
  assert.equal(sec().addUser({ name: 'Op2', fullName: 'Op', password: 'x', locks: ['CONTROL'], areas: ['DRYING'] }), true)
  assert.equal(sec().addGroupMember('FeedOps', 'Op2'), null)
  const op = () => sec().users.find((u) => u.name === 'Op2')
  assert.deepEqual(effectiveAreas(op(), sec().groups).sort(), ['DRYING', 'FEED'])
  useSecurity.setState({ currentUser: 'Op2' })
  assert.equal(sec().hasAreaKey('FEED'), true)
  assert.equal(sec().hasAreaKey('DRYING'), true)
  assert.equal(sec().hasAreaKey('MIXING'), false)
  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(effectiveAreas(sec().users.find((u) => u.name === 'admin'), sec().groups), undefined, 'unrestricted users stay unrestricted')
  sec().deleteUser('Op2')
  assert.deepEqual(groupsOf('Op2', sec().groups), [])
}))

test('DV09-076 account status: disabled and must-change accounts cannot log on until fixed', () => fixture((sec) => {
  assert.equal(sec().loginStatus('OperatorA', 'operatora'), 'ok')
  assert.equal(sec().setUserStatus('OperatorA', { disabled: true }), null)
  assert.equal(sec().loginStatus('OperatorA', 'operatora'), 'disabled')
  assert.equal(sec().login('OperatorA', 'operatora'), false)
  assert.match(sec().lastDenied, /disabled/)
  assert.equal(sec().currentUser, 'admin')
  assert.equal(sec().loginStatus('OperatorA', 'wrong'), 'bad')

  assert.equal(sec().setUserStatus('OperatorA', { disabled: false, mustChangePassword: true }), null)
  assert.equal(sec().loginStatus('OperatorA', 'operatora'), 'must-change')
  assert.equal(sec().login('OperatorA', 'operatora'), false)
  assert.match(sec().changePassword('OperatorA', 'bad', 'new1'), /incorrect/)
  assert.match(sec().changePassword('OperatorA', 'operatora', ''), /blank/)
  assert.match(sec().changePassword('OperatorA', 'operatora', 'operatora'), /differ/)
  assert.equal(sec().changePassword('OperatorA', 'operatora', 'new1'), null)
  assert.equal(sec().login('OperatorA', 'new1'), true)
  assert.equal(sec().users.find((u) => u.name === 'OperatorA').mustChangePassword, false)
}))

test('DV09-076 the logged-on user cannot disable their own account', () => fixture((sec) => {
  assert.match(sec().setUserStatus('admin', { disabled: true }), /own account/)
  assert.equal(sec().users.find((u) => u.name === 'admin').disabled, undefined)
}))

test('DV09-076/077 account and group mutations are authorized at the store, not only the screen', () => fixture((sec) => {
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(sec().hasLock('SYSTEM_ADMIN'), false)
  assert.match(sec().createGroup('Rogue', ''), /System Admin/)
  assert.match(sec().addGroupMember('Operate', 'OperatorA'), /System Admin/)
  assert.match(sec().setGroupLocks('Operate', ['SYSTEM_ADMIN']), /System Admin/)
  assert.match(sec().setUserStatus('admin', { disabled: true }), /System Admin/)
  assert.equal(sec().addUser({ name: 'Evil', fullName: 'E', password: 'x', locks: [] }), false)
  sec().setUserLocks('OperatorA', ['SYSTEM_ADMIN'])
  sec().setUserAreas('OperatorA', ['X'])
  sec().deleteUser('Supervisor1')
  assert.equal(sec().groups.some((g) => g.name === 'Rogue'), false)
  assert.equal(sec().users.some((u) => u.name === 'Evil'), false)
  assert.equal(sec().users.some((u) => u.name === 'Supervisor1'), true)
  assert.equal(sec().users.find((u) => u.name === 'OperatorA').locks.includes('SYSTEM_ADMIN'), false)
  assert.match(sec().lastDenied, /Access Denied/)
}))

test('DV09-077 the seeded Operate group matches the course Operate group form', () => fixture((sec) => {
  const operate = sec().groups.find((g) => g.name === 'Operate')
  assert.ok(operate)
  assert.deepEqual(operate.members.sort(), ['OperatorA', 'Supervisor1'])
}))
