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

const { buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
const { advanceSfcs, sfcStepsError, makeSampleSfc } = require('../src/renderer/src/engine/sfc.ts')
const { advanceBatch, makeBatch, commandBatch, makeDefaultPhases } = require('../src/renderer/src/engine/batch.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')

function assignment(name, qualifier, seconds) {
  return { kind: 'sp', tag: 'TIC-201', value: 50, name, qualifier, seconds }
}

function fixture(actions, resets = [], duration = 10) {
  return { ...buildInitialPlant(), sfcs: { TEST: { name: 'TEST', area: 'REACTOR', status: 'RUNNING', active: 0, elapsed: 0,
    steps: [
      { id: 'first', name: 'FIRST', actions, transition: { kind: 'timer', seconds: duration } },
      { id: 'second', name: 'SECOND', actions: [], transition: { kind: 'timer', seconds: 10 } },
      { id: 'third', name: 'THIRD', actions: resets.map(name => assignment(name, 'R')),
        transition: { kind: 'timer', seconds: 10 } }
    ] } } }
}

function scan(state, dt = 1) {
  return { ...state, ...advanceSfcs(state, state.modules, dt) }
}

function active(state, name) {
  return state.sfcs.TEST.actionStates[name].active
}

test('DV09 p276 original timing chart: independent N/D/L/P/S/SD/DS/SL lifetimes and reset at step entry', () => {
  const rows = [['N', 'N'], ['D2', 'D', 2], ['D12', 'D', 12], ['L7', 'L', 7], ['L16', 'L', 16],
    ['P0', 'P', 0], ['P4', 'P', 4], ['Sreset', 'S'], ['Sthrough', 'S'],
    ['SD4', 'SD', 4], ['SD14', 'SD', 14], ['DS4', 'DS', 4], ['DS14', 'DS', 14],
    ['SL25', 'SL', 25], ['SL40', 'SL', 40]]
  const actions = rows.map(row => assignment(...row))
  actions.push({ ...assignment('Pexpr', 'P'), timingCondition: { kind: 'motorRunning', tag: 'P-201', running: true } })
  let state = fixture(actions, ['Sreset', 'SD4', 'SD14', 'DS4', 'DS14'])
  state.modules['P-201'] = { ...state.modules['P-201'], running: false }
  state = scan(state, 0)
  assert.equal(active(state, 'P0'), true)
  assert.equal(active(state, 'Sreset'), true)
  const initial = state
  for (let t = 1; t <= 30; t++) {
    if (t === 5) state = { ...state, modules: { ...state.modules, 'P-201': { ...state.modules['P-201'], running: true } } }
    state = scan(state)
    assert.equal(active(state, 'N'), t < 10, `N t${t}`)
    assert.equal(active(state, 'D2'), t >= 2 && t < 10, `D2 t${t}`)
    assert.equal(active(state, 'D12'), false, `D12 t${t}`)
    assert.equal(active(state, 'L7'), t < 7, `L7 t${t}`)
    assert.equal(active(state, 'L16'), t < 10, `L16 t${t}`)
    assert.equal(active(state, 'P0'), false, `P0 t${t}`)
    assert.equal(active(state, 'P4'), t === 4, `P4 t${t}`)
    assert.equal(active(state, 'Pexpr'), t === 5, `Pexpr t${t}`)
    assert.equal(active(state, 'Sreset'), t < 20, `Sreset t${t}`)
    assert.equal(active(state, 'Sthrough'), t < 30, `Sthrough t${t}`)
    assert.equal(active(state, 'SD4'), t >= 4 && t < 20, `SD4 t${t}`)
    assert.equal(active(state, 'SD14'), t >= 14 && t < 20, `SD14 t${t}`)
    assert.equal(active(state, 'DS4'), t >= 4 && t < 20, `DS4 t${t}`)
    assert.equal(active(state, 'DS14'), false, `DS14 t${t}`)
    assert.equal(active(state, 'SL25'), t < 25, `SL25 t${t}`)
    assert.equal(active(state, 'SL40'), t < 30, `SL40 t${t}`)
  }
  assert.equal(state.sfcs.TEST.status, 'COMPLETE')
  assert.equal(initial.sfcs.TEST.actionStates.SD14.elapsed, 0, 'prior runtime snapshot is immutable')
  assert.equal(initial.modules['TIC-201'].sp, 50)
})

test('delayed stored action enters before/at deadline but not after step exit; pending SD resets without firing', () => {
  for (const duration of [3, 4, 5]) {
    let state = scan(fixture([assignment('DS', 'DS', 4)], [], duration), 0)
    for (let i = 0; i < duration; i++) state = scan(state)
    assert.equal(active(state, 'DS'), duration >= 4)
    assert.equal(state.sfcs.TEST.active, 1)
    state = scan(state, 20)
    assert.equal(active(state, 'DS'), duration >= 4)
  }
  let state = scan(fixture([assignment('WAIT', 'SD', 40)], ['WAIT']), 0)
  state = scan(state, 10)
  assert.equal(state.sfcs.TEST.actionStates.WAIT.pending, true)
  state = scan(state, 10)
  assert.equal(state.sfcs.TEST.actionStates.WAIT.pending, false)
  state = scan(state, 5)
  assert.equal(active(state, 'WAIT'), false)
})

test('fractional 100ms scans meet chart deadlines without a floating-point extra scan', () => {
  let state = scan(fixture([
    assignment('N', 'N'), assignment('D2', 'D', 2), assignment('L7', 'L', 7),
    assignment('P4', 'P', 4), assignment('SD14', 'SD', 14), assignment('DS14', 'DS', 14),
    assignment('SL25', 'SL', 25)
  ], ['SD14']), 0)
  for (let i = 1; i <= 300; i++) {
    state = scan(state, 0.1)
    assert.equal(active(state, 'N'), i < 100, `N scan${i}`)
    assert.equal(active(state, 'D2'), i >= 20 && i < 100, `D2 scan${i}`)
    assert.equal(active(state, 'L7'), i < 70, `L7 scan${i}`)
    assert.equal(active(state, 'P4'), i === 40, `P4 scan${i}`)
    assert.equal(active(state, 'SD14'), i >= 140 && i < 200, `SD14 scan${i}`)
    assert.equal(active(state, 'DS14'), false, `DS14 scan${i}`)
    assert.equal(active(state, 'SL25'), i < 250, `SL25 scan${i}`)
  }
  assert.equal(state.sfcs.TEST.status, 'COMPLETE')
})

test('qualifier expiry/reset stops assignments without inventing inverse commands or feedback', () => {
  let state = fixture([{ kind: 'motor', tag: 'P-201', run: false, qualifier: 'L', seconds: 2, name: 'STOP' },
    { kind: 'do', tag: 'HS-201', on: true, qualifier: 'S', name: 'OUTPUT' }], ['OUTPUT'])
  state.modules['P-201'] = { ...state.modules['P-201'], commanded: true }
  state.modules['HS-201'] = { ...state.modules['HS-201'], commanded: false, state: false }
  state = scan(state, 1)
  assert.equal(state.modules['P-201'].commanded, false)
  assert.equal(state.modules['HS-201'].commanded, true)
  assert.equal(state.modules['HS-201'].state, false, 'command cannot fabricate confirmed DO feedback')
  state = scan(state, 1)
  assert.equal(active(state, 'STOP'), false)
  assert.equal(state.modules['P-201'].commanded, false, 'expiring STOP must not START the motor')
  state = scan(state, 8)
  state = scan(state, 10)
  assert.equal(active(state, 'OUTPUT'), false)
  assert.equal(state.modules['HS-201'].commanded, true, 'reset ends action execution, not its previous assignment')
  state.modules['HS-201'] = { ...state.modules['HS-201'], commanded: false }
  state = scan(state, 1)
  assert.equal(state.modules['HS-201'].commanded, false)
})

test('stored/limited timing conditions latch, pulse executes once, and new immediate step actions run on entry', () => {
  let state = fixture([
    { ...assignment('PULSE', 'P'), timingCondition: { kind: 'pv', tag: 'TIC-201', op: '>=', value: 80 } },
    { ...assignment('LIMIT', 'SL'), timingCondition: { kind: 'pv', tag: 'TIC-201', op: '>=', value: 80 } }
  ])
  state.modules['TIC-201'] = { ...state.modules['TIC-201'], pv: 10 }
  state = scan(state)
  assert.equal(active(state, 'LIMIT'), true)
  assert.equal(active(state, 'PULSE'), false)
  state.modules['TIC-201'] = { ...state.modules['TIC-201'], pv: 90 }
  state = scan(state)
  assert.equal(active(state, 'PULSE'), true)
  assert.equal(active(state, 'LIMIT'), false)
  state.modules['TIC-201'] = { ...state.modules['TIC-201'], pv: 10, sp: 30 }
  state = scan(state)
  assert.equal(active(state, 'PULSE'), false)
  assert.equal(active(state, 'LIMIT'), false)
  assert.equal(state.modules['TIC-201'].sp, 30)
  state.sfcs.TEST.steps[1] = { ...state.sfcs.TEST.steps[1], actions: [assignment('ENTRY', 'P', 0)] }
  state = scan(state, 7)
  assert.equal(state.sfcs.TEST.active, 1)
  assert.equal(active(state, 'ENTRY'), true)
})

test('legacy built-in phase assignments use the same qualifier engine without changing stop/start intent', () => {
  const phases = makeDefaultPhases()
  let state = { ...buildInitialPlant(), phases, batch: commandBatch(makeBatch(), 'START', 0, phases) }
  const next = advanceBatch(state, 0.1, 100)
  assert.equal(next.modules['P-101'].commanded, true)
  assert.equal(next.modules['P-201'].commanded, false)
  assert.equal(next.modules['HS-201'].commanded, true)
  assert.equal(sfcStepsError(makeSampleSfc().steps, state.modules), null)
  const steps = fixture([assignment('STORED', 'SD', 4)]).sfcs.TEST.steps
  state = { ...state, phases: { ...phases, CHARGE: { ...phases.CHARGE, steps } } }
  let batch = state.batch
  for (let t = 1; t <= 14; t++) {
    const result = advanceBatch({ ...state, batch }, 1, t * 1000)
    state = { ...state, modules: result.modules }
    batch = result.batch
  }
  assert.equal(batch.phase.step, 1)
  assert.equal(batch.phase.actionStates.STORED.active, true)
  assert.equal(batch.phase.actionStates.STORED.elapsed, 14)
})

test('SFC validation rejects invalid timers, ambiguous identities, wrong types and missing reset targets', () => {
  const modules = buildInitialPlant().modules
  const steps = actions => fixture(actions).sfcs.TEST.steps
  for (const seconds of [-1, NaN, Infinity]) {
    assert.match(sfcStepsError(steps([assignment('DELAY', 'D', seconds)]), modules), /finite and nonnegative/)
  }
  assert.match(sfcStepsError(steps([assignment('SAME', 'S'), assignment('SAME', 'D', 1)]), modules), /Duplicate/)
  assert.match(sfcStepsError(steps([assignment('NOPE', 'R')]), modules), /no stored action/)
  assert.match(sfcStepsError(steps([{ kind: 'motor', tag: 'TIC-201', run: true }]), modules), /type mismatch/)
  assert.match(sfcStepsError(steps([{ ...assignment('A', 'P'), timingCondition: { kind: 'pv', tag: 'NOPE', op: '>', value: 1 } }]), modules), /Missing/)
})

test('operator hold/resume, restart, reset, speed scaling and invalid-run rejection preserve runtime boundaries', () => {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousWindow = global.window
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const f = fixture([assignment('DELAY', 'SD', 4)])
    useStore.setState({ ...f, sfcs: { TEST: { ...f.sfcs.TEST, status: 'READY' } }, running: true, speed: 2 })
    const store = useStore.getState()
    store.sfcCommand('TEST', 'run')
    store.tick(1)
    assert.equal(useStore.getState().sfcs.TEST.actionStates.DELAY.elapsed, 2)
    store.sfcCommand('TEST', 'hold')
    const held = useStore.getState().sfcs.TEST
    store.tick(5)
    assert.equal(useStore.getState().sfcs.TEST, held)
    store.setSfcSteps('TEST', [])
    assert.equal(useStore.getState().sfcs.TEST, held)
    assert.match(alerts.at(-1), /Reset the SFC/)
    store.sfcCommand('TEST', 'run')
    store.tick(1)
    assert.equal(useStore.getState().sfcs.TEST.actionStates.DELAY.active, true)
    store.sfcCommand('TEST', 'reset')
    assert.deepEqual(useStore.getState().sfcs.TEST.actionStates, {})
    store.setSfcSteps('TEST', [{ id: 'done', name: 'DONE', actions: [assignment('PULSE', 'P', 0)], transition: { kind: 'always' } }])
    store.sfcCommand('TEST', 'run')
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs.TEST.status, 'COMPLETE')
    store.sfcCommand('TEST', 'run')
    assert.equal(useStore.getState().sfcs.TEST.active, 0)
    assert.deepEqual(useStore.getState().sfcs.TEST.actionStates, {})
    store.sfcCommand('TEST', 'reset')
    store.setSfcSteps('TEST', [{ id: 'bad', name: 'BAD', actions: [assignment('BAD', 'D', NaN)], transition: { kind: 'always' } }])
    const configured = useStore.getState().sfcs.TEST
    store.sfcCommand('TEST', 'run')
    assert.equal(useStore.getState().sfcs.TEST, configured)
    assert.match(alerts.at(-1), /finite and nonnegative/)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
})

