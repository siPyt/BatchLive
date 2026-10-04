import { moduleNameError } from './naming'
import { sfcStepsError, type SfcAction, type SfcCondition, type SfcDef, type SfcStep } from './sfc'
import type { AnyModule } from './types'

export interface SfcConfiguration {
  name: string
  area: string
  controllerTag: string
  steps: SfcStep[]
}

export interface SfcLifecycle {
  draft: SfcConfiguration
  saved?: SfcConfiguration
  deployed?: SfcConfiguration
  online: boolean
}

export function cloneSfcConfiguration(configuration: SfcConfiguration): SfcConfiguration {
  return { ...configuration, steps: configuration.steps.map(step => ({
    ...step, transition: { ...step.transition }, actions: step.actions.map(action => ({
      ...action, timingCondition: action.timingCondition ? { ...action.timingCondition } : undefined
    }))
  })) }
}

export function sfcConfigurationError(configuration: SfcConfiguration, modules: Record<string, AnyModule>): string | null {
  return moduleNameError(configuration.name) ??
    (!configuration.steps.length ? 'SFC requires at least one step' : sfcStepsError(configuration.steps, modules))
}

export function sfcDraftDirty(lifecycle: SfcLifecycle): boolean {
  return !lifecycle.saved || JSON.stringify(lifecycle.draft) !== JSON.stringify(lifecycle.saved)
}

export function sfcNeedsDownload(lifecycle: SfcLifecycle): boolean {
  return !!lifecycle.saved && JSON.stringify(lifecycle.saved) !== JSON.stringify(lifecycle.deployed)
}

export function sfcEditorDefinition(runtime: SfcDef, lifecycle?: SfcLifecycle): SfcDef {
  return !lifecycle || lifecycle.online ? runtime : { ...runtime,
    area: lifecycle.draft.area, steps: lifecycle.draft.steps,
    status: 'READY', active: 0, elapsed: 0, actionStates: {} }
}

export const savedSfcKey = (name: string): string => `batchlive.sfc.v1:${name}`
export const serializeSavedSfc = (configuration: SfcConfiguration): string =>
  JSON.stringify({ version: 1, configuration: cloneSfcConfiguration(configuration) })

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function condition(value: unknown): value is SfcCondition {
  if (!record(value)) return false
  if (value.kind === 'always') return true
  if (value.kind === 'timer') return typeof value.seconds === 'number'
  if (typeof value.tag !== 'string') return false
  if (value.kind === 'motorRunning') return typeof value.running === 'boolean'
  if (value.kind === 'valveOpen') return typeof value.open === 'boolean'
  return (value.kind === 'pv' || value.kind === 'out') && typeof value.value === 'number' &&
    ['>', '<', '>=', '<='].includes(String(value.op))
}

function action(value: unknown): value is SfcAction {
  if (!record(value) || typeof value.tag !== 'string') return false
  if (value.qualifier !== undefined && !['N', 'R', 'L', 'D', 'P', 'S', 'SD', 'DS', 'SL'].includes(String(value.qualifier))) return false
  if (value.name !== undefined && typeof value.name !== 'string' ||
    value.description !== undefined && typeof value.description !== 'string' ||
    value.seconds !== undefined && typeof value.seconds !== 'number' ||
    value.timingCondition !== undefined && !condition(value.timingCondition)) return false
  if (value.kind === 'sp' || value.kind === 'out') return typeof value.value === 'number'
  if (value.kind === 'mode') return ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN'].includes(String(value.mode))
  if (value.kind === 'motor') return typeof value.run === 'boolean'
  if (value.kind === 'valve') return typeof value.open === 'boolean'
  return value.kind === 'do' && typeof value.on === 'boolean'
}

function step(value: unknown): value is SfcStep {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    (value.transitionDescription === undefined || typeof value.transitionDescription === 'string') &&
    Array.isArray(value.actions) && value.actions.every(action) && condition(value.transition)
}

export function parseSavedSfc(text: string, modules: Record<string, AnyModule>):
  { configuration: SfcConfiguration; error?: never } | { error: string; configuration?: never } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { error: 'Saved SFC is not valid JSON' } }
  if (!record(parsed) || parsed.version !== 1 || !record(parsed.configuration)) return { error: 'Unsupported saved SFC schema/version' }
  const value = parsed.configuration
  if (typeof value.name !== 'string' || typeof value.area !== 'string' || typeof value.controllerTag !== 'string' ||
    !Array.isArray(value.steps) || !value.steps.every(step)) return { error: 'Malformed saved SFC configuration' }
  const configuration: SfcConfiguration = {
    name: value.name, area: value.area, controllerTag: value.controllerTag, steps: value.steps
  }
  const error = sfcConfigurationError(configuration, modules)
  return error ? { error } : { configuration: cloneSfcConfiguration(configuration) }
}
