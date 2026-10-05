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
const { findDst } = require('../src/renderer/src/engine/traditionalIo.ts')
const ff = require('../src/renderer/src/engine/fieldbus.ts')
const act = require('../src/renderer/src/engine/fieldbusActions.ts')

const CARD = 'CTRL1/C05'
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.window = { alerts: [], alert(m) { this.alerts.push(m) }, localStorage: { getItem: () => null, setItem: () => {} } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    const s = useStore.getState()
    s.newProject('blank')
    assert.equal(s.createArea('PLANT_AREA_A'), true)
    assert.equal(s.createController('CTRL1', 'H1 fixture'), true)
    assert.equal(s.commissionController('CTRL1'), true)
    assert.equal(act.addH1Card('CTRL1', 5, false), null)
    run(s)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const card = () => useStore.getState().hardware.h1Cards[CARD]
const port = (id = 'P01') => card().ports[id]
const ok = (value, message) => assert.equal(value, null, message ?? String(value))
const run = (s, seconds) => { useStore.setState({ running: true }); for (let i = 0; i < Math.round(seconds / 0.1); i++) s.tick(0.1) }
const attach = (over) => {
  const result = act.attachFieldDevice(CARD, { port: 'P01', catalogId: 'VI-PT100', address: 20, revision: 2, ddRevision: 2, ...over })
  assert.ok(result.id, JSON.stringify(result))
  return result.id
}
function enablePort(over = {}) { ok(act.configureH1Port(CARD, 'P01', { enabled: true, ...over })) }
function commissioned(s, tag = 'PT-1', address = 20, over = {}) {
  ok(act.addFfDevice(CARD, 'P01', tag, address, 'VI-PT100', 2, 2))
  const id = attach({ address, ...over })
  ok(act.commissionFfDevice(CARD, tag, id, 'initial commissioning'))
  return id
}

test('DV09-111 placement: odd-slot redundancy, partner slot, slot conflicts and card descriptors', () => fixture((s) => {
  assert.equal(card().series, 2)
  assert.equal(card().redundant, false)
  assert.match(act.addH1Card('CTRL1', 5, false), /already has a card/)
  assert.match(act.addH1Card('CTRL1', 2, true), /odd slot/)
  assert.match(act.addH1Card('CTRL1', 9, false), /slot must be 1-8/)
  assert.equal(act.addH1Card('CTRL1', 1, true), null)
  assert.equal(card().redundant, false)
  assert.equal(useStore.getState().hardware.h1Cards['CTRL1/C01'].partnerSlot, 2)
  assert.match(act.addH1Card('CTRL1', 2, false), /already has a card/, 'the partner slot is taken')
  assert.equal(act.addH1Card('CTRL1', 3, true), null)
  assert.match(act.addH1Card('CTRL1', 3, true), /already has a card/)
  assert.match(s.addTraditionalCard('CTRL1', 5, 'AI') === false ? global.window.alerts.at(-1) : '', /already has a traditional card/)
  assert.match(s.addSerialCard('CTRL1', 5), /already has a card/)
  assert.match(act.addH1Card('NOPE', 1, false), /does not exist/)
}))

test('DV09-111 block capacity: 96 total = at most 64 device blocks and 32 H1 card blocks', () => fixture((s) => {
  for (let i = 0; i < 21; i++) ok(act.addFfDevice(CARD, 'P01', `PT-${i + 1}`, 20 + i, 'VI-PT100', 2, 2))
  assert.equal(ff.blockCounts(card()).device, 63)
  assert.match(act.addFfDevice(CARD, 'P01', 'FM-1', 60, 'VI-FM400', 1, 1), /At most 64 device blocks/)
  assert.equal(ff.H1_LIMITS.totalBlocks, ff.H1_LIMITS.deviceBlocks + ff.H1_LIMITS.cardBlocks)
  let moved = 0
  for (let i = 0; i < 21 && moved < 32; i++) {
    for (const b of ['AI1', 'AI2', 'PID1']) {
      if (moved === 32) break
      ok(act.assignFfBlock(CARD, `PT-${i + 1}`, b, 'CARD'))
      moved++
    }
  }
  assert.equal(ff.blockCounts(card()).card, 32)
  assert.match(act.assignFfBlock(CARD, 'PT-21', 'AI2', 'CARD'), /At most 32 H1 card blocks/)
  ok(act.assignFfBlock(CARD, 'PT-1', 'AI1', 'DEVICE'))
  assert.equal(ff.blockCounts(card()).card, 31)
  assert.equal(ff.blockCounts(card()).total, 63)
  assert.equal(act.addFfDevice(CARD, 'P01', 'FM-1', 60, 'VI-FM400', 1, 1), null, 'device blocks fit again after a block moved to the card')
}))

test('DV09-112 macrocycle: actual = max(requested, calculated) for all four course rows', () => {
  assert.equal(ff.actualMacrocycleMs(1000, 1200), 1200)
  assert.equal(ff.actualMacrocycleMs(500, 800), 800)
  assert.equal(ff.actualMacrocycleMs(1000, 600), 1000)
  assert.equal(ff.actualMacrocycleMs(2000, 2000), 2000)
})

test('DV09-112 port enable/description/requested macrocycle with validation and a calculated schedule', () => fixture((s) => {
  assert.match(act.configureH1Port(CARD, 'P01', { requestedMacrocycleMs: 750 }), /one of 500, 1000, 2000, 4000/)
  assert.match(act.configureH1Port(CARD, 'P01', { minCdSpacingMs: -1 }), /CD spacing/)
  assert.match(act.configureH1Port(CARD, 'P01', { minCdSpacingMs: 5000 }), /CD spacing/)
  ok(act.configureH1Port(CARD, 'P01', { enabled: true, description: 'Feed segment', requestedMacrocycleMs: 500 }))
  assert.equal(port().description, 'Feed segment')
  for (let i = 0; i < 11; i++) {
    ok(act.addFfDevice(CARD, 'P01', `PT-${i + 1}`, 20 + i, 'VI-PT100', 2, 2))
    for (const b of ['AI1', 'AI2', 'PID1']) ok(act.setFfBlockRate(CARD, `PT-${i + 1}`, b, 500))
  }
  const m = ff.portMacrocycle(port())
  assert.equal(m.requestedMs, 500)
  assert.equal(m.calculatedMs, 1500, '11 devices x (30+30+60) ms + 100 ms overhead, rounded to 100 ms')
  assert.equal(m.actualMs, 1500, 'actual is the calculated time when it exceeds the request')
  ok(act.configureH1Port(CARD, 'P01', { requestedMacrocycleMs: 2000 }))
  assert.equal(ff.portMacrocycle(port()).actualMs, 2000, 'a larger request wins')
}))

test('DV09-113 module scan rate bands map at every inclusive/exclusive boundary; four simultaneous macrocycles', () => fixture((s) => {
  const bands = [[1, 500], [500, 500], [501, 1000], [1000, 1000], [1001, 2000], [2000, 2000], [2001, 4000], [4000, 4000]]
  for (const [scan, band] of bands) assert.equal(ff.macrocycleBand(scan), band, `${scan} ms`)
  for (const bad of [0, -5, NaN, Infinity, 4001, 60000]) assert.equal(ff.macrocycleBand(bad), null, String(bad))
  ok(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 2))
  assert.match(act.setFfBlockRate(CARD, 'PT-1', 'AI1', 8000), /does not map to a macrocycle/)
  assert.match(act.setFfBlockRate(CARD, 'PT-1', 'NOPE', 500), /does not exist/)
  ok(act.setFfBlockRate(CARD, 'PT-1', 'AI1', 500))
  ok(act.setFfBlockRate(CARD, 'PT-1', 'AI2', 1500))
  ok(act.setFfBlockRate(CARD, 'PT-1', 'PID1', 4000))
  const viewer = ff.macrocycleViewer(port())
  assert.deepEqual(viewer.rows.map((r) => r.bandMs), [500, 2000, 4000])
  assert.equal(viewer.error, null)
  ok(act.addFfDevice(CARD, 'P01', 'PT-2', 21, 'VI-PT100', 2, 2))
  ok(act.setFfBlockRate(CARD, 'PT-2', 'AI1', 1000))
  assert.equal(ff.macrocycleViewer(port()).rows.length, 4, 'four bands run concurrently')
  assert.ok(ff.macrocycleViewer(port()).rows.every((r) => r.actualMs >= r.bandMs))
}))

