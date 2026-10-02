import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { compareAlarmRank, clockString } from '../utils/format'
import type { ActiveAlarm, AlarmPriority } from '../engine/types'

type Filter = 'ALL' | AlarmPriority | 'UNACK'

export function AlarmSummary(): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const ackAll = useStore((s) => s.ackAll)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const alarmFocusTag = useUi((s) => s.alarmFocusTag)
  const clearAlarmFocus = useUi((s) => s.clearAlarmFocus)
  useEffect(() => {
    if (!alarmFocusTag) return
    setTagFilter(alarmFocusTag)
    clearAlarmFocus()
  }, [alarmFocusTag, clearAlarmFocus])

  let rows = [...alarms]
  if (tagFilter) rows = rows.filter((a) => a.moduleTag === tagFilter)
  if (filter === 'UNACK') rows = rows.filter((a) => !a.acknowledged)
  else if (filter !== 'ALL') rows = rows.filter((a) => a.priority === filter)

  rows.sort(compareAlarmRank)

  const unack = alarms.filter((a) => !a.acknowledged).length
  const total = alarms.length

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="alarm-list-head">
        <span className="alh-title">Alarm List</span>
        <span className="alh-counts">
          Unack: <b>{unack}</b>&nbsp;&nbsp; Total: <b>{total}</b>&nbsp;&nbsp; Suppressed: <b>0</b>
        </span>
      </div>
      <div className="toolbar-row">
        {(['ALL', 'CRITICAL', 'WARNING', 'ADVISORY', 'UNACK'] as Filter[]).map((f) => (
          <button key={f} className={'tbtn sm' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        {tagFilter && (
          <button className="tbtn sm active" onClick={() => setTagFilter(null)}>
            Tag: {tagFilter} ✕
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="tbtn sm" onClick={ackAll} disabled={unack === 0}>
          Acknowledge All ({unack})
        </button>
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        <table className="alarm-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Ack</th>
              <th style={{ width: 118 }}>Time In</th>
              <th style={{ width: 112 }}>Module/Param</th>
              <th>Description</th>
              <th style={{ width: 70 }}>Alarm</th>
              <th style={{ width: 104 }}>Value</th>
              <th style={{ width: 96 }}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--dv-text-mute)', padding: 24 }}>
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
  const cls = a.priority.toLowerCase() + (a.active ? '' : ' rtn') + (a.acknowledged ? '' : ' unack')
  const linkColor = a.priority === 'WARNING' ? '#0a4a85' : '#fff'
  return (
    <tr className={cls}>
      <td className="alm-ack" onClick={onAck} title={a.acknowledged ? 'Acknowledged' : 'Acknowledge'}>
        <span className="alm-ackbox">{a.acknowledged ? '✓' : ''}</span>
      </td>
      <td style={{ opacity: 0.9 }}>{clockString(a.time)}</td>
      <td>
        <a style={{ color: linkColor, cursor: 'pointer', fontWeight: 700 }} onClick={onOpen}>
          {a.moduleTag}
        </a>
      </td>
      <td>{a.moduleDesc}</td>
      <td style={{ fontWeight: 700 }}>
        {a.label}
        {!a.active ? ' (RTN)' : ''}
      </td>
      <td>{a.unit ? `${a.value.toFixed(1)} ${a.unit}` : '—'}</td>
      <td style={{ fontWeight: 700 }}>{a.priority}</td>
    </tr>
  )
}
