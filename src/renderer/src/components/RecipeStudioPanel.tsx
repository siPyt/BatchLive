import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { useSecurity } from '../engine/security'
import {
  FORMULA_LIMITS, MAX_PROCEDURE_PHASES, defaultFormula, recipeErrors, resolveRecipe, type Recipe, type RecipeFormula
} from '../engine/recipes'

/** DV09-074 Recipe Studio: procedure and formula editing (Build Recipes key) and recipe selection (Batch Operate key). */
export function RecipeStudioPanel(): JSX.Element {
  const recipes = useStore((s) => s.recipes)
  const activeRecipe = useStore((s) => s.activeRecipe)
  const phases = useStore((s) => s.phases)
  const batchStatus = useStore((s) => s.batch.status)
  const save = useStore((s) => s.saveRecipe)
  const remove = useStore((s) => s.deleteRecipe)
  const select = useStore((s) => s.selectRecipe)
  const canBuild = useSecurity((s) => s.hasLock('BUILD_RECIPES'))
  const [editing, setEditing] = useState<string>(activeRecipe)
  const [draft, setDraft] = useState<Recipe>(recipes[activeRecipe])
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const source = recipes[editing]
    if (source) setDraft(source)
  }, [editing, recipes])

  const phaseNames = Object.keys(phases)
  const errors = recipeErrors(draft, phases)
  const preview = resolveRecipe(draft, phases)
  const setFormula = (key: keyof RecipeFormula, value: string): void =>
    setDraft({ ...draft, formula: { ...draft.formula, [key]: Number(value) } })
  const move = (index: number, by: number): void => {
    const next = [...draft.procedure]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft({ ...draft, procedure: next })
  }
  const toggle = (phase: string, on: boolean): void =>
    setDraft({ ...draft, procedure: on ? [...draft.procedure, phase] : draft.procedure.filter((p) => p !== phase) })

  return (
    <section className="recipe-studio" aria-label="Recipe Studio" style={{ padding: 10, borderTop: '1px solid var(--dv-border)' }}>
      <div className="batch-panel-head">Recipe Studio</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Recipe
          <select aria-label="Recipe" value={editing} style={{ marginLeft: 6 }} onChange={(e) => setEditing(e.target.value)}>
            {Object.values(recipes).map((r) => <option key={r.name} value={r.name}>{r.name} v{r.version}{r.name === activeRecipe ? ' (selected)' : ''}</option>)}
          </select>
        </label>
        <button className="tbtn sm" disabled={editing === activeRecipe || batchStatus !== 'READY'}
          onClick={() => setMessage(select(editing) ?? `Recipe ${editing} selected for the next batch.`)}>Select for next batch</button>
        <button className="tbtn sm" disabled={!canBuild} onClick={() => {
          const name = `RECIPE_${Object.keys(recipes).length + 1}`
          setEditing(name)
          setDraft({ name, description: '', procedure: [...recipes[activeRecipe].procedure], formula: defaultFormula(), version: 0 })
        }}>New recipe</button>
        <button className="tbtn sm" disabled={!canBuild || !recipes[editing]} onClick={() => setMessage(remove(editing) ?? `Recipe ${editing} deleted.`)}>Delete</button>
      </div>
      {!canBuild && <div style={{ fontSize: 11, color: 'var(--dv-text-mute)' }}>Editing requires the Build Recipes key; selection requires Batch Operate.</div>}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        <label>Name <input aria-label="Recipe name" disabled={!canBuild || !!recipes[draft.name]} value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value.toUpperCase() })} /></label>
        <label>Description <input aria-label="Recipe description" disabled={!canBuild} value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        {(Object.keys(FORMULA_LIMITS) as (keyof RecipeFormula)[]).map((key) => (
          <label key={key}>{FORMULA_LIMITS[key].label} ({FORMULA_LIMITS[key].unit})
            <input aria-label={FORMULA_LIMITS[key].label} type="number" style={{ width: 70, marginLeft: 6 }} disabled={!canBuild}
              value={draft.formula[key]} onChange={(e) => setFormula(key, e.target.value)} />
          </label>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <b>Procedure</b> (max {MAX_PROCEDURE_PHASES} phases)
        {draft.procedure.map((phase, i) => (
          <div key={phase} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>{i + 1}. {phase}</span>
            <button className="tbtn sm" aria-label={`Move ${phase} up`} disabled={!canBuild || i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="tbtn sm" aria-label={`Move ${phase} down`} disabled={!canBuild || i === draft.procedure.length - 1} onClick={() => move(i, 1)}>↓</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          {phaseNames.map((phase) => (
            <label key={phase}><input type="checkbox" disabled={!canBuild} checked={draft.procedure.includes(phase)}
              onChange={(e) => toggle(phase, e.target.checked)} /> {phase}</label>
          ))}
        </div>
      </div>
      {errors.length > 0 && <ul role="alert" style={{ color: 'var(--dv-critical)' }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {preview.ok && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <b>Written into the phase logic at START:</b>
          <ul>{preview.resolved.applied.length ? preview.resolved.applied.map((a) => <li key={a}>{a}</li>) : <li>No formula value applies to these phases.</li>}</ul>
        </div>
      )}
      <button className="tbtn sm" disabled={!canBuild || errors.length > 0} onClick={() => {
        const error = save(draft)
        setMessage(error ?? `Recipe ${draft.name} saved.`)
        if (!error) setEditing(draft.name)
      }}>Save recipe</button>
      {message && <div role="status">{message}</div>}
      <p style={{ fontSize: 11, color: 'var(--dv-text-mute)' }}>
        A batch snapshots the selected recipe when it starts, so later edits never change a running batch. The formula
        maps onto the standard reactor phases (CHARGE, HEAT, REACT, DISCHARGE); phases you add are run as configured
        in the Phase Logic panel. This is a training Recipe Studio, not DeltaV Batch recipe management.
      </p>
    </section>
  )
}
