import { moduleNameError } from './naming'
import { sfcStepsError, type SfcAction, type SfcCondition, type SfcDef, type SfcStep } from './sfc'
import { isPidTargetMode, PID_ACTUAL_MODES } from './pidModes'
import type { AnyModule } from './types'
import { cloneSfcParameters, sfcParameterError, type SfcParameters } from './sfcParameters'
import type { NamedSetDefinition } from './namedSets'
import { cloneSfcBlocks, parseSfcBlocks, sfcBlockConfigurationError, type SfcBlockConfiguration } from './sfcBlocks'

export interface SfcConfiguration extends SfcBlockConfiguration {
  name: string
  area: string
  description?: string
  equipmentModule?: string
  controllerTag: string
  steps: SfcStep[]
  parameters?: SfcParameters
}

export type SfcModuleProperties = Pick<SfcConfiguration, 'controllerTag' | 'description' | 'equipmentModule'>

export function sfcMetadataError(configuration: Pick<SfcConfiguration, 'area' | 'description' | 'equipmentModule'>,
  equipment?: Record<string, { area: string }>): string | null {
  if (configuration.description !== undefined && typeof configuration.description !== 'string') {
    return 'SFC description must be text'
  }
  const tag = configuration.equipmentModule
  if (tag !== undefined && (typeof tag !== 'string' || moduleNameError(tag))) {
    return 'SFC equipment membership requires a valid Equipment Module name'
  }
  return tag && equipment && (!Object.hasOwn(equipment, tag) || equipment[tag].area !== configuration.area)
    ? 'SFC Equipment Module must exist in the same area' : null
}

export interface SfcLifecycle {
  draft: SfcConfiguration
  saved?: SfcConfiguration
  deployed?: SfcConfiguration
  online: boolean
}

export function cloneSfcConfiguration(configuration: SfcConfiguration): SfcConfiguration {
  const { description, equipmentModule, ...base } = configuration
  return { ...base,
    ...(description === undefined ? {} : { description }),
    ...(equipmentModule === undefined ? {} : { equipmentModule }),
    ...cloneSfcBlocks(configuration), ...(configuration.parameters ? { parameters: cloneSfcParameters(configuration.parameters) } : {}),
    steps: configuration.steps.map(step => ({
    ...step, ...(step.alternatives ? { alternatives: step.alternatives.map(route => ({ ...route, condition: { ...route.condition } })) } : {}),
    ...(step.parallelNextSteps ? { parallelNextSteps: [...step.parallelNextSteps] } : {}),
    ...(step.joinFrom ? { joinFrom: [...step.joinFrom] } : {}),
    transition: { ...step.transition }, actions: step.actions.map(action => ({
      ...action, timingCondition: action.timingCondition ? { ...action.timingCondition } : undefined
    }))
  })) }
}

export function sfcConfigurationError(configuration: SfcConfiguration, modules: Record<string, AnyModule>,
  sets: Record<string, NamedSetDefinition> = {}): string | null {
  return moduleNameError(configuration.name) ??
    sfcMetadataError(configuration) ??
    sfcBlockConfigurationError(configuration) ??
    sfcParameterError(configuration.parameters, sets) ??
    (!configuration.steps.length ? 'SFC requires at least one step' : sfcStepsError(configuration.steps, modules,
      { name: configuration.name, parameters: configuration.parameters ?? {}, sets, blocks: configuration.blocks }))
}

export function sfcDraftDirty(lifecycle: SfcLifecycle): boolean {
  return !lifecycle.saved || JSON.stringify(cloneSfcConfiguration(lifecycle.draft)) !==
    JSON.stringify(cloneSfcConfiguration(lifecycle.saved))
}

export function sfcNeedsDownload(lifecycle: SfcLifecycle): boolean {
  return !!lifecycle.saved && (!lifecycle.deployed || JSON.stringify(cloneSfcConfiguration(lifecycle.saved)) !==
    JSON.stringify(cloneSfcConfiguration(lifecycle.deployed)))
}

export function sfcConfiguredMetadata(runtime: SfcDef, lifecycle?: SfcLifecycle):
  Pick<SfcDef, 'area' | 'description' | 'equipmentModule'> {
  const source = lifecycle?.draft ?? runtime
  return { area: source.area, description: source.description, equipmentModule: source.equipmentModule }
}

