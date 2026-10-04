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
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { usePictures, pictureStorageKey } = require('../src/renderer/src/engine/pictureStore.ts')
const { useFlowColors, flowTablesStorageKey } = require('../src/renderer/src/engine/flowColorStore.ts')
const { flowConditionSignal, pictureFlowColor, parseFlowTables } = require('../src/renderer/src/engine/pictureFlow.ts')
const { parseSavedPicture } = require('../src/renderer/src/engine/pictureDynamics.ts')
const { ClassicPump, ClassicControlValve, ClassicSanitaryValve } =
  require('../src/renderer/src/components/ClassicGraphics.tsx')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(),
    pictures: usePictures.getState(), tables: useFlowColors.getState(), window: global.window }
  const storage = new Map()
  global.window = { alerts: [], alert(message) { this.alerts.push(message) },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    useFlowColors.setState({ tables: {} })
    usePictures.setState({ pictures: {} })
    const store = useStore.getState()
    store.newProject('blank')
    store.createArea('TRAINING')
    for (const [tag, type] of [['PUMP', 'MOTOR'], ['FLOW', 'PID'], ['VALVE', 'VALVE'], ['OPEN', 'DI']]) {
      assert.equal(store.createModule({ tag, type, area: 'TRAINING' }), true)
    }
    run({ pictures: usePictures.getState(), tables: useFlowColors.getState(), storage })
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    usePictures.setState(before.pictures, true)
    useFlowColors.setState(before.tables, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

function patchModule(tag, patch) {
  useStore.setState(state => ({ modules: { ...state.modules, [tag]: { ...state.modules[tag], ...patch } } }))
}

test('p266 shared table updates pipe, pump and valve links across pictures without copying colors', () => fixture(({ pictures, tables }) => {
  assert.equal(tables.applyTable({ name: 'flow_color', flowColor: '#ffff00', noFlowColor: '#008000' }), true)
  pictures.createPicture('FEED')
  pictures.createPicture('OTHER')
  const animation = { table: 'flow_color', conditions: [
    { tag: 'PUMP', path: 'STATE', greaterThan: 0 }, { tag: 'OPEN', path: 'STATE', greaterThan: 0 }
  ] }
  const ids = [
    ['FEED', pictures.addElement('FEED', { type: 'pipe', x: 5, y: 5, width: 140, height: 12, flowAnimation: animation })],
    ['FEED', pictures.addElement('FEED', { type: 'pump', x: 5, y: 25, tag: 'PUMP', flowAnimation: animation })],
    ['OTHER', pictures.addElement('OTHER', { type: 'valve', x: 5, y: 25, tag: 'FLOW', flowAnimation: animation })]
  ]
  assert.ok(ids.every(([, id]) => id))
  const color = ([picture, id]) => pictureFlowColor(
    usePictures.getState().pictures[picture].elements.find(element => element.id === id).flowAnimation,
    useFlowColors.getState().tables, useStore.getState().modules)
  assert.ok(ids.every(item => color(item).color === '#008000'))
  patchModule('PUMP', { commanded: true, running: false })
  patchModule('OPEN', { state: true })
  assert.ok(ids.every(item => !color(item).flowing), 'a command does not stand in for confirmed pump running')
  patchModule('PUMP', { running: true })
  assert.ok(ids.every(item => color(item).color === '#ffff00' && color(item).flowing))
  const beforeModules = useStore.getState().modules
  assert.equal(tables.applyTable({ name: 'flow_color', flowColor: '#ff00ff', noFlowColor: '#123456' }), true)
  assert.ok(ids.every(item => color(item).color === '#ff00ff'), 'editing one table recolors every linked object')
  assert.equal(useStore.getState().modules, beforeModules, 'picture colors never mutate plant control state')
  patchModule('OPEN', { state: false })
  assert.ok(ids.every(item => color(item).color === '#123456'))
  patchModule('OPEN', { ioBad: true })
  assert.ok(ids.every(item => color(item).bad && color(item).color === '#aebdc9'),
    'unknown feedback uses neutral quality rather than a confirmed no-flow color')
}))

test('flow conditions distinguish applied AO feedback from requested PID output and report errors', () => fixture(() => {
  const module = useStore.getState().modules.FLOW
  patchModule('FLOW', { out: 70, io: { ...module.io, ao: { ...module.io.ao, out: 0, bad: false } } })
  assert.equal(flowConditionSignal({ tag: 'FLOW', path: 'AO1/OUT', greaterThan: 0 }, useStore.getState().modules).value, 0)
  assert.equal(flowConditionSignal({ tag: 'FLOW', path: 'PID1/OUT', greaterThan: 0 }, useStore.getState().modules).value, 70)
  assert.match(flowConditionSignal({ tag: 'MISSING', path: 'STATE', greaterThan: 0 }, {}).error, /does not exist/)
  assert.match(flowConditionSignal({ tag: 'FLOW', path: 'STATE', greaterThan: 0 }, useStore.getState().modules).error, /Unsupported/)
  assert.match(pictureFlowColor({ table: 'flow_color', conditions: [] }, {}, useStore.getState().modules).error, /1-8/)
}))

test('shared tables and picture links save/load independently and reject malformed or missing dependencies atomically', () => fixture(({ pictures, tables, storage }) => {
  const table = { name: 'flow_color', flowColor: '#ffff00', noFlowColor: '#008000' }
  tables.applyTable(table)
  pictures.createPicture('FEED')
  const id = pictures.addElement('FEED', { type: 'pipe', x: 5, y: 5,
    flowAnimation: { table: 'flow_color', conditions: [{ tag: 'PUMP', path: 'STATE', greaterThan: 0 }] } })
  assert.ok(id)
  assert.equal(tables.saveTables(), true)
  assert.equal(pictures.savePicture('FEED'), true)
  const saved = storage.get(pictureStorageKey('FEED'))
  assert.equal(JSON.parse(saved).picture.elements[0].color, undefined, 'links do not embed stale table colors')
  const parsed = parseSavedPicture(saved, 'FEED', useStore.getState().modules)
  assert.equal(parsed.elements[0].flowAnimation.table, 'flow_color')
  const corrupted = JSON.parse(saved)
  corrupted.picture.elements[0].flowAnimation.conditions[0].path = 'COMMAND'
  assert.throws(() => parseSavedPicture(JSON.stringify(corrupted), 'FEED', useStore.getState().modules), /schema/)
  useFlowColors.setState({ tables: {} })
  const oldPicture = usePictures.getState().pictures.FEED
  assert.equal(pictures.loadPicture('FEED'), false)
  assert.equal(usePictures.getState().pictures.FEED, oldPicture, 'missing shared table cannot replace the picture')
  assert.equal(tables.loadTables(), true)
  assert.equal(pictures.loadPicture('FEED'), true)
  assert.deepEqual(useFlowColors.getState().tables.flow_color, table)
  const oldTables = useFlowColors.getState().tables
  storage.set(flowTablesStorageKey, '{"version":1,"tables":[{"name":"bad","flowColor":"red","noFlowColor":"green"}]}')
  assert.equal(tables.loadTables(), false)
  assert.equal(useFlowColors.getState().tables, oldTables, 'invalid persistent data cannot replace last-good tables')
  assert.throws(() => parseFlowTables(JSON.stringify({ version: 1, tables: [table, table] })), /Duplicate/)
  assert.throws(() => parseFlowTables('{"version":2,"tables":[]}'), /version/)
}))

test('flow table edits and animation writes require configuration permission and validate sources', () => fixture(({ pictures, tables }) => {
  pictures.createPicture('FEED')
  tables.applyTable({ name: 'flow_color', flowColor: '#ffff00', noFlowColor: '#008000' })
  assert.equal(pictures.addElement('FEED', { type: 'pump', x: 0, y: 0, tag: 'FLOW' }), null)
  assert.equal(pictures.addElement('FEED', { type: 'pipe', x: 0, y: 0, width: -1 }), null)
  assert.equal(pictures.addElement('FEED', { type: 'pipe', x: 0, y: 0,
    flowAnimation: { table: 'missing', conditions: [{ tag: 'PUMP', path: 'STATE', greaterThan: 0 }] } }), null)
  const id = pictures.addElement('FEED', { type: 'pump', x: 0, y: 0, tag: 'PUMP' })
  const before = usePictures.getState().pictures.FEED
  assert.equal(pictures.updateElement('FEED', id, { flowAnimation: { table: 'flow_color',
    conditions: [{ tag: 'PUMP', path: 'STATE', greaterThan: NaN }] } }), false)
  assert.equal(usePictures.getState().pictures.FEED, before)
  useSecurity.setState({ locked: true })
  const oldTables = useFlowColors.getState().tables
  assert.equal(tables.applyTable({ name: 'flow_color', flowColor: '#ffffff', noFlowColor: '#000000' }), false)
  assert.equal(tables.saveTables(), false)
  assert.equal(tables.loadTables(), false)
  assert.equal(useFlowColors.getState().tables, oldTables)
  assert.equal(pictures.updateElement('FEED', id, { x: 20 }), false)
  assert.equal(pictures.savePicture('FEED'), false)
  assert.equal(pictures.loadPicture('FEED'), false)
  pictures.removeElement('FEED', id)
  pictures.deletePicture('FEED')
  assert.equal(usePictures.getState().pictures.FEED, before, 'locked edits, removal and persistence preserve the picture')
  useSecurity.setState({ locked: false, currentUser: 'OperatorA' })
  assert.equal(tables.applyTable({ name: 'flow_color', flowColor: '#ffffff', noFlowColor: '#000000' }), false)
  assert.equal(pictures.updateElement('FEED', id, { flowAnimation: { table: 'flow_color',
    conditions: [{ tag: 'PUMP', path: 'STATE', greaterThan: 0 }] } }), false)
  assert.equal(useFlowColors.getState().tables, oldTables)
  assert.match(useSecurity.getState().lastDenied, /Can Configure/)
}))

test('shared equipment defaults retain protected colors and geometry; custom animation changes only opted-in color', () => {
  const pumpProps = { x: 40, y: 40, running: true, tag: 'PUMP' }
  const pump = renderToStaticMarkup(React.createElement(ClassicPump, pumpProps))
  const customPump = renderToStaticMarkup(React.createElement(ClassicPump, { ...pumpProps, animationColor: '#ffff00' }))
  assert.ok(pump.includes('fill="#3f8f32"'))
  assert.ok(customPump.includes('fill="#ffff00"'))
  assert.ok(pump.includes('M-6,7 H6 L10,13 H-10 Z') && customPump.includes('M-6,7 H6 L10,13 H-10 Z'))
  assert.ok(renderToStaticMarkup(React.createElement(ClassicPump, { ...pumpProps, running: false })).includes('fill="#171d18"'))
  for (const position of [0, 0.1, 100]) {
    const valve = renderToStaticMarkup(React.createElement(ClassicControlValve, { x: 40, y: 40, position, tag: 'FLOW' }))
    assert.ok(valve.includes(`width="${position / 5}"`), `protected output bar for ${position}% remains unchanged`)
  }
  const sanitary = renderToStaticMarkup(React.createElement(ClassicSanitaryValve, {
    x: 40, y: 40, open: true, tag: 'VALVE', animationColor: '#ffff00'
  }))
  assert.ok(sanitary.includes('stroke="#252887"'), 'device-control frame remains blue')
})
