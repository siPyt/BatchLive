import type { AnalogIndicator, AnyModule, DiscreteInput, MotorModule, PidModule, ValveModule } from './types'
import { pidIo, samplePidInput } from './analogStrategy'
import { remoteHostOf, writeHostSignal } from './remoteHost'

/** Process Waste Neutralization (3WT-0001) process model.
 *
 * Equalization tank -> P01 -> XV01 (diverter: RECIRC back to the equalization tank / TRANSFER to the neutralization
 * tank) -> neutralization tank (pH loop AIC002 doses acid on AO1 / base on AO2 through its split-range output)
 * -> P02 loop -> XV05 (diverter: RECIRC back to the tank / DRAIN to the plant drain).
 *
 * The plant is a digital twin of the operator screens, so it starts in the HOLD state those screens show: pumps
 * stopped, diverters in their passive (RECIRC) position, inlets closed, AIC002 in local override tracking 50 %.
 * Rates below are provisional modelling constants, not plant data. */
export const PW = {
  pid: '3WT-0001-AIC002',
  eqLevel: '3WT-0001-LI001',
  neutLevel: '3WT-0001-LI002',
  tankPhAvg: '3WT-0001-AI02AVG',
  effluentPh: '3WT-0001-AI001',
  effluentTemp: '3WT-0001-TI001',
  transferPump: '3WT-0001-P01',
  recircPump: '3WT-0001-P02',
  wasteInlet: '3WT-0001-XV010',
  cipInlet: '3CIP-3200-XV025',
  transferValve: '3WT-0001-XV01',
  drainValve: '3WT-0001-XV05',
  baseDrumLow: '3WT-0001-LAL001',
  acidDrumLow: '3WT-0001-LAL002',
  transferLowFlow: '3WT-0001-FAL001',
  drainLowFlow: '3WT-0001-FAL002'
} as const

/** Condition, switch and tracking modules that the device and loop logic read (visible in Control Studio). */
export const PW_LOGIC_TAGS = [
  '3WT-0001-LAHH001', '3WT-0001-LAHH002', '3WT-0001-LALL001', '3WT-0001-LALL002', '3WT-0001-PHLO', '3WT-0001-PHHI',
  '3WT-0001-CIPDLY', '3WT-0001-AT1C1', '3WT-0001-AT1C2', '3WT-0001-AT1C3', '3WT-0001-AT1OR1', '3WT-0001-AT1OR2'
] as const

/** Every default-project tag that belongs to the area (the baseline cannot be deleted). */
export const PWASTE_TAGS: readonly string[] = [...Object.values(PW), ...PW_LOGIC_TAGS]

/** What the NEUT phase writes to AIC002 through RCAS_IN / ROUT_IN (the values on the plant faceplate). */
export const PW_HOST = { rcasSp: 8.0, routOut: 50 } as const

/** Tags whose values this model owns (the generic closed-loop simulation skips them). */
export const PWASTE_PHYSICS_TAGS = new Set<string>([
  PW.pid, PW.eqLevel, PW.neutLevel, PW.tankPhAvg, PW.effluentPh, PW.transferLowFlow, PW.drainLowFlow
])

