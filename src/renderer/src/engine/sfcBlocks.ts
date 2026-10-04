import type { AlarmPriority, ActiveAlarm, AnyModule } from './types'
import type { SfcDef } from './sfc'
import { isValidDeltaVTag } from './naming'
import { makeFunctionBlock } from './plant'
import { reconcileAlarm, stepFunctionBlock } from './simulate'

export interface SfcFunctionBlock {
  type: 'ALARM'
  source: 'ACTION_TIME'
  op: '>' | '>='
  seconds: number
}
export interface SfcBlockState {
  active: boolean
  elapsed: number
  out: number
  bad: boolean
}
export interface SfcAlarmType {
  description: string
  priority: AlarmPriority
}
export interface SfcAlarm {
  type: string
  block: string
  enabled: boolean
}
export interface SfcBlockConfiguration {
  blocks?: Record<string, SfcFunctionBlock>
  alarmTypes?: Record<string, SfcAlarmType>
  alarms?: Record<string, SfcAlarm>
}

export function isSfcAlarm(alarm: ActiveAlarm): boolean {
  return alarm.type === 'CUSTOM' && alarm.id.startsWith(`${alarm.moduleTag}.SFC.`)
}

export function cloneSfcBlocks(configuration: SfcBlockConfiguration): SfcBlockConfiguration {
  return Object.fromEntries((['blocks', 'alarmTypes', 'alarms'] as const).flatMap(key => {
    const items = configuration[key]
    return items ? [[key, Object.fromEntries(Object.entries(items).map(([name, item]) => [name, { ...item }]))]] : []
  }))
}

export function parseSfcBlocks(value: Record<string, unknown>): SfcBlockConfiguration | null {
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item)
  const configuration: SfcBlockConfiguration = {}
  for (const key of ['blocks', 'alarmTypes', 'alarms'] as const) {
    const items = value[key]
    if (items === undefined) continue
    if (!record(items)) return null
    if (key === 'blocks') {
      configuration.blocks = {}
      for (const [name, item] of Object.entries(items)) {
        if (!record(item) || item.type !== 'ALARM' || item.source !== 'ACTION_TIME' ||
          item.op !== '>' && item.op !== '>=' || typeof item.seconds !== 'number') return null
        configuration.blocks[name] = { type: item.type, source: item.source, op: item.op, seconds: item.seconds }
      }
    } else if (key === 'alarmTypes') {
      configuration.alarmTypes = {}
      for (const [name, item] of Object.entries(items)) {
        if (!record(item) || typeof item.description !== 'string' ||
          item.priority !== 'CRITICAL' && item.priority !== 'WARNING' && item.priority !== 'ADVISORY') return null
        configuration.alarmTypes[name] = { description: item.description, priority: item.priority }
      }
    } else {
      configuration.alarms = {}
      for (const [name, item] of Object.entries(items)) {
        if (!record(item) || typeof item.type !== 'string' || typeof item.block !== 'string' || typeof item.enabled !== 'boolean') return null
        configuration.alarms[name] = { type: item.type, block: item.block, enabled: item.enabled }
      }
    }
  }
  return configuration
}

export function sfcBlockConfigurationError(configuration: SfcBlockConfiguration): string | null {
  for (const [group, items] of Object.entries(configuration)) {
    if (!['blocks', 'alarmTypes', 'alarms'].includes(group)) continue
    for (const name of Object.keys(items ?? {})) {
      if (!isValidDeltaVTag(name) || name !== name.toUpperCase()) return `${group} names must use uppercase supported tag syntax`
    }
  }
  for (const block of Object.values(configuration.blocks ?? {})) {
    if (!block || block.type !== 'ALARM' || block.source !== 'ACTION_TIME' || !['>', '>='].includes(block.op) ||
      !Number.isFinite(block.seconds) || block.seconds < 0) return 'ALARM requires a finite nonnegative action-time threshold and > or >='
  }
  for (const type of Object.values(configuration.alarmTypes ?? {})) {
    if (!type || typeof type.description !== 'string' || !type.description.trim() ||
      !['CRITICAL', 'WARNING', 'ADVISORY'].includes(type.priority)) {
      return 'Custom alarm type requires a description and supported priority'
    }
  }
  for (const alarm of Object.values(configuration.alarms ?? {})) {
    if (!alarm || !Object.hasOwn(configuration.blocks ?? {}, alarm.block) || !Object.hasOwn(configuration.alarmTypes ?? {}, alarm.type) ||
      typeof alarm.enabled !== 'boolean') return 'SFC alarm requires an existing local block, custom alarm type and Boolean enabled setting'
  }
  return null
}

export function executeSfcBlock(sfc: SfcDef, blockName: string, elapsed: number, modules: Record<string, AnyModule>): void {
  const definition = sfc.blocks?.[blockName]
  if (!definition) throw new Error(`Missing validated SFC function block ${sfc.name}/${blockName}`)
  const tolerance = Number.EPSILON * Math.max(1, elapsed, definition.seconds) * 64
  const input = Math.abs(elapsed - definition.seconds) <= tolerance ? definition.seconds : elapsed
  const block = makeFunctionBlock({ tag: blockName, description: blockName, area: sfc.area, fbType: definition.type,
    in1: { kind: 'const', value: input }, in2: { kind: 'const', value: definition.seconds },
    cmpOp: definition.op, bias: definition.seconds })
  stepFunctionBlock(block, modules, 0)
  sfc.blockStates ??= {}
  sfc.blockStates[blockName] = { active: true, elapsed, out: block.out, bad: !!block.bad }
}

export function syncSfcBlockActivation(sfc: SfcDef): void {
  const states = sfc.blockStates
  if (!states) return
  for (const [block, runtime] of Object.entries(states)) {
    if (!Object.values(sfc.actionStates ?? {}).some(state =>
      state.active && state.action.kind === 'block' && state.action.block === block)) {
      states[block] = { ...runtime, active: false, out: 0 }
    }
  }
}

export function reconcileSfcAlarms(alarms: ActiveAlarm[], sfcs: Record<string, SfcDef>, now: number): void {
  const ids = new Set<string>()
  for (const sfc of Object.values(sfcs)) {
    for (const [name, alarm] of Object.entries(sfc.alarms ?? {})) {
      const id = `${sfc.name}.SFC.${name}`
      ids.add(id)
      const type = sfc.alarmTypes?.[alarm.type]
      const block = sfc.blockStates?.[alarm.block]
      if (!type) throw new Error(`Missing validated SFC alarm type ${sfc.name}/${alarm.type}`)
      reconcileAlarm(alarms, sfc.name, type.description,
        { type: 'CUSTOM', label: name, priority: type.priority, enabled: alarm.enabled },
        alarm.enabled && !!block?.active && !block.bad && block.out !== 0,
        block?.elapsed ?? 0, 's', now, id, alarm.type)
    }
  }
  for (const alarm of [...alarms]) {
    if (isSfcAlarm(alarm) && !ids.has(alarm.id)) {
      reconcileAlarm(alarms, alarm.moduleTag, alarm.moduleDesc,
        { type: 'CUSTOM', label: alarm.label, priority: alarm.priority, enabled: false },
        false, alarm.value, alarm.unit, now, alarm.id, alarm.customType)
    }
  }
}
