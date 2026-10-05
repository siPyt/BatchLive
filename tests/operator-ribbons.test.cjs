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
const useStore = store.useStore
const useUi = ui.useUi
const { DISPLAY_NAVIGATION } = require('../src/renderer/src/ui/displayNavigation.ts')
const { TopBar } = require('../src/renderer/src/components/TopBar.tsx')
const { AreaDisplay } = require('../src/renderer/src/displays/AreaDisplay.tsx')
const { OverviewDisplay } = require('../src/renderer/src/displays/OverviewDisplay.tsx')
const { App } = require('../src/renderer/src/App.tsx')

function render(Component, props) {
  const hooks = [
    test.mock.method(store, 'useStore', selector => selector(useStore.getState())),
    test.mock.method(ui, 'useUi', selector => selector(useUi.getState()))
  ]
  try {
    return renderToStaticMarkup(React.createElement(Component, props))
  } finally {
    hooks.forEach(hook => hook.mock.restore())
  }
}

test('three ribbon bands expose every display and preserve the excluded branding', () => {
  const html = render(TopBar)
  assert.equal((html.match(/role="toolbar"/g) || []).length, 3)
  for (const label of ['Operator utilities', 'Display actions', 'Picture navigation', 'Current display',
    'Back', 'Forward', 'Up to Plant Overview', 'Home display', 'Search displays and modules']) {
    assert.ok(html.includes(`aria-label="${label}"`), label)
  }
  assert.equal(new Set(DISPLAY_NAVIGATION.map(display => display.id)).size, 20)
  for (const display of DISPLAY_NAVIGATION) assert.ok(html.includes(`value="${display.id}"`), display.id)
  assert.match(html, /class="brand-name">BatchLive<\/span>/)
  assert.match(html, /class="brand-credit">Charles R\. Freeman, software engineer<\/span>/)
})

test('operator layout places the alarm banner below the working area with an optional sidebar', () => {
  const before = ui.useUi.getState()
  try {
    ui.useUi.setState({ navigationOpen: false })
    const html = render(App)
    assert.ok(html.indexOf('operator-ribbons') < html.indexOf('app-body'))
    assert.ok(html.indexOf('app-body') < html.indexOf('alarm-banner'))
    assert.ok(html.indexOf('alarm-banner') < html.indexOf('statusbar'))
    assert.ok(!html.includes('class="nav-sidebar"'))
    ui.useUi.getState().toggleNavigation()
    assert.ok(render(App).includes('class="nav-sidebar"'))
  } finally {
    ui.useUi.setState(before, true)
  }
})

test('picture navigation and reset affect UI only, never live process state or faceplates', () => {
  const engine = store.useStore.getState()
  const before = ui.useUi.getState()
  try {
    ui.useUi.setState({ display: 'overview', history: ['overview'], histIndex: 0, pictureHistory: [null],
      faceplates: [{ tag: 'FIC-101', x: 50, y: 50 }] })
    const s = ui.useUi.getState()
    s.navigate('wfi')
    s.navigate('cip')
    s.back()
    assert.equal(ui.useUi.getState().display, 'wfi')
    s.forward()
    assert.equal(ui.useUi.getState().display, 'cip')
    const revision = ui.useUi.getState().processViewRevision
    s.resetProcessView()
    assert.equal(ui.useUi.getState().processViewRevision, revision + 1)
    assert.deepEqual(ui.useUi.getState().faceplates, [{ tag: 'FIC-101', x: 50, y: 50 }])
    assert.equal(store.useStore.getState(), engine)
  } finally {
    ui.useUi.setState(before, true)
  }
})

test('all process areas render graphics with collapsed, still-accessible module directories', () => {
  for (const area of ['FEED', 'REACTOR', 'PRODUCT', 'WFI', 'AUTOCLAVE', 'LYO', 'CIP', 'TCU']) {
    const html = render(AreaDisplay, { area })
    assert.match(html, /<svg/, area)
    assert.match(html, /<details class="plant-directory">/, area)
    assert.ok(!html.includes('<details class="plant-directory" open'), area)
    assert.match(html, /Module directory \(/, area)
  }
})

test('blank projects show an explicit unconfigured picture rather than throwing', () => {
  const before = store.useStore.getState()
  try {
    store.useStore.setState({ modules: {} })
    assert.match(render(OverviewDisplay), /Reactor train modules are not configured/)
    assert.match(render(AreaDisplay, { area: 'WFI' }), /No modules configured in this area/)
    assert.equal(Object.keys(store.useStore.getState().modules).length, 0)
  } finally {
    store.useStore.setState(before, true)
  }
})