test('SFC DO assignments cannot fabricate bound physical feedback while the output channel is disabled', () => {
  const previousStore = useStore.getState()
  const previousSecurity = useSecurity.getState()
  const previousWindow = global.window
  global.window = { alert: message => { throw Error(`Unexpected alert: ${message}`) } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('blank')
    store.createArea('COURSE')
    store.createController('CTLR', 'SFC actual output fixture')
    store.commissionController('CTLR')
    store.addTraditionalCard('CTLR', 4, 'DO')
    store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true })
    store.createModule({ tag: 'XV-101', type: 'DO', area: 'COURSE', description: 'Confirmed output' })
    store.bindDiscreteDst('XV-101', 'XV-1')
    store.createSfc('COURSE-SFC', 'COURSE')
    store.setSfcSteps('COURSE-SFC', [{ id: 'first', name: 'FIRST',
      actions: [{ kind: 'do', tag: 'XV-101', on: true, name: 'WRITE', qualifier: 'S' }],
      transition: { kind: 'timer', seconds: 10 } }])
    store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: false })
    store.sfcCommand('COURSE-SFC', 'run')
    store.tick(0.1)
    let state = useStore.getState()
    assert.equal(state.sfcs['COURSE-SFC'].actionStates.WRITE.active, true)
    assert.equal(state.modules['XV-101'].commanded, true)
    assert.equal(state.modules['XV-101'].state, false)
    assert.equal(state.modules['XV-101'].ioBad, true)
    assert.equal(state.hardware.traditionalCards['CTLR/C04'].channels[0].value, 0)
    store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true })
    store.tick(0.1)
    state = useStore.getState()
    assert.equal(state.modules['XV-101'].state, true)
    assert.equal(state.modules['XV-101'].ioBad, false)
    assert.equal(state.hardware.traditionalCards['CTLR/C04'].channels[0].value, 1)
  } finally {
    useStore.setState(previousStore, true)
    useSecurity.setState(previousSecurity, true)
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
})
