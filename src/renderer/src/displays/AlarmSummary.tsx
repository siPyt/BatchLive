import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { alarmArea } from '../engine/deviceAlarms'
import { modulePath } from '../engine/hierarchy'
import { isSfcAlarm } from '../engine/sfcBlocks'
import { useUi } from '../ui/uiStore'
import { compareAlarmRank, alarmColumnText, ALARM_COLUMNS, loadAlarmColumns, saveAlarmColumns } from '../utils/format'
import type { ActiveAlarm, AlarmPriority, AnyModule } from '../engine/types'
import type { AlarmColumnKey } from '../utils/format'

type Filter = 'ALL' | AlarmPriority | 'UNACK' | 'SHELVED'

export function AlarmSummary(): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  const modules = useStore((s) => s.modules)
  const hardware = useStore((s) => s.hardware)
  const equipment = useStore((s) => s.equipment)
  const processCells = useStore((s) => s.processCells)
  const units = useStore((s) => s.units)
  const areas = useStore((s) => s.areas)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const ackAll = useStore((s) => s.ackAll)
  const shelveAlarm = useStore((s) => s.shelveAlarm)
  const unshelveAlarm = useStore((s) => s.unshelveAlarm)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const openSfc = useUi(s => s.openSfc)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [columns, setColumns] = useState<AlarmColumnKey[]>(() => loadAlarmColumns())
  const [columnPickerOpen, setColumnPickerOpen] = useState(false)

  function toggleColumn(key: AlarmColumnKey): void {
    setColumns((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
      saveAlarmColumns(next)
      return next
    })
  }
  function moveColumn(key: AlarmColumnKey, dir: -1 | 1): void {
    setColumns((cur) => {
      const i = cur.indexOf(key)
      const j = i + dir
      if (i === -1 || j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[i], next[j]] = [next[j], next[i]]
      saveAlarmColumns(next)
      return next
    })
  }

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
  else if (filter === 'SHELVED') rows = rows.filter((a) => a.shelvedUntil !== undefined)
  else if (filter !== 'ALL') rows = rows.filter((a) => a.priority === filter)

  rows.sort(compareAlarmRank)

  const unack = alarms.filter((a) => !a.acknowledged).length
  const total = alarms.length
  const shelved = alarms.filter((a) => a.shelvedUntil !== undefined).length

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="alarm-list-head">
        <span className="alh-title">Alarm List</span>
        <span className="alh-counts">
          Unack: <b>{unack}</b>&nbsp;&nbsp; Total: <b>{total}</b>&nbsp;&nbsp; Suppressed: <b>{shelved}</b>
        </span>
      </div>
      <div className="toolbar-row">
        {(['ALL', 'CRITICAL', 'WARNING', 'ADVISORY', 'UNACK', 'SHELVED'] as Filter[]).map((f) => (
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
        <div style={{ position: 'relative' }}>
          <button className={'tbtn sm' + (columnPickerOpen ? ' active' : '')}
            title="Configure/Quick Edit/Properties: choose and reorder alarm-summary columns"
            onClick={() => setColumnPickerOpen((v) => !v)}>
            Configure Columns ▾
          </button>
          {columnPickerOpen && (
            <div className="alm-colpicker">
              {ALARM_COLUMNS.map((c) => {
                const idx = columns.indexOf(c.key)
                return (
                  <div key={c.key} className="alm-colpicker-row">
                    <label>
                      <input type="checkbox" checked={idx !== -1} onChange={() => toggleColumn(c.key)} />
                      {c.label}
                    </label>
                    {idx !== -1 && (
                      <span className="alm-colpicker-move">
                        <button className="tbtn sm" disabled={idx === 0} onClick={() => moveColumn(c.key, -1)}>↑</button>
                        <button className="tbtn sm" disabled={idx === columns.length - 1}
                          onClick={() => moveColumn(c.key, 1)}>↓</button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <button className="tbtn sm" onClick={ackAll} disabled={unack === 0}>
          Acknowledge All ({unack})
        </button>
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        <table className="alarm-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Ack</th>
              {columns.map((key) => (
                <th key={key}>{ALARM_COLUMNS.find((c) => c.key === key)?.label}</th>
              ))}
              <th style={{ width: 90 }}>Shelve</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} style={{ textAlign: 'center', color: 'var(--dv-text-mute)', padding: 24 }}>
                  No alarms match this filter
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <AlarmRow
                key={a.id}
                a={a}
                columns={columns}
                module={modules[a.moduleTag]}
                area={alarmArea(a, modules, hardware)}
                unit={modules[a.moduleTag] ? modulePath(modules[a.moduleTag], { areas, processCells, units, equipment }).unit : undefined}
                onAck={() => ackAlarm(a.id)}
                onOpen={() => isSfcAlarm(a) ? openSfc(a.moduleTag) : openFaceplate(a.moduleTag)}
                onShelve={() => shelveAlarm(a.id, 60)}
                onUnshelve={() => unshelveAlarm(a.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AlarmRow({
  a,
  columns,
  module,
  onAck,
  onOpen,
  onShelve,
  onUnshelve,
  area,
  unit
}: {
  a: ActiveAlarm
  columns: AlarmColumnKey[]
  module: AnyModule | undefined
  area?: string
  unit?: string
  onAck: () => void
  onOpen: () => void
  onShelve: () => void
  onUnshelve: () => void
}): JSX.Element {
  const shelved = a.shelvedUntil !== undefined
  const cls = a.priority.toLowerCase() + (a.active ? '' : ' rtn') + (a.acknowledged ? '' : ' unack')
  const linkColor = a.priority === 'WARNING' ? '#0a4a85' : '#fff'
  const boldColumns: AlarmColumnKey[] = ['alarm', 'priority']
  return (
    <tr className={cls} style={shelved ? { opacity: 0.55 } : undefined}>
      <td className="alm-ack" onClick={onAck} title={a.acknowledged ? 'Acknowledged' : 'Acknowledge'}>
        <span className="alm-ackbox">{a.acknowledged ? '✓' : ''}</span>
      </td>
      {columns.map((key) =>
        key === 'module' ? (
          <td key={key}>
            <a style={{ color: linkColor, cursor: 'pointer', fontWeight: 700 }} onClick={onOpen}>
              {alarmColumnText(key, a, module, area, unit)}
            </a>
          </td>
        ) : (
          <td key={key} style={boldColumns.includes(key) ? { fontWeight: 700 } : undefined}>
            {alarmColumnText(key, a, module, area, unit)}
          </td>
        )
      )}
      <td>
        {shelved ? (
          <button className="tbtn sm" onClick={onUnshelve} title="Unshelve">
            Unshelve
          </button>
        ) : (
          <button className="tbtn sm" onClick={onShelve} title="Shelve for 1 hour (ISA-18.2)">
            Shelve 1h
          </button>
        )}
      </td>
    </tr>
  )
}
