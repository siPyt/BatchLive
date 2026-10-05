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
const cm = require('../src/renderer/src/engine/commissioning.ts')
const { alarmArea } = require('../src/renderer/src/engine/deviceAlarms.ts')
const { alarmCategory } = require('../src/renderer/src/utils/format.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: (m) => alerts.push(m), localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    run(alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const hw = () => useStore.getState().hardware
const props = (over = {}) => ({ name: 'CTLR-02', description: 'Second node', area: null, hardwareAlarms: false, networkRedundant: false,
  timeSyncIntegrity: false, redundant: false, ...over })
const ctx = (over = {}) => ({ otherControllers: ['CTLR-01'], areas: ['FEED', 'REACTOR'], simplexOnly: false, ...over })
const run = (seconds) => { useStore.setState({ running: true }); for (let i = 0; i < Math.round(seconds / 0.1); i++) useStore.getState().tick(0.1) }
const hwAlarm = (tag, kind) => useStore.getState().alarms.find(a => a.id === cm.hardwareAlarmId(tag, kind))

test('DV09-006 name rules: 1-16 characters, at least one letter, only letters, digits, $, - and _', () => {
  for (const ok of ['A', 'CTLR-02', 'C$1', 'a_b', 'X'.repeat(16), '1A'])
    assert.deepEqual(cm.commissionPropertiesErrors(props({ name: ok }), ctx()), [], ok)
  for (const bad of ['', '   ', '1234', 'X'.repeat(17), 'CTLR 02', 'CTLR.02', 'CTLR/2'])
    assert.ok(cm.commissionPropertiesErrors(props({ name: bad }), ctx()).some(e => /Name must have at most 16/.test(e)), bad)
  assert.ok(cm.commissionPropertiesErrors(props({ name: 'ctlr-01' }), ctx()).some(e => /already exists/.test(e)), 'duplicates ignore case')
})

test('DV09-006 description (255), area and simplex rules are validated together', () => {
  assert.deepEqual(cm.commissionPropertiesErrors(props({ description: 'x'.repeat(255) }), ctx()), [])
  assert.deepEqual(cm.commissionPropertiesErrors(props({ description: 'x'.repeat(256) }), ctx()).map(e => e.slice(0, 21)), ['Description must have'])
  assert.ok(cm.commissionPropertiesErrors(props({ area: 'NOPE' }), ctx()).some(e => /Area NOPE does not exist/.test(e)))
  assert.deepEqual(cm.commissionPropertiesErrors(props({ area: 'FEED' }), ctx()), [])
  assert.ok(cm.commissionPropertiesErrors(props({ redundant: true }), ctx({ simplexOnly: true })).some(e => /simplex/.test(e)))
  assert.equal(cm.commissionPropertiesErrors(props({ name: '', description: 'x'.repeat(300), area: 'NOPE', redundant: true }), ctx({ simplexOnly: true })).length, 4)
})

test('DV09-006 placeholders: validated, unique, key-protected, deletable', () => fixture(() => {
  const s = useStore.getState()
  assert.equal(s.createPlaceholder('SLOT_A', 'Reactor node'), null)
  assert.deepEqual(hw().placeholders.SLOT_A, { name: 'SLOT_A', description: 'Reactor node' })
  for (const [name, text] of [['', /Placeholder name/], ['123', /Placeholder name/], ['slot_a', /placeholder named/], ['CTLR-01', /controller named/]])
    assert.match(s.createPlaceholder(name, ''), text)
  assert.match(s.createPlaceholder('SLOT_B', 'x'.repeat(256)), /at most 255/)
  assert.deepEqual(Object.keys(hw().placeholders), ['SLOT_A'])
  assert.equal(s.deletePlaceholder('NOPE'), 'Placeholder NOPE does not exist')
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CAN_CONFIGURE: 'SYSTEM_ADMIN' } })
  assert.equal(s.createPlaceholder('SLOT_C', ''), 'Requires the Can Configure key')
  assert.equal(s.deletePlaceholder('SLOT_A'), 'Requires the Can Configure key')
  useSecurity.setState({ currentUser: 'admin', lockAssignments: {} })
  assert.equal(s.deletePlaceholder('SLOT_A'), null)
  assert.deepEqual(hw().placeholders, {})
}))

