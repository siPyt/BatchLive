import type { PhaseDef } from './batch'
import type { SfcAction, SfcCondition, SfcStep } from './sfc'

/** DV09-074 Recipe Studio: a named procedure plus a formula of process values applied to the phase logic when a batch starts. */
export interface RecipeFormula {
  /** CHARGE: reactor level at which charging ends, %. */
  chargeLevelPct: number
  /** HEAT/REACT: temperature controller setpoint, degC. HEAT ends 2 degC below it. */
  reactTempC: number
  /** REACT: soak time, seconds. */
  soakSeconds: number
  /** DISCHARGE: reactor level at which discharge ends, %. */
  dischargeLevelPct: number
}

export interface Recipe {
  name: string
  description: string
  /** Ordered phase names; each must exist and appear once. */
  procedure: string[]
  formula: RecipeFormula
  /** Incremented on every saved change. */
  version: number
}

export const DEFAULT_RECIPE_NAME = 'REACT_A'
export const DEFAULT_PROCEDURE = ['CHARGE', 'HEAT', 'REACT', 'DISCHARGE']
export const MAX_PROCEDURE_PHASES = 8
export const FORMULA_LIMITS: Record<keyof RecipeFormula, { min: number; max: number; label: string; unit: string }> = {
  chargeLevelPct: { min: 10, max: 95, label: 'Charge to level', unit: '%' },
  reactTempC: { min: 40, max: 120, label: 'Reaction temperature', unit: 'degC' },
  soakSeconds: { min: 0, max: 3600, label: 'Soak time', unit: 's' },
  dischargeLevelPct: { min: 0, max: 40, label: 'Discharge to level', unit: '%' }
}
/** HEAT finishes this far below the reaction setpoint (the original 92 / 90 degC pair). */
export const HEAT_APPROACH_C = 2

export function defaultFormula(): RecipeFormula {
  return { chargeLevelPct: 80, reactTempC: 92, soakSeconds: 30, dischargeLevelPct: 10 }
}

export function defaultRecipe(): Recipe {
  return { name: DEFAULT_RECIPE_NAME, description: 'Reactor charge, heat, soak and discharge', procedure: [...DEFAULT_PROCEDURE],
    formula: defaultFormula(), version: 1 }
}

export function recipeNameError(name: string): string | null {
  return /^[A-Z][A-Z0-9_-]{0,15}$/.test(name) ? null : 'A recipe name is 1-16 characters: capital letters, digits, _ or -, starting with a letter'
}

/** Every reason the recipe cannot be saved or run against these phases; empty when it is valid. */
export function recipeErrors(recipe: Recipe, phases: Record<string, PhaseDef>): string[] {
  const out: string[] = []
  const nameError = recipeNameError(recipe.name)
  if (nameError) out.push(nameError)
  if (recipe.description.length > 120) out.push('The description is limited to 120 characters')
  if (!recipe.procedure.length) out.push('The procedure needs at least one phase')
  if (recipe.procedure.length > MAX_PROCEDURE_PHASES) out.push(`The procedure is limited to ${MAX_PROCEDURE_PHASES} phases`)
  if (new Set(recipe.procedure).size !== recipe.procedure.length) out.push('A phase can appear only once in the procedure')
  for (const phase of recipe.procedure) if (!phases[phase]) out.push(`Phase ${phase} does not exist`)
  for (const key of Object.keys(FORMULA_LIMITS) as (keyof RecipeFormula)[]) {
    const limit = FORMULA_LIMITS[key]
    const value = recipe.formula[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < limit.min || value > limit.max)
      out.push(`${limit.label} must be between ${limit.min} and ${limit.max} ${limit.unit}`)
    else if (key === 'soakSeconds' && !Number.isInteger(value)) out.push('Soak time must be whole seconds')
  }
  return out
}

export interface ResolvedRecipe {
  procedure: string[]
  /** Clones of the phases in the procedure with the formula applied; originals are untouched. */
  phases: Record<string, PhaseDef>
  version: number
  /** One line per formula value that was written into the phase logic. */
  applied: string[]
}

const isPv = (c: SfcCondition, tag: string, op: string): c is Extract<SfcCondition, { kind: 'pv' }> =>
  c.kind === 'pv' && c.tag === tag && c.op === op

function mapStep(step: SfcStep, phase: string, f: RecipeFormula, applied: Set<string>): SfcStep {
  const note = (text: string): void => { applied.add(text) }
  const action = (a: SfcAction): SfcAction => {
    if (a.kind === 'sp' && a.tag === 'TIC-201' && (phase === 'HEAT' || phase === 'REACT')) {
      note(`${phase}: TIC-201 setpoint ${f.reactTempC} degC`)
      return { ...a, value: f.reactTempC }
    }
    return a
  }
  const condition = (c: SfcCondition): SfcCondition => {
    if (phase === 'CHARGE' && isPv(c, 'LIC-201', '>=')) { note(`CHARGE: LIC-201 >= ${f.chargeLevelPct} %`); return { ...c, value: f.chargeLevelPct } }
    if (phase === 'HEAT' && isPv(c, 'TIC-201', '>=')) {
      note(`HEAT: TIC-201 >= ${f.reactTempC - HEAT_APPROACH_C} degC`)
      return { ...c, value: f.reactTempC - HEAT_APPROACH_C }
    }
    if (phase === 'REACT' && c.kind === 'timer') { note(`REACT: soak ${f.soakSeconds} s`); return { ...c, seconds: f.soakSeconds } }
    if (phase === 'DISCHARGE' && isPv(c, 'LIC-201', '<=')) { note(`DISCHARGE: LIC-201 <= ${f.dischargeLevelPct} %`); return { ...c, value: f.dischargeLevelPct } }
    return c
  }
  const mapped: SfcStep = { ...step, actions: step.actions.map(action), transition: condition(step.transition) }
  if (step.alternatives) mapped.alternatives = step.alternatives.map(alt => ({ ...alt, condition: condition(alt.condition) }))
  return mapped
}

/** Apply the recipe formula to a snapshot of its phases. Returns errors instead when the recipe is not runnable. */
export function resolveRecipe(recipe: Recipe, phases: Record<string, PhaseDef>): { ok: true; resolved: ResolvedRecipe } | { ok: false; errors: string[] } {
  const errors = recipeErrors(recipe, phases)
  if (errors.length) return { ok: false, errors }
  const applied = new Set<string>()
  const resolved: Record<string, PhaseDef> = {}
  for (const name of recipe.procedure)
    resolved[name] = { ...phases[name], steps: phases[name].steps.map(step => mapStep(step, name, recipe.formula, applied)) }
  return { ok: true, resolved: { procedure: [...recipe.procedure], phases: resolved, version: recipe.version, applied: [...applied] } }
}
