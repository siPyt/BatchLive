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
const rec = require('../src/renderer/src/engine/recipes.ts')
const { makeDefaultPhases } = require('../src/renderer/src/engine/batch.ts')

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const alerts = []
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { alert: (m) => alerts.push(m), localStorage: global.localStorage }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    useStore.getState().newProject('pharma')
    run(alerts)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    delete global.localStorage
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}
const recipe = (over = {}) => ({ ...rec.defaultRecipe(), ...over })
const timerPhases = () => Object.fromEntries(['CHARGE', 'HEAT', 'REACT', 'DISCHARGE'].map(name => [name,
  { name, description: name, unit: 'REACTOR', steps: [{ id: `${name}-1`, name: 'WAIT', actions: [], transition: { kind: 'timer', seconds: 2 } }] }]))

test('DV09-074 formula limits and structure are validated with every reason reported', () => {
  const phases = makeDefaultPhases()
  assert.deepEqual(rec.recipeErrors(rec.defaultRecipe(), phases), [])
  for (const name of ['', 'react', '1ABC', 'A'.repeat(17), 'A B']) assert.ok(rec.recipeNameError(name), name)
  for (const name of ['A', 'REACT_B', 'A'.repeat(16), 'R-1']) assert.equal(rec.recipeNameError(name), null)
  const bad = recipe({ procedure: ['CHARGE', 'CHARGE', 'NOPE'], formula: { chargeLevelPct: 5, reactTempC: 130, soakSeconds: 1.5, dischargeLevelPct: 41 } })
  const errors = rec.recipeErrors(bad, phases)
  assert.ok(errors.some(e => /only once/.test(e)))
  assert.ok(errors.some(e => /NOPE does not exist/.test(e)))
  assert.ok(errors.some(e => /Charge to level must be between 10 and 95/.test(e)))
  assert.ok(errors.some(e => /Reaction temperature must be between 40 and 120/.test(e)))
  assert.ok(errors.some(e => /whole seconds/.test(e)))
  assert.ok(errors.some(e => /Discharge to level must be between 0 and 40/.test(e)))
  assert.ok(rec.recipeErrors(recipe({ procedure: [] }), phases).some(e => /at least one phase/.test(e)))
  const edges = recipe({ formula: { chargeLevelPct: 95, reactTempC: 40, soakSeconds: 3600, dischargeLevelPct: 0 } })
  assert.deepEqual(rec.recipeErrors(edges, phases), [])
  assert.ok(rec.recipeErrors(recipe({ formula: { ...rec.defaultFormula(), chargeLevelPct: NaN } }), phases).length)
})

test('DV09-074 the default recipe resolves to the original phase logic', () => {
  const phases = makeDefaultPhases()
  const result = rec.resolveRecipe(rec.defaultRecipe(), phases)
  assert.equal(result.ok, true)
  assert.deepEqual(result.resolved.phases, Object.fromEntries(rec.DEFAULT_PROCEDURE.map(p => [p, phases[p]])))
  assert.deepEqual(result.resolved.procedure, rec.DEFAULT_PROCEDURE)
})

test('DV09-074 formula values are written into cloned phases and the originals are untouched', () => {
  const phases = makeDefaultPhases()
  const original = JSON.stringify(phases)
  const result = rec.resolveRecipe(recipe({ formula: { chargeLevelPct: 60, reactTempC: 100, soakSeconds: 45, dischargeLevelPct: 5 } }), phases)
  const p = result.resolved.phases
  assert.equal(p.CHARGE.steps[0].transition.value, 60)
  assert.equal(p.HEAT.steps[0].transition.value, 98)
  assert.equal(p.HEAT.steps[0].actions.find(a => a.kind === 'sp').value, 100)
  assert.equal(p.REACT.steps[0].actions.find(a => a.kind === 'sp').value, 100)
  assert.equal(p.REACT.steps[0].transition.seconds, 45)
  assert.equal(p.DISCHARGE.steps[0].transition.value, 5)
  assert.equal(JSON.stringify(phases), original)
  assert.ok(result.resolved.applied.includes('REACT: soak 45 s'))
  const partial = rec.resolveRecipe(recipe({ procedure: ['CHARGE', 'DISCHARGE'] }), phases)
  assert.deepEqual(Object.keys(partial.resolved.phases), ['CHARGE', 'DISCHARGE'])
  assert.ok(!partial.resolved.applied.some(a => a.startsWith('HEAT')))
  assert.equal(rec.resolveRecipe(recipe({ procedure: ['NOPE'] }), phases).ok, false)
})

test('DV09-074 saving needs the Build Recipes key, validates, versions and logs', () => fixture(() => {
  const s = useStore.getState()
  const r = recipe({ name: 'REACT_B', formula: { ...rec.defaultFormula(), soakSeconds: 60 } })
  assert.equal(s.saveRecipe(r), null)
  assert.equal(useStore.getState().recipes.REACT_B.version, 1)
  assert.equal(s.saveRecipe({ ...r, description: 'changed' }), null)
  assert.equal(useStore.getState().recipes.REACT_B.version, 2)
  assert.match(s.saveRecipe(recipe({ name: 'bad' })), /recipe name/)
  assert.equal(useStore.getState().recipes.bad, undefined)
  assert.ok(useStore.getState().eventLog.some(e => /Recipe save rejected/.test(e.description)))
  assert.ok(useStore.getState().eventLog.some(e => /Recipe created: version 1/.test(e.description)))
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { BUILD_RECIPES: 'SYSTEM_ADMIN' } })
  assert.equal(s.saveRecipe(recipe({ name: 'REACT_C' })), 'Requires the Build Recipes key')
  assert.equal(s.deleteRecipe('REACT_B'), 'Requires the Build Recipes key')
  assert.equal(useStore.getState().recipes.REACT_C, undefined)
  assert.ok(useStore.getState().recipes.REACT_B)
}))

