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
const { advanceSfcs, sfcStepsError, sfcStepElapsed } = require('../src/renderer/src/engine/sfc.ts')
const { cloneSfcConfiguration, parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const NAME = 'PARALLEL-TEST'
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const storage = new Map()
  global.window = { alert: () => {}, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    useStore.getState().newProject('pharma')
    useStore.getState().createSfc(NAME, 'FEED')
    run(useStore.getState())
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function algorithm(loop = false) {
  return [
    { id: 'fork', name: 'FORK', actions: [], transition: { kind: 'always' }, parallelNextSteps: ['a', 'b'] },
    { id: 'a', name: 'LEG_A', actions: [{ kind: 'sp', tag: 'FIC-101', value: 51, qualifier: 'P' }],
      transition: { kind: 'timer', seconds: .2 }, nextStep: 'join' },
    { id: 'b', name: 'LEG_B', actions: [{ kind: 'sp', tag: 'LIC-101', value: 52, qualifier: 'P' }],
      transition: { kind: 'timer', seconds: .5 }, nextStep: 'join' },
    { id: 'join', name: 'JOIN', actions: [{ kind: 'sp', tag: 'TIC-201', value: 53, qualifier: 'P' }],
      transition: { kind: 'always' }, joinFrom: ['a', 'b'], nextStep: loop ? 'fork' : null }
  ]
}
function scan(state, dt = .1) { return { ...state, ...advanceSfcs(state, state.modules, dt) } }
const chart = state => state.sfcs[NAME]
test('fork enters both steps in one scan, independent timers/actions advance and join waits for every predecessor', () => {
  fixture(store => {
    store.setSfcSteps(NAME, algorithm())
    store.sfcCommand(NAME, 'run')
    const initial = useStore.getState()
    let state = scan(initial)
    assert.deepEqual(chart(state).activeSteps, { a: 0, b: 0 })
    assert.equal(state.modules['FIC-101'].sp, 51)
    assert.equal(state.modules['LIC-101'].sp, 52)
    assert.equal(state.modules['TIC-201'].sp, initial.modules['TIC-201'].sp)
    state = scan(state, .2)
    assert.deepEqual(chart(state).activeSteps, { b: .2 })
    assert.deepEqual(chart(state).joinArrivals, { join: ['a'] })
    assert.equal(chart(state).status, 'RUNNING')
    assert.equal(sfcStepElapsed(chart(state), 1), undefined)
    assert.equal(sfcStepElapsed(chart(state), 2), .2)
    state = scan(state, .2)
    assert.deepEqual(chart(state).joinArrivals, { join: ['a'] })
    assert.notEqual(state.modules['TIC-201'].sp, 53)
    state = scan(state, .1)
    assert.deepEqual(chart(state).activeSteps, { join: 0 })
    assert.deepEqual(chart(state).joinArrivals, {})
    assert.equal(state.modules['TIC-201'].sp, 53)
    assert.equal(chart(state).status, 'RUNNING')
    state = scan(state)
    assert.equal(chart(state).status, 'COMPLETE')
    assert.deepEqual(chart(state).activeSteps, {})
    assert.ok(Object.values(chart(state).actionStates).every(action => !action.active && !action.pending))
  })
})
test('join releases once on simultaneous arrivals and loop cycles clear arrival tokens and rearm pulses', () => {
  fixture(store => {
    const steps = algorithm(true)
    steps[1].transition.seconds = .2
    steps[2].transition.seconds = .2
    store.setSfcSteps(NAME, steps)
    store.sfcCommand(NAME, 'run')
    let state = useStore.getState()
    for (let cycle = 0; cycle < 4; cycle++) {
      state = scan(state)
      assert.deepEqual(chart(state).activeSteps, { a: 0, b: 0 })
      assert.equal(state.modules['FIC-101'].sp, 51)
      state = scan(state, .2)
      assert.deepEqual(chart(state).activeSteps, { join: 0 })
      assert.deepEqual(chart(state).joinArrivals, {})
      state = scan(state)
      assert.deepEqual(chart(state).activeSteps, { fork: 0 })
      state.modules['FIC-101'] = { ...state.modules['FIC-101'], sp: 7 }
    }
  })
})
test('an unconfirmed physical condition holds one branch while another waits at join without false completion', () => {
  fixture(store => {
    const steps = algorithm()
    steps[2].actions = []
    steps[2].transition = { kind: 'motorRunning', tag: 'P-101', running: true }
    useStore.setState(state => ({ modules: { ...state.modules, 'P-101': { ...state.modules['P-101'], running: false } } }))
    store.setSfcSteps(NAME, steps)
    store.sfcCommand(NAME, 'run')
    let state = scan(useStore.getState())
    for (let i = 0; i < 20; i++) state = scan(state)
    assert.deepEqual(Object.keys(chart(state).activeSteps), ['b'])
    assert.deepEqual(chart(state).joinArrivals, { join: ['a'] })
    assert.equal(chart(state).status, 'RUNNING')
    assert.notEqual(state.modules['TIC-201'].sp, 53)
    state.modules['P-101'] = { ...state.modules['P-101'], running: true }
    state = scan(state)
    assert.deepEqual(chart(state).activeSteps, { join: 0 })
  })
})
test('HOLD and reset pause/clear all parallel timers, arrivals and action lifetimes', () => {
  fixture(store => {
    store.setSfcSteps(NAME, algorithm())
    store.sfcCommand(NAME, 'run')
    let state = scan(scan(useStore.getState()), .2)
    useStore.setState({ sfcs: state.sfcs })
    store.sfcCommand(NAME, 'hold')
    const held = useStore.getState().sfcs
    assert.equal(advanceSfcs(useStore.getState(), state.modules, 10).sfcs, held)
    store.sfcCommand(NAME, 'run')
    state = scan(useStore.getState(), .3)
    assert.deepEqual(chart(state).activeSteps, { join: 0 })
    useStore.setState({ sfcs: state.sfcs })
    store.sfcCommand(NAME, 'reset')
    assert.equal(chart(useStore.getState()).activeSteps, undefined)
    assert.equal(chart(useStore.getState()).joinArrivals, undefined)
    assert.deepEqual(chart(useStore.getState()).actionStates, {})
    store.sfcCommand(NAME, 'run')
    state = scan(useStore.getState())
    assert.deepEqual(chart(state).activeSteps, { a: 0, b: 0 })
    assert.deepEqual(chart(state).joinArrivals, {})
  })
})
test('stored branch delay keeps one scan clock after branch exit while other branch remains active', () => {
  fixture(store => {
    const steps = algorithm()
    steps[1].actions[0] = { ...steps[1].actions[0], name: 'stored-delay', qualifier: 'SD', seconds: .3 }
    store.setSfcSteps(NAME, steps)
    store.sfcCommand(NAME, 'run')
    let state = scan(useStore.getState())
    const before = state.modules['FIC-101'].sp
    assert.notEqual(before, 51)
    state = scan(state, .2)
    assert.equal(state.modules['FIC-101'].sp, before)
    assert.equal(chart(state).actionStates['stored-delay'].elapsed, .2)
    assert.equal(chart(state).actionStates['stored-delay'].pending, true)
    assert.deepEqual(chart(state).joinArrivals, { join: ['a'] })
    state = scan(state, .1)
    assert.equal(state.modules['FIC-101'].sp, 51)
    assert.equal(chart(state).actionStates['stored-delay'].active, true)
    assert.ok(Math.abs(chart(state).actionStates['stored-delay'].elapsed - .3) < 1e-9)
    state = scan(state, .2)
    assert.deepEqual(chart(state).activeSteps, { join: 0 })
    assert.equal(chart(state).actionStates['stored-delay'].elapsed, .5)
    state = scan(state)
    assert.equal(chart(state).actionStates['stored-delay'].active, false)
  })
})
test('parallel graph rejects malformed forks/joins, cyclic/shared/nested legs and conflicting writes', () => {
  fixture(() => {
    const modules = useStore.getState().modules
    assert.equal(sfcStepsError(algorithm(), modules), null)
    const mutations = [
      s => { s[0].parallelNextSteps = [] },
      s => { s[0].parallelNextSteps = ['a', 'a'] },
      s => { s[0].parallelNextSteps = ['a', 'missing'] },
      s => { s[0].nextStep = 'a' },
      s => { s[3].joinFrom = ['a'] },
      s => { s[3].joinFrom = ['a', 'fork'] },
      s => { s[1].nextStep = null },
      s => { s[1].nextStep = 'a' },
      s => { s[1].nextStep = 'b' },
      s => { s[1].parallelNextSteps = ['b', 'join'] },
      s => { s[2].actions[0].tag = 'FIC-101'; s[2].actions[0].name = 'different-name' },
      s => { s[2].actions[0].name = 'shared'; s[1].actions[0].name = 'shared' },
      s => { delete s[0].parallelNextSteps }
      , s => { s.unshift({ id: 'bypass', name: 'BYPASS', actions: [], transition: { kind: 'always' }, nextStep: 'a' }) }
      , s => { s[3].actions.push({ name: 'stored', kind: 'sp', tag: 'FIC-101', value: 20, qualifier: 'S' }) }
    ]
    for (const mutate of mutations) {
      const steps = algorithm()
      mutate(steps)
      assert.ok(sfcStepsError(steps, modules))
    }
  })
})
test('saved parallel configuration deep-clones lists and rejects malformed schemas and reference edits', () => {
  fixture(() => {
    const modules = useStore.getState().modules
    const configuration = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01', steps: algorithm() }
    const clone = cloneSfcConfiguration(configuration)
    clone.steps[0].parallelNextSteps[0] = 'missing'
    clone.steps[3].joinFrom.push('missing')
    assert.deepEqual(configuration.steps[0].parallelNextSteps, ['a', 'b'])
    assert.deepEqual(configuration.steps[3].joinFrom, ['a', 'b'])
    assert.deepEqual(parseSavedSfc(serializeSavedSfc(configuration), modules).configuration, cloneSfcConfiguration(configuration))
    for (const [key, value] of [['parallelNextSteps', [1, 2]], ['parallelNextSteps', 'a'], ['joinFrom', [false]]]) {
      const malformed = cloneSfcConfiguration(configuration)
      malformed.steps[key === 'joinFrom' ? 3 : 0][key] = value
      assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: malformed }), modules).error)
    }
    assert.ok(parseSavedSfc(serializeSavedSfc(clone), modules).error)
  })
})
test('fork/join Properties commit atomically with stale/locked guards and saved/deployed isolation', () => {
  fixture(store => {
    const steps = algorithm()
    delete steps[0].parallelNextSteps
    delete steps[3].joinFrom
    store.setSfcSteps(NAME, steps)
    store.enableSfcLifecycle(NAME)
    const draft = () => useStore.getState().sfcLifecycle[NAME].draft
    const fork = draft().steps[0]
    const join = draft().steps[3]
    assert.equal(store.applySfcStepProperties(NAME, fork, { parallelNextSteps: ['a', 'b'] },
      [{ expected: join, patch: { joinFrom: ['a', 'b'] } }]), true)
    assert.equal(store.applySfcStepProperties(NAME, fork, { parallelNextSteps: ['a', 'b'] },
      [{ expected: join, patch: { joinFrom: ['a', 'b'] } }]), false)
    assert.equal(store.configureSfcController(NAME, 'CTLR-01'), true)
    assert.equal(store.saveSfc(NAME), true)
    assert.equal(store.downloadSavedSfc(NAME), true)
    const saved = useStore.getState().sfcLifecycle[NAME].saved
    assert.notEqual(saved.steps[0].parallelNextSteps, draft().steps[0].parallelNextSteps)
    assert.equal(store.setSfcOnline(NAME, true), true)
    store.sfcCommand(NAME, 'run')
    store.tick(.1)
    assert.deepEqual(chart(useStore.getState()).activeSteps, { a: 0, b: 0 })
    store.sfcCommand(NAME, 'hold')
    const held = chart(useStore.getState())
    store.tick(2)
    assert.deepEqual(chart(useStore.getState()).activeSteps, held.activeSteps)
    store.sfcCommand(NAME, 'reset')
    store.setSfcOnline(NAME, false)
    const current = draft()
    useSecurity.setState({ locked: true })
    assert.equal(store.applySfcStepProperties(NAME, current.steps[0], { parallelNextSteps: undefined },
      [{ expected: current.steps[3], patch: { joinFrom: undefined } }]), false)
    assert.equal(draft(), current)
    useSecurity.setState({ locked: false })
    assert.equal(store.applySfcStepProperties(NAME, current.steps[0], { parallelNextSteps: undefined },
      [{ expected: current.steps[3], patch: { joinFrom: undefined } }]), true)
    assert.deepEqual(saved.steps[0].parallelNextSteps, ['a', 'b'])
  })
})
test('three unequal multi-step legs retain separate entry clocks and a controller outage freezes all tokens', () => {
  fixture(store => {
    const steps = algorithm()
    steps[0].parallelNextSteps.push('c')
    steps[1].nextStep = 'a2'
    steps[3].joinFrom = ['a2', 'b', 'c']
    steps.push(
      { id: 'a2', name: 'A_SECOND', actions: [], transition: { kind: 'timer', seconds: .2 }, nextStep: 'join' },
      { id: 'c', name: 'LEG_C', actions: [], transition: { kind: 'timer', seconds: .7 }, nextStep: 'join' }
    )
    assert.equal(sfcStepsError(steps, useStore.getState().modules), null)
    store.setSfcSteps(NAME, steps)
    store.enableSfcLifecycle(NAME)
    store.configureSfcController(NAME, 'CTLR-01')
    store.saveSfc(NAME)
    store.downloadSavedSfc(NAME)
    store.setSfcOnline(NAME, true)
    store.sfcCommand(NAME, 'run')
    store.tick(.1)
    assert.deepEqual(chart(useStore.getState()).activeSteps, { a: 0, b: 0, c: 0 })
    store.tick(.2)
    assert.deepEqual(chart(useStore.getState()).activeSteps, { b: .2, c: .2, a2: 0 })
    const frozen = chart(useStore.getState())
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], powerDownAt: 1 } } } })
    store.tick(2)
    assert.deepEqual(chart(useStore.getState()).activeSteps, frozen.activeSteps)
    assert.deepEqual(chart(useStore.getState()).joinArrivals, frozen.joinArrivals)
    useStore.setState({ hardware })
    store.tick(.2)
    assert.deepEqual(chart(useStore.getState()).joinArrivals, { join: ['a2'] })
    store.tick(.1)
    assert.deepEqual(chart(useStore.getState()).joinArrivals, { join: ['a2', 'b'] })
    store.tick(.2)
    assert.deepEqual(chart(useStore.getState()).activeSteps, { join: 0 })
    assert.equal(useStore.getState().modules['TIC-201'].sp, 53)
  })
})
test('a stale related join reference rejects the entire fork patch without overwriting a newer join', () => {
  fixture(store => {
    store.setSfcSteps(NAME, algorithm())
    store.enableSfcLifecycle(NAME)
    const draft = () => useStore.getState().sfcLifecycle[NAME].draft
    const old = draft().steps[3]
    assert.equal(store.applySfcStepProperties(NAME, old, { name: 'NEW_JOIN_NAME' }), true)
    const current = draft()
    assert.equal(store.applySfcStepProperties(NAME, current.steps[0], { transitionDescription: 'must not commit' },
      [{ expected: old, patch: { joinFrom: ['a', 'b'] } }]), false)
    assert.equal(draft(), current)
    assert.equal(draft().steps[3].name, 'NEW_JOIN_NAME')
    assert.equal(draft().steps[0].transitionDescription, undefined)
  })
})
