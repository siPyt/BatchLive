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
const { makeModule } = require('../src/renderer/src/engine/plant.ts')
const studio = require('../src/renderer/src/displays/ControlStudioDisplay.tsx')

function render(tag, Component = studio.ControlStudioDisplay, props) {
  const before = ui.useUi.getState()
  ui.useUi.setState({ studioTag: tag })
  const hooks = [
    test.mock.method(store, 'useStore', selector => selector(store.useStore.getState())),
    test.mock.method(ui, 'useUi', selector => selector(ui.useUi.getState()))
  ]
  try {
    return renderToStaticMarkup(React.createElement(Component, props))
  } finally {
    hooks.forEach(hook => hook.mock.restore())
    ui.useUi.setState(before, true)
  }
}
const text = html => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

function withLogicValve(fn) {
  const before = store.useStore.getState()
  try {
    const di = makeModule({ tag: 'T-DI', description: 'TEST CONDITION', area: 'FEED', type: 'DI' })
    const valve = { ...before.modules['XV-101'], interlock: true, permissiveRequired: true, permissiveOk: false, bypassed: false,
      interlockConditions: [{ source: 'T-DI', description: 'HIGH LEVEL', bypassable: true }],
      permissiveConditions: [{ source: 'T-DI', description: 'AIR OK', invert: true }],
      forceSetpoints: [{ source: 'T-DI', description: 'EMERGENCY CLOSE', state: 'PASSIVE' }] }
    di.state = true
    store.useStore.setState({ modules: { ...before.modules, 'T-DI': di, 'XV-101': valve } })
    fn()
  } finally {
    store.useStore.setState(before, true)
  }
}

test('a valve opens on its actual logic: configured conditions wired into DCC1/EDC1 with live values', () => {
  withLogicValve(() => {
    const html = render('XV-101')
    const flat = text(html)
    assert.match(html, /aria-label="XV-101 module logic"/)
    assert.match(html, /aria-label="XV-101 device control logic"/)
    for (const name of ['DCC1', 'EDC1', 'CND1', 'CMD_IN_D', 'P_OUT_D', 'I_OUT_D', 'F_OUT_D', 'SHUTDOWN_D', 'PERMISSIVE_D', 'INTERLOCK_D',
      'FORCE_SP_D', 'CAS_IN_D', 'REQ_SP', 'SP_D', 'MODE', 'PV_D', 'PV_STATE', 'FAILURE', 'BYPASSED']) {
      assert.ok(flat.includes(name), name)
    }
    assert.ok(flat.includes('#1 HIGH LEVEL'))
    assert.ok(flat.includes('#1 AIR OK'))
    assert.ok(flat.includes('#1 EMERGENCY CLOSE'))
    assert.ok(flat.includes('T-DI = True'))
    assert.ok(flat.includes('T-DI (inv) = False'))
    assert.match(html, /data-conditions="Interlock conditions"/)
    assert.match(html, /data-conditions="Permissive conditions"/)
    assert.match(html, /data-conditions="Force setpoints"/)
  })
})

