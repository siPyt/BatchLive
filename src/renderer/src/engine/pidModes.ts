import type { ControlMode, PidModule, PidTargetMode } from './types'

export const PID_TARGET_MODES: readonly PidTargetMode[] = ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN', 'OOS']
export const PID_ACTUAL_MODES: readonly ControlMode[] = [...PID_TARGET_MODES, 'LO']
const targetCodes: Record<PidTargetMode, number> = { OOS: 1, IMAN: 2, MAN: 8, AUTO: 16, CAS: 48, RCAS: 80, ROUT: 144 }
const actualCodes: Record<ControlMode, number> = { OOS: 1, IMAN: 2, LO: 4, MAN: 8, AUTO: 16, CAS: 32, RCAS: 64, ROUT: 128 }

export function isPidTargetMode(value: unknown): value is PidTargetMode {
  return PID_TARGET_MODES.some(mode => mode === value)
}
export function pidNormalMode(m: PidModule): PidTargetMode {
  return isPidTargetMode(m.normalMode) ? m.normalMode : 'AUTO'
}
export function pidPermittedModes(m: PidModule): PidTargetMode[] {
  const modes = m.permittedModes?.filter(isPidTargetMode)
  return modes === undefined ? [...PID_TARGET_MODES] : [...new Set(modes)]
}
export function pidModeFieldsError(m: PidModule): string | null {
  const permitted = pidPermittedModes(m)
  if (m.normalMode !== undefined && !isPidTargetMode(m.normalMode)) return 'MODE.NORMAL is not a supported target mode'
  if (m.permittedModes !== undefined &&
    (!Array.isArray(m.permittedModes) || m.permittedModes.some(mode => !isPidTargetMode(mode)) ||
      new Set(m.permittedModes).size !== m.permittedModes.length)) {
    return 'MODE.PERMITTED contains invalid or duplicate target modes'
  }
  if (!permitted.length) return 'MODE.PERMITTED must include at least one supported target mode'
  if (!permitted.includes(m.mode)) return `${m.mode} is not in MODE.PERMITTED`
  if (!permitted.includes(pidNormalMode(m))) return `${pidNormalMode(m)} MODE.NORMAL is not in MODE.PERMITTED`
  return null
}
export function pidTargetAllowed(m: PidModule, mode: unknown): mode is PidTargetMode {
  return isPidTargetMode(mode) && pidModeFieldsError(m) === null && pidPermittedModes(m).includes(mode)
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
