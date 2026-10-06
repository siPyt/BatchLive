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
const { advanceSfcs, sfcStepsError, sfcForkStructures, sfcParallelJoin } = require('../src/renderer/src/engine/sfc.ts')
const g = require('../src/renderer/src/engine/sfcGraph.ts')

const NAME = 'NESTED-TEST'
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
const step = (id, tag, value, seconds, extra = {}) => ({
  id, name: id.toUpperCase(),
  actions: tag ? [{ kind: 'sp', tag, value, qualifier: 'N' }] : [],
  transition: { kind: 'timer', seconds }, ...extra
})
const modules = () => useStore.getState().modules
const error = (steps) => sfcStepsError(steps, modules(), { name: NAME, parameters: {}, sets: {} })
const ok = (r) => { assert.ok(!r.error, r.error); return r.steps }
const err = (r, re) => { assert.match(r.error ?? '', re); return r }

/** F forks into leg A and leg X; X is itself a fork into X1/X2 that converge at XJ, then T, then the outer join J. */
function nested() {
  return [
    step('f', null, 0, 0.1, { parallelNextSteps: ['a', 'x'] }),
    step('a', 'FIC-101', 51, 0.5, { nextStep: 'j' }),
    step('x', null, 0, 0.1, { parallelNextSteps: ['x1', 'x2'] }),
    step('x1', 'LIC-101', 52, 0.2, { nextStep: 'xj' }),
    step('x2', 'TIC-201', 53, 0.4, { nextStep: 'xj' }),
    step('xj', null, 0, 0.1, { joinFrom: ['x1', 'x2'], nextStep: 't' }),
    step('t', 'SIC-201', 54, 0.1, { nextStep: 'j' }),
    step('j', null, 0, 0.1, { joinFrom: ['a', 't'], nextStep: null })
  ]
}
/** Fork whose first leg branches selectively and reconverges before its tail. */
function selective() {
  return [
    step('f', null, 0, 0.1, { parallelNextSteps: ['a', 'b'] }),
    step('a', 'FIC-101', 51, 0.9, { nextStep: 'a2', alternatives: [{ condition: { kind: 'timer', seconds: 0.2 }, nextStep: 'a3' }] }),
    step('a2', 'LIC-101', 61, 0.1, { nextStep: 'a4' }),
    step('a3', 'LIC-101', 62, 0.1, { nextStep: 'a4' }),
    step('a4', null, 0, 0.1, { nextStep: 'j' }),
    step('b', 'TIC-201', 53, 0.3, { nextStep: 'j' }),
    step('j', null, 0, 0.1, { joinFrom: ['a4', 'b'], nextStep: null })
  ]
}
function execute(steps, scans, dt = 0.1) {
  const store = useStore.getState()
  store.sfcCommand(NAME, 'reset')
  store.setSfcSteps(NAME, steps)
  useStore.getState().sfcCommand(NAME, 'run')
  let state = useStore.getState()
  const trace = []
  for (let i = 0; i < scans; i++) {
    state = { ...state, ...advanceSfcs(state, state.modules, dt) }
    const sfc = state.sfcs[NAME]
    trace.push({ status: sfc.status, active: Object.keys(sfc.activeSteps ?? {}).sort() })
  }
  return { trace, state }
}
const everActive = (trace, id) => trace.some(entry => entry.active.includes(id))
const firstScan = (trace, id) => trace.findIndex(entry => entry.active.includes(id))

test('DV09-064 a fork may sit inside a parallel leg: structures resolve innermost first', () => fixture(() => {
  assert.equal(error(nested()), null)
  const { forks, error: problem } = sfcForkStructures(nested())
  assert.equal(problem, null)
  const outer = forks.get('f')
  const inner = forks.get('x')
  assert.equal(outer.join, 'j')
  assert.deepEqual([...outer.tails].sort(), ['a', 't'])
  assert.equal(inner.join, 'xj')
  assert.deepEqual([...inner.tails].sort(), ['x1', 'x2'])
  for (const id of ['x', 'x1', 'x2', 'xj', 't']) assert.ok(outer.legs[1].has(id), id)
  assert.ok(!outer.region.has('f') && !outer.region.has('j'))
  assert.equal(sfcParallelJoin(nested(), nested()[0]).id, 'j')
  assert.equal(sfcParallelJoin(nested(), nested()[2]).id, 'xj')
}))

