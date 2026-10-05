import type { AnyModule } from './types'

/** Base module execution period in simulated seconds; a multiple of 1 means "execute on every base scan". */
export const BASE_SCAN_SEC = 1
export const SCAN_MULTIPLE_MIN = 1
export const SCAN_MULTIPLE_MAX = 255
export const EXECUTION_ORDER_MAX = 9999

export interface ModuleSchedule {
  /** Executes once per multiple x BASE_SCAN_SEC simulated seconds. */
  multiple: number
  /** Explicit execution position; smaller runs first, ahead of unordered modules. Null keeps dependency order. */
  order: number | null
  /** Simulated seconds accumulated since the last execution (runtime). */
  accum: number
}

export type ModuleScheduling = Record<string, ModuleSchedule>

export function validateScanMultiple(value: number): string | null {
  if (!Number.isInteger(value) || value < SCAN_MULTIPLE_MIN || value > SCAN_MULTIPLE_MAX)
    return `Scan multiple must be a whole number from ${SCAN_MULTIPLE_MIN} to ${SCAN_MULTIPLE_MAX}`
  return null
}

export function validateExecutionOrder(value: number | null): string | null {
  if (value === null) return null
  if (!Number.isInteger(value) || value < 0 || value > EXECUTION_ORDER_MAX)
    return `Execution order must be a whole number from 0 to ${EXECUTION_ORDER_MAX}, or blank for automatic order`
  return null
}

/** True when the schedule changes nothing (multiple 1, automatic order) and can be dropped. */
export function isDefaultSchedule(schedule: Pick<ModuleSchedule, 'multiple' | 'order'>): boolean {
  return schedule.multiple === 1 && schedule.order === null
}

/** Manually ordered modules run first in ascending order (ties keep dependency order); the rest keep dependency order. */
export function applyExecutionOrder(dependencyOrder: string[], scheduling: ModuleScheduling): string[] {
  const position = new Map(dependencyOrder.map((tag, index) => [tag, index]))
  const manual = dependencyOrder.filter(tag => scheduling[tag]?.order !== null && scheduling[tag]?.order !== undefined)
    .sort((a, b) => (scheduling[a].order as number) - (scheduling[b].order as number) || position.get(a)! - position.get(b)!)
  const manualSet = new Set(manual)
  return [...manual, ...dependencyOrder.filter(tag => !manualSet.has(tag))]
}

export interface ScanDecision {
  /** Whether the module's algorithm executes in this step. */
  run: boolean
  /** Elapsed simulated seconds the algorithm integrates over when it runs. */
  dt: number
  schedule: ModuleSchedule | undefined
}

/** Accumulate dt and decide whether a scheduled module is due; unscheduled or multiple-1 modules run every step. */
export function decideScan(schedule: ModuleSchedule | undefined, dt: number): ScanDecision {
  if (!schedule || schedule.multiple <= 1) return { run: true, dt, schedule }
  const accum = schedule.accum + dt
  if (accum + 1e-9 < schedule.multiple * BASE_SCAN_SEC) return { run: false, dt: 0, schedule: { ...schedule, accum } }
  return { run: true, dt: accum, schedule: { ...schedule, accum: 0 } }
}

/** Drop schedules for modules that no longer exist and defaults that change nothing. */
export function pruneScheduling(scheduling: ModuleScheduling, modules: Record<string, AnyModule>): ModuleScheduling {
  const next: ModuleScheduling = {}
  for (const [tag, schedule] of Object.entries(scheduling)) if (modules[tag] && !isDefaultSchedule(schedule)) next[tag] = schedule
  return next
}
