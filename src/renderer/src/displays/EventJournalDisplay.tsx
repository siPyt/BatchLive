import { useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { clockString, dateString } from '../utils/format'
import type { EventCategory } from '../engine/types'

type Filter = 'ALL' | EventCategory

const CATEGORY_LABEL: Record<EventCategory, string> = {
  ALARM: 'Alarm',
  RTN: 'Return to Normal',
  ACK: 'Acknowledge',
  OPERATOR: 'Operator Action',
  DIAGNOSTIC: 'Diagnostic',
  SECURITY: 'Security',
  BATCH: 'Batch',
  CONFIGURE: 'Configuration'
}

/** DeltaV Event Chronicle: a 21 CFR Part 11 style audit trail of every alarm
 * transition and operator/configuration action, newest first. */
export function EventJournalDisplay(): JSX.Element {
  const eventLog = useStore((s) => s.eventLog)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [search, setSearch] = useState('')

  let rows = [...eventLog].reverse()
  if (filter !== 'ALL') rows = rows.filter((e) => e.category === filter)
  if (search.trim()) {
    const q = search.trim().toUpperCase()
    rows = rows.filter((e) => e.tag.toUpperCase().includes(q) || e.description.toUpperCase().includes(q) || e.user.toUpperCase().includes(q))
  }

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="alarm-list-head">
        <span className="alh-title">Alarm &amp; Event Journal</span>
        <span className="alh-counts">
          Entries: <b>{eventLog.length}</b>
        </span>
      </div>
      <div className="toolbar-row">
        {(['ALL', 'ALARM', 'RTN', 'ACK', 'OPERATOR', 'DIAGNOSTIC', 'SECURITY', 'BATCH', 'CONFIGURE'] as Filter[]).map((f) => (
          <button key={f} className={'tbtn sm' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'ALL' : CATEGORY_LABEL[f]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <input
          placeholder="Search tag, description, user…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: 'var(--dv-panel)',
            border: '1px solid var(--dv-border)',
            color: 'var(--dv-text)',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
            width: 220
          }}
        />
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table className="alarm-table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Time</th>
              <th style={{ width: 110 }}>Category</th>
              <th style={{ width: 120 }}>Tag</th>
              <th>Description</th>
              <th style={{ width: 110 }}>User</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--dv-text-mute)', padding: 20 }}>
                  No journal entries match this filter.
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr
                key={e.id}
                className={e.category === 'ALARM' ? (e.priority ?? '').toLowerCase() : e.category === 'RTN' ? 'rtn' : ''}
              >
                <td>
                  {dateString(e.time)} {clockString(e.time)}
                </td>
                <td>{CATEGORY_LABEL[e.category]}</td>
                <td>
                  {e.tag && e.tag !== '—' ? (
                    <a href="#" onClick={(ev) => { ev.preventDefault(); openFaceplate(e.tag) }}>
                      {e.tag}
                    </a>
                  ) : (
                    e.tag
                  )}
                </td>
                <td>{e.description}</td>
                <td>{e.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