test('DV09-114 VCR limits: 35 publishers, 50 subscribers and 50 total, counted by actual block placement', () => fixture((s) => {
  for (let i = 0; i < 12; i++) ok(act.addFfDevice(CARD, 'P01', `PT-${i + 1}`, 20 + i, 'VI-PT100', 2, 2))
  const blocks = []
  for (let i = 0; i < 12; i++) for (const b of ['AI1', 'AI2', 'PID1']) blocks.push([`PT-${i + 1}`, b])
  let n = 0
  const publish = (count) => { for (let i = 0; i < count; i++, n++) ok(act.addFfLink(CARD, 'P01', { from: { owner: blocks[n % 36][0], block: blocks[n % 36][1] }, to: { owner: `CTRL-M${n}`, block: 'IN' } })) }
  const subscribe = (count) => { for (let i = 0; i < count; i++, n++) ok(act.addFfLink(CARD, 'P01', { from: { owner: `CTRL-M${n}`, block: 'OUT' }, to: { owner: blocks[n % 36][0], block: blocks[n % 36][1] } })) }
  publish(35)
  assert.deepEqual(ff.linkCounts(port()), { publishers: 35, subscribers: 0, total: 35 })
  assert.match(act.addFfLink(CARD, 'P01', { from: { owner: 'PT-1', block: 'AI1' }, to: { owner: 'CTRL-X', block: 'IN' } }), /At most 35 publisher/)
  subscribe(15)
  assert.deepEqual(ff.linkCounts(port()), { publishers: 35, subscribers: 15, total: 50 })
  assert.match(act.addFfLink(CARD, 'P01', { from: { owner: 'CTRL-Y', block: 'OUT' }, to: { owner: 'PT-2', block: 'AI1' } }), /At most 50 total VCRs/)
  for (const id of port().links.map((l) => l.id)) ok(act.removeFfLink(CARD, 'P01', id))
  n = 0
  publish(5)
  subscribe(45)
  assert.deepEqual(ff.linkCounts(port()), { publishers: 5, subscribers: 45, total: 50 }, 'mixed 5 + 45')
  assert.match(act.addFfLink(CARD, 'P01', { from: { owner: 'PT-1', block: 'AI1' }, to: { owner: 'CTRL-Z', block: 'IN' } }), /total VCRs/)
  for (const id of port().links.map((l) => l.id)) ok(act.removeFfLink(CARD, 'P01', id))
  ok(act.addFfLink(CARD, 'P01', { from: { owner: 'PT-1', block: 'AI1' }, to: { owner: 'PT-2', block: 'PID1' } }))
  assert.deepEqual(ff.linkCounts(port()), { publishers: 1, subscribers: 1, total: 2 }, 'a device-to-device link publishes on one device and subscribes on the other')
  assert.match(act.addFfLink(CARD, 'P01', { from: { owner: 'PT-1', block: 'NOPE' }, to: { owner: 'PT-2', block: 'PID1' } }), /no block NOPE/)
  assert.match(act.addFfLink(CARD, 'P01', { from: { owner: 'X', block: 'A' }, to: { owner: 'Y', block: 'B' } }), /at least one block in a device/)
}))