test('DV09-074 delete and select rules: not the selected or last recipe; selection only while READY', () => fixture(() => {
  const s = useStore.getState()
  assert.match(s.deleteRecipe('REACT_A'), /last recipe|selected recipe/)
  s.saveRecipe(recipe({ name: 'REACT_B' }))
  assert.match(s.deleteRecipe('REACT_A'), /selected recipe cannot be deleted/)
  assert.equal(s.deleteRecipe('NOPE'), 'Recipe NOPE does not exist')
  assert.equal(s.selectRecipe('REACT_B'), null)
  assert.equal(useStore.getState().activeRecipe, 'REACT_B')
  assert.equal(useStore.getState().batch.recipe, 'REACT_B')
  assert.equal(s.deleteRecipe('REACT_A'), null)
  assert.equal(s.selectRecipe('REACT_A'), 'Recipe REACT_A does not exist')
  s.saveRecipe(recipe({ name: 'REACT_C' }))
  useStore.setState({ batch: { ...useStore.getState().batch, status: 'RUNNING' } })
  assert.match(s.selectRecipe('REACT_C'), /Reset the batch to READY/)
  assert.match(s.saveRecipe(recipe({ name: 'REACT_B', description: 'edit while running' })), /Stop or reset the batch/)
  assert.equal(s.saveRecipe(recipe({ name: 'REACT_C', description: 'other recipe is fine' })), null)
  useSecurity.setState({ currentUser: 'operator', lockAssignments: { BATCH_OPERATE: 'SYSTEM_ADMIN' } })
  useStore.setState({ batch: { ...useStore.getState().batch, status: 'READY' } })
  assert.equal(s.selectRecipe('REACT_C'), 'Requires the Batch Operate key')
  assert.equal(useStore.getState().activeRecipe, 'REACT_B')
}))

test('DV09-074 START snapshots the recipe procedure and formula; later edits do not change the running batch', () => fixture(() => {
  const s = useStore.getState()
  useStore.setState({ phases: timerPhases() })
  s.saveRecipe(recipe({ name: 'SHORT', procedure: ['CHARGE', 'DISCHARGE'], formula: { ...rec.defaultFormula(), soakSeconds: 9 } }))
  s.selectRecipe('SHORT')
  s.batchCommand('START')
  const batch = useStore.getState().batch
  assert.equal(batch.status, 'RUNNING')
  assert.deepEqual(batch.procedure, ['CHARGE', 'DISCHARGE'])
  assert.equal(batch.recipeVersion, 1)
  assert.equal(batch.phase.name, 'CHARGE')
  assert.ok(batch.log.some(l => /recipe SHORT v1/.test(l.text)))
  assert.equal(s.saveRecipe(recipe({ name: 'OTHER', procedure: ['REACT'] })), null)
  useStore.setState({ phases: { ...useStore.getState().phases, CHARGE: { ...useStore.getState().phases.CHARGE, description: 'edited later' } } })
  assert.deepEqual(useStore.getState().batch.procedure, ['CHARGE', 'DISCHARGE'])
}))

test('DV09-074 a started batch runs exactly the recipe procedure to COMPLETE', () => fixture(() => {
  const s = useStore.getState()
  useStore.setState({ phases: timerPhases(), running: true })
  s.saveRecipe(recipe({ name: 'SHORT', procedure: ['DISCHARGE', 'CHARGE'] }))
  s.selectRecipe('SHORT')
  s.batchCommand('START')
  const seen = new Set([useStore.getState().batch.phase.name])
  for (let i = 0; i < 12 && useStore.getState().batch.status === 'RUNNING'; i++) {
    useStore.getState().tick(1)
    seen.add(useStore.getState().batch.phase.name)
  }
  const batch = useStore.getState().batch
  assert.equal(batch.status, 'COMPLETE')
  assert.deepEqual([...seen], ['DISCHARGE', 'CHARGE'])
  assert.equal(batch.opIndex, 1)
  assert.ok(!batch.log.some(l => /HEAT|REACT/.test(l.text)))
}))

test('DV09-074 an unrunnable recipe is refused at START with a diagnostic and the batch stays READY', () => fixture((alerts) => {
  const s = useStore.getState()
  s.saveRecipe(recipe({ name: 'GONE', procedure: ['CHARGE', 'HEAT'] }))
  s.selectRecipe('GONE')
  const phases = { ...useStore.getState().phases }
  delete phases.HEAT
  useStore.setState({ phases })
  s.batchCommand('START')
  assert.equal(useStore.getState().batch.status, 'READY')
  assert.match(alerts.at(-1), /cannot run: Phase HEAT does not exist/)
  assert.ok(useStore.getState().eventLog.some(e => /Batch command rejected: Recipe GONE cannot run/.test(e.description)))
}))

test('DV09-074 File > New and Initialize keep the recipe state consistent', () => fixture(() => {
  const s = useStore.getState()
  s.saveRecipe(recipe({ name: 'REACT_B' }))
  s.selectRecipe('REACT_B')
  useStore.getState().initializeSimulation()
  assert.equal(useStore.getState().batch.recipe, 'REACT_B')
  assert.equal(useStore.getState().batch.status, 'READY')
  useStore.getState().newProject('pharma')
  assert.deepEqual(Object.keys(useStore.getState().recipes), ['REACT_A'])
  assert.equal(useStore.getState().activeRecipe, 'REACT_A')
  assert.equal(useStore.getState().batch.recipe, 'REACT_A')
}))
