import { useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm, fmt } from '../utils/format'
import type { AnyModule } from '../engine/types'

// DeltaV Explorer-style system hierarchy: Process Cell > Area > Control Modules.

const AREAS = ['FEED', 'REACTOR', 'PRODUCT'] as const
const AREA_LABEL: Record<string, string> = {
  FEED: 'FEED',
  REACTOR: 'REACTOR',
  PRODUCT: 'PRODUCT'
}

const TYPE_BADGE: Record<AnyModule['type'], string> = {
  PID: 'PID',
  AI: 'AI',
  MOTOR: 'MTR',
  VALVE: 'XV',
  DI: 'DI',
  DO: 'DO'
}

function statusText(m: AnyModule): { text: string; color: string } {
  switch (m.type) {
    case 'PID':
      return { text: `${fmt(m.pv, m.decimals)} ${m.unit} · ${m.mode}`, color: '#7fe0a8' }
    case 'AI':
      return { text: `${fmt(m.pv, m.decimals)} ${m.unit}`, color: '#7fe0a8' }
    case 'MOTOR':
      return m.fault
        ? { text: 'FAULT', color: '#ff8a8f' }
        : { text: m.running ? 'RUNNING' : 'STOPPED', color: m.running ? '#6ee08a' : '#9fb0c0' }
    case 'VALVE':
      return m.fault
        ? { text: 'FAULT', color: '#ff8a8f' }
        : { text: m.open ? 'OPEN' : 'CLOSED', color: m.open ? '#6ee08a' : '#9fb0c0' }
    default:
      return {
        text: m.state ? m.activeDescriptor : m.inactiveDescriptor,
        color: m.state ? '#6ee08a' : '#9fb0c0'
      }
  }
}

export function ExplorerDisplay(): JSX.Element {
  const modules = useStore((s) => s.modules)
  const alarms = useStore((s) => s.alarms)
  const selectedTag = useUi((s) => s.selectedTag)
  const select = useUi((s) => s.select)
  const openStudio = useUi((s) => s.openStudio)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const [open, setOpen] = useState<Record<string, boolean>>({
    CELL: true,
    FEED: true,
    REACTOR: true,
    PRODUCT: true
  })

  const toggle = (k: string): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const list = Object.values(modules)
  const selected = selectedTag ? modules[selectedTag] : undefined

  return (
    <div className="display explorer">
      <div className="explorer-tree">
        <div className="exp-node exp-cell" onClick={() => toggle('CELL')}>
          <span className="exp-caret">{open.CELL ? '▾' : '▸'}</span>
          <span className="exp-ico">▦</span>
          <b>REACTOR_CELL</b>
          <span className="exp-sub">Process Cell</span>
        </div>
        {open.CELL &&
          AREAS.map((area) => {
            const mods = list.filter((m) => m.area === area)
            return (
              <div key={area}>
                <div className="exp-node exp-area" onClick={() => toggle(area)}>
                  <span className="exp-caret">{open[area] ? '▾' : '▸'}</span>
                  <span className="exp-ico">▧</span>
                  {AREA_LABEL[area]}
                  <span className="exp-sub">{mods.length} modules</span>
                </div>
                {open[area] &&
                  mods.map((m) => {
                    const alm = moduleAlarm(m.tag, alarms)
                    const st = statusText(m)
                    return (
                      <div
                        key={m.tag}
                        className={'exp-node exp-mod' + (selectedTag === m.tag ? ' sel' : '')}
                        onClick={() => select(m.tag)}
                        onDoubleClick={() => openStudio(m.tag)}
                      >
                        <span className="exp-caret" />
                        <span className="exp-badge">{TYPE_BADGE[m.type]}</span>
                        <b className="exp-tag">{m.tag}</b>
                        <span className="exp-desc">{m.description}</span>
                        <span className="exp-status" style={{ color: st.color }}>
                          {st.text}
                        </span>
                        {alm && <span className={'exp-alm ' + alm.priority.toLowerCase()}>●</span>}
                      </div>
                    )
                  })}
              </div>
            )
          })}
      </div>

      <div className="explorer-detail">
        {!selected ? (
          <div className="exp-empty">Select a control module to view its properties.</div>
        ) : (
          <ModuleProperties module={selected} onStudio={() => openStudio(selected.tag)} onFaceplate={() => openFaceplate(selected.tag)} />
        )}
      </div>
    </div>
  )
}

function ModuleProperties({
  module: m,
  onStudio,
  onFaceplate
}: {
  module: AnyModule
  onStudio: () => void
  onFaceplate: () => void
}): JSX.Element {
  const rows: [string, string][] = [
    ['Tag', m.tag],
    ['Description', m.description],
    ['Type', m.type],
    ['Area', m.area]
  ]
  if (m.type === 'PID') {
    rows.push(
      ['Mode', m.mode],
      ['PV', `${fmt(m.pv, m.decimals)} ${m.unit}`],
      ['SP', `${fmt(m.sp, m.decimals)} ${m.unit}`],
      ['OUT', `${fmt(m.out, 1)} %`],
      ['Range', `${fmt(m.pvMin, 0)} – ${fmt(m.pvMax, 0)} ${m.unit}`],
      ['Gain / Reset / Rate', `${m.gain} / ${m.reset}s / ${m.rate}s`],
      ['Acting', m.direct ? 'Direct' : 'Reverse']
    )
    if (m.casSource) rows.push(['Cascade Source', m.casSource])
  } else if (m.type === 'AI') {
    rows.push(['PV', `${fmt(m.pv, m.decimals)} ${m.unit}`], ['Range', `${fmt(m.pvMin, 0)} – ${fmt(m.pvMax, 0)} ${m.unit}`])
  } else if (m.type === 'MOTOR') {
    rows.push(
      ['State', m.fault ? 'FAULT' : m.running ? 'RUNNING' : 'STOPPED'],
      ['Commanded', m.commanded ? 'START' : 'STOP'],
      ['Interlock', m.interlock ? 'ACTIVE' : 'clear'],
      ['Runtime', `${fmt(m.runtimeHrs, 1)} h`]
    )
  } else if (m.type === 'VALVE') {
    rows.push(
      ['State', m.fault ? 'FAULT' : m.open ? 'OPEN' : 'CLOSED'],
      ['Commanded', m.commandedOpen ? 'OPEN' : 'CLOSE'],
      ['Interlock', m.interlock ? 'ACTIVE' : 'clear']
    )
  } else {
    rows.push(['State', m.state ? m.activeDescriptor : m.inactiveDescriptor])
  }

  return (
    <div className="exp-props">
      <div className="exp-props-head">
        <b>{m.tag}</b>
        <span>{m.description}</span>
        <div className="exp-props-actions">
          <button className="tbtn sm" onClick={onStudio}>
            Control Studio
          </button>
          <button className="tbtn sm" onClick={onFaceplate}>
            Faceplate
          </button>
        </div>
      </div>
      <table className="exp-props-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="k">{k}</td>
              <td className="v">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="exp-props-alarms">
        <div className="exp-props-subhead">Configured Alarms</div>
        {m.alarms.length === 0 ? (
          <div className="exp-empty sm">No alarms configured</div>
        ) : (
          m.alarms.map((a) => (
            <div key={a.type} className="exp-alm-row">
              <span className={'prio-chip ' + a.priority.toLowerCase()} />
              <span className="exp-alm-type">{a.label}</span>
              <span className="exp-alm-lim">{a.limit !== undefined ? fmt(a.limit, 0) : '—'}</span>
              <span className="exp-alm-pri">{a.priority}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
