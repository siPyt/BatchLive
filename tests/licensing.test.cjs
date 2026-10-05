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
const lic = require('../src/renderer/src/engine/licensing.ts')

const used = (AI = 0, AO = 0, DI = 0, DO = 0) => ({ AI, AO, DI, DO })
const file = (n, AI = 0, AO = 0, DI = 0, DO = 0) => ({ fileNumber: n, capacity: { AI, AO, DI, DO }, loadedAt: 1 })
const row = (report, type) => report.rows.find(r => r.type === type)

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), lic: lic.useLicensing.getState(), window: global.window }
  const db = new Map()
  global.localStorage = { getItem: (k) => db.get(k) ?? null, setItem: (k, v) => db.set(k, String(v)) }
  global.window = { alert: () => {}, localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    lic.useLicensing.setState({ keyPresent: true, files: [] })
    const s = useStore.getState()
    s.newProject('blank')
    s.createController('CTLR', 'Licensing')
    s.commissionController('CTLR')
    for (const [slot, type] of [[1, 'AI'], [2, 'AO']]) s.addTraditionalCard('CTLR', slot, type)
    for (const [slot, number, dst] of [[1, 1, 'LT-1'], [1, 2, 'FT-2'], [1, 3, 'PT-3'], [2, 1, 'LY-1']])
      s.configureTraditionalChannel(`CTLR/C0${slot}`, number, { dst, enabled: true })
    run(s, db)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    lic.useLicensing.setState(before.lic, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const bindAi = (s, tag, dst) => { s.createModule({ tag, type: 'AI', area: 'FEED', description: tag }); s.bindAnalogDst(tag, 'input', dst) }

test('DV09-054 with no license file the system is unlicensed and nothing is enforced', () => {
  const r = lic.licenseReport(used(500, 500, 500, 500), [])
  assert.equal(r.enforced, false)
  assert.equal(r.shortfall, false)
})

test('DV09-054 capacity is the sum of the loaded files and each type is checked on its own', () => {
  const files = [file(1, 10, 2, 5, 5), file(1, 5, 0, 0, 3)]
  assert.deepEqual(lic.totalCapacity(files), used(15, 2, 5, 8))
  const ok = lic.licenseReport(used(15, 2, 5, 8), files)
  assert.equal(ok.shortfall, false)
  assert.deepEqual(ok.rows.map(r => r.shortfall), [0, 0, 0, 0])
  const di = lic.licenseReport(used(0, 0, 6, 0), files)
  assert.equal(di.shortfall, true)
  assert.equal(row(di, 'DI').shortfall, 1)
  assert.equal(row(di, 'DO').shortfall, 0, 'a spare DO license does not cover DI')
})

test('DV09-054 spare AO licenses cover AI shortfall (the course example) and nothing else', () => {
  const files = [file(1, 2, 3, 1, 1)]
  const covered = lic.licenseReport(used(4, 1, 0, 0), files)
  assert.equal(row(covered, 'AI').substituted, 2)
  assert.equal(row(covered, 'AI').shortfall, 0)
  assert.equal(covered.spareAo, 0)
  assert.equal(covered.shortfall, false)
  const partly = lic.licenseReport(used(5, 2, 0, 0), files)
  assert.equal(row(partly, 'AI').substituted, 1)
  assert.equal(row(partly, 'AI').shortfall, 2)
  assert.equal(partly.shortfall, true)
  const aoShort = lic.licenseReport(used(0, 4, 0, 0), files)
  assert.equal(row(aoShort, 'AO').shortfall, 1, 'AO usage is never covered by AI licenses')
  assert.equal(lic.licenseReport(used(0, 0, 3, 3), files).shortfall, true)
  const spare = lic.licenseReport(used(1, 0, 0, 0), files)
  assert.equal(spare.spareAo, 3)
  assert.equal(row(spare, 'AI').substituted, 0)
})

test('DV09-054 license files must match the System ID Key and carry valid capacities', () => {
  const key = lic.SYSTEM_ID_KEY_NUMBER
  const cap = (AI = 1, AO = 0, DI = 0, DO = 0) => ({ AI, AO, DI, DO })
  assert.equal(lic.licenseFileError(key, cap(), [], key), null)
  assert.match(lic.licenseFileError(key + 1, cap(), [], key), /does not match the System ID Key number/)
  for (const bad of [0, -3, 1.5, NaN]) assert.match(lic.licenseFileError(bad, cap(), [], bad), /positive whole number/)
  assert.match(lic.licenseFileError(key, cap(-1), [], key), /AI capacity/)
  assert.match(lic.licenseFileError(key, cap(1, 100001), [], key), /AO capacity/)
  assert.match(lic.licenseFileError(key, cap(1.5), [], key), /AI capacity/)
  assert.equal(lic.licenseFileError(key, cap(100000), [], key), null)
  assert.match(lic.licenseFileError(key, cap(0), [], key), /at least one DST/)
  assert.match(lic.licenseFileError(key, cap(), [file(key, 1)], key), /already loaded/)
})

test('DV09-054 loading, persisting and removing files needs System Admin and reloads from storage', () => fixture((s, db) => {
  const L = lic.useLicensing.getState()
  assert.match(L.loadFile(1, { AI: 1, AO: 0, DI: 0, DO: 0 }), /does not match/)
  assert.equal(L.loadFile(lic.SYSTEM_ID_KEY_NUMBER, { AI: 5, AO: 1, DI: 2, DO: 2 }), null)
  assert.equal(lic.useLicensing.getState().files.length, 1)
  assert.ok(JSON.parse(db.get('batchlive.licensing.v1')).files[0].capacity.AI === 5)
  lic.useLicensing.setState({ files: [], keyPresent: false })
  lic.useLicensing.getState().reload()
  assert.equal(lic.useLicensing.getState().files.length, 1)
  assert.equal(lic.useLicensing.getState().keyPresent, true)
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { SYSTEM_ADMIN: 'SYSTEM_ADMIN' } })
  assert.equal(L.loadFile(lic.SYSTEM_ID_KEY_NUMBER, { AI: 9, AO: 0, DI: 0, DO: 0 }), 'Requires the System Admin key')
  assert.equal(L.removeFile(0), 'Requires the System Admin key')
  assert.equal(L.setKeyPresent(false), 'Requires the System Admin key')
  useSecurity.setState({ currentUser: 'admin' })
  assert.equal(L.removeFile(7), 'That license file is not loaded')
  assert.equal(L.removeFile(0), null)
  assert.equal(lic.useLicensing.getState().files.length, 0)
}))