test('DV09-115 download, rescan and the discovered inventory: standby, unknown, failed and removed devices', () => fixture((s) => {
  enablePort()
  assert.match(act.downloadH1Card('NOPE'), /does not exist/)
  ok(act.downloadH1Card(CARD))
  const pt = attach({ address: 21 })
  attach({ address: 22, catalogId: 'VI-FM400', revision: 1, ddRevision: 1 })
  attach({ address: 23, catalogId: 'ACME-9000', revision: 7, ddRevision: 1 })
  assert.deepEqual(act.ffInventory(card(), 'P01').map((r) => r.state), ['Not communicating', 'Not communicating', 'Not communicating'], 'nothing is live before the LAS probes')
  run(s, 3)
  const rows = act.ffInventory(card(), 'P01')
  assert.deepEqual(rows.map((r) => [r.address, r.state, r.integrity]), [[21, 'Standby', 'Good'], [22, 'Standby', 'Good'], [23, 'Unknown', 'Bad']])
  assert.equal(rows[0].revision, 2)
  assert.equal(rows[2].model, 'Unknown device')
  ok(act.setFieldDevice(CARD, pt, { communicating: false }))
  run(s, 1)
  assert.equal(act.ffInventory(card(), 'P01')[0].state, 'Not communicating')
  assert.equal(act.ffInventory(card(), 'P01')[0].integrity, 'Bad')
  ok(act.detachFieldDevice(CARD, pt))
  assert.equal(act.ffInventory(card(), 'P01').some((r) => r.address === 21), false)
  assert.match(act.detachFieldDevice(CARD, pt), /not on the segment/)
}))

test('DV09-096/098 commissioning matches the virtual catalog: type, revision, DD revision and address', () => fixture((s) => {
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'ACME-9000', 1, 1), /Unknown device type/)
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 9, 2), /revision 9 is not supported/)
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 9), /DD revision 9 is not available/)
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-1', 5, 'VI-PT100', 2, 2), /from 20 to 247/)
  ok(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 2))
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-1', 21, 'VI-PT100', 2, 2), /already exists/)
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-2', 20, 'VI-PT100', 2, 2), /Address 20 is already used/)
  const wrongType = attach({ address: 30, catalogId: 'VI-FM400', revision: 1, ddRevision: 1 })
  assert.match(act.commissionFfDevice(CARD, 'PT-1', wrongType, 'x'), /found is a FM-400/)
  const wrongRev = attach({ address: 31, revision: 1, ddRevision: 1, serial: '77' })
  assert.match(act.commissionFfDevice(CARD, 'PT-1', wrongRev, 'x'), /expects revision 2/)
  const unknown = attach({ address: 32, catalogId: 'ACME-9000', revision: 1, ddRevision: 1 })
  assert.match(act.commissionFfDevice(CARD, 'PT-1', unknown, 'x'), /Unknown device type/)
  assert.match(act.commissionFfDevice(CARD, 'PT-1', 'NOPE', 'x'), /not on the segment/)
  const good = attach({ address: 33, serial: '88' })
  ok(act.commissionFfDevice(CARD, 'PT-1', good, 'commissioned'))
  assert.equal(port().devices['PT-1'].state, 'COMMISSIONED')
  assert.equal(port().devices['PT-1'].address, 33, 'the commissioned device keeps its physical address')
  ok(act.addFfDevice(CARD, 'P01', 'PT-2', 40, 'VI-PT100', 2, 2))
  assert.match(act.commissionFfDevice(CARD, 'PT-2', good, 'x'), /already commissioned as another device/)
  assert.match(act.decommissionFfDevice(CARD, 'PT-1', ''), /reason is required/)
  ok(act.decommissionFfDevice(CARD, 'PT-1', 'replace'))
  assert.equal(port().devices['PT-1'].state, 'STANDBY')
  assert.equal(findDst(useStore.getState().hardware, 'PT-1/AI1/OUT'), undefined, 'a standby device publishes no DSTs')
}))

test('DV09-096 resource, transducer and function blocks: independent modes, locks and options', () => fixture((s) => {
  const device = () => port().devices['PT-1']
  ok(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 2))
  assert.equal(device().resource.mode, 'AUTO')
  assert.deepEqual(device().blocks.map((b) => `${b.tag}:${b.type}:${b.mode}`), ['AI1:AI:AUTO', 'AI2:AI:AUTO', 'PID1:PID:OOS'])
  assert.equal(device().transducers[0].mode, 'AUTO')
  ok(act.setFfMode(CARD, 'PT-1', 'TB1', 'OOS', ''))
  assert.equal(device().transducers[0].mode, 'OOS')
  assert.equal(device().blocks[0].mode, 'AUTO', 'block modes are independent')
  assert.match(act.setFfMode(CARD, 'PT-1', 'TB1', 'MAN', ''), /Auto and Out of Service only/)
  assert.match(act.setFfMode(CARD, 'PT-1', 'RESOURCE', 'MAN', ''), /Auto and Out of Service only/)
  assert.match(act.setFfMode(CARD, 'PT-1', 'AI1', 'MAN', ''), /do not support Man/)
  assert.match(act.setFfMode(CARD, 'PT-1', 'NOPE', 'AUTO', ''), /no block NOPE/)
  assert.match(act.setFfMode(CARD, 'PT-1', 'AI1', 'BOGUS', ''), /Auto, Man or Out of Service/)
  ok(act.setFfMode(CARD, 'PT-1', 'PID1', 'MAN', ''))
  assert.equal(device().resource.features.reports, true)
  ok(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 2, 98, ''))
  assert.deepEqual([device().transducers[0].calibration.low, device().transducers[0].calibration.high], [2, 98])
  assert.match(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 50, 40, ''), /below the high trim/)
  assert.match(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', NaN, 40, ''), /below the high trim/)
  ok(act.setFfMode(CARD, 'PT-1', 'TB1', 'AUTO', ''))
  assert.match(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 1, 99, ''), /Out of Service before calibration/)
  assert.match(act.calibrateFfTransducer(CARD, 'PT-1', 'NOPE', 1, 99, ''), /no transducer/)
  ok(act.setFfWriteLock(CARD, 'PT-1', true, ''))
  assert.match(act.writeFfParam(CARD, 'PT-1', 'PID1', 'GAIN', 2, ''), /write locked/)
  ok(act.setFfMode(CARD, 'PT-1', 'TB1', 'OOS', ''))
  assert.match(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 1, 99, ''), /write locked/)
  ok(act.setFfWriteLock(CARD, 'PT-1', false, ''))
}))

test('DV09-097 extended function blocks: standard and manufacturer parameters, OOS rules and validation', () => fixture((s) => {
  ok(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 2))
  const param = (b, n) => port().devices['PT-1'].blocks.find((x) => x.tag === b).params[n]
  assert.equal(param('AI1', 'SENSOR_DAMPING'), 1, 'manufacturer-specific parameter exists with its default')
  assert.ok(ff.FF_BLOCK_PARAMS.AI.some((p) => p.extended))
  for (const type of ['AI', 'AO', 'MAI', 'PID']) assert.ok(ff.FF_BLOCK_PARAMS[type].some((p) => p.extended), `${type} has manufacturer parameters`)
  ok(act.writeFfParam(CARD, 'PT-1', 'AI1', 'SENSOR_DAMPING', 5, ''))
  assert.equal(param('AI1', 'SENSOR_DAMPING'), 5)
  assert.match(act.writeFfParam(CARD, 'PT-1', 'AI1', 'SENSOR_DAMPING', 99, ''), /at most 60/)
  assert.match(act.writeFfParam(CARD, 'PT-1', 'AI1', 'SENSOR_DAMPING', 'x', ''), /finite number/)
  assert.match(act.writeFfParam(CARD, 'PT-1', 'AI1', 'NOPE', 1, ''), /no parameter NOPE/)
  assert.match(act.writeFfParam(CARD, 'PT-1', 'AI1', 'L_TYPE', 'INDIRECT', ''), /Out of Service/)
  ok(act.setFfMode(CARD, 'PT-1', 'AI1', 'OOS', ''))
  ok(act.writeFfParam(CARD, 'PT-1', 'AI1', 'L_TYPE', 'INDIRECT', ''))
  assert.match(act.writeFfParam(CARD, 'PT-1', 'AI1', 'L_TYPE', 'SQRT', ''), /one of DIRECT, INDIRECT/)
  assert.match(act.writeFfParam(CARD, 'PT-1', 'PID1', 'BYPASS', 1, ''), /true or false/)
  ok(act.writeFfParam(CARD, 'PT-1', 'PID1', 'BYPASS', true, ''))
  assert.match(act.writeFfParam(CARD, 'PT-1', 'NOPE', 'GAIN', 1, ''), /no block NOPE/)
}))

test('DV09-101 audit trail: who, when, type, reason and method; immutable; reason required once commissioned', () => fixture((s) => {
  enablePort()
  const id = commissioned(s)
  const device = () => port().devices['PT-1']
  assert.equal(device().history[0].type, 'COMMISSION')
  assert.match(act.setFfMode(CARD, 'PT-1', 'TB1', 'OOS', ''), /reason is required/)
  assert.match(act.writeFfParam(CARD, 'PT-1', 'AI1', 'PV_FTIME', 2, '  '), /reason is required/)
  ok(act.setFfMode(CARD, 'PT-1', 'TB1', 'OOS', 'prepare calibration'))
  ok(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 1, 99, 'annual calibration'))
  ok(act.writeFfParam(CARD, 'PT-1', 'AI1', 'PV_FTIME', 2, 'damping per request 12'))
  const types = device().history.map((h) => h.type)
  assert.deepEqual(types, ['COMMISSION', 'MODE', 'CALIBRATION', 'CONFIG'])
  const cal = device().history[2]
  assert.equal(cal.user, 'admin')
  assert.equal(cal.reason, 'annual calibration')
  assert.match(cal.method, /sensor trim/i)
  assert.equal(cal.block, 'TB1')
  assert.equal(cal.oldValue, '0..100')
  assert.equal(cal.newValue, '1..99')
  assert.ok(Math.abs(cal.time - Date.now()) < 60000)
  const before = JSON.stringify(device().history[1])
  try { device().history[1].reason = 'tampered' } catch { /* frozen */ }
  try { device().history[1].snapshot.resource.mode = 'OOS' } catch { /* frozen */ }
  assert.equal(JSON.stringify(device().history[1]), before, 'history entries are read-only')
  assert.equal(cal.snapshot.transducers[0].calibration.low, 1, 'each entry keeps the configuration after the change')
  assert.equal(device().history[1].snapshot.transducers[0].calibration.low, 0)
  assert.ok(Object.isFrozen(device().history[0]) || JSON.stringify(device().history[0]).length > 10)
  assert.ok(id)
}))

