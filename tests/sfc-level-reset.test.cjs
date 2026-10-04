const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useStore, sfcExpressionContext } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { applyAction, advanceSfcs, describeAction, evalCondition, sfcStepsError } = require('../src/renderer/src/engine/sfc.ts')
const { parseSfcAssignment, parseSfcCondition, assignmentExpression } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { cloneSfcConfiguration, parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const { pictureNamedSignal } = require('../src/renderer/src/engine/pictureNamedSets.ts')
const NAME = 'LEVEL-SFC'
const MOTOR = 'MTR-102'
const LEVEL = 'LI-101'
const reset = (value = true) => ({ kind: 'deviceReset', tag: MOTOR, reset: value })
const element = { type: 'datalink', tag: NAME, path: 'MESSAGE.CV', entry: { method: 'NAMED_SET' } }
const chart = () => useStore.getState().sfcs[NAME]
const motor = () => useStore.getState().modules[MOTOR]
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
    store.newProject('blank')
    useStore.setState({ running: true })
    store.createController('CTLR', 'Level/reset test')
    store.commissionController('CTLR')
    assert.equal(store.addTraditionalCard('CTLR', 1, 'AI'), true)
    assert.equal(store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'LT-1', enabled: true }), true)
    for (const [tag, type] of [[LEVEL, 'AI'], [MOTOR, 'MOTOR'], ['V-RESET', 'VALVE'], ['TEST-PID', 'PID'], ['TEST-AO', 'AO']]) {
      assert.equal(store.createModule({ tag, type, area: 'FEED', description: 'Level/reset test',
        pvMin: 0, pvMax: 1000, unit: 'gal' }), true)
    }
    store.bindAnalogDst(LEVEL, 'input', 'LT-1')
    store.setTraditionalInput('LT-1', 0)
    store.tick(.1)
    useStore.setState({ modules: { ...useStore.getState().modules,
      [MOTOR]: { ...motor(), locked: true, resetRequired: true, permissiveRequired: true,
        permissiveOk: true, dcState: 'LOCKED', confirmTimeSec: 1 } } })
    run(store, storage, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function value(result) {
  assert.equal(result.error, undefined, result.error)
  return result.value
}
function configure(store) {
  store.createNamedSet('NS-LEVEL')
  assert.equal(store.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-LEVEL'], {
    name: 'NS-LEVEL', description: 'Operator wait feedback', entries: [
      { name: 'STARTUP', value: 1, visible: true, userSelectable: true },
      { name: 'WAIT LEVEL', value: 10, visible: true, userSelectable: false },
      { name: 'WAIT MOTOR', value: 11, visible: true, userSelectable: false },
      { name: 'READY', value: 12, visible: true, userSelectable: false },
      { name: 'SELECT SEQUENCE', value: 255, visible: true, userSelectable: false }
    ]
  }), true)
  store.createSfc(NAME, 'FEED', { managed: true })
  assert.equal(store.configureSfcParameter(NAME, 'MESSAGE', {
    type: 'NAMED_SET', namedSet: 'NS-LEVEL', value: 255
  }, useStore.getState().sfcLifecycle[NAME].draft), true)
  const context = sfcExpressionContext(useStore.getState(), NAME)
  const assignment = text => value(parseSfcAssignment(text, useStore.getState().modules, context))
  const condition = text => value(parseSfcCondition(text, useStore.getState().modules, context))
  const message = entry => ({ ...assignment(`'MESSAGE' := 'NS-LEVEL:${entry}'`), qualifier: 'P', seconds: 0 })
  store.setSfcSteps(NAME, [
    { id: 'select', name: 'SELECT', actions: [message('SELECT SEQUENCE')],
      transition: condition("'MESSAGE' = 'NS-LEVEL:STARTUP'") },
    { id: 'level', name: 'CHECK LEVEL', actions: [message('WAIT LEVEL')],
      transition: condition("'^/LI-101/AI1/PV.CV' > 100") },
    { id: 'reset', name: 'RESET LOCK', actions: [
      { ...assignment("'^/MTR-102/DC1/RESET_D.CV' := 1"), qualifier: 'P', seconds: 0 }
    ], transition: { kind: 'always' } },
    { id: 'motor', name: 'CONFIRM MOTOR', actions: [
      message('WAIT MOTOR'), assignment("'^/MTR-102/DC1/OUT_D.CV' := 1")
    ], transition: condition("'^/MTR-102/DC1/PV_D.CV' = 1") },
    { id: 'done', name: 'CONFIRMED', actions: [message('READY')],
      transition: { kind: 'always' }, nextStep: 'select' }
  ])
  assert.equal(store.checkSfc(NAME), null)
  assert.equal(store.configureSfcController(NAME, 'CTLR'), true)
  assert.equal(store.saveSfc(NAME), true)
  assert.equal(store.downloadChangedNamedSets({ kind: 'controller', tag: 'CTLR' }), true)
  assert.equal(store.downloadChangedNamedSets({ kind: 'workstation' }), true)
  assert.equal(store.downloadSavedSfc(NAME), true)
  assert.equal(motor().locked, true)
  assert.equal(store.setSfcOnline(NAME, true), true)
}
function start(store) {
  store.sfcCommand(NAME, 'run')
  store.tick(.1)
  assert.equal(store.writeSfcNamedValue(NAME, 'MESSAGE', 1), true)
  store.tick(.1)
  assert.equal(chart().active, 1)
}
function setLevel(store, level) {
  assert.equal(store.setTraditionalInput('LT-1', level), true)
  store.tick(.1)
}
test('native RESET_D assignments roundtrip for motors/valves and reject unsupported paths and literals', () => {
  fixture(() => {
    const modules = useStore.getState().modules
    for (const tag of [MOTOR, 'V-RESET']) for (const request of [0, 1]) {
      const expression = `'^/${tag}/DC1/RESET_D.CV' := ${request}`
      const action = value(parseSfcAssignment(expression, modules))
      assert.deepEqual(action, { kind: 'deviceReset', tag, reset: request === 1 })
      assert.equal(assignmentExpression(action, modules[tag]), expression)
      assert.match(describeAction(action), /DC1\/RESET_D.CV :=/)
    }
    for (const expression of [
      "'^/MTR-102/DC1/RESET.CV' := 1", "'^/MTR-102/DC1/RESET_D.CV' := 2",
      "'^/MTR-102/DC1/RESET_D.CV' := TRUE", "'^/LI-101/DC1/RESET_D.CV' := 1",
      "'^/MISSING/DC1/RESET_D.CV' := 1", "'^/MTR-102/DC1/RESET_D.CV' := NaN"
    ]) assert.ok(parseSfcAssignment(expression, modules).error, expression)
  })
})
test('reset schema/clones preserve Boolean requests and reject wrong module/value without accepting a fake download', () => {
  fixture(() => {
    const modules = useStore.getState().modules
    const configuration = { name: NAME, area: 'FEED', controllerTag: 'CTLR', steps: [
      { id: 'reset', name: 'RESET', actions: [reset()], transition: { kind: 'always' } }
    ] }
    const copy = cloneSfcConfiguration(configuration)
    assert.notEqual(copy.steps[0].actions[0], configuration.steps[0].actions[0])
    assert.equal(parseSavedSfc(serializeSavedSfc(configuration), modules).error, undefined)
    for (const action of [{ ...reset(), reset: 1 }, { ...reset(), tag: LEVEL }, { ...reset(), tag: 'MISSING' }]) {
      const invalid = { ...configuration, steps: [{ ...configuration.steps[0], actions: [action] }] }
      assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: invalid }), modules).error)
      assert.ok(sfcStepsError(invalid.steps, modules))
    }
  })
})
test('RESET_D clears only the latch; zero/idempotent requests cannot start or overwrite safety state', () => {
  fixture(() => {
    const before = { ...motor(), interlock: true, fault: true, permissiveOk: false }
    const unchanged = { ...before }
    applyAction(unchanged, reset(false))
    assert.deepEqual(unchanged, before)
    const changed = { ...before }
    applyAction(changed, reset())
    assert.deepEqual(changed, { ...before, locked: false })
    applyAction(changed, reset())
    assert.deepEqual(changed, { ...before, locked: false })
  })
})
test('operator reset and qualified reset reuse the same real device-latch operation', () => {
  fixture(store => {
    const expected = { ...motor() }
    applyAction(expected, reset())
    store.resetDevice(MOTOR)
    assert.deepEqual(motor(), expected)
    assert.ok(useStore.getState().eventLog.some(event => event.tag === MOTOR && event.description.includes('RESET_D')))
  })
})
test('level transitions reject held Bad/nonfinite analog values and AO Out of Service, rather than opening startup', () => {
  fixture(() => {
    const state = useStore.getState()
    for (const tag of [LEVEL, 'TEST-PID', 'TEST-AO']) {
      const condition = { kind: 'pv', tag, op: '>', value: 100 }
      const source = state.modules[tag]
      const evaluate = patch => evalCondition(condition, { ...state, modules: { ...state.modules,
        [tag]: { ...source, pv: 150, pvBad: false, bad: false, actualMode: 'AUTO', ...patch } } }, 0)
      assert.equal(evaluate({}), true)
      assert.equal(evaluate({ pv: 100 }), false)
      assert.equal(evaluate({ pv: NaN }), false)
      assert.equal(evaluate({ pv: Infinity }), false)
      assert.equal(evaluate(source.type === 'AO' ? { bad: true } : { pvBad: true }), false)
      if (source.type === 'AO') assert.equal(evaluate({ actualMode: 'OOS' }), false)
    }
  })
})
test('saved startup waits at the configured level, resets the lock, confirms the real motor and publishes wait MESSAGE states', () => {
  fixture(store => {
    configure(store)
    start(store)
    setLevel(store, 100)
    store.tick(.1)
    assert.equal(chart().active, 1)
    assert.equal(motor().locked, true)
    assert.equal(motor().commanded, false)
    assert.equal(pictureNamedSignal(element, useStore.getState()).text, 'WAIT LEVEL')
    setLevel(store, 150)
    store.tick(.1)
    assert.equal(chart().active, 2)
    assert.equal(motor().locked, false)
    assert.equal(motor().commanded, false)
    store.tick(.1)
    assert.equal(chart().active, 3)
    assert.equal(motor().commanded, true)
    assert.equal(motor().running, false)
    assert.equal(pictureNamedSignal(element, useStore.getState()).text, 'WAIT MOTOR')
    const messages = new Set()
    for (let count = 0; count < 25; count++) {
      store.tick(.1)
      messages.add(pictureNamedSignal(element, useStore.getState()).text)
      if (chart().active === 0) break
    }
    assert.equal(motor().running, true)
    assert.equal(chart().active, 0)
    assert.ok(messages.has('READY'))
    assert.ok(messages.has('SELECT SEQUENCE'))
    assert.equal(useStore.getState().sfcLifecycle[NAME].saved.parameters.MESSAGE.value, 255)
    assert.deepEqual(pictureNamedSignal(element, useStore.getState()).choices.map(entry => entry.name), ['STARTUP'])
  })
})
test('disabled level channel cannot release a high held value; recovery uses the actual sampled signal', () => {
  fixture(store => {
    configure(store)
    store.setTraditionalInput('LT-1', 150)
    store.tick(.1)
    assert.equal(useStore.getState().modules[LEVEL].pv, 150)
    store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'LT-1', enabled: false })
    store.tick(.1)
    start(store)
    for (let count = 0; count < 10; count++) store.tick(.1)
    assert.equal(chart().active, 1)
    assert.equal(useStore.getState().modules[LEVEL].pvBad, true)
    assert.equal(useStore.getState().modules[LEVEL].pv, 150)
    assert.equal(motor().locked, true)
    assert.equal(motor().commanded, false)
    store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'LT-1', enabled: true })
    for (let count = 0; count < 30; count++) store.tick(.1)
    assert.equal(motor().running, true)
  })
})
test('reset cannot bypass an active interlock, a missing permissive, or failed field confirmation', () => {
  for (const patch of [{ interlock: true }, { permissiveOk: false }, { fault: true }]) {
    fixture(store => {
      configure(store)
      useStore.setState({ modules: { ...useStore.getState().modules, [MOTOR]: { ...motor(), ...patch } } })
      start(store)
      setLevel(store, 150)
      for (let count = 0; count < 30; count++) store.tick(.1)
      assert.equal(chart().active, 3)
      assert.equal(motor().running, false)
      assert.equal(pictureNamedSignal(element, useStore.getState()).text, 'WAIT MOTOR')
      if (patch.interlock) assert.equal(motor().locked, true)
      if (patch.permissiveOk === false) assert.equal(motor().permissiveOk, false)
      if (patch.fault) assert.equal(motor().fault, true)
    })
  }
})
test('qualified reset honors its delay/HOLD and never fabricates an inverse or automatic start', () => {
  fixture(() => {
    const initial = useStore.getState()
    const state = { ...initial, sfcs: { [NAME]: { name: NAME, area: 'FEED', status: 'RUNNING',
      active: 0, elapsed: 0, steps: [
        { id: 'reset', name: 'DELAYED RESET', actions: [
          { ...reset(), name: 'RESET_PULSE', qualifier: 'P', seconds: 1 }
        ], transition: { kind: 'timer', seconds: 10 } }
      ] } } }
    const scan = (input, seconds) => {
      const advanced = advanceSfcs(input, input.modules, seconds)
      return { ...input, ...advanced }
    }
    let next = scan(state, .5)
    assert.equal(next.modules[MOTOR].locked, true)
    next = { ...next, sfcs: { [NAME]: { ...next.sfcs[NAME], status: 'HELD' } } }
    next = scan(next, 100)
    assert.equal(next.modules[MOTOR].locked, true)
    next = { ...next, sfcs: { [NAME]: { ...next.sfcs[NAME], status: 'RUNNING' } } }
    next = scan(next, .5)
    assert.equal(next.modules[MOTOR].locked, false)
    next = scan(next, .1)
    assert.equal(next.modules[MOTOR].locked, false)
    assert.equal(next.modules[MOTOR].commanded, false)
    assert.equal(state.modules[MOTOR].locked, true)
  })
})
test('HOLD/controller outage freeze the waiting chain; reset/download cannot execute a configured reset action', () => {
  fixture(store => {
    configure(store)
    start(store)
    store.sfcCommand(NAME, 'hold')
    setLevel(store, 150)
    assert.equal(motor().locked, true)
    assert.equal(chart().active, 1)
    store.sfcCommand(NAME, 'restart')
    const controller = useStore.getState().hardware.controllers.CTLR
    useStore.setState({ hardware: { ...useStore.getState().hardware,
      controllers: { CTLR: { ...controller, commissioned: false } } } })
    for (let count = 0; count < 5; count++) store.tick(.1)
    assert.equal(motor().locked, true)
    assert.equal(chart().active, 1)
    useStore.setState({ hardware: { ...useStore.getState().hardware, controllers: { CTLR: controller } } })
    store.sfcCommand(NAME, 'reset')
    assert.equal(motor().locked, true)
    assert.equal(store.setSfcOnline(NAME, false), true)
    assert.equal(store.downloadSavedSfc(NAME), true)
    assert.equal(motor().locked, true)
    assert.equal(chart().status, 'READY')
  })
})
