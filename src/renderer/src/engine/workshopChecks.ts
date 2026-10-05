import type { Controller } from './hardware'
import type { EventLogEntry } from './types'

/** Evidence-based checking of the "Commissioning the Controller" workshop (DV-09 pp55-67) against live simulator state. */
export type StepVerdict = 'verified' | 'pending' | 'manual'
export interface StepCheck { id: string; verdict: StepVerdict; detail: string }
export interface CommissioningCheck { controller: string | null; steps: StepCheck[] }

export const COMMISSIONING_STEP_IDS = ['dv09-ctlr-1', 'dv09-ctlr-2', 'dv09-ctlr-3', 'dv09-ctlr-4', 'dv09-ctlr-5', 'dv09-ctlr-6'] as const

const lastIndex = (log: readonly EventLogEntry[], tag: string, pattern: RegExp, after = -1): number => {
  for (let i = log.length - 1; i > after; i--) if (log[i].tag === tag && pattern.test(log[i].description)) return i
  return -1
}
const firstIndex = (log: readonly EventLogEntry[], tag: string, pattern: RegExp, after = -1): number => {
  for (let i = after + 1; i < log.length; i++) if (log[i].tag === tag && pattern.test(log[i].description)) return i
  return -1
}

function checkController(c: Controller, log: readonly EventLogEntry[]): StepCheck[] {
  const t = c.tag
  const started = firstIndex(log, t, /^Decommissioned controller created|^Controller decommissioned|^Controller renamed from/)
  const idStart = firstIndex(log, t, /identify flashing started/)
  const idStop = idStart >= 0 ? firstIndex(log, t, /identify flashing stopped/, idStart) : -1
  const commissionedAt = lastIndex(log, t, /^Controller commissioned and added/)
  const sensed = commissionedAt >= 0 ? firstIndex(log, t, /^I\/O auto-sense complete/, commissionedAt) : -1
  const pass = (ok: boolean, good: string, bad: string, id: string): StepCheck => ({ id, verdict: ok ? 'verified' : 'pending', detail: ok ? good : bad })
  return [
    pass(started >= 0, `${t} was created or decommissioned`, 'Create a decommissioned controller or decommission one', COMMISSIONING_STEP_IDS[0]),
    pass(idStop >= 0, 'Identify was started and then stopped', idStart >= 0 ? 'Identify is started; stop it' : 'Identify the controller, then stop it', COMMISSIONING_STEP_IDS[1]),
    pass(c.commissioned && c.networkRedundant && !!c.controlNetworkAddress && commissionedAt >= 0,
      `Commissioned at ${c.controlNetworkAddress} with a redundant control network`,
      !c.commissioned ? 'Select Redundant control network, then Commission' : !c.networkRedundant ? 'Enable Redundant control network' : 'Commission the controller again after enabling it',
      COMMISSIONING_STEP_IDS[2]),
    pass(!!c.lastAutoSense && sensed >= 0, `Auto-sense found ${c.lastAutoSense?.channelsDetected ?? 0} channel(s)`, 'Run Auto-sense I/O after commissioning', COMMISSIONING_STEP_IDS[3]),
    pass(c.commissioned && c.coldRestartMinutes === 5, 'Cold restart is saved as 5 minutes', `Cold restart is ${c.coldRestartMinutes} minute(s); set Within A Time Limit = 5 minutes and Apply`, COMMISSIONING_STEP_IDS[4]),
    { id: COMMISSIONING_STEP_IDS[5], verdict: 'manual', detail: 'Answering No to Auto-sense is a dialog choice; confirm it yourself' }
  ]
}

/** Evaluate every controller and report on the one that satisfies the most verifiable steps (the most recently active wins ties). */
export function checkCommissioningWorkshop(controllers: Record<string, Controller>, log: readonly EventLogEntry[]): CommissioningCheck {
  let best: CommissioningCheck = { controller: null, steps: checkController({ tag: '', commissioned: false, networkRedundant: false, coldRestartMinutes: 0 } as Controller, []) }
  let bestScore = -1
  let bestActivity = -1
  for (const c of Object.values(controllers)) {
    const steps = checkController(c, log)
    const score = steps.filter((s) => s.verdict === 'verified').length
    const activity = lastIndex(log, c.tag, /./)
    if (score > bestScore || (score === bestScore && activity > bestActivity)) { bestScore = score; bestActivity = activity; best = { controller: c.tag, steps } }
  }
  if (best.controller === null) best.steps = best.steps.map((s) => (s.verdict === 'pending' ? { ...s, detail: 'No controller exists yet' } : s))
  return best
}
