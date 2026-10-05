const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, filename)
}
require.extensions['.tsx'] = require.extensions['.ts']
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const sysModule = require('../src/renderer/src/engine/systemPreferences.ts')
const { useSystem } = sysModule
const act = require('../src/renderer/src/engine/fieldbusActions.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), system: useSystem.getState(), window: global.window }
  global.window = { alerts: [], alert(m) { this.alerts.push(m) }, localStorage: { getItem: () => null, setItem: () => {} } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null, lastDenied: null })
    useSystem.setState({ features: { fieldbus: false, signaturePolicies: false }, pending: {}, acknowledged: false, serverState: 'RUNNING', restarts: 0, clients: [] })
    const s = useStore.getState()
    s.newProject('blank')
    assert.equal(s.createController('CTRL1', 'prefs'), true)
    assert.equal(s.commissionController('CTRL1'), true)
    run(s, useSystem.getState)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    useSystem.setState(before.system, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

test('DV09-108 hidden features are unavailable by default and give an explicit message', () => fixture((s, sys) => {
  assert.deepEqual(sys().features, { fieldbus: false, signaturePolicies: false })
  assert.match(act.addH1Card('CTRL1', 5, false), /FOUNDATION fieldbus.*not enabled.*System Preferences.*reconnect the database server/)
  assert.equal(useStore.getState().setSignatureApplication({ operate: true }), false)
  assert.ok(global.window.alerts.some((m) => /Electronic Signature policies is not enabled/.test(m)))
  assert.match(useStore.getState().saveSignaturePolicy({ name: 'P', description: '', allowSamePerson: false, parameters: { SP: 'CONFIRM' } }), /not enabled/)
  assert.equal(useStore.getState().setSignatureApplication({ operate: false }), true, 'turning an application off is always allowed')
}))

test('DV09-108 a selected feature stays pending: nothing becomes active until the server restarts', () => fixture((s, sys) => {
  assert.equal(sys().setPendingFeature('fieldbus', true), null)
  assert.deepEqual(sys().pending, { fieldbus: true })
  assert.equal(sys().features.fieldbus, false, 'a pending feature does not appear active')
  assert.equal(sysModule.featureEnabled('fieldbus'), false)
  assert.match(act.addH1Card('CTRL1', 5, false), /not enabled/)
  assert.equal(sys().setPendingFeature('fieldbus', false), null, 'selecting the current value again clears the pending change')
  assert.deepEqual(sys().pending, {})
  assert.match(sys().setPendingFeature('bogus', true), /Unknown system feature/)
}))

test('DV09-108 administration is explicit: only System Admin can change preferences, and open applications block it', () => fixture((s, sys) => {
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(sys().setPendingFeature('fieldbus', true), /System Admin/)
  assert.match(useSecurity.getState().lastDenied, /Access Denied/)
  assert.match(sys().shutdownServer(), /System Admin/)
  assert.match(sys().connectServer(), /System Admin/)
  assert.match(sys().acknowledgePending(), /System Admin/)
  useSecurity.setState({ currentUser: 'admin' })
  sys().registerClient('DeltaV Explorer')
  sys().registerClient('DeltaV Control Studio')
  sys().registerClient('DeltaV Explorer')
  assert.deepEqual(sys().clients, ['DeltaV Explorer', 'DeltaV Control Studio'], 'a client registers once')
  assert.match(sys().setPendingFeature('fieldbus', true), /Close the database applications before you change System Preferences: DeltaV Explorer, DeltaV Control Studio/)
  sys().closeClient('DeltaV Explorer')
  assert.match(sys().setPendingFeature('fieldbus', true), /DeltaV Control Studio/)
  sys().closeAllClients()
  assert.equal(sys().setPendingFeature('fieldbus', true), null)
}))

test('DV09-109 acknowledge, shut down and connect: the server state and the feature change at the right moments', () => fixture((s, sys) => {
  assert.match(sys().acknowledgePending(), /no pending/)
  assert.equal(sys().setPendingFeature('fieldbus', true), null)
  assert.equal(sys().setPendingFeature('signaturePolicies', true), null)
  assert.match(sys().shutdownServer(), /Acknowledge the pending preference changes/)
  sys().registerClient('DeltaV Explorer')
  assert.equal(sys().acknowledgePending(), null)
  assert.match(sys().shutdownServer(), /Close the database applications before you shut down the server: DeltaV Explorer/)
  sys().closeAllClients()
  assert.match(sys().connectServer(), /already running/)
  assert.equal(sys().shutdownServer(), null)
  assert.equal(sys().serverState, 'STOPPED')
  assert.match(sys().shutdownServer(), /already stopped/)
  assert.deepEqual(sys().features, { fieldbus: false, signaturePolicies: false }, 'still not active while the server is stopped')
  assert.match(sys().setPendingFeature('fieldbus', false), /server is stopped/)
  assert.match(act.addH1Card('CTRL1', 5, false), /database server, which is stopped/)
  assert.equal(sys().connectServer(), null)
  assert.equal(sys().serverState, 'RUNNING')
  assert.equal(sys().restarts, 1)
  assert.deepEqual(sys().features, { fieldbus: true, signaturePolicies: true })
  assert.deepEqual(sys().pending, {})
  assert.equal(sys().acknowledged, false)
  assert.equal(act.addH1Card('CTRL1', 5, false), null, 'the feature is available after the restart')
  assert.equal(useStore.getState().setSignatureApplication({ operate: true }), true)
}))

test('DV09-109 while the server is stopped configuration and download are unavailable but operator writes keep running', () => fixture((s, sys) => {
  assert.equal(s.createArea('PLANT_AREA_A'), true)
  assert.equal(s.createModule({ tag: 'FIC-1', type: 'PID', area: 'PLANT_AREA_A', description: 'loop' }), true)
  assert.equal(sys().setPendingFeature('fieldbus', true), null)
  assert.equal(sys().acknowledgePending(), null)
  assert.equal(sys().shutdownServer(), null)
  assert.equal(s.createArea('PLANT_AREA_B'), false, 'configuration needs the database server')
  assert.match(useSecurity.getState().lastDenied, /database server, which is stopped/)
  assert.equal(useStore.getState().areas.includes('PLANT_AREA_B'), false)
  const before = useStore.getState().modules['FIC-1'].sp
  s.setSetpoint('FIC-1', before === 10 ? 11 : 10)
  assert.notEqual(useStore.getState().modules['FIC-1'].sp, before, 'operators can still write setpoints')
  assert.equal(sys().connectServer(), null)
  assert.equal(s.createArea('PLANT_AREA_B'), true, 'configuration works again after reconnecting')
}))

test('DV09-109 preferences and active features persist across an application restart; the server restarts running', () => {
  const store = new Map()
  global.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const path = require.resolve('../src/renderer/src/engine/systemPreferences.ts')
  const saved = require.cache[path]
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    delete require.cache[path]
    const first = require(path).useSystem
    assert.equal(first.getState().setPendingFeature('fieldbus', true), null)
    assert.equal(first.getState().acknowledgePending(), null)
    delete require.cache[path]
    const second = require(path).useSystem
    assert.deepEqual(second.getState().pending, { fieldbus: true })
    assert.equal(second.getState().acknowledged, true)
    assert.equal(second.getState().features.fieldbus, false)
    assert.equal(second.getState().shutdownServer(), null)
    assert.equal(second.getState().connectServer(), null)
    delete require.cache[path]
    const third = require(path).useSystem
    assert.equal(third.getState().features.fieldbus, true, 'an applied feature stays active after the application restarts')
    assert.deepEqual(third.getState().pending, {})
    assert.equal(third.getState().serverState, 'RUNNING')
    store.set('batchlive.system.v1', '{broken')
    delete require.cache[path]
    assert.equal(require(path).useSystem.getState().features.fieldbus, false, 'corrupt data falls back to the defaults')
  } finally {
    delete global.localStorage
    require.cache[path] = saved
    require(path)
  }
})

