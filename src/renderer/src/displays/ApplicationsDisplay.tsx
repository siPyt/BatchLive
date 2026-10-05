import { useUi } from '../ui/uiStore'
import { useSecurity, LOCK_LABEL } from '../engine/security'
import { applicationsByRole, type ApplicationRole } from '../engine/applications'
import { DISPLAY_NAVIGATION } from '../ui/displayNavigation'

const ORDER: ApplicationRole[] = ['Operate', 'Engineering', 'Diagnostics', 'Administration', 'Training']

/** DV09-003: the DeltaV applications and the BatchLive displays that execute them, with what each does and does not do. */
export function ApplicationsDisplay(): JSX.Element {
  const navigate = useUi((s) => s.navigate)
  const groups = applicationsByRole()
  const hasLock = useSecurity((s) => s.hasLock)
  return (
    <div className="display applications" style={{ padding: 14, overflow: 'auto' }}>
      <h2>DeltaV Applications</h2>
      <p>Each entry launches the BatchLive display that performs the real actions of the DeltaV application. Behaviour that is
        not reproduced is listed instead of being hidden behind a menu; keys shown are checked when you act, not on launch.</p>
      {ORDER.map((role) => groups[role].length > 0 && (
        <section key={role} aria-label={`${role} applications`}>
          <h3>{role}</h3>
          {groups[role].map((app) => (
            <div key={app.id} data-application={app.id} style={{ borderBottom: '1px solid var(--dv-border)', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <b>{app.native}</b>
                <button className="tbtn sm" onClick={() => navigate(app.display)}>
                  Open {DISPLAY_NAVIGATION.find((n) => n.id === app.display)?.label}
                </button>
                <span style={{ color: 'var(--dv-text-mute)' }}>
                  {app.keys.length ? `Keys: ${app.keys.map((k) => `${LOCK_LABEL[k]}${hasLock(k) ? ' ✓' : ' ✗'}`).join(', ')}` : 'No key required'}
                </span>
              </div>
              <div><b>Does:</b> {app.does.join('; ')}</div>
              <div style={{ color: 'var(--dv-text-mute)' }}><b>Not reproduced:</b> {app.notSupported.join('; ')}</div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
