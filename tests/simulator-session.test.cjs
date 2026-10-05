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
const sim = require('../src/renderer/src/engine/simulatorSession.ts')
const { stepPlant } = require('../src/renderer/src/engine/simulate.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), sim: sim.useSimulator.getState(), window: global.window }
  const local = new Map()
  global.localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)) }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    sim.useSimulator.setState({ nodeMode: 'multi', testMode: 'continuous', nodeUnderTest: null, lastInitialized: null })
    useStore.getState().newProject('pharma')
    run(local)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    sim.useSimulator.setState(before.sim, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

test('DV09-082 time scale accepts 0.1x-20x only and rejects bad values with a diagnostic', () => fixture(() => {
  assert.equal(sim.validateScale(1), null)
  assert.equal(sim.validateScale(0.1), null)
  assert.equal(sim.validateScale(20), null)
  for (const bad of [0, -1, 0.09, 20.1, NaN, Infinity]) assert.match(sim.validateScale(bad), /between 0\.1x and 20x|must be a number/)
  useStore.getState().setSpeed(5)
  assert.equal(useStore.getState().speed, 5)
  useStore.getState().setSpeed(100)
  assert.equal(useStore.getState().speed, 5)
  assert.ok(useStore.getState().eventLog.some(e => e.tag === 'SIMULATOR' && /rejected/.test(e.description)))
}))

test('DV09-082 simulated time advances exactly dt x scale per step', () => fixture(() => {
  for (const speed of [0.5, 1, 2, 10, 20]) {
    const state = { ...useStore.getState(), speed }
    const next = stepPlant(state, 0.5)
    assert.ok(Math.abs((next.time - state.time) - 500 * speed) < 1e-6, `speed ${speed}`)
  }
}))

test('DV09-082 achieved scale is computed from wall and simulated samples', () => {
  assert.equal(sim.achievedScale([]), null)
  assert.equal(sim.achievedScale([{ wallMs: 0, simMs: 0 }]), null)
  assert.equal(sim.achievedScale([{ wallMs: 1000, simMs: 5000 }, { wallMs: 3000, simMs: 15000 }]), 5)
  assert.equal(sim.achievedScale([{ wallMs: 1000, simMs: 0 }, { wallMs: 1000, simMs: 9 }]), null)
})

test('DV09-082 initialize returns the process to its initial conditions and holds the simulation', () => fixture(() => {
  const store = useStore.getState()
  const baseline = { ...store.process }
  useStore.setState({ running: true, process: { ...baseline, reactorLevel: 91, reactorTemp: 140, feedTankLevel: 3 },
    trend: [{ t: 1 }], batch: { ...store.batch, running: true }, time: 5000 })
  const pid = Object.values(useStore.getState().modules).find(m => m.type === 'PID')
  useStore.setState({ modules: { ...useStore.getState().modules, [pid.tag]: { ...pid, _integral: 42 } } })
  assert.equal(useStore.getState().initializeSimulation(), true)
  const after = useStore.getState()
  assert.deepEqual(after.process, baseline)
  assert.equal(after.running, false)
  assert.equal(after.alarms.length, 0)
  assert.equal(after.trend.length, 0)
  assert.equal(after.modules[pid.tag]._integral, 0)
  assert.ok(Object.values(after.sfcs).every(s => s.status === 'READY' && s.active === 0 && s.elapsed === 0))
  assert.equal(sim.useSimulator.getState().lastInitialized.simTime, 5000)
  assert.ok(after.eventLog.some(e => e.tag === 'SIMULATOR' && /Simulation initialized/.test(e.description)))
}))

test('DV09-082 initialize is refused while the CONTROL lock is held by nobody, and changes nothing', () => fixture(() => {
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CONTROL: 'SYSTEM_ADMIN' } })
  const before = useStore.getState().process
  useStore.setState({ process: { ...before, reactorLevel: 77 } })
  assert.equal(useStore.getState().initializeSimulation(), false)
  assert.equal(useStore.getState().process.reactorLevel, 77)
}))

test('DV09-082 a blank project initializes to its own baseline, not the pharma plant', () => fixture(() => {
  useStore.getState().newProject('blank')
  useStore.setState({ process: { ...useStore.getState().process, reactorLevel: 66 } })
  useStore.getState().initializeSimulation()
  assert.equal(useStore.getState().process.reactorLevel, 0)
}))

test('DV09-082 node mode and test mode persist and single-node needs a node', () => fixture((local) => {
  const s = sim.useSimulator.getState()
  assert.match(s.setNodeMode('single'), /Choose the controller/)
  assert.equal(sim.useSimulator.getState().nodeMode, 'multi')
  const node = Object.keys(useStore.getState().hardware.controllers)[0]
  assert.equal(s.setNodeMode('single', node), null)
  s.setTestMode('batch')
  const saved = JSON.parse(local.get('batchlive.simulator.v1'))
  assert.equal(saved.nodeMode, 'single')
  assert.equal(saved.nodeUnderTest, node)
  assert.equal(saved.testMode, 'batch')
  sim.useSimulator.setState({ nodeMode: 'multi', testMode: 'continuous', nodeUnderTest: null })
  sim.useSimulator.getState().reload()
  assert.equal(sim.useSimulator.getState().nodeMode, 'single')
  s.setNodeMode('multi')
  assert.equal(sim.useSimulator.getState().nodeUnderTest, null)
}))

test('DV09-082 readiness reports node scope, undownloaded modules and missing batch procedures', () => fixture(() => {
  const state = useStore.getState()
  const tags = Object.keys(state.hardware.controllers)
  assert.ok(tags.length >= 1)
  const multi = sim.nodeStatuses(state.hardware, { nodeMode: 'multi', nodeUnderTest: null })
  assert.equal(multi.length, tags.length)
  if (tags.length > 1) {
    const single = sim.nodeStatuses(state.hardware, { nodeMode: 'single', nodeUnderTest: tags[0] })
    assert.equal(single.filter(n => n.executing).length <= 1, true)
    assert.ok(single.filter(n => n.tag !== tags[0]).every(n => n.reason === 'Not the node under test'))
  }
  const ok = sim.testReadiness(state, { nodeMode: 'multi', testMode: 'batch', nodeUnderTest: null })
  assert.ok(!ok.some(i => i.severity === 'blocking' && /SFC/.test(i.text)))
  const noSfc = sim.testReadiness({ ...state, sfcs: {} }, { nodeMode: 'multi', testMode: 'batch', nodeUnderTest: null })
  assert.ok(noSfc.some(i => i.severity === 'blocking' && /SFC/.test(i.text)))
  const gone = sim.testReadiness(state, { nodeMode: 'single', testMode: 'continuous', nodeUnderTest: 'NOPE' })
  assert.ok(gone.some(i => /no longer exists/.test(i.text)))
  const hw = { ...state.hardware, controllers: Object.fromEntries(tags.map(t => [t, { ...state.hardware.controllers[t], commissioned: false }])) }
  assert.ok(sim.testReadiness({ ...state, hardware: hw }, { nodeMode: 'multi', testMode: 'continuous', nodeUnderTest: null })
    .some(i => i.severity === 'blocking' && /No controller node is executing/.test(i.text)))
}))

test('DV09-082 the disclosure separates BatchLive from vendor Simulate', () => {
  assert.match(sim.SIMULATOR_DISCLOSURE, /not DeltaV Simulate/)
  assert.match(sim.SIMULATOR_DISCLOSURE, /PPN\/PSN\/ASN\/PRO/)
})
