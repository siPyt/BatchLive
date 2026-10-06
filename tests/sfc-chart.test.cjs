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
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { SfcDisplay, transitionName } = require('../src/renderer/src/displays/SfcDisplay.tsx')

const NAME = 'CHART-TEST'
const step = (id, name, extra = {}) => ({ id, name, actions: [], transition: { kind: 'timer', seconds: 1 }, ...extra })
/** Shaped like the Control Studio screenshot 2001 (OL_TYPE with a rail of T3/T3A/T3B) plus a parallel fork and join. */
const steps = () => [
  step('run', 'RUN', { nextStep: 'init' }),
  step('init', 'INIT', { nextStep: 'oltype' }),
  step('oltype', 'OL_TYPE', {
    nextStep: 'idstart',
    alternatives: [
      { condition: { kind: 'expression', text: "'^/LIC-101/PID1/PV.CV' > 60 AND T_ACTIVE >= 2" }, nextStep: 'a' },
      { condition: { kind: 'timer', seconds: 9 }, nextStep: 'b' }
    ]
  }),
  step('idstart', 'ID_START', { nextStep: 'join' }),
  step('a', 'SET_FC_1', { nextStep: 'join' }),
  step('b', 'SET_FC_2', { nextStep: 'join' }),
  step('join', 'CLS_OL', { nextStep: 'fork' }),
  step('fork', 'FORK', { parallelNextSteps: ['p1', 'p2'] }),
  step('p1', 'PUMP', { nextStep: 'pj' }),
  step('p2', 'VALVE', { nextStep: 'pj' }),
  step('pj', 'DONE', { joinFrom: ['p1', 'p2'], nextStep: null })
]

function render() {
  const previous = { store: store.useStore.getState(), security: useSecurity.getState(), window: global.window }
  global.window = { alert: () => {}, localStorage: { getItem: () => null, setItem: () => {} } }
  const hooks = []
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    store.useStore.getState().newProject('pharma')
    store.useStore.getState().createSfc(NAME, 'FEED')
    store.useStore.getState().setSfcSteps(NAME, steps())
    ui.useUi.getState().openSfc(NAME)
    const realStore = store.useStore
    const realUi = ui.useUi
    hooks.push(test.mock.method(store, 'useStore', selector => selector(realStore.getState())))
    hooks.push(test.mock.method(ui, 'useUi', selector => selector(realUi.getState())))
    return renderToStaticMarkup(React.createElement(SfcDisplay))
  } finally {
    hooks.forEach(hook => hook.mock.restore())
    store.useStore.setState(previous.store, true)
    useSecurity.setState(previous.security, true)
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
  }
}

test('SFC transitions are named like Control Studio: T<n>, with a letter suffix for selective alternatives', () => {
  assert.equal(transitionName(0), 'T1')
  assert.equal(transitionName(2), 'T3')
  assert.equal(transitionName(2, 0), 'T3A')
  assert.equal(transitionName(2, 1), 'T3B')
})

test('SFC chart draws a cross on every route, one rail for selective branches and a double bar for parallel ones', () => {
  const html = render()
  for (const name of ['T1', 'T3', 'T3A', 'T3B', 'T8']) assert.match(html, new RegExp(`>${name}<`), name)
  assert.match(html, /data-transition="alternate-0"/)
  assert.match(html, /data-transition="alternate-1"/)
  const rails = [...html.matchAll(/data-rail="(selective|parallel)"/g)].map(match => match[1])
  assert.equal(rails.filter(kind => kind === 'selective').length, 2, 'one rail under OL_TYPE and one above CLS_OL')
  assert.equal(rails.filter(kind => kind === 'parallel').length, 2, 'a double bar after the fork and before the join')
  assert.equal((html.match(/class="sfc-rail"/g) ?? []).length + (html.match(/class="sfc-rail sfc-rail-active"/g) ?? []).length, 6,
    'two single rails plus two double bars (two lines each)')
  assert.ok(!/<text[^>]*>T3A: /.test(html), 'expressions are hidden by default; only the name is drawn')
  assert.ok(html.includes("Alternate 1: "), 'the full expression stays in the tooltip')
  assert.ok(html.includes("T_ACTIVE &gt;= 2"), 'the tooltip carries the expression text')
  assert.match(html, /Show transition expressions/)
})
