const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, filename)
  }
}
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { usePictures, pictureStorageKey, resolvePictureTarget } = require('../src/renderer/src/engine/pictureStore.ts')
const { parseSavedPicture } = require('../src/renderer/src/engine/pictureDynamics.ts')
const objects = require('../src/renderer/src/engine/pictureObjects.ts')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { CourseDynamo } = require('../src/renderer/src/components/CourseDynamos.tsx')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), pictures: usePictures.getState(), window: global.window }
  const storage = new Map()
  global.window = { alerts: [], alert(message) { this.alerts.push(message) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false })
    usePictures.setState({ pictures: {} })
    useStore.getState().newProject('pharma')
    usePictures.getState().createPicture('LAB')
    run({ storage, alerts: global.window.alerts })
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    usePictures.setState(before.pictures, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const pictures = () => usePictures.getState()
const element = (id, pic = 'LAB') => pictures().pictures[pic].elements.find(item => item.id === id)
const patch = (tag, fields) => useStore.setState(state => ({ modules: { ...state.modules, [tag]: { ...state.modules[tag], ...fields } } }))

test('DV09-030 text properties: family, style, size and colour persist through Save/Load and stay inside the picture', () => fixture(({ storage }) => {
  const id = pictures().addElement('LAB', { type: 'text', x: 40, y: 40, content: 'Tank 101 Feed', fontSize: 20, bold: true,
    italic: true, underline: true, fontFamily: 'Verdana', color: '#aa2200' })
  assert.ok(id)
  assert.equal(pictures().savePicture('LAB'), true)
  const saved = parseSavedPicture(storage.get(pictureStorageKey('LAB')), 'LAB', useStore.getState().modules, useStore.getState())
  assert.deepEqual(saved.elements.find(item => item.id === id), element(id))
  assert.equal(pictures().updateElement('LAB', id, { fontFamily: 'Consolas', fontSize: 30, italic: false, color: '#112233' }), true)
  assert.equal(element(id).fontFamily, 'Consolas')
  assert.equal(element(id).italic, false)
  assert.equal(pictures().loadPicture('LAB'), true)
  assert.equal(element(id).fontFamily, 'Verdana', 'Load restores the saved properties')
  for (const bad of [{ fontFamily: 'Comic Sans' }, { fontSize: 3 }, { fontSize: 200 }, { color: 'red' }, { x: 995 }, { y: 639 }, { content: 'x'.repeat(200) }]) {
    assert.equal(pictures().updateElement('LAB', id, bad), false, JSON.stringify(bad))
  }
  assert.equal(element(id).fontFamily, 'Verdana', 'a rejected edit changes nothing')
  assert.equal(pictures().addElement('LAB', { type: 'text', x: 5, y: 5, content: 'ok', fontFamily: 'Papyrus' }), null)
  assert.equal(pictures().addElement('LAB', { type: 'text', x: 990, y: 5, content: 'too far right', fontSize: 14 }), null)
  assert.ok(pictures().addElement('LAB', { type: 'text', x: 5, y: 5, content: 'edge', fontSize: 14 }))
  assert.match(objects.textPropertiesError({ id: '', type: 'datalink', x: 0, y: 0, fontFamily: 'Arial' }), /apply to text only/)
  const box = objects.elementBox({ id: '', type: 'text', x: 0, y: 0, content: 'ABCDEFGHIJ', fontSize: 10 })
  assert.ok(box.width >= 56 && box.height >= 13)
}))

test('DV09-027 main template: grouped title objects, background, Remove Title and a saved picture identity', () => fixture(({ storage }) => {
  assert.equal(pictures().createPictureFromTemplate('tank 7', 'MAIN'), true)
  const picture = pictures().pictures['TANK 7']
  assert.equal(picture.template, 'MAIN')
  assert.equal(picture.background, objects.PICTURE_TEMPLATES.MAIN.background)
  assert.deepEqual([picture.width, picture.height], [objects.PICTURE_WIDTH, objects.PICTURE_HEIGHT])
  assert.deepEqual(picture.elements.map(item => item.group), ['TITLE', 'TITLE'])
  assert.equal(picture.elements[0].content, 'TANK 7', 'the default title carries the picture name')
  assert.equal(pictures().createPictureFromTemplate('tank 7', 'MAIN'), false, 'duplicate names are rejected')
  assert.equal(pictures().createPictureFromTemplate('  ', 'MAIN'), false)
  const own = pictures().addElement('TANK 7', { type: 'text', x: 24, y: 120, content: 'Own label', fontSize: 14 })
  assert.equal(pictures().setPictureBackground('TANK 7', '#102030'), true)
  assert.equal(pictures().setPictureBackground('TANK 7', 'blue'), false)
  assert.equal(pictures().pictures['TANK 7'].background, '#102030')
  assert.equal(pictures().removeElementGroup('TANK 7', 'TITLE'), 2)
  assert.deepEqual(pictures().pictures['TANK 7'].elements.map(item => item.id), [own], 'only the title group is removed')
  assert.equal(pictures().removeElementGroup('TANK 7', 'TITLE'), 0)
  assert.equal(pictures().savePicture('TANK 7'), true)
  const saved = parseSavedPicture(storage.get(pictureStorageKey('TANK 7')), 'TANK 7', useStore.getState().modules, useStore.getState())
  assert.equal(saved.template, 'MAIN')
  assert.equal(saved.background, '#102030')
  assert.equal(saved.elements.length, 1)
  for (const bad of [{ background: 'blue' }, { template: 'OTHER' }, { width: 50 }, { height: 9000 }]) {
    const text = JSON.stringify({ version: 1, picture: { ...pictures().pictures['TANK 7'], ...bad } })
    assert.throws(() => parseSavedPicture(text, 'TANK 7', useStore.getState().modules, useStore.getState()), /invalid/)
  }
}))

test('DV09-029 numeric layout, error table, refresh rate and history', () => fixture(() => {
  assert.equal(objects.formatLayout(12.3456, { width: 8, decimals: 2 }), '   12.35')
  assert.equal(objects.formatLayout(123456.789, { width: 5, decimals: 1 }), '*****', 'a value that does not fit shows asterisks')
  assert.equal(objects.formatLayout(7, { width: 4, decimals: 0 }), '   7')
  const base = { type: 'datalink', x: 10, y: 10, tag: 'LIC-101', path: 'PV' }
  assert.ok(pictures().addElement('LAB', { ...base, layout: { width: 8, decimals: 2 }, errorText: { bad: '???', error: 'NO LINK' }, refreshSeconds: 2 }))
  for (const bad of [{ layout: { width: 2, decimals: 1 } }, { layout: { width: 8, decimals: 9 } }, { layout: { width: 8.5, decimals: 1 } },
    { errorText: { bad: '' } }, { errorText: { bad: 'x'.repeat(30) } }, { refreshSeconds: 0 }, { refreshSeconds: 100 }, { historySeconds: 0 },
    { historySeconds: 4000 }]) {
    assert.equal(pictures().addElement('LAB', { ...base, ...bad }), null, JSON.stringify(bad))
  }
  assert.equal(pictures().addElement('LAB', { ...base, path: 'PID1/MODE.A_ACTUAL', layout: { width: 8, decimals: 1 } }), null, 'layout needs a numeric source')
  assert.equal(pictures().addElement('LAB', { type: 'text', x: 10, y: 10, content: 'x', layout: { width: 8, decimals: 1 } }), null)
  assert.ok(pictures().addElement('LAB', { ...base, historySeconds: 30 }))
  assert.equal(pictures().addElement('LAB', { ...base, path: 'PID1/SP', historySeconds: 30 }), null, 'history is PV only')
  const trend = [{ t: 0, values: { 'LIC-101': 10 } }, { t: 10000, values: { 'LIC-101': 20 } }, { t: 20000, values: { 'LIC-101': 30 } }]
  assert.equal(objects.historicalValue(trend, 'LIC-101', 10), 20)
  assert.equal(objects.historicalValue(trend, 'LIC-101', 15), 10)
  assert.equal(objects.historicalValue(trend, 'LIC-101', 60), undefined, 'the buffer does not reach back that far')
  assert.equal(objects.historicalValue(trend, 'NOPE', 10), undefined)
  assert.equal(objects.historicalValue([], 'LIC-101', 10), undefined)
  let held = objects.refreshedSample(undefined, 0, 2, 'a')
  assert.equal(held.value, 'a')
  held = objects.refreshedSample(held, 1000, 2, 'b')
  assert.equal(held.value, 'a', 'held until the refresh interval elapses')
  held = objects.refreshedSample(held, 2000, 2, 'c')
  assert.equal(held.value, 'c')
  assert.equal(objects.refreshedSample(held, 2100, undefined, 'd').value, 'd', 'no interval means every update')
}))

test('DV09-029 discrete paths keep SP_D command and PV_D feedback distinct', () => fixture(() => {
  patch('P-101', { commanded: true, running: false })
  const modules = useStore.getState().modules
  const command = objects.pictureDiscreteSignal({ tag: 'P-101', path: 'DC1/SP_D.CV' }, modules)
  const feedback = objects.pictureDiscreteSignal({ tag: 'P-101', path: 'DC1/PV_D.CV' }, modules)
  assert.deepEqual([command.text, command.role, command.writable], ['START', 'command', true])
  assert.deepEqual([feedback.text, feedback.role, feedback.writable], ['STOPPED', 'feedback', false])
  patch('XV-101', { commandedOpen: false, open: true })
  const valve = useStore.getState().modules
  assert.equal(objects.pictureDiscreteSignal({ tag: 'XV-101', path: 'DC1/SP_D' }, valve).text, 'CLOSE')
  assert.equal(objects.pictureDiscreteSignal({ tag: 'XV-101', path: 'DC1/PV_D' }, valve).text, 'OPEN')
  patch('P-101', { ioInputBad: true })
  assert.equal(objects.pictureDiscreteSignal({ tag: 'P-101', path: 'DC1/PV_D' }, useStore.getState().modules).bad, true)
  assert.equal(objects.pictureDiscreteSignal({ tag: 'P-101', path: 'DC1/SP_D' }, useStore.getState().modules).bad, false, 'command is not feedback quality')
  assert.match(objects.pictureDiscreteSignal({ tag: 'P-101', path: 'DI1/PV_D' }, modules).error, /no DI1/)
  assert.match(objects.pictureDiscreteSignal({ tag: 'NOPE', path: 'DC1/PV_D' }, modules).error, /does not exist/)
  const di = objects.pictureDiscreteSignal({ tag: 'LSH-101', path: 'DI1/PV_D' }, modules)
  assert.equal(di.writable, false)
  assert.equal(objects.pictureDiscretePath('dc1/sp_d.cv').role, 'command')
  assert.equal(objects.pictureDiscretePath('PID1/SP'), null)
}))

test('DV09-029/051 discrete entry: multi-item SP_D choice with confirmation writes the command, never the feedback', () => fixture(() => {
  const link = { type: 'datalink', x: 10, y: 10, tag: 'P-101', path: 'DC1/SP_D.CV' }
  const id = pictures().addElement('LAB', { ...link, entry: { method: 'DISCRETE', labels: ['Hold', 'Run it'], confirm: true } })
  assert.ok(id)
  assert.equal(pictures().addElement('LAB', { ...link, path: 'DC1/PV_D.CV', entry: { method: 'DISCRETE' } }), null, 'PV_D is read-only')
  assert.equal(pictures().addElement('LAB', { ...link, entry: { method: 'DISCRETE', labels: ['x'] } }), null)
  assert.equal(pictures().addElement('LAB', { ...link, entry: { method: 'DISCRETE', labels: ['', 'y'] } }), null)
  assert.equal(pictures().addElement('LAB', { ...link, entry: { method: 'NUMERIC', fetchLimits: true, low: 0, high: 1 } }), null)
  assert.equal(pictures().addElement('LAB', { ...link, tag: 'FIC-101' }), null, 'a PID has no DC1/SP_D')
  assert.equal(objects.pictureDiscreteSignal(element(id), useStore.getState().modules).labels[1], 'Run it')
  patch('P-101', { commanded: false })
  assert.equal(pictures().writeDiscreteValue('LAB', id, true), false, 'unconfirmed entry is refused')
  assert.equal(useStore.getState().modules['P-101'].commanded, false)
  assert.equal(pictures().writeDiscreteValue('LAB', id, true, undefined, true), true)
  assert.equal(useStore.getState().modules['P-101'].commanded, true)
  assert.equal(pictures().writeDiscreteValue('LAB', id, false, undefined, true), true)
  assert.equal(useStore.getState().modules['P-101'].commanded, false)
  assert.equal(pictures().writeDiscreteValue('LAB', id, true, { ...element(id) }, true), false, 'a stale entry dialog is refused')
  const valve = pictures().addElement('LAB', { type: 'datalink', x: 10, y: 50, tag: 'XV-101', path: 'DC1/SP_D', entry: { method: 'DISCRETE' } })
  assert.equal(pictures().writeDiscreteValue('LAB', valve, true), true, 'confirmation is optional')
  assert.equal(useStore.getState().modules['XV-101'].commandedOpen, true)
  const output = pictures().addElement('LAB', { type: 'datalink', x: 10, y: 90, tag: 'HS-201', path: 'DO1/SP_D', entry: { method: 'DISCRETE' } })
  const before = useStore.getState().modules['HS-201'].commanded
  assert.equal(pictures().writeDiscreteValue('LAB', output, !before), true)
  assert.equal(useStore.getState().modules['HS-201'].commanded, !before)
  assert.equal(pictures().writeDiscreteValue('LAB', output, !before), true, 'writing the present value is a no-op success')
}))

test('DV09-029 confirmation applies to numeric, mode, named-set and ramp entry', () => fixture(() => {
  const id = pictures().addElement('LAB', { type: 'datalink', x: 10, y: 10, tag: 'FIC-101', path: 'PID1/SP',
    entry: { method: 'NUMERIC', fetchLimits: true, low: 0, high: 100, confirm: true } })
  assert.ok(id)
  const before = useStore.getState().modules['FIC-101'].sp
  assert.equal(pictures().writeNumericValue('LAB', id, 42), false)
  assert.equal(useStore.getState().modules['FIC-101'].sp, before, 'nothing is written without confirmation')
  assert.equal(pictures().writeNumericValue('LAB', id, 42, true), true)
  assert.equal(useStore.getState().modules['FIC-101'].sp, 42)
  const plain = pictures().addElement('LAB', { type: 'datalink', x: 10, y: 50, tag: 'FIC-101', path: 'PID1/SP', entry: { method: 'NUMERIC', fetchLimits: true, low: 0, high: 100 } })
  assert.equal(pictures().writeNumericValue('LAB', plain, 43), true, 'confirm is opt-in')
  const mode = pictures().addElement('LAB', { type: 'datalink', x: 10, y: 90, tag: 'FIC-101', path: 'PID1/MODE.A_TARGET', entry: { method: 'PID_MODE', confirm: true } })
  assert.equal(pictures().writeModeValue('LAB', mode, 'MAN'), false)
  const ramp = pictures().addElement('LAB', { type: 'datalink', x: 10, y: 130, tag: 'FIC-101', path: 'PID1/OUT', entry: { method: 'RAMP', rate: 5, confirm: true } })
  assert.equal(pictures().rampOutput('LAB', ramp, 1, 0.2), false)
}))

test('DV09-031/051/062 course dynamo library: bound to equipment, white/yellow animation, isolated from plant symbols', () => fixture(({ storage }) => {
  const add = (extra) => pictures().addElement('LAB', { type: 'dynamo', x: 30, y: 30, ...extra })
  const pump = add({ dynamoSet: 'PUMPS_ANIM', tag: 'P-101' })
  const valve = add({ dynamoSet: 'VALVE17', tag: 'XV-101', x: 130 })
  const control = add({ dynamoSet: 'VALVE_HORIZONTAL_CONTROL_D1', tag: 'FIC-101', x: 230 })
  const pipe = add({ dynamoSet: 'PIPES_ANIM', tag: 'P-101', x: 330 })
  assert.ok(pump && valve && control && pipe)
  const state = (id) => objects.dynamoState(element(id), useStore.getState().modules)
  patch('P-101', { running: false })
  assert.deepEqual([state(pump).active, state(pump).color], [false, '#ffffff'], 'stopped pump is white')
  patch('P-101', { running: true })
  assert.deepEqual([state(pump).active, state(pump).color], [true, '#ffe000'], 'running pump is yellow')
  patch('XV-101', { open: false })
  assert.equal(state(valve).active, false)
  patch('XV-101', { open: true })
  assert.equal(state(valve).color, '#ffe000')
  patch('FIC-101', { out: 63 })
  assert.equal(state(control).position, 63)
  assert.equal(state(pipe).active, true, 'pipe flow follows the running pump')
  patch('P-101', { ioInputBad: true })
  assert.equal(state(pump).bad, true)
  assert.equal(state(pump).color, '#b8b8b8', 'bad feedback is neutral')
  assert.equal(pictures().updateElement('LAB', pump, { dynamoColors: { inactive: '#00ff00', active: '#ff0000' } }), true)
  patch('P-101', { ioInputBad: false, running: false })
  assert.equal(state(pump).color, '#00ff00')
  assert.equal(pictures().updateElement('LAB', pump, { dynamoColors: { inactive: 'green', active: '#ff0000' } }), false)
  assert.equal(add({ dynamoSet: 'PUMPS_ANIM', tag: 'XV-101' }), null, 'a pump set needs a motor')
  assert.equal(add({ dynamoSet: 'VALVE17', tag: 'P-101' }), null)
  assert.equal(add({ dynamoSet: 'VALVE_HORIZONTAL_CONTROL_D1', tag: 'XV-101' }), null)
  assert.equal(add({ dynamoSet: 'PUMPS_ANIM', tag: 'NOPE' }), null)
  assert.equal(add({ dynamoSet: 'BOGUS', tag: 'P-101' }), null)
  assert.equal(add({ dynamoSet: 'PUMPS_ANIM', tag: 'P-101', x: 990 }), null, 'dynamos must stay inside the picture')
  assert.equal(pictures().addElement('LAB', { type: 'datalink', x: 5, y: 5, tag: 'P-101', showActiveAlarm: true }), null, 'alarm visibility needs a course dynamo')
  assert.ok(add({ dynamoSet: 'PUMPS_ANIM', tag: 'P-101', x: 430, showActiveAlarm: true }))
  assert.equal(pictures().savePicture('LAB'), true)
  const saved = parseSavedPicture(storage.get(pictureStorageKey('LAB')), 'LAB', useStore.getState().modules, useStore.getState())
  assert.equal(saved.elements.filter(item => item.dynamoSet).length, 5)
  const plain = add({ tag: 'P-101', x: 530 })
  assert.equal(element(plain).dynamoSet, undefined, 'the generic value-box dynamo is unchanged')
}))

test('DV09-031 navigation buttons link pictures, the Overview and the alarm list', () => fixture(() => {
  const id = pictures().addElement('LAB', { type: 'button', x: 20, y: 20, content: 'Overview', target: 'Ovw_ref.grf' })
  assert.ok(id)
  assert.deepEqual(resolvePictureTarget(element(id).target, pictures().pictures), { kind: 'display', display: 'overview' })
  assert.deepEqual(resolvePictureTarget('alarmList', pictures().pictures), { kind: 'display', display: 'alarms' })
  pictures().createPicture('TANK101B')
  assert.deepEqual(resolvePictureTarget('tank101b', pictures().pictures), { kind: 'picture', name: 'TANK101B' })
  assert.equal(resolvePictureTarget('NOPE', pictures().pictures), null)
  for (const bad of [{ content: 'x' }, { content: 'x', target: '' }, { target: 'TANK101B' }, { content: 'x', target: 'y'.repeat(50) }]) {
    assert.equal(pictures().addElement('LAB', { type: 'button', x: 20, y: 60, ...bad }), null, JSON.stringify(bad))
  }
  assert.equal(pictures().addElement('LAB', { type: 'text', x: 20, y: 60, content: 'x', target: 'TANK101B' }), null)
  assert.equal(pictures().addElement('LAB', { type: 'button', x: 950, y: 60, content: 'x', target: 'TANK101B' }), null, 'a button stays inside the picture')
}))

test('DV09-029 saved picture schema rejects malformed new properties', () => fixture(() => {
  const id = pictures().addElement('LAB', { type: 'text', x: 10, y: 10, content: 'hello', fontSize: 14 })
  const base = () => JSON.parse(JSON.stringify(pictures().pictures.LAB))
  const parse = (picture) => parseSavedPicture(JSON.stringify({ version: 1, picture }), 'LAB', useStore.getState().modules, useStore.getState())
  assert.doesNotThrow(() => parse(base()))
  for (const mutate of [
    p => { p.elements[0].fontFamily = 5 }, p => { p.elements[0].italic = 'yes' }, p => { p.elements[0].fontFamily = 'Wingdings' },
    p => { p.elements[0].layout = { width: 'a', decimals: 1 } }, p => { p.elements[0].refreshSeconds = 'fast' },
    p => { p.elements[0].dynamoSet = 5 }, p => { p.elements[0].type = 'widget' }, p => { p.elements[0].group = 3 },
    p => { p.elements[0].entry = { method: 'DISCRETE', labels: ['one'] } }, p => { p.elements[0].entry = { method: 'NUMERIC', confirm: 'x', fetchLimits: true, low: 0, high: 1 } }
  ]) {
    const picture = base()
    mutate(picture)
    assert.throws(() => parse(picture), undefined, JSON.stringify(picture.elements[0]))
  }
  assert.ok(id)
}))

test('DV09-031/051/062 course dynamos render white/yellow state, bad feedback, position and active-alarm visibility', () => fixture(() => {
  const render = (extra, alarms = []) => renderToStaticMarkup(React.createElement(CourseDynamo, {
    element: { id: 'd', type: 'dynamo', x: 10, y: 10, ...extra }, modules: useStore.getState().modules, alarms }))
  patch('P-101', { running: false })
  assert.match(render({ dynamoSet: 'PUMPS_ANIM', tag: 'P-101' }), /data-dynamo-color="#ffffff"[^>]*data-dynamo-active="false"/)
  patch('P-101', { running: true })
  const running = render({ dynamoSet: 'PUMPS_ANIM', tag: 'P-101' })
  assert.match(running, /data-dynamo-color="#ffe000"/)
  assert.match(running, /class="cd-spin"/, 'the impeller turns only while running')
  patch('P-101', { ioInputBad: true })
  assert.match(render({ dynamoSet: 'PUMPS_ANIM', tag: 'P-101' }), /data-dynamo-color="#b8b8b8"/)
  patch('FIC-101', { out: 80 })
  assert.match(render({ dynamoSet: 'VALVE_HORIZONTAL_CONTROL_D1', tag: 'FIC-101' }), /width="/)
  assert.match(render({ dynamoSet: 'PUMPS_ANIM', tag: 'NOPE' }), /does not exist/)
  const alarm = { id: 'a', moduleTag: 'P-101', active: true, acknowledged: false, priority: 'WARNING', label: 'Test', time: 0 }
  assert.doesNotMatch(render({ dynamoSet: 'VALVE17', tag: 'XV-101', showActiveAlarm: true }), /data-dynamo-alarm/)
  void alarm
}))
