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

test('DV09-085 MESSAGE startup under a two-signature policy: request, denied verification, cancellation, approval, then the SFC runs', () => {
  fixture(store => {
    algorithm(store)
    download(store)
    const s = useStore.getState()
    assert.equal(s.setSignatureApplication({ operate: true }), true)
    assert.equal(s.setSignatureArea('FEED', true), true)
    assert.equal(s.saveSignaturePolicy({ name: 'T101-MESSAGE', description: '', allowSamePerson: false, parameters: { MESSAGE: 'CONFIRM_VERIFY' } }), null)
    assert.equal(s.setModuleSignaturePolicy(NAME, 'T101-MESSAGE'), true)
    store.closeValve('XV-101')
    store.sfcCommand(NAME, 'run')
    store.tick(0.1)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 0)

    // operator request is staged, nothing is written and the chart keeps waiting
    assert.equal(useStore.getState().writeSfcNamedValue(NAME, 'MESSAGE', 1), false)
    assert.equal(useStore.getState().signaturePending.length, 1)
    assert.equal(message(), 255)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 0, 'no premature startup')
    assert.equal(useStore.getState().modules['XV-101'].commandedOpen, false)

    // denied verification: a verifier without Action Verify
    const id = useStore.getState().signaturePending[0].id
    const confirm = { user: 'admin', password: 'admin123' }
    assert.match(useStore.getState().submitSignature(id, { comment: 'start T101', confirm, verify: { user: 'OperatorA', password: 'operatora' } }), /Action Verify/)
    assert.equal(message(), 255)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 0)

    // cancellation leaves the chart waiting
    assert.equal(useStore.getState().cancelSignature(id), true)
    assert.equal(useStore.getState().signaturePending.length, 0)
    assert.equal(message(), 255)

    // a fresh request approved by an administrator with the Action Verify key
    assert.equal(useStore.getState().writeSfcNamedValue(NAME, 'MESSAGE', 1), false)
    const second = useStore.getState().signaturePending[0].id
    assert.equal(useStore.getState().submitSignature(second, { comment: 'start T101', confirm, verify: { user: 'Supervisor1', password: 'supervisor1' } }), null)
    assert.equal(message(), 1)
    store.tick(0.1)
    assert.equal(useStore.getState().sfcs[NAME].active, 1, 'the approved MESSAGE releases the waiting transition')
    assert.equal(useStore.getState().modules['XV-101'].commandedOpen, true)
    const log = useStore.getState().eventLog.map(entry => entry.description)
    assert.ok(log.some(text => /Electronic signature attempt for MESSAGE := 1 failed: Verify failed/.test(text)))
    assert.ok(log.some(text => /Electronic signature cancelled for MESSAGE := 1/.test(text)))
    assert.ok(log.some(text => /confirmed by admin and verified by Supervisor1/.test(text)))
    assert.ok(log.some(text => text.includes('MESSAGE := NS-T101:STARTUP (1)')))
  })
})