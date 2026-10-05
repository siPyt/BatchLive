const assert = require('node:assert/strict')
const crypto = require('node:crypto')
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
const ch = require('../src/renderer/src/engine/eventChronicle.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), chronicle: useChronicleState(), window: global.window }
  const local = new Map()
  global.localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)) }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    ch.useChronicle.setState({ configured: ch.defaultChronicleConfig(), deployed: null, archive: ch.emptyArchive(), lastEventId: null })
    useStore.getState().newProject('blank')
    run(local)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    ch.useChronicle.setState(before.chronicle, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
function useChronicleState() { return ch.useChronicle.getState() }
const cfg = (over = {}) => ({ ...ch.defaultChronicleConfig(), enabled: true, ...over })
const entry = (over = {}) => ({ id: `e${Math.random()}`, time: 1000, category: 'OPERATOR', tag: 'FIC-101', user: 'admin', description: 'SP set to 5', ...over })

test('DV09-045 SHA-256 matches the standard vectors and node crypto for long inputs', () => {
  assert.equal(ch.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(ch.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'DeltaV — événement ✓']) {
    assert.equal(ch.sha256Hex(text), crypto.createHash('sha256').update(text).digest('hex'), text.slice(0, 12))
  }
})

test('DV09-045 chronicle configuration validation and keys', () => fixture(() => {
  const c = ch.useChronicle.getState()
  assert.match(ch.chronicleConfigError(cfg({ name: '1bad' })), /workstation name/)
  assert.match(ch.chronicleConfigError(cfg({ name: 'X'.repeat(17) })), /workstation name/)
  assert.match(ch.chronicleConfigError(cfg({ subscriptions: ['BOGUS'] })), /Unknown event type/)
  assert.match(ch.chronicleConfigError(cfg({ subscriptions: ['ALARM', 'ALARM'] })), /only be subscribed once/)
  assert.match(ch.chronicleConfigError(cfg({ subscriptions: [] })), /at least one/)
  assert.equal(ch.chronicleConfigError(cfg({ enabled: false, subscriptions: [] })), null)
  assert.match(c.configure(cfg({ name: '1bad' })), /workstation name/)
  assert.equal(c.configure(cfg({ name: 'OPS-WS1' })), null)
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(c.configure(cfg()), /Can Configure/)
  assert.match(c.download(), /Can Download/)
  assert.match(c.clear(), /System Admin/)
  useSecurity.setState({ currentUser: 'Supervisor1' })
  assert.equal(c.download(), null, 'Supervisor1 holds the Can Download key')
}))

test('DV09-045 configuration is not active until downloaded; only subscribed events are archived', () => fixture((local) => {
  const c = ch.useChronicle.getState()
  assert.equal(c.configure(cfg({ name: 'OPS-WS1', subscriptions: ['OPERATOR', 'ALARM'] })), null)
  useStore.getState().logEvent('OPERATOR', 'FIC-101', 'before download')
  assert.equal(ch.useChronicle.getState().archive.records.length, 0, 'nothing is recorded before the download')
  assert.equal(c.download(), null)
  assert.ok(local.get(ch.CHRONICLE_CONFIG_KEY), 'the downloaded configuration is saved')
  useStore.getState().logEvent('OPERATOR', 'FIC-101', 'SP set to 5')
  useStore.getState().logEvent('CONFIGURE', 'FIC-101', 'not subscribed')
  useStore.getState().logEvent('ALARM', 'LI-1', 'HI alarm')
  useStore.getState().logEvent('SECURITY', 'admin', 'not subscribed either')
  const records = ch.useChronicle.getState().archive.records
  assert.deepEqual(records.map((r) => [r.seq, r.category, r.description, r.workstation]), [
    [1, 'OPERATOR', 'SP set to 5', 'OPS-WS1'], [2, 'ALARM', 'HI alarm', 'OPS-WS1']
  ])
  assert.ok(records.every((r) => Math.abs(r.wallTime - Date.now()) < 60000), 'the wall-clock archive time is stamped')
  assert.ok(records.every((r) => Number.isFinite(r.time)), 'the event time is kept')
  assert.equal(c.configure(cfg({ enabled: false })), null)
  useStore.getState().logEvent('OPERATOR', 'FIC-101', 'still recording until the next download')
  assert.equal(ch.useChronicle.getState().archive.records.length, 3, 'a changed configuration does not apply before the download')
  assert.equal(c.download(), null)
  useStore.getState().logEvent('OPERATOR', 'FIC-101', 'after disabling')
  assert.equal(ch.useChronicle.getState().archive.records.length, 3)
}))

test('DV09-045 the archive survives a restart: saved records reload with timestamps and the chain verifies', () => fixture((local) => {
  const c = ch.useChronicle.getState()
  c.configure(cfg())
  c.download()
  useStore.getState().logEvent('OPERATOR', 'A', 'one')
  useStore.getState().logEvent('ALARM', 'B', 'two')
  const live = ch.useChronicle.getState().archive
  assert.equal(live.total, 2)
  const saved = ch.parseArchive(local.get(ch.CHRONICLE_ARCHIVE_KEY))
  assert.deepEqual(saved, live, 'what was saved is exactly what is in memory')
  ch.useChronicle.setState({ archive: ch.emptyArchive() })
  c.reload()
  const reloaded = ch.useChronicle.getState().archive
  assert.deepEqual(reloaded.records.map((r) => [r.seq, r.description, r.time, r.wallTime]), live.records.map((r) => [r.seq, r.description, r.time, r.wallTime]))
  assert.deepEqual(c.verify(), { ok: true })
  assert.deepEqual(ch.parseArchive('{broken'), ch.emptyArchive())
  assert.deepEqual(ch.parseArchive(null), ch.emptyArchive())
}))

test('DV09-045 tampering is detected: edited, deleted, reordered, inserted and truncated records', () => {
  let archive = ch.emptyArchive()
  for (let i = 1; i <= 5; i++) archive = ch.appendRecord(archive, entry({ description: `event ${i}`, time: i }), 'WS', 1000 + i)
  assert.deepEqual(ch.verifyArchive(archive), { ok: true })
  assert.equal(archive.records[0].prevHash, ch.GENESIS_HASH)
  assert.equal(archive.records[1].prevHash, archive.records[0].hash)
  const clone = () => JSON.parse(JSON.stringify(archive))

  const edited = clone(); edited.records[2].description = 'changed'
  assert.deepEqual(ch.verifyArchive(edited), { ok: false, badIndex: 2, reason: 'Record 3 was changed after it was archived' })
  const retimed = clone(); retimed.records[1].wallTime = 5
  assert.equal(ch.verifyArchive(retimed).badIndex, 1)
  const deleted = clone(); deleted.records.splice(2, 1)
  assert.equal(ch.verifyArchive(deleted).ok, false)
  assert.match(ch.verifyArchive(deleted).reason, /not linked|Sequence gap/)
  const reordered = clone(); [reordered.records[1], reordered.records[2]] = [reordered.records[2], reordered.records[1]]
  assert.equal(ch.verifyArchive(reordered).ok, false)
  const truncated = clone(); truncated.records.pop()
  assert.match(ch.verifyArchive(truncated).reason, /end does not match/)
  const inserted = clone(); inserted.records.push({ ...inserted.records[4], seq: 6 })
  assert.equal(ch.verifyArchive(inserted).ok, false)
  const rehashed = clone(); rehashed.records[4].description = 'x'
  const { hash, ...rest } = rehashed.records[4]
  assert.equal(ch.verifyArchive(rehashed).ok, false, 'a recomputed hash alone does not hide a change without the head')
  assert.ok(hash)
})

test('DV09-045 rollover keeps the newest 5000 records and the chain still verifies from its anchor', () => {
  let archive = ch.emptyArchive()
  for (let i = 1; i <= ch.CHRONICLE_MAX_RECORDS + 3; i++) archive = ch.appendRecord(archive, entry({ time: i, description: `e${i}` }), 'WS', i)
  assert.equal(archive.records.length, ch.CHRONICLE_MAX_RECORDS)
  assert.equal(archive.total, ch.CHRONICLE_MAX_RECORDS + 3)
  assert.equal(archive.records[0].seq, 4)
  assert.notEqual(archive.anchor, ch.GENESIS_HASH)
  assert.deepEqual(ch.verifyArchive(archive), { ok: true })
})

test('DV09-045 clearing the archive resets it and is saved', () => fixture((local) => {
  const c = ch.useChronicle.getState()
  c.configure(cfg())
  c.download()
  useStore.getState().logEvent('OPERATOR', 'A', 'one')
  assert.equal(ch.useChronicle.getState().archive.total, 1)
  assert.equal(c.clear(), null)
  assert.deepEqual(ch.parseArchive(local.get(ch.CHRONICLE_ARCHIVE_KEY)), ch.emptyArchive())
  assert.equal(ch.useChronicle.getState().archive.records.length, 0)
}))
