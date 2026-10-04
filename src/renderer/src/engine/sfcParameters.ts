import { isValidDeltaVTag } from './naming'
import { namedSetError, namedSetTargetKey, type NamedSetDefinition, type NamedSetState } from './namedSets'
import type { SfcFunctionBlock } from './sfcBlocks'

export interface SfcNamedParameter {
  type: 'NAMED_SET'
  namedSet: string
  value: number
}
export interface SfcBooleanParameter {
  type: 'BOOLEAN'
  value: boolean
}
export type SfcParameter = SfcNamedParameter | SfcBooleanParameter
export type SfcParameters = Record<string, SfcParameter>
export interface SfcExpressionContext {
  name: string
  parameters: SfcParameters
  sets: Record<string, NamedSetDefinition>
  blocks?: Record<string, SfcFunctionBlock>
}

export function cloneSfcParameters(parameters?: SfcParameters): SfcParameters | undefined {
  return parameters ? Object.fromEntries(Object.entries(parameters).map(([name, parameter]) =>
    [name, { ...parameter }])) : undefined
}

export function sfcParameterError(parameters: SfcParameters | undefined,
  sets: Record<string, NamedSetDefinition>): string | null {
  for (const [name, parameter] of Object.entries(parameters ?? {})) {
    if (!isValidDeltaVTag(name) || name !== name.toUpperCase()) return 'SFC parameter names must use uppercase supported tag syntax'
    if (parameter.type === 'BOOLEAN') {
      if (typeof parameter.value !== 'boolean') return `Boolean parameter ${name} requires true or false`
      continue
    }
    if (parameter.type !== 'NAMED_SET') return `Unsupported SFC parameter type for ${name}`
    const definition = Object.hasOwn(sets, parameter.namedSet) ? sets[parameter.namedSet] : undefined
    if (!definition) return `Named Set ${parameter.namedSet} for ${name} is unavailable; configure/transfer setup data`
    const error = namedSetError(definition)
    if (error) return error
    if (!Number.isSafeInteger(parameter.value) || !definition.entries.some(entry => entry.value === parameter.value)) {
      return `Parameter ${name} value is not defined in ${parameter.namedSet}`
    }
  }
  return null
}

export function namedParameterReferenceError(parameter: string, namedSet: string, entry: string,
  context?: SfcExpressionContext): string | null {
  const definition = context && Object.hasOwn(context.sets, namedSet) ? context.sets[namedSet] : undefined
  const binding = context && Object.hasOwn(context.parameters, parameter) ? context.parameters[parameter] : undefined
  if (!binding) return `Named Set parameter ${parameter} does not exist in this SFC`
  if (binding.type !== 'NAMED_SET') return `${parameter} is not a Named Set parameter`
  if (binding.namedSet !== namedSet) return `${parameter} is bound to ${binding.namedSet}, not ${namedSet}`
  if (!definition) return `Named Set ${namedSet} is unavailable; configure/transfer setup data`
  return definition.entries.some(item => item.name === entry) ? null : `Case-sensitive state ${namedSet}:${entry} does not exist`
}

export function booleanParameterReferenceError(parameter: string, context?: SfcExpressionContext): string | null {
  return context && Object.hasOwn(context.parameters, parameter) && context.parameters[parameter].type === 'BOOLEAN' ?
    null : `Boolean parameter ${parameter} does not exist in this SFC`
}

export function controllerNamedSets(state: NamedSetState, controllerTag: string): Record<string, NamedSetDefinition> {
  return state.deployed[namedSetTargetKey({ kind: 'controller', tag: controllerTag })] ?? {}
}