const RATE = {
  wasteInflow: 0.4, // % of equalization level per second, mean
  wasteSwing: 0.1,
  wasteSwingPeriodSec: 600,
  cipInflow: 0.3,
  transfer: 0.4, // % per second moved equalization -> neutralization
  drain: 0.4,
  dosePhPerSec: 0.3, // pH change per second at 100 % AO with the P02 loop mixing
  unmixedFactor: 0.3,
  avgFilterSec: 60,
  effluentLagSec: 15
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function processWasteComplete(modules: Record<string, AnyModule>): boolean {
  return PWASTE_TAGS.every(tag => !!modules[tag]) &&
    modules[PW.pid].type === 'PID' &&
    [PW.eqLevel, PW.neutLevel, PW.tankPhAvg, PW.effluentPh, PW.effluentTemp].every(tag => modules[tag].type === 'AI') &&
    [PW.transferPump, PW.recircPump].every(tag => modules[tag].type === 'MOTOR') &&
    [PW.wasteInlet, PW.cipInlet, PW.transferValve, PW.drainValve].every(tag => modules[tag].type === 'VALVE') &&
    [PW.baseDrumLow, PW.acidDrumLow, PW.transferLowFlow, PW.drainLowFlow].every(tag => modules[tag].type === 'DI')
}

/** pH of the waste held in the equalization tank: a slowly wandering acidic/basic load. */
export function influentPh(timeMs: number): number {
  const t = timeMs / 1000
  return clamp(7 + 2.5 * Math.sin((2 * Math.PI * t) / 1200) + Math.sin((2 * Math.PI * t) / 310), 0, 14)
}

export interface ProcessWasteFlows {
  wasteIn: number
  cipIn: number
  /** Equalization -> neutralization (P01 running and XV01 in TRANSFER). */
  transfer: number
  /** P01 delivering to the XV01 diverter in either position (what FAL001 senses). */
  transferLine: boolean
  /** Neutralization -> drain (P02 running and XV05 in DRAIN). */
  drain: number
  /** P02 loop flowing through the XV05 diverter in either position (what FAL002 senses). */
  drainLine: boolean
}

export function processWasteFlows(modules: Record<string, AnyModule>, timeMs: number): ProcessWasteFlows {
  const eq = modules[PW.eqLevel] as AnalogIndicator
  const neut = modules[PW.neutLevel] as AnalogIndicator
  const p01 = modules[PW.transferPump] as MotorModule
  const p02 = modules[PW.recircPump] as MotorModule
  const xv010 = modules[PW.wasteInlet] as ValveModule
  const xv025 = modules[PW.cipInlet] as ValveModule
  const xv01 = modules[PW.transferValve] as ValveModule
  const xv05 = modules[PW.drainValve] as ValveModule
  const phase = (2 * Math.PI * (timeMs / 1000)) / RATE.wasteSwingPeriodSec
  const transferLine = p01.running && eq.pv > 0
  const drainLine = p02.running && neut.pv > 0
  return {
    wasteIn: xv010.open && eq.pv < 100 ? RATE.wasteInflow - RATE.wasteSwing * Math.cos(phase) : 0,
    cipIn: xv025.open && eq.pv < 100 ? RATE.cipInflow : 0,
    transfer: transferLine && xv01.open && neut.pv < 100 ? RATE.transfer : 0,
    transferLine,
    drain: drainLine && xv05.open ? RATE.drain * clamp(neut.pv / 20, 0, 1) : 0,
    drainLine
  }
}

export function stepProcessWaste(
  modules: Record<string, AnyModule>,
  dt: number,
  timeMs: number,
  boundInput: (tag: string) => boolean,
  badPvTags: ReadonlySet<string>
): void {
  const eq = modules[PW.eqLevel] as AnalogIndicator
  const neut = modules[PW.neutLevel] as AnalogIndicator
  const avg = modules[PW.tankPhAvg] as AnalogIndicator
  const effluent = modules[PW.effluentPh] as AnalogIndicator
  const aic = modules[PW.pid] as PidModule
  const p02 = modules[PW.recircPump] as MotorModule
  const baseLow = modules[PW.baseDrumLow] as DiscreteInput
  const acidLow = modules[PW.acidDrumLow] as DiscreteInput
  const io = pidIo(aic)

  const flows = processWasteFlows(modules, timeMs)
  const eqLevel = clamp(eq.pv + (flows.wasteIn + flows.cipIn - flows.transfer) * dt, 0, 100)
  const neutLevel = clamp(neut.pv + (flows.transfer - flows.drain) * dt, 0, 100)

  // AO1 (acid) is active below the 50 % dead band, AO2 (base) above it; an empty drum delivers nothing.
  const acidDose = acidLow.state ? 0 : clamp(io.ao.out, 0, 100) / 100
  const baseDose = baseLow.state ? 0 : clamp(io.ao2?.out ?? 0, 0, 100) / 100
  const mix = p02.running ? 1 : RATE.unmixedFactor
  const dilution = flows.transfer / Math.max(neutLevel, 5)
  const ph = clamp(io.ai.raw + (dilution * (influentPh(timeMs) - io.ai.raw) +
    (baseDose - acidDose) * RATE.dosePhPerSec * mix) * dt, 0, 14)

  if (!boundInput(aic.tag)) samplePidInput(aic, ph + (Math.random() - 0.5) * 0.01, badPvTags.has(aic.tag))
  const write = (m: AnalogIndicator, value: number): void => {
    if (!boundInput(m.tag) && !m.pvBad) m.pv = clamp(value, m.pvMin, m.pvMax)
  }
  write(eq, eqLevel)
  write(neut, neutLevel)
  write(avg, avg.pv + (ph - avg.pv) * clamp(dt / RATE.avgFilterSec, 0, 1))
  if (flows.drain > 0) write(effluent, effluent.pv + (ph - effluent.pv) * clamp(dt / RATE.effluentLagSec, 0, 1))

  // FAL001 / FAL002 low-flow switches: in alarm (No Flow) while the pump is not delivering to the diverter.
  ;(modules[PW.transferLowFlow] as DiscreteInput).state = !flows.transferLine
  ;(modules[PW.drainLowFlow] as DiscreteInput).state = !flows.drainLine

  // The NEUT phase keeps writing RCAS_IN / ROUT_IN, so the host data stays fresh (the plant faceplate shows 8.0 / 50.0).
  aic.remote = writeHostSignal(writeHostSignal(remoteHostOf(aic), 'RCAS_IN', PW_HOST.rcasSp), 'ROUT_IN', PW_HOST.routOut)
}
