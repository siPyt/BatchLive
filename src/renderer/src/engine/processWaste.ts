import type { AnalogIndicator, AnyModule, DiscreteInput, MotorModule, PidModule, ValveModule } from './types'
import { pidIo, samplePidInput } from './analogStrategy'

/** Process Waste Neutralization (3WT-0001) process model: equalization tank ->
 * transfer pump -> neutralization tank (pH loop dosing acid on AO1 / base on AO2)
 * -> drain. Tank level, pH and flow states live in the modules themselves; the
 * device interlock logic (plant.ts) decides which pumps/valves are available.
 * Rates are provisional modelling constants, not plant data. */
export const PW = {
  pid: '3WT-0001-AIC002',
  eqLevel: '3WT-0001-LI001',
  neutLevel: '3WT-0001-LI002',
  tankPhAvg: '3WT-0001-AI02AVG',
  effluentPh: '3WT-0001-AI001',
  transferPump: '3WT-0001-P01',
  recircPump: '3WT-0001-P02',
  wasteInlet: '3WT-0001-XV010',
  cipInlet: '3CIP-3200-XV025',
  transferValve: '3WT-0001-XV01',
  drainValve: '3WT-0001-XV05',
  baseDrumLow: '3WT-0001-LAL001',
  acidDrumLow: '3WT-0001-LAL002'
} as const

const PW_MODULES = Object.values(PW)

/** Tags whose values this model owns (the generic closed-loop simulation skips them). */
export const PWASTE_PHYSICS_TAGS = new Set<string>([PW.pid, PW.eqLevel, PW.neutLevel, PW.tankPhAvg, PW.effluentPh])

const RATE = {
  wasteInflow: 0.4, // % of equalization level per second, mean
  wasteSwing: 0.1,
  wasteSwingPeriodSec: 600,
  cipInflow: 0.3,
  transfer: 0.4, // % per second moved equalization -> neutralization
  drain: 0.4,
  dosePhPerSec: 0.08, // pH change per second at 100 % AO with the recirculation pump mixing
  unmixedFactor: 0.3,
  avgFilterSec: 60,
  effluentLagSec: 15
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function processWasteComplete(modules: Record<string, AnyModule>): boolean {
  return PW_MODULES.every(tag => !!modules[tag]) &&
    modules[PW.pid].type === 'PID' && modules[PW.eqLevel].type === 'AI' && modules[PW.neutLevel].type === 'AI' &&
    modules[PW.tankPhAvg].type === 'AI' && modules[PW.effluentPh].type === 'AI' &&
    modules[PW.transferPump].type === 'MOTOR' && modules[PW.recircPump].type === 'MOTOR' &&
    modules[PW.wasteInlet].type === 'VALVE' && modules[PW.cipInlet].type === 'VALVE' &&
    modules[PW.transferValve].type === 'VALVE' && modules[PW.drainValve].type === 'VALVE' &&
    modules[PW.baseDrumLow].type === 'DI' && modules[PW.acidDrumLow].type === 'DI'
}

/** pH of the waste held in the equalization tank: a slowly wandering acidic/basic load. */
export function influentPh(timeMs: number): number {
  const t = timeMs / 1000
  return clamp(7 + 2.5 * Math.sin((2 * Math.PI * t) / 1200) + Math.sin((2 * Math.PI * t) / 310), 0, 14)
}

export interface ProcessWasteFlows {
  wasteIn: number
  cipIn: number
  transfer: number
  drain: number
}

export function processWasteFlows(modules: Record<string, AnyModule>, timeMs: number): ProcessWasteFlows {
  const eq = modules[PW.eqLevel] as AnalogIndicator
  const neut = modules[PW.neutLevel] as AnalogIndicator
  const p01 = modules[PW.transferPump] as MotorModule
  const xv010 = modules[PW.wasteInlet] as ValveModule
  const xv025 = modules[PW.cipInlet] as ValveModule
  const xv01 = modules[PW.transferValve] as ValveModule
  const xv05 = modules[PW.drainValve] as ValveModule
  const phase = (2 * Math.PI * (timeMs / 1000)) / RATE.wasteSwingPeriodSec
  return {
    wasteIn: xv010.open && eq.pv < 100 ? RATE.wasteInflow - RATE.wasteSwing * Math.cos(phase) : 0,
    cipIn: xv025.open && eq.pv < 100 ? RATE.cipInflow : 0,
    transfer: p01.running && xv01.open && eq.pv > 0 && neut.pv < 100 ? RATE.transfer : 0,
    drain: xv05.open && neut.pv > 0 ? RATE.drain * clamp(neut.pv / 20, 0, 1) : 0
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

  // AO1 (acid) is active below 50 % controller output, AO2 (base) above it; an empty drum delivers nothing.
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
}
