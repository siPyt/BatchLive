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
const sched = require('../src/renderer/src/engine/moduleScheduling.ts')
const { stepPlant } = require('../src/renderer/src/engine/simulate.ts')
const { moduleExecutionOrder } = require('../src/renderer/src/engine/fb.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: (m) => alerts.push(m), localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('blank')
    run(alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

/** SRC (MANLD gain 5) -> B (= SRC + 1) -> A (= B + 1); creation order A, B, SRC so dependency order must reorder. */
function chain() {
  const s = useStore.getState()
  for (const tag of ['A', 'B', 'SRC']) assert.equal(s.createModule({ tag, type: 'FB', fbType: 'ADD', area: 'FEED', description: tag }), true)
  const modules = { ...useStore.getState().modules }
  modules.SRC = { ...modules.SRC, fbType: 'MANLD', gain: 5, out: 0 }
  modules.B = { ...modules.B, out: 0, in1: { kind: 'ref', tag: 'SRC', value: 0 }, in2: { kind: 'const', value: 1 } }
  modules.A = { ...modules.A, out: 0, in1: { kind: 'ref', tag: 'B', value: 0 }, in2: { kind: 'const', value: 1 } }
  useStore.setState({ modules })
}
const step = (state, dt = 1) => stepPlant(state, dt)

test('DV09-021 scan multiple accepts whole numbers 1-255 only; execution order 0-9999 or automatic', () => {
  for (const ok of [1, 2, 100, 255]) assert.equal(sched.validateScanMultiple(ok), null)
  for (const bad of [0, 256, -1, 1.5, NaN, Infinity]) assert.match(sched.validateScanMultiple(bad), /from 1 to 255/)
  for (const ok of [null, 0, 1, 9999]) assert.equal(sched.validateExecutionOrder(ok), null)
  for (const bad of [-1, 10000, 2.5, NaN]) assert.match(sched.validateExecutionOrder(bad), /from 0 to 9999/)
})

test('DV09-021 decideScan accumulates elapsed time and integrates over the whole interval', () => {
  let schedule = { multiple: 5, order: null, accum: 0 }
  const runs = []
  for (let i = 1; i <= 10; i++) {
    const d = sched.decideScan(schedule, 1)
    schedule = d.schedule
    if (d.run) runs.push([i, d.dt])
  }
  assert.deepEqual(runs, [[5, 5], [10, 5]])
  assert.equal(sched.decideScan(undefined, 0.1).run, true)
  assert.equal(sched.decideScan({ multiple: 1, order: null, accum: 0 }, 0.1).dt, 0.1)
  const fast = sched.decideScan({ multiple: 2, order: null, accum: 0 }, 2)
  assert.deepEqual([fast.run, fast.dt], [true, 2])
})

test('DV09-021 manual order runs first in ascending order; ties and unordered keep dependency order', () => {
  const dep = ['SRC', 'B', 'A', 'X']
  const out = sched.applyExecutionOrder(dep, { A: { multiple: 1, order: 0, accum: 0 }, B: { multiple: 1, order: 5, accum: 0 }, X: { multiple: 1, order: 5, accum: 0 } })
  assert.deepEqual(out, ['A', 'B', 'X', 'SRC'])
  assert.deepEqual(sched.applyExecutionOrder(dep, {}), dep)
  assert.deepEqual(sched.applyExecutionOrder(dep, { B: { multiple: 3, order: null, accum: 0 } }), dep)
})

test('DV09-021 a module with scan multiple 3 executes once per 3 simulated seconds', () => fixture(() => {
  chain()
  assert.equal(useStore.getState().setModuleSchedule('B', { multiple: 3 }), true)
  let state = useStore.getState()
  assert.deepEqual(moduleExecutionOrder(state.modules).filter(t => ['A', 'B', 'SRC'].includes(t)), ['SRC', 'B', 'A'])
  const bOut = []
  for (let i = 0; i < 6; i++) { state = step(state); bOut.push(state.modules.B.out) }
  assert.deepEqual(bOut, [0, 0, 6, 6, 6, 6])
  assert.equal(state.moduleScheduling.B.accum, 0)
}))

test('DV09-021 the scan period follows simulated time, not wall time (speed 3 runs every real second)', () => fixture(() => {
  chain()
  useStore.getState().setModuleSchedule('B', { multiple: 3 })
  let state = { ...useStore.getState(), speed: 3 }
  state = step(state, 1)
  assert.equal(state.modules.B.out, 6)
}))

test('DV09-021 explicit order makes a consumer read the previous scan value', () => fixture(() => {
  chain()
  let state = useStore.getState()
  state = step(state)
  assert.equal(state.modules.A.out, 7)
  useStore.setState({ ...state })
  assert.equal(useStore.getState().setModuleSchedule('A', { order: 0 }), true)
  useStore.setState({ modules: { ...useStore.getState().modules, A: { ...useStore.getState().modules.A, out: 0 }, B: { ...useStore.getState().modules.B, out: 0 } } })
  state = useStore.getState()
  state = step(state)
  assert.equal(state.modules.B.out, 6)
  assert.equal(state.modules.A.out, 1, 'A ran before B, so it used the previous B (0)')
  state = step(state)
  assert.equal(state.modules.A.out, 7)
}))

test('DV09-021 store action rejects bad values, needs CAN_CONFIGURE, and clears defaults', () => fixture((alerts) => {
  chain()
  const s = useStore.getState()
  assert.equal(s.setModuleSchedule('B', { multiple: 0 }), false)
  assert.equal(s.setModuleSchedule('B', { multiple: 256 }), false)
  assert.equal(s.setModuleSchedule('B', { order: -3 }), false)
  assert.equal(s.setModuleSchedule('NOPE', { multiple: 2 }), false)
  assert.equal(alerts.length, 4)
  assert.deepEqual(useStore.getState().moduleScheduling, {})
  assert.ok(useStore.getState().eventLog.some(e => /Module scan rejected/.test(e.description)))
  assert.equal(s.setModuleSchedule('B', { multiple: 4, order: 2 }), true)
  assert.deepEqual(useStore.getState().moduleScheduling.B, { multiple: 4, order: 2, accum: 0 })
  assert.equal(s.setModuleSchedule('B', { order: null }), true)
  assert.equal(useStore.getState().moduleScheduling.B.multiple, 4)
  assert.equal(s.setModuleSchedule('B', { multiple: 1 }), true)
  assert.deepEqual(useStore.getState().moduleScheduling, {})
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CAN_CONFIGURE: 'SYSTEM_ADMIN' } })
  assert.equal(s.setModuleSchedule('B', { multiple: 2 }), false)
  assert.deepEqual(useStore.getState().moduleScheduling, {})
}))

test('DV09-021 scheduling survives ticks, keeps its reference when unscheduled, resets with a new project and prunes deleted modules', () => fixture(() => {
  chain()
  useStore.setState({ running: true })
  const none = useStore.getState().moduleScheduling
  useStore.getState().tick(0.5)
  assert.equal(useStore.getState().moduleScheduling, none)
  useStore.getState().setModuleSchedule('B', { multiple: 5 })
  useStore.getState().tick(0.5)
  useStore.getState().tick(0.5)
  const accum = useStore.getState().moduleScheduling.B.accum
  assert.ok(Math.abs(accum - 1) < 1e-9, `accum ${accum}`)
  const modules = { ...useStore.getState().modules }
  delete modules.B
  useStore.setState({ modules })
  useStore.getState().tick(0.5)
  assert.deepEqual(useStore.getState().moduleScheduling, {})
  useStore.getState().setModuleSchedule('A', { multiple: 2 })
  useStore.getState().newProject('blank')
  assert.deepEqual(useStore.getState().moduleScheduling, {})
}))