test('DV09-064 nested forks execute: the inner join and the outer join each wait for all their predecessors', () => fixture(() => {
  const { trace } = execute(nested(), 40)
  assert.ok(everActive(trace, 'a') && everActive(trace, 'x1') && everActive(trace, 'x2'))
  const lastLeg = Math.max(trace.findLastIndex(e => e.active.includes('x1')), trace.findLastIndex(e => e.active.includes('x2')))
  assert.ok(firstScan(trace, 'xj') > lastLeg, 'inner join only after both inner legs finish')
  assert.ok(firstScan(trace, 't') > firstScan(trace, 'xj'), 'the leg continues past its inner join')
  const lastA = trace.findLastIndex(e => e.active.includes('a'))
  const lastT = trace.findLastIndex(e => e.active.includes('t'))
  assert.ok(firstScan(trace, 'j') > Math.max(lastA, lastT), 'outer join waits for A and for the whole nested leg')
  assert.ok(trace.some(e => e.active.includes('a') && e.active.includes('x2')), 'outer legs run concurrently')
  assert.equal(trace.at(-1).status, 'COMPLETE')
}))

test('DV09-064 a parallel leg may branch selectively and reconverge before its tail', () => fixture(() => {
  assert.equal(error(selective()), null)
  const { forks } = sfcForkStructures(selective())
  assert.deepEqual(forks.get('f').tails.slice().sort(), ['a4', 'b'])
  const { trace, state } = execute(selective(), 30)
  assert.ok(everActive(trace, 'a3') && !everActive(trace, 'a2'), 'the 0.2 s alternative wins over the 0.9 s primary')
  assert.equal(trace.at(-1).status, 'COMPLETE')
  assert.equal(state.modules['LIC-101'].sp, 62)
}))

test('DV09-064 a retry loop inside a leg is a valid structure', () => fixture(() => {
  const steps = selective()
  steps[3].alternatives = [{ condition: { kind: 'timer', seconds: 5 }, nextStep: 'a' }]
  steps[3].nextStep = 'a4'
  assert.equal(error(steps), null)
}))

test('DV09-064 rejected shapes: leaving the leg, crossing legs, two tails, shared outputs and bad nested joins', () => fixture(() => {
  const crossing = selective(); crossing[3].alternatives = [{ condition: { kind: 'always' }, nextStep: 'b' }]
  assert.match(error(crossing), /disjoint|exactly one|converge|bypass/)
  const leaving = selective(); leaving.unshift(step('pre', null, 0, 0.1, { nextStep: 'f' }))
  leaving[3].alternatives = [{ condition: { kind: 'always' }, nextStep: 'pre' }]
  assert.ok(error(leaving))
  const twoTails = selective(); twoTails[2].nextStep = 'j'; twoTails[6].joinFrom = ['a2', 'a4', 'b']
  assert.match(error(twoTails), /exactly one step|Join must list/)
  const sharedOutput = nested(); sharedOutput[3].actions[0].tag = 'FIC-101'
  assert.match(error(sharedOutput), /same output|share action/)
  const innerToOuter = nested(); innerToOuter[4].nextStep = 'j'; innerToOuter[5].joinFrom = ['x1', 'x2']
  assert.ok(error(innerToOuter))
  const extraIncoming = nested(); extraIncoming[1].alternatives = [{ condition: { kind: 'always' }, nextStep: 'xj' }]
  assert.ok(error(extraIncoming))
  const bypass = nested(); bypass[1].alternatives = [{ condition: { kind: 'always' }, nextStep: 'x1' }]
  assert.ok(error(bypass))
  const loopsToFork = nested(); loopsToFork[6].alternatives = [{ condition: { kind: 'always' }, nextStep: 'f' }]
  assert.ok(error(loopsToFork))
  const sharedJoin = nested(); sharedJoin[5].joinFrom = ['x1', 'x2']; sharedJoin[3].nextStep = 'j'; sharedJoin[4].nextStep = 'j'
  sharedJoin[7].joinFrom = ['a', 'x1', 'x2']
  assert.ok(error(sharedJoin))
}))