test('DV09-006 the Properties dialog commissions: applies every property, assigns an address, offers the new name', () => fixture(() => {
  const s = useStore.getState()
  assert.equal(s.createController('CTLR-02F896', 'new hardware'), true)
  assert.equal(s.commissionControllerWithProperties('CTLR-02F896', props({ name: 'REACTOR_NODE', description: 'Reactor controller', area: 'REACTOR',
    hardwareAlarms: true, networkRedundant: true, timeSyncIntegrity: true, redundant: true })), null)
  assert.equal(hw().controllers['CTLR-02F896'], undefined, 'the old name is gone')
  const c = hw().controllers.REACTOR_NODE
  assert.equal(c.commissioned, true)
  assert.equal(c.tag, 'REACTOR_NODE')
  assert.equal(c.description, 'Reactor controller')
  assert.equal(c.networkRedundant, true)
  assert.equal(c.hardwareAlarms, true)
  assert.equal(c.timeSyncIntegrity, true)
  assert.equal(c.redundant, true)
  assert.deepEqual([c.primary, c.secondary], ['ACTIVE', 'STANDBY'])
  assert.match(c.controlNetworkAddress, /^\d+\.\d+\.\d+\.\d+$/)
  assert.equal(hw().controllerAreas.REACTOR_NODE, 'REACTOR')
  const log = useStore.getState().eventLog
  assert.ok(log.some(e => e.tag === 'REACTOR_NODE' && /renamed from CTLR-02F896/.test(e.description)))
  assert.ok(log.some(e => e.tag === 'REACTOR_NODE' && /^Controller commissioned and added to the control network at /.test(e.description)))
}))

test('DV09-006 dropping a controller onto a placeholder commissions it under the placeholder name and consumes the slot', () => fixture(() => {
  const s = useStore.getState()
  s.createController('CTLR-02F896', '')
  s.createPlaceholder('SLOT_A', 'Planned reactor node')
  assert.match(s.commissionControllerWithProperties('CTLR-02F896', props(), 'NOPE'), /Placeholder NOPE does not exist/)
  assert.equal(hw().controllers['CTLR-02F896'].commissioned, false)
  assert.equal(s.commissionControllerWithProperties('CTLR-02F896', props({ name: 'IGNORED' }), 'SLOT_A'), null)
  assert.ok(hw().controllers.SLOT_A.commissioned, 'the placeholder name wins over the typed name')
  assert.equal(hw().controllers.IGNORED, undefined)
  assert.deepEqual(hw().placeholders, {})
  assert.ok(useStore.getState().eventLog.some(e => /dropped onto placeholder SLOT_A/.test(e.description)))
}))

test('DV09-006 invalid or impossible commissioning changes nothing and says why', () => fixture(() => {
  const s = useStore.getState()
  s.createController('CTLR-02', '')
  const before = JSON.stringify(hw())
  assert.match(s.commissionControllerWithProperties('CTLR-02', props({ name: '99' })), /Name must have/)
  assert.match(s.commissionControllerWithProperties('CTLR-02', props({ name: 'CTLR-01' })), /already exists/)
  assert.match(s.commissionControllerWithProperties('CTLR-02', props({ area: 'NOPE' })), /Area NOPE/)
  assert.match(s.commissionControllerWithProperties('NOPE', props()), /does not exist/)
  assert.match(s.commissionControllerWithProperties('CTLR-01', props({ name: 'CTLR-01' })), /already commissioned/)
  assert.equal(JSON.stringify(hw()), before)
  assert.ok(useStore.getState().eventLog.some(e => /Commissioning rejected: Name must have/.test(e.description)))
  s.createController('SIMPLEX-1', '', { simplexOnly: true })
  assert.match(s.commissionControllerWithProperties('SIMPLEX-1', props({ name: 'SIMPLEX-1', redundant: true })), /simplex controller cannot/)
  assert.equal(s.commissionControllerWithProperties('SIMPLEX-1', props({ name: 'SIMPLEX-1' })), null)
  assert.equal(hw().controllers['SIMPLEX-1'].simplexOnly, true)
  assert.equal(hw().controllers['SIMPLEX-1'].secondary, 'N/A')
}))

