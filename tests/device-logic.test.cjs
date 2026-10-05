const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, filename)
  }
}
const { makeModule, buildBlankPlant, buildInitialPlant } = require('../src/renderer/src/engine/plant.ts')
const { makeBlankHardware } = require('../src/renderer/src/engine/hardware.ts')
const { stepPlant, resetDeviceLock } = require('../src/renderer/src/engine/simulate.ts')
const { explainModuleLogic } = require('../src/renderer/src/engine/logicExplanation.ts')
const { deviceLogicError } = require('../src/renderer/src/engine/fb.ts')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')

function plant(extra = {}) {
  const modules = {
    V1: makeModule({ tag: 'V1', description: 'TEST VALVE', area: 'T', type: 'VALVE' }),
    M1: makeModule({ tag: 'M1', description: 'TEST MOTOR', area: 'T', type: 'MOTOR' }),
    A: makeModule({ tag: 'A', description: 'COND A', area: 'T', type: 'DI' }),
    B: makeModule({ tag: 'B', description: 'COND B', area: 'T', type: 'DI' })
  }
  Object.assign(modules.V1, { confirmTimeSec: 1, resetRequired: false, ...extra.valve })
  Object.assign(modules.M1, { confirmTimeSec: 1, resetRequired: false, ...extra.motor })
  return { ...buildBlankPlant(), modules, hardware: makeBlankHardware() }
}
const run = (state, seconds) => { for (let i = 0; i < seconds * 10; i++) state = stepPlant(state, 0.1); return state }

test('interlock conditions trip the device, are fail-safe on Bad sources, and latch when Reset Required is set', () => {
  let state = plant({ valve: { commandedOpen: true, interlockConditions: [{ source: 'A', description: 'HIGH LEVEL' }] } })
  state = run(state, 3)
  assert.equal(state.modules.V1.open, true)
  state.modules.A.state = true
  state = run(state, 2)
  assert.equal(state.modules.V1.interlock, true)
  assert.equal(state.modules.V1.open, false)
  assert.equal(state.modules.V1.dcState, 'SHUTDOWN')
  state.modules.A.state = false
  state = run(state, 3)
  assert.equal(state.modules.V1.interlock, false)
  assert.equal(state.modules.V1.open, true)

  const latch = plant({ valve: { commandedOpen: true, resetRequired: true, interlockConditions: [{ source: 'A', description: 'X' }] } })
  latch.modules.A.state = true
  let latched = run(latch, 2)
  latched.modules.A.state = false
  latched = run(latched, 3)
  assert.equal(latched.modules.V1.dcState, 'LOCKED')
  resetDeviceLock(latched.modules.V1)
  assert.equal(run(latched, 3).modules.V1.open, true)

  const bad = plant({ valve: { commandedOpen: true, interlockConditions: [{ source: 'A', description: 'BAD SRC' }] } })
  delete bad.modules.A
  assert.equal(run(bad, 2).modules.V1.interlock, true)
})

test('inverted conditions and BYPASSED: only bypassable interlocks are ignored', () => {
  let state = plant({ valve: { commandedOpen: true, bypassed: true, interlockConditions: [
    { source: 'A', description: 'BYPASSABLE', bypassable: true }, { source: 'B', description: 'HARD', invert: true }] } })
  state.modules.B.state = true
  state.modules.A.state = true
  state = run(state, 3)
  assert.equal(state.modules.V1.interlock, false)
  assert.equal(state.modules.V1.open, true)
  state.modules.B.state = false
  state = run(state, 2)
  assert.equal(state.modules.V1.interlock, true)
  state.modules.B.state = true
  state.modules.V1.bypassed = false
  state = run(state, 2)
  assert.equal(state.modules.V1.interlock, true)
})

test('permissive conditions must all be met to leave Passive but do not stop an Active device', () => {
  let state = plant({ valve: { commandedOpen: true, permissiveRequired: true,
    permissiveConditions: [{ source: 'A', description: 'PUMP RUNNING' }, { source: 'B', description: 'AIR OK' }] } })
  state = run(state, 3)
  assert.equal(state.modules.V1.open, false)
  state.modules.A.state = true
  state = run(state, 3)
  assert.equal(state.modules.V1.open, false)
  state.modules.B.state = true
  state = run(state, 3)
  assert.equal(state.modules.V1.open, true)
  state.modules.A.state = false
  state = run(state, 3)
  assert.equal(state.modules.V1.open, true)
})

test('force setpoints drive the request, first true condition wins, and an interlock still overrides', () => {
  let state = plant({ motor: { commanded: false, forceSetpoints: [
    { source: 'A', description: 'FORCE STOP', state: 'PASSIVE' }, { source: 'B', description: 'FORCE RUN', state: 'ACTIVE' }] } })
  state.modules.B.state = true
  state = run(state, 3)
  assert.equal(state.modules.M1.commanded, true)
  assert.equal(state.modules.M1.running, true)
  state.modules.A.state = true
  state = run(state, 3)
  assert.equal(state.modules.M1.commanded, false)
  assert.equal(state.modules.M1.running, false)
  state.modules.A.state = false
  state.modules.M1.interlockConditions = [{ source: 'A', description: 'TRIP' }]
  state.modules.A.state = true
  state.modules.B.state = true
  state = run(state, 2)
  assert.equal(state.modules.M1.interlock, true)
  assert.equal(state.modules.M1.running, false)
})

