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
const { buildInitialPlant, BUILTIN_TAGS } = require('../src/renderer/src/engine/plant.ts')
const { makeDefaultHardware } = require('../src/renderer/src/engine/hardware.ts')
const { stepPlant } = require('../src/renderer/src/engine/simulate.ts')
const { processWasteComplete } = require('../src/renderer/src/engine/processWaste.ts')
const { DEFAULT_PLANT_AREAS } = require('../src/renderer/src/engine/areas.ts')
const { moduleNameError } = require('../src/renderer/src/engine/naming.ts')
const studio = require('../src/renderer/src/displays/ControlStudioDisplay.tsx')
const { AreaDisplay } = require('../src/renderer/src/displays/AreaDisplay.tsx')

const P = '3WT-0001-'
// The waste pH is a function of plant time, so pin the clock: tests are deterministic per influent phase.
const fresh = (time = 0) => ({ ...buildInitialPlant(), hardware: makeDefaultHardware(), speed: 1, time })
const run = (state, seconds) => {
  let s = state
  for (let i = 0; i < seconds; i++) s = stepPlant(s, 1)
  return s
}
const text = html => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

function render(Component, props, studioTag) {
  const before = ui.useUi.getState()
  if (studioTag) ui.useUi.setState({ studioTag })
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

test('the process waste modules are a complete, valid, built-in part of the default plant', () => {
  const state = fresh()
  assert.ok(DEFAULT_PLANT_AREAS.includes('PWASTE'))
  assert.ok(processWasteComplete(state.modules))
  const tags = Object.values(state.modules).filter(m => m.area === 'PWASTE').map(m => m.tag)
  assert.ok(tags.length >= 20)
  for (const tag of tags) {
    assert.equal(moduleNameError(tag), null, tag)
    assert.ok(BUILTIN_TAGS.has(tag), `${tag} should be a built-in tag`)
  }
})

test('Control Studio shows the real device logic wired for each pump and valve', () => {
  store.useStore.setState({ modules: fresh().modules })
  const expected = {
    [P + 'P01']: ['#1 NEUT TANK HI-HI', '#2 EQ TANK LOW-LOW', `${P}LAHH002 = False`, `${P}LALL001 = False`],
    [P + 'P02']: ['#1 NEUT TANK LOW-LOW'],
    [P + 'XV01']: ['#1 NEUT TANK HI-HI'],
    [P + 'XV010']: ['#1 EQ TANK HI-HI'],
    '3CIP-3200-XV025': ['#1 EQ TANK HI-HI'],
    [P + 'XV05']: ['#1 TANK pH LOW', '#2 TANK pH HIGH', '#3 NEUT TANK LOW-LOW']
  }
  for (const [tag, fragments] of Object.entries(expected)) {
    const html = render(studio.ControlStudioDisplay, undefined, tag)
    const flat = text(html)
    assert.match(html, new RegExp(`aria-label="${tag} device control logic"`), tag)
    assert.match(html, /data-conditions="Interlock conditions"/, tag)
    for (const fragment of fragments) assert.ok(flat.includes(fragment), `${tag}: ${fragment}`)
  }
})

test('Control Studio shows the pH loop as AI1 -> PID1 -> SPLTR1 -> AO1 / AO2 and the level switches as comparators', () => {
  store.useStore.setState({ modules: fresh().modules })
  const flat = text(render(studio.ControlStudioDisplay, undefined, P + 'AIC002'))
  for (const block of ['AI1', 'PID1', 'SPLTR1', 'AO1', 'AO2']) assert.ok(flat.includes(block), block)
  for (const tag of ['LAHH001', 'LAHH002', 'LALL001', 'LALL002', 'PHLO', 'PHHI']) {
    const html = render(studio.ControlStudioDisplay, undefined, P + tag)
    assert.match(html, new RegExp(`${P}${tag}`), tag)
  }
})

for (const phase of [0, 300, 600, 900]) test(`the pH loop holds its setpoint against the wandering waste with acid and base dosing in the right direction (waste phase ${phase}s)`, () => {
  let s = fresh(phase * 1000)
  let sawAcid = false
  let sawBase = false
  for (let t = 0; t < 1800; t += 10) {
    s = run(s, 10)
    const aic = s.modules[P + 'AIC002']
    if (t > 300) assert.ok(aic.pv > 5.2 && aic.pv < 6.8, `pH ${aic.pv.toFixed(2)} at ${t}s`)
    // A single dosing direction at a time, never both.
    assert.ok(aic.io.ao.out < 1 || aic.io.ao2.out < 1, 'acid and base must not dose together')
    if (aic.io.ao.out > 1) { sawAcid = true; assert.ok(aic.out <= 49.5) }
    if (aic.io.ao2.out > 1) { sawBase = true; assert.ok(aic.out >= 50.5) }
  }
  assert.ok(sawAcid && sawBase, 'the wandering waste should need both acid and base')
  for (const tag of ['P01', 'P02']) assert.equal(s.modules[P + tag].running, true, tag)
  for (const tag of ['XV01', 'XV05', 'XV010']) assert.equal(s.modules[P + tag].open, true, tag)
  const alarms = s.alarms.filter(a => a.moduleTag.startsWith(P) && a.active)
  assert.deepEqual(alarms.map(a => `${a.moduleTag}:${a.label}`), [])
})

test('tank levels respond to the pumps and valves, not to a generic drift', () => {
  let s = fresh()
  const eq0 = s.modules[P + 'LI001'].pv
  s.modules[P + 'P01'].commanded = false
  s = run(s, 60)
  assert.ok(s.modules[P + 'LI001'].pv > eq0 + 10, 'equalization tank fills with the transfer pump stopped')
  assert.ok(s.modules[P + 'LI002'].pv < 79.5, 'neutralization tank drains with nothing arriving')
})

test('a closed drain fills the neutralization tank and the LAHH002 interlock shuts the transfer path', () => {
  let s = fresh()
  s = run(s, 20)
  s.modules[P + 'XV05'].commandedOpen = false
  s = run(s, 90)
  assert.ok(s.modules[P + 'LI002'].pv >= 90)
  assert.notEqual(s.modules[P + 'LAHH002'].out, 0)
  for (const tag of ['P01', 'XV01']) {
    assert.equal(s.modules[P + tag].dcState, 'SHUTDOWN', tag)
    assert.equal(s.modules[P + tag].interlock, true, tag)
  }
  assert.equal(s.modules[P + 'P01'].running, false)
  assert.equal(s.modules[P + 'XV01'].open, false)
  assert.ok(s.alarms.some(a => a.moduleTag === P + 'LI002' && a.active))
  assert.ok(s.modules[P + 'LI002'].pv < 91, 'no further inflow once the transfer path is shut')
})

test('running the equalization tank dry trips and latches the transfer pump until reset', () => {
  let s = fresh()
  s.modules[P + 'XV010'].commandedOpen = false
  s = run(s, 260)
  const p01 = s.modules[P + 'P01']
  assert.ok(s.modules[P + 'LI001'].pv < 11)
  assert.equal(p01.running, false)
  assert.equal(p01.locked, true)
  s.modules[P + 'XV010'].commandedOpen = true
  s = run(s, 200)
  assert.ok(s.modules[P + 'LI001'].pv > 15, 'level recovers once the inlet is reopened')
  assert.equal(s.modules[P + 'P01'].running, false, 'Reset Required keeps the pump off until the operator resets it')
})

test('an empty acid drum stops acid dosing so the tank pH is no longer controlled down', () => {
  let s = fresh(0)
  s.modules[P + 'LAL002'].state = true
  let peak = 0
  for (let t = 0; t < 600; t += 10) { s = run(s, 10); peak = Math.max(peak, s.modules[P + 'AIC002'].pv) }
  assert.ok(peak > 7, `pH should drift up without acid, peaked at ${peak.toFixed(2)}`)
  assert.ok(s.alarms.some(a => a.moduleTag === P + 'LAL002' && a.active))
})

test('the discharge valve closes on an out-of-window tank pH', () => {
  let s = fresh()
  s.modules[P + 'AI02AVG'].pv = 9.6
  s = run(s, 6)
  let xv05 = s.modules[P + 'XV05']
  assert.equal(xv05.interlock, true)
  assert.equal(xv05.open, false)
  // The analyzer filter brings the pH back into the window, so the valve is released and reopens (no Reset Required).
  s = run(s, 60)
  xv05 = s.modules[P + 'XV05']
  assert.equal(xv05.interlock, false)
  assert.equal(xv05.open, true)
})

test('the process waste picture renders live module state, and degrades cleanly when modules are missing', () => {
  store.useStore.setState({ modules: fresh().modules })
  const html = render(AreaDisplay, { area: 'PWASTE' })
  const flat = text(html)
  for (const fragment of ['Process Waste Neutralization', '3WT-0001-LAHH001', '3WT-0001-LAL002', 'Equalization', 'Neutralization',
    'Base', 'Acid', 'Drain']) assert.ok(flat.includes(fragment), fragment)
  assert.match(html, /3WT-0001-XV010: Open"?</)
  assert.match(html, /data-equipment-tag="3WT-0001-P01"/)
  const closed = fresh().modules
  closed[P + 'XV010'] = { ...closed[P + 'XV010'], open: false }
  store.useStore.setState({ modules: closed })
  assert.match(render(AreaDisplay, { area: 'PWASTE' }), /3WT-0001-XV010: Closed/)
  store.useStore.setState({ modules: fresh().modules })

  const modules = fresh().modules
  delete modules[P + 'LAHH001']
  store.useStore.setState({ modules })
  assert.match(text(render(AreaDisplay, { area: 'PWASTE' })), /picture is unavailable.*3WT-0001-LAHH001/)
  let s = { ...fresh(), modules }
  assert.doesNotThrow(() => { s = run(s, 5) }, 'the plant still steps without the full process waste set')
})