test('the logic view explains what the module is doing right now and why, from the real configuration', () => {
  withLogicValve(() => {
    const flat = text(render('XV-101'))
    assert.match(flat, /Right now: XV-101 is held Closed \(SHUTDOWN\) because the interlock is tripped/)
    assert.match(flat, /#1 "EMERGENCY CLOSE": T-DI = True -> forces PASSIVE \[ACTING\]/)
    assert.match(flat, /Force setpoint #1 "EMERGENCY CLOSE" is true, so the request is forced to Closed/)
    assert.match(flat, /#1 "HIGH LEVEL": T-DI = True, bypassable \[TRIPPING\]/)
    assert.match(flat, /Execution order every scan: force setpoints, command source, interlocks, permissives/)
    assert.match(flat, /Mode locking \(OWNER_ID, HOLD_REQ, MODELOCK_OVR, MODELOCKED\) and Equipment Module acquire\/release arbitration are not simulated/)
  })
})

test('the logic view lets an authorised engineer edit the real condition lists', () => {
  withLogicValve(() => {
    const html = render('XV-101')
    for (const label of ['Force setpoint conditions editor', 'Interlock conditions editor', 'Permissive conditions editor']) {
      assert.ok(html.includes(`aria-label="${label}"`), label)
    }
    assert.match(html, /aria-label="Interlock 1 source"[^>]*value="T-DI"/)
    assert.match(html, /aria-label="Interlock 1 bypassable"[^>]*checked=""/)
    assert.match(html, /aria-label="Force setpoint 1 state"/)
    assert.match(html, /aria-label="BYPASSED"/)
    assert.ok(html.includes('Add condition') && html.includes('>Apply<') && html.includes('>Revert<'))
  })
})

test('motors get the same real logic view with motor wording', () => {
  const flat = text(render('P-101'))
  assert.match(flat, /P-101 - motor control logic/)
  assert.match(flat, /Passive \(fail-safe\) state: Stopped/)
  assert.ok(flat.includes('DCC1') && flat.includes('EDC1'))
})

test('each module is one continuous page: the real diagram flows straight into its explanation, with no Module Logic tab or split panes', () => {
  const pid = render('TIC-201')
  const flat = text(pid)
  assert.ok(!pid.includes('studio-view-tabs') && !pid.includes('Module Logic'))
  assert.match(pid, /aria-label="TIC-201 diagram and logic explanation"/)
  const page = pid.slice(pid.indexOf('class="studio-page"'), pid.indexOf('class="studio-bottom"'))
  assert.ok(page.indexOf('fbd-canvas-compact') > -1 && page.indexOf('aria-label="TIC-201 logic explanation"') > page.indexOf('fbd-canvas-compact'), 'diagram then explanation inside one page')
  assert.match(flat, /TIC-201 - PID loop logic/)
  assert.match(flat, /Gain x \(error \+/)
  assert.ok(!pid.includes('>Logic Explanation</button>'))
  assert.match(pid, /role="tab"[^>]*>Parameter View<\/button>/)
  assert.match(pid, /role="tab"[^>]*>Alarm View<\/button>/)

  withLogicValve(() => {
    const valve = render('XV-101')
    assert.ok(!valve.includes('Module Logic') && !valve.includes('studio-view-tabs'))
    const vpage = valve.slice(valve.indexOf('class="studio-page"'), valve.indexOf('class="studio-bottom"'))
    const order = ['device control logic', '2. Force setpoints', 'Force setpoint conditions editor', '3. Interlocks',
      'Interlock conditions editor', '4. Permissives', 'Permissive conditions editor', '5. Device control and confirmation']
    let at = -1
    for (const marker of order) {
      const next = vpage.indexOf(marker)
      assert.ok(next > at, `${marker} follows the previous section in the same page`)
      at = next
    }
  })
})
test('the ribbon follows the reference Home tab: groups, large and small buttons, dark active Edit/On-Line state', () => {
  const html = render('XV-101')
  const groups = [...html.matchAll(/class="rb-group-label">([^<]+)</g)].map(match => match[1])
  assert.deepEqual(groups, ['Clipboard', 'Module', 'Insert', 'Alarms', 'Algorithm', 'Diagram Mode', 'Class', 'Advanced', 'Version Control'])
  const large = ['Paste', 'Download', 'Assign To Node', 'Module Parameter', 'Alarm', 'Alarm Groups Configuration',
    'Alarm Groups Assignment References', 'Edit Object', 'Drill Down', 'Back Out', 'On-Line Debug', 'Edit', 'Check Out']
  const small = ['Cut', 'Copy', 'History Collection', 'History Recorder', 'Properties', 'Custom', 'Text Box', 'State Item',
    'Configure', 'Named Set', 'Tune with Insight', 'Predict', 'Neural']
  for (const label of large) assert.match(html, new RegExp(`class="rb-btn rb-large[^"]*"[^>]*aria-label="${label}"`), label)
  for (const label of small) assert.match(html, new RegExp(`class="rb-btn rb-small[^"]*"[^>]*aria-label="${label}"`), label)
  assert.match(html, /class="rb-btn rb-large active"[^>]*aria-label="On-Line Debug"[^>]*aria-pressed="true"/)
  assert.match(html, /aria-label="Edit"[^>]*disabled=""|disabled=""[^>]*aria-label="Edit"/)
  assert.match(html, /optional licensed DeltaV application and is not included in this simulator/)
  for (const tab of ['File', 'Home', 'Diagram', 'View']) assert.ok(html.includes(`>${tab}</button>`), tab)
  assert.match(html, /aria-label="Quick access"/)
  assert.match(html, /aria-label="Save"/)
})

test('Alarm View lists the module alarm definitions; the status bar reports controller assignment and zoom', () => {
  const alarm = render('XV-101', studio.AlarmView, { module: store.useStore.getState().modules['XV-101'] })
  assert.match(alarm, /aria-label="XV-101 alarm view"/)
  for (const column of ['Alarm', 'Word', 'State', 'Parameter', 'Limit Value', 'Enabled', 'Invert', 'Priority', 'Functional Class', 'Alarm Description']) {
    assert.ok(alarm.includes(`<th>${column}</th>`), column)
  }
  assert.match(alarm, /<td>FAILURE<\/td>/)
  const html = render('XV-101')
  assert.match(html, /Assigned to: (<!-- -->)?Not assigned/)
  assert.match(html, /type="range"[^>]*aria-label="Zoom"|aria-label="Zoom"[^>]*type="range"/)
})
