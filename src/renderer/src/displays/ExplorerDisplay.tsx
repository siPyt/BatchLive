import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm, fmt } from '../utils/format'
import { BUILTIN_TAGS, type NewModuleSpec } from '../engine/plant'
import type { AnyModule, AlarmPriority, ModuleType } from '../engine/types'

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
      return { text: `${fmt(m.pv, m.decimals)} ${m.unit} · ${m.mode}`, color: 'var(--dv-pv)' }
    case 'AI':
      return { text: `${fmt(m.pv, m.decimals)} ${m.unit}`, color: 'var(--dv-pv)' }
    case 'MOTOR':
      return m.fault
        ? { text: 'FAULT', color: '#c0202a' }
        : { text: m.running ? 'RUNNING' : 'STOPPED', color: m.running ? '#1f8a4c' : 'var(--dv-text-mute)' }
    case 'VALVE':
      return m.fault
        ? { text: 'FAULT', color: '#c0202a' }
        : { text: m.open ? 'OPEN' : 'CLOSED', color: m.open ? '#1f8a4c' : 'var(--dv-text-mute)' }
    default:
      return {
        text: m.state ? m.activeDescriptor : m.inactiveDescriptor,
        color: m.state ? '#1f8a4c' : 'var(--dv-text-mute)'
      }
  }
}

export function ExplorerDisplay(): JSX.Element {
  const modules = useStore((s) => s.modules)
  const alarms = useStore((s) => s.alarms)
  const deleteModule = useStore((s) => s.deleteModule)
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
  const [createArea, setCreateArea] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'area' | 'module'; target: string } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const toggle = (k: string): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const list = Object.values(modules)
  const selected = selectedTag ? modules[selectedTag] : undefined

  return (
    <div className="display explorer">
      <div className="explorer-tree">
        <div className="exp-toolbar">
          <button className="tbtn sm" onClick={() => setCreateArea((v) => (v ? null : 'FEED'))}>
            {createArea ? '✕ Cancel' : '＋ New Module'}
          </button>
          <span className="exp-hint">right-click an Area → New ▸ Control Module</span>
        </div>
        {createArea && <NewModuleForm initialArea={createArea} onDone={() => setCreateArea(null)} />}
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
                <div
                  className="exp-node exp-area"
                  onClick={() => toggle(area)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, kind: 'area', target: area })
                  }}
                >
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
                        onContextMenu={(e) => {
                          e.preventDefault()
                          select(m.tag)
                          setMenu({ x: e.clientX, y: e.clientY, kind: 'module', target: m.tag })
                        }}
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

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.kind === 'area' ? (
            <>
              <div className="ctx-label">{menu.target}</div>
              <div className="ctx-parent">New ▸</div>
              <button
                className="ctx-item ctx-sub"
                onClick={() => {
                  setCreateArea(menu.target)
                  setMenu(null)
                }}
              >
                Control Module…
              </button>
            </>
          ) : (
            <>
              <div className="ctx-label">{menu.target}</div>
              <button
                className="ctx-item"
                onClick={() => {
                  openStudio(menu.target)
                  setMenu(null)
                }}
              >
                Open with Control Studio
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  openFaceplate(menu.target)
                  setMenu(null)
                }}
              >
                Open Faceplate
              </button>
              {!BUILTIN_TAGS.has(menu.target) && (
                <button
                  className="ctx-item danger"
                  onClick={() => {
                    deleteModule(menu.target)
                    select(null)
                    setMenu(null)
                  }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
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
  const setAlarmLimit = useStore((s) => s.setAlarmLimit)
  const deleteModule = useStore((s) => s.deleteModule)
  const select = useUi((s) => s.select)
  const builtin = BUILTIN_TAGS.has(m.tag)
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
          {!builtin && (
            <button
              className="tbtn sm danger"
              onClick={() => {
                deleteModule(m.tag)
                select(null)
              }}
            >
              Delete
            </button>
          )}
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
          <table className="exp-alm-cfg">
            <thead>
              <tr>
                <th>En</th>
                <th>Condition</th>
                <th>Limit</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {m.alarms.map((a) => (
                <tr key={a.type}>
                  <td>
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      onChange={(e) => setAlarmLimit(m.tag, a.type, { enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <span className={'prio-chip ' + a.priority.toLowerCase()} />
                    {a.label}
                  </td>
                  <td>
                    {a.limit !== undefined ? (
                      <input
                        className="exp-alm-input"
                        type="number"
                        value={a.limit}
                        onChange={(e) => setAlarmLimit(m.tag, a.type, { limit: Number(e.target.value) })}
                      />
                    ) : (
                      <span style={{ color: 'var(--dv-text-mute)' }}>—</span>
                    )}
                  </td>
                  <td>
                    <select
                      className="exp-alm-select"
                      value={a.priority}
                      onChange={(e) =>
                        setAlarmLimit(m.tag, a.type, { priority: e.target.value as AlarmPriority })
                      }
                    >
                      <option value="CRITICAL">CRITICAL</option>
                      <option value="WARNING">WARNING</option>
                      <option value="ADVISORY">ADVISORY</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function NewModuleForm({ onDone, initialArea }: { onDone: () => void; initialArea: string }): JSX.Element {
  const createModule = useStore((s) => s.createModule)
  const modules = useStore((s) => s.modules)
  const select = useUi((s) => s.select)
  const [tag, setTag] = useState('')
  const [type, setType] = useState<ModuleType>('PID')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState(initialArea)
  const [unit, setUnit] = useState('%')
  const [pvMin, setPvMin] = useState(0)
  const [pvMax, setPvMax] = useState(100)

  const analog = type === 'PID' || type === 'AI'
  const normTag = tag.trim().toUpperCase()
  const exists = normTag.length > 0 && !!modules[normTag]
  const valid = normTag.length > 0 && !exists

  const submit = (): void => {
    if (!valid) return
    const spec: NewModuleSpec = {
      tag: normTag,
      type,
      description: description.trim() || normTag,
      area,
      unit: analog ? unit : undefined,
      pvMin: analog ? pvMin : undefined,
      pvMax: analog ? pvMax : undefined
    }
    createModule(spec)
    select(normTag)
    onDone()
  }

  return (
    <div className="exp-newmod">
      <div className="exp-newmod-title">Create Control Module</div>
      <label>
        Tag
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. FIC-102" />
      </label>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as ModuleType)}>
          <option value="PID">PID — Control Loop</option>
          <option value="AI">AI — Indicator</option>
          <option value="MOTOR">MOTOR</option>
          <option value="VALVE">VALVE (on/off)</option>
          <option value="DI">DI — Discrete Input</option>
          <option value="DO">DO — Discrete Output</option>
        </select>
      </label>
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
      </label>
      <label>
        Area
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          <option>FEED</option>
          <option>REACTOR</option>
          <option>PRODUCT</option>
        </select>
      </label>
      {analog && (
        <div className="exp-newmod-range">
          <label>
            Unit
            <input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <label>
            Min
            <input type="number" value={pvMin} onChange={(e) => setPvMin(Number(e.target.value))} />
          </label>
          <label>
            Max
            <input type="number" value={pvMax} onChange={(e) => setPvMax(Number(e.target.value))} />
          </label>
        </div>
      )}
      {exists && <div className="exp-newmod-err">Tag already exists</div>}
      <div className="exp-newmod-actions">
        <button className="tbtn sm" disabled={!valid} onClick={submit}>
          Create
        </button>
        <button className="tbtn sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
