const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { conditionExpressionError, evaluateConditionExpression } = require('../src/renderer/src/engine/fbCondition.ts')
const { stepFunctionBlock, deviceInterlockSignal } = require('../src/renderer/src/engine/simulate.ts')
const { makeFunctionBlock } = require('../src/renderer/src/engine/plant.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
test('native healthy interlock polarity maps only qualified zero to trip; Bad trips regardless of polarity', () => {
  const { makeModule } = require('../src/renderer/src/engine/plant.ts')
  const m = makeModule({ tag: 'MTR', type: 'MOTOR', area: 'FEED', description: 'Native interlock' })
  const source = makeFunctionBlock({ tag: 'NOT1', area: 'FEED', description: 'Healthy signal', fbType: 'NOT' })
  m.interlockSource = 'NOT1'
  m.interlockInverted = true
  source.bad = false
  source.out = 1
  assert.deepEqual(deviceInterlockSignal(m, { NOT1: source }), { value: 0, bad: false })
  source.out = 0
  assert.deepEqual(deviceInterlockSignal(m, { NOT1: source }), { value: 1, bad: false })
  source.out = 1
  source.bad = true
  assert.deepEqual(deviceInterlockSignal(m, { NOT1: source }), { value: 1, bad: true })
  assert.deepEqual(deviceInterlockSignal(m, {}), { value: 1, bad: true })
  m.interlockInverted = false
  source.bad = false
  assert.deepEqual(deviceInterlockSignal(m, { NOT1: source }), { value: 1, bad: false })
})
test('exact course quoted DI1/PV_D and AI1/PV expressions parse without eval and require actual qualified sources', () => {
  for (const [expr, ref, value] of [
    ["'//XVSTAT-101/DI1/PV_D' = 0", { tag: 'XVSTAT-101', block: 'DI1', parameter: 'PV_D' }, 0],
    ["'//LI-101/AI1/PV' < 50", { tag: 'LI-101', block: 'AI1', parameter: 'PV' }, 49],
    ["'//LI-101/AI1/PV.CV' < 50", { tag: 'LI-101', block: 'AI1', parameter: 'PV' }, 49],
    ["'//XVSTAT-101/DI1/PV_D.CV' = 0", { tag: 'XVSTAT-101', block: 'DI1', parameter: 'PV_D' }, 0]
  ]) {
    assert.equal(conditionExpressionError(expr), null)
    assert.deepEqual(evaluateConditionExpression(expr, 999, 999, r => {
      assert.deepEqual(r, ref)
      return { value, bad: false }
    }), { value: 1 })
    assert.ok(evaluateConditionExpression(expr, 0, 0).error)
    assert.ok(evaluateConditionExpression(expr, 0, 0, () => ({ value, bad: true })).error)
    assert.ok(evaluateConditionExpression(expr, 0, 0, () => ({ value: Infinity, bad: false })).error)
  }
  for (const invalid of ["'//LI-101/AI1/PV_D' < 50", "'//XVSTAT-101/DI1/PV' = 0",
    "'//LI-101/AI1/PV'<50;run()", "'//LI-101/AI1/PV", "'//LI-101/AI1/OUT'<50"]) assert.ok(conditionExpressionError(invalid))
})
test('quoted condition reads real DI/AI feedback; Bad or missing source resets delay even while bypassed', () => {
  const { makeModule } = require('../src/renderer/src/engine/plant.ts')
  const level = makeModule({ tag: 'LI-101', type: 'AI', area: 'FEED', description: 'Measured level' })
  level.pv = 49
  level.pvBad = false
  const m = block("'//LI-101/AI1/PV' < 50")
  m.in1.value = 999
  scan(m, 39, { 'LI-101': level })
  assert.equal(m.out, 0)
  scan(m, 1, { 'LI-101': level })
  assert.equal(m.out, 1)
  level.pvBad = true
  m.bypass = true
  scan(m, 1, { 'LI-101': level })
  assert.equal(m.bad, true)
  assert.equal(m._timerElapsed, 0)
  assert.match(m.expressionError, /LI-101\/AI1\/PV/)
  level.pvBad = false
  m.bypass = false
  scan(m, 39, { 'LI-101': level })
  assert.equal(m.out, 0)
  scan(m, 1, { 'LI-101': level })
  assert.equal(m.out, 1)
  scan(m, 1, {})
  assert.equal(m.bad, true)
  assert.equal(m.out, 0)
})
function block(expr = 'IN1 < 50', delaySec = 4) {
  return { ...makeFunctionBlock({ tag: 'CND2', area: 'FEED', description: 'Low level', fbType: 'CND' }), expr, delaySec,
    in1: { kind: 'const', value: 49 }, in2: { kind: 'const', value: 0 } }
}
function scan(m, n, modules = {}) { for (let i = 0; i < n; i++) stepFunctionBlock(m, modules, .1) }
test('CND compares the actual threshold; arithmetic and nested parentheses retain their numeric meaning', () => {
  for (const [expression, a, b, value] of [
    ['IN1 < 50', 49, 0, 1], ['IN1 < 50', 50, 0, 0], ['IN1 < 50', 51, 0, 0],
    ['IN1 > IN2', 3, 4, 0], ['IN1 >= IN2', 4, 4, 1], ['IN1 <= IN2', 5, 4, 0],
    ['IN1 = 0', 0, 0, 1], ['IN1 == IN2', 1, 1, 1],
    ['IN1 != IN2', 1, 1, 0], ['IN1 <> IN2', 1, 0, 1],
    ['IN1 + IN2 * 2', 3, 4, 11], ['(IN1 + IN2) * 2', 3, 4, 14],
    ['((IN1 + -IN2) / 2) < 50', 99, 1, 1],
    ['+IN1 / .5 < 1E2', 24, 0, 1], ['(IN1 < 50)', 49, 0, 1],
    ['-2.5E-1 * IN1', 4, 0, -1]
  ]) {
    assert.equal(conditionExpressionError(expression), null, expression)
    assert.deepEqual(evaluateConditionExpression(expression, a, b), { value }, expression)
  }
})
test('invalid condition syntax is rejected rather than silently dropping comparison or foreign tokens', () => {
  for (const expression of ['', 'IN1 <', 'IN1 IN2', '(IN1', 'IN1)', 'IN3 < 50',
    'IN1 && IN2', 'IN1 > 2 > 3', 'alert(1)', 'IN1; 1', '1E999', 'IN1 + 1 invalid']) {
    assert.ok(conditionExpressionError(expression), expression)
    assert.ok(evaluateConditionExpression(expression, 1, 0).error, expression)
  }
  assert.ok(evaluateConditionExpression('IN1 / IN2', 1, 0).error)
  assert.ok(evaluateConditionExpression('IN1', Infinity, 0).error)
})
test('the four-second condition is false at3.9 and true at4.0, including forty fractional scans', () => {
  const m = block()
  scan(m, 39)
  assert.equal(m.out, 0)
  stepFunctionBlock(m, {}, .1)
  assert.equal(m.out, 1)
  assert.equal(m.bad, false)
  m.in1.value = 50
  scan(m, 1)
  assert.equal(m.out, 0)
  assert.equal(m._timerElapsed, 0)
  m.in1.value = 49
  scan(m, 39)
  assert.equal(m.out, 0)
  scan(m, 1)
  assert.equal(m.out, 1)
})
test('a true interval interrupted by false never accumulates disconnected low-level time', () => {
  const m = block()
  scan(m, 30)
  m.in1.value = 55
  scan(m, 1)
  m.in1.value = 49
  scan(m, 30)
  assert.equal(m.out, 0)
  scan(m, 10)
  assert.equal(m.out, 1)
})
test('Bad/OOS/missing/nonfinite input resets CND timing; recovery must supply a full new good interval', () => {
  for (const source of [undefined, { type: 'AI', pv: 49, pvBad: true }, { type: 'AI', pv: NaN },
    { type: 'DI', state: true, mode: 'OOS' }, { type: 'FB', out: 49, bad: true }]) {
    const m = block()
    m.in1 = { kind: 'ref', tag: 'LI-101', value: 0 }
    const modules = { 'LI-101': { type: 'AI', pv: 49, pvBad: false } }
    scan(m, 30, modules)
    stepFunctionBlock(m, source ? { 'LI-101': source } : {}, .1)
    assert.equal(m.bad, true)
    assert.equal(m._timerElapsed, 0)
    assert.equal(m.out, 0)
    scan(m, 39, modules)
    assert.equal(m.out, 0)
    scan(m, 1, modules)
    assert.equal(m.out, 1)
  }
})
test('runtime expression/division/delay errors expose diagnostics and reset timing without Good fallbacks', () => {
  for (const patch of [{ expr: 'IN1 <' }, { expr: 'IN1 / IN2' }, { delaySec: NaN }, { delaySec: -1 }]) {
    const m = Object.assign(block(), { out: 1, _timerElapsed: 5 }, patch)
    stepFunctionBlock(m, {}, .1)
    assert.equal(m.bad, true)
    assert.equal(m.out, 0)
    assert.equal(m._timerElapsed, 0)
    assert.ok(m.expressionError)
  }
})
function fixture(run) {
  const previous = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.window = { alert: message => alerts.push(message) }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    const store = useStore.getState()
    store.newProject('blank')
    useStore.setState({ running: true })
    for (const [tag, type, fbType] of [
      ['MTR-102', 'MOTOR'], ['CND1', 'FB', 'CND'], ['CND2', 'FB', 'CND'],
      ['OR-TRIP', 'FB', 'OR'], ['XVSTAT-101', 'DI'], ['LI-101', 'AI']
    ]) assert.equal(store.createModule({ tag, type, fbType, area: 'FEED', description: 'Motor condition' }), true)
    run(store, alerts)
  } finally {
    useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}
function module(tag) { return useStore.getState().modules[tag] }
function wireCourseConditions(store) {
  store.setFbInput('CND1', 'in1', { kind: 'ref', tag: 'XVSTAT-101', value: 0 })
  store.setFbConfig('CND1', { expr: 'IN1 = 0', delaySec: 0 })
  store.setFbInput('CND2', 'in1', { kind: 'ref', tag: 'LI-101', value: 0 })
  store.setFbConfig('CND2', { expr: 'IN1 < 50', delaySec: 4 })
  store.setFbInput('OR-TRIP', 'in1', { kind: 'ref', tag: 'CND1', value: 0 })
  store.setFbInput('OR-TRIP', 'in2', { kind: 'ref', tag: 'CND2', value: 0 })
  store.setInterlockSource('MTR-102', 'OR-TRIP')
  store.setDeviceOptions('MTR-102', { resetRequired: true })
}
test('condition configuration applies atomically, resets timing, rejects invalid delay/syntax and locked writes', () => {
  fixture((store, alerts) => {
    store.setFbConfig('CND2', { expr: 'IN1 < 50', delaySec: 4 })
    store.tick(3)
    assert.equal(module('CND2')._timerElapsed, 3)
    const before = module('CND2')
    for (const patch of [{ expr: 'IN1 <' }, { delaySec: -1 }, { delaySec: Infinity }]) {
      store.setFbConfig('CND2', patch)
      assert.equal(module('CND2'), before)
    }
    assert.equal(alerts.length, 3)
    assert.equal(useStore.getState().eventLog.filter(event =>
      event.description.startsWith('Condition configuration rejected')).length, 3)
    useSecurity.setState({ locked: true })
    store.setFbConfig('CND2', { expr: 'IN1 > 50' })
    assert.equal(module('CND2'), before)
    useSecurity.setState({ locked: false })
    store.setFbConfig('CND2', { expr: 'IN1 <= 50', delaySec: 4 })
    assert.equal(module('CND2')._timerElapsed, 0)
    store.tick(3)
    store.setFbInput('CND2', 'in1', { kind: 'const', value: 49 })
    assert.equal(module('CND2')._timerElapsed, 0)
    assert.equal(module('CND2').out, 0)
  })
})
test('closed-valve and sustained low-level CND/OR interlock actually trip the motor and retain its reset latch', () => {
  fixture(store => {
    store.createController('CTLR', 'Condition input')
    store.commissionController('CTLR')
    store.addTraditionalCard('CTLR', 1, 'AI')
    store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'LT-1', enabled: true })
    store.bindAnalogDst('LI-101', 'input', 'LT-1')
    store.setTraditionalInput('LT-1', 100)
    useStore.setState(s => ({ modules: { ...s.modules,
      'XVSTAT-101': { ...s.modules['XVSTAT-101'], state: true },
      'MTR-102': { ...s.modules['MTR-102'], confirmTimeSec: .1 }
    } }))
    wireCourseConditions(store)
    store.tick(.1)
    store.tick(.1)
    store.resetDevice('MTR-102')
    store.startMotor('MTR-102')
    store.tick(.1)
    assert.equal(module('MTR-102').running, true)
    store.setTraditionalInput('LT-1', 50)
    for (let i = 0; i < 41; i++) store.tick(.1)
    assert.equal(module('CND2').out, 0)
    assert.equal(module('MTR-102').running, true)
    store.setTraditionalInput('LT-1', 49)
    for (let i = 0; i < 39; i++) store.tick(.1)
    assert.equal(module('MTR-102').running, true)
    store.tick(.1)
    assert.equal(module('CND2').out, 1)
    assert.equal(module('MTR-102').running, false)
    assert.equal(module('MTR-102').locked, true)
    store.setTraditionalInput('LT-1', 100)
    store.tick(.1)
    assert.equal(module('MTR-102').locked, true)
    store.resetDevice('MTR-102')
    store.tick(.1)
    assert.equal(module('MTR-102').running, true)
    useStore.setState(s => ({ modules: { ...s.modules, 'XVSTAT-101': { ...s.modules['XVSTAT-101'], state: false } } }))
    store.tick(.1)
    assert.equal(module('CND1').out, 1)
    assert.equal(module('MTR-102').running, false)
  })
})
test('Bad or missing wired interlock fails safe instead of clearing the trip or admitting a new start', () => {
  fixture(store => {
    store.setInterlockSource('MTR-102', 'CND2')
    store.setFbInput('CND2', 'in1', { kind: 'ref', tag: 'MISSING', value: 0 })
    store.startMotor('MTR-102')
    store.tick(.1)
    assert.deepEqual(deviceInterlockSignal(module('MTR-102'), useStore.getState().modules), { value: 1, bad: true })
    assert.equal(module('MTR-102').interlock, true)
    assert.equal(module('MTR-102').running, false)
    store.deleteModule('CND2')
    store.resetDevice('MTR-102')
    store.tick(.1)
    assert.equal(module('MTR-102').locked, true)
    assert.equal(module('MTR-102').running, false)
  })
})
test('the four-second low-level trip de-energizes ZX-2 before actual XI-2 confirmation follows', () => {
  fixture(store => {
    store.createController('CTLR', 'External course conditions')
    store.commissionController('CTLR')
    for (const [slot, type] of [[1, 'AI'], [3, 'DI'], [4, 'DO']]) store.addTraditionalCard('CTLR', slot, type)
    store.configureTraditionalChannel('CTLR/C01', 1, { dst: 'LT-1', enabled: true })
    assert.equal(store.configureTraditionalChannel('CTLR/C04', 2, { dst: 'ZX-2', enabled: true }), true)
    assert.equal(store.configureTraditionalChannel('CTLR/C03', 2,
      { dst: 'XI-2', enabled: true, tiebackDst: 'ZX-2' }), true)
    store.bindAnalogDst('LI-101', 'input', 'LT-1')
    store.bindDeviceDst('MTR-102', 'input', 'XI-2')
    store.bindDeviceDst('MTR-102', 'output', 'ZX-2')
    store.setTraditionalInput('LT-1', 100)
    useStore.setState(s => ({ modules: { ...s.modules,
      'XVSTAT-101': { ...s.modules['XVSTAT-101'], state: true }
    } }))
    wireCourseConditions(store)
    for (let i = 0; i < 3; i++) store.tick(.1)
    store.resetDevice('MTR-102')
    store.startMotor('MTR-102')
    store.tick(.1)
    store.tick(.1)
    assert.equal(module('MTR-102').running, true)
    store.setTraditionalInput('LT-1', 49)
    for (let i = 0; i < 39; i++) store.tick(.1)
    assert.equal(module('MTR-102').appliedCommand, true)
    store.tick(.1)
    assert.equal(module('CND2').out, 1)
    assert.equal(module('MTR-102').appliedCommand, false)
    assert.equal(module('MTR-102').running, true)
    store.tick(.1)
    assert.equal(module('MTR-102').running, false)
    assert.equal(module('MTR-102').locked, true)
  })
})
test('interlock configuration rejects wrong targets, self/missing sources and locked writes atomically', () => {
  fixture((store, alerts) => {
    const before = module('MTR-102')
    for (const [tag, source] of [['MISSING', 'CND2'], ['CND1', 'CND2'], ['MTR-102', 'MTR-102'],
      ['MTR-102', 'MISSING']]) store.setInterlockSource(tag, source)
    assert.equal(module('MTR-102'), before)
    assert.equal(alerts.length, 4)
    useSecurity.setState({ locked: true })
    store.setInterlockSource('MTR-102', 'CND2')
    assert.equal(module('MTR-102'), before)
  })
})
