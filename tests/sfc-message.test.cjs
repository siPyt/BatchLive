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
const { usePictures, pictureStorageKey } = require('../src/renderer/src/engine/pictureStore.ts')
const { pictureNamedSignal } = require('../src/renderer/src/engine/pictureNamedSets.ts')
const { pictureElementError, parseSavedPicture } = require('../src/renderer/src/engine/pictureDynamics.ts')
const { parseSfcAssignment, parseSfcCondition, assignmentExpression, conditionExpression } = require('../src/renderer/src/engine/sfcExpressions.ts')
const { parseSavedSfc, savedSfcKey } = require('../src/renderer/src/engine/sfcLifecycle.ts')
const { advanceSfcs, evalCondition, sfcStepsError } = require('../src/renderer/src/engine/sfc.ts')
const NAME = 'SFC-T101'
const controller = { kind: 'controller', tag: 'CTLR-01' }
const workstation = { kind: 'workstation' }
const courseSet = () => ({ name: 'NS-T101', description: '', entries: [
  { name: 'STARTUP', value: 1, visible: true, userSelectable: true },
  { name: 'SELECT SEQUENCE', value: 255, visible: true, userSelectable: false },
  { name: 'SHUTDOWN', value: 2, visible: true, userSelectable: true },
  { name: 'HIDDEN', value: 3, visible: false, userSelectable: true }
] })
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), pictures: usePictures.getState(), window: global.window }
  const storage = new Map()
  const alerts = []
  global.window = { alert: text => alerts.push(text), localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lastDenied: null })
    const store = useStore.getState()
    store.newProject('pharma')
    store.createNamedSet('NS-T101')
    assert.equal(store.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-T101'], courseSet()), true)
    store.createSfc(NAME, 'FEED')
    store.setSfcSteps(NAME, [{ id: 'wait', name: 'HOLD_SFC', actions: [], transition: { kind: 'always' } }])
    store.enableSfcLifecycle(NAME)
    assert.equal(store.configureSfcParameter(NAME, 'MESSAGE', { type: 'NAMED_SET', namedSet: 'NS-T101', value: 255 },
      useStore.getState().sfcLifecycle[NAME].draft), true)
    run(store, storage, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    usePictures.setState(previous.pictures, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function algorithm(store, qualifier = 'P') {
  const context = sfcExpressionContext(useStore.getState(), NAME)
  const assignment = parseSfcAssignment("'MESSAGE' := 'NS-T101:SELECT SEQUENCE'", useStore.getState().modules, context).value
  const transition = parseSfcCondition("'MESSAGE' = 'NS-T101:STARTUP'", useStore.getState().modules, context).value
  store.setSfcSteps(NAME, [
    { id: 'wait', name: 'HOLD_SFC', actions: [{ ...assignment, qualifier, ...(qualifier === 'P' ? { seconds: 0 } : {}) }], transition },
    { id: 'open', name: 'OPEN_BLK_VLV', actions: [{ kind: 'valve', tag: 'XV-101', open: true }],
      transition: { kind: 'valveOpen', tag: 'XV-101', open: true } },
    { id: 'finish', name: 'FINISH', actions: [], transition: { kind: 'timer', seconds: 1 } }
  ])
}
function download(store) {
  store.configureSfcController(NAME, 'CTLR-01')
  assert.equal(store.saveSfc(NAME), true)
  assert.equal(store.downloadChangedNamedSets(controller), true)
  assert.equal(store.downloadChangedNamedSets(workstation), true)
  assert.equal(store.downloadSavedSfc(NAME), true)
  assert.equal(store.setSfcOnline(NAME, true), true)
}
function datalink() {
  usePictures.getState().createPicture('MESSAGEPIC')
  const id = usePictures.getState().addElement('MESSAGEPIC', { type: 'datalink', x: 20, y: 20,
    tag: NAME, path: 'MESSAGE.CV', label: true, entry: { method: 'NAMED_SET' } })
  assert.ok(id)
  return { id, el: usePictures.getState().pictures.MESSAGEPIC.elements.find(item => item.id === id) }
}
function message() { return useStore.getState().sfcs[NAME].parameters.MESSAGE.value }

test('MESSAGE exact expressions roundtrip case-sensitive states and reject wrong binding/syntax explicitly', () => {
  fixture(() => {
    const state = useStore.getState()
    const context = sfcExpressionContext(state, NAME)
    const action = parseSfcAssignment("'MESSAGE' := 'NS-T101:SELECT SEQUENCE'", state.modules, context)
    assert.deepEqual(action.value, { kind: 'namedSet', tag: NAME, parameter: 'MESSAGE', namedSet: 'NS-T101', entry: 'SELECT SEQUENCE' })
    assert.deepEqual(parseSfcAssignment(assignmentExpression(action.value), state.modules, context), action)
    const condition = parseSfcCondition("'MESSAGE' = 'NS-T101:STARTUP'", state.modules, context)
    assert.deepEqual(parseSfcCondition(conditionExpression(condition.value), state.modules, context), condition)
    for (const expression of [
      "'MESSAGE' := 'NS-T101:startup'", "'MESSAGE' := 'ns-t101:STARTUP'",
      "'MISSING' := 'NS-T101:STARTUP'", "'MESSAGE' := 'NS-OTHER:STARTUP'",
      "'MESSAGE' := 255", "'MESSAGE' := 'NS-T101:STARTUP' + 1",
      "'MESSAGE\" := 'NS-T101:STARTUP'"
    ]) assert.ok(parseSfcAssignment(expression, state.modules, context).error, expression)
    assert.ok(parseSfcAssignment("'MESSAGE' := 'NS-T101:STARTUP'", state.modules).error)
    assert.ok(parseSfcCondition("'MESSAGE' = 'NS-T101:startup'", state.modules, context).error)
    assert.ok(parseSfcCondition("'MESSAGE' = 'NS-T101:STARTUP' OR TRUE", state.modules, context).error)
  })
})

test('Named Set parameters stay configured until Save/Download, and transfer requires controller setup', () => {
  fixture((store, storage) => {
    algorithm(store)
    const record = useStore.getState().sfcLifecycle[NAME]
    assert.equal(useStore.getState().sfcs[NAME].parameters, undefined)
    store.configureSfcController(NAME, 'CTLR-01')
    assert.equal(store.saveSfc(NAME), true)
    const before = useStore.getState()
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(useStore.getState().sfcLifecycle, before.sfcLifecycle)
    assert.equal(useStore.getState().sfcs, before.sfcs)
    assert.equal(store.downloadChangedNamedSets(workstation), true)
    assert.equal(store.downloadSavedSfc(NAME), false)
    assert.equal(store.downloadChangedNamedSets(controller), true)
    assert.equal(store.downloadSavedSfc(NAME), true)
    assert.equal(message(), 255)
    assert.notEqual(useStore.getState().sfcs[NAME].parameters, record.draft.parameters)
    const parsed = parseSavedSfc(storage.get(savedSfcKey(NAME)), useStore.getState().modules, useStore.getState().namedSets.configured)
    assert.equal(parsed.configuration.parameters.MESSAGE.value, 255)
    assert.ok(parseSavedSfc(storage.get(savedSfcKey(NAME)), useStore.getState().modules).error)
  })
})

test('real picture MESSAGE entry releases the waiting transition; prompt is visible but never selectable', () => {
  fixture(store => {
    algorithm(store)
    download(store)
    const { id, el } = datalink()
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 0)
    assert.equal(message(), 255)
    const signal = pictureNamedSignal(el, useStore.getState())
    assert.equal(signal.text, 'SELECT SEQUENCE')
    assert.equal(signal.bad, false)
    assert.deepEqual(signal.choices.map(entry => entry.name), ['STARTUP', 'SHUTDOWN'])
    const before = useStore.getState().sfcs
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 255), false)
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 3), false)
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, NaN), false)
    assert.equal(useStore.getState().sfcs, before)
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1, el), true)
    assert.equal(message(), 1)
    const online = sfcExpressionContext(useStore.getState(), NAME, true)
    assert.equal(online.parameters.MESSAGE.value, 1)
    assert.equal(evalCondition(useStore.getState().sfcs[NAME].steps[0].transition, useStore.getState(), 0, online), true)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 1)
    assert.equal(useStore.getState().modules['XV-101'].commandedOpen, true)
    assert.equal(useStore.getState().sfcLifecycle[NAME].draft.parameters.MESSAGE.value, 255)
    assert.equal(useStore.getState().sfcLifecycle[NAME].saved.parameters.MESSAGE.value, 255)
    assert.equal(useStore.getState().sfcLifecycle[NAME].deployed.parameters.MESSAGE.value, 255)
    assert.ok(useStore.getState().eventLog.some(entry => entry.description.includes('MESSAGE := NS-T101:STARTUP (1)')))
  })
})