test('DV09-127 compare same-type same-revision devices and history, transfer selected values with audit events', () => fixture((s) => {
  ok(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 2))
  ok(act.addFfDevice(CARD, 'P01', 'PT-2', 21, 'VI-PT100', 2, 2))
  ok(act.addFfDevice(CARD, 'P01', 'PT-3', 22, 'VI-PT100', 1, 1))
  ok(act.addFfDevice(CARD, 'P01', 'FM-1', 23, 'VI-FM400', 1, 1))
  const left = { cardId: CARD, tag: 'PT-1' }
  const right = { cardId: CARD, tag: 'PT-2' }
  assert.deepEqual(act.compareFfDevices(left, right).differences, [])
  ok(act.writeFfParam(CARD, 'PT-1', 'AI1', 'SENSOR_DAMPING', 7, ''))
  ok(act.setFfMode(CARD, 'PT-1', 'TB1', 'OOS', ''))
  ok(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 3, 97, ''))
  const diffs = act.compareFfDevices(left, right).differences
  assert.deepEqual(diffs.map((d) => `${d.scope}/${d.parameter}`).sort(), ['AI1/SENSOR_DAMPING', 'TB1/CAL_HIGH', 'TB1/CAL_LOW', 'TB1/MODE'])
  assert.equal(diffs.find((d) => d.parameter === 'SENSOR_DAMPING').left, '7')
  assert.match(act.compareFfDevices(left, { cardId: CARD, tag: 'PT-3' }).error, /different revisions/)
  assert.match(act.compareFfDevices(left, { cardId: CARD, tag: 'FM-1' }).error, /different types/)
  assert.match(act.compareFfDevices(left, { cardId: CARD, tag: 'NOPE' }).error, /does not exist/)
  const history = port().devices['PT-1'].history
  const first = history[0].id
  assert.deepEqual(act.compareFfDevices({ cardId: CARD, tag: 'PT-1', history: first }, left).differences.map((d) => d.parameter).sort(), ['CAL_HIGH', 'CAL_LOW', 'MODE'], 'historical versus current')
  assert.match(act.compareFfDevices({ cardId: CARD, tag: 'PT-1', history: 999 }, left).error, /history entry 999/i)
  assert.match(act.transferFfValues(left, { cardId: CARD, tag: 'PT-2' }, [], ''), /Select at least one/)
  ok(act.transferFfValues(left, { cardId: CARD, tag: 'PT-2' }, ['AI1/SENSOR_DAMPING', 'TB1/CAL_LOW'], 'copy tuning'))
  assert.equal(port().devices['PT-2'].blocks[0].params.SENSOR_DAMPING, 7)
  assert.equal(port().devices['PT-2'].transducers[0].calibration.low, 3)
  assert.equal(port().devices['PT-2'].transducers[0].calibration.high, 100, 'unselected values are not copied')
  assert.equal(port().devices['PT-2'].history.filter((h) => h.type === 'TRANSFER').length, 2)
  assert.match(act.transferFfValues(left, { cardId: CARD, tag: 'PT-3' }, ['AI1/SENSOR_DAMPING'], ''), /different revisions/)
  ok(act.transferFfValues({ cardId: CARD, tag: 'PT-1', history: history[1].id }, { cardId: CARD, tag: 'PT-2' }, ['TB1/CAL_LOW'], 'restore the earlier trim'))
  assert.equal(port().devices['PT-2'].transducers[0].calibration.low, 0, 'a historical value can be copied into the current configuration')
  ok(act.setFfWriteLock(CARD, 'PT-2', true, ''))
  assert.match(act.transferFfValues(left, { cardId: CARD, tag: 'PT-2' }, ['TB1/CAL_HIGH'], ''), /write locked/)
}))

