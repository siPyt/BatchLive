import { useState } from 'react'
import { useSecurity, type DvUser } from '../engine/security'
import {
  MAX_AGE_DAYS_LIMIT, MAX_HISTORY, MAX_MIN_LENGTH, passwordDaysRemaining, passwordPolicyMessage, passwordViolations, type PasswordPolicy
} from '../engine/passwordPolicy'

const row = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } as const

/** DV09-076: workstation-wide password rules. */
export function PasswordPolicyEditor(): JSX.Element {
  const policy = useSecurity((s) => s.passwordPolicy)
  const setPolicy = useSecurity((s) => s.setPasswordPolicy)
  const canAdmin = useSecurity((s) => s.hasLock('SYSTEM_ADMIN'))
  const [message, setMessage] = useState<string | null>(null)
  const apply = (patch: Partial<PasswordPolicy>): void => setMessage(setPolicy(patch))
  const number = (key: 'minLength' | 'maxAgeDays' | 'historyCount', label: string, max: number): JSX.Element => (
    <label style={row}>{label}
      <input aria-label={label} type="number" min={key === 'minLength' ? 1 : 0} max={max} disabled={!canAdmin} value={policy[key]}
        style={{ width: 64 }} onChange={(e) => apply({ [key]: Number(e.target.value) })} />
    </label>
  )
  const flag = (key: 'requireUpper' | 'requireLower' | 'requireDigit' | 'requireSymbol' | 'forbidUserName', label: string): JSX.Element => (
    <label style={row}>
      <input type="checkbox" disabled={!canAdmin} checked={policy[key]} onChange={(e) => apply({ [key]: e.target.checked })} />{label}
    </label>
  )
  return (
    <section aria-label="Password policy" style={{ padding: '6px 10px', borderBottom: '1px solid var(--dv-border)' }}>
      <b>Password policy</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 4 }}>
        {number('minLength', 'Minimum length', MAX_MIN_LENGTH)}
        {flag('requireUpper', 'Upper case')}{flag('requireLower', 'Lower case')}{flag('requireDigit', 'Digit')}{flag('requireSymbol', 'Symbol')}
        {flag('forbidUserName', 'No user name')}
        {number('maxAgeDays', 'Maximum age (days, 0 = never)', MAX_AGE_DAYS_LIMIT)}
        {number('historyCount', 'Remember (0 = off)', MAX_HISTORY)}
      </div>
      {message && <div role="alert" style={{ color: 'var(--dv-critical)' }}>{message}</div>}
      <div style={{ fontSize: 11, color: 'var(--dv-text-mute)' }}>
        Applies when passwords are created, changed or reset and at logon. Training accounts keep their passwords in the
        browser session; this is not Windows account or domain policy.
      </div>
    </section>
  )
}

const dateInput = (ms: number | undefined): string => (ms === undefined ? '' : new Date(ms).toISOString().slice(0, 10))

/** DV09-076: account expiry, password aging exemption and administrator reset for one user. */
export function UserAccountPolicy({ user, canAdmin }: { user: DvUser; canAdmin: boolean }): JSX.Element {
  const policy = useSecurity((s) => s.passwordPolicy)
  const setExpiry = useSecurity((s) => s.setAccountExpiry)
  const setStatus = useSecurity((s) => s.setUserStatus)
  const reset = useSecurity((s) => s.resetPassword)
  const [replacement, setReplacement] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const remaining = passwordDaysRemaining(policy, user.passwordChangedAt, user.passwordNeverExpires, Date.now())
  const preview = replacement ? passwordPolicyMessage(passwordViolations(policy, user.name, replacement, user.passwordHistory)) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={row}>
        <b style={{ color: 'var(--dv-text)', minWidth: 190 }}>Account expires</b>
        <input aria-label={`${user.name} account expiry`} type="date" disabled={!canAdmin} value={dateInput(user.accountExpires)}
          onChange={(e) => setMessage(setExpiry(user.name, e.target.value ? Date.parse(`${e.target.value}T00:00:00Z`) : null))} />
        <span style={{ color: 'var(--dv-text-mute)' }}>Blank = never (logons refused from midnight UTC of that day)</span>
      </label>
      <label style={row}>
        <input type="checkbox" disabled={!canAdmin} checked={!!user.passwordNeverExpires}
          onChange={(e) => setMessage(setStatus(user.name, { passwordNeverExpires: e.target.checked }))} />
        <b style={{ color: 'var(--dv-text)', minWidth: 190 }}>Password never expires</b>
        <span style={{ color: 'var(--dv-text-mute)' }}>
          {remaining === null ? (policy.maxAgeDays > 0 && !user.passwordNeverExpires ? 'Password age unknown' : 'No aging applies') :
            `Expires in ${remaining} day(s)`}
        </span>
      </label>
      <label style={row}>
        <b style={{ color: 'var(--dv-text)', minWidth: 190 }}>Reset password</b>
        <input aria-label={`${user.name} replacement password`} type="password" disabled={!canAdmin} value={replacement}
          onChange={(e) => setReplacement(e.target.value)} />
        <button className="fp-btn" disabled={!canAdmin || !replacement} onClick={() => {
          const error = reset(user.name, replacement)
          setMessage(error ?? 'Password reset; the user must change it at next logon.')
          if (!error) setReplacement('')
        }}>Reset</button>
      </label>
      {preview && <div style={{ fontSize: 11, color: 'var(--dv-critical)' }}>{preview}</div>}
      {message && <div role="status" style={{ fontSize: 11 }}>{message}</div>}
    </div>
  )
}
