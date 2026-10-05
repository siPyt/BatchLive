import { MAX_COLD_RESTART_MINUTES } from './hardware'

/** DV-09 controller Cold Restart (Explorer: CTLR > Properties > Controller). The stored value is minutes; 0 disables. */
export type ColdRestartMode = 'DISABLED' | 'ALWAYS_ENABLED' | 'WITHIN_LIMIT'

export const COLD_RESTART_MODE_LABEL: Record<ColdRestartMode, string> = {
  DISABLED: 'Always Disabled',
  ALWAYS_ENABLED: 'Always Enabled (maximum time)',
  WITHIN_LIMIT: 'Enabled Within A Time Limit'
}

export const MAX_DAYS = 30
export const MAX_HOURS = 23
export const MAX_MINUTES_PART = 59
/** The manual recommends at least two minutes for a time limit. */
export const RECOMMENDED_MIN_MINUTES = 2

export interface ColdRestartParts { days: number; hours: number; minutes: number }

export function splitColdRestart(totalMinutes: number): ColdRestartParts {
  return { days: Math.floor(totalMinutes / 1440), hours: Math.floor((totalMinutes % 1440) / 60), minutes: totalMinutes % 60 }
}

export function coldRestartMode(totalMinutes: number): ColdRestartMode {
  return totalMinutes <= 0 ? 'DISABLED' : totalMinutes >= MAX_COLD_RESTART_MINUTES ? 'ALWAYS_ENABLED' : 'WITHIN_LIMIT'
}

/** Convert the three course selectors to the stored minutes, or an error naming the offending field. */
export function coldRestartFromSelectors(mode: ColdRestartMode, parts: ColdRestartParts): { minutes: number } | { error: string } {
  if (mode === 'DISABLED') return { minutes: 0 }
  if (mode === 'ALWAYS_ENABLED') return { minutes: MAX_COLD_RESTART_MINUTES }
  const whole = (v: number, max: number): boolean => Number.isInteger(v) && v >= 0 && v <= max
  if (!whole(parts.days, MAX_DAYS)) return { error: `Days must be a whole number from 0 to ${MAX_DAYS}` }
  if (!whole(parts.hours, MAX_HOURS)) return { error: `Hours must be a whole number from 0 to ${MAX_HOURS}` }
  if (!whole(parts.minutes, MAX_MINUTES_PART)) return { error: `Minutes must be a whole number from 0 to ${MAX_MINUTES_PART}` }
  const minutes = parts.days * 1440 + parts.hours * 60 + parts.minutes
  if (minutes > MAX_COLD_RESTART_MINUTES) return { error: `The time limit cannot exceed ${MAX_DAYS} days 23 hours 59 minutes` }
  return { minutes }
}

export function describeColdRestart(totalMinutes: number): string {
  const mode = coldRestartMode(totalMinutes)
  if (mode !== 'WITHIN_LIMIT') return COLD_RESTART_MODE_LABEL[mode]
  const p = splitColdRestart(totalMinutes)
  return `Within ${p.days} d ${p.hours} h ${p.minutes} min` +
    (totalMinutes < RECOMMENDED_MIN_MINUTES ? ' (the manual recommends at least 2 minutes)' : '')
}

export interface ColdRestartDecision { restart: boolean; reason: string }

/** Power returning within (less than or equal to) the limit commissions and downloads the controller from its non-volatile memory. */
export function coldRestartDecision(configuredMinutes: number, outageMinutes: number): ColdRestartDecision {
  if (configuredMinutes <= 0) return { restart: false, reason: 'Cold restart is Always Disabled' }
  if (outageMinutes <= configuredMinutes) {
    return { restart: true, reason: coldRestartMode(configuredMinutes) === 'ALWAYS_ENABLED' ?
      'Cold restart is Always Enabled' : 'Power returned within the cold restart time limit' }
  }
  return { restart: false, reason: 'Power returned after the cold restart time limit' }
}
