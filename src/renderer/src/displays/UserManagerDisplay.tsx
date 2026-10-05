import { useState } from 'react'
import { useStore } from '../engine/store'
import {
  useSecurity,
  ALL_LOCKS,
  LOCK_LABEL,
  LOCK_HINT,
  effectiveLocks,
  groupsOf,
  type LockType,
  type DvUser,
  type DvGroup
} from '../engine/security'

// DeltaV User Manager: accessed from DeltaV Explorer's Lock Key button.
// Users and Groups each have General / Members-or-Groups / Keys forms. A user's
// effective keys are their own keys plus the keys of every group they belong to.

type Selection = { kind: 'user' | 'group'; name: string } | null

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dv-text-dim)' }

export function UserManagerDisplay(): JSX.Element {
  const users = useSecurity((s) => s.users)
  const groups = useSecurity((s) => s.groups)
  const currentUser = useSecurity((s) => s.currentUser)
  const addUser = useSecurity((s) => s.addUser)
  const deleteUser = useSecurity((s) => s.deleteUser)
  const setUserLocks = useSecurity((s) => s.setUserLocks)
  const setUserAreas = useSecurity((s) => s.setUserAreas)
  const setUserStatus = useSecurity((s) => s.setUserStatus)
  const createGroup = useSecurity((s) => s.createGroup)
  const deleteGroup = useSecurity((s) => s.deleteGroup)
  const updateGroup = useSecurity((s) => s.updateGroup)
  const addGroupMember = useSecurity((s) => s.addGroupMember)
  const removeGroupMember = useSecurity((s) => s.removeGroupMember)
  const setGroupLocks = useSecurity((s) => s.setGroupLocks)
  const setGroupAreas = useSecurity((s) => s.setGroupAreas)
  const hasLock = useSecurity((s) => s.hasLock)
  const workstation = useSecurity((s) => s.workstation)
  const pending = useSecurity((s) => s.workstationPending())
  const downloadWorkstation = useSecurity((s) => s.downloadWorkstation)
  const modules = useStore((s) => s.modules)
  const [creating, setCreating] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [selected, setSelected] = useState<Selection>(null)
  const [message, setMessage] = useState<string | null>(null)
  const canAdmin = hasLock('SYSTEM_ADMIN')

  const selUser = selected?.kind === 'user' ? users.find((u) => u.name === selected.name) ?? null : null
  const selGroup = selected?.kind === 'group' ? groups.find((g) => g.name === selected.name) ?? null : null
  const allAreas = Array.from(new Set(Object.values(modules).map((m) => m.area))).sort()
  const report = (error: string | null): void => setMessage(error)

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
          Users &amp; Groups — a user holds their own keys plus every key of each group they belong to. Use "Lock Workstation" in the top bar to switch users.
        </span>
        <span style={{ flex: 1 }} />
        <button className="tbtn sm" disabled={!canAdmin} onClick={() => setCreating((v) => !v)}>
          {creating ? '✕ Cancel' : '＋ New User'}
        </button>
        <button className="tbtn sm" disabled={!canAdmin} onClick={() => setCreatingGroup((v) => !v)}>
          {creatingGroup ? '✕ Cancel' : '＋ New Group'}
        </button>
        <button
          className="tbtn sm"
          disabled={!hasLock('CAN_DOWNLOAD')}
          title="Copy the configured users, groups and lock assignments to this workstation"
          onClick={() => report(downloadWorkstation())}
        >
          Download Workstation
        </button>
      </div>
      <div style={{ fontSize: 11, padding: '2px 10px', color: 'var(--dv-text-mute)' }} data-workstation-status>
        {workstation === null
          ? 'Workstation: not yet downloaded — configuration changes apply immediately.'
          : pending
            ? `Workstation: last downloaded ${new Date(workstation.downloadedAt).toLocaleString()} — configuration changes are pending a download.`
            : `Workstation: up to date (downloaded ${new Date(workstation.downloadedAt).toLocaleString()}).`}
      </div>
      {message && (
        <div className="exp-newmod-err" role="alert" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div className="explorer-tree" style={{ width: 260 }}>
          {creating && <NewUserForm onCreate={addUser} onDone={() => setCreating(false)} />}
          <div className="exp-newmod-title">Users</div>
          {users.map((u) => (
            <div
              key={u.name}
              className={'exp-node exp-mod' + (selected?.kind === 'user' && selected.name === u.name ? ' sel' : '')}
              onClick={() => setSelected({ kind: 'user', name: u.name })}
            >
              <span className="exp-badge">{u.name === currentUser ? 'ON' : u.disabled ? 'OFF' : 'USR'}</span>
              <b className="exp-tag">{u.name}</b>
              <span className="exp-desc">{u.fullName}</span>
            </div>
          ))}
          <div className="exp-newmod-title" style={{ marginTop: 8 }}>Groups</div>
          {creatingGroup && (
            <div className="exp-newmod">
              <label>
                Group name
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
              </label>
              <div className="exp-newmod-actions">
                <button
                  className="tbtn sm"
                  onClick={() => {
                    const error = createGroup(newGroupName, '')
                    report(error)
                    if (!error) {
                      setSelected({ kind: 'group', name: newGroupName.trim() })
                      setNewGroupName('')
                      setCreatingGroup(false)
                    }
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          )}
          {groups.map((g) => (
            <div
              key={g.name}
              className={'exp-node exp-mod' + (selected?.kind === 'group' && selected.name === g.name ? ' sel' : '')}
              onClick={() => setSelected({ kind: 'group', name: g.name })}
            >
              <span className="exp-badge">GRP</span>
              <b className="exp-tag">{g.name}</b>
              <span className="exp-desc">{g.members.length} member(s)</span>
            </div>
          ))}
        </div>

        <div className="explorer-detail">
          {selUser ? (
            <UserDetail
              user={selUser}
              groups={groups}
              currentUser={currentUser}
              canAdmin={canAdmin}
              allAreas={allAreas}
              onLocks={setUserLocks}
              onAreas={setUserAreas}
              onStatus={(name, patch) => report(setUserStatus(name, patch))}
              onMember={(group, user, on) => report(on ? addGroupMember(group, user) : removeGroupMember(group, user))}
              onDelete={(name) => {
                deleteUser(name)
                setSelected(null)
              }}
            />
          ) : selGroup ? (
            <GroupDetail
              group={selGroup}
              users={users}
              canAdmin={canAdmin}
              allAreas={allAreas}
              onRename={(newName, description) => {
                const error = updateGroup(selGroup.name, { newName, description })
                report(error)
                if (!error) setSelected({ kind: 'group', name: newName.trim() })
              }}
              onMember={(user, on) =>
                report(on ? addGroupMember(selGroup.name, user) : removeGroupMember(selGroup.name, user))
              }
              onLocks={(locks) => report(setGroupLocks(selGroup.name, locks))}
              onAreas={(areas) => report(setGroupAreas(selGroup.name, areas))}
              onDelete={() => {
                report(deleteGroup(selGroup.name))
                setSelected(null)
              }}
            />
          ) : (
            <div className="exp-empty">Select a user or group to view and edit their Locks &amp; Keys.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function UserDetail({
  user,
  groups,
  currentUser,
  canAdmin,
  allAreas,
  onLocks,
  onAreas,
  onStatus,
  onMember,
  onDelete
}: {
  user: DvUser
  groups: DvGroup[]
  currentUser: string
  canAdmin: boolean
  allAreas: string[]
  onLocks: (name: string, locks: LockType[]) => void
  onAreas: (name: string, areas: string[] | undefined) => void
  onStatus: (name: string, patch: { disabled?: boolean; mustChangePassword?: boolean }) => void
  onMember: (group: string, user: string, on: boolean) => void
  onDelete: (name: string) => void
}): JSX.Element {
  const effective = effectiveLocks(user, groups)
  const memberOf = groupsOf(user.name, groups)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="fp-row">
        <span className="fp-label">Name</span>
        <b>{user.name}</b>
      </div>
      <div className="fp-row">
        <span className="fp-label">Full Name</span>
        <span>{user.fullName}</span>
      </div>
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Account (Advanced)</span>
      </div>
      <label style={row}>
        <input
          type="checkbox"
          disabled={!canAdmin || user.name === currentUser}
          checked={!!user.disabled}
          onChange={(e) => onStatus(user.name, { disabled: e.target.checked })}
        />
        <b style={{ color: 'var(--dv-text)', minWidth: 190 }}>Account disabled</b>
        <span style={{ color: 'var(--dv-text-mute)' }}>A disabled account cannot log on</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          disabled={!canAdmin}
          checked={!!user.mustChangePassword}
          onChange={(e) => onStatus(user.name, { mustChangePassword: e.target.checked })}
        />
        <b style={{ color: 'var(--dv-text)', minWidth: 190 }}>Must change password at next logon</b>
      </label>
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Groups</span>
      </div>
      {groups.length === 0 && <span style={{ fontSize: 12, color: 'var(--dv-text-mute)' }}>No groups defined.</span>}
      {groups.map((g) => (
        <label key={g.name} style={row}>
          <input
            type="checkbox"
            disabled={!canAdmin}
            checked={g.members.includes(user.name)}
            onChange={(e) => onMember(g.name, user.name, e.target.checked)}
          />
          <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>{g.name}</b>
          <span style={{ color: 'var(--dv-text-mute)' }}>{g.description}</span>
        </label>
      ))}
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Locks &amp; Keys</span>
        <span style={{ fontSize: 11, color: 'var(--dv-text-mute)' }}>
          (inherited from {memberOf.length ? memberOf.join(', ') : 'no groups'} shown as ◇)
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ALL_LOCKS.map((lock) => {
          const direct = user.locks.includes(lock)
          const inherited = !direct && effective.includes(lock)
          return (
            <label key={lock} style={row}>
              <input
                type="checkbox"
                disabled={!canAdmin}
                checked={direct}
                onChange={(e) => {
                  const next = e.target.checked ? [...user.locks, lock] : user.locks.filter((l) => l !== lock)
                  onLocks(user.name, next)
                }}
              />
              <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>
                {inherited ? '◇ ' : ''}
                {LOCK_LABEL[lock]}
              </b>
              <span style={{ color: 'var(--dv-text-mute)' }}>{LOCK_HINT[lock]}</span>
            </label>
          )
        })}
      </div>
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Area Write Keys</span>
      </div>
      <AreaChecklist
        areas={user.areas}
        allAreas={allAreas}
        disabled={!canAdmin}
        allLabel="All areas (unrestricted)"
        onChange={(areas) => onAreas(user.name, areas)}
      />
      <div className="fp-row" style={{ marginTop: 8 }}>
        <button
          className="fp-btn"
          disabled={!canAdmin || user.name === currentUser}
          title={user.name === currentUser ? "Can't delete the logged-on user" : 'Delete user'}
          onClick={() => onDelete(user.name)}
        >
          Delete User
        </button>
      </div>
    </div>
  )
}

function GroupDetail({
  group,
  users,
  canAdmin,
  allAreas,
  onRename,
  onMember,
  onLocks,
  onAreas,
  onDelete
}: {
  group: DvGroup
  users: DvUser[]
  canAdmin: boolean
  allAreas: string[]
  onRename: (newName: string, description: string) => void
  onMember: (user: string, on: boolean) => void
  onLocks: (locks: LockType[]) => void
  onAreas: (areas: string[] | undefined) => void
  onDelete: () => void
}): JSX.Element {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} key={group.name}>
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">General</span>
      </div>
      <label style={row}>
        <b style={{ color: 'var(--dv-text)', minWidth: 110 }}>Name</b>
        <input disabled={!canAdmin} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label style={row}>
        <b style={{ color: 'var(--dv-text)', minWidth: 110 }}>Description</b>
        <input disabled={!canAdmin} value={description} onChange={(e) => setDescription(e.target.value)} />
        <button className="fp-btn" disabled={!canAdmin} onClick={() => onRename(name, description)}>
          Apply
        </button>
      </label>
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Members</span>
      </div>
      {users.map((u) => (
        <label key={u.name} style={row}>
          <input
            type="checkbox"
            disabled={!canAdmin}
            checked={group.members.includes(u.name)}
            onChange={(e) => onMember(u.name, e.target.checked)}
          />
          <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>{u.name}</b>
          <span style={{ color: 'var(--dv-text-mute)' }}>{u.fullName}</span>
        </label>
      ))}
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Keys</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ALL_LOCKS.map((lock) => (
          <label key={lock} style={row}>
            <input
              type="checkbox"
              disabled={!canAdmin}
              checked={group.locks.includes(lock)}
              onChange={(e) => onLocks(e.target.checked ? [...group.locks, lock] : group.locks.filter((l) => l !== lock))}
            />
            <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>{LOCK_LABEL[lock]}</b>
            <span style={{ color: 'var(--dv-text-mute)' }}>{LOCK_HINT[lock]}</span>
          </label>
        ))}
      </div>
      <div className="fp-row" style={{ marginTop: 4 }}>
        <span className="fp-label">Area Keys granted to members with restricted areas</span>
      </div>
      <AreaChecklist
        areas={group.areas ?? []}
        allAreas={allAreas}
        disabled={!canAdmin}
        onChange={(areas) => onAreas(areas && areas.length ? areas : undefined)}
      />
      <div className="fp-row" style={{ marginTop: 8 }}>
        <button className="fp-btn" disabled={!canAdmin} onClick={onDelete}>
          Delete Group
        </button>
      </div>
    </div>
  )
}

function AreaChecklist({
  areas,
  allAreas,
  disabled,
  allLabel,
  onChange
}: {
  areas: string[] | undefined
  allAreas: string[]
  disabled: boolean
  allLabel?: string
  onChange: (areas: string[] | undefined) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {allLabel && (
        <label style={row}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={areas === undefined}
            onChange={() => onChange(areas === undefined ? [] : undefined)}
          />
          <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>{allLabel}</b>
        </label>
      )}
      {allAreas.map((area) => (
        <label key={area} style={row}>
          <input
            type="checkbox"
            disabled={disabled || (allLabel !== undefined && areas === undefined)}
            checked={areas !== undefined && areas.includes(area)}
            onChange={(e) => {
              const cur = areas ?? []
              onChange(e.target.checked ? [...cur, area] : cur.filter((a) => a !== area))
            }}
          />
          <b style={{ color: 'var(--dv-text)', minWidth: 130 }}>{area}</b>
        </label>
      ))}
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
