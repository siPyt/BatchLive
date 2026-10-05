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
const ui = require('../src/renderer/src/ui/uiStore.ts')
const { ControlStudioDisplay } = require('../src/renderer/src/displays/ControlStudioDisplay.tsx')

function render(tag) {
  const before = ui.useUi.getState()
  ui.useUi.setState({ studioTag: tag })
  const hooks = [
    test.mock.method(store, 'useStore', selector => selector(store.useStore.getState())),
    test.mock.method(ui, 'useUi', selector => selector(ui.useUi.getState()))
  ]
  try {
    return renderToStaticMarkup(React.createElement(ControlStudioDisplay))
  } finally {
    hooks.forEach(hook => hook.mock.restore())
    ui.useUi.setState(before, true)
  }
}

test('a discrete valve opens as an elaborate documented module with narratives, blocks and parameters', () => {
  const html = render('XV-101')
  for (const title of ['DISCRETE VALVE MODULE WITH INTERLOCKS AND PERMISSIVES', 'Mode Locking', 'DC Algorithm',
    'Standard Interface Parameters', 'User Defined Variables', 'Failure Propagation to Higher Levels',
    'Module Configuration', 'Configured Device Options', 'Revision History']) {
    assert.ok(html.includes(title), title)
  }
  for (const name of ['DCC1', 'EDC1', 'CND1', 'MODELOCK', 'C_DC_ML_V01', 'CMD_IN_D', 'P_OUT_D', 'I_OUT_D', 'SHUTDOWN_D',
    'PERMISSIVE_D', 'INTERLOCK_D', 'FORCE_SP_D', 'CAS_IN_D', 'SENTINEL', 'OWNER_ID', 'HOLD_REQ', 'MODELOCK_OVR', 'REQ_MODE',
    'REQ_SP', 'BYPASSED', 'SP_D', 'PV_D', 'PV_STATE', 'FAILURE', 'TP01_D', 'TP10']) {
    assert.ok(html.includes(name), name)
  }
  assert.match(html, /CND1 sets FAILURE to True when any active fail condition exists/)
  assert.match(html, /Owner arbitration is not simulated/)
  assert.match(html, /aria-label="Configured device options"/)
  assert.match(html, /aria-label="Revision history"/)
  assert.match(html, /EM-FEED-SUPPLY/)
  assert.match(html, /role="tab"[^>]*>Module Template<\/button>/)
  assert.match(html, /role="tab"[^>]*>Function Block Diagram<\/button>/)
})

test('the module template shows live module state, not static artwork', () => {
  const before = store.useStore.getState()
  try {
    const valve = before.modules['XV-101']
    store.useStore.setState({ modules: { ...before.modules,
      'XV-101': { ...valve, interlock: true, fault: true, open: false, commandedOpen: true } } })
    const html = render('XV-101')
    assert.match(html, /True = I_OUT_D/)
    assert.match(html, /Device fault \(transition not confirmed or fault injected\)/)
    assert.match(html, /Device fault/)
    assert.match(html, /DC_STATE = /)
    store.useStore.setState({ modules: { ...before.modules, 'XV-101': { ...valve, interlock: false, fault: false } } })
    assert.doesNotMatch(render('XV-101'), /No fail condition is active\.[\s\S]*Device fault/)
    assert.match(render('XV-101'), /No fail condition is active\./)
  } finally {
    store.useStore.setState(before, true)
  }
})

test('motors use the same documented template with running and stopped wording', () => {
  const html = render('P-101')
  assert.match(html, /DISCRETE MOTOR MODULE/)
  assert.match(html, /passive\s*\(stopped\) state/)
  assert.ok(html.includes('DCC1') && html.includes('EDC1'))
})

test('non-discrete modules keep the function block diagram without the module template tabs', () => {
  const html = render('FIC-101')
  assert.ok(!html.includes('tmpl-document'))
  assert.ok(!html.includes('studio-view-tabs'))
  assert.ok(!html.includes('aria-label="Module Template"'))
})

test('the ribbon follows the reference groups and reports unavailable commands honestly', () => {
  const html = render('XV-101')
  for (const group of ['Clipboard', 'Module', 'Diagram', 'Insert', 'Alarms', 'Algorithm', 'Diagram Mode', 'Class', 'Advanced', 'Version Control']) {
    assert.ok(html.includes(`>${group}</div>`), group)
  }
  for (const label of ['Module Parameter', 'Custom', 'Text Box', 'State Item', 'Alarm', 'Alarm Groups Configuration',
    'Alarm Groups Assignment', 'References', 'Edit Object', 'Drill Down', 'Back Out', 'On-Line Debug', 'Edit',
    'Configure', 'Named Set', 'Tune with Insight', 'Predict', 'Neural', 'Check Out']) {
    assert.ok(html.includes(`aria-label="${label}"`), label)
  }
  assert.match(html, /aria-label="Tune with Insight"[^>]*>|disabled=""[^>]*title="Tune with InSight is an optional licensed DeltaV application/)
  assert.match(html, /optional licensed DeltaV application and is not included in this simulator/)
  assert.match(html, /aria-label="Predict"/)
  assert.match(html, /aria-label="Edit"[^>]*disabled=""|disabled=""[^>]*aria-label="Edit"/)
  assert.match(html, /aria-label="On-Line Debug"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="On-Line Debug"/)
})

test('Alarm View lists the module alarm definitions and the status bar reports controller assignment and zoom', () => {
  const html = render('XV-101')
  assert.match(html, /aria-label="XV-101 alarm view"/)
  for (const column of ['Alarm', 'Word', 'State', 'Parameter', 'Limit Value', 'Enabled', 'Invert', 'Priority',
    'Functional Class', 'Alarm Description']) {
    assert.ok(html.includes(`<th>${column}</th>`), column)
  }
  assert.match(html, /<td>FAILURE<\/td>/)
  assert.match(html, /Assigned to: (<!-- -->)?Not assigned/)
  assert.match(html, /type="range"[^>]*aria-label="Zoom"|aria-label="Zoom"[^>]*type="range"/)
  const pid = render('FIC-101')
  assert.match(pid, /aria-label="FIC-101 alarm view"/)
  assert.match(pid, /<td>PV<\/td>/)
})
