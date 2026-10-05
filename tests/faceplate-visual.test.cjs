const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, filename)
  }
}
const store = require('../src/renderer/src/engine/store.ts')
const { useStore } = store
const { deviceStatusBlock, OwnedByRow, ModelockOverrideRow } = require('../src/renderer/src/faceplates/FaceplateChrome.tsx')
const { PidFaceplate } = require('../src/renderer/src/faceplates/PidFaceplate.tsx')
const { MotorFaceplate } = require('../src/renderer/src/faceplates/MotorFaceplate.tsx')
const { ValveFaceplate } = require('../src/renderer/src/faceplates/ValveFaceplate.tsx')

function renderFaceplate(Component, tag) {
  // SSR uses Zustand's initial snapshot; select the test's current fixture instead.
  const hook = test.mock.method(store, 'useStore', selector => selector(useStore.getState()))
  try {
    return renderToStaticMarkup(React.createElement(Component, { tag }))
  } finally {
    hook.mock.restore()
  }
}

test('device status uses lifecycle feedback and prioritizes interlocks over permissives', () => {
  for (const [state, expected] of [
    ['CONFIRMED_ACTIVE', 'Confirmed Running'], ['CONFIRMED_PASSIVE', 'Confirmed Stopped'],
    ['GOING_ACTIVE', 'Going to Running'], ['GOING_PASSIVE', 'Going to Stopped'],
    ['FAILED_ACTIVE', 'Failed Running'], ['FAILED_PASSIVE', 'Failed Stopped'],
    ['SHUTDOWN', 'Shutdown'], ['LOCKED', 'Locked']
  ]) {
    const status = deviceStatusBlock(state, true, true, false, true, 'Running', 'Stopped')
    assert.equal(status.deviceState, expected)
    assert.equal(status.operationState, 'Interlocked')
    assert.equal(status.failureState, 'Faulted')
  }
  assert.equal(deviceStatusBlock('CONFIRMED_PASSIVE', false, true, false, false, 'Open', 'Closed').operationState, 'Permissive Not Met')
  assert.equal(deviceStatusBlock('CONFIRMED_ACTIVE', false, false, false, false, 'Open', 'Closed').operationState, 'Normal')
})

test('unmodeled arbitration is explicit and membership is not presented as ownership', () => {
  const owned = renderToStaticMarkup(React.createElement(OwnedByRow, { equipmentModule: 'EM-TEST' }))
  assert.match(owned, /Owned by:.*Not modeled/)
  assert.match(owned, /Equipment Module:.*EM-TEST/)
  assert.match(renderToStaticMarkup(React.createElement(ModelockOverrideRow)), /disabled=""/)
})

test('PID reference layout has vertical PV with SP marker and horizontal output, with safe output gates', () => {
  const before = useStore.getState()
  const pid = Object.values(before.modules).find(module => module.type === 'PID')
  assert.ok(pid)
  try {
    for (const [mode, actualMode, online, editable] of [
      ['MAN', 'MAN', true, true], ['ROUT', 'ROUT', true, true],
      ['AUTO', 'MAN', true, false], ['MAN', 'LO', true, false],
      ['MAN', 'OOS', true, false], ['MAN', 'MAN', false, false]
    ]) {
      useStore.setState({
        modules: { ...before.modules, [pid.tag]: { ...pid, mode, actualMode } },
        pidLifecycle: online ? {} : { [pid.tag]: { online: false } }
      })
      const html = renderFaceplate(PidFaceplate, pid.tag)
      assert.match(html, /fp-pid-process.*fp-bar tall.*sp-marker/)
      assert.match(html, /fp-bar-h.*fill-h out/)
      const adjust = html.match(/<button[^>]*class="fp-bar-adjust"[^>]*>/g)
      assert.equal(adjust.length, 2)
      assert.equal(adjust.every(button => !button.includes('disabled=""')), editable)
    }
  } finally {
    useStore.setState(before, true)
  }
})

test('motor and valve state words follow feedback rather than requested commands', () => {
  const before = useStore.getState()
  try {
    for (const [type, Component, feedback, passive, active] of [
      ['MOTOR', MotorFaceplate, 'running', 'STOPPED', 'RUNNING'],
      ['VALVE', ValveFaceplate, 'open', 'CLOSED', 'OPEN']
    ]) {
      const module = Object.values(before.modules).find(item => item.type === type)
      assert.ok(module)
      for (const value of [false, true]) {
        useStore.setState({ modules: { ...before.modules, [module.tag]: {
          ...module, [feedback]: value, commanded: !value, commandedOpen: !value
        } } })
        const html = renderFaceplate(Component, module.tag)
        assert.match(html, new RegExp(`fp-state-word[^>]*>${value ? active : passive}</div>`))
      }
    }
  } finally {
    useStore.setState(before, true)
  }
})
