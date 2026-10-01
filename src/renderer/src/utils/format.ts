import type { AnyModule, ActiveAlarm, AlarmPriority, PidModule } from '../engine/types'

export function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

const PRIO_RANK: Record<AlarmPriority, number> = {
  CRITICAL: 3,
  WARNING: 2,
  ADVISORY: 1
}

export function priorityRank(p: AlarmPriority): number {
  return PRIO_RANK[p]
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
