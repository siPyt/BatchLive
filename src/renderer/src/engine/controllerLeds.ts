import type { Controller } from './hardware'
import { controllerIsDown } from './hardware'

/** DV-09 pp54-56 controller indicators. */
export type LedColor = 'green' | 'red' | 'yellow'
export interface Led { id: string; label: string; color: LedColor; on: boolean }

export const FLASH_PERIOD_MS = 1000
export const YELLOW_LED_COUNT = 2
/** Yellow activity LEDs re-roll their state at this interval to look random. */
export const RANDOM_SLOT_MS = 250

/** Small deterministic hash so "random" yellow flashing is reproducible in tests and stable across renders. */
function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h ^ (h >>> 15)) >>> 0
}

/** True for the "on" half of a one-second flash cycle (on for the first 500 ms of each second). */
export function flashOn(timeMs: number): boolean {
  return Math.floor(timeMs / (FLASH_PERIOD_MS / 2)) % 2 === 0
}

export function randomFlash(tag: string, led: number, timeMs: number): boolean {
  return hash32(`${tag}:${led}:${Math.floor(timeMs / RANDOM_SLOT_MS)}`) % 2 === 0
}

export type ControllerIndicatorState = 'POWER_OFF' | 'DECOMMISSIONED' | 'IDENTIFY' | 'FAILED' | 'RUNNING'

export function indicatorState(c: Controller): ControllerIndicatorState {
  if (c.powerDownAt !== null) return 'POWER_OFF'
  if (c.identified) return 'IDENTIFY'
  if (!c.commissioned) return 'DECOMMISSIONED'
  return controllerIsDown(c) ? 'FAILED' : 'RUNNING'
}

/**
 * Decommissioned: Power ON, Error flashes at 1 s, Active/Standby OFF, yellow LEDs flash at random.
 * Identify (decommissioned or commissioned): Power ON, every other LED flashes at 1 s.
 * Running (not in the manual's text; stated as such in the UI): Error OFF, Active/Standby follows the redundancy role.
 */
export function controllerLeds(c: Controller, timeMs: number): Led[] {
  const state = indicatorState(c)
  const flash = flashOn(timeMs)
  const yellow = (on: (i: number) => boolean): Led[] =>
    Array.from({ length: YELLOW_LED_COUNT }, (_, i) => ({ id: `yellow${i + 1}`, label: `Activity ${i + 1}`, color: 'yellow' as const, on: on(i) }))
  const power = (on: boolean): Led => ({ id: 'power', label: 'Power', color: 'green', on })
  const error = (on: boolean): Led => ({ id: 'error', label: 'Error', color: 'red', on })
  const active = (on: boolean): Led => ({ id: 'active', label: 'Active/Standby', color: 'green', on })
  switch (state) {
    case 'POWER_OFF': return [power(false), error(false), active(false), ...yellow(() => false)]
    case 'IDENTIFY': return [power(true), error(flash), active(flash), ...yellow(() => flash)]
    case 'DECOMMISSIONED': return [power(true), error(flash), active(false), ...yellow((i) => randomFlash(c.tag, i, timeMs))]
    case 'FAILED': return [power(true), error(true), active(false), ...yellow(() => false)]
    case 'RUNNING': return [power(true), error(false), active(c.primary === 'ACTIVE'), ...yellow((i) => randomFlash(c.tag, i, timeMs))]
  }
}

export const INDICATOR_NOTE: Record<ControllerIndicatorState, string> = {
  POWER_OFF: 'No power: every LED is off.',
  DECOMMISSIONED: 'Decommissioned (manual p54): Power green ON, Error red flashing at one-second intervals, Active/Standby OFF, yellow LEDs flashing at random.',
  IDENTIFY: 'Identify state (manual p56): Power green ON, all other LEDs flash at one-second intervals.',
  FAILED: 'Controller failed: Error ON. (Failed-state LED pattern is not described in the course text.)',
  RUNNING: 'Commissioned and running: Error OFF, Active/Standby follows the redundancy role. (Running pattern is not described in the course text.)'
}
