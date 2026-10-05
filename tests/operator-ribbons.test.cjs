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
const { PhotoPlantDisplay } = require('../src/renderer/src/displays/PhotoPlantDisplay.tsx')
const { createPhotoPlant } = require('../src/renderer/src/engine/photoPlant.ts')
const { WfiDiagram, AutoclaveDiagram, LyoDiagram, CipDiagram, TcuDiagram } = require('../src/renderer/src/displays/PharmaDiagrams.tsx')
const { ClassicSanitaryValve, ClassicNavButton } = require('../src/renderer/src/components/ClassicGraphics.tsx')
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
  assert.equal(new Set(DISPLAY_NAVIGATION.map(display => display.id)).size, 26)
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

test('Feed and Reactor displays show only the 8001 picture, scaled to fit, with nothing else', () => {
  for (const area of ['FEED', 'REACTOR']) {
    const html = render(AreaDisplay, { area })
    assert.equal(html, `<div class="display static-picture"><img src="./feed-reactor-picture.png" alt="${area === 'FEED' ? 'Feed tank and supply' : 'Reactor train'} process picture" draggable="false"/></div>`, area)
    assert.ok(!html.includes('<svg') && !html.includes('plant-directory') && !html.includes('<h1'), area)
  }
  const bytes = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'renderer', 'public', 'feed-reactor-picture.png'))
  const original = fs.readFileSync(require('node:path').join(__dirname, '..', 'newImage', 'newNewImages', '8001.png'))
  assert.ok(bytes.equals(original), 'the shipped picture is the 8001 image')
})

test('all other process areas render graphics with collapsed, still-accessible module directories', () => {
  for (const area of ['PRODUCT', 'WFI', 'AUTOCLAVE', 'LYO', 'CIP', 'TCU']) {
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
    assert.match(render(OverviewDisplay), /Not configured/)
    assert.match(render(OverviewDisplay, { focusArea: 'REACTOR' }), /Reactor train modules are not configured/)
    assert.match(render(AreaDisplay, { area: 'WFI' }), /No modules configured in this area/)
    assert.equal(Object.keys(store.useStore.getState().modules).length, 0)
  } finally {
    store.useStore.setState(before, true)
  }
})

test('IMG_0616 overview is a fixed three-panel navigation screen, while area details retain the spatial canvas', () => {
  const html = render(OverviewDisplay)
  assert.match(html, /Plant Overview Navigation/)
  assert.equal((html.match(/class="overview-vessel-panel"/g) || []).length, 3)
  assert.ok(!html.includes('dv-area-jumpbar'))
  assert.ok(html.includes('Original Spatial Plant Map'))
  assert.ok(html.includes('Photographed WFI Overview'))
  for (const label of ['Feed Tank and Supply', 'Reactor Train', 'WFI Tank and Loop',
    'Product / Header', 'Autoclaves', 'Lyophilizers', 'CIP Skids', 'Temperature Control Units']) {
    assert.ok(html.includes(label), label)
  }
  for (const tag of ['3T-8130', '3T-8120', '3T-8140', '3T-5370', '3T-5440', '3T-5460', '3T-8030', '3T-5420', '3T-5110']) {
    assert.ok(html.includes(tag), tag)
  }
  for (const label of ['Room 1040', 'Room 1040A', 'Room 1042', 'WFI Still']) assert.ok(html.includes(label), label)
  for (const label of ['NGS-808', 'Scrubber 3S-8050', 'CIP-804', 'WFI Pretr Skid', '3TCU-8010', '3TCU-8020', 'Glycol 3T-8150',
    'Process Waste', '3UF-8201', 'HCL Totes', 'PW Neutr.', '3SUR-3300', '3SUR-3200', 'Buffer Prep', '3CIP-3200', '3T-3300', '3T-3350']) {
    assert.match(html, new RegExp(`aria-disabled="true"[^>]*>${label.replace(/[.]/g, '\\.')}</button>`), label)
  }
  assert.equal((html.match(/not modeled/g) || []).length >= 6, true)
  assert.match(render(OverviewDisplay, { focusArea: 'REACTOR' }), /dv-area-jumpbar/)
})

