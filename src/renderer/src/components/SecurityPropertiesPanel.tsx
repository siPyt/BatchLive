import { useSecurity, ALL_LOCKS, LOCK_LABEL, type LockType } from '../engine/security'
import { SECURITY_TARGETS, type SecurityTargetKind } from '../engine/securityTargets'

const TITLE: Record<SecurityTargetKind, string> = {
  parameter: 'Parameter Security',
  field: 'Field Security',
  function: 'Function Security'
}

const INTRO: Record<SecurityTargetKind, string> = {
  parameter: 'Writable parameters carry a lock. Change the lock to require a different key for that parameter.',
  field: 'Writable fields (alarm record fields, overrides, acknowledge) carry a lock. Change the lock to require a different key.',
  function: 'Secured functions (configure, download, diagnostics, batch) carry a lock. Change the lock to require a different key.'
}

/** DV09-075: System Configuration > Setup > Security > Parameter / Field / Function Security > Properties. */
export function SecurityPropertiesPanel({ kind }: { kind: SecurityTargetKind }): JSX.Element {
  const assignments = useSecurity((s) => s.lockAssignments)
  const setTargetLock = useSecurity((s) => s.setTargetLock)
  const canAdmin = useSecurity((s) => s.hasLock('SYSTEM_ADMIN'))
  const denied = useSecurity((s) => s.lastDenied)
  const targets = SECURITY_TARGETS.filter((t) => t.kind === kind)

  return (
    <div className="security-properties">
      <h3>{TITLE[kind]} — Properties</h3>
      <p>{INTRO[kind]} Changes take effect at once for every write path that uses the item.</p>
      {!canAdmin && <p role="note">Read-only: changing a lock requires the System Admin key.</p>}
      {denied && !canAdmin && <p role="alert">{denied}</p>}
      <table className="exp-table">
        <thead>
          <tr>
            <th>{kind === 'parameter' ? 'Parameter' : kind === 'field' ? 'Field' : 'Function'}</th>
            <th>Default lock</th>
            <th>Assigned lock</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const assigned: LockType = assignments[t.id] ?? t.defaultLock
            return (
              <tr key={t.id} data-security-target={t.id}>
                <td>{t.label}</td>
                <td>{LOCK_LABEL[t.defaultLock]}</td>
                <td>
                  <select
                    aria-label={`Lock for ${t.label}`}
                    disabled={!canAdmin}
                    value={assigned}
                    onChange={(e) => setTargetLock(t.id, e.target.value as LockType)}
                  >
                    {ALL_LOCKS.map((lock) => (
                      <option key={lock} value={lock}>
                        {LOCK_LABEL[lock]}
                      </option>
                    ))}
                  </select>
                  {assigned !== t.defaultLock && (
                    <button className="fp-btn" disabled={!canAdmin} onClick={() => setTargetLock(t.id, undefined)}>
                      Restore default
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
