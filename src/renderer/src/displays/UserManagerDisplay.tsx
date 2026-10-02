import { useState } from 'react'
import { useSecurity, ALL_LOCKS, LOCK_LABEL, LOCK_HINT, type LockType, type DvUser } from '../engine/security'

// DeltaV User Manager: accessed from DeltaV Explorer's Lock Key button.
// Lets a System Admin add/delete users and groups and assign Locks & Keys.

export function UserManagerDisplay(): JSX.Element {
  const users = useSecurity((s) => s.users)
  const currentUser = useSecurity((s) => s.currentUser)
  const addUser = useSecurity((s) => s.addUser)
  const deleteUser = useSecurity((s) => s.deleteUser)
  const setUserLocks = useSecurity((s) => s.setUserLocks)
  const hasLock = useSecurity((s) => s.hasLock)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const canAdmin = hasLock('SYSTEM_ADMIN')

  const sel = users.find((u) => u.name === selected) ?? null

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="alarm-list-head">
        <span className="alh-title">DeltaV User Manager</span>
        <span className="alh-counts">
          Logged on as: <b>{currentUser}</b>
          {!canAdmin && <span style={{ marginLeft: 10, color: 'var(--dv-critical)' }}>(read-only — requires System Admin key)</span>}
        </span>
      </div>

      <div className="toolbar-row">
        <span style={{ color: 'var(--dv-text-dim)', fontSize: 12 }}>
          Users &amp; Groups — security is enforced by Locks &amp; Keys. Use "Lock Workstation" in the top bar to switch users.
        </span>
        <span style={{ flex: 1 }} />
        <button className="tbtn sm" disabled={!canAdmin} onClick={() => setCreating((v) => !v)}>
          {creating ? '✕ Cancel' : '＋ New User'}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div className="explorer-tree" style={{ width: 260 }}>
          {creating && <NewUserForm onCreate={addUser} onDone={() => setCreating(false)} />}
          {users.map((u) => (
            <div
              key={u.name}
              className={'exp-node exp-mod' + (selected === u.name ? ' sel' : '')}
              onClick={() => setSelected(u.name)}
            >
              <span className="exp-badge">{u.name === currentUser ? 'ON' : 'USR'}</span>
              <b className="exp-tag">{u.name}</b>
              <span className="exp-desc">{u.fullName}</span>
            </div>
          ))}
        </div>

        <div className="explorer-detail">
          {!sel ? (
            <div className="exp-empty">Select a user to view and edit their Locks &amp; Keys.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="fp-row">
                <span className="fp-label">Name</span>
                <b>{sel.name}</b>
              </div>
              <div className="fp-row">
                <span className="fp-label">Full Name</span>
                <span>{sel.fullName}</span>
              </div>
              <div className="fp-row" style={{ marginTop: 4 }}>
                <span className="fp-label">Locks &amp; Keys</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {ALL_LOCKS.map((lock) => (
                  <label
                    key={lock}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dv-text-dim)' }}
                  >
                    <input
                      type="checkbox"
                      disabled={!canAdmin}
                      checked={sel.locks.includes(lock)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...sel.locks, lock]
                          : sel.locks.filter((l) => l !== lock)
                        setUserLocks(sel.name, next)
                      }}
                    />
                    <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>{LOCK_LABEL[lock]}</b>
                    <span style={{ color: 'var(--dv-text-mute)' }}>{LOCK_HINT[lock]}</span>
                  </label>
                ))}
              </div>
              <div className="fp-row" style={{ marginTop: 8 }}>
                <button
                  className="fp-btn"
                  disabled={!canAdmin || sel.name === currentUser}
                  title={sel.name === currentUser ? "Can't delete the logged-on user" : 'Delete user'}
                  onClick={() => {
                    deleteUser(sel.name)
                    setSelected(null)
                  }}
                >
                  Delete User
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NewUserForm({
  onCreate,
  onDone
}: {
  onCreate: (u: DvUser) => boolean
  onDone: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [locks, setLocks] = useState<LockType[]>(['CONTROL'])
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="exp-newmod">
      <div className="exp-newmod-title">New User</div>
      <label>
        Name
        <input placeholder="e.g. OperatorB" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Full Name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
        {ALL_LOCKS.map((lock) => (
          <label key={lock} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="checkbox"
              checked={locks.includes(lock)}
              onChange={(e) =>
                setLocks((ls) => (e.target.checked ? [...ls, lock] : ls.filter((l) => l !== lock)))
              }
            />
            {LOCK_LABEL[lock]}
          </label>
        ))}
      </div>
      {error && <div className="exp-newmod-err">{error}</div>}
      <div className="exp-newmod-actions">
        <button
          className="tbtn sm"
          onClick={() => {
            if (!name.trim() || !password.trim()) {
              setError('Name and password are required.')
              return
            }
            const ok = onCreate({ name: name.trim(), fullName: fullName.trim() || name.trim(), password, locks })
            if (!ok) {
              setError('A user with that name already exists.')
              return
            }
            onDone()
          }}
        >
          Create
        </button>
        <button className="tbtn sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
