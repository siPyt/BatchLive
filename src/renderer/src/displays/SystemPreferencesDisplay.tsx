import { useEffect, useState } from 'react'
import { useSystem, FEATURE_LABEL, SYSTEM_FEATURES, type SystemFeature } from '../engine/systemPreferences'
import { useSecurity } from '../engine/security'

/** DV09-108/109: System Preferences (hidden features) and the Database Administrator (shut down / connect the server). */
export function SystemPreferencesDisplay(): JSX.Element {
  const features = useSystem((s) => s.features)
  const pending = useSystem((s) => s.pending)
  const acknowledged = useSystem((s) => s.acknowledged)
  const serverState = useSystem((s) => s.serverState)
  const restarts = useSystem((s) => s.restarts)
  const clients = useSystem((s) => s.clients)
  const setPending = useSystem((s) => s.setPendingFeature)
  const acknowledge = useSystem((s) => s.acknowledgePending)
  const shutdown = useSystem((s) => s.shutdownServer)
  const connect = useSystem((s) => s.connectServer)
  const closeClient = useSystem((s) => s.closeClient)
  const closeAll = useSystem((s) => s.closeAllClients)
  const isAdmin = useSecurity((s) => s.hasLock('SYSTEM_ADMIN'))
  const [message, setMessage] = useState<string | null>(null)
  const hasPending = Object.keys(pending).length > 0
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="display system-preferences" style={{ padding: 12, overflow: 'auto' }}>
      <h2>System Preferences and Database Administrator</h2>
      <p>
        Some features are hidden until they are enabled in System Preferences. A selection stays pending and is not active until you close the
        database applications, acknowledge the change, shut down the database server and connect to it again. This simulated server models the
        state changes and administrator rights, not a real DeltaV database.
      </p>
      {!isAdmin && <p role="note">Read-only: changing preferences or the server requires the System Admin key.</p>}
      {message && <p role="alert" data-system-message>{message}</p>}

      <h3>System Preferences</h3>
      <table className="exp-table">
        <thead>
          <tr><th>Feature</th><th>Active</th><th>Selected</th><th>Status</th></tr>
        </thead>
        <tbody>
          {SYSTEM_FEATURES.map((feature: SystemFeature) => {
            const selected = pending[feature] ?? features[feature]
            return (
              <tr key={feature} data-feature={feature}>
                <td>{FEATURE_LABEL[feature]}</td>
                <td>{features[feature] ? 'Yes' : 'No'}</td>
                <td>
                  <input type="checkbox" aria-label={`Enable ${feature}`} checked={selected} disabled={!isAdmin} onChange={(e) => setMessage(setPending(feature, e.target.checked))} />
                </td>
                <td>{feature in pending ? 'Pending — takes effect after the server is restarted' : features[feature] ? 'Active' : 'Hidden'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {hasPending && (
        <p>
          <button className="tbtn sm" disabled={!isAdmin || acknowledged} onClick={() => setMessage(acknowledge())}>
            {acknowledged ? 'Changes acknowledged' : 'Acknowledge preference changes'}
          </button>
        </p>
      )}

      <h3>Open database applications</h3>
      {clients.length === 0 ? (
        <p data-clients>None. The database server can be shut down.</p>
      ) : (
        <>
          <ul data-clients>
            {clients.map((name) => (
              <li key={name}>
                {name} <button className="tbtn sm" onClick={() => closeClient(name)}>Close</button>
              </li>
            ))}
          </ul>
          <button className="tbtn sm" onClick={closeAll}>Close all database applications</button>
        </>
      )}

      <h3>Database Administrator</h3>
      <p data-server-state>
        Database server: <b>{serverState === 'RUNNING' ? 'Running' : 'Stopped'}</b> · restarts this session: {restarts}
        {serverState === 'STOPPED' && ' · configuration, download and Explorer changes are unavailable until you connect'}
      </p>
      <button className="tbtn sm" disabled={!isAdmin || serverState !== 'RUNNING'} onClick={() => setMessage(shutdown())}>
        File → Shutdown server
      </button>{' '}
      <button className="tbtn sm" disabled={!isAdmin || serverState !== 'STOPPED'} onClick={() => setMessage(connect())}>
        Connect to server
      </button>
    </div>
  )
}