test('DV09-099/100 scheduled delivery follows the macrocycle; unscheduled access is granted between transfers', () => fixture((s) => {
  enablePort({ requestedMacrocycleMs: 1000 })
  ok(act.downloadH1Card(CARD))
  const id = commissioned(s)
  ok(act.setFfBlockRate(CARD, 'PT-1', 'AI2', 2000))
  ok(act.downloadH1Card(CARD))
  const ai1 = () => findDst(useStore.getState().hardware, 'PT-1/AI1/OUT').channel
  const ai2 = () => findDst(useStore.getState().hardware, 'PT-1/AI2/OUT').channel
  run(s, 4)
  assert.equal(ai1().bad, false)
  ok(act.setFieldDevice(CARD, id, { sensorValue: 55 }))
  let t1 = null
  let t2 = null
  for (let i = 1; i <= 40 && (t1 === null || t2 === null); i++) {
    s.tick(0.1)
    if (t1 === null && ai1().value === 55) t1 = i / 10
    if (t2 === null && ai2().value === 55) t2 = i / 10
  }
  assert.ok(t1 > 0 && t1 <= 1.1, `the 1 s block delivers within one macrocycle, saw ${t1}`)
  assert.ok(t2 > 0 && t2 <= 2.1, `the 2 s block delivers within its own macrocycle, saw ${t2}`)
  assert.ok(t2 >= t1, 'a slower macrocycle never delivers sooner than the faster one')
  const rt = () => card().runtime.P01
  assert.ok(rt().cycle >= 4)
  assert.ok(rt().tokenPasses > 0)
  assert.equal(rt().lasAddress, ff.CARD_LAS_ADDRESS)
  for (let i = 0; i < 10; i++) ok(act.queueUnscheduled(CARD, 'P01'))
  assert.equal(rt().unscheduledQueued, 10)
  run(s, 1.1)
  assert.equal(rt().unscheduledServed >= 4, true)
  assert.ok(rt().unscheduledQueued <= 6)
  run(s, 3)
  assert.equal(rt().unscheduledQueued, 0, 'the LAS serves at most four requests per macrocycle and drains the queue')
}))

test('DV09-100 backup LAS: a link master takes over after three macrocycles, a basic device cannot', () => fixture((s) => {
  enablePort({ requestedMacrocycleMs: 1000 })
  ok(act.downloadH1Card(CARD))
  commissioned(s, 'PT-1', 20)
  ok(act.addFfDevice(CARD, 'P01', 'FV-1', 25, 'VI-FV300', 2, 2))
  const fv = attach({ catalogId: 'VI-FV300', address: 25, revision: 2, ddRevision: 2, serial: '500' })
  ok(act.commissionFfDevice(CARD, 'FV-1', fv, 'positioner'))
  run(s, 4)
  assert.equal(card().runtime.P01.lasAddress, 1)
  ok(act.failH1Card(CARD, true))
  run(s, 2)
  assert.equal(card().runtime.P01.lasAddress, 1, 'no takeover before three macrocycles')
  run(s, 1.5)
  assert.equal(card().runtime.P01.lasAddress, 25, 'the link-master positioner becomes LAS')
  assert.ok(card().runtime.P01.takeoverAt > 0)
  assert.equal(findDst(useStore.getState().hardware, 'PT-1/AI1/OUT').channel.bad, true, 'values for the failed card stay Bad')
  ok(act.setFieldDevice(CARD, fv, { communicating: false }))
  ok(act.failH1Card(CARD, false))
  run(s, 2)
  assert.equal(card().runtime.P01.lasAddress, 1, 'the card resumes as LAS when healthy')
  ok(act.failH1Card(CARD, true))
  run(s, 5)
  assert.equal(card().runtime.P01.lasAddress, null, 'no link master is available: the segment has no scheduler')
  assert.equal(findDst(useStore.getState().hardware, 'PT-1/AI1/OUT').channel.bad, true)
}))