test('DV09-064 editor: parallel can be made inside a leg, extended and removed without breaking the outer structure', () => fixture(() => {
  const simple = ok(g.makeParallel([step('a', null, 0, 0.1), step('b', null, 0, 0.1), step('c', null, 0, 0.1)], 'a'))
  const fork = simple.find(s => s.id === 'a')
  const [leg1] = fork.parallelNextSteps
  const outerJoin = simple.find(s => s.joinFrom)
  assert.deepEqual(outerJoin.joinFrom, fork.parallelNextSteps)
  const withInner = ok(g.makeParallel(simple, leg1, 3))
  assert.equal(error(withInner), null)
  const innerFork = withInner.find(s => s.id === leg1)
  assert.equal(innerFork.parallelNextSteps.length, 3)
  const outerAfter = withInner.find(s => s.id === outerJoin.id)
  const innerJoin = withInner.find(s => s.joinFrom?.length === 3)
  assert.ok(outerAfter.joinFrom.includes(innerJoin.id) && !outerAfter.joinFrom.includes(leg1), 'the new inner join became the outer leg tail')
  const structures = sfcForkStructures(withInner).forks
  assert.equal(structures.get(leg1).join, innerJoin.id)
  assert.equal(structures.get('a').join, outerJoin.id)

  const wider = ok(g.addParallelLeg(withInner, leg1))
  assert.equal(wider.find(s => s.id === leg1).parallelNextSteps.length, 4)
  assert.equal(wider.find(s => s.id === innerJoin.id).joinFrom.length, 4)
  assert.equal(wider.find(s => s.id === outerJoin.id).joinFrom.length, 2, 'the outer join is untouched')
  assert.equal(error(wider), null)

  const collapsedInner = ok(g.removeParallel(wider, leg1))
  assert.equal(error(collapsedInner), null)
  assert.ok(collapsedInner.find(s => s.id === outerJoin.id).joinFrom.includes(leg1), 'the collapsed step is the tail again')
  assert.deepEqual(collapsedInner.map(s => s.id).sort(), simple.map(s => s.id).sort())

  const collapsedAll = ok(g.removeParallel(withInner, 'a'))
  assert.equal(error(collapsedAll), null)
  assert.ok(!collapsedAll.some(s => s.joinFrom || s.parallelNextSteps))
  assert.ok(collapsedAll.length < withInner.length)
}))

test('DV09-064 editor: selective routes inside a leg are accepted when they stay in the leg and rejected when they escape', () => fixture(() => {
  const simple = ok(g.makeParallel([step('a', null, 0, 0.1), step('b', null, 0, 0.1), step('c', null, 0, 0.1)], 'a'))
  const [leg1, leg2] = simple.find(s => s.id === 'a').parallelNextSteps
  const longer = ok(g.addStepAfter(simple, leg1, 'EXTRA'))
  const extra = longer.find(s => s.name === 'EXTRA')
  assert.equal(error(longer), null)
  const retry = ok(g.addSelectiveRoute(longer, extra.id, leg1))
  assert.equal(error(retry), null)
  assert.equal(retry.find(s => s.id === extra.id).alternatives.length, 1)
  err(g.addSelectiveRoute(longer, leg1, leg2), /disjoint|exactly one|converge|bypass|reach/)
  err(g.addSelectiveRoute(longer, leg1, 'b'), /reach|disjoint|exactly one|converge|bypass/)
  const run = execute(retry.map(s => s.id === extra.id ? { ...s, alternatives: undefined } : s), 30)
  assert.equal(run.trace.at(-1).status, 'COMPLETE')
}))

test('DV09-064 layout and analysis place every nested step and report no structural error', () => fixture(() => {
  const layout = g.layoutSfc(nested())
  for (const s of nested()) assert.ok(layout.nodes[s.id], s.id)
  assert.equal(g.analyzeSfcGraph(nested()).filter(i => i.severity === 'error').length, 0)
  const cells = new Set(Object.values(layout.nodes).map(n => `${n.row}:${n.col}`))
  assert.equal(cells.size, nested().length, 'no two steps share a cell')
}))
