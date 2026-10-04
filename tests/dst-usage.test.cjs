const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { dstUsage } = require('../src/renderer/src/engine/dstUsage.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { makeDefaultHardware } = require('../src/renderer/src/engine/hardware.ts')
const { buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
function report() { const s = useStore.getState(); return dstUsage(s.hardware, s.modules) }
function counts() { const r = report(); return ['AI', 'AO', 'DI', 'DO'].map(type => r.byType[type].referenced) }
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const db = new Map()
  global.window = { alert: message => { throw new Error(message) }, localStorage: {
    setItem: (key, value) => db.set(key, value), getItem: key => db.get(key) ?? null
  } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    s.newProject('blank')
    s.createController('CTLR', 'Licensing usage fixture')
    s.commissionController('CTLR')
    for (const [slot, type] of [[1, 'AI'], [2, 'AO'], [3, 'DI'], [4, 'DO']]) {
      s.addTraditionalCard('CTLR', slot, type)
    }
    for (const [slot, number, dst] of [[1, 1, 'LT-1'], [1, 2, 'FT-2'], [2, 1, 'LY-1'],
      [2, 2, 'FY-2'], [3, 2, 'XI-2'], [4, 2, 'ZX-2']]) {
      s.configureTraditionalChannel(`CTLR/C0${slot}`, number, { dst, enabled: true })
    }
    run(s)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
test('p241/255: unused named channels/modules allocate zero; LI-101 is oneAI and FIC-102 adds exactly oneAI/oneAO', () => fixture(s => {
  assert.deepEqual(counts(), [0, 0, 0, 0])
  assert.deepEqual([report().byType.AI.configured, report().byType.AO.configured], [2, 2])
  s.createModule({ tag: 'LI-101', type: 'AI', area: 'FEED', description: 'Course level' })
  assert.deepEqual(counts(), [0, 0, 0, 0])
  s.bindAnalogDst('LI-101', 'input', 'LT-1')
  assert.deepEqual(counts(), [1, 0, 0, 0])
  s.createModule({ tag: 'FIC-102', type: 'PID', area: 'FEED', description: 'Course flow' })
  assert.deepEqual(counts(), [1, 0, 0, 0])
  s.bindAnalogDst('FIC-102', 'input', 'FT-2')
  s.bindAnalogDst('FIC-102', 'output', 'FY-2')
  assert.deepEqual(counts(), [2, 1, 0, 0])
  s.bindAnalogDst('FIC-102', 'input', 'FT-2')
  s.bindAnalogDst('FIC-102', 'output', 'FY-2')
  assert.deepEqual(counts(), [2, 1, 0, 0])
  assert.deepEqual(report().errors, [])
}))
test('shared input readers and internal FB references do not duplicate physical DST allocation', () => fixture(s => {
  for (const tag of ['AI-A', 'AI-B']) {
    s.createModule({ tag, type: 'AI', area: 'FEED', description: 'Shared input' })
    s.bindAnalogDst(tag, 'input', 'LT-1')
  }
  s.createModule({ tag: 'CND-A', type: 'FB', fbType: 'CND', area: 'FEED', description: 'Internal reader' })
  s.setFbInput('CND-A', 'in1', { kind: 'ref', tag: 'AI-A', value: 0 })
  assert.deepEqual(counts(), [1, 0, 0, 0])
  assert.deepEqual(report().entries.find(entry => entry.signal === 'LT-1').references, ['AI-A/input', 'AI-B/input'])
  s.deleteModule('AI-B')
  assert.deepEqual(counts(), [1, 0, 0, 0])
  s.bindAnalogDst('AI-A', 'input', '')
  assert.deepEqual(counts(), [0, 0, 0, 0])
}))
test('saved device draft/Save allocate no runtime DSTs; Full deployment allocates oneDI/oneDO and deletion releases both', () => fixture(s => {
  s.createModule({ tag: 'MTR-102', type: 'MOTOR', area: 'FEED', description: 'Saved motor' })
  s.enableDeviceLifecycle('MTR-102')
  s.editDeviceDraft('MTR-102', { controllerTag: 'CTLR', inputDst: 'XI-2', outputDst: 'ZX-2' })
  s.saveDeviceConfiguration('MTR-102')
  assert.deepEqual(counts(), [0, 0, 0, 0])
  useStore.setState({ running: true })
  s.tick(.1)
  s.downloadDeviceConfiguration('MTR-102')
  assert.deepEqual(counts(), [0, 0, 1, 1])
  s.deleteModule('MTR-102')
  assert.deepEqual(counts(), [0, 0, 0, 0])
}))
test('disabled or failed-controller sources retain referenced allocation but report enabled/installed separately', () => fixture(s => {
  s.createModule({ tag: 'LI-101', type: 'AI', area: 'FEED', description: 'Course level' })
  s.bindAnalogDst('LI-101', 'input', 'LT-1')
  s.configureTraditionalChannel('CTLR/C01', 1, { dst: 'LT-1', enabled: false })
  assert.equal(report().byType.AI.referenced, 1)
  assert.equal(report().byType.AI.enabledReferenced, 0)
  s.failController('CTLR', 'primary')
  assert.equal(useStore.getState().hardware.controllers.CTLR.primary, 'FAILED')
  assert.equal(report().byType.AI.referenced, 1)
  assert.deepEqual(report().errors, [])
}))
test('implicit CHARM channels count by installed physical type, including AI_HART; report is read-only', () => {
  const hw = makeDefaultHardware(), modules = buildInitialPlant().modules
  const before = JSON.stringify({ hw, modules })
  const r = dstUsage(hw, modules)
  const bound = Object.values(hw.baseplates).flatMap(plate => plate.channels).filter(channel => channel.type && channel.boundTag && channel.boundField)
  assert.equal(Object.values(r.byType).reduce((total, type) => total + type.referenced, 0), bound.length)
  assert.ok(r.byType.AI.referenced > 0)
  assert.deepEqual(r.errors, [])
  assert.equal(JSON.stringify({ hw, modules }), before)
  const entry = r.entries.find(entry => entry.type === 'AI' && entry.references.length)
  const [plateId, slot] = entry.id.split('/CH')
  hw.baseplates[plateId].channels.find(channel => channel.slot === Number(slot)).pulled = true
  assert.equal(dstUsage(hw, modules).byType.AI.referenced, r.byType.AI.referenced)
  assert.equal(dstUsage(hw, modules).byType.AI.enabledReferenced, r.byType.AI.enabledReferenced - 1)
})
test('stale/wrong-type/duplicate hardware references are explicit incomplete-report errors, not successful zero usage', () => fixture(s => {
  s.createModule({ tag: 'WRONG-AI', type: 'AI', area: 'FEED', description: 'Wrong physical type' })
  const state = useStore.getState()
  const hw = { ...state.hardware, analogBindings: { GHOST: { input: 'LT-1' }, 'WRONG-AI': { input: 'XI-2' } },
    discreteBindings: { GHOST2: 'MISSING' } }
  const invalid = dstUsage(hw, state.modules)
  assert.equal(invalid.errors.length, 3)
  assert.ok(invalid.errors.some(error => /GHOST\/input.*LT-1/.test(error)))
  assert.ok(invalid.errors.some(error => /GHOST2\/IO_IN.*MISSING/.test(error)))
  assert.ok(invalid.errors.some(error => /WRONG-AI.*XI-2.*AI channel/.test(error)))
  const cards = structuredClone(hw.traditionalCards)
  cards['CTLR/C01'].channels[1].dst = 'LT-1'
  assert.ok(dstUsage({ ...hw, traditionalCards: cards }, state.modules).errors.some(error => /Duplicate hardware DST/.test(error)))
}))
test('an enabled/bound split-range AO2 is another physical output DST, not another count for the PID object', () => fixture(s => {
  s.createModule({ tag: 'FIC-102', type: 'PID', area: 'FEED', description: 'Split output' })
  s.bindAnalogDst('FIC-102', 'input', 'FT-2')
  s.bindAnalogDst('FIC-102', 'output', 'FY-2')
  assert.deepEqual(counts(), [1, 1, 0, 0])
  assert.equal(s.setPidIo('FIC-102', { splitRange: true }), true)
  s.bindAnalogDst('FIC-102', 'output2', 'LY-1')
  assert.deepEqual(counts(), [1, 2, 0, 0])
  assert.deepEqual(report().errors, [])
  s.deleteModule('FIC-102')
  assert.deepEqual(counts(), [0, 0, 0, 0])
}))
