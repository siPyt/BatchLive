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
const { useUi } = require('../src/renderer/src/ui/uiStore.ts')
const { alarmEligible } = require('../src/renderer/src/utils/format.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), ui: useUi.getState(), window: global.window }
  global.window = { alert: () => {} }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    s.newProject('blank')
    useStore.setState({ running: true })
    if (!s.areas.includes('DRYING')) assert.equal(s.createArea('DRYING'), true)
    assert.equal(s.createModule({ tag: 'FEED-01', type: 'MOTOR', area: 'FEED', description: 'Feed pump' }), true)
    assert.equal(s.createModule({ tag: 'DRY-01', type: 'MOTOR', area: 'DRYING', description: 'Dryer fan' }), true)
    run(s)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    useUi.setState(before.ui, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

const feedAlarm = { id: 'a-feed', moduleTag: 'FEED-01', priority: 'CRITICAL', active: true, acknowledged: false, time: 1 }
const dryAlarm = { id: 'a-dry', moduleTag: 'DRY-01', priority: 'CRITICAL', active: true, acknowledged: false, time: 1 }
const orphanAlarm = { id: 'a-orphan', moduleTag: 'GONE-01', priority: 'CRITICAL', active: true, acknowledged: false, time: 1 }

test('DV09-044 security.hasAreaKey: unrestricted by default, restricts once a user is given explicit area keys', () => fixture(() => {
  const sec = useSecurity.getState()
  assert.equal(sec.users.find((u) => u.name === 'admin').areas, undefined)
  assert.equal(sec.hasAreaKey('FEED'), true, 'unrestricted admin is authorized for any area')
  assert.equal(sec.hasAreaKey(undefined), true, 'unrestricted admin is authorized even for an alarm with no resolvable area')

  sec.setUserAreas('admin', ['FEED'])
  assert.equal(useSecurity.getState().hasAreaKey('FEED'), true)
  assert.equal(useSecurity.getState().hasAreaKey('DRYING'), false)
  assert.equal(useSecurity.getState().hasAreaKey(undefined), false, 'a restricted user is never authorized for an unresolvable area')

  useSecurity.getState().setUserAreas('admin', undefined)
  assert.equal(useSecurity.getState().hasAreaKey('DRYING'), true, 'clearing areas restores unrestricted access')
}))

test('DV09-044 uiStore.subscribedAreas: null (default) subscribes to every area; an array restricts it', () => {
  const before = useUi.getState()
  try {
    assert.equal(useUi.getState().subscribedAreas, null)
    useUi.getState().setSubscribedAreas(['FEED'])
    assert.deepEqual(useUi.getState().subscribedAreas, ['FEED'])
    useUi.getState().setSubscribedAreas(null)
    assert.equal(useUi.getState().subscribedAreas, null)
  } finally {
    useUi.setState(before, true)
  }
})

test('DV09-044 alarmEligible: counts/tiles/horn/ack-page must use subscribed-AND-authorized intersection', () => fixture((s) => {
  const hasAreaKeyAll = () => true
  const hasAreaKeyFeedOnly = (area) => area === 'FEED'

  // Neither subscribed nor authorized restriction: everything eligible, including an orphaned alarm.
  assert.equal(alarmEligible(feedAlarm, 'FEED', null, hasAreaKeyAll), true)
  assert.equal(alarmEligible(orphanAlarm, undefined, null, hasAreaKeyAll), true)

  // Subscribed-but-not-authorized: workstation subscribes to FEED, but the user's area keys deny FEED.
  assert.equal(alarmEligible(feedAlarm, 'FEED', ['FEED'], () => false), false)

  // Authorized-but-not-subscribed: user is authorized for FEED, but the workstation only subscribes to DRYING.
  assert.equal(alarmEligible(feedAlarm, 'FEED', ['DRYING'], hasAreaKeyAll), false)

  // Both subscribed and authorized: eligible.
  assert.equal(alarmEligible(feedAlarm, 'FEED', ['FEED'], hasAreaKeyFeedOnly), true)

  // Neither subscribed nor authorized: not eligible.
  assert.equal(alarmEligible(dryAlarm, 'DRYING', ['FEED'], hasAreaKeyFeedOnly), false)

  // A workstation subscription list never admits an alarm whose module no longer resolves to an area.
  assert.equal(alarmEligible(orphanAlarm, undefined, ['FEED'], hasAreaKeyAll), false)

  // End-to-end through the real store/security/ui state for the two live modules created in this fixture.
  useSecurity.getState().setUserAreas('admin', ['FEED'])
  useUi.getState().setSubscribedAreas(['FEED', 'DRYING'])
  const modules = useStore.getState().modules
  assert.equal(alarmEligible(feedAlarm, modules['FEED-01'].area, useUi.getState().subscribedAreas, useSecurity.getState().hasAreaKey), true)
  assert.equal(alarmEligible(dryAlarm, modules['DRY-01'].area, useUi.getState().subscribedAreas, useSecurity.getState().hasAreaKey), false,
    'DRYING is subscribed by the workstation but not authorized by the user\u2019s area keys')
}))
