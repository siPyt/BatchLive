const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { DELTAV_APPLICATIONS, applicationFor, applicationsByRole } = require('../src/renderer/src/engine/applications.ts')
const { ALL_LOCKS } = require('../src/renderer/src/engine/security.ts')

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', ...p), 'utf8')
const navIds = [...src('ui', 'displayNavigation.ts').matchAll(/id: '([a-z0-9-]+)', label: '([^']+)', operator: (true|false)/g)]
  .map(m => ({ id: m[1], label: m[2], operator: m[3] === 'true' }))
const displayIds = [...src('ui', 'uiStore.ts').match(/export type DisplayId =([\s\S]*?)\r?\n\r?\nexport/)[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1])

test('DV09-003 every application launches a real display and names what it does and does not do', () => {
  const ids = new Set(navIds.map(n => n.id))
  assert.equal(new Set(DELTAV_APPLICATIONS.map(a => a.id)).size, DELTAV_APPLICATIONS.length, 'unique ids')
  for (const app of DELTAV_APPLICATIONS) {
    assert.ok(ids.has(app.display), `${app.id} launches ${app.display}`)
    assert.ok(app.native.length > 3)
    assert.ok(app.does.length >= 1 && app.does.every(d => d.length > 20), `${app.id} describes real actions`)
    assert.ok(app.notSupported.length >= 1 && app.notSupported.every(d => d.length > 10), `${app.id} lists unsupported native behaviour`)
    for (const key of app.keys) assert.ok(ALL_LOCKS.includes(key), `${app.id} key ${key}`)
  }
})

test('DV09-003 no tool display is left uncatalogued and the catalogue has no decorative entries', () => {
  const launched = new Set(DELTAV_APPLICATIONS.map(a => a.display))
  const tools = navIds.filter(n => !n.operator && n.id !== 'applications')
  assert.deepEqual(tools.filter(n => !launched.has(n.id)).map(n => n.id), [], 'every engineering/diagnostic display is an application')
  assert.ok(navIds.some(n => n.id === 'applications'))
  assert.deepEqual([...launched].filter(d => !navIds.some(n => n.id === d)), [])
  assert.equal(applicationFor('studio').native, 'Control Studio')
  assert.equal(applicationFor('applications'), undefined, 'the launcher is not listed as one of its own entries')
  const groups = applicationsByRole()
  assert.deepEqual(Object.keys(groups), ['Operate', 'Engineering', 'Diagnostics', 'Administration', 'Training'])
  assert.equal(Object.values(groups).flat().length, DELTAV_APPLICATIONS.length)
})

test('DV09-003 Run and Configure are distinguished: pictures run in Operate, edit in the builder', () => {
  const run = DELTAV_APPLICATIONS.find(a => a.id === 'operate-run')
  const configure = DELTAV_APPLICATIONS.find(a => a.id === 'operate-configure')
  assert.equal(navIds.find(n => n.id === run.display).operator, true)
  assert.equal(navIds.find(n => n.id === configure.display).operator, false)
  assert.ok(run.keys.includes('CONTROL') && !run.keys.includes('CAN_CONFIGURE'))
  assert.ok(configure.keys.includes('CAN_CONFIGURE') && !configure.keys.includes('CONTROL'))
})

test('DV09-003 every launch target in the top bar and the display union is a real, rendered display', () => {
  const top = src('components', 'TopBar.tsx')
  const targets = [...top.matchAll(/navigate\('([a-z0-9-]+)'\)/g)].map(m => m[1])
  assert.ok(targets.length >= 15)
  assert.deepEqual([...new Set(targets)].filter(t => !displayIds.includes(t)), [], 'no dead launch targets')
  const utilities = top.slice(top.indexOf('label="Utilities"'), top.indexOf('<div className="spacer" />', top.indexOf('label="Utilities"')))
  const menu = [...utilities.matchAll(/navigate\('([a-z0-9-]+)'\)/g)].map(m => m[1])
  assert.ok(menu.includes('applications'))
  const launched = new Set(DELTAV_APPLICATIONS.map(a => a.display))
  assert.deepEqual(menu.filter(t => t !== 'applications' && !launched.has(t)), [], 'every Utilities item is a catalogued application')
  const app = src('App.tsx')
  for (const nav of navIds.filter(n => !n.operator)) assert.match(app, new RegExp(`display === '${nav.id}'`), `${nav.id} is rendered`)
  assert.deepEqual(displayIds.filter(d => !navIds.some(n => n.id === d)), [], 'every display id is in the navigation list')
})
