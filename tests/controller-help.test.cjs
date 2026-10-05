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
const help = require('../src/renderer/src/engine/contextHelp.ts')
const wc = require('../src/renderer/src/engine/workshopChecks.ts')
const { COURSE } = require('../src/renderer/src/engine/workshops.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    run()
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const ctl = (tag) => useStore.getState().hardware.controllers[tag]
const check = () => wc.checkCommissioningWorkshop(useStore.getState().hardware.controllers, useStore.getState().eventLog)
const verdicts = () => Object.fromEntries(check().steps.map(s => [s.id, s.verdict]))
const ALL = new Set(['DIAGNOSTIC', 'CAN_CONFIGURE', 'CAN_DOWNLOAD'])

test('DV09-010 every controller control has contextual help with the manual page and live prerequisites', () => {
  const c = { tag: 'C', commissioned: true, powerDownAt: null, primary: 'ACTIVE', secondary: 'N/A', redundant: false }
  for (const topic of Object.keys(help.CONTROLLER_HELP)) {
    const result = help.helpFor(topic, { controller: c, keys: ALL })
    assert.ok(result.entry.title && result.entry.body.length > 40, topic)
    assert.match(result.entry.source, /^pp?\d/, topic)
    assert.ok(result.prerequisites.length >= 2, topic)
    assert.equal(typeof result.ready, 'boolean')
  }
  assert.match(help.CONTROLLER_HELP.coldRestart.body, /less than or equal/)
  assert.match(help.CONTROLLER_HELP.coldRestart.body, /Always Enabled/)
  assert.match(help.CONTROLLER_HELP.identify.body, /Stop Flashing/)
})

test('DV09-010 prerequisites follow controller state and the keys the user holds', () => {
  const decommissioned = { tag: 'C', commissioned: false, powerDownAt: null, primary: 'N/A', secondary: 'N/A', redundant: false }
  const commission = help.helpFor('commission', { controller: decommissioned, keys: ALL })
  assert.equal(commission.ready, true)
  assert.equal(help.helpFor('commission', { controller: decommissioned, keys: new Set(['CAN_CONFIGURE']) }).ready, false)
  const missing = help.helpFor('commission', { controller: decommissioned, keys: new Set() }).prerequisites.filter(p => !p.met).map(p => p.text)
  assert.deepEqual(missing, ['You hold the Can Configure key', 'You hold the Can Download key'])
  const commissioned = { ...decommissioned, commissioned: true, primary: 'ACTIVE' }
  assert.equal(help.helpFor('commission', { controller: commissioned, keys: ALL }).ready, false)
  assert.equal(help.helpFor('decommission', { controller: commissioned, keys: ALL }).ready, true)
  assert.equal(help.helpFor('autoSense', { controller: decommissioned, keys: ALL }).ready, false)
  assert.equal(help.helpFor('autoSense', { controller: commissioned, keys: ALL }).ready, true)
  const off = { ...commissioned, powerDownAt: 5, primary: 'FAILED' }
  assert.equal(help.helpFor('identify', { controller: off, keys: ALL }).ready, false)
  assert.equal(help.helpFor('powerLoss', { controller: off, keys: ALL }).ready, false)
  assert.equal(help.helpFor('restorePower', { controller: off, keys: ALL }).ready, true)
  assert.equal(help.helpFor('restorePower', { controller: commissioned, keys: ALL }).ready, false)
  assert.equal(help.helpFor('coldRestart', { controller: off, keys: ALL }).ready, false)
  assert.equal(help.helpFor('identify', { controller: commissioned, keys: new Set() }).ready, false)
})

test('DV09-010 the workshop starts unverified and each step turns verified only after its real action', () => fixture(() => {
  const s = useStore.getState()
  let v = verdicts()
  assert.equal(v['dv09-ctlr-1'], 'pending')
  assert.equal(v['dv09-ctlr-6'], 'manual')
  assert.equal(check().steps.length, 6)

  assert.equal(s.createController('CTLR-TRAIN', 'Training controller'), true)
  assert.equal(check().controller, 'CTLR-TRAIN')
  v = verdicts()
  assert.equal(v['dv09-ctlr-1'], 'verified')
  assert.equal(v['dv09-ctlr-2'], 'pending')
  assert.equal(v['dv09-ctlr-3'], 'pending')

  s.identifyController('CTLR-TRAIN', true)
  assert.equal(verdicts()['dv09-ctlr-2'], 'pending', 'identify must also be stopped')
  assert.match(check().steps[1].detail, /stop it/)
  s.identifyController('CTLR-TRAIN', false)
  assert.equal(verdicts()['dv09-ctlr-2'], 'verified')

  assert.equal(s.commissionController('CTLR-TRAIN'), true)
  assert.equal(verdicts()['dv09-ctlr-3'], 'pending', 'commissioned without a redundant control network')
  assert.match(check().steps[2].detail, /Enable Redundant control network/)
  s.decommissionController('CTLR-TRAIN')
  assert.equal(s.setControllerConfiguration('CTLR-TRAIN', { networkRedundant: true }), true)
  assert.equal(s.commissionController('CTLR-TRAIN'), true)
  v = verdicts()
  assert.equal(v['dv09-ctlr-3'], 'verified')
  assert.match(check().steps[2].detail, /Commissioned at .* redundant control network/)
  assert.equal(v['dv09-ctlr-4'], 'pending')

  assert.equal(s.autoSenseController('CTLR-TRAIN'), true)
  assert.equal(verdicts()['dv09-ctlr-4'], 'verified')
  assert.match(check().steps[3].detail, /0 channel/)

  assert.match(check().steps[4].detail, /0 minute/)
  assert.equal(verdicts()['dv09-ctlr-5'], 'pending')
  assert.equal(s.setControllerConfiguration('CTLR-TRAIN', { coldRestartMinutes: 5 }), true)
  v = verdicts()
  assert.equal(v['dv09-ctlr-5'], 'verified')
  assert.equal(v['dv09-ctlr-6'], 'manual', 'a dialog choice cannot be observed')
  assert.equal(Object.values(v).filter(x => x === 'verified').length, 5)
}))

test('DV09-010 evidence is per controller and in order: auto-sense before commissioning does not count', () => fixture(() => {
  const s = useStore.getState()
  s.setControllerConfiguration('CTLR-01', { coldRestartMinutes: 7 })
  s.autoSenseController('CTLR-01')
  let v = check()
  assert.equal(v.controller, 'CTLR-01')
  assert.equal(v.steps.find(x => x.id === 'dv09-ctlr-4').verdict, 'pending', 'no commissioning event precedes it')
  s.decommissionController('CTLR-01')
  s.setControllerConfiguration('CTLR-01', { coldRestartMinutes: 5 })
  s.commissionController('CTLR-01')
  s.autoSenseController('CTLR-01')
  v = check()
  assert.equal(v.steps.find(x => x.id === 'dv09-ctlr-4').verdict, 'verified')
  assert.equal(v.steps.find(x => x.id === 'dv09-ctlr-5').verdict, 'verified')
  assert.equal(v.steps.find(x => x.id === 'dv09-ctlr-1').verdict, 'verified', 'decommissioning counts as the first step')
}))

test('DV09-010 with no controllers there is nothing to verify and the steps say so', () => {
  const none = wc.checkCommissioningWorkshop({}, [])
  assert.equal(none.controller, null)
  assert.ok(none.steps.filter(s => s.verdict === 'pending').every(s => /No controller exists yet/.test(s.detail)))
})

test('DV09-010 the verified step ids match the shipped workshop and the manual workshop steps are unchanged', () => {
  const workshop = COURSE.flatMap(m => m.workshops).find(w => w.id === 'dv09-commissioning')
  assert.deepEqual(workshop.steps.map(s => s.id), [...wc.COMMISSIONING_STEP_IDS])
  assert.match(workshop.steps[4].text, /Cold Restart to 5 minutes/)
})