test('DV09-054 current usage counts real bound signals and feeds the report', () => fixture((s) => {
  assert.deepEqual(lic.currentUsage(), used())
  bindAi(s, 'LI-1', 'LT-1')
  bindAi(s, 'LI-2', 'FT-2')
  assert.deepEqual(lic.currentUsage(), used(2))
  lic.useLicensing.getState().loadFile(lic.SYSTEM_ID_KEY_NUMBER, { AI: 1, AO: 0, DI: 0, DO: 0 })
  const r = lic.licenseReport(lic.currentUsage(), lic.useLicensing.getState().files)
  assert.equal(row(r, 'AI').shortfall, 1)
}))

test('DV09-054 a missing System ID Key refuses configuration downloads but not other work', () => fixture((s) => {
  const L = lic.useLicensing.getState()
  assert.equal(L.setKeyPresent(false), null)
  assert.match(lic.downloadRefusal('Download module X'), /System ID Key is not installed/)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download module X'), false)
  assert.match(useSecurity.getState().lastDenied, /System ID Key is not installed/)
  s.createController('NEW-1', '')
  assert.equal(s.commissionController('NEW-1'), false, 'commissioning is a download operation')
  assert.equal(useSecurity.getState().requireLock('CAN_CONFIGURE', 'Create module X'), true)
  assert.equal(useSecurity.getState().requireLock('CONTROL', 'Write TIC.SP'), true)
  assert.equal(L.setKeyPresent(true), null)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download module X'), true)
  assert.equal(s.commissionController('NEW-1'), true)
}))

test('DV09-054 a DST shortfall refuses module and card downloads only, and clears when usage fits', () => fixture((s) => {
  const L = lic.useLicensing.getState()
  bindAi(s, 'LI-1', 'LT-1')
  bindAi(s, 'LI-2', 'FT-2')
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download module LI-1'), true, 'unlicensed: not enforced')
  assert.equal(L.loadFile(lic.SYSTEM_ID_KEY_NUMBER, { AI: 1, AO: 0, DI: 0, DO: 0 }), null)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download module LI-1'), false)
  assert.match(useSecurity.getState().lastDenied, /DST license shortfall: AI needs 2, licensed 1/)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download serial card X'), false)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download H1 card X'), false)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download input filters CTLR/C01'), true, 'filters consume no DST')
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Commission controller NEW'), true)
  lic.useLicensing.setState({ files: [] })
  assert.equal(L.loadFile(lic.SYSTEM_ID_KEY_NUMBER, { AI: 0, AO: 1, DI: 0, DO: 0 }), null)
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download module LI-1'), false, '1 spare AO covers 1 of 2 AI')
  bindAi(s, 'LI-3', 'PT-3')
  assert.match(lic.downloadRefusal('Download module LI-1'), /AI needs 3, licensed 0 \(\+1 AO substituted\)/)
  lic.useLicensing.setState({ files: [file(lic.SYSTEM_ID_KEY_NUMBER, 3, 0, 0, 0)] })
  assert.equal(useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download module LI-1'), true)
}))
