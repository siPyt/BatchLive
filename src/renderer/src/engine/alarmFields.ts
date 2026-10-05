// ---------------------------------------------------------------------------
// DV09-043: qualified "ALARMS array" datalink paths — TAG.ALM[TYPE].FIELD.
// Mirrors DeltaV's per-alarm detail parameters (ENAB, PRIAD, MACK) as a
// single generic resolver usable from builder, faceplates and (in principle)
// any other qualified-path consumer, instead of only the fixed Properties
// table rows. PRI is the read-only effective numeric rank (class default,
// overridden by PRIAD when set) already computed by utils/format's alarmRank.
// ---------------------------------------------------------------------------
import { isValidAlarmRank } from './alarmPriorities'
import type { ActiveAlarm, AlarmType, AlarmLimit, AnyModule } from './types'
import type { LockType } from './security'
import { alarmRank } from '../utils/format'

export type AlarmFieldName =
  | 'ENAB' | 'PRI' | 'PRIAD' | 'MACK'
  | 'CUALM' | 'LAALM' | 'CV' | 'NALM' | 'INV' | 'OPSUP' | 'SUPTMO' | 'SUPTMR'

export const ALARM_FIELDS: AlarmFieldName[] = [
  'ENAB', 'PRI', 'PRIAD', 'MACK', 'CUALM', 'LAALM', 'CV', 'NALM', 'INV', 'OPSUP', 'SUPTMO', 'SUPTMR'
]

/** DV09-042 numeric alarm state codes shared by CUALM and LAALM. */
export const ALARM_STATE_CODE = { NORMAL: 0, ACTIVE_UNACK: 1, ACTIVE_ACK: 2, RTN_UNACK: 3 } as const

/** Operator suppression times out after this many minutes unless SUPTMO says otherwise. */
export const DEFAULT_SUPPRESS_MINUTES = 60
export const MAX_SUPPRESS_MINUTES = 1440

/** Live alarm state a status field reads from. */
export interface AlarmFieldContext {
  alarms: ActiveAlarm[]
  time: number
  /** Configured SUPTMO per TAG.TYPE; absent = the default. */
  suppressMinutes?: Record<string, number>
}

/** Which Lock & Key a write to each qualified alarm field requires, matching
 * the course's existing LOCK_HINT text (SYSTEM_RECORDS: "ENAB and other
 * system record fields"; ALARMS: "HORN, MACK, NALM"). PRI has no write lock
 * because it is read-only. */
export const ALARM_FIELD_LOCK: Record<AlarmFieldName, LockType | null> = {
  ENAB: 'SYSTEM_RECORDS',
  PRIAD: 'SYSTEM_RECORDS',
  MACK: 'ALARMS',
  PRI: null,
  CUALM: null,
  LAALM: null,
  CV: null,
  NALM: null,
  INV: null,
  OPSUP: 'ALARMS',
  SUPTMO: 'SYSTEM_RECORDS',
  SUPTMR: null
}

export interface AlarmFieldPath {
  tag: string
  type: AlarmType
  field: AlarmFieldName
}

const PATH_RE = /^([A-Z0-9_-]+)\.ALM\[([A-Z0-9_]+)\]\.([A-Z]+)$/

/** Builds a canonical qualified path string, e.g. alarmFieldPath('LI-101', 'HI', 'ENAB') -> "LI-101.ALM[HI].ENAB". */
export function alarmFieldPath(tag: string, type: AlarmType, field: AlarmFieldName): string {
  return `${tag}.ALM[${type}].${field}`
}

export function parseAlarmFieldPath(path: string): AlarmFieldPath | { error: string } {
  const trimmed = path.trim().toUpperCase()
  const match = PATH_RE.exec(trimmed)
  if (!match) return { error: `${path} is not a valid TAG.ALM[TYPE].FIELD alarm path` }
  const [, tag, type, field] = match
  if (!ALARM_FIELDS.includes(field as AlarmFieldName)) {
    return { error: `${field} is not a supported alarm field (expected one of ${ALARM_FIELDS.join(', ')})` }
  }
  return { tag, type: type as AlarmType, field: field as AlarmFieldName }
}

/** Resolves the configured AlarmLimit a path refers to, or an error if the
 * path is malformed, the module doesn't exist, or the type isn't configured. */