test('DV09-108/109 the System Preferences display shows active, pending and the server state', () => fixture((s, sys) => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { SystemPreferencesDisplay } = require('../src/renderer/src/displays/SystemPreferencesDisplay.tsx')
  const securityModule = require('../src/renderer/src/engine/security.ts')
  test.mock.method(sysModule, 'useSystem', (selector) => selector(useSystem.getState()))
  test.mock.method(securityModule, 'useSecurity', (selector) => selector(useSecurity.getState()))
  const text = () => renderToStaticMarkup(React.createElement(SystemPreferencesDisplay)).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.match(text(), /FOUNDATION fieldbus[^|]*No[^|]*Hidden/)
  sys().setPendingFeature('fieldbus', true)
  assert.match(text(), /Pending — takes effect after the server is restarted/)
  assert.match(text(), /Acknowledge preference changes/)
  sys().registerClient('DeltaV Explorer')
  assert.match(text(), /DeltaV Explorer/)
  sys().closeAllClients()
  sys().acknowledgePending()
  sys().shutdownServer()
  assert.match(text(), /Database server: Stopped/)
  sys().connectServer()
  assert.match(text(), /Database server: Running · restarts this session: 1/)
  assert.match(text(), /FOUNDATION fieldbus[^|]*Yes/)
  test.mock.restoreAll()
}))
