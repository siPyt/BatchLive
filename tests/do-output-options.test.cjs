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
const tio = require('../src/renderer/src/engine/traditionalIo.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: (m) => alerts.push(m), localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    const s = useStore.getState()
    s.newProject('blank')
    s.createArea('PLANT_AREA_A')
    s.createController('CTLR', 'DO options')
    s.commissionController('CTLR')
    for (const [slot, type] of [[3, 'DI'], [4, 'DO']]) assert.equal(s.addTraditionalCard('CTLR', slot, type), true)
    assert.equal(s.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true }), true)
    assert.equal(s.configureTraditionalChannel('CTLR/C03', 1, { dst: 'LSO-1', enabled: true, tiebackDst: 'XV-1' }), true)
    assert.equal(s.createModule({ tag: 'XV-101', type: 'DO', area: 'PLANT_AREA_A', description: 'Valve' }), true)
    assert.equal(s.bindDiscreteDst('XV-101', 'XV-1'), true)
    run(s, alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const level = () => tio.findDst(useStore.getState().hardware, 'XV-1').channel.value
const trace = (s, scans, dt = 0.1) => { const out = []; for (let i = 0; i < scans; i++) { s.tick(dt); out.push(level()) } return out }
const ON = (n) => Array(n).fill(1)
const OFF = (n) => Array(n).fill(0)

test('DV09-014 option validation: Latching needs no time; Momentary and Pulse need 0.1-3600 s', () => {
  assert.equal(tio.doOptionError({ mode: 'LATCHING', seconds: 0 }), null)
  for (const mode of ['MOMENTARY', 'PULSE']) {
    for (const ok of [0.1, 1, 3600]) assert.equal(tio.doOptionError({ mode, seconds: ok }), null)
    for (const bad of [0, 0.09, 3600.1, NaN, Infinity, -1]) assert.match(tio.doOptionError({ mode, seconds: bad }), /between 0\.1 and 3600 seconds/)
  }
  assert.match(tio.doOptionError({ mode: 'TOGGLE', seconds: 1 }), /Latching, Momentary or Continuous pulse/)
  assert.match(tio.doOptionError({ mode: 'MOMENTARY', seconds: 0 }), /Pulse width/)
  assert.match(tio.doOptionError({ mode: 'PULSE', seconds: 0 }), /Pulse period/)
})

test('DV09-014 Latching (the default) follows the command exactly', () => fixture((s) => {
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 3), ON(3))
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 2), OFF(2))
  assert.equal(tio.driveDigitalOutput({ outputOption: { mode: 'LATCHING', seconds: 5 } }, true, 0.1), 1)
}))

test('DV09-014 Momentary: one fixed-width pulse per rising edge, independent of how long the command stays on', () => fixture((s) => {
  assert.equal(s.configureOutputOption('CTLR/C04', 1, { mode: 'MOMENTARY', seconds: 0.5 }), true)
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 9), [...ON(5), ...OFF(4)], 'high for exactly 0.5 s while the command remains true')
  assert.equal(useStore.getState().modules['XV-101'].commanded, true)
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 2), OFF(2))
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 6), [...ON(5), 0], 'a new rising edge fires a new pulse')
}))

test('DV09-014 a Momentary pulse completes even if the command is withdrawn early', () => fixture((s) => {
  s.configureOutputOption('CTLR/C04', 1, { mode: 'MOMENTARY', seconds: 0.5 })
  s.toggleDO('XV-101')
  const first = trace(s, 2)
  s.toggleDO('XV-101')
  assert.deepEqual([...first, ...trace(s, 5)], [...ON(5), 0, 0])
}))

test('DV09-014 Continuous pulse: 50% duty at the configured period while commanded, stopping when released', () => fixture((s) => {
  assert.equal(s.configureOutputOption('CTLR/C04', 1, { mode: 'PULSE', seconds: 1 }), true)
  assert.deepEqual(trace(s, 3), OFF(3))
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 20), [...ON(5), ...OFF(5), ...ON(5), ...OFF(5)])
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 3), OFF(3))
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 6), [...ON(5), 0], 'the train restarts from a high phase')
}))

test('DV09-014 simulated time scale changes the real duration, not the number of simulated seconds', () => fixture((s) => {
  s.configureOutputOption('CTLR/C04', 1, { mode: 'MOMENTARY', seconds: 1 })
  s.setSpeed(5)
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 3, 0.1), [1, 1, 0], '0.1 s real = 0.5 s simulated: 1 s pulse spans two scans')
}))

test('DV09-014 the DI tieback reads the pulsed output on the following scan', () => fixture((s) => {
  s.configureOutputOption('CTLR/C04', 1, { mode: 'MOMENTARY', seconds: 0.3 })
  s.toggleDO('XV-101')
  const seen = []
  for (let i = 0; i < 6; i++) { s.tick(0.1); seen.push(tio.findDst(useStore.getState().hardware, 'LSO-1').channel.value) }
  assert.deepEqual(seen, [1, 1, 1, 0, 0, 0])
}))

test('DV09-014 rejected, secured and non-DO configuration changes nothing', () => fixture((s, alerts) => {
  assert.equal(s.configureOutputOption('CTLR/C04', 1, { mode: 'PULSE', seconds: 0 }), false)
  assert.equal(s.configureOutputOption('CTLR/C03', 1, { mode: 'MOMENTARY', seconds: 1 }), false, 'DI channels have no output option')
  assert.equal(s.configureOutputOption('CTLR/C04', 9, { mode: 'MOMENTARY', seconds: 1 }), false)
  assert.equal(s.configureOutputOption('NOPE', 1, { mode: 'MOMENTARY', seconds: 1 }), false)
  assert.equal(alerts.length, 4)
  const channel = () => useStore.getState().hardware.traditionalCards['CTLR/C04'].channels[0]
  assert.equal(channel().outputOption, undefined)
  assert.ok(useStore.getState().eventLog.some(e => /Output option rejected: Output options apply only to DO channels/.test(e.description)))
  assert.equal(s.configureOutputOption('CTLR/C04', 1, { mode: 'PULSE', seconds: 2 }), true)
  assert.deepEqual(channel().outputOption, { mode: 'PULSE', seconds: 2 })
  assert.equal(s.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true }), true)
  assert.deepEqual(channel().outputOption, { mode: 'PULSE', seconds: 2 }, 'channel property edits keep the option')
  assert.equal(s.configureOutputOption('CTLR/C04', 1, { mode: 'LATCHING', seconds: 0 }), true)
  assert.equal(channel().outputOption, undefined, 'Latching clears the option')
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CAN_CONFIGURE: 'SYSTEM_ADMIN' } })
  assert.equal(s.configureOutputOption('CTLR/C04', 1, { mode: 'PULSE', seconds: 2 }), false)
  assert.equal(channel().outputOption, undefined)
}))

test('DV09-014 a bad channel (disabled) does not pulse and rearms cleanly', () => fixture((s) => {
  s.configureOutputOption('CTLR/C04', 1, { mode: 'MOMENTARY', seconds: 0.5 })
  s.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: false })
  s.toggleDO('XV-101')
  assert.deepEqual(trace(s, 3), OFF(3))
  s.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true })
  const after = trace(s, 7)
  assert.ok(after.includes(1), 'once the channel is good the pending command pulses')
}))
