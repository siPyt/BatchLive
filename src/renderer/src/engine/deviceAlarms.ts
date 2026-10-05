import { controllerIsDown, type HardwareState } from './hardware'
import { reconcileAlarm } from './simulate'
import {
  DEVICE_ALARM_KINDS,
  H1_PORT_IDS,
  catalogEntry,
  deviceComm,
  type DeviceAlarmKind,
  type FfDevice,
  type H1Card
} from './fieldbus'
import type { ActiveAlarm, AlarmPriority, AnyModule } from './types'

// ---------------------------------------------------------------------------
// DV09-121..126 device alarms (PlantWeb alerts) for FOUNDATION fieldbus
// devices: Not Communicating, Abnormal (off by default), Failed, Maintenance
// and Advisory. They are device-state alarms, kept separate from process PV
// alarms: category DEVICE, their own id space, numeric priority 4-15, and
// their own banner threshold.
// ---------------------------------------------------------------------------

export const DEVICE_ALARM_LABEL: Record<DeviceAlarmKind, string> = {
  NOT_COMM: 'NOT COMMUNICATING',
  ABNORMAL: 'ABNORMAL',
  FAILED: 'FAILED',
  MAINTENANCE: 'MAINTENANCE',
  ADVISORY: 'ADVISORY'
}

export function deviceAlarmId(tag: string, kind: DeviceAlarmKind): string {
  return `DEVALM.${tag}.${kind}`
}

export function isDeviceAlarm(alarm: Pick<ActiveAlarm, 'id'>): boolean {
  return alarm.id.startsWith('DEVALM.')
}

/** The priority class a numeric rank belongs to (15 critical, 11 warning, 7 advisory buckets). */
export function rankPriority(rank: number): AlarmPriority {
  return rank >= 12 ? 'CRITICAL' : rank >= 8 ? 'WARNING' : 'ADVISORY'
}

export function deviceAlarmRankError(rank: number): string | null {
  return Number.isInteger(rank) && rank >= 4 && rank <= 15 ? null : 'Device alarm priority must be a whole number from 4 to 15'
}

export function findFfDevice(hw: HardwareState, tag: string): { card: H1Card; device: FfDevice } | undefined {
  for (const card of Object.values(hw.h1Cards ?? {})) {
    for (const portId of H1_PORT_IDS) {
      const device = card.ports[portId].devices[tag]
      if (device) return { card, device }
    }
  }
  return undefined
}

/** The area a device alarm belongs to: the controller's assigned area, or the area of the chosen module. */
export function deviceAlarmArea(hw: HardwareState, modules: Record<string, AnyModule>, tag: string): string | undefined {
  const found = findFfDevice(hw, tag)
  if (!found) return undefined
  const { card, device } = found
  if (device.alarms.areaMode === 'MODULE') return device.alarms.areaModule ? modules[device.alarms.areaModule]?.area : undefined
  return hw.controllerAreas?.[card.controllerTag]
}

/** Area of any alarm: a module's area, or the resolved area of a device alarm. */
export function alarmArea(alarm: ActiveAlarm, modules: Record<string, AnyModule>, hw: HardwareState): string | undefined {
  return isDeviceAlarm(alarm) ? deviceAlarmArea(hw, modules, alarm.moduleTag) : modules[alarm.moduleTag]?.area
}

export interface DeviceAlarmCondition {
  tripped: boolean
  /** Why an enabled alarm cannot trip right now (a prerequisite is missing). */
  blockedBy?: string
}

/** What the alert prerequisites and the device state say for one alarm kind. */
export function deviceAlarmCondition(card: H1Card, device: FfDevice, port: (typeof H1_PORT_IDS)[number], kind: DeviceAlarmKind, hw: HardwareState): DeviceAlarmCondition {
  const controller = hw.controllers[card.controllerTag]
  if (!card.deviceAlarms) return { tripped: false, blockedBy: 'Enable Device Alarms on the H1 card' }
  if (!card.downloaded) return { tripped: false, blockedBy: 'Download the H1 card' }
  if (!controller || controllerIsDown(controller) || card.cardFailed) return { tripped: false, blockedBy: 'The H1 card is not available' }
  if (!card.ports[port].enabled) return { tripped: false, blockedBy: 'The H1 port is disabled' }
  if (device.state !== 'COMMISSIONED') return { tripped: false, blockedBy: 'The device is not commissioned' }
  const runtime = card.runtime[port]
  const communicating = deviceComm(card, port, device)
  if (kind === 'NOT_COMM') {
    return { tripped: !communicating && (runtime.seen.includes(device.address) || runtime.cycle >= 30) }
  }
  if (!communicating) return { tripped: false, blockedBy: 'The device is not communicating' }
  if (!device.resource.features.reports) return { tripped: false, blockedBy: 'Alert reporting is disabled in the resource block' }
  const physical = card.field[device.deviceId as string]
  const flags = physical?.faults
  if (!flags) return { tripped: false }
  const tripped = kind === 'FAILED' ? flags.failed : kind === 'MAINTENANCE' ? flags.maintenance : kind === 'ADVISORY' ? flags.advisory : flags.abnormal
  return { tripped }
}

