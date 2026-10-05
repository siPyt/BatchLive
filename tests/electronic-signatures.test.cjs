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
  evaluateSignature, requiredSignature, signaturePolicyError, SIGNABLE_PARAMETERS, EMPTY_SIGNATURE_CONFIG
} = require('../src/renderer/src/engine/electronicSignatures.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: (m) => alerts.push(m), confirm: () => true }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null, lockAssignments: {}, workstation: null })
    const s = useStore.getState()
    s.newProject('blank')
    assert.equal(s.createModule({ tag: 'FEED-01', type: 'MOTOR', area: 'FEED', description: 'Feed pump' }), true)
    run({ alerts, store: () => useStore.getState() })
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

const events = (store) => store().eventLog.map((e) => `${e.category}|${e.tag}|${e.description}`)
const has = (store, pattern) => events(store).some((line) => pattern.test(line))

function configure(store, requirement = 'CONFIRM_VERIFY', allowSamePerson = false) {
  const s = store()
  assert.equal(s.setSignatureApplication({ operate: true }), true)
  assert.equal(s.setSignatureArea('FEED', true), true)
  assert.equal(s.saveSignaturePolicy({ name: 'MOTOR-START', description: '', allowSamePerson, parameters: { SP_D: requirement } }), null)
  assert.equal(s.setModuleSignaturePolicy('FEED-01', 'MOTOR-START'), true)
}

test('DV09-080 pure rules: every prerequisite is needed before a signature is required', () => {
  const policy = { name: 'P', description: '', allowSamePerson: false, parameters: { SP: 'CONFIRM', MODE: 'CONFIRM_VERIFY', OUT: 'NONE' } }
  const config = { ...EMPTY_SIGNATURE_CONFIG, operate: true, areas: ['FEED'], policies: { P: policy }, modules: { 'FIC-1': 'P' } }
  const target = { tag: 'FIC-1', area: 'FEED' }
  assert.equal(requiredSignature(config, target, 'SP').level, 1)
  assert.equal(requiredSignature(config, target, 'MODE').level, 2)
  assert.equal(requiredSignature(config, target, 'OUT').level, 0, 'a NONE parameter needs no signature')
  assert.equal(requiredSignature(config, target, 'GAIN').level, 0, 'a parameter not on the policy needs none')
  assert.equal(requiredSignature({ ...config, operate: false }, target, 'SP').level, 0, 'application disabled')
  assert.equal(requiredSignature({ ...config, controlStudio: true, operate: false }, target, 'SP').level, 1, 'Control Studio application also counts')
  assert.equal(requiredSignature({ ...config, areas: [] }, target, 'SP').level, 0, 'area not enabled')
  assert.equal(requiredSignature({ ...config, modules: {} }, target, 'SP').level, 0, 'module not associated')
  assert.equal(requiredSignature(config, { tag: 'OTHER', area: 'FEED' }, 'SP').level, 0)
  assert.equal(requiredSignature(config, undefined, 'SP').level, 0)
})

test('DV09-080 policy validation', () => {
  assert.match(signaturePolicyError({ name: '1bad', description: '', allowSamePerson: false, parameters: { SP: 'CONFIRM' } }), /Policy name/)
  assert.match(signaturePolicyError({ name: 'ok', description: '', allowSamePerson: false, parameters: {} }), /at least one parameter/)
  assert.match(signaturePolicyError({ name: 'ok', description: '', allowSamePerson: false, parameters: { WIBBLE: 'CONFIRM' } }), /not a writable parameter/)
  assert.match(signaturePolicyError({ name: 'ok', description: '', allowSamePerson: false, parameters: { SP: 'THREE' } }), /unknown signature requirement/)
  assert.equal(signaturePolicyError({ name: 'ok', description: '', allowSamePerson: false, parameters: { SP: 'CONFIRM' } }), null)
  assert.ok(SIGNABLE_PARAMETERS.includes('MESSAGE'))
})

test('DV09-080/085 the write is staged: nothing changes until the required signatures succeed', () => fixture(({ store }) => {
  configure(store)
  useStore.getState().startMotor('FEED-01')
  assert.equal(store().modules['FEED-01'].commanded, false, 'no premature command write')
  assert.equal(store().signaturePending.length, 1)
  const request = store().signaturePending[0]
  assert.equal(request.level, 2)
  assert.equal(request.tag, 'FEED-01')
  assert.ok(has(store, /SECURITY\|FEED-01\|Electronic signature required for SP_D := 1/))

  assert.match(store().submitSignature(request.id, { comment: '  ', confirm: { user: 'admin', password: 'admin123' }, verify: { user: 'Supervisor1', password: 'supervisor1' } }), /comment is required/)
  assert.equal(store().modules['FEED-01'].commanded, false)
  assert.equal(store().signaturePending.length, 1, 'a missing comment keeps the request staged')
}))

test('DV09-080 failed confirmation and failed verification are three distinct outcomes in the journal', () => fixture(({ store }) => {
  configure(store)
  useStore.getState().startMotor('FEED-01')
  const id = store().signaturePending[0].id
  const good = { user: 'admin', password: 'admin123' }

  assert.match(store().submitSignature(id, { comment: 'start', confirm: { user: 'admin', password: 'nope' }, verify: { user: 'Supervisor1', password: 'supervisor1' } }), /Confirm failed/)
  assert.match(store().submitSignature(id, { comment: 'start', confirm: good, verify: { user: 'Supervisor1', password: 'wrong' } }), /Verify failed/)
  assert.match(store().submitSignature(id, { comment: 'start', confirm: good }), /verifier signature is required/)
  assert.match(store().submitSignature(id, { comment: 'start', confirm: { user: 'Supervisor1', password: 'supervisor1' }, verify: { user: 'OperatorA', password: 'operatora' } }), /does not hold the Action Verify key/)
  assert.match(store().submitSignature(id, { comment: 'start', confirm: good, verify: good }), /same person/)
  assert.equal(store().modules['FEED-01'].commanded, false, 'every failure leaves the value unwritten')
  assert.ok(has(store, /SECURITY\|FEED-01\|Electronic signature attempt for SP_D := 1 failed: Verify failed/))
  assert.ok(has(store, /failed: Confirm failed/))

  assert.equal(store().submitSignature(id, { comment: 'Start feed pump per batch 12', confirm: good, verify: { user: 'Supervisor1', password: 'supervisor1' } }), null)
  assert.equal(store().modules['FEED-01'].commanded, true, 'the change is written once confirmed and verified')
  assert.equal(store().signaturePending.length, 0)
  const log = events(store)
  const confirmed = log.findIndex((l) => /confirmed by admin and verified by Supervisor1: Start feed pump per batch 12/.test(l))
  const change = log.findIndex((l) => /OPERATOR\|FEED-01\|Start command issued/.test(l))
  assert.ok(confirmed >= 0 && change >= 0, 'both the signature event and the resulting change are journaled')
  assert.ok(confirmed < change, 'the change follows the signature')
}))

test('DV09-080 the same person may confirm and verify only when the policy allows it', () => fixture(({ store }) => {
  configure(store, 'CONFIRM_VERIFY', true)
  useStore.getState().startMotor('FEED-01')
  const id = store().signaturePending[0].id
  const admin = { user: 'admin', password: 'admin123' }
  assert.equal(store().submitSignature(id, { comment: 'self-verified', confirm: admin, verify: admin }), null)
  assert.equal(store().modules['FEED-01'].commanded, true)
}))

test('DV09-080 one-signature policies need only the confirmer; cancel writes nothing and is journaled', () => fixture(({ store }) => {
  configure(store, 'CONFIRM')
  useStore.getState().startMotor('FEED-01')
  assert.equal(store().signaturePending[0].level, 1)
  assert.equal(store().cancelSignature(store().signaturePending[0].id), true)
  assert.equal(store().modules['FEED-01'].commanded, false)
  assert.equal(store().signaturePending.length, 0)
  assert.ok(has(store, /Electronic signature cancelled for SP_D := 1; the value was not written/))
  assert.equal(store().cancelSignature(999), false)

  useStore.getState().startMotor('FEED-01')
  assert.equal(store().submitSignature(store().signaturePending[0].id, { comment: 'ok', confirm: { user: 'Supervisor1', password: 'supervisor1' } }), null)
  assert.equal(store().modules['FEED-01'].commanded, true)
  assert.ok(has(store, /confirmed by Supervisor1: ok/))
}))

test('DV09-080 prerequisites: application, area, module association and parameter each gate the requirement', () => fixture(({ store }) => {
  configure(store)
  assert.equal(store().setSignatureApplication({ operate: false }), true)
  useStore.getState().startMotor('FEED-01')
  assert.equal(store().modules['FEED-01'].commanded, true, 'application disabled: immediate write')
  useStore.getState().stopMotor('FEED-01')

  store().setSignatureApplication({ operate: true })
  store().setSignatureArea('FEED', false)
  useStore.getState().startMotor('FEED-01')
  assert.equal(store().modules['FEED-01'].commanded, true, 'area disabled: immediate write')
  useStore.getState().stopMotor('FEED-01')

  store().setSignatureArea('FEED', true)
  store().setModuleSignaturePolicy('FEED-01', undefined)
  useStore.getState().startMotor('FEED-01')
  assert.equal(store().modules['FEED-01'].commanded, true, 'no module policy: immediate write')
  assert.equal(store().signaturePending.length, 0)
}))

test('DV09-080 staged writes are not signature-gated for the signature bypass itself and SFC prompts stage', () => fixture(({ store, alerts }) => {
  useStore.setState({ sfcs: { 'SFC-T101': { name: 'SFC-T101', area: 'FEED', steps: [], transitions: [], status: 'READY', active: 0, elapsed: 0, parameters: {} } } })
  const s = store()
  s.setSignatureApplication({ operate: true })
  s.setSignatureArea('FEED', true)
  s.saveSignaturePolicy({ name: 'MSG', description: '', allowSamePerson: false, parameters: { MESSAGE: 'CONFIRM_VERIFY' } })
  assert.equal(s.setModuleSignaturePolicy('SFC-T101', 'MSG'), true)
  assert.equal(useStore.getState().writeSfcNamedValue('SFC-T101', 'MESSAGE', 1), false)
  assert.equal(store().signaturePending.length, 1, 'the startup request is staged, not written')
  assert.equal(store().signaturePending[0].parameter, 'MESSAGE')
  assert.equal(alerts.length, 0, 'the underlying write has not run yet')
  assert.match(store().submitSignature(store().signaturePending[0].id, { comment: 'startup', confirm: { user: 'admin', password: 'admin123' }, verify: { user: 'OperatorA', password: 'operatora' } }), /Action Verify/)
  assert.equal(store().signaturePending.length, 1, 'denied verification keeps the SFC request staged')
}))

test('DV09-080 configuring signatures requires the Can Configure key and a valid policy reference', () => fixture(({ store }) => {
  assert.equal(store().setModuleSignaturePolicy('FEED-01', 'MISSING'), false)
  assert.equal(store().setModuleSignaturePolicy('NOPE', undefined), false)
  assert.equal(store().setSignatureArea('NOT-AN-AREA', true), false)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.equal(store().setSignatureApplication({ operate: true }), false)
  assert.match(store().saveSignaturePolicy({ name: 'X', description: '', allowSamePerson: false, parameters: { SP: 'CONFIRM' } }), /Can Configure/)
  assert.equal(store().signature.operate, false)
}))

test('DV09-080 signature-gated tuning stages by the tuned parameter names', () => fixture(({ store }) => {
  const s = store()
  s.setSignatureApplication({ operate: true })
  s.setSignatureArea('FEED', true)
  s.saveSignaturePolicy({ name: 'TUNE', description: '', allowSamePerson: false, parameters: { GAIN: 'CONFIRM' } })
  s.setModuleSignaturePolicy('FEED-01', 'TUNE')
  assert.equal(useStore.getState().setTuning('FEED-01', { gain: 2 }), false)
  assert.equal(store().signaturePending[0].parameter, 'GAIN')
  assert.equal(useStore.getState().setTuning('FEED-01', { reset: 5 }), false)
  assert.equal(store().signaturePending.length, 1, 'a RESET-only change is not on the policy and is not staged')
}))

test('DV09-080 evaluateSignature is a pure function over an authenticator', () => {
  const users = {
    a: { password: 'pa', locks: ['CONTROL'] },
    b: { password: 'pb', locks: ['ACTION_VERIFY'] }
  }
  const auth = (name, password) => users[name] && users[name].password === password
    ? { ok: true, user: name, locks: users[name].locks } : { ok: false, reason: 'Name or password is incorrect' }
  const ok = evaluateSignature({ level: 2, allowSamePerson: false }, { comment: 'c', confirm: { user: 'a', password: 'pa' }, verify: { user: 'b', password: 'pb' } }, auth)
  assert.deepEqual(ok, { ok: true, confirmer: 'a', verifier: 'b' })
  assert.equal(evaluateSignature({ level: 1, allowSamePerson: false }, { comment: 'c', confirm: { user: 'a', password: 'pa' } }, auth).ok, true)
  assert.equal(evaluateSignature({ level: 1, allowSamePerson: false }, { comment: '', confirm: { user: 'a', password: 'pa' } }, auth).stage, 'comment')
})
