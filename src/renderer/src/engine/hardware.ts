// ---------------------------------------------------------------------------
// DeltaV Physical Network: Controller(s) -> I/O Carrier (CIOC) -> CHARM
// Baseplate -> CHARM (one field signal per CHARM, auto-characterized by
// type). Mirrors the "Physical Network" side of DeltaV Explorer, as distinct
// from the "Control Strategies" (Area/Module) side.
// ---------------------------------------------------------------------------

export type CharmType = 'AI' | 'AI_HART' | 'AO' | 'DI' | 'DO' | 'RTD' | 'TC'

export const CHARM_TYPE_LABEL: Record<CharmType, string> = {
  AI: 'Analog Input',
  AI_HART: 'Analog Input, HART',
  AO: 'Analog Output',
  DI: 'Discrete Input',
  DO: 'Discrete Output',
  RTD: 'RTD Temperature',
  TC: 'Thermocouple'
}

export type CharmStatus = 'GOOD' | 'BAD' | 'EMPTY'

/** Which field of the bound Control Module this CHARM's signal drives/reads. */
export type BoundField = 'PV' | 'OUT' | 'CMD'

export interface CharmChannel {
  /** Terminal number within the baseplate, 1-8. */
  slot: number
  /** null = empty slot, no CHARM installed. */
  type: CharmType | null
  boundTag?: string
  boundField?: BoundField
  /** Physically pulled (simulated loose/removed CHARM — a common field fault). */
  pulled: boolean
}

export interface CharmBaseplate {
  id: string
  carrierId: string
  channels: CharmChannel[] // 8 slots
}

export interface IoCarrier {
  id: string
  controllerTag: string
  baseplateIds: string[]
}

export type RedundancyRole = 'ACTIVE' | 'STANDBY' | 'FAILED' | 'N/A'

export interface Controller {
  tag: string
  description: string
  redundant: boolean
  primary: RedundancyRole
  secondary: RedundancyRole
  /** Macrocycle scan time, milliseconds. */
  scanTimeMs: number
  cpuLoadPct: number
  carrierIds: string[]
}

export interface HardwareState {
  controllers: Record<string, Controller>
  carriers: Record<string, IoCarrier>
  baseplates: Record<string, CharmBaseplate>
}

function channel(slot: number, type: CharmType | null, boundTag?: string, boundField?: BoundField): CharmChannel {
  return { slot, type, boundTag, boundField, pulled: false }
}

/** Seed Physical Network wiring every built-in Control Module's I/O to a CHARM. */
export function makeDefaultHardware(): HardwareState {
  const cb01: CharmBaseplate = {
    id: 'CB-01',
    carrierId: 'CIOC-01',
    channels: [
      channel(1, 'AI_HART', 'FIC-101', 'PV'),
      channel(2, 'AO', 'FIC-101', 'OUT'),
      channel(3, 'AI_HART', 'LIC-101', 'PV'),
      channel(4, 'AO', 'LIC-101', 'OUT'),
      channel(5, 'AI_HART', 'LIC-201', 'PV'),
      channel(6, 'AO', 'LIC-201', 'OUT'),
      channel(7, 'RTD', 'TIC-201', 'PV'),
      channel(8, 'AO', 'TIC-201', 'OUT')
    ]
  }
  const cb02: CharmBaseplate = {
    id: 'CB-02',
    carrierId: 'CIOC-01',
    channels: [
      channel(1, 'AI_HART', 'PIC-301', 'PV'),
      channel(2, 'AO', 'PIC-301', 'OUT'),
      channel(3, 'AI', 'AT-301', 'PV'),
      channel(4, 'RTD', 'TI-101', 'PV'),
      channel(5, 'DI', 'LSH-101', 'PV'),
      channel(6, 'DO', 'P-101', 'CMD'),
      channel(7, 'DO', 'P-201', 'CMD'),
      channel(8, 'DO', 'XV-101', 'CMD')
    ]
  }
  const cb03: CharmBaseplate = {
    id: 'CB-03',
    carrierId: 'CIOC-01',
    channels: [
      channel(1, 'DO', 'XV-201', 'CMD'),
      channel(2, 'DO', 'HS-201', 'CMD'),
      channel(3, null),
      channel(4, null),
      channel(5, null),
      channel(6, null),
      channel(7, null),
      channel(8, null)
    ]
  }

  return {
    controllers: {
      'CTLR-01': {
        tag: 'CTLR-01',
        description: 'Reactor Train Controller',
        redundant: true,
        primary: 'ACTIVE',
        secondary: 'STANDBY',
        scanTimeMs: 100,
        cpuLoadPct: 38,
        carrierIds: ['CIOC-01']
      }
    },
    carriers: {
      'CIOC-01': { id: 'CIOC-01', controllerTag: 'CTLR-01', baseplateIds: ['CB-01', 'CB-02', 'CB-03'] }
    },
    baseplates: { 'CB-01': cb01, 'CB-02': cb02, 'CB-03': cb03 }
  }
}

/** Empty project: no Physical Network hardware configured. */
export function makeBlankHardware(): HardwareState {
  return { controllers: {}, carriers: {}, baseplates: {} }
}

/** True if the owning controller cannot service I/O (simplex failed, or both legs of a redundant pair down). */
export function controllerIsDown(c: Controller): boolean {
  return c.redundant ? c.primary === 'FAILED' && c.secondary === 'FAILED' : c.primary === 'FAILED'
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Cosmetic scan-time/CPU-load jitter for the active leg of each controller. */
export function advanceControllers(controllers: Record<string, Controller>, dt: number): Record<string, Controller> {
  const next: Record<string, Controller> = {}
  for (const tag of Object.keys(controllers)) {
    const c = controllers[tag]
    if (controllerIsDown(c)) {
      next[tag] = { ...c, scanTimeMs: 0, cpuLoadPct: 0 }
      continue
    }
    const jitter = (amp: number): number => (Math.random() - 0.5) * 2 * amp * Math.min(dt, 1)
    next[tag] = {
      ...c,
      scanTimeMs: clamp(c.scanTimeMs + jitter(2), 95, 115),
      cpuLoadPct: clamp(c.cpuLoadPct + jitter(1.5), 28, 55)
    }
  }
  return next
}

/** Resolve whether a bound Control Module's PV or CMD channel is currently Bad. */
export function computeBadTags(hw: HardwareState): { badPvTags: Set<string>; badCmdTags: Set<string> } {
  const badPvTags = new Set<string>()
  const badCmdTags = new Set<string>()
  for (const bp of Object.values(hw.baseplates)) {
    const carrier = hw.carriers[bp.carrierId]
    const ctrl = carrier ? hw.controllers[carrier.controllerTag] : undefined
    const down = ctrl ? controllerIsDown(ctrl) : false
    for (const ch of bp.channels) {
      if (!ch.boundTag || !ch.type) continue
      if (!ch.pulled && !down) continue
      if (ch.boundField === 'PV') badPvTags.add(ch.boundTag)
      if (ch.boundField === 'CMD') badCmdTags.add(ch.boundTag)
    }
  }
  return { badPvTags, badCmdTags }
}
