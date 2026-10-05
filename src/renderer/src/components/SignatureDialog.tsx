import { useState } from 'react'
import { useStore } from '../engine/store'
import { useSecurity } from '../engine/security'

/** DV09-080 Electronic Signature Data Entry: comment, confirm and (for two-signature policies) verify. */
export function SignatureDialog(): JSX.Element | null {
  const pending = useStore((s) => s.signaturePending)
  const submit = useStore((s) => s.submitSignature)
  const cancel = useStore((s) => s.cancelSignature)
  const currentUser = useSecurity((s) => s.currentUser)
  const [comment, setComment] = useState('')
  const [confirmUser, setConfirmUser] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verifyUser, setVerifyUser] = useState('')
  const [verifyPassword, setVerifyPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const request = pending[0]
  if (!request) return null

  function clear(): void {
    setComment('')
    setConfirmUser('')
    setConfirmPassword('')
    setVerifyUser('')
    setVerifyPassword('')
    setError(null)
  }

  function sign(): void {
    const failure = submit(request.id, {
      comment,
      confirm: { user: confirmUser || currentUser, password: confirmPassword },
      verify: request.level === 2 ? { user: verifyUser, password: verifyPassword } : undefined
    })
    if (failure) setError(failure)
    else clear()
  }

  return (
    <div className="flexlock-overlay" role="dialog" aria-label="Electronic Signature Data Entry">
      <div className="flexlock-box" style={{ minWidth: 420 }}>
        <div className="flexlock-title">Electronic Signature Data Entry</div>
        <div className="flexlock-sub">
          {request.tag}: {request.valueText}
          <br />
          Policy {request.policy} requires {request.level === 2 ? 'a confirmer and a verifier' : 'a confirmer'}. The
          value is not written until the signature succeeds.
        </div>
        <label className="flexlock-field">
          Comment
          <input value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </label>
        <label className="flexlock-field">
          Confirm — user name
          <input value={confirmUser} placeholder={currentUser} onChange={(e) => setConfirmUser(e.target.value)} />
        </label>
        <label className="flexlock-field">
          Confirm — password
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
        {request.level === 2 && (
          <>
            <label className="flexlock-field">
              Verify — user name
              <input value={verifyUser} onChange={(e) => setVerifyUser(e.target.value)} />
            </label>
            <label className="flexlock-field">
              Verify — password
              <input type="password" value={verifyPassword} onChange={(e) => setVerifyPassword(e.target.value)} />
            </label>
          </>
        )}
        {error && <div className="flexlock-error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="tbtn" style={{ flex: 1 }} onClick={sign}>
            Sign
          </button>
          <button
            className="tbtn"
            style={{ flex: 1 }}
            onClick={() => {
              cancel(request.id)
              clear()
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