test('MESSAGE N/P/SD actions use real qualifier lifetimes rather than treating all prompt writes as pulses', () => {
  fixture(store => {
    algorithm(store, 'N')
    download(store)
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    assert.equal(store.writeSfcNamedValue(NAME, 'MESSAGE', 1), true)
    store.tick(0.1)
    assert.equal(message(), 255)
    assert.equal(useStore.getState().sfcs[NAME].active, 0)
    const state = useStore.getState()
    const context = sfcExpressionContext(state, NAME, true)
    const action = { kind: 'namedSet', tag: NAME, parameter: 'MESSAGE', namedSet: 'NS-T101', entry: 'STARTUP', qualifier: 'SD', seconds: 0.5 }
    const routine = { ...state.sfcs[NAME], active: 0, elapsed: 0, actionStates: {}, status: 'RUNNING',
      steps: [
        { id: 'first', name: 'FIRST', actions: [action], transition: { kind: 'timer', seconds: 0.2 } },
        { id: 'next', name: 'NEXT', actions: [], transition: { kind: 'timer', seconds: 2 } }
      ] }
    assert.equal(sfcStepsError(routine.steps, state.modules, context), null)
    let result = advanceSfcs({ ...state, sfcs: { [NAME]: routine } }, state.modules, 0.2, { [NAME]: context.sets })
    assert.equal(result.sfcs[NAME].active, 1)
    result = advanceSfcs({ ...state, sfcs: result.sfcs }, result.modules, 0.3, { [NAME]: context.sets })
    assert.equal(result.sfcs[NAME].parameters.MESSAGE.value, 1)
    assert.equal(routine.parameters.MESSAGE.value, 255)
  })
})

