const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText, filename)
const { makeFunctionBlock } = require('../src/renderer/src/engine/plant.ts')
const { stepFunctionBlock } = require('../src/renderer/src/engine/simulate.ts')
const { readAnalogSignal, signalError } = require('../src/renderer/src/engine/analogStrategy.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
function block(type = 'BFI') {
  return makeFunctionBlock({ tag: type, fbType: type, description: type, area: 'FEED', armTrap: true })
}
function scan(m, a, b) {
  m.in1.value = a; m.in2.value = b
  stepFunctionBlock(m, {}, .1)
}
test('BFI captures the first nonzero combination and keeps it while subsequent causes arrive', () => {
  const m = block()
  scan(m, 0, 0)
  scan(m, 1, 0)
  assert.equal(m.firstOut, 1)
  scan(m, 1, 1)
  assert.equal(m.out, 3)
  assert.equal(m.outDiscrete, true)
  assert.equal(m.firstOut, 1)
  scan(m, 0, 1)
  assert.equal(m.firstOut, 1)
  scan(m, 0, 0)
  assert.equal(m.firstOut, 1)
  scan(m, 0, 1)
  assert.equal(m.firstOut, 2)
})
test('simultaneous causes trap both bits, and disarming only stops capture, not actual outputs', () => {
  const m = block()
  scan(m, 1, 1)
  assert.equal(m.firstOut, 3)
  m.armTrap = false
  scan(m, 0, 0)
  scan(m, 1, 0)
  assert.equal(m.firstOut, 3)
  assert.equal(m.out, 1)
})
test('RESET_IN is a pulse and cannot rearm first-out while any input remains active', () => {
  const m = block()
  scan(m, 1, 0)
  m.resetTrap = true
  scan(m, 1, 1)
  assert.equal(m.firstOut, 0)
  assert.equal(m.resetTrap, false)
  assert.equal(m.out, 3)
  scan(m, 0, 1)
  assert.equal(m.firstOut, 0)
  scan(m, 0, 0)
  scan(m, 0, 1)
  assert.equal(m.firstOut, 2)
})
test('Bad BFI inputs hold explicit Bad output but never overwrite a previous good first-out cause', () => {
  const m = block()
  scan(m, 1, 0)
  m.in1 = { kind: 'ref', tag: 'MISSING', value: 0 }
  stepFunctionBlock(m, {}, .1)
  assert.equal(m.bad, true)
  assert.equal(m.firstOut, 1)
  assert.deepEqual(readAnalogSignal({ tag: 'BFI', parameter: 'OUT_D' }, { BFI: m }), { value: 1, bad: true })
  assert.deepEqual(readAnalogSignal({ tag: 'BFI', parameter: 'FIRST_OUT' }, { BFI: m }), { value: 1, bad: false })
})
test('named BFI outputs and CND BYPASS route actual values and reject wrong source types', () => {
  const m = block()
  scan(m, 0, 1)
  const c = block('CND')
  c.bypass = true
  const modules = { BFI: m, CND: c }
  for (const [parameter, value] of [['OUT_INT', 2], ['OUT_D', 1], ['FIRST_OUT', 2]]) {
    assert.equal(signalError({ tag: 'BFI', parameter }, modules), null)
    assert.deepEqual(readAnalogSignal({ tag: 'BFI', parameter }, modules), { value, bad: false })
  }
  assert.deepEqual(readAnalogSignal({ tag: 'CND', parameter: 'BYPASS' }, modules), { value: 1, bad: false })
  assert.ok(signalError({ tag: 'BFI', parameter: 'BYPASS' }, modules))
  assert.ok(signalError({ tag: 'CND', parameter: 'FIRST_OUT' }, modules))
})
test('bypass inhibits healthy CND timing but never makes failed input quality Good; removal starts a fresh delay', () => {
  const c = block('CND')
  c.expr = 'IN1 < 50'; c.delaySec = 4
  for (let i = 0; i < 40; i++) scan(c, 49, 0)
  assert.equal(c.out, 1)
  c.bypass = true
  scan(c, 49, 0)
  assert.equal(c.out, 0)
  assert.equal(c._timerElapsed, 0)
  assert.equal(c.bad, false)
  c.in1 = { kind: 'ref', tag: 'MISSING', value: 0 }
  stepFunctionBlock(c, {}, .1)
  assert.equal(c.bad, true)
  assert.deepEqual(readAnalogSignal({ tag: 'CND', parameter: 'BYPASS' }, { CND: c }), { value: 1, bad: false })
  c.in1 = { kind: 'const', value: 49 }; c.bypass = false
  for (let i = 0; i < 39; i++) scan(c, 49, 0)
  assert.equal(c.out, 0)
  scan(c, 49, 0)
  assert.equal(c.out, 1)
})
function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const s = useStore.getState()
    s.newProject('blank'); useStore.setState({ running: true })
    for (const [tag, fbType] of [['CND1', 'CND'], ['CND2', 'CND'], ['FIRST', 'BFI'], ['BYPASSED', 'OR']]) {
      assert.equal(s.createModule({ tag, type: 'FB', fbType, area: 'FEED', description: tag }), true)
    }
    run(s, alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
test('bypass indication OR and first-out trap remain independent, including journaled operator reset', () => {
  fixture(s => {
    for (const tag of ['CND1', 'CND2']) s.setFbConfig(tag, { expr: 'IN1 = 1', delaySec: 0 })
    for (const [port, tag] of [['in1', 'CND1'], ['in2', 'CND2']]) {
      s.setFbInput('FIRST', port, { kind: 'ref', tag, value: 0 })
      s.setFbInput('BYPASSED', port, { kind: 'ref', tag, parameter: 'BYPASS', value: 0 })
    }
    s.setFbSafety('FIRST', 'ARM_TRAP', true)
    s.setFbInput('CND1', 'in1', { kind: 'const', value: 1 })
    s.tick(.1)
    assert.equal(useStore.getState().modules.FIRST.firstOut, 1)
    assert.equal(useStore.getState().modules.BYPASSED.out, 0)
    s.setFbSafety('CND2', 'BYPASS', true)
    s.tick(.1)
    assert.equal(useStore.getState().modules.BYPASSED.out, 1)
    assert.equal(useStore.getState().modules.FIRST.firstOut, 1)
    s.setFbSafety('FIRST', 'RESET_IN', true)
    s.tick(.1)
    assert.equal(useStore.getState().modules.FIRST.firstOut, 0)
    assert.equal(useStore.getState().modules.FIRST.out, 1)
    assert.ok(useStore.getState().eventLog.some(e => e.description === 'BYPASS set to 1'))
    assert.ok(useStore.getState().eventLog.some(e => e.description === 'RESET_IN set to 1'))
  })
})
test('bypass and trap controls reject wrong module/options, invalid values and locked writes atomically', () => {
  fixture((s, alerts) => {
    const before = useStore.getState().modules.CND1
    for (const args of [['MISSING', 'BYPASS', true], ['FIRST', 'BYPASS', true],
      ['CND1', 'RESET_IN', true], ['CND1', 'INVALID', true], ['CND1', 'BYPASS', 1]]) {
      assert.equal(s.setFbSafety(...args), false)
    }
    assert.equal(alerts.length, 5)
    useSecurity.setState({ locked: true })
    assert.equal(s.setFbSafety('CND1', 'BYPASS', true), false)
    assert.equal(useStore.getState().modules.CND1, before)
  })
})
