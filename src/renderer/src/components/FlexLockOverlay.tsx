import { useState } from 'react'
import { useSecurity } from '../engine/security'
import { useStore } from '../engine/store'

// FlexLock: shown when the workstation is locked. The next user logs on
// with their DeltaV username/password to return to the DeltaV desktop.
export function FlexLockOverlay(): JSX.Element | null {
  const locked = useSecurity((s) => s.locked)
  const login = useSecurity((s) => s.login)
  const logEvent = useStore((s) => s.logEvent)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!locked) return null

  function submit(): void {
    if (login(name, password)) {
      logEvent('SECURITY', name.trim(), 'User logged on')
      setName('')
      setPassword('')
      setError(null)
    } else {
      setError('Name or password is incorrect.')
    }
  }

  return (
    <div className="flexlock-overlay">
      <div className="flexlock-box">
        <div className="flexlock-title">FlexLock</div>
        <div className="flexlock-sub">Workstation locked. Log on to return to the DeltaV Desktop.</div>
        <label className="flexlock-field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="flexlock-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {error && <div className="flexlock-error">{error}</div>}
        <button className="tbtn" style={{ marginTop: 10, width: '100%' }} onClick={submit}>
          Log On
        </button>
      </div>
    </div>
  )
}
