import { useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { priorityRank, clockString } from '../utils/format'
import type { ActiveAlarm, AlarmPriority } from '../engine/types'

type Filter = 'ALL' | AlarmPriority | 'UNACK'

export function AlarmSummary(): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const ackAll = useStore((s) => s.ackAll)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const [filter, setFilter] = useState<Filter>('ALL')

  let rows = [...alarms]
  if (filter === 'UNACK') rows = rows.filter((a) => !a.acknowledged)
  else if (filter !== 'ALL') rows = rows.filter((a) => a.priority === filter)

  rows.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1
    const pr = priorityRank(b.priority) - priorityRank(a.priority)
    if (pr !== 0) return pr
    return b.time - a.time
  })

  const unack = alarms.filter((a) => !a.acknowledged).length

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar-row">
        <span className="title">Alarm List</span>
        {(['ALL', 'CRITICAL', 'WARNING', 'ADVISORY', 'UNACK'] as Filter[]).map((f) => (
          <button key={f} className={'tbtn sm' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        <button className="tbtn sm" onClick={ackAll} disabled={unack === 0}>
          Acknowledge All ({unack})
        </button>
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        <table className="alarm-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Time</th>
              <th style={{ width: 24 }}>Pri</th>
              <th style={{ width: 90 }}>Tag</th>
              <th>Description</th>
              <th style={{ width: 90 }}>Condition</th>
              <th style={{ width: 90 }}>Value</th>
              <th style={{ width: 90 }}>State</th>
              <th style={{ width: 80 }}>Ack</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--dv-text-mute)', padding: 24 }}>
                  No alarms match this filter
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <AlarmRow key={a.id} a={a} onAck={() => ackAlarm(a.id)} onOpen={() => openFaceplate(a.moduleTag)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AlarmRow({ a, onAck, onOpen }: { a: ActiveAlarm; onAck: () => void; onOpen: () => void }): JSX.Element {
  return (
    <tr className={a.acknowledged ? '' : 'unack'}>
      <td style={{ color: 'var(--dv-text-dim)' }}>{clockString(a.time)}</td>
      <td>
        <span className={'prio-chip ' + a.priority.toLowerCase()} />
      </td>
      <td>
        <a style={{ color: '#6ec1ff', cursor: 'pointer' }} onClick={onOpen}>
          {a.moduleTag}
        </a>
      </td>
      <td>{a.moduleDesc}</td>
      <td>{a.label}</td>
      <td>{a.unit ? `${a.value.toFixed(1)} ${a.unit}` : '—'}</td>
      <td className={a.active ? 'state-active' : 'state-rtn'}>{a.active ? 'ACTIVE' : 'RTN'}</td>
      <td>
        {a.acknowledged ? (
          <span style={{ color: 'var(--dv-text-mute)' }}>ACK</span>
        ) : (
          <button className="tbtn sm" onClick={onAck}>
            Ack
          </button>
        )}
      </td>
    </tr>
  )
}