test('independent setup copies prevent mismatched, invisible and nonselectable numeric bypass writes', () => {
  fixture(store => {
    algorithm(store)
    download(store)
    const { id, el } = datalink()
    const expected = useStore.getState().namedSets.configured['NS-T101']
    const changed = courseSet()
    changed.entries[0].value = 10
    assert.equal(store.applyNamedSetProperties(expected, changed), true)
    assert.equal(pictureNamedSignal(el, useStore.getState()).choices[0].value, 1)
    assert.equal(store.downloadChangedNamedSets(controller), true)
    assert.deepEqual(pictureNamedSignal(el, useStore.getState()).choices.map(entry => entry.name), ['SHUTDOWN'])
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1), false)
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 10), false)
    assert.equal(store.downloadChangedNamedSets(workstation), true)
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 10), true)
    assert.equal(message(), 10)
    const hidden = courseSet()
    hidden.entries[0].value = 10
    hidden.entries[0].visible = false
    assert.equal(store.applyNamedSetProperties(useStore.getState().namedSets.configured['NS-T101'], hidden), true)
    store.downloadChangedNamedSets(controller)
    store.downloadChangedNamedSets(workstation)
    assert.equal(pictureNamedSignal(el, useStore.getState()).text, '10')
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 10), false)
  })
})

test('missing runtime setup holds chart and journals error once instead of silently completing a transition', () => {
  fixture(store => {
    algorithm(store)
    download(store)
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    const before = useStore.getState()
    const changed = courseSet()
    changed.entries = changed.entries.filter(entry => entry.name !== 'STARTUP')
    store.applyNamedSetProperties(before.namedSets.configured['NS-T101'], changed)
    store.downloadChangedNamedSets(controller)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].status, 'HELD')
    assert.equal(useStore.getState().sfcs[NAME].active, 0)
    assert.equal(message(), 255)
    const diagnostics = useStore.getState().eventLog.filter(entry => entry.description.startsWith('SFC held:'))
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0].description, /STARTUP/)
    store.tick(0.1)
    assert.equal(useStore.getState().eventLog.filter(entry => entry.description.startsWith('SFC held:')).length, 1)
    store.sfcCommand(NAME, 'run')
    assert.equal(useStore.getState().sfcs[NAME].status, 'HELD')
  })
})