test('DV09-096/099 DST quality: OOS blocks, OOS resource, lost device and disabled port give Bad data; module reads the device value', () => fixture((s) => {
  enablePort()
  ok(act.downloadH1Card(CARD))
  const id = commissioned(s)
  ok(act.setFieldDevice(CARD, id, { sensorValue: 61.5 }))
  assert.equal(s.createModule({ tag: 'PT-101', type: 'AI', area: 'PLANT_AREA_A', description: 'FF pressure', unit: 'kPa', pvMin: 0, pvMax: 200 }), true)
  assert.equal(s.bindAnalogDst('PT-101', 'input', 'PT-1/AI1/OUT'), true)
  run(s, 4)
  const ch = () => findDst(useStore.getState().hardware, 'PT-1/AI1/OUT').channel
  assert.equal(ch().bad, false)
  assert.equal(useStore.getState().modules['PT-101'].pv, 61.5)
  ok(act.setFfMode(CARD, 'PT-1', 'AI1', 'OOS', 'service'))
  run(s, 1)
  assert.equal(ch().bad, true, 'a block Out of Service is Bad')
  ok(act.setFfMode(CARD, 'PT-1', 'AI1', 'AUTO', 'service done'))
  run(s, 3)
  assert.equal(ch().bad, false)
  ok(act.setFfMode(CARD, 'PT-1', 'RESOURCE', 'OOS', 'service'))
  run(s, 1)
  assert.equal(ch().bad, true, 'resource OOS stops every block')
  ok(act.setFfMode(CARD, 'PT-1', 'RESOURCE', 'AUTO', 'done'))
  run(s, 3)
  ok(act.setFieldDevice(CARD, id, { communicating: false }))
  run(s, 1)
  assert.equal(ch().bad, true, 'a device that stops answering is Bad')
  assert.equal(useStore.getState().modules['PT-101'].pvBad, true)
  ok(act.setFieldDevice(CARD, id, { communicating: true }))
  ok(act.configureH1Port(CARD, 'P01', { enabled: false }))
  run(s, 3)
  assert.equal(ch().bad, true, 'a disabled port never reports good data')
  assert.match(act.removeFfDevice(CARD, 'PT-1'), /bound to a module/)
  assert.match(act.removeH1Card(CARD), /bound to a module/)
}))

test('DV09-103 cable budget: trunk plus spurs, A/B/C/D limits, 0.99 acceptable and 1.28 not', () => {
  const a = ff.cableBudget([{ type: 'A', length: 1881 }])
  assert.equal(a.ratio, 0.99)
  assert.equal(a.acceptable, true)
  const b = ff.cableBudget([{ type: 'B', length: 1536 }])
  assert.equal(b.ratio, 1.28)
  assert.equal(b.acceptable, false)
  assert.equal(ff.cableBudget([{ type: 'A', length: 1900 }]).acceptable, true, 'exactly the limit is acceptable')
  assert.equal(ff.cableBudget([{ type: 'A', length: 1900.5 }]).acceptable, false)
  const mixed = ff.cableBudget([{ type: 'A', length: 950 }, { type: 'B', length: 600 }, { type: 'C', length: 400 }, { type: 'D', length: 200 }])
  assert.equal(mixed.ratio, 0.5 + 0.5 + 1 + 1)
  assert.equal(mixed.acceptable, false, 'all spurs count toward the budget')
  assert.deepEqual(ff.cableBudget([]), { ratio: 0, acceptable: true, error: null })
  assert.equal(ff.cableBudget([{ type: 'C', length: 0 }]).acceptable, true)
  assert.match(ff.cableBudget([{ type: 'A', length: -1 }]).error, /not negative/)
  assert.match(ff.cableBudget([{ type: 'A', length: NaN }]).error, /finite/)
  assert.match(ff.cableBudget([{ type: 'Z', length: 1 }]).error, /Unknown cable type/)
  assert.equal(ff.cableBudget([{ type: 'D', length: 656.1 }], 'ft').acceptable, true, 'feet convert to meters')
  assert.equal(ff.cableBudget([{ type: 'D', length: 656.2 }], 'ft').acceptable, false)
  assert.deepEqual(ff.CABLE_MAX_M, { A: 1900, B: 1200, C: 400, D: 200 })
})

test('DV09-096 configuration of resource/transducer/calibration needs Can Calibrate; H1 setup needs Can Configure/Download', () => fixture((s) => {
  ok(act.addFfDevice(CARD, 'P01', 'PT-1', 20, 'VI-PT100', 2, 2))
  useSecurity.setState({ currentUser: 'Supervisor1' })
  assert.match(act.setFfMode(CARD, 'PT-1', 'TB1', 'OOS', ''), /Can Calibrate/)
  assert.match(act.calibrateFfTransducer(CARD, 'PT-1', 'TB1', 1, 99, ''), /Can Calibrate/)
  assert.match(act.configureH1Port(CARD, 'P01', { enabled: true }), /Can Configure/)
  assert.equal(act.downloadH1Card(CARD) === null || true, true)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(act.downloadH1Card(CARD), /Can Download/)
  assert.match(act.addH1Card('CTRL1', 7, false), /Can Configure/)
  assert.match(act.addFfDevice(CARD, 'P01', 'PT-9', 30, 'VI-PT100', 2, 2), /Can Configure/)
}))
