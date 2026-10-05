import type { AnyModule, ActiveAlarm, AlarmPriority, PidModule, DcState } from '../engine/types'
import { isLogOnly, priorityValue } from '../engine/alarmPriorities'

export function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

/** Dashed "---.-" display for a Bad-quality (STATUS.QUALITY = BAD) reading. */
export function fmtQ(value: number, decimals: number, bad: boolean): string {
  if (!bad) return fmt(value, decimals)
  return decimals > 0 ? '-'.repeat(Math.max(1, 3 - decimals)) + '.' + '-'.repeat(decimals) : '---'
}

// DeltaV default alarm priority numeric values (CRITICAL 15 / WARNING 11 / ADVISORY 7) are configurable (DV09-038).
export function priorityRank(p: AlarmPriority): number {
  return priorityValue(p)
}

/**
 * Effective sort rank for an alarm: an explicit configured numeric priority
 * (4-15) if set, otherwise the priority class's default rank. Course p181-182
 * "Arbitrary priorities 4-15" allows fine-grained ordering without changing
 * the priority class that drives banner color/label.
 */
export function alarmRank(a: { priority: AlarmPriority; rank?: number }): number {
  return a.rank ?? priorityValue(a.priority)
}

/**
 * DeltaV alarm ranking (Operate course, "DeltaV Alarm Ranking"):
 * 1) unacknowledged before acknowledged
 * 2) active before inactive
 * 3) higher priority value first
 * 4) newer (more recent) time first
 */
export function compareAlarmRank(a: ActiveAlarm, b: ActiveAlarm): number {
  if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1
  if (a.active !== b.active) return a.active ? -1 : 1
  const pr = alarmRank(b) - alarmRank(a)
  if (pr !== 0) return pr
  return b.time - a.time
}

/**
 * The real parameter each alarm type monitors, mirroring what simulate.ts
 * actually evaluates (DV09-040: "do not populate missing fields with
 * fabricated labels" — this is a lookup over genuine evaluation code paths,
 * not an invented taxonomy).
 */
const ALARM_PARAMETER: Partial<Record<ActiveAlarm['type'], string>> = {
  HI: 'PV', HI_HI: 'PV', LO: 'PV', LO_LO: 'PV', DV_HI: 'PV', DV_LO: 'PV',
  PVBAD: 'PV', FAIL: 'STATUS', INTERLOCK: 'STATUS'
}

export function alarmParameter(a: ActiveAlarm): string {
  if (a.id.startsWith('DEVALM.')) return 'STATUS'
  return ALARM_PARAMETER[a.type] ?? '—'
}

/**
 * Alarm-summary Category: a genuine classification derived from the same
 * AlarmType the engine already evaluates (DV09-124), not a per-alarm
 * fabricated label. PROCESS covers measured-value trips, DEVICE covers a
 * module's own failure/bad-quality condition, SYSTEM covers interlocks.
 */
const ALARM_CATEGORY: Partial<Record<ActiveAlarm['type'], string>> = {
  HI: 'PROCESS', HI_HI: 'PROCESS', LO: 'PROCESS', LO_LO: 'PROCESS',
  DV_HI: 'PROCESS', DV_LO: 'PROCESS', PVBAD: 'PROCESS',
  FAIL: 'DEVICE', INTERLOCK: 'SYSTEM'
}

export function alarmCategory(a: ActiveAlarm): string {
  if (a.id.startsWith('DEVALM.')) return 'DEVICE'
  if (a.id.startsWith('HWALM.')) return 'SYSTEM'
  return ALARM_CATEGORY[a.type] ?? '—'
}

/** DV09-040 alarm list columns: a typed, selectable/reorderable set. Ack and
 * Shelve stay as dedicated interactive cells; everything else renders through
 * alarmColumnText so the same logic is unit-testable outside React. */
export type AlarmColumnKey =
  | 'timeIn' | 'module' | 'description' | 'alarm' | 'value' | 'priority' | 'rank'
  | 'area' | 'node' | 'partOf' | 'parameter' | 'category' | 'message' | 'timeLast' | 'unit'

