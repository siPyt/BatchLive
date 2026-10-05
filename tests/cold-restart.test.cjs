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
const { MAX_COLD_RESTART_MINUTES } = require('../src/renderer/src/engine/hardware.ts')
const cr = require('../src/renderer/src/engine/coldRestart.ts')

const MIN = 60_000
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const realNow = Date.now
  let now = 1_000_000_000_000
  Date.now = () => now
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    run({ advance: (ms) => { now += ms } })
  } finally {
    Date.now = realNow
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const ctl = () => useStore.getState().hardware.controllers['CTLR-01']
/** Configure, lose power, wait outageMs, restore; returns the controller afterwards. */
function outage(minutes, outageMs, clock) {
  assert.equal(useStore.getState().setControllerConfiguration('CTLR-01', { coldRestartMinutes: minutes }), true)
  assert.equal(useStore.getState().simulateControllerPowerLoss('CTLR-01'), true)
  clock.advance(outageMs)
  assert.equal(useStore.getState().restoreControllerPower('CTLR-01'), true)
  return ctl()
}

test('DV09-009 the three course selectors map to stored minutes, including the 30 d 23 h 59 min maximum', () => {
  assert.deepEqual(cr.coldRestartFromSelectors('DISABLED', { days: 9, hours: 9, minutes: 9 }), { minutes: 0 })
  assert.deepEqual(cr.coldRestartFromSelectors('ALWAYS_ENABLED', { days: 0, hours: 0, minutes: 0 }), { minutes: MAX_COLD_RESTART_MINUTES })
  assert.equal(MAX_COLD_RESTART_MINUTES, 30 * 1440 + 23 * 60 + 59)
  assert.deepEqual(cr.coldRestartFromSelectors('WITHIN_LIMIT', { days: 0, hours: 0, minutes: 5 }), { minutes: 5 })
  assert.deepEqual(cr.coldRestartFromSelectors('WITHIN_LIMIT', { days: 1, hours: 2, minutes: 3 }), { minutes: 1440 + 120 + 3 })
  assert.deepEqual(cr.coldRestartFromSelectors('WITHIN_LIMIT', { days: 30, hours: 23, minutes: 59 }), { minutes: MAX_COLD_RESTART_MINUTES })
  assert.deepEqual(cr.coldRestartFromSelectors('WITHIN_LIMIT', { days: 0, hours: 0, minutes: 0 }), { minutes: 0 }, 'a time of 0 is Always Disabled')
  for (const [parts, text] of [[{ days: 31, hours: 0, minutes: 0 }, /Days/], [{ days: -1, hours: 0, minutes: 0 }, /Days/],
    [{ days: 0, hours: 24, minutes: 0 }, /Hours/], [{ days: 0, hours: 0, minutes: 60 }, /Minutes/],
    [{ days: 0, hours: 0, minutes: 1.5 }, /Minutes/], [{ days: 0, hours: NaN, minutes: 0 }, /Hours/], [{ days: 30, hours: 23, minutes: 59 + 1 }, /Minutes/]])
    assert.match(cr.coldRestartFromSelectors('WITHIN_LIMIT', parts).error, text)
})

test('DV09-009 stored minutes round-trip to a mode and the d/h/m parts', () => {
  assert.equal(cr.coldRestartMode(0), 'DISABLED')
  assert.equal(cr.coldRestartMode(1), 'WITHIN_LIMIT')
  assert.equal(cr.coldRestartMode(MAX_COLD_RESTART_MINUTES - 1), 'WITHIN_LIMIT')
  assert.equal(cr.coldRestartMode(MAX_COLD_RESTART_MINUTES), 'ALWAYS_ENABLED')
  assert.deepEqual(cr.splitColdRestart(1563), { days: 1, hours: 2, minutes: 3 })
  assert.deepEqual(cr.splitColdRestart(MAX_COLD_RESTART_MINUTES), { days: 30, hours: 23, minutes: 59 })
  for (const m of [0, 1, 5, 59, 60, 1439, 1440, 43199, MAX_COLD_RESTART_MINUTES]) {
    const mode = cr.coldRestartMode(m)
    assert.equal(cr.coldRestartFromSelectors(mode, cr.splitColdRestart(m)).minutes, m)
  }
  assert.equal(cr.describeColdRestart(0), 'Always Disabled')
  assert.equal(cr.describeColdRestart(MAX_COLD_RESTART_MINUTES), 'Always Enabled (maximum time)')
  assert.equal(cr.describeColdRestart(5), 'Within 0 d 0 h 5 min')
  assert.match(cr.describeColdRestart(1), /recommends at least 2 minutes/)
})

test('DV09-009 the decision is inclusive at the limit and exclusive just after it', () => {
  assert.equal(cr.coldRestartDecision(5, 4.999).restart, true)
  assert.equal(cr.coldRestartDecision(5, 5).restart, true)
  assert.equal(cr.coldRestartDecision(5, 5.001).restart, false)
  assert.match(cr.coldRestartDecision(5, 6).reason, /after the cold restart time limit/)
  assert.deepEqual(cr.coldRestartDecision(0, 0), { restart: false, reason: 'Cold restart is Always Disabled' })
  assert.equal(cr.coldRestartDecision(MAX_COLD_RESTART_MINUTES, MAX_COLD_RESTART_MINUTES).restart, true)
  assert.equal(cr.coldRestartDecision(MAX_COLD_RESTART_MINUTES, 100).reason, 'Cold restart is Always Enabled')
  assert.equal(cr.coldRestartDecision(MAX_COLD_RESTART_MINUTES, MAX_COLD_RESTART_MINUTES + 1).restart, false)
})

test('DV09-009 a controller restarts when power returns just below and exactly at the 5-minute limit, not above', () => fixture((clock) => {
  let c = outage(5, 5 * MIN - 1, clock)
  assert.equal(c.commissioned, true)
  assert.equal(c.primary, 'ACTIVE')
  assert.equal(c.lastRestoration.coldRestart, true)
  assert.match(c.lastRestoration.reason, /within the cold restart time limit/)
  c = outage(5, 5 * MIN, clock)
  assert.equal(c.commissioned, true, 'equal to the limit still restarts')
  c = outage(5, 5 * MIN + 1, clock)
  assert.equal(c.commissioned, false, 'just above the limit needs commissioning')
  assert.equal(c.primary, 'N/A')
  assert.equal(c.lastRestoration.coldRestart, false)
  assert.ok(Math.abs(c.lastRestoration.outageMinutes - (5 + 1 / MIN)) < 1e-9)
}))

test('DV09-009 zero never restarts and the maximum restarts after a very long outage', () => fixture((clock) => {
  let c = outage(0, 0, clock)
  assert.equal(c.commissioned, false, 'Always Disabled even with an instant return')
  assert.equal(c.lastRestoration.reason, 'Cold restart is Always Disabled')
  useStore.getState().commissionController('CTLR-01')
  assert.equal(ctl().commissioned, true)
  c = outage(MAX_COLD_RESTART_MINUTES, 30 * 1440 * MIN, clock)
  assert.equal(c.commissioned, true)
  assert.equal(c.lastRestoration.reason, 'Cold restart is Always Enabled')
  c = outage(MAX_COLD_RESTART_MINUTES, MAX_COLD_RESTART_MINUTES * MIN + 1, clock)
  assert.equal(c.commissioned, false, 'even the maximum has an end')
}))

test('DV09-009 the journal records the minutes and the reason; invalid configuration is rejected', () => fixture((clock) => {
  outage(5, 2 * MIN, clock)
  assert.ok(useStore.getState().eventLog.some(e => /Cold restart succeeded after 2\.00 minutes \(Power returned within/.test(e.description)))
  useStore.getState().commissionController('CTLR-01')
  outage(5, 9 * MIN, clock)
  assert.ok(useStore.getState().eventLog.some(e => /Cold restart unavailable after 9\.00 minutes \(Power returned after/.test(e.description)))
  const s = useStore.getState()
  s.commissionController('CTLR-01')
  for (const bad of [-1, MAX_COLD_RESTART_MINUTES + 1, 1.5, NaN])
    assert.equal(s.setControllerConfiguration('CTLR-01', { coldRestartMinutes: bad }), false)
  assert.equal(ctl().coldRestartMinutes, 5)
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { DIAGNOSTIC: 'SYSTEM_ADMIN' } })
  assert.equal(s.simulateControllerPowerLoss('CTLR-01'), false)
  assert.equal(ctl().powerDownAt, null)
}))
