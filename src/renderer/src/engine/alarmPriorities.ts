import { create } from 'zustand'
import { useSecurity } from './security'
import type { ActiveAlarm, AlarmPriority, EventLogEntry } from './types'

/**
 * DV09-038 Alarm Priorities (course 4-23..4-30): numeric priority values 4 (lowest) to 15 (highest) plus a log-only
 * level of 3, and per-priority Auto Acknowledge New Alarms, Auto Acknowledge When Inactive, Alarm Banner Shows and Wave File.
 */
export type PriorityClass = 'CRITICAL' | 'WARNING' | 'ADVISORY' | 'LOG'
export type BannerShows = 'NOT_HIDDEN' | 'MODULE' | 'UNIT'

export interface PriorityConfig {
  /** Numeric priority value (4-15); LOG is fixed at 3. */
  value: number
  autoAckNew: boolean
  autoAckInactive: boolean
  bannerShows: BannerShows
  /** Sound for active alarms of this priority; "(none)" silences it. */
  waveFile: string
}

export const LOG_RANK = 3
export const MIN_VALUE = 4
export const MAX_VALUE = 15
export const SILENT_WAVE = '(none)'
export const PRIORITY_CLASSES: PriorityClass[] = ['CRITICAL', 'WARNING', 'ADVISORY', 'LOG']
export const BANNER_SHOWS_LABEL: Record<BannerShows, string> = {
  NOT_HIDDEN: 'Not Hidden', MODULE: 'Module', UNIT: 'Unit/Equipment Module'
}

export type PriorityTable = Record<PriorityClass, PriorityConfig>

export function defaultPriorities(): PriorityTable {
  return {
    CRITICAL: { value: 15, autoAckNew: false, autoAckInactive: false, bannerShows: 'NOT_HIDDEN', waveFile: 'Critical.wav' },
    WARNING: { value: 11, autoAckNew: false, autoAckInactive: false, bannerShows: 'NOT_HIDDEN', waveFile: 'Warning.wav' },
    ADVISORY: { value: 7, autoAckNew: false, autoAckInactive: false, bannerShows: 'NOT_HIDDEN', waveFile: SILENT_WAVE },
    LOG: { value: LOG_RANK, autoAckNew: true, autoAckInactive: true, bannerShows: 'NOT_HIDDEN', waveFile: SILENT_WAVE }
  }
}

export function isValidAlarmRank(rank: unknown): rank is number {
  return typeof rank === 'number' && Number.isInteger(rank) && rank >= LOG_RANK && rank <= MAX_VALUE
}
export const ALARM_RANK_ERROR = 'Alarm priority rank must be a whole number from 3 (log only) to 15'

/** An explicit rank of 3 makes an alarm log-only whatever its priority class; otherwise the class decides. */
export function priorityClassOf(a: { priority: AlarmPriority; rank?: number }): PriorityClass {
  return a.rank === LOG_RANK ? 'LOG' : a.priority
}
export const isLogOnly = (a: { priority: AlarmPriority; rank?: number }): boolean => a.rank === LOG_RANK

/** Every reason the table cannot be applied; empty when valid. */
export function priorityTableErrors(table: PriorityTable): string[] {
  const out: string[] = []
  for (const cls of PRIORITY_CLASSES) {
    const c = table[cls]
    if (!c || typeof c !== 'object') { out.push(`${cls} is missing`); continue }
    if (cls === 'LOG') { if (c.value !== LOG_RANK) out.push('The log-only level is fixed at 3') }
    else if (!Number.isInteger(c.value) || c.value < MIN_VALUE || c.value > MAX_VALUE) out.push(`${cls} value must be a whole number from ${MIN_VALUE} to ${MAX_VALUE}`)
    if (typeof c.autoAckNew !== 'boolean' || typeof c.autoAckInactive !== 'boolean') out.push(`${cls} auto-acknowledge options must be on or off`)
    if (!(c.bannerShows in BANNER_SHOWS_LABEL)) out.push(`${cls} Alarm Banner Shows must be Not Hidden, Module or Unit/Equipment Module`)
    if (c.waveFile !== SILENT_WAVE && !/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,39}\.wav$/i.test(c.waveFile)) out.push(`${cls} wave file must be a .wav file name or ${SILENT_WAVE}`)
  }
  if (!out.length && !(table.CRITICAL.value > table.WARNING.value && table.WARNING.value > table.ADVISORY.value))
    out.push('Priority values must stay ordered: Critical > Warning > Advisory')
  return out
}

// --- shared live table -------------------------------------------------------

let current: PriorityTable = defaultPriorities()
export const priorityTable = (): PriorityTable => current
/** The configured numeric value of a priority class (used for ranking alarms without an explicit rank). */
export const priorityValue = (p: AlarmPriority): number => current[p].value

