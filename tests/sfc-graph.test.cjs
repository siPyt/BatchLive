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
const { advanceSfcs, sfcStepsError } = require('../src/renderer/src/engine/sfc.ts')
const g = require('../src/renderer/src/engine/sfcGraph.ts')

const NAME = 'GRAPH-TEST'
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.window = { alert: () => {}, localStorage: { getItem: () => null, setItem: () => {} } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('pharma')
    store.createSfc(NAME, 'FEED')
    run(store)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
const step = (id, sp, seconds = 0.2, extra = {}) => ({ id, name: id.toUpperCase(), actions: sp === null ? [] : [{ kind: 'sp', tag: 'FIC-101', value: sp, qualifier: 'N' }],
  transition: { kind: 'timer', seconds }, ...extra })
const base = () => [step('a', 10), step('b', 20), step('c', 30)]
const ok = (r) => { assert.ok(!r.error, r.error); return r.steps }
const err = (r, re) => { assert.match(r.error, re); return r }
const ids = (steps) => steps.map(s => s.id)
const valid = (steps) => assert.equal(sfcStepsError(steps, useStore.getState().modules, { name: NAME, parameters: {}, sets: {} }), null)
const prune = (steps) => steps.map(s => ({ ...s, transition: { kind: 'timer', seconds: 0.2 } }))
/** Run the chart through the real engine; returns the active step ids after every scan. */
function execute(steps, scans, dt = 0.1) {
  const store = useStore.getState()
  store.sfcCommand(NAME, 'reset')
  store.setSfcSteps(NAME, steps)
  store.sfcCommand(NAME, 'run')
  let state = useStore.getState()
  const trace = []
  for (let i = 0; i < scans; i++) {
    const result = advanceSfcs(state, state.modules, dt)
    state = { ...state, ...result }
    const sfc = state.sfcs[NAME]
    trace.push({ status: sfc.status, active: sfc.activeSteps ? Object.keys(sfc.activeSteps).sort() : [sfc.steps[sfc.active]?.id] })
  }
  return trace
}

test('DV09-066 layout: a linear chart is one column of rows and every step is placed exactly once', () => {
  const layout = g.layoutSfc(base())
  assert.deepEqual(base().map(s => [layout.nodes[s.id].row, layout.nodes[s.id].col]), [[0, 0], [1, 0], [2, 0]])
  assert.equal(layout.rows, 3)
  assert.equal(layout.cols, 1)
  assert.deepEqual(layout.edges.map(e => [e.from, e.to, e.kind, e.back]), [['a', 'b', 'sequential', false], ['b', 'c', 'sequential', false]])
  assert.equal(g.layoutSfc([]).rows, 0)
})

test('DV09-066 layout: selective branches take their own column and converge back; back edges are flagged', () => {
  const steps = [step('a', 1, 0.2, { nextStep: 'b', alternatives: [{ condition: { kind: 'timer', seconds: 0.1 }, nextStep: 'x' }] }), step('b', 2, 0.2, { nextStep: 'end' }),
    step('x', 3, 0.2, { nextStep: 'end' }), step('end', 4, 0.2, { nextStep: 'a' })]
  const layout = g.layoutSfc(steps)
  const at = (id) => [layout.nodes[id].row, layout.nodes[id].col]
  assert.deepEqual(at('a'), [0, 0])
  assert.deepEqual(at('b'), [1, 0])
  assert.deepEqual(at('x'), [1, 1], 'the alternative sits beside the primary route')
  assert.deepEqual(at('end'), [2, 0], 'convergence returns to the leftmost incoming column')
  assert.deepEqual(layout.edges.filter(e => e.back).map(e => `${e.from}>${e.to}`), ['end>a'])
  assert.deepEqual(layout.edges.filter(e => e.kind === 'selective').map(e => e.to), ['x'])
})

test('DV09-066 layout: parallel legs sit side by side between the divergence and the convergence', () => fixture(() => {
  const steps = ok(g.makeParallel(base(), 'a', 3))
  const layout = g.layoutSfc(steps)
  const fork = layout.nodes.a
  const legs = steps.find(s => s.id === 'a').parallelNextSteps.map(id => layout.nodes[id])
  assert.deepEqual(legs.map(l => l.row), [1, 1, 1])
  assert.deepEqual(legs.map(l => l.col).sort(), [0, 1, 2])
  const join = steps.find(s => s.joinFrom)
  assert.equal(layout.nodes[join.id].row, 2)
  assert.equal(layout.nodes[join.id].col, fork.col)
  assert.equal(layout.nodes.b.row, 3)
  const seen = new Set(Object.values(layout.nodes).map(n => `${n.row}:${n.col}`))
  assert.equal(seen.size, steps.length, 'no two steps share a cell')
}))

test('DV09-066 analysis reports unreachable steps, dangling references, structural errors and charts that never finish', () => {
  assert.deepEqual(g.analyzeSfcGraph(base()), [])
  const orphan = [step('a', 1, 0.2, { nextStep: null }), step('b', 2)]
  assert.ok(g.analyzeSfcGraph(orphan).some(i => i.severity === 'warning' && /never be reached/.test(i.text) && i.stepId === 'b'))
  const dangling = [step('a', 1, 0.2, { nextStep: 'gone' })]
  assert.ok(g.analyzeSfcGraph(dangling).some(i => i.severity === 'error' && /no longer exists/.test(i.text)))
  const loop = [step('a', 1, 0.2, { nextStep: 'b' }), step('b', 2, 0.2, { nextStep: 'a' })]
  const loopIssues = g.analyzeSfcGraph(loop)
  assert.ok(loopIssues.some(i => /No reachable step terminates/.test(i.text)))
  const bad = [step('a', 1, 0.2, { parallelNextSteps: ['b'] }), step('b', 2)]
  assert.ok(g.analyzeSfcGraph(bad).some(i => i.severity === 'error' && /at least two/.test(i.text)))
  assert.deepEqual(g.analyzeSfcGraph([]), [])
})

test('DV09-064 addStepAfter inserts on the primary route and keeps ordinary charts in their simple stored form', () => fixture(() => {
  const steps = ok(g.addStepAfter(base(), 'a', 'NEW'))
  assert.deepEqual(ids(steps).length, 4)
  assert.equal(steps[1].name, 'NEW')
  assert.ok(steps.every(s => s.nextStep === undefined), 'implicit sequential routing is kept')
  valid(steps)
  assert.deepEqual(g.layoutSfc(steps).edges.map(e => `${e.from}>${e.to}`), [`a>${steps[1].id}`, `${steps[1].id}>b`, 'b>c'])
  const last = ok(g.addStepAfter(base(), 'c', 'END'))
  assert.equal(last[3].name, 'END')
  assert.ok(last.every(s => s.nextStep === undefined))
  err(g.addStepAfter(base(), 'zz', 'x'), /does not exist/)
}))

test('DV09-064 inserting on a looping or explicitly routed step rewires the route and not the array order', () => fixture(() => {
  const looping = [step('a', 1), step('b', 2, 0.2, { nextStep: 'a' })]
  const steps = ok(g.addStepAfter(looping, 'b', 'MID'))
  const edges = g.layoutSfc(steps).edges.map(e => `${e.from}>${e.to}`)
  assert.deepEqual(edges, [`a>b`, `b>${steps[2].id}`, `${steps[2].id}>a`])
  valid(steps)
  const trace = execute(prune(steps), 14)
  assert.ok(trace.every(t => t.status === 'RUNNING'), 'the loop never completes')
  assert.deepEqual([...new Set(trace.map(t => t.active[0]))].sort(), ['a', 'b', steps[2].id].sort())
}))

test('DV09-064 deleting a step reconnects its predecessors, selective routes and join legs behave', () => fixture(() => {
  const steps = ok(g.deleteStepHealing(base(), 'b'))
  assert.deepEqual(ids(steps), ['a', 'c'])
  assert.deepEqual(g.layoutSfc(steps).edges.map(e => `${e.from}>${e.to}`), ['a>c'])
  const withAlt = [step('a', 1, 0.2, { nextStep: 'b', alternatives: [{ condition: { kind: 'timer', seconds: 0.1 }, nextStep: 'x' }] }), step('b', 2, 0.2, { nextStep: null }), step('x', 3, 0.2, { nextStep: 'b' })]
  const healed = ok(g.deleteStepHealing(withAlt, 'x'))
  assert.equal(healed.find(s => s.id === 'a').alternatives?.[0]?.nextStep, 'b')
  const terminal = ok(g.deleteStepHealing([step('a', 1, 0.2, { nextStep: 'b', alternatives: [{ condition: { kind: 'always' }, nextStep: 'x' }] }), step('b', 2, 0.2, { nextStep: null }), step('x', 3, 0.2, { nextStep: null })], 'x'))
  assert.equal(terminal.find(s => s.id === 'a').alternatives, undefined, 'a route to a terminating step disappears with it')
  const first = ok(g.deleteStepHealing(base(), 'a'))
  assert.equal(first[0].id, 'b', 'the successor becomes the initial step')
  err(g.deleteStepHealing([step('a', 1)], 'a'), /at least one step/)
  err(g.deleteStepHealing(base(), 'zz'), /does not exist/)
  const par = ok(g.makeParallel(base(), 'b', 2))
  err(g.deleteStepHealing(par, 'b'), /Remove parallel/)
  err(g.deleteStepHealing(par, par.find(s => s.joinFrom).id), /Remove parallel/)
  err(g.deleteStepHealing(par, par.find(s => s.id === 'b').parallelNextSteps[0]), /last step of a parallel leg/)
}))

test('DV09-066 selective routes: add, execute first-true-wins, reject duplicates, remove', () => fixture(() => {
  const chart = [step('a', 10, 5), step('b', 20, 0.2), step('x', 30, 0.2)]
  const added = ok(g.addSelectiveRoute(chart, 'a', 'x', { kind: 'timer', seconds: 0.2 }))
  const a = added.find(s => s.id === 'a')
  assert.equal(a.nextStep, 'b', 'the primary destination becomes explicit')
  assert.deepEqual(a.alternatives, [{ condition: { kind: 'timer', seconds: 0.2 }, nextStep: 'x' }])
  valid(added)
  const trace = execute(added, 6)
  assert.equal(trace.at(-1).active[0], 'x', 'the alternative fires at 0.2 s long before the 5 s primary transition')
  err(g.addSelectiveRoute(added, 'a', 'x'), /already exists/)
  err(g.addSelectiveRoute(added, 'a', 'b'), /already exists/)
  err(g.addSelectiveRoute(added, 'a', 'a'), /itself/)
  err(g.addSelectiveRoute(added, 'a', 'zz'), /does not exist/)
  err(g.addSelectiveRoute(added, 'zz', 'a'), /does not exist/)
  const removed = ok(g.removeSelectiveRoute(added, 'a', 0))
  assert.equal(removed.find(s => s.id === 'a').alternatives, undefined)
  err(g.removeSelectiveRoute(added, 'a', 3), /does not exist/)
  const converge = ok(g.addSelectiveRoute([step('a', 1, 5), step('b', 2, 0.2, { nextStep: 'end' }), step('x', 3, 0.2, { nextStep: 'end' }), step('end', 4, 0.2)], 'a', 'x'))
  assert.deepEqual(g.layoutSfc(converge).nodes.end.col, 0)
}))

test('DV09-066 primary route: loop back, converge onto a shared step, or terminate', () => fixture(() => {
  const loop = ok(g.setPrimaryRoute(base(), 'c', 'a'))
  assert.equal(loop.find(s => s.id === 'c').nextStep, 'a')
  assert.ok(g.layoutSfc(loop).edges.some(e => e.back && e.from === 'c' && e.to === 'a'))
  valid(loop)
  const trace = execute(prune(loop), 20)
  assert.ok(trace.every(t => t.status === 'RUNNING'))
  const stop = ok(g.setPrimaryRoute(base(), 'a', null))
  assert.equal(stop.find(s => s.id === 'a').nextStep, null)
  assert.equal(execute(prune(stop), 6).at(-1).status, 'COMPLETE')
  assert.equal(ok(g.setPrimaryRoute(base(), 'a', 'b')).find(s => s.id === 'a').nextStep, undefined, 'a route equal to array order is stored implicitly')
  err(g.setPrimaryRoute(base(), 'a', 'zz'), /does not exist/)
  err(g.setPrimaryRoute(base(), 'zz', 'a'), /does not exist/)
}))

test('DV09-066 parallel divergence: structure validates and the engine runs the legs concurrently, joining when all finish', () => fixture(() => {
  const made = ok(g.makeParallel(base(), 'b', 2))
  assert.equal(made.length, 6)
  valid(made)
  const fork = made.find(s => s.id === 'b')
  assert.equal(fork.parallelNextSteps.length, 2)
  assert.equal(fork.nextStep, undefined)
  const join = made.find(s => s.joinFrom)
  assert.equal(join.nextStep, undefined, 'the convergence continues to c by array order')
  assert.deepEqual(join.joinFrom, fork.parallelNextSteps)
  assert.equal(made[made.length - 1].id, 'c')
  const [leg1, leg2] = fork.parallelNextSteps
  const timed = made.map(s => s.id === leg1 ? { ...s, transition: { kind: 'timer', seconds: 0.2 } } : s.id === leg2 ? { ...s, transition: { kind: 'timer', seconds: 0.6 } } : { ...s, transition: { kind: 'timer', seconds: 0.2 } })
  const trace = execute(timed, 40)
  const concurrent = trace.find(t => t.active.includes(leg1) && t.active.includes(leg2))
  assert.ok(concurrent, 'both legs are active at the same time')
  const firstJoin = trace.findIndex(t => t.active.includes(join.id))
  const leg2Last = trace.map(t => t.active.includes(leg2)).lastIndexOf(true)
  assert.ok(firstJoin > leg2Last, 'the join waits for the slower leg')
  assert.equal(trace.at(-1).status, 'COMPLETE')
  err(g.makeParallel(base(), 'a', 1), /2 to 6/)
  err(g.makeParallel(base(), 'a', 7), /2 to 6/)
  err(g.makeParallel(made, 'b', 2), /already part/)
  err(g.makeParallel(base(), 'zz', 2), /does not exist/)
  err(g.makeParallel([step('a', 1, 0.2, { nextStep: 'b', alternatives: [{ condition: { kind: 'always' }, nextStep: 'b2' }] }), step('b', 2), step('b2', 3)], 'a', 2), /selective routes/)
}))

test('DV09-066 a parallel divergence at the end of a chart and one that follows a loop-back keep valid structure', () => fixture(() => {
  const atEnd = ok(g.makeParallel(base(), 'c', 2))
  valid(atEnd)
  assert.equal(atEnd.find(s => s.joinFrom).nextStep === undefined || atEnd.find(s => s.joinFrom).nextStep === null, true)
  assert.equal(execute(prune(atEnd), 30).at(-1).status, 'COMPLETE')
  const loopBack = ok(g.makeParallel(ok(g.setPrimaryRoute(base(), 'c', 'a')), 'b', 2))
  valid(loopBack)
  assert.ok(g.layoutSfc(loopBack).edges.some(e => e.back))
}))

test('DV09-066 legs can be added and the whole parallel structure removed, restoring the original chart', () => fixture(() => {
  const made = ok(g.makeParallel(base(), 'b', 2))
  const three = ok(g.addParallelLeg(made, 'b'))
  valid(three)
  const fork = three.find(s => s.id === 'b')
  assert.equal(fork.parallelNextSteps.length, 3)
  assert.deepEqual(three.find(s => s.joinFrom).joinFrom, fork.parallelNextSteps)
  assert.equal(execute(prune(three), 40).at(-1).status, 'COMPLETE')
  let wide = three
  for (let i = 0; i < 3; i++) wide = ok(g.addParallelLeg(wide, 'b'))
  err(g.addParallelLeg(wide, 'b'), /at most 6/)
  err(g.addParallelLeg(base(), 'a'), /parallel divergence/)
  err(g.addParallelLeg(base(), 'zz'), /does not exist/)
  const collapsed = ok(g.removeParallel(three, 'b'))
  assert.deepEqual(ids(collapsed), ['a', 'b', 'c'])
  assert.equal(collapsed.find(s => s.id === 'b').parallelNextSteps, undefined)
  assert.deepEqual(g.layoutSfc(collapsed).edges.map(e => `${e.from}>${e.to}`), ['a>b', 'b>c'])
  valid(collapsed)
  err(g.removeParallel(base(), 'a'), /parallel divergence/)
  err(g.removeParallel(base(), 'zz'), /does not exist/)
}))

test('DV09-066 inserting a step into a parallel leg updates the join and the chart still executes', () => fixture(() => {
  const made = ok(g.makeParallel(base(), 'a', 2))
  const fork = made.find(s => s.id === 'a')
  const tail = fork.parallelNextSteps[1]
  const grown = ok(g.addStepAfter(made, tail, 'EXTRA'))
  valid(grown)
  const join = grown.find(s => s.joinFrom)
  const extra = grown.find(s => s.name === 'EXTRA')
  assert.ok(join.joinFrom.includes(extra.id) && !join.joinFrom.includes(tail), 'the join now waits for the new last step of that leg')
  assert.equal(execute(prune(grown), 40).at(-1).status, 'COMPLETE')
  err(g.addStepAfter(made, 'a', 'x'), /inside a leg/)
}))

test('DV09-066 the store accepts and persists every edited chart, and an edit that breaks the structure is refused with the engine reason', () => fixture((store) => {
  const steps = ok(g.makeParallel(base(), 'b', 3))
  store.setSfcSteps(NAME, steps)
  assert.equal(useStore.getState().sfcs[NAME].steps.length, steps.length)
  assert.equal(store.checkSfc(NAME), null)
  const broken = steps.map(s => s.id === 'b' ? { ...s, nextStep: 'c' } : s)
  assert.match(sfcStepsError(broken, useStore.getState().modules, { name: NAME, parameters: {}, sets: {} }), /Parallel fork cannot also have sequential/)
  const joinOnly = steps.map(s => s.joinFrom ? { ...s, joinFrom: s.joinFrom.slice(0, 2) } : s)
  assert.match(sfcStepsError(joinOnly, useStore.getState().modules, { name: NAME, parameters: {}, sets: {} }), /Join must list exactly/)
}))