function resolveAlarm(
  modules: Record<string, AnyModule>,
  parsed: AlarmFieldPath
): { alarm: AlarmLimit } | { error: string } {
  const m = modules[parsed.tag]
  if (!m) return { error: `Module ${parsed.tag} does not exist` }
  const alarm = m.alarms.find((a) => a.type === parsed.type)
  if (!alarm) return { error: `${parsed.tag}.${parsed.type} is not a configured alarm` }
  return { alarm }
}

export function readAlarmField(
  modules: Record<string, AnyModule>,
  path: string,
  context?: AlarmFieldContext
): { value: boolean | number | null } | { error: string } {
  const parsed = parseAlarmFieldPath(path)
  if ('error' in parsed) return parsed
  const resolved = resolveAlarm(modules, parsed)
  if ('error' in resolved) return resolved
  const { alarm } = resolved
  if (parsed.field === 'ENAB') return { value: alarm.enabled }
  if (parsed.field === 'PRIAD') return { value: alarm.rank ?? null }
  if (parsed.field === 'PRI') return { value: alarmRank(alarm) }
  if (parsed.field === 'MACK') return { error: 'MACK is a write-only acknowledge pulse and cannot be read' }
  if (!context) return { error: `${parsed.field} needs the live alarm state` }
  const m = modules[parsed.tag]
  const live = context.alarms.find((a) => a.id === `${parsed.tag}.${parsed.type}`)
  const state = (a: ActiveAlarm | undefined): number =>
    !a ? ALARM_STATE_CODE.NORMAL : a.active ? (a.acknowledged ? ALARM_STATE_CODE.ACTIVE_ACK : ALARM_STATE_CODE.ACTIVE_UNACK) : ALARM_STATE_CODE.RTN_UNACK
  switch (parsed.field) {
    case 'CUALM': return { value: live?.active ? state(live) : ALARM_STATE_CODE.NORMAL }
    case 'LAALM': return { value: state(live) }
    case 'CV': {
      if (live) return { value: live.value }
      if (m.type === 'PID' || m.type === 'AI' || m.type === 'AO') return { value: parsed.type === 'DV_HI' || parsed.type === 'DV_LO' ? (m.type === 'PID' ? m.pv - m.sp : 0) : m.pv }
      return { value: 0 }
    }
    case 'NALM': return { value: context.alarms.filter((a) => a.moduleTag === parsed.tag && a.active).length }
    case 'INV': return { value: !alarm.enabled || (('pvBad' in m ? m.pvBad : false) === true) }
    case 'OPSUP': return { value: live?.shelvedUntil !== undefined }
    case 'SUPTMO': return { value: context.suppressMinutes?.[`${parsed.tag}.${parsed.type}`] ?? DEFAULT_SUPPRESS_MINUTES }
    case 'SUPTMR': return { value: live?.shelvedUntil !== undefined ? Math.max(0, Math.ceil((live.shelvedUntil - context.time) / 60000)) : 0 }
    default: return { error: `${parsed.field} is not readable` }
  }
}

/** Pure validation for a write, independent of Locks & Keys (checked
 * separately by the store action, same separation of concerns as
 * deviceConfigurationError/aoConfigurationError elsewhere in the engine). */
export function alarmFieldWriteError(
  modules: Record<string, AnyModule>,
  path: string,
  value: boolean | number | null
): string | null {
  const parsed = parseAlarmFieldPath(path)
  if ('error' in parsed) return parsed.error
  const resolved = resolveAlarm(modules, parsed)
  if ('error' in resolved) return resolved.error
  if (['PRI', 'CUALM', 'LAALM', 'CV', 'NALM', 'INV', 'SUPTMR'].includes(parsed.field)) return `${parsed.field} is a read-only computed field and cannot be written`
  if (parsed.field === 'ENAB') return typeof value !== 'boolean' ? 'ENAB requires a Boolean value' : null
  if (parsed.field === 'PRIAD') {
    return value !== null && !isValidAlarmRank(value)
      ? 'PRIAD must be null (class default) or a whole number from 3 (log only) to 15'
      : null
  }
  if (parsed.field === 'OPSUP') return typeof value !== 'boolean' ? 'OPSUP requires a Boolean value' : null
  if (parsed.field === 'SUPTMO') {
    return typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_SUPPRESS_MINUTES
      ? `SUPTMO must be a whole number of minutes from 1 to ${MAX_SUPPRESS_MINUTES}` : null
  }
  // MACK
  return value !== true ? 'MACK must be written true to acknowledge' : null
}
