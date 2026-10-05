import { sha256Hex } from './hash'

/** DV09-076 password and account policy. Defaults keep the previous behaviour: any non-blank password, no aging, no history. */
export interface PasswordPolicy {
  minLength: number
  requireUpper: boolean
  requireLower: boolean
  requireDigit: boolean
  requireSymbol: boolean
  forbidUserName: boolean
  /** Passwords expire this many days after they were set; 0 = never. */
  maxAgeDays: number
  /** The new password may not match this many previous passwords; 0 = no history check. */
  historyCount: number
}

export const MAX_MIN_LENGTH = 64
export const MAX_AGE_DAYS_LIMIT = 999
export const MAX_HISTORY = 24
export const DAY_MS = 86_400_000

export function defaultPasswordPolicy(): PasswordPolicy {
  return { minLength: 1, requireUpper: false, requireLower: false, requireDigit: false, requireSymbol: false,
    forbidUserName: false, maxAgeDays: 0, historyCount: 0 }
}

export function passwordPolicyError(policy: PasswordPolicy): string | null {
  const whole = (v: unknown, min: number, max: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  if (!whole(policy.minLength, 1, MAX_MIN_LENGTH)) return `Minimum length must be a whole number from 1 to ${MAX_MIN_LENGTH}`
  if (!whole(policy.maxAgeDays, 0, MAX_AGE_DAYS_LIMIT)) return `Maximum password age must be a whole number of days from 0 to ${MAX_AGE_DAYS_LIMIT}`
  if (!whole(policy.historyCount, 0, MAX_HISTORY)) return `Password history must be a whole number from 0 to ${MAX_HISTORY}`
  const classes = [policy.requireUpper, policy.requireLower, policy.requireDigit, policy.requireSymbol]
  if (classes.some(c => typeof c !== 'boolean') || typeof policy.forbidUserName !== 'boolean') return 'Policy options must be on or off'
  const required = classes.filter(Boolean).length
  if (policy.minLength < required) return `Minimum length ${policy.minLength} cannot hold ${required} required character classes`
  return null
}

/** Salted so identical passwords for different users do not share a history hash. */
export function passwordFingerprint(user: string, password: string): string {
  return sha256Hex(`${user.toLowerCase()}\u0000${password}`)
}

/** Every rule the password breaks, in a stable order; empty when it complies. */
export function passwordViolations(policy: PasswordPolicy, user: string, password: string, history: readonly string[] = []): string[] {
  const out: string[] = []
  if (!password) return ['The password cannot be blank']
  if (password.length < policy.minLength) out.push(`at least ${policy.minLength} characters`)
  if (policy.requireUpper && !/[A-Z]/.test(password)) out.push('an upper-case letter')
  if (policy.requireLower && !/[a-z]/.test(password)) out.push('a lower-case letter')
  if (policy.requireDigit && !/[0-9]/.test(password)) out.push('a digit')
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) out.push('a symbol')
  if (policy.forbidUserName && user.length >= 3 && password.toLowerCase().includes(user.toLowerCase())) out.push('no part of the user name')
  if (policy.historyCount > 0 && history.slice(-policy.historyCount).includes(passwordFingerprint(user, password)))
    out.push(`a password not used in the last ${policy.historyCount} changes`)
  return out
}

export function passwordPolicyMessage(violations: string[]): string | null {
  if (!violations.length) return null
  return violations.length === 1 && violations[0] === 'The password cannot be blank' ? violations[0] :
    `The password must contain ${violations.join(', ')}`
}

export function passwordExpired(policy: PasswordPolicy, changedAt: number | undefined, neverExpires: boolean | undefined, now: number): boolean {
  if (policy.maxAgeDays <= 0 || neverExpires || changedAt === undefined) return false
  return now - changedAt > policy.maxAgeDays * DAY_MS
}

export function accountExpired(expires: number | undefined, now: number): boolean {
  return expires !== undefined && now >= expires
}

/** Whole days until the password expires (0 = expires today); null when it never expires or its age is unknown. */
export function passwordDaysRemaining(policy: PasswordPolicy, changedAt: number | undefined, neverExpires: boolean | undefined, now: number): number | null {
  if (policy.maxAgeDays <= 0 || neverExpires || changedAt === undefined) return null
  return Math.max(0, Math.ceil((changedAt + policy.maxAgeDays * DAY_MS - now) / DAY_MS))
}

export function appendHistory(history: readonly string[] | undefined, fingerprint: string): string[] {
  return [...(history ?? []), fingerprint].slice(-MAX_HISTORY)
}