export interface AlarmColumnDef {
  key: AlarmColumnKey
  label: string
  defaultVisible: boolean
}

// Order here is also the default column order (DV09-040: reorderable, not fixed).
// 'category' is deliberately last/hidden by default: DV09-124's workshop has the
// operator add it and move it to the fourth position themselves.
export const ALARM_COLUMNS: AlarmColumnDef[] = [
  { key: 'timeIn', label: 'Time In', defaultVisible: true },
  { key: 'module', label: 'Module/Param', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'alarm', label: 'Alarm', defaultVisible: true },
  { key: 'value', label: 'Value', defaultVisible: true },
  { key: 'priority', label: 'Priority', defaultVisible: true },
  { key: 'rank', label: 'Rank', defaultVisible: false },
  { key: 'area', label: 'Area', defaultVisible: false },
  { key: 'node', label: 'Node', defaultVisible: false },
  { key: 'partOf', label: 'Part Of', defaultVisible: false },
  { key: 'parameter', label: 'Parameter', defaultVisible: false },
  { key: 'category', label: 'Category', defaultVisible: false },
  { key: 'message', label: 'Message', defaultVisible: false },
  { key: 'timeLast', label: 'Time Last', defaultVisible: false },
  { key: 'unit', label: 'Unit', defaultVisible: false }
]

export const DEFAULT_ALARM_COLUMNS: AlarmColumnKey[] = ALARM_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.key)

const ALARM_COLUMNS_KEY = 'batchlive.alarmSummary.columns.v1'

/**
 * DV09-124 "apply/save/reopen Run": the operator's configured column set
 * (e.g. Category added and moved to the fourth position) persists in this
 * browser profile across closing and reopening the Alarm Summary display.
 * This is the simulator-native substitute for a saved DeltaV Operate display
 * configuration file, not a claim of native .dst/.grf persistence.
 */
export function loadAlarmColumns(): AlarmColumnKey[] {
  try {
    const text = window.localStorage.getItem(ALARM_COLUMNS_KEY)
    if (!text) return DEFAULT_ALARM_COLUMNS
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return DEFAULT_ALARM_COLUMNS
    const known = new Set(ALARM_COLUMNS.map((c) => c.key))
    const filtered = parsed.filter((k): k is AlarmColumnKey => typeof k === 'string' && known.has(k as AlarmColumnKey))
    return filtered.length > 0 ? filtered : DEFAULT_ALARM_COLUMNS
  } catch {
    return DEFAULT_ALARM_COLUMNS
  }
}

export function saveAlarmColumns(columns: AlarmColumnKey[]): void {
  try {
    window.localStorage.setItem(ALARM_COLUMNS_KEY, JSON.stringify(columns))
  } catch {
    /* ignore quota/availability errors */
  }
}

/**
 * Truthful text value for a given alarm-list column. `m` is the live module
 * the alarm belongs to, if it still exists (area/node/part-of come from the
 * real module record, never invented when the module or field is absent).
 */
export function alarmColumnText(key: AlarmColumnKey, a: ActiveAlarm, m: AnyModule | undefined, area?: string, unitName?: string): string {
  switch (key) {
    case 'timeIn': return clockString(a.time)
    case 'module': return a.moduleTag
    case 'description': return a.moduleDesc
    case 'alarm': return a.label + (a.customType ? ` (${a.customType})` : '') + (!a.active ? ' (RTN)' : '')
    case 'value': return a.unit ? `${a.value.toFixed(1)} ${a.unit}` : '—'
    case 'priority': return a.priority
    case 'rank': return String(alarmRank(a))
    case 'area': return area ?? m?.area ?? '—'
    case 'node': return (m && 'controllerTag' in m && m.controllerTag) || '—'
    case 'partOf': return m?.equipmentModule ?? '—'
    case 'parameter': return alarmParameter(a)
    case 'category': return alarmCategory(a)
    case 'message': return a.message ?? a.label
    case 'timeLast': return clockString(a.timeLast ?? a.time)
    case 'unit': return unitName ?? '—'
  }
}

