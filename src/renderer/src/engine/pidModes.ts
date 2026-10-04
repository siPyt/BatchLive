import type { ControlMode, PidModule, PidTargetMode } from './types'

export const PID_TARGET_MODES: readonly PidTargetMode[] = ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN', 'OOS']
export const PID_ACTUAL_MODES: readonly ControlMode[] = [...PID_TARGET_MODES, 'LO']
const targetCodes: Record<PidTargetMode, number> = { OOS: 1, IMAN: 2, MAN: 8, AUTO: 16, CAS: 48, RCAS: 80, ROUT: 144 }
const actualCodes: Record<ControlMode, number> = { OOS: 1, IMAN: 2, LO: 4, MAN: 8, AUTO: 16, CAS: 32, RCAS: 64, ROUT: 128 }

export function isPidTargetMode(value: unknown): value is PidTargetMode {
  return PID_TARGET_MODES.some(mode => mode === value)
}
export function parsePidTargetMode(value: string): PidTargetMode | undefined {
  return PID_TARGET_MODES.find(mode => mode === value.toUpperCase() ||
    /^[+]?\d+(?:\.0*)?$/.test(value) && targetCodes[mode] === Number(value))
}
export function parsePidActualMode(value: string): ControlMode | undefined {
  return PID_ACTUAL_MODES.find(mode => mode === value.toUpperCase() ||
    /^[+]?\d+(?:\.0*)?$/.test(value) && actualCodes[mode] === Number(value))
}
export function pidExecutionBad(m: PidModule): boolean {
  return m.actualMode === 'OOS' || !!m.trackError || !!m.ffError
}
