import { useState } from 'react'
import {
  CHRONICLE_CATEGORIES,
  CHRONICLE_MAX_RECORDS,
  useChronicle,
  type ChronicleConfig
} from '../engine/eventChronicle'
import type { EventCategory } from '../engine/types'

/** DV09-045 workstation Event Chronicle setup and the persistent, hash-chained archive. */
export function ChroniclePanel(): JSX.Element {
  const configured = useChronicle((s) => s.configured)
  const deployed = useChronicle((s) => s.deployed)
  const archive = useChronicle((s) => s.archive)
  const configure = useChronicle((s) => s.configure)
  const download = useChronicle((s) => s.download)
  const reload = useChronicle((s) => s.reload)
  const verify = useChronicle((s) => s.verify)
  const clear = useChronicle((s) => s.clear)
  const [message, setMessage] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<string | null>(null)
  const dirty = JSON.stringify(deployed) !== JSON.stringify(configured)
  const update = (patch: Partial<ChronicleConfig>): void => setMessage(configure({ ...configured, ...patch }))
  const toggle = (category: EventCategory, on: boolean): void =>
    update({ subscriptions: on ? [...configured.subscriptions, category] : configured.subscriptions.filter((c) => c !== category) })
  return (
    <details className="chronicle-panel" data-chronicle>
      <summary>
        Workstation Event Chronicle — {deployed?.enabled ? 'recording' : 'not recording'}
        {dirty ? ' · download required' : ''} · {archive.records.length} archived record(s)
      </summary>
      <div style={{ padding: 8 }}>
        <p>
          Subscribed events are kept in a persistent archive in this browser profile. Each record is chained to the previous one with SHA-256 so edits and
          deletions are detected. This is a training archive, not a compliant or tamper-proof 21 CFR Part 11 record.
        </p>
        <label>
          <input type="checkbox" aria-label="Enable Event Chronicle" checked={configured.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Enable Event Chronicle on this workstation
        </label>{' '}
        <label>
          Workstation name <input aria-label="Chronicle workstation name" value={configured.name} onChange={(e) => update({ name: e.target.value })} />
        </label>{' '}
        <label>
          <input type="checkbox" aria-label="Sequence of events" checked={configured.soe} onChange={(e) => update({ soe: e.target.checked })} /> Sequence of events
        </label>
        <div>
          Subscriptions:{' '}
          {CHRONICLE_CATEGORIES.map((category) => (
            <label key={category} style={{ marginRight: 8 }}>
              <input type="checkbox" aria-label={`Subscribe ${category}`} checked={configured.subscriptions.includes(category)} onChange={(e) => toggle(category, e.target.checked)} /> {category}
            </label>
          ))}
        </div>
        <button className="tbtn sm" onClick={() => setMessage(download())}>Download Event Chronicle</button>{' '}
        <button className="tbtn sm" onClick={() => { reload(); setMessage('Archive reloaded from the saved copy') }}>Reload archive</button>{' '}
        <button
          className="tbtn sm"
          onClick={() => {
            const v = verify()
            setVerdict(v.ok ? `Archive verified: ${archive.records.length} record(s), chain intact` : `Archive FAILED verification: ${v.reason}`)
          }}
        >
          Verify archive
        </button>{' '}
        <button className="tbtn sm" onClick={() => setMessage(clear())}>Clear archive</button>
        {message && <p role="alert">{message}</p>}
        {verdict && <p data-chronicle-verdict>{verdict}</p>}
        <p>
          Archive: {archive.records.length} of the last {CHRONICLE_MAX_RECORDS} records held, {archive.total} archived in total.
        </p>
        <table className="exp-table" data-chronicle-archive>
          <thead>
            <tr><th>Seq</th><th>Time</th><th>Workstation</th><th>Type</th><th>Tag</th><th>User</th><th>Event</th></tr>
          </thead>
          <tbody>
            {archive.records.slice(-50).reverse().map((r) => (
              <tr key={r.seq}>
                <td>{configured.soe ? r.seq : ''}</td><td>{new Date(r.wallTime).toLocaleString()}</td><td>{r.workstation}</td><td>{r.category}</td><td>{r.tag}</td><td>{r.user}</td><td>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
