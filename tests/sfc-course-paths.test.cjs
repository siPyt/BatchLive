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
const { useStore, sfcExpressionContext } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { describeCondition, evalCondition, sfcStepsError } = require('../src/renderer/src/engine/sfc.ts')
const { parseSfcCondition, parseSfcAssignment, conditionExpression } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { parseSavedSfc, serializeSavedSfc } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const NAME = 'SFC-T101'
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const storage = new Map()
  global.window = { alert: () => {}, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('blank')
    store.createArea('PLANT_AREA_A')
    store.createController('CTLR', 'Course path test')
    store.commissionController('CTLR')
    for (const [slot, type] of [[1, 'AI'], [2, 'AO'], [3, 'DI'], [4, 'DO']]) {
      assert.equal(store.addTraditionalCard('CTLR', slot, type), true)
    }
    for (const [slot, channel, dst] of [[1, 2, 'FT-2'], [2, 2, 'FY-2'], [3, 1, 'LSO-1'], [4, 1, 'XV-1']]) {
      assert.equal(store.configureTraditionalChannel(`CTLR/C0${slot}`, channel, { dst, enabled: true }), true)
    }
    for (const [tag, type] of [['XV-101', 'DO'], ['XVSTAT-101', 'DI'], ['FIC-102', 'PID'], ['MTR-102', 'MOTOR']]) {
      assert.equal(store.createModule({ tag, type, area: 'PLANT_AREA_A', description: 'Course test', unit: 'GPM', pvMin: 0, pvMax: 100 }), true)
    }
    store.bindDiscreteDst('XV-101', 'XV-1')
    store.bindDiscreteDst('XVSTAT-101', 'LSO-1')
    store.configureTraditionalChannel('CTLR/C03', 1, { dst: 'LSO-1', enabled: true, tiebackDst: 'XV-1' })
    store.bindAnalogDst('FIC-102', 'input', 'FT-2')
    store.bindAnalogDst('FIC-102', 'output', 'FY-2')
    store.setTraditionalInput('FT-2', 0)
    store.tick(.1)
    store.tick(.1)
    run(store)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function pathCondition(expression) {
  const parsed = parseSfcCondition(expression, useStore.getState().modules)
  assert.equal(parsed.error, undefined, parsed.error)
  return parsed.value
}
test('course DI feedback and actual-mode paths roundtrip while command paths and invalid values reject', () => {
  fixture(store => {
    store.createModule({ tag: 'MODE-AO', type: 'AO', area: 'PLANT_AREA_A', description: 'AO mode test' })
    const modules = useStore.getState().modules
    for (const expression of ["'^/XVSTAT-101/DI1/PV_D.CV' = 1", "'^/XVSTAT-101/DI1/PV_D.CV' = 0",
      "'^/FIC-102/PID1/MODE.ACTUAL' = AUTO", "'^/FIC-102/PID1/MODE.ACTUAL' = IMAN",
      "'^/FIC-102/PID1/MODE.ACTUAL' = OOS", "'^/FIC-102/PID1/MODE.ACTUAL' = LO",
      "'^/MODE-AO/AO1/MODE.ACTUAL' = OOS"]) {
      const result = parseSfcCondition(expression, modules)
      assert.equal(result.error, undefined)
      assert.deepEqual(parseSfcCondition(conditionExpression(result.value, modules[result.value.tag]), modules), result)
    }
    for (const expression of ["'^/XVSTAT-101/DI1/SP_D.CV' = 1", "'^/XVSTAT-101/DI1/PV_D.CV' = 2",
      "'^/XVSTAT-101/DI1/PV_D.CV' > 0", "'^/XV-101/DI1/PV_D.CV' = 1",
      "'^/FIC-102/PID1/MODE.TARGET' = AUTO", "'^/FIC-102/PID1/MODE.ACTUAL' = INVALID"]) {
      assert.ok(parseSfcCondition(expression, modules).error, expression)
    }
    assert.ok(parseSfcAssignment("'^/XVSTAT-101/DI1/PV_D.CV' := 1", modules).error)
    assert.equal(parseSfcAssignment("'^/MODE-AO/AO1/MODE.TARGET' := OOS", modules).value.mode, 'OOS')
    assert.ok(parseSfcCondition("'^/MODE-AO/AO1/MODE.ACTUAL' = IMAN", modules).error)
    const actualOos = parseSfcCondition("'^/MODE-AO/AO1/MODE.ACTUAL' = OOS", modules).value
    assert.equal(describeCondition(actualOos, modules['MODE-AO']), '^/MODE-AO/AO1/MODE.ACTUAL = OOS')
    assert.deepEqual(parseSfcAssignment("'^/XV-101/DO1/SP_D.CV' := 1", modules).value, { kind: 'do', tag: 'XV-101', on: true })
  })
})
test('DI confirmed value never succeeds with Bad/OOS held feedback and actual mode never substitutes target mode', () => {
  fixture(() => {
    const state = useStore.getState()
    const discrete = pathCondition("'^/XVSTAT-101/DI1/PV_D.CV' = 1")
    const mode = pathCondition("'^/FIC-102/PID1/MODE.ACTUAL' = CAS")
    const modified = (patch) => ({ ...state, modules: { ...state.modules,
      'XVSTAT-101': { ...state.modules['XVSTAT-101'], state: true, ...patch } } })
    assert.equal(evalCondition(discrete, modified({}), 0), true)
    assert.equal(evalCondition(discrete, modified({ ioBad: true }), 0), false)
    assert.equal(evalCondition(discrete, modified({ mode: 'OOS' }), 0), false)
    const closed = pathCondition("'^/XVSTAT-101/DI1/PV_D.CV' = 0")
    assert.equal(evalCondition(closed, modified({ state: false }), 0), true)
    assert.equal(evalCondition(closed, modified({ state: false, ioBad: true }), 0), false)
    assert.equal(evalCondition(closed, modified({ state: false, mode: 'OOS' }), 0), false)
    const modeState = { ...state, modules: { ...state.modules,
      'FIC-102': { ...state.modules['FIC-102'], mode: 'CAS', actualMode: 'AUTO' } } }
    assert.equal(evalCondition(mode, modeState, 0), false)
    modeState.modules['FIC-102'].actualMode = 'CAS'
    assert.equal(evalCondition(mode, modeState, 0), true)
  })
})
function startup(store) {
  store.createNamedSet('NS-T101')
  store.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-T101'], { name: 'NS-T101', description: '', entries: [
    { name: 'STARTUP', value: 1, visible: true, userSelectable: true },
    { name: 'SHUTDOWN', value: 2, visible: true, userSelectable: true },
    { name: 'SELECT SEQUENCE', value: 255, visible: true, userSelectable: false }
  ] })
  store.createSfc(NAME, 'PLANT_AREA_A')
  store.setSfcSteps(NAME, [{ id: 'hold', name: 'HOLD_SFC', actions: [], transition: { kind: 'always' } }])
  store.enableSfcLifecycle(NAME)
  store.configureSfcParameter(NAME, 'MESSAGE', { type: 'NAMED_SET', namedSet: 'NS-T101', value: 255 },
    useStore.getState().sfcLifecycle[NAME].draft)
  const context = sfcExpressionContext(useStore.getState(), NAME)
  const assignment = text => {
    const result = parseSfcAssignment(text, useStore.getState().modules, context)
    assert.equal(result.error, undefined, result.error)
    return result.value
  }
  const named = entry => ({ kind: 'namedSet', parameter: 'MESSAGE', namedSet: 'NS-T101', entry })
  const steps = [
    { id: 'hold', name: 'HOLD_SFC', actions: [{ ...assignment("'MESSAGE' := 'NS-T101:SELECT SEQUENCE'"), qualifier: 'P' }],
      transition: named('STARTUP'), nextStep: 'open',
      alternatives: [{ condition: named('SHUTDOWN'), nextStep: 'stop' }] },
    { id: 'open', name: 'OPEN_BLK_VLV', actions: [assignment("'^/XV-101/DO1/SP_D.CV' := 1")],
      transition: pathCondition("'^/XVSTAT-101/DI1/PV_D.CV' = 1") },
    { id: 'flow', name: 'SET_FLOW_RATE', actions: [assignment("'^/FIC-102/PID1/MODE.TARGET' := AUTO"),
      assignment("'^/FIC-102/PID1/SP.CV' := 50")], transition: pathCondition("'^/FIC-102/PID1/OUT.CV' > 30") },
    { id: 'start', name: 'START_PUMP', actions: [assignment("'^/MTR-102/DC1/OUT_D.CV' := 1")],
      transition: pathCondition("'^/MTR-102/DC1/PV_D.CV' = 1"), nextStep: 'end' },
    { id: 'stop', name: 'STOP_PUMP', actions: [assignment("'^/MTR-102/DC1/OUT_D.CV' := 0")],
      transition: pathCondition("'^/MTR-102/DC1/PV_D.CV' = 0") },
    { id: 'close', name: 'CLOSE_BLK_VLV', actions: [assignment("'^/XV-101/DO1/SP_D.CV' := 0")],
      transition: pathCondition("'^/XVSTAT-101/DI1/PV_D.CV' = 0") },
    { id: 'flowclose', name: 'CLOSE_FLOW_VLV', actions: [assignment("'^/FIC-102/PID1/MODE.TARGET' := MAN"),
      assignment("'^/FIC-102/PID1/OUT.CV' := 0")], transition: pathCondition("'^/FIC-102/PID1/OUT.CV' < 2") },
    { id: 'end', name: 'END_SEQUENCE', actions: [], transition: { kind: 'always' }, nextStep: 'hold' }
  ]
  store.setSfcSteps(NAME, steps)
  store.configureSfcController(NAME, 'CTLR')
  store.downloadChangedNamedSets({ kind: 'controller', tag: 'CTLR' })
  store.downloadChangedNamedSets({ kind: 'workstation' })
  assert.equal(store.checkSfc(NAME), null)
  assert.equal(store.saveSfc(NAME), true)
  assert.equal(store.downloadSavedSfc(NAME), true)
  store.setSfcOnline(NAME, true)
  store.sfcCommand(NAME, 'run')
  store.tick(.1)
}
test('exact course tags execute startup and p294 shutdown dependency order using distinct command and sampled feedback', () => {
  fixture(store => {
    startup(store)
    for (const [command, expected] of [[1, [1, 2, 3, 7, 0]], [2, [4, 5, 6, 7, 0]], [1, [1, 2, 3, 7, 0]]]) {
      assert.equal(store.writeSfcNamedValue(NAME, 'MESSAGE', command), true)
      const trace = []
      for (let i = 0; i < 300; i++) {
        store.tick(.1)
        const state = useStore.getState()
        const chart = state.sfcs[NAME]
        if (trace.at(-1) !== chart.active) trace.push(chart.active)
        if (chart.active === 2) {
          assert.equal(state.modules['XVSTAT-101'].state, true)
          assert.equal(state.modules['FIC-102'].sp, 50)
        }
        if (chart.active === 6) assert.equal(state.modules['XVSTAT-101'].state, false)
        if (chart.active === 0 && chart.parameters.MESSAGE.value === 255) break
      }
      assert.deepEqual(trace, expected)
      assert.equal(useStore.getState().modules['MTR-102'].running, command === 1)
      assert.equal(useStore.getState().sfcs[NAME].status, 'RUNNING')
      assert.equal(useStore.getState().sfcLifecycle[NAME].saved.parameters.MESSAGE.value, 255)
    }
  })
})
test('disabled course output/Bad DI prevents startup from confirming even when the command is ON', () => {
  fixture(store => {
    startup(store)
    store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: false })
    store.writeSfcNamedValue(NAME, 'MESSAGE', 1)
    for (let i = 0; i < 20; i++) store.tick(.1)
    let state = useStore.getState()
    assert.equal(state.sfcs[NAME].active, 1)
    assert.equal(state.modules['XV-101'].commanded, true)
    assert.equal(state.modules['XV-101'].state, false)
    assert.equal(state.modules['XVSTAT-101'].ioBad, true)
    assert.equal(state.modules['MTR-102'].commanded, false)
    store.configureTraditionalChannel('CTLR/C04', 1, { dst: 'XV-1', enabled: true })
    for (let i = 0; i < 80; i++) store.tick(.1)
    state = useStore.getState()
    assert.equal(state.sfcs[NAME].active, 0)
    assert.equal(state.modules['MTR-102'].running, true)
  })
})
test('saved DI and actual-mode conditions validate schema/module type and preserve real feedback semantics', () => {
  fixture(() => {
    const modules = useStore.getState().modules
    const configuration = { name: NAME, area: 'PLANT_AREA_A', controllerTag: 'CTLR', steps: [
      { id: 'di', name: 'CONFIRM', actions: [], transition: pathCondition("'^/XVSTAT-101/DI1/PV_D.CV' = 1") },
      { id: 'mode', name: 'MODE', actions: [], transition: pathCondition("'^/FIC-102/PID1/MODE.ACTUAL' = AUTO") }
    ] }
    assert.equal(parseSavedSfc(serializeSavedSfc(configuration), modules).error, undefined)
    for (const condition of [
      { kind: 'discrete', tag: 'XV-101', state: true },
      { kind: 'mode', tag: 'FIC-102', mode: 'INVALID' },
      { kind: 'mode', tag: 'XVSTAT-101', mode: 'AUTO' }
    ]) assert.ok(sfcStepsError([{ ...configuration.steps[0], transition: condition }], modules))
    assert.ok(parseSavedSfc(JSON.stringify({ version: 1, configuration: {
      ...configuration, steps: [{ ...configuration.steps[0], transition: { kind: 'discrete', tag: 'XVSTAT-101', state: 1 } }]
    } }), modules).error)
  })
})