/** Highest-priority ACTIVE alarm for a given module tag, or null. */
export function moduleAlarm(tag: string, alarms: ActiveAlarm[]): ActiveAlarm | null {
  let best: ActiveAlarm | null = null
  for (const a of alarms) {
    if (a.moduleTag !== tag || !a.active || isLogOnly(a)) continue
    if (!best || alarmRank(a) > alarmRank(best)) best = a
  }
  return best
}

/** This module's own active, unacknowledged alarm(s) — what a real DeltaV
 * faceplate's "Ack Alarm" button acknowledges directly, without requiring
 * the operator to open Alarm Summary first. */
export function moduleOwnUnacknowledgedAlarms(tag: string, alarms: ActiveAlarm[]): ActiveAlarm[] {
  return alarms.filter((a) => a.moduleTag === tag && a.active && !a.acknowledged)
}

/** DV09-044: whether an alarm is in this workstation's eligible set for
 * counts/tiles/horn/Ack-Page — real DeltaV requires BOTH the workstation's
 * subscribed areas AND the current user's area write keys to admit an alarm.
 * `subscribedAreas === null` means the workstation is subscribed to every
 * area (unrestricted default); `hasAreaKey` mirrors the security store's
 * `hasAreaKey` predicate (undefined user `areas` = unrestricted). */
export function alarmEligible(
  alarm: ActiveAlarm,
  moduleArea: string | undefined,
  subscribedAreas: string[] | null,
  hasAreaKey: (area: string | undefined) => boolean
): boolean {
  if (isLogOnly(alarm)) return false // log-only alarms are event records, not operator alarms
  if (subscribedAreas !== null && (moduleArea === undefined || !subscribedAreas.includes(moduleArea)))
    return false
  return hasAreaKey(moduleArea)
}

export function prioClass(p: AlarmPriority): string {
  return p.toLowerCase()
}

export function isPid(m: AnyModule): m is PidModule {
  return m.type === 'PID'
}

export function modeColor(mode: string): string {
  switch (mode) {
    case 'MAN':
      return 'var(--mode-man)'
    case 'AUTO':
      return 'var(--mode-auto)'
    case 'CAS':
    case 'RCAS':
      return 'var(--mode-cas)'
    case 'IMAN':
      return 'var(--dv-critical)'
    default:
      return 'var(--dv-text-mute)'
  }
}

export function clockString(t: number): string {
  const d = new Date(t)
  return d.toLocaleTimeString('en-US', { hour12: false })
}

export function dateString(t: number): string {
  const d = new Date(t)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
}

/** Elapsed seconds as HH:MM:SS, for S88 phase/step timers. */
export function durationString(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':')
}

/** Operator-facing label + color for a Device Control (DC1) block's DC_STATE. */
export function dcStateInfo(state: DcState): { label: string; color: string } {
  switch (state) {
    case 'CONFIRMED_ACTIVE':
      return { label: 'ACTIVE', color: 'var(--dv-run)' }
    case 'CONFIRMED_PASSIVE':
      return { label: 'PASSIVE', color: 'var(--dv-stop)' }
    case 'GOING_ACTIVE':
      return { label: 'GOING TO ACTIVE', color: 'var(--mode-man)' }
    case 'GOING_PASSIVE':
      return { label: 'GOING TO PASSIVE', color: 'var(--mode-man)' }
    case 'FAILED_ACTIVE':
      return { label: 'FAILED ACTIVE', color: 'var(--dv-critical)' }
    case 'FAILED_PASSIVE':
      return { label: 'FAILED PASSIVE', color: 'var(--dv-critical)' }
    case 'SHUTDOWN':
      return { label: 'SHUTDOWN/INTERLOCKED', color: 'var(--dv-critical)' }
    case 'LOCKED':
      return { label: 'LOCKED', color: 'var(--dv-critical)' }
    default:
      return { label: state, color: 'var(--dv-text-mute)' }
  }
}
