import type { AnyModule, ActiveAlarm, AlarmPriority, PidModule, DcState } from '../engine/types'

export function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

// DeltaV default alarm priority numeric values (CRITICAL 15 / WARNING 11 / ADVISORY 7).
const PRIO_RANK: Record<AlarmPriority, number> = {
  CRITICAL: 15,
  WARNING: 11,
  ADVISORY: 7
}

export function priorityRank(p: AlarmPriority): number {
  return PRIO_RANK[p]
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
  const pr = PRIO_RANK[b.priority] - PRIO_RANK[a.priority]
  if (pr !== 0) return pr
  return b.time - a.time
}

/** Highest-priority ACTIVE alarm for a given module tag, or null. */
export function moduleAlarm(tag: string, alarms: ActiveAlarm[]): ActiveAlarm | null {
  let best: ActiveAlarm | null = null
  for (const a of alarms) {
    if (a.moduleTag !== tag || !a.active) continue
    if (!best || PRIO_RANK[a.priority] > PRIO_RANK[best.priority]) best = a
  }
  return best
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