test('parameter/data entry changes reject stale drafts, missing targets, denied keys and locked station atomically', () => {
  fixture(store => {
    const expected = useStore.getState().sfcLifecycle[NAME].draft
    const binding = { type: 'NAMED_SET', namedSet: 'NS-T101', value: 1 }
    store.configureSfcController(NAME, 'CTLR-01')
    const state = useStore.getState().sfcLifecycle
    assert.equal(store.configureSfcParameter(NAME, 'MESSAGE', binding, expected), false)
    assert.equal(store.configureSfcParameter(NAME, 'message', binding, useStore.getState().sfcLifecycle[NAME].draft), false)
    assert.equal(useStore.getState().sfcLifecycle, state)
    algorithm(store)
    download(store)
    const { id, el } = datalink()
    usePictures.getState().updateElement('MESSAGEPIC', id, { x: 25 })
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1, el), false)
    const runtime = useStore.getState().sfcs
    useSecurity.setState({ currentUser: 'Supervisor1' })
    assert.equal(store.configureSfcParameter(NAME, 'MESSAGE', binding, useStore.getState().sfcLifecycle[NAME].draft), false)
    useSecurity.setState({ currentUser: 'admin', locked: true })
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1), false)
    assert.equal(useStore.getState().sfcs, runtime)
    useSecurity.setState({ locked: false, currentUser: 'unknown-user' })
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1), false)
    assert.equal(useStore.getState().sfcs, runtime)
    useSecurity.setState({ locked: false, currentUser: 'OperatorA' })
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1), true)
    useSecurity.setState({ currentUser: 'admin' })
    const hardware = useStore.getState().hardware
    useStore.setState({ hardware: { ...hardware, controllers: { ...hardware.controllers,
      'CTLR-01': { ...hardware.controllers['CTLR-01'], powerDownAt: 1 } } } })
    const unavailable = useStore.getState().sfcs
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 2), false)
    assert.equal(useStore.getState().sfcs, unavailable)
    assert.equal(pictureNamedSignal(usePictures.getState().pictures.MESSAGEPIC.elements[0], useStore.getState()).bad, true)
  })
})

test('Named Set picture persistence/schema validates bindings without converting numeric entry or fill into commands', () => {
  fixture((store, storage) => {
    algorithm(store)
    download(store)
    const { id, el } = datalink()
    assert.equal(pictureElementError(el, useStore.getState().modules, useStore.getState()), null)
    assert.ok(pictureElementError(el, useStore.getState().modules))
    assert.equal(usePictures.getState().savePicture('MESSAGEPIC'), true)
    assert.deepEqual(parseSavedPicture(storage.get(pictureStorageKey('MESSAGEPIC')), 'MESSAGEPIC',
      useStore.getState().modules, useStore.getState()).elements[0], el)
    assert.equal(usePictures.getState().writeNumericValue('MESSAGEPIC', id, 255), false)
    const original = usePictures.getState().pictures.MESSAGEPIC
    assert.equal(usePictures.getState().configureDynamics('MESSAGEPIC', id, { path: 'MISSING' }), false)
    assert.equal(usePictures.getState().pictures.MESSAGEPIC, original)
    assert.ok(pictureElementError({ ...el, type: 'rectangle' }, useStore.getState().modules, useStore.getState()))
    assert.ok(pictureElementError({ ...el, fill: { vertical: true, fetchLimits: false, low: 0, high: 255 } },
      useStore.getState().modules, useStore.getState()))
    assert.equal(usePictures.getState().loadPicture('MESSAGEPIC'), true)
    assert.equal(message(), 255)
    assert.equal(usePictures.getState().configureDynamics('MESSAGEPIC', id, { entry: undefined }), true)
    const readOnly = usePictures.getState().pictures.MESSAGEPIC.elements.find(item => item.id === id)
    assert.equal(pictureElementError(readOnly, useStore.getState().modules, useStore.getState()), null)
    assert.equal(usePictures.getState().savePicture('MESSAGEPIC'), true)
    assert.equal(usePictures.getState().writeNamedValue('MESSAGEPIC', id, 1), false)
  })
})