/** Evaluate every device alarm; returns nothing, the alarm list is updated in place like the other reconcilers. */
export function reconcileDeviceAlarms(alarms: ActiveAlarm[], hw: HardwareState, now: number): void {
  for (const card of Object.values(hw.h1Cards ?? {})) {
    for (const portId of H1_PORT_IDS) {
      for (const device of Object.values(card.ports[portId].devices)) {
        const entry = catalogEntry(device.catalogId)
        const desc = `${entry?.model ?? device.catalogId} · ${card.id}/${portId}`
        for (const kind of DEVICE_ALARM_KINDS) {
          const id = deviceAlarmId(device.tag, kind)
          const setting = device.alarms.settings[kind]
          if (!setting.enabled) {
            const index = alarms.findIndex((a) => a.id === id)
            if (index !== -1) alarms.splice(index, 1)
            continue
          }
          const { tripped } = deviceAlarmCondition(card, device, portId, kind, hw)
          reconcileAlarm(alarms, device.tag, desc,
            { type: 'CUSTOM', label: DEVICE_ALARM_LABEL[kind], priority: rankPriority(setting.rank), rank: setting.rank, enabled: true },
            tripped, tripped ? 1 : 0, '', now, id, `DEVICE:${kind}`)
          const alarm = alarms.find((a) => a.id === id)
          if (alarm && alarm.active && !alarm.acknowledged && device.alarms.reannunciate && entry?.reannunciation) {
            const last = alarm.lastAnnunciatedAt ?? alarm.time
            if (now - last >= device.alarms.reannounceSeconds * 1000) {
              alarm.repeats = (alarm.repeats ?? 0) + 1
              alarm.lastAnnunciatedAt = now
            }
          }
        }
      }
    }
  }
}

// --- banner thresholds (DV09-125/126) ---------------------------------------

export interface BannerThresholds {
  process: number
  device: number
}

/** Course defaults: the banner shows process alarms of priority above 3 and device alarms above 7. */
export const DEFAULT_BANNER_THRESHOLDS: BannerThresholds = { process: 3, device: 7 }

export function bannerThresholdError(t: BannerThresholds): string | null {
  for (const [label, value] of [['process', t.process], ['device', t.device]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 15) return `The ${label} banner threshold must be a whole number from 0 to 15`
  }
  return null
}

/** Strictly greater than: with the device threshold at 7 a priority-7 advisory stays off the banner. */
export function bannerVisible(alarm: ActiveAlarm, thresholds: BannerThresholds): boolean {
  const rank = alarm.rank ?? (alarm.priority === 'CRITICAL' ? 15 : alarm.priority === 'WARNING' ? 11 : 7)
  return rank > (isDeviceAlarm(alarm) ? thresholds.device : thresholds.process)
}

export const BANNER_THRESHOLDS_KEY = 'batchlive.alarmBanner.thresholds.v1'

/** The saved banner settings, applied when the application initializes; defaults when missing or invalid. */
export function loadBannerThresholds(): BannerThresholds {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(BANNER_THRESHOLDS_KEY)
    if (!raw) return { ...DEFAULT_BANNER_THRESHOLDS }
    const parsed = JSON.parse(raw) as Partial<BannerThresholds>
    const candidate = { process: Number(parsed.process), device: Number(parsed.device) }
    return bannerThresholdError(candidate) ? { ...DEFAULT_BANNER_THRESHOLDS } : candidate
  } catch {
    return { ...DEFAULT_BANNER_THRESHOLDS }
  }
}

export function saveBannerThresholds(t: BannerThresholds): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(BANNER_THRESHOLDS_KEY, JSON.stringify(t))
    return true
  } catch {
    return false
  }
}