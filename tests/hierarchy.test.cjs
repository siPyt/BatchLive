const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const h = require('../src/renderer/src/engine/hierarchy.ts')
const { makeDefaultEquipment } = require('../src/renderer/src/engine/equipment.ts')

function fixture(kind, run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: (m) => alerts.push(m), localStorage: global.localStorage, confirm: () => true }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, lastDenied: null, workstation: null })
    useStore.getState().newProject(kind)
    run(useStore.getState(), alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const H = () => { const s = useStore.getState(); return { areas: s.areas, processCells: s.processCells, units: s.units, equipment: s.equipment } }

test('DV09-013 the pharma project is a complete Area > Process Cell > Unit > Equipment > Control hierarchy', () => fixture('pharma', () => {
  const state = H()
  const withEm = new Set(Object.values(state.equipment).map(em => em.area))
  assert.ok(withEm.size >= 5)
  for (const area of withEm) {
    assert.equal(state.processCells[`${area}_CELL`].area, area)
    assert.equal(state.units[`${area}_UNIT`].cell, `${area}_CELL`)
  }
  assert.equal(Object.keys(state.processCells).length, withEm.size)
  assert.ok(Object.values(state.equipment).every(em => em.unit === `${em.area}_UNIT`))
  assert.ok(Object.keys({ ...state.processCells, ...state.units }).every(n => n.length <= 16))
  const path = h.modulePath(useStore.getState().modules['FIC-101'], state)
  assert.equal(h.describePath(path), 'FEED > FEED_CELL > FEED_UNIT > EM-FEED-SUPPLY > FIC-101')
  assert.equal(path.complete, true)
  assert.deepEqual(h.HIERARCHY_LEVELS, ['Area', 'Process Cell', 'Unit', 'Equipment Module', 'Control Module'])
  assert.equal(state.processCells.PHOTO_WFI_CELL, undefined, 'areas without equipment get no cell')
}))

test('DV09-013 a blank project has no cells or units and modules report an incomplete path', () => fixture('blank', (s) => {
  assert.deepEqual([s.processCells, s.units, s.equipment], [{}, {}, {}])
  assert.equal(s.createModule({ tag: 'FEED-01', type: 'MOTOR', area: 'FEED', description: 'x' }), true)
  const path = h.modulePath(useStore.getState().modules['FEED-01'], H())
  assert.equal(h.describePath(path), 'FEED > FEED-01')
  assert.equal(path.complete, false)
}))

test('DV09-013 names are unique across the whole hierarchy and follow the 16-character tag rule', () => fixture('pharma', (s) => {
  const state = H()
  for (const bad of ['', '1234', 'A'.repeat(17), 'A B', 'FEED', 'feed_cell', 'FEED_UNIT', 'em-feed-supply'])
    assert.ok(h.hierarchyNameError(bad, 'Process Cell', state), bad)
  assert.equal(h.hierarchyNameError('NEW_CELL', 'Process Cell', state), null)
  assert.match(s.createProcessCell('FEED', 'FEED', ''), /already used/)
  assert.match(s.createUnit('FEED_CELL', 'FEED_CELL', ''), /already used/)
  assert.match(s.createProcessCell('X', 'NOPE', ''), /Area NOPE does not exist/)
  assert.match(s.createProcessCell('X', 'FEED', 'd'.repeat(121)), /limited to 120/)
  assert.match(s.createUnit('X', 'NOPE_CELL', ''), /Process Cell NOPE_CELL does not exist/)
  assert.ok(useStore.getState().eventLog.some(e => /Process Cell creation rejected/.test(e.description)))
}))

test('DV09-013 cells and units are created, nested and deleted with containment rules', () => fixture('pharma', (s) => {
  assert.equal(s.createProcessCell('feed_b', 'FEED', 'Second feed cell'), null)
  assert.deepEqual(useStore.getState().processCells.FEED_B, { name: 'FEED_B', area: 'FEED', description: 'Second feed cell' })
  assert.equal(s.createUnit('feed_b_1', 'FEED_B', ''), null)
  assert.equal(useStore.getState().units.FEED_B_1.cell, 'FEED_B')
  assert.match(s.deleteProcessCell('FEED_B'), /still contains unit\(s\) FEED_B_1/)
  assert.match(s.deleteUnit('FEED_UNIT'), /still contains equipment module\(s\) EM-FEED-SUPPLY/)
  assert.equal(s.deleteUnit('FEED_B_1'), null)
  assert.equal(s.deleteProcessCell('FEED_B'), null)
  assert.equal(s.deleteProcessCell('FEED_B'), 'Process Cell FEED_B does not exist')
  assert.equal(s.deleteUnit('NOPE'), 'Unit NOPE does not exist')
}))

test('DV09-013 an equipment module can sit only under a unit of its own area; null hangs it under the area', () => fixture('pharma', (s) => {
  assert.match(s.assignEquipmentUnit('EM-FEED-SUPPLY', 'REACTOR_UNIT'), /belongs to area REACTOR; EM-FEED-SUPPLY is in area FEED/)
  assert.equal(useStore.getState().equipment['EM-FEED-SUPPLY'].unit, 'FEED_UNIT')
  s.createProcessCell('FEED_B', 'FEED', '')
  s.createUnit('FEED_B_1', 'FEED_B', '')
  assert.equal(s.assignEquipmentUnit('EM-FEED-SUPPLY', 'FEED_B_1'), null)
  assert.equal(h.describePath(h.equipmentPath('EM-FEED-SUPPLY', H())), 'FEED > FEED_B > FEED_B_1 > EM-FEED-SUPPLY')
  assert.equal(s.assignEquipmentUnit('EM-FEED-SUPPLY', null), null)
  assert.equal(useStore.getState().equipment['EM-FEED-SUPPLY'].unit, undefined)
  assert.equal(h.equipmentPath('EM-FEED-SUPPLY', H()).complete, false)
  assert.match(s.assignEquipmentUnit('EM-FEED-SUPPLY', 'NOPE'), /Unit NOPE does not exist/)
  assert.match(s.assignEquipmentUnit('NOPE', 'FEED_UNIT'), /Equipment Module NOPE does not exist/)
}))

test('DV09-013 creating an equipment module can name its unit, and a wrong-area unit is refused', () => fixture('pharma', (s, alerts) => {
  s.createEquipmentModule('EM-NEW', 'New', 'FEED', 'FEED_UNIT')
  assert.equal(useStore.getState().equipment['EM-NEW'].unit, 'FEED_UNIT')
  s.createEquipmentModule('EM-BAD', 'Bad', 'FEED', 'REACTOR_UNIT')
  assert.equal(useStore.getState().equipment['EM-BAD'], undefined)
  assert.ok(alerts.some(m => /belongs to area REACTOR/.test(m)))
  s.createEquipmentModule('EM-FREE', 'Free', 'FEED')
  assert.equal(useStore.getState().equipment['EM-FREE'].unit, undefined)
}))

test('DV09-013 a module whose area differs from its equipment module has an incomplete path', () => fixture('pharma', () => {
  const mod = { ...useStore.getState().modules['FIC-101'], area: 'REACTOR' }
  const path = h.modulePath(mod, H())
  assert.equal(path.complete, false)
  assert.equal(path.equipment, undefined)
  assert.equal(h.describePath(path), 'REACTOR > FIC-101')
}))

test('DV09-013 renaming an area carries its process cells; units follow their cell', () => fixture('pharma', (s) => {
  assert.equal(s.renameArea('FEED', 'FEED_OLD'), true)
  const state = H()
  assert.equal(state.processCells.FEED_CELL.area, 'FEED_OLD')
  assert.equal(state.equipment['EM-FEED-SUPPLY'].area, 'FEED_OLD')
  assert.equal(h.equipmentPath('EM-FEED-SUPPLY', state).complete, true)
  assert.equal(h.assignUnitError('EM-FEED-SUPPLY', 'FEED_UNIT', state), null)
  assert.equal(h.modulePath(useStore.getState().modules['FIC-101'], state).complete, true)
}))

test('DV09-013 unit behavior: DeltaV Batch needs a full Area > Process Cell > Unit hierarchy for its unit', () => fixture('pharma', (s, alerts) => {
  assert.equal(h.batchHierarchyError('REACTOR', H()), null)
  s.assignEquipmentUnit('EM-REACTOR-AGITATE', null)
  assert.equal(s.deleteUnit('REACTOR_UNIT'), null)
  assert.match(h.batchHierarchyError('REACTOR', H()), /REACTOR_CELL has no unit/)
  s.batchCommand('START')
  assert.equal(useStore.getState().batch.status, 'READY')
  assert.match(alerts.at(-1), /requires a full Area > Process Cell > Unit hierarchy/)
  assert.ok(useStore.getState().eventLog.some(e => /Batch command rejected: DeltaV Batch requires/.test(e.description)))
  assert.equal(s.deleteProcessCell('REACTOR_CELL'), null)
  assert.match(h.batchHierarchyError('REACTOR', H()), /area REACTOR has no process cell/)
  assert.match(h.batchHierarchyError('NOPE', H()), /needs area NOPE/)
  s.createProcessCell('REACT_CELL', 'REACTOR', '')
  s.createUnit('REACT_1', 'REACT_CELL', '')
  assert.equal(h.batchHierarchyError('REACTOR', H()), null)
  s.batchCommand('START')
  assert.equal(useStore.getState().batch.status, 'RUNNING')
}))

test('DV09-013 hierarchy changes need Can Configure and leave state untouched when denied', () => fixture('pharma', (s) => {
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { CAN_CONFIGURE: 'SYSTEM_ADMIN' } })
  const before = JSON.stringify(H())
  assert.equal(s.createProcessCell('NEW_CELL', 'FEED', ''), 'Requires the Can Configure key')
  assert.equal(s.createUnit('NEW_UNIT', 'FEED_CELL', ''), 'Requires the Can Configure key')
  assert.equal(s.deleteUnit('FEED_UNIT'), 'Requires the Can Configure key')
  assert.equal(s.deleteProcessCell('FEED_CELL'), 'Requires the Can Configure key')
  assert.equal(s.assignEquipmentUnit('EM-FEED-SUPPLY', null), 'Requires the Can Configure key')
  assert.equal(JSON.stringify(H()), before)
}))

test('DV09-013 area privilege boundaries hold across the hierarchy: a FEED-only operator cannot operate REACTOR modules', () => fixture('pharma', (s) => {
  const sec = useSecurity.getState()
  assert.equal(sec.addUser({ name: 'FeedOp', fullName: 'Feed operator', password: 'x', locks: ['CONTROL', 'ALARMS'], areas: ['FEED'] }), true)
  useSecurity.setState({ currentUser: 'FeedOp' })
  const feedPump = Object.values(useStore.getState().modules).find(m => m.type === 'MOTOR' && m.area === 'FEED')
  const reactorPump = Object.values(useStore.getState().modules).find(m => m.type === 'MOTOR' && m.area === 'REACTOR') ??
    Object.values(useStore.getState().modules).find(m => m.type === 'MOTOR' && m.area === 'PRODUCT')
  s.stopMotor(feedPump.tag); s.startMotor(feedPump.tag)
  assert.equal(useStore.getState().modules[feedPump.tag].commanded, true)
  const other = useStore.getState().modules[reactorPump.tag].commanded
  s.startMotor(reactorPump.tag); s.stopMotor(reactorPump.tag)
  assert.equal(useStore.getState().modules[reactorPump.tag].commanded, other, 'cross-area command is denied')
  assert.match(useSecurity.getState().lastDenied, /area key for/)
  assert.equal(h.modulePath(useStore.getState().modules[reactorPump.tag], H()).area, reactorPump.area)
}))

test('DV09-013 the default hierarchy helper only builds cells for areas that have equipment and fits 16 characters', () => {
  const eq = makeDefaultEquipment()
  const built = h.makeDefaultHierarchy(['FEED', 'EMPTY_AREA', 'A_VERY_LONG_AREA_NAME'], eq)
  assert.deepEqual(Object.keys(built.processCells), ['FEED_CELL'])
  const long = h.makeDefaultHierarchy(['LONGAREANAMEXXXX'], { E: { tag: 'E', description: '', area: 'LONGAREANAMEXXXX' } })
  assert.deepEqual(long.processCells, {}, 'a name that would exceed 16 characters gets no generated cell')
  assert.equal(long.equipment.E.unit, undefined)
})