test('the explanation states what the module is doing and why, from live state', () => {
  let state = plant({ valve: { commandedOpen: true,
    interlockConditions: [{ source: 'A', description: 'HIGH LEVEL' }],
    permissiveRequired: true, permissiveConditions: [{ source: 'B', description: 'AIR OK' }],
    forceSetpoints: [{ source: 'B', description: 'EMERGENCY OPEN', state: 'ACTIVE' }] } })
  state.modules.A.state = true
  state = run(state, 2)
  let text = explainModuleLogic(state.modules.V1, state.modules)
  assert.match(text.decision, /held Closed \(SHUTDOWN\).*#1 "HIGH LEVEL"/)
  assert.match(JSON.stringify(text.sections), /\[TRIPPING\]/)
  state.modules.A.state = false
  state = run(state, 3)
  text = explainModuleLogic(state.modules.V1, state.modules)
  assert.match(text.decision, /refused Open: the permissive is not met.*#1 "AIR OK"/)
  state.modules.B.state = true
  state = run(state, 3)
  text = explainModuleLogic(state.modules.V1, state.modules)
  assert.match(text.decision, /confirmed Open/)
  assert.match(JSON.stringify(text.sections), /Force setpoint #1 \\"EMERGENCY OPEN\\" is true/)
  assert.ok(text.sections.some(section => section.heading.includes('Not simulated')))
})

test('every module type in the default plant explains its logic', () => {
  const modules = buildInitialPlant().modules
  for (const m of Object.values(modules)) {
    const text = explainModuleLogic(m, modules)
    assert.ok(text.title.includes(m.tag), m.tag)
    assert.ok(text.decision.length > 10, m.tag)
    assert.ok(text.sections.length >= 1 && text.sections.every(section => section.lines.length > 0), m.tag)
  }
  const pid = explainModuleLogic(modules['TIC-201'], modules)
  assert.match(JSON.stringify(pid.sections), /Gain x \(error/)
})

test('device logic edits are validated and permission checked, and clearing lists releases the flags', () => {
  const modules = plant().modules
  assert.equal(deviceLogicError(modules, 'V1', { interlockConditions: [{ source: 'A', description: 'OK' }] }), null)
  assert.match(deviceLogicError(modules, 'V1', { interlockConditions: [{ source: 'V1', description: 'SELF' }] }), /cannot reference itself/)
  assert.match(deviceLogicError(modules, 'V1', { permissiveConditions: [{ source: 'NOPE', description: 'X' }] }), /existing source/)
  assert.match(deviceLogicError(modules, 'V1', { forceSetpoints: [{ source: 'A', description: 'x'.repeat(25), state: 'ACTIVE' }] }), /24 characters/)
  assert.match(deviceLogicError(modules, 'V1', { interlockConditions: Array.from({ length: 17 }, () => ({ source: 'A', description: 'X' })) }), /limited to 16/)
  assert.match(deviceLogicError(modules, 'A', {}), /motor or valve/)

  const before = useStore.getState()
  const security = useSecurity.getState()
  const oldWindow = global.window
  global.window = { alert: () => {} }
  try {
    const base = plant()
    useStore.setState({ ...before, modules: base.modules, deviceLifecycle: {} })
    useSecurity.setState({ currentUser: 'OperatorA', locked: false })
    assert.equal(useStore.getState().setDeviceLogic('V1', { bypassed: true }), false)
    useSecurity.setState({ currentUser: 'admin', locked: false })
    assert.equal(useStore.getState().setDeviceLogic('V1', { interlockConditions: [{ source: 'A', description: 'ILK' }],
      permissiveConditions: [{ source: 'B', description: 'PRM' }], forceSetpoints: [{ source: 'B', description: 'FRC', state: 'ACTIVE' }] }), true)
    const configured = useStore.getState().modules.V1
    assert.equal(configured.interlockConditions.length, 1)
    assert.equal(configured.permissiveRequired, true)
    assert.equal(useStore.getState().setDeviceLogic('V1', { interlockConditions: [{ source: 'V1', description: 'SELF' }] }), false)
    assert.equal(useStore.getState().modules.V1.interlockConditions.length, 1)
    useStore.setState({ modules: { ...useStore.getState().modules, V1: { ...configured, interlock: true, permissiveOk: false } } })
    assert.equal(useStore.getState().setDeviceLogic('V1', { interlockConditions: [], permissiveConditions: [] }), true)
    assert.equal(useStore.getState().modules.V1.interlock, false)
    assert.equal(useStore.getState().modules.V1.permissiveOk, true)
    assert.ok(useStore.getState().eventLog.some(entry => entry.tag === 'V1' && /Device logic changed/.test(entry.description)))
    useStore.setState({ deviceLifecycle: { V1: { online: false } } })
    assert.equal(useStore.getState().setDeviceLogic('V1', { bypassed: true }), false)
  } finally {
    useStore.setState(before, true)
    useSecurity.setState(security, true)
    global.window = oldWindow
  }
})
