import type { PidModule } from './types'

/**
 * DV09-055 remote host path (course p6-9/10): RCAS is like Cascade except the setpoint comes from an external
 * control program through RCAS_IN; ROUT is like Manual except OUT comes from the external program through ROUT_IN.
 * Both depend on fresh Good host data; stale or Bad data sheds RCAS to AUTO and ROUT to MAN.
 */
export interface HostSignal {
  value: number
  good: boolean
  /** Simulated seconds since the host last wrote this input; Infinity until the first write. */
  ageSec: number
}

export interface RemoteHost {
  rcasIn: HostSignal
  routIn: HostSignal
  /** Host data older than this is stale (the shed trigger). */
  timeoutSec: number
}

export const DEFAULT_HOST_TIMEOUT_SEC = 10
export const MIN_HOST_TIMEOUT_SEC = 1
export const MAX_HOST_TIMEOUT_SEC = 3600

export type HostInput = 'RCAS_IN' | 'ROUT_IN'

export function emptyHostSignal(): HostSignal {
  return { value: 0, good: false, ageSec: Infinity }
}

export function newRemoteHost(): RemoteHost {
  return { rcasIn: emptyHostSignal(), routIn: emptyHostSignal(), timeoutSec: DEFAULT_HOST_TIMEOUT_SEC }
}

export function remoteHostOf(m: Pick<PidModule, 'remote'>): RemoteHost {
  return m.remote ?? newRemoteHost()
}

export function hostSignalFresh(signal: HostSignal, timeoutSec: number): boolean {
  return signal.good && Number.isFinite(signal.value) && Number.isFinite(signal.ageSec) && signal.ageSec <= timeoutSec
}

/** Why a host write is refused, or null. RCAS_IN is a setpoint in engineering units; ROUT_IN is an output percent. */
export function hostWriteError(m: Pick<PidModule, 'pvMin' | 'pvMax'>, input: HostInput, value: number): string | null {
  if (!Number.isFinite(value)) return `${input} must be a finite number`
  if (input === 'RCAS_IN' && (value < m.pvMin || value > m.pvMax)) return `RCAS_IN must be within the PV range ${m.pvMin} to ${m.pvMax}`
  if (input === 'ROUT_IN' && (value < 0 || value > 100)) return 'ROUT_IN must be between 0 and 100 %'
  return null
}

export function hostTimeoutError(seconds: number): string | null {
  return Number.isFinite(seconds) && seconds >= MIN_HOST_TIMEOUT_SEC && seconds <= MAX_HOST_TIMEOUT_SEC ?
    null : `The host timeout must be between ${MIN_HOST_TIMEOUT_SEC} and ${MAX_HOST_TIMEOUT_SEC} seconds`
}

/** A host write: the value becomes Good and fresh. */
export function writeHostSignal(remote: RemoteHost, input: HostInput, value: number): RemoteHost {
  const signal: HostSignal = { value, good: true, ageSec: 0 }
  return input === 'RCAS_IN' ? { ...remote, rcasIn: signal } : { ...remote, routIn: signal }
}

/** The host reports a Bad value (communication fault on its side). */
export function markHostBad(remote: RemoteHost, input: HostInput): RemoteHost {
  return input === 'RCAS_IN' ? { ...remote, rcasIn: { ...remote.rcasIn, good: false } } : { ...remote, routIn: { ...remote.routIn, good: false } }
}

/** Age both inputs by dt simulated seconds; returns the same object when nothing changes. */
export function ageRemoteHost(remote: RemoteHost, dt: number): RemoteHost {
  if (!(dt > 0) || (!Number.isFinite(remote.rcasIn.ageSec) && !Number.isFinite(remote.routIn.ageSec))) return remote
  const age = (s: HostSignal): HostSignal => (Number.isFinite(s.ageSec) ? { ...s, ageSec: s.ageSec + dt } : s)
  return { ...remote, rcasIn: age(remote.rcasIn), routIn: age(remote.routIn) }
}

/** Status text for the host inputs. */
export function hostSignalStatus(signal: HostSignal, timeoutSec: number): string {
  if (!Number.isFinite(signal.ageSec)) return 'No host data yet'
  if (!signal.good) return 'Bad'
  return signal.ageSec > timeoutSec ? `Stale (${signal.ageSec.toFixed(0)} s old)` : 'Good'
}
