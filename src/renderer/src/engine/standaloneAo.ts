import type { AnalogOutputModule, AnalogOutputPatch } from './types'

export function aoConfigurationError(m: AnalogOutputModule, patch: AnalogOutputPatch = {}): string | null {
  const low = patch.pvMin ?? m.pvMin
  const high = patch.pvMax ?? m.pvMax
  const spLow = patch.spLow ?? m.spLow
  const spHigh = patch.spHigh ?? m.spHigh
  if (![low, high, spLow, spHigh].every(Number.isFinite) || low >= high) {
    return 'PV_SCALE requires finite low < high'
  }
  if (spLow < low || spHigh > high || spLow >= spHigh) {
    return 'SP limits must satisfy PV_SCALE low <= SP_LO_LIM < SP_HI_LIM <= PV_SCALE high'
  }
  return null
}

export function aoEngineeringValue(m: AnalogOutputModule, percent: number): number {
  return m.pvMin + percent / 100 * (m.pvMax - m.pvMin)
}

export function executeStandaloneAo(m: AnalogOutputModule, hardwareBad: boolean): void {
  const parameter = m.casParameter ? m.parameters[m.casParameter] : undefined
  const command = m.mode === 'CAS' ? parameter?.value : m.sp
  const invalid = aoConfigurationError(m) !== null || m.mode === 'OOS' ||
    !['CAS', 'AUTO', 'MAN'].includes(m.mode) ||
    !Number.isFinite(m.mode === 'MAN' ? m.manualOutput : command)
  m.bad = hardwareBad || invalid
  m.actualMode = m.bad ? 'OOS' : m.mode
  m.limited = false
  if (!m.bad) {
    if (m.mode === 'MAN') {
      m.out = Math.max(0, Math.min(100, m.manualOutput))
      m.limited = m.out !== m.manualOutput
    } else if (command !== undefined) {
      m.sp = Math.max(m.spLow, Math.min(m.spHigh, command))
      m.limited = m.sp !== command
      m.out = (m.sp - m.pvMin) / (m.pvMax - m.pvMin) * 100
    }
  }
  m.pv = aoEngineeringValue(m, m.out)
}
