const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  module._compile(outputText, filename)
}
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { advanceSfcs, sfcStepsError } = require('../src/renderer/src/engine/sfc.ts')
const { parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const NAME = 'ROUTE-TEST'
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const storage = new Map()
  const alerts = []
  global.window = { alert: text => alerts.push(text), localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('pharma')
    store.createSfc(NAME, 'FEED')
    run(store, storage, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function algorithm() {
  return [
    { id: 'hold', name: 'HOLD_SFC', actions: [{ kind: 'sp', tag: 'FIC-101', value: 10, qualifier: 'P' }],
      transition: { kind: 'timer', seconds: 0.2 } },
    { id: 'set', name: 'SET_FLOW_RATE', actions: [{ kind: 'sp', tag: 'FIC-101', value: 50, qualifier: 'P' }],
      transition: { kind: 'timer', seconds: 0.2 }, nextStep: 'hold' }
  ]
}
function scan(state, dt) {
  const result = advanceSfcs(state, state.modules, dt)
  return { ...state, ...result }
}
test('last-step loop returns to initial step and retriggers pulse every cycle without COMPLETE or recursive scan', () => {
  fixture(store => {
    store.setSfcSteps(NAME, algorithm())
    store.sfcCommand(NAME, 'run')
    let state = useStore.getState()
    for (let cycle = 0; cycle < 4; cycle++) {
      state = scan(state, 0.2)
      assert.equal(state.sfcs[NAME].active, 1)
      assert.equal(state.modules['FIC-101'].sp, 50)
      state = scan(state, 0.2)
      assert.equal(state.sfcs[NAME].active, 0)
      assert.equal(state.sfcs[NAME].elapsed, 0)
      assert.equal(state.sfcs[NAME].status, 'RUNNING')
      assert.equal(state.modules['FIC-101'].sp, 10)
    }
  })
})
test('self-loop retriggers delayed pulse and entry reset at each activation with bounded one-transition scans', () => {
  fixture(store => {
    const steps = [{ id: 'self', name: 'SELF', actions: [
      { name: 'delay', kind: 'sp', tag: 'FIC-101', value: 60, qualifier: 'P', seconds: 0.2 }
    ], transition: { kind: 'timer', seconds: 0.3 }, nextStep: 'self' }]
    store.setSfcSteps(NAME, steps)
    store.sfcCommand(NAME, 'run')
    let state = scan(useStore.getState(), 0.3)
    assert.equal(state.sfcs[NAME].status, 'RUNNING')
    assert.equal(state.sfcs[NAME].actionStates.delay.elapsed, 0)
    assert.equal(state.sfcs[NAME].actionStates.delay.fired, false)
    state = { ...state, modules: { ...state.modules, 'FIC-101': { ...state.modules['FIC-101'], sp: 11 } } }
    state = scan(state, 0.1)
    assert.equal(state.modules['FIC-101'].sp, 11)
    state = scan(state, 0.1)
    assert.equal(state.modules['FIC-101'].sp, 60)
    state = scan(state, 0.1)
    assert.equal(state.sfcs[NAME].actionStates.delay.fired, false)
  })
})
test('explicit completion overrides sequential fallthrough while skip target activates only destination actions', () => {
  fixture(store => {
    const steps = algorithm()
    steps[0].nextStep = 'finish'
    steps.push({ id: 'finish', name: 'FINISH', actions: [],
      transition: { kind: 'always' }, nextStep: null })
    store.setSfcSteps(NAME, steps)
    store.sfcCommand(NAME, 'run')
    let state = scan(useStore.getState(), 0.2)
    assert.equal(state.sfcs[NAME].active, 2)
    assert.equal(state.modules['FIC-101'].sp, 10)
    state = scan(state, 0.1)
    assert.equal(state.sfcs[NAME].status, 'COMPLETE')
    assert.ok(Object.values(state.sfcs[NAME].actionStates).every(action => !action.active && !action.pending))
  })
})
test('route validation and saved schema reject deleted/invalid targets and roundtrip loop/termination', () => {
  fixture(() => {
    const modules = useStore.getState().modules
    const config = { name: NAME, area: 'FEED', controllerTag: 'CTLR-01', steps: algorithm() }
    assert.equal(JSON.stringify(parseSavedSfc(serializeSavedSfc(config), modules).configuration), JSON.stringify(config))
    for (const target of ['missing', '', 23, false, {}]) {
      const broken = { ...config, steps: [{ ...config.steps[0], nextStep: target }] }
      assert.ok(sfcStepsError(broken.steps, modules))
      assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: broken }), modules).error)
    }
    config.steps[0].nextStep = null
    assert.equal(parseSavedSfc(serializeSavedSfc(config), modules).configuration.steps[0].nextStep, null)
  })
})
test('saved routing is isolated from draft edits, stale/locked commits reject and HOLD pauses loop timing', () => {
  fixture(store => {
    store.setSfcSteps(NAME, algorithm())
    assert.equal(store.enableSfcLifecycle(NAME), true)
    store.configureSfcController(NAME, 'CTLR-01')
    assert.equal(store.saveSfc(NAME), true)
    assert.equal(store.downloadSavedSfc(NAME), true)
    const original = useStore.getState().sfcLifecycle[NAME].draft.steps[1]
    assert.equal(store.applySfcStepProperties(NAME, original, { nextStep: null }), true)
    const life = useStore.getState().sfcLifecycle[NAME]
    assert.equal(life.draft.steps[1].nextStep, null)
    assert.equal(life.saved.steps[1].nextStep, 'hold')
    assert.equal(life.deployed.steps[1].nextStep, 'hold')
    assert.equal(store.applySfcStepProperties(NAME, original, { nextStep: 'hold' }), false)
    useSecurity.setState({ locked: true })
    assert.equal(store.applySfcStepProperties(NAME, life.draft.steps[1], { nextStep: 'hold' }), false)
    assert.equal(useStore.getState().sfcLifecycle[NAME], life)
    useSecurity.setState({ locked: false })
    store.setSfcOnline(NAME, true)
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    store.sfcCommand(NAME, 'hold')
    const runtime = useStore.getState().sfcs[NAME]
    store.tick(10)
    assert.equal(useStore.getState().sfcs[NAME], runtime)
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 1)
    store.tick(0.2)
    assert.equal(useStore.getState().sfcs[NAME].active, 0)
    assert.equal(useStore.getState().sfcs[NAME].status, 'RUNNING')
  })
})
  test('stored time limit and pending stored delay survive return to their originating step without timer reset', () => {
    fixture(store => {
      store.setSfcSteps(NAME, [{
        id: 'self', name: 'SELF', nextStep: 'self', transition: { kind: 'timer', seconds: 0.2 }, actions: [
          { name: 'limited', kind: 'sp', tag: 'FIC-101', value: 20, qualifier: 'SL', seconds: 0.5 },
          { name: 'delayed', kind: 'out', tag: 'FIC-101', value: 10, qualifier: 'SD', seconds: 0.5 }
        ]
      }])
      store.sfcCommand(NAME, 'run')
      let state = scan(useStore.getState(), 0.2)
      state = scan(state, 0.2)
      assert.equal(state.sfcs[NAME].actionStates.limited.elapsed, 0.4)
      assert.equal(state.sfcs[NAME].actionStates.delayed.elapsed, 0.4)
      state = scan(state, 0.1)
      assert.equal(state.sfcs[NAME].actionStates.limited.active, false)
      assert.equal(state.sfcs[NAME].actionStates.delayed.active, true)
    })
  })

  function selectiveAlgorithm() {
    return [
      { id: 'hold', name: 'HOLD_SFC', actions: [
        { kind: 'namedSet', tag: NAME, parameter: 'MESSAGE', namedSet: 'NS-T101', entry: 'SELECT SEQUENCE', qualifier: 'P' }
      ], transition: { kind: 'namedSet', parameter: 'MESSAGE', namedSet: 'NS-T101', entry: 'STARTUP' }, nextStep: 'start',
      alternatives: [{ condition: { kind: 'namedSet', parameter: 'MESSAGE', namedSet: 'NS-T101', entry: 'SHUTDOWN' }, nextStep: 'stop' }] },
      { id: 'start', name: 'START', actions: [{ kind: 'motor', tag: 'P-101', run: true }],
        transition: { kind: 'motorRunning', tag: 'P-101', running: true }, nextStep: 'end' },
      { id: 'stop', name: 'STOP', actions: [{ kind: 'motor', tag: 'P-101', run: false }],
        transition: { kind: 'motorRunning', tag: 'P-101', running: false }, nextStep: 'end' },
      { id: 'end', name: 'END_SEQUENCE', actions: [], transition: { kind: 'always' }, nextStep: 'hold' }
    ]
  }
  test('Named Set selective startup/shutdown activates one branch, waits for actual feedback and converges to prompt repeatedly', () => {
    fixture(store => {
      store.createNamedSet('NS-T101')
      store.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-T101'], { name: 'NS-T101', description: '', entries: [
        { name: 'STARTUP', value: 1, visible: true, userSelectable: true },
        { name: 'SHUTDOWN', value: 2, visible: true, userSelectable: true },
        { name: 'SELECT SEQUENCE', value: 255, visible: true, userSelectable: false }
      ] })
      store.setSfcSteps(NAME, [{ id: 'hold', name: 'HOLD_SFC', actions: [], transition: { kind: 'always' } }])
      store.enableSfcLifecycle(NAME)
      assert.equal(store.configureSfcParameter(NAME, 'MESSAGE', { type: 'NAMED_SET', namedSet: 'NS-T101', value: 255 },
        useStore.getState().sfcLifecycle[NAME].draft), true)
      store.setSfcSteps(NAME, selectiveAlgorithm())
      store.configureSfcController(NAME, 'CTLR-01')
      store.downloadChangedNamedSets({ kind: 'controller', tag: 'CTLR-01' })
      store.downloadChangedNamedSets({ kind: 'workstation' })
      assert.equal(store.saveSfc(NAME), true)
      assert.equal(store.downloadSavedSfc(NAME), true)
      store.setSfcOnline(NAME, true)
      store.sfcCommand(NAME, 'run')
      store.tick(0.1)
      for (const [value, index, running] of [[1, 1, true], [2, 2, false], [1, 1, true]]) {
        assert.equal(store.writeSfcNamedValue(NAME, 'MESSAGE', value), true)
        const state = useStore.getState()
        const sets = { [NAME]: state.namedSets.deployed['CONTROLLER:CTLR-01'] }
        let result = advanceSfcs(state, state.modules, 0.1, sets)
        assert.equal(result.sfcs[NAME].active, index)
        assert.equal(result.modules['P-101'].commanded, running)
        assert.equal(result.sfcs[NAME].actionStates['P-101/motor'].stepId, running ? 'start' : 'stop')
        let feedback = { ...state, ...result, modules: { ...result.modules,
          'P-101': { ...result.modules['P-101'], running: !running } } }
        result = advanceSfcs(feedback, feedback.modules, 0.1, sets)
        assert.equal(result.sfcs[NAME].active, index)
        feedback = { ...feedback, ...result, modules: { ...result.modules,
          'P-101': { ...result.modules['P-101'], running } } }
        result = advanceSfcs(feedback, feedback.modules, 0.1, sets)
        assert.equal(result.sfcs[NAME].active, 3)
        feedback = { ...feedback, ...result }
        result = advanceSfcs(feedback, feedback.modules, 0.1, sets)
        assert.equal(result.sfcs[NAME].active, 0)
        assert.equal(result.sfcs[NAME].parameters.MESSAGE.value, 255)
        assert.equal(result.sfcs[NAME].status, 'RUNNING')
        useStore.setState(result)
      }
    })
  })
  test('selective branches choose primary then first true alternative; no satisfied condition holds the current step', () => {
    fixture(store => {
      const steps = [
        { id: 'choose', name: 'CHOOSE', actions: [], transition: { kind: 'timer', seconds: 10 }, nextStep: 'primary',
          alternatives: [
            { condition: { kind: 'timer', seconds: 1 }, nextStep: 'alternate' },
            { condition: { kind: 'always' }, nextStep: 'other' }
          ] },
        { id: 'primary', name: 'PRIMARY', actions: [], transition: { kind: 'always' } },
        { id: 'alternate', name: 'ALTERNATE', actions: [], transition: { kind: 'always' } },
        { id: 'other', name: 'OTHER', actions: [], transition: { kind: 'always' } }
      ]
      store.setSfcSteps(NAME, steps)
      store.sfcCommand(NAME, 'run')
      const initial = useStore.getState()
      assert.equal(scan(initial, 10).sfcs[NAME].active, 1)
      assert.equal(scan(initial, 1).sfcs[NAME].active, 2)
      assert.equal(scan(initial, 0.1).sfcs[NAME].active, 3)
      steps[0].alternatives[1].condition = { kind: 'timer', seconds: 20 }
      assert.equal(scan(initial, 0.1).sfcs[NAME].active, 0)
    })
  })
  test('selective configuration deep-clones conditions and rejects malformed branches or deleted destinations', () => {
    fixture(() => {
      const modules = useStore.getState().modules
      const steps = [
        { id: 'first', name: 'FIRST', actions: [], transition: { kind: 'timer', seconds: 2 }, nextStep: 'last',
          alternatives: [{ condition: { kind: 'timer', seconds: 3 }, nextStep: 'first' }] },
        { id: 'last', name: 'LAST', actions: [], transition: { kind: 'always' } }
      ]
      const configuration = { name: NAME, area: 'FEED', controllerTag: '', steps }
      const parsed = parseSavedSfc(serializeSavedSfc(configuration), modules)
      assert.equal(parsed.error, undefined)
      assert.notEqual(parsed.configuration.steps[0].alternatives[0].condition, steps[0].alternatives[0].condition)
      for (const alternatives of [null, {}, [null], [{ nextStep: 'last', condition: { kind: 'unknown' } }],
        [{ nextStep: 'MISSING', condition: { kind: 'always' } }]]) {
        const broken = { ...configuration, steps: [{ ...steps[0], alternatives }, steps[1]] }
        assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: broken }), modules).error)
      }
      assert.ok(sfcStepsError([{ ...steps[0], nextStep: undefined }, steps[1]], modules))
    })
  })