export function sfcEditorDefinition(runtime: SfcDef, lifecycle?: SfcLifecycle): SfcDef {
  return !lifecycle || lifecycle.online ? runtime : { ...runtime,
    ...cloneSfcBlocks(lifecycle.draft), blocks: lifecycle.draft.blocks, alarmTypes: lifecycle.draft.alarmTypes, alarms: lifecycle.draft.alarms,
    area: lifecycle.draft.area, steps: lifecycle.draft.steps,
    description: lifecycle.draft.description, equipmentModule: lifecycle.draft.equipmentModule,
    parameters: lifecycle.draft.parameters,
    status: 'READY', active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} }
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
  if (value.kind === 'namedSet') return ['parameter', 'namedSet', 'entry'].every(key => typeof value[key] === 'string')
  if (value.kind === 'boolean') return typeof value.parameter === 'string' && typeof value.value === 'boolean'
  if (typeof value.tag !== 'string') return false
  if (value.kind === 'motorRunning') return typeof value.running === 'boolean'
  if (value.kind === 'valveOpen') return typeof value.open === 'boolean'
  if (value.kind === 'discrete') return typeof value.state === 'boolean'
  if (value.kind === 'mode') return PID_ACTUAL_MODES.some(mode => mode === value.mode)
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
  if (value.kind === 'namedSet') return ['parameter', 'namedSet', 'entry'].every(key => typeof value[key] === 'string')
  if (value.kind === 'boolean') return typeof value.parameter === 'string'
  if (value.kind === 'block') return typeof value.block === 'string'
  if (value.kind === 'mode') return isPidTargetMode(value.mode)
  if (value.kind === 'motor') return typeof value.run === 'boolean'
  if (value.kind === 'deviceReset') return typeof value.reset === 'boolean'
  if (value.kind === 'valve') return typeof value.open === 'boolean'
  return value.kind === 'do' && typeof value.on === 'boolean'
}

function step(value: unknown): value is SfcStep {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    (value.parallelNextSteps === undefined || Array.isArray(value.parallelNextSteps) && value.parallelNextSteps.every(id => typeof id === 'string')) &&
    (value.joinFrom === undefined || Array.isArray(value.joinFrom) && value.joinFrom.every(id => typeof id === 'string')) &&
    (value.nextStep === undefined || value.nextStep === null || typeof value.nextStep === 'string') &&
    (value.alternatives === undefined || Array.isArray(value.alternatives) && value.alternatives.every(route =>
      record(route) && typeof route.nextStep === 'string' && condition(route.condition) &&
      (route.description === undefined || typeof route.description === 'string'))) &&
    (value.transitionDescription === undefined || typeof value.transitionDescription === 'string') &&
    Array.isArray(value.actions) && value.actions.every(action) && condition(value.transition)
}

export function parseSavedSfc(text: string, modules: Record<string, AnyModule>, sets: Record<string, NamedSetDefinition> = {}):
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
  if (value.description !== undefined) {
    if (typeof value.description !== 'string') return { error: 'Malformed saved SFC description' }
    configuration.description = value.description
  }
  if (value.equipmentModule !== undefined) {
    if (typeof value.equipmentModule !== 'string') return { error: 'Malformed saved SFC equipment membership' }
    configuration.equipmentModule = value.equipmentModule
  }
  const blocks = parseSfcBlocks(value)
  if (!blocks) return { error: 'Malformed saved SFC function blocks, alarm types or alarms' }
  Object.assign(configuration, blocks)
  if (value.parameters !== undefined) {
    if (!record(value.parameters)) return { error: 'Malformed saved SFC parameters' }
    const entries: [string, SfcParameters[string]][] = []
    for (const [name, parameter] of Object.entries(value.parameters)) {
      if (!record(parameter)) return { error: 'Malformed saved SFC parameter' }
      if (parameter.type === 'BOOLEAN' && typeof parameter.value === 'boolean') {
        entries.push([name, { type: 'BOOLEAN', value: parameter.value }])
      } else if (parameter.type === 'NAMED_SET' && typeof parameter.namedSet === 'string' && typeof parameter.value === 'number') {
        entries.push([name, { type: 'NAMED_SET', namedSet: parameter.namedSet, value: parameter.value }])
      } else return { error: 'Malformed saved SFC parameter' }
    }
    configuration.parameters = Object.fromEntries(entries)
  }
  const error = sfcConfigurationError(configuration, modules, sets)
  return error ? { error } : { configuration: cloneSfcConfiguration(configuration) }
}
