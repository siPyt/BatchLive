import type { AlarmPriority, AnyModule } from './types'
import { pictureSignal } from './pictureDynamics'

/**
 * DV09-041 custom alarm type registry: an "Alarm & Event Setup" style item
 * distinct from a module's own fixed HI/LO/etc. AlarmLimit set. Up to 255
 * named types can be defined, each with a priority and a message template
 * that captures live %P1/%P2 parameter values at substitution time.
 */
export interface CustomAlarmTypeDef {
  priority: AlarmPriority
  messageTemplate: string
  p1Path?: string
  p2Path?: string
}

/** configured = the editable Setup draft; deployed = what "Download Changed
 * Setup Data" has actually transferred and what message substitution reads,
 * mirroring this codebase's existing Named Set configured/deployed split. */
export interface CustomAlarmTypeState {
  configured: Record<string, CustomAlarmTypeDef>
  deployed: Record<string, CustomAlarmTypeDef>
}

export const MAX_CUSTOM_ALARM_TYPES = 255

export function cloneCustomAlarmType(def: CustomAlarmTypeDef): CustomAlarmTypeDef {
  return { ...def }
}

const NAME_RE = /^[A-Z][A-Z0-9_]{0,15}$/

export function customAlarmTypeNameError(name: string): string | null {
  return NAME_RE.test(name) ? null :
    'Custom alarm type name must be 1-16 characters, start with a letter, and use only uppercase letters, digits or underscore'
}

export function customAlarmTypeDefError(def: CustomAlarmTypeDef): string | null {
  if (!['CRITICAL', 'WARNING', 'ADVISORY'].includes(def.priority)) return 'Custom alarm type requires a supported priority'
  if (!def.messageTemplate.trim()) return 'Custom alarm type requires a message template'
  if (def.messageTemplate.length > 240) return 'Custom alarm type message template is limited to 240 characters'
  return null
}

/** Names whose configured definition differs from (or was removed from) the
 * deployed set, i.e. exactly what a "Download Changed Setup Data" transfer
 * would need to send — never the whole registry when only one type changed. */
export function changedCustomAlarmTypeNames(state: CustomAlarmTypeState): string[] {
  const names = new Set([...Object.keys(state.configured), ...Object.keys(state.deployed)])
  return [...names]
    .filter((name) => JSON.stringify(state.configured[name]) !== JSON.stringify(state.deployed[name]))
    .sort()
}

function captureParam(tag: string, path: string | undefined, modules: Record<string, AnyModule>): string {
  if (!path) return '?'
  const result = pictureSignal({ id: '_alarmTypeCapture', type: 'datalink', x: 0, y: 0, tag, path }, modules)
  if ('error' in result) return '?'
  const text = result.value.toFixed(result.unit ? 1 : 0)
  return result.unit ? `${text} ${result.unit}` : text
}

/**
 * Substitutes live %P1/%P2 parameter captures into a deployed type's message
 * template. An unresolved/unknown parameter path substitutes "?" (DV09-041
 * "including unknown paths"), never a fabricated numeric value.
 */
export function substituteAlarmMessage(tag: string,
  def: Pick<CustomAlarmTypeDef, 'messageTemplate' | 'p1Path' | 'p2Path'>,
  modules: Record<string, AnyModule>): string {
  return def.messageTemplate
    .replace(/%P1/g, captureParam(tag, def.p1Path, modules))
    .replace(/%P2/g, captureParam(tag, def.p2Path, modules))
}