const STORAGE_KEY = 'batchlive.alarmPriorities.v1'
function load(): PriorityTable {
  try {
    if (typeof localStorage === 'undefined') return defaultPriorities()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPriorities()
    const merged = { ...defaultPriorities() }
    const parsed = JSON.parse(raw) as Partial<PriorityTable>
    for (const cls of PRIORITY_CLASSES) if (parsed[cls]) merged[cls] = { ...merged[cls], ...parsed[cls] }
    return priorityTableErrors(merged).length ? defaultPriorities() : merged
  } catch {
    return defaultPriorities()
  }
}

interface PrioritiesState {
  priorities: PriorityTable
  /** Apply a change to one priority class; returns an error or null. The caller supplies the key check. */
  setPriority: (cls: PriorityClass, patch: Partial<PriorityConfig>) => string | null
  reset: () => void
  reload: () => void
}

function commit(table: PriorityTable): void {
  current = table
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(table))
  } catch {
    /* storage unavailable: the table simply does not persist */
  }
}

export const useAlarmPriorities = create<PrioritiesState>((set, get) => {
  current = load()
  return {
    priorities: current,
    setPriority: (cls, patch) => {
      if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure alarm priority ${cls}`)) return 'Requires the Can Configure key'
      if (cls === 'LOG' && patch.value !== undefined && patch.value !== LOG_RANK) return 'The log-only level is fixed at 3'
      const next: PriorityTable = { ...get().priorities, [cls]: { ...get().priorities[cls], ...patch } }
      const errors = priorityTableErrors(next)
      if (errors.length) return errors[0]
      commit(next)
      set({ priorities: next })
      return null
    },
    reset: () => { const table = defaultPriorities(); commit(table); set({ priorities: table }) },
    reload: () => { current = load(); set({ priorities: current }) }
  }
})

// --- runtime policy ---------------------------------------------------------

/**
 * Apply the per-priority acknowledgement rules to a freshly reconciled alarm list.
 * Log-only alarms behave as event records: acknowledged on activation and removed on return to normal.
 */
export function applyPriorityPolicy(
  previous: readonly ActiveAlarm[], next: ActiveAlarm[], time: number, table: PriorityTable = current
): { alarms: ActiveAlarm[]; entries: EventLogEntry[] } {
  const before = new Map(previous.map((a) => [a.id, a]))
  const entries: EventLogEntry[] = []
  const alarms: ActiveAlarm[] = []
  for (const alarm of next) {
    const cfg = table[priorityClassOf(alarm)]
    const isNew = alarm.active && !before.get(alarm.id)?.active
    if (!alarm.active && cfg.autoAckInactive) {
      entries.push({ id: `${alarm.id}-autoack-rtn-${time}`, time, category: 'ACK', tag: alarm.moduleTag,
        description: `${alarm.label} alarm automatically acknowledged on return to normal`, user: 'SYSTEM', priority: alarm.priority })
      continue
    }
    if (isNew && cfg.autoAckNew && !alarm.acknowledged) {
      entries.push({ id: `${alarm.id}-autoack-${time}`, time, category: 'ACK', tag: alarm.moduleTag,
        description: `${alarm.label} alarm automatically acknowledged when detected`, user: 'SYSTEM', priority: alarm.priority })
      alarms.push({ ...alarm, acknowledged: true, timeLast: time })
      continue
    }
    alarms.push(alarm)
  }
  return { alarms, entries }
}

/** A banner entry stands for one alarm, the highest-ranked one of its module or unit when the priority collapses them. */
export function collapseBanner<T extends ActiveAlarm>(
  alarms: readonly T[], rank: (a: T) => number, unitOf: (a: T) => string | undefined, table: PriorityTable = current
): T[] {
  const chosen = new Map<string, T>()
  const out: T[] = []
  for (const a of alarms) {
    const mode = table[priorityClassOf(a)].bannerShows
    const key = mode === 'MODULE' ? `M:${a.moduleTag}` : mode === 'UNIT' ? `U:${unitOf(a) ?? `M:${a.moduleTag}`}` : null
    if (key === null) { out.push(a); continue }
    const best = chosen.get(key)
    if (!best) { chosen.set(key, a); continue }
    if (rank(a) > rank(best)) chosen.set(key, a)
  }
  return [...out, ...chosen.values()]
}

/** Audible alarms: the wave file of the highest-priority unacknowledged class, or null when it is silenced. */
export function audibleWave(alarms: readonly ActiveAlarm[], table: PriorityTable = current): { cls: PriorityClass; wave: string } | null {
  for (const cls of ['CRITICAL', 'WARNING', 'ADVISORY'] as PriorityClass[]) {
    if (alarms.some((a) => a.active && !a.acknowledged && priorityClassOf(a) === cls)) {
      const wave = table[cls].waveFile
      return wave === SILENT_WAVE ? null : { cls, wave }
    }
  }
  return null
}
