import type { LockType } from './security'

// ---------------------------------------------------------------------------
// DeltaV Electronic Signatures (DV-09 chapter 8). Operator writes to selected
// module parameters can require no signature, one signature (confirmer) or two
// signatures (confirmer and verifier). A write is staged: nothing changes until
// the required signatures succeed. The simulator treats every operator write
// through the store (faceplates, pictures, Control Studio online) as a
// DeltaV Operate / Control Studio write; SFC-driven writes are not operator
// writes and are never gated.
// ---------------------------------------------------------------------------

export type SignatureRequirement = 'NONE' | 'CONFIRM' | 'CONFIRM_VERIFY'

export const SIGNATURE_REQUIREMENT_LABEL: Record<SignatureRequirement, string> = {
  NONE: 'No signature',
  CONFIRM: 'One signature (confirm)',
  CONFIRM_VERIFY: 'Two signatures (confirm and verify)'
}

/** Parameters the simulator can stage for signature, i.e. those an operator can really write. */
export const SIGNABLE_PARAMETERS = ['SP', 'MODE', 'OUT', 'GAIN', 'RESET', 'RATE', 'SP_D', 'MESSAGE'] as const
export type SignableParameter = (typeof SIGNABLE_PARAMETERS)[number]

export interface SignaturePolicy {
  name: string
  description: string
  /** The verifier may be the same person as the confirmer. */
  allowSamePerson: boolean
  /** Parameter confirmation tab: parameter of interest -> its signature requirement. */
  parameters: Record<string, SignatureRequirement>
}

export interface SignatureConfig {
  /** System Preferences: Electronic Signatures in DeltaV Operate. */
  operate: boolean
  /** System Preferences: Electronic Signatures in DeltaV Control Studio. */
  controlStudio: boolean
  policies: Record<string, SignaturePolicy>
  /** Plant areas with Electronic Signature enabled. */
  areas: string[]
  /** Module (or SFC) name -> the policy associated with it. */
  modules: Record<string, string>
}

export const EMPTY_SIGNATURE_CONFIG: SignatureConfig = {
  operate: false,
  controlStudio: false,
  policies: {},
  areas: [],
  modules: {}
}

export interface SignatureRequest {
  id: number
  tag: string
  parameter: string
  /** Display text of the value the operator asked for. */
  valueText: string
  level: 1 | 2
  policy: string
  allowSamePerson: boolean
  requestedBy: string
  requestedAt: number
}

export interface SignatureCredential {
  user: string
  password: string
}

export interface SignatureAttempt {
  comment: string
  confirm: SignatureCredential
  verify?: SignatureCredential
}

export type Authenticator = (
  name: string,
  password: string
) => { ok: true; user: string; locks: LockType[] } | { ok: false; reason: string }

export function signaturePolicyError(policy: SignaturePolicy): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(policy.name)) {
    return 'Policy name must start with a letter and use at most 32 letters, digits, - or _'
  }
  const entries = Object.entries(policy.parameters)
  if (!entries.length) return 'A policy needs at least one parameter on its Parameter Confirmation tab'
  for (const [parameter, requirement] of entries) {
    if (!(SIGNABLE_PARAMETERS as readonly string[]).includes(parameter)) {
      return `${parameter} is not a writable parameter that supports signatures`
    }
    if (!(requirement in SIGNATURE_REQUIREMENT_LABEL)) return `${parameter} has an unknown signature requirement`
  }
  return null
}

/** 0 = no signature needed. Every prerequisite must hold: application, area, module association and parameter. */
export function requiredSignature(
  config: SignatureConfig,
  target: { tag: string; area: string | undefined } | undefined,
  parameter: string
): { level: 0 | 1 | 2; policy?: SignaturePolicy } {
  if (!target || !(config.operate || config.controlStudio)) return { level: 0 }
  if (target.area === undefined || !config.areas.includes(target.area)) return { level: 0 }
  const policy = config.policies[config.modules[target.tag] ?? '']
  if (!policy) return { level: 0 }
  const requirement = policy.parameters[parameter]
  if (requirement === 'CONFIRM') return { level: 1, policy }
  if (requirement === 'CONFIRM_VERIFY') return { level: 2, policy }
  return { level: 0 }
}

export type SignatureVerdict =
  | { ok: true; confirmer: string; verifier?: string }
  | { ok: false; stage: 'comment' | 'confirm' | 'verify'; reason: string }

export function evaluateSignature(
  request: Pick<SignatureRequest, 'level' | 'allowSamePerson'>,
  attempt: SignatureAttempt,
  authenticate: Authenticator
): SignatureVerdict {
  if (!attempt.comment.trim()) return { ok: false, stage: 'comment', reason: 'A comment is required' }
  const confirmer = authenticate(attempt.confirm.user, attempt.confirm.password)
  if (!confirmer.ok) return { ok: false, stage: 'confirm', reason: `Confirm failed: ${confirmer.reason}` }
  if (request.level === 1) return { ok: true, confirmer: confirmer.user }
  if (!attempt.verify) return { ok: false, stage: 'verify', reason: 'A verifier signature is required' }
  const verifier = authenticate(attempt.verify.user, attempt.verify.password)
  if (!verifier.ok) return { ok: false, stage: 'verify', reason: `Verify failed: ${verifier.reason}` }
  if (!verifier.locks.includes('ACTION_VERIFY')) {
    return { ok: false, stage: 'verify', reason: `Verify failed: ${verifier.user} does not hold the Action Verify key` }
  }
  if (verifier.user === confirmer.user && !request.allowSamePerson) {
    return { ok: false, stage: 'verify', reason: 'Verify failed: the policy does not allow the same person to confirm and verify' }
  }
  return { ok: true, confirmer: confirmer.user, verifier: verifier.user }
}
