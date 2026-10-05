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
const led = require('../src/renderer/src/engine/controllerLeds.ts')

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
const base = () => ({ ...useStore.getState().hardware.controllers['CTLR-01'] })
const states = (leds) => Object.fromEntries(leds.map(l => [l.id, l.on]))
const dec = () => ({ ...base(), commissioned: false, primary: 'N/A', secondary: 'N/A', identified: false, powerDownAt: null })

test('DV09-005 flashing is one second per cycle: on for the first half-second, off for the second', () => {
  assert.equal(led.flashOn(0), true)
  assert.equal(led.flashOn(499), true)
  assert.equal(led.flashOn(500), false)
  assert.equal(led.flashOn(999), false)
  assert.equal(led.flashOn(1000), true)
  assert.equal(led.flashOn(12_345_000), true)
})

test('DV09-005 a decommissioned controller: Power ON, Error flashes, Active/Standby OFF, yellow LEDs flash at random', () => {
  const c = dec()
  assert.equal(led.indicatorState(c), 'DECOMMISSIONED')
  const on = led.controllerLeds(c, 0)
  assert.equal(on.find(l => l.id === 'power').on, true)
  assert.equal(on.find(l => l.id === 'power').color, 'green')
  assert.equal(on.find(l => l.id === 'error').color, 'red')
  assert.equal(on.find(l => l.id === 'active').on, false)
  assert.equal(on.filter(l => l.color === 'yellow').length, led.YELLOW_LED_COUNT)
  for (const t of [0, 1000, 2000, 5000]) assert.equal(states(led.controllerLeds(c, t)).error, true)
  for (const t of [500, 1500, 2500]) assert.equal(states(led.controllerLeds(c, t)).error, false)
  for (let t = 0; t < 20_000; t += 250) {
    const s = states(led.controllerLeds(c, t))
    assert.equal(s.power, true)
    assert.equal(s.active, false)
  }
  const samples = []
  for (let t = 0; t < 10_000; t += led.RANDOM_SLOT_MS) samples.push(states(led.controllerLeds(c, t)).yellow1)
  assert.ok(samples.some(Boolean) && samples.some(s => !s), 'yellow LED both lights and goes dark')
  assert.notEqual(new Set(samples.map((_, i) => samples.slice(i, i + 4).join())).size, 1, 'not a fixed pattern')
  assert.deepEqual(led.controllerLeds(c, 1234), led.controllerLeds(c, 1234), 'deterministic for the same moment')
  assert.equal(states(led.controllerLeds(c, 1000)).yellow1, states(led.controllerLeds(c, 1100)).yellow1, 'steady inside a slot')
})

test('DV09-005 Identify: Power stays ON and every other LED flashes together at one-second intervals', () => {
  for (const c of [{ ...dec(), identified: true }, { ...base(), identified: true }]) {
    assert.equal(led.indicatorState(c), 'IDENTIFY')
    for (const [t, expected] of [[0, true], [400, true], [500, false], [900, false], [1000, true], [1600, false]]) {
      const s = states(led.controllerLeds(c, t))
      assert.equal(s.power, true)
      for (const id of ['error', 'active', 'yellow1', 'yellow2']) assert.equal(s[id], expected, `${id} at ${t}`)
    }
  }
})

test('DV09-005 running, failed and unpowered controllers use distinct, documented patterns', () => {
  const running = base()
  assert.equal(led.indicatorState(running), 'RUNNING')
  const r = states(led.controllerLeds(running, 0))
  assert.deepEqual([r.power, r.error, r.active], [true, false, true])
  assert.equal(states(led.controllerLeds({ ...running, primary: 'STANDBY' }, 0)).active, false)
  const failed = { ...running, primary: 'FAILED', secondary: 'N/A', redundant: false }
  assert.equal(led.indicatorState(failed), 'FAILED')
  assert.equal(states(led.controllerLeds(failed, 0)).error, true)
  const off = { ...running, powerDownAt: 1 }
  assert.equal(led.indicatorState(off), 'POWER_OFF')
  assert.ok(led.controllerLeds(off, 0).every(l => !l.on))
  assert.match(led.INDICATOR_NOTE.RUNNING, /not described in the course text/)
  assert.match(led.INDICATOR_NOTE.DECOMMISSIONED, /p54/)
  assert.match(led.INDICATOR_NOTE.IDENTIFY, /p56/)
})

test('DV09-005 identify starts and stops on the selected controller only, on decommissioned and commissioned nodes', () => fixture(() => {
  const s = useStore.getState()
  assert.equal(s.createController('CTLR-02', 'Decommissioned spare'), true)
  const one = () => useStore.getState().hardware.controllers['CTLR-01']
  const two = () => useStore.getState().hardware.controllers['CTLR-02']
  assert.equal(two().commissioned, false)
  assert.equal(s.identifyController('CTLR-02', true), true)
  assert.equal(two().identified, true)
  assert.equal(one().identified, false, 'only the selected controller identifies')
  assert.equal(led.indicatorState(two()), 'IDENTIFY')
  assert.equal(s.identifyController('CTLR-01', true), true, 'commissioned controllers can identify too')
  assert.equal(one().identified, true)
  assert.equal(s.identifyController('CTLR-02', false), true)
  assert.equal(two().identified, false)
  assert.equal(one().identified, true)
  assert.equal(led.indicatorState(two()), 'DECOMMISSIONED')
  assert.equal(s.identifyController('NOPE', true), false)
  useStore.getState().identifyController('CTLR-01', false)
}))

test('DV09-005 power loss and commissioning end the Identify state; the Diagnostic key is required', () => fixture(() => {
  const s = useStore.getState()
  const one = () => useStore.getState().hardware.controllers['CTLR-01']
  s.identifyController('CTLR-01', true)
  s.simulateControllerPowerLoss('CTLR-01')
  assert.equal(one().identified, false)
  assert.equal(led.indicatorState(one()), 'POWER_OFF')
  assert.equal(s.identifyController('CTLR-01', true), false, 'no identify while unpowered')
  useStore.getState().restoreControllerPower('CTLR-01')
  s.createController('CTLR-03', 'spare')
  s.identifyController('CTLR-03', true)
  s.commissionController('CTLR-03')
  assert.equal(useStore.getState().hardware.controllers['CTLR-03'].identified, false)
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { DIAGNOSTIC: 'SYSTEM_ADMIN' } })
  assert.equal(s.identifyController('CTLR-01', true), false)
}))
