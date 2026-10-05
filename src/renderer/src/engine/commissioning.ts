import { controllerIsDown, isValidControllerTag, MAX_CONTROLLER_DESCRIPTION_LENGTH, type Controller, type HardwareState } from './hardware'
import { reconcileAlarm } from './simulate'
import type { ActiveAlarm } from './types'

/** DV-09 pp57-62 controller commissioning: the Properties dialog, placeholders and hardware alarms. */
export interface CommissionProperties {
  /** User-defined name: at most 16 characters, at least one letter, may contain $, - or _. */
  name: string
  description: string
  /** Plant area for alarms and events of the node and its subordinate devices; null leaves it unassigned. */
  area: string | null
  /** Enable System Hardware Alarms. */
  hardwareAlarms: boolean
  /** Enable network redundancy for this node. */
  networkRedundant: boolean
  /** Show integrity error when not in time sync. */
  timeSyncIntegrity: boolean
  /** Node is redundant; unavailable on simplex hardware. */
  redundant: boolean
}

export interface CommissionContext {
  /** Names already used by other controllers (the controller being commissioned excluded). */
  otherControllers: string[]
  areas: string[]
  simplexOnly: boolean
}

export function defaultCommissionProperties(c: Controller, area: string | null): CommissionProperties {
  return { name: c.tag, description: c.description, area, hardwareAlarms: !!c.hardwareAlarms, networkRedundant: c.networkRedundant,
    timeSyncIntegrity: !!c.timeSyncIntegrity, redundant: c.redundant && !c.simplexOnly }
}

/** Every reason the dialog cannot be accepted, in field order; empty when valid. */
export function commissionPropertiesErrors(p: CommissionProperties, ctx: CommissionContext): string[] {
  const out: string[] = []
  if (!isValidControllerTag(p.name.trim())) out.push('Name must have at most 16 letters, digits, $, - or _, with at least one letter')
  else if (ctx.otherControllers.some((n) => n.toLowerCase() === p.name.trim().toLowerCase())) out.push(`A controller named ${p.name.trim()} already exists`)
  if (p.description.trim().length > MAX_CONTROLLER_DESCRIPTION_LENGTH) out.push(`Description must have at most ${MAX_CONTROLLER_DESCRIPTION_LENGTH} characters`)
  if (p.area !== null && !ctx.areas.includes(p.area)) out.push(`Area ${p.area} does not exist`)
  if (p.redundant && ctx.simplexOnly) out.push('A simplex controller cannot be configured as redundant')
  return out
}

/** Placeholders are named slots on the Control Network that a decommissioned controller can be dropped onto. */
export interface Placeholder { name: string; description: string }

export function placeholderErrors(name: string, description: string, hw: HardwareState): string[] {
  const out: string[] = []
  const n = name.trim()
  if (!isValidControllerTag(n)) out.push('Placeholder name must have at most 16 letters, digits, $, - or _, with at least one letter')
  else if (Object.keys(hw.controllers).some((c) => c.toLowerCase() === n.toLowerCase())) out.push(`A controller named ${n} already exists`)
  else if (Object.keys(hw.placeholders ?? {}).some((c) => c.toLowerCase() === n.toLowerCase())) out.push(`A placeholder named ${n} already exists`)
  if (description.trim().length > MAX_CONTROLLER_DESCRIPTION_LENGTH) out.push(`Description must have at most ${MAX_CONTROLLER_DESCRIPTION_LENGTH} characters`)
  return out
}

/** How many places other than the controller's own record still refer to its name; renaming is only safe at zero. */
export function controllerReferenceCount(state: { hardware: HardwareState } & Record<string, unknown>, tag: string): number {
  const { controllers, controllerAreas, placeholders, ...rest } = state.hardware
  void controllers; void controllerAreas; void placeholders
  const needle = JSON.stringify(tag)
  const sources: unknown[] = [rest, state.modules, state.moduleLifecycle, state.pidLifecycle, state.deviceLifecycle, state.sfcLifecycle]
  let count = 0
  for (const source of sources) {
    const text = JSON.stringify(source ?? {})
    let at = text.indexOf(needle)
    while (at !== -1) { count++; at = text.indexOf(needle, at + needle.length) }
  }
  return count
}

// --- System hardware alarms -------------------------------------------------

export type HardwareAlarmKind = 'FAILED' | 'STANDBY' | 'TIME_SYNC'
export const HARDWARE_ALARM_LABEL: Record<HardwareAlarmKind, string> = {
  FAILED: 'CONTROLLER FAILED', STANDBY: 'STANDBY NOT AVAILABLE', TIME_SYNC: 'TIME SYNC INTEGRITY'
}
export const HARDWARE_ALARM_KINDS: HardwareAlarmKind[] = ['FAILED', 'STANDBY', 'TIME_SYNC']
export const hardwareAlarmId = (tag: string, kind: HardwareAlarmKind): string => `HWALM.${tag}.${kind}`
export const isHardwareAlarm = (alarm: Pick<ActiveAlarm, 'id'>): boolean => alarm.id.startsWith('HWALM.')

/** Which hardware conditions are true for a commissioned or powered controller, and whether their alarm switch is on. */
export function hardwareAlarmConditions(c: Controller): Record<HardwareAlarmKind, { enabled: boolean; tripped: boolean }> {
  const failed = c.powerDownAt !== null || (c.commissioned && controllerIsDown(c))
  const standbyLost = c.commissioned && c.redundant && !failed && (c.primary === 'FAILED' || c.secondary === 'FAILED')
  return {
    FAILED: { enabled: !!c.hardwareAlarms, tripped: failed },
    STANDBY: { enabled: !!c.hardwareAlarms, tripped: standbyLost },
    TIME_SYNC: { enabled: !!c.timeSyncIntegrity, tripped: c.commissioned && c.powerDownAt === null && c.timeSynced === false }
  }
}

/** The area hardware alarms belong to: the controller's assigned area. */
export function hardwareAlarmArea(hw: HardwareState, controllerTag: string): string | undefined {
  return hw.controllerAreas?.[controllerTag]
}

/** Update hardware alarms in place like the other reconcilers; disabled or deleted sources remove their alarms. */
export function reconcileHardwareAlarms(alarms: ActiveAlarm[], hw: HardwareState, now: number): void {
  const live = new Set<string>()
  for (const c of Object.values(hw.controllers)) {
    const conditions = hardwareAlarmConditions(c)
    for (const kind of HARDWARE_ALARM_KINDS) {
      const id = hardwareAlarmId(c.tag, kind)
      const { enabled, tripped } = conditions[kind]
      if (!enabled) continue
      live.add(id)
      reconcileAlarm(alarms, c.tag, c.description || c.tag,
        { type: 'CUSTOM', label: HARDWARE_ALARM_LABEL[kind], priority: kind === 'FAILED' ? 'CRITICAL' : 'WARNING', rank: kind === 'FAILED' ? 12 : 8, enabled: true },
        tripped, tripped ? 1 : 0, '', now, id, `HARDWARE:${kind}`)
    }
  }
  for (let i = alarms.length - 1; i >= 0; i--) if (isHardwareAlarm(alarms[i]) && !live.has(alarms[i].id)) alarms.splice(i, 1)
}