test('DV09-006 a controller already referenced by cards cannot be renamed; keys are required', () => fixture(() => {
  const s = useStore.getState()
  s.createController('CTLR-02', '')
  s.commissionController('CTLR-02')
  assert.equal(s.addTraditionalCard('CTLR-02', 1, 'AI'), true)
  s.decommissionController('CTLR-02')
  const before = JSON.stringify(hw().controllers['CTLR-02'])
  assert.match(s.commissionControllerWithProperties('CTLR-02', props({ name: 'RENAMED' })), /referenced by configuration/)
  assert.equal(hw().controllers.RENAMED, undefined)
  assert.equal(JSON.stringify(hw().controllers['CTLR-02']), before)
  assert.equal(s.commissionControllerWithProperties('CTLR-02', props({ name: 'CTLR-02' })), null, 'its own name is fine')
  s.createController('CTLR-03', '')
  assert.equal(useSecurity.getState().addUser({ name: 'Tech', fullName: 'Tech', password: 'x', locks: ['CAN_CONFIGURE'] }), true)
  useSecurity.setState({ currentUser: 'Tech' })
  assert.equal(s.commissionControllerWithProperties('CTLR-03', props({ name: 'CTLR-03' })), 'Requires the Can Download key')
  assert.equal(hw().controllers['CTLR-03'].commissioned, false)
  useSecurity.setState({ currentUser: 'operator' })
  assert.equal(s.commissionControllerWithProperties('CTLR-03', props({ name: 'CTLR-03' })), 'Requires the Can Configure key')
}))

test('DV09-006 hardware alarms trip only when enabled, belong to the assigned area and clear when the cause ends', () => fixture(() => {
  const s = useStore.getState()
  s.createController('NODE-A', '')
  s.commissionControllerWithProperties('NODE-A', props({ name: 'NODE-A', area: 'REACTOR', hardwareAlarms: true, redundant: true }))
  run(0.3)
  assert.equal(hwAlarm('NODE-A', 'FAILED')?.active ?? false, false)
  s.failController('NODE-A')
  run(0.3)
  assert.equal(hwAlarm('NODE-A', 'STANDBY').active, true, 'losing one leg of a redundant node raises the standby alarm')
  assert.equal(hwAlarm('NODE-A', 'FAILED')?.active ?? false, false)
  s.simulateControllerPowerLoss('NODE-A')
  run(0.3)
  const failed = hwAlarm('NODE-A', 'FAILED')
  assert.equal(failed.active, true)
  assert.equal(failed.priority, 'CRITICAL')
  assert.equal(alarmArea(failed, useStore.getState().modules, hw()), 'REACTOR')
  assert.equal(alarmCategory(failed), 'SYSTEM')
  assert.equal(alarmArea(failed, useStore.getState().modules, { ...hw(), controllerAreas: {} }), undefined)
  s.restoreControllerPower('NODE-A')
  s.setControllerConfiguration('NODE-A', { hardwareAlarms: false })
  run(0.3)
  assert.equal(hwAlarm('NODE-A', 'FAILED'), undefined, 'disabling the switch removes the alarms')
  assert.equal(hwAlarm('NODE-A', 'STANDBY'), undefined)
}))

test('DV09-006 the time-sync integrity alarm needs its own switch and a lost sync', () => fixture(() => {
  const s = useStore.getState()
  s.createController('NODE-B', '')
  s.commissionControllerWithProperties('NODE-B', props({ name: 'NODE-B', timeSyncIntegrity: false, hardwareAlarms: true }))
  assert.equal(s.setControllerTimeSync('NODE-B', false), true)
  run(0.3)
  assert.equal(hwAlarm('NODE-B', 'TIME_SYNC'), undefined, 'integrity switch is off')
  s.setControllerConfiguration('NODE-B', { timeSyncIntegrity: true })
  run(0.3)
  assert.equal(hwAlarm('NODE-B', 'TIME_SYNC').active, true)
  assert.equal(s.setControllerTimeSync('NODE-B', false), false, 'no change is a no-op')
  assert.equal(s.setControllerTimeSync('NODE-B', true), true)
  run(0.3)
  assert.equal(hwAlarm('NODE-B', 'TIME_SYNC').active, false)
  assert.equal(s.setControllerTimeSync('CTLR-NOPE', false), false)
  s.createController('NODE-C', '')
  assert.equal(s.setControllerTimeSync('NODE-C', false), false, 'decommissioned nodes have no time sync to lose')
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { DIAGNOSTIC: 'SYSTEM_ADMIN' } })
  assert.equal(s.setControllerTimeSync('NODE-B', false), false)
}))
