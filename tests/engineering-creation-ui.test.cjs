const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX }
    }).outputText, filename)
  }
}
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { NewControlModuleDialog } = require('../src/renderer/src/displays/ExplorerDisplay.tsx')
const { ControlStudioDisplay } = require('../src/renderer/src/displays/ControlStudioDisplay.tsx')
const { SfcDisplay } = require('../src/renderer/src/displays/SfcDisplay.tsx')
const { ModuleDownloadDialog } = require('../src/renderer/src/components/ModuleLifecycleControls.tsx')

test('shared Studio New dialog retains FBD default, SFC choice, metadata and explicit Create/Cancel without creating on render', () => {
  const before = useStore.getState()
  const markup = renderToStaticMarkup(React.createElement(NewControlModuleDialog, {
    initialArea: 'FEED', onClose: () => {}
  }))
  assert.match(markup, /aria-label="New Control Module"/)
  assert.match(markup, /<option value="FBD" selected="">Function Block Diagram/)
  assert.match(markup, /<option value="SFC">Sequential Function Chart/)
  assert.match(markup, /aria-label="New module description"/)
  assert.match(markup, /aria-label="New module Equipment Module"/)
  assert.match(markup, /<option selected="">FEED<\/option>/)
  assert.match(markup, />Create<\/button>/)
  assert.match(markup, />Cancel<\/button>/)
  assert.equal(useStore.getState(), before)
})

test('an empty Studio and SFC editor both expose New without replacing existing sample-chart creation', () => {
  const studio = renderToStaticMarkup(React.createElement(ControlStudioDisplay))
  assert.match(studio, />New\.\.\.<\/button>/)
  const sfc = renderToStaticMarkup(React.createElement(SfcDisplay))
  assert.match(sfc, />New Control Module\.\.\.<\/button>/)
  assert.match(sfc, /placeholder="New SFC name"/)
  assert.match(sfc, />Create<\/button>/)
})

test('AO download dialog requires verification and exposes truthful scope, pending stages and Cancel without transferring on render', () => {
  const before = useStore.getState()
  const markup = renderToStaticMarkup(React.createElement(ModuleDownloadDialog, {
    tag: 'UNSAVED-AO', onClose: () => {}
  }))
  assert.match(markup, /aria-label="AO download stages"/)
  assert.match(markup, /Pending verification/)
  assert.match(markup, /Atomic module transfer: Not started/)
  assert.match(markup, /no native disk log file/)
  assert.match(markup, /Fieldbus dependency checks: not applicable/)
  assert.match(markup, /Save a valid offline draft/)
  assert.match(markup, />Verify Configuration<\/button>/)
  assert.match(markup, /disabled="">Confirm Download<\/button>/)
  assert.match(markup, />Cancel Download<\/button>/)
  assert.equal(useStore.getState(), before)
})