test('photographed overview and all unit pictures expose real modules, shared utilities and bad/missing instrumentation', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ photoPlant: undefined })
    assert.match(render(PhotoPlantDisplay, { view: 'overview' }), /Add WFI tank loops and still/)
    const addon = createPhotoPlant()
    useStore.setState({ photoPlant: addon.state, modules: { ...before.modules, ...addon.modules } })
    const html = render(PhotoPlantDisplay, { view: 'overview' })
    assert.equal((html.match(/class="overview-vessel-panel"/g) || []).length, 3)
    for (const label of ['3T-8130', '3T-8120', '3T-8140', 'SB-STEAM', 'SB-COOLING', 'WFI-LVL-CTRL', 'Not In Use', 'Sani Control']) {
      assert.ok(html.includes(label), label)
    }
    for (const view of ['n3', 'n1', 'n1bp', 'still']) assert.match(render(PhotoPlantDisplay, { view }), /<svg/)
    const still = render(PhotoPlantDisplay, { view: 'still' })
    for (const label of ['3WFI-8110-TCV102', '3WFI-8110-PCV103', '3WFI-8110-LCV200', '3WFI-8110-TCV200', '3WFI-8110-LCV100',
      '3WFI-8110-XV202', '3WFI-8110-FCV300', '3WFI-8110-SV500', '3WFI-8110-TT102', '3WFI-8110-IY100', '3WFI-8110-TT200',
      'Oil Pump', 'Oil Pressure', 'Oil Temperature', 'WFI STILL', 'COMMS', 'Cold / Off', 'Distillate Level', 'Feed Water Level']) {
      assert.ok(still.includes(label), label)
    }
    assert.match(still, /aria-disabled="true"[^>]*aria-label="WFI STILL COMMS is shown in the reference but is not modeled"/)
    const modules = { ...useStore.getState().modules,
      '3T-8130-LIC005': { ...addon.modules['3T-8130-LIC005'], pvBad: true } }
    delete modules['3T-8140-TIC011']
    useStore.setState({ modules })
    const bad = render(PhotoPlantDisplay, { view: 'overview' })
    assert.match(bad, /Level quality BAD/)
    assert.match(bad, /Incomplete model/)
    assert.match(bad, /3T-8140-TIC011: not configured/)
  } finally { useStore.setState(before, true) }
})

test('overview summaries use live feedback and quality, with explicit missing modules', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ modules: { ...before.modules,
      'P-401': { ...before.modules['P-401'], running: false, commanded: true },
      'AT-401': { ...before.modules['AT-401'], pv: 321, pvBad: true },
      'LIC-401': { ...before.modules['LIC-401'], pvBad: true }
    } })
    const html = render(OverviewDisplay)
    assert.match(html, /P-401: STOPPED/)
    assert.match(html, /Level quality BAD/)
    assert.ok(!html.includes('321.00'))
    assert.match(html, /Open faceplate/)
    assert.match(html, /role="button" tabindex="0"/)
    const modules = { ...before.modules }
    delete modules['AT-401']
    useStore.setState({ modules })
    assert.match(render(OverviewDisplay), /AT-401: not configured/)
  } finally {
    useStore.setState(before, true)
  }
})

test('partially configured pictures report missing required modules in standalone and embedded views', () => {
  const before = useStore.getState()
  try {
    for (const [area, tag, Diagram] of [
      ['WFI', 'TIC-401', WfiDiagram], ['AUTOCLAVE', 'TIC-501', AutoclaveDiagram],
      ['LYO', 'TIC-601', LyoDiagram], ['CIP', 'TIC-701', CipDiagram], ['TCU', 'TIC-801', TcuDiagram]
    ]) {
      const modules = { ...before.modules }
      delete modules[tag]
      useStore.setState({ modules })
      const html = render(AreaDisplay, { area })
      assert.match(html, /role="status"/, area)
      assert.ok(html.includes(`Required modules missing: ${tag}.`), area)
      assert.match(html, /Module directory \(/, area)
      const embedded = render(Diagram, { embedded: true })
      assert.match(embedded, /^<g role="status"><text/, area)
      assert.ok(embedded.includes(tag), area)
      assert.ok(!embedded.includes('<div'), area)
    }
  } finally {
    useStore.setState(before, true)
  }
})

test('WFI inlet caption clearance changes only its label, while unavailable reference navigation is explicit', () => {
  const props = { x: 245, y: 85, open: true, tag: 'XV-411', label: '3T-8120-YV006', labelPosition: 'above' }
  const original = render(ClassicSanitaryValve, props)
  const adjusted = render(ClassicSanitaryValve, { ...props, labelOffsetY: -22 })
  assert.equal(adjusted, original.replace('y="60"', 'y="38"'))
  const picture = render(WfiDiagram)
  assert.match(picture, /y="38"[^>]*>3T-8120-YV006<\/text>/)
  assert.match(picture, /WFI STILL: reference navigation only; this destination is not modeled/)
  assert.match(picture, /aria-disabled="true"/)
  for (const box of [
    '<rect x="770" y="550" width="80" height="34"',
    '<rect x="855" y="550" width="80" height="34"',
    '<rect x="940" y="550" width="90" height="34"',
    '<rect x="590" y="495" width="170" height="85"'
  ]) assert.ok(picture.includes(box), box)
  const active = render(ClassicNavButton, { x: 0, y: 0, text: 'Modeled display', onClick: () => {} })
  assert.ok(!active.includes('aria-disabled'))
  assert.ok(!active.includes('reference navigation only'))
})
