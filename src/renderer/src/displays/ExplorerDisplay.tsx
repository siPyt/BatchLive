import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm, fmt } from '../utils/format'
import { BUILTIN_TAGS, type NewModuleSpec } from '../engine/plant'
import type { AnyModule, AlarmPriority, ModuleType, FbBlockType } from '../engine/types'
import { ModuleIcon } from '../components/EngineeringIcons'
import { ModuleDisplayControls } from '../components/ModuleDisplayControls'
import { nextAreaName } from '../engine/areas'
import { moduleNameError } from '../engine/naming'
import { NamedSetControls } from '../components/NamedSetControls'
import { SfcLifecycleControls } from '../components/SfcLifecycleControls'
import { LicensingProperties } from '../components/LicensingProperties'

// DeltaV Explorer-style system hierarchy:
// Process Cell > Area > Unit (Equipment Module) > Control Module.

const AREA_LABEL: Record<string, string> = {
  FEED: 'FEED',
  REACTOR: 'REACTOR',
  PRODUCT: 'PRODUCT',
  WFI: 'WFI',
  AUTOCLAVE: 'AUTOCLAVE',
  LYO: 'LYOPHILIZATION'
}

const TYPE_BADGE: Record<AnyModule['type'], string> = {
  AO: 'AO',
  PID: 'PID',
  AI: 'AI',
  MOTOR: 'MTR',
  VALVE: 'XV',
  DI: 'DI',
  DO: 'DO',
  FB: 'FB'
}

function statusText(m: AnyModule): { text: string; color: string } {
  switch (m.type) {
    case 'PID':
      return { text: `${fmt(m.pv, m.decimals)} ${m.unit} · ${m.mode}`, color: 'var(--dv-pv)' }
    case 'AI':
      return { text: `${fmt(m.pv, m.decimals)} ${m.unit}`, color: 'var(--dv-pv)' }
    case 'AO':
      return { text: `${fmt(m.out, 1)} % - ${m.actualMode} - ${m.bad ? 'Bad' : 'Good'}`,
        color: m.bad ? 'var(--dv-critical)' : 'var(--dv-pv)' }
    case 'MOTOR':
      return m.fault
        ? { text: 'FAULT', color: '#c0202a' }
        : { text: m.running ? 'RUNNING' : 'STOPPED', color: m.running ? '#1f8a4c' : 'var(--dv-text-mute)' }
    case 'VALVE':
      return m.fault
        ? { text: 'FAULT', color: '#c0202a' }
        : { text: m.open ? 'OPEN' : 'CLOSED', color: m.open ? '#1f8a4c' : 'var(--dv-text-mute)' }
    case 'FB':
      return { text: `${m.fbType} = ${fmt(m.out, 2)}`, color: 'var(--dv-pv)' }
    default:
      return {
        text: m.state ? m.activeDescriptor : m.inactiveDescriptor,
        color: m.state ? '#1f8a4c' : 'var(--dv-text-mute)'
      }
  }
}

export function ExplorerDisplay(): JSX.Element {
  const modules = useStore((s) => s.modules)
  const sfcs = useStore(s => s.sfcs)
  const alarms = useStore((s) => s.alarms)
  const equipment = useStore((s) => s.equipment)
  const areas = useStore((s) => s.areas)
  const namedSets = useStore(s => s.namedSets.configured)
  const addArea = useStore((s) => s.createArea)
  const renameArea = useStore((s) => s.renameArea)
  const deleteModule = useStore((s) => s.deleteModule)
  const deleteEquipmentModule = useStore((s) => s.deleteEquipmentModule)
  const selectedTag = useUi((s) => s.selectedTag)
  const select = useUi((s) => s.select)
  const openStudio = useUi((s) => s.openStudio)
  const openSfc = useUi(s => s.openSfc)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const [open, setOpen] = useState<Record<string, boolean>>({
    CELL: true,
    FEED: true,
    REACTOR: true,
    PRODUCT: true
  })
  const [createArea, setCreateArea] = useState<string | null>(null)
  const [createEmArea, setCreateEmArea] = useState<string | null>(null)
  const [newModuleEm, setNewModuleEm] = useState<string | undefined>(undefined)
  const [editingArea, setEditingArea] = useState<{ original: string; value: string } | null>(null)
  const [setupView, setSetupView] = useState<'modules' | 'namedSets' | 'licensing'>('modules')
  const [selectedNamedSet, setSelectedNamedSet] = useState<string | null>(null)
  const [namedSetCreateRequest, setNamedSetCreateRequest] = useState(0)
  const [namedSetPropertiesRequest, setNamedSetPropertiesRequest] =
    useState<{ name: string; serial: number } | null>(null)
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: 'strategies' | 'area' | 'module' | 'sfc' | 'em' | 'namedSets' | 'namedSet'; target: string } | null
  >(null)

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
  const selectedSfc = selectedTag ? sfcs[selectedTag] : undefined
  const newArea = (): void => {
    const name = nextAreaName(areas)
    if (addArea(name)) {
      setOpen(o => ({ ...o, CELL: true, [name]: true }))
      setEditingArea({ original: name, value: name })
    }
    setMenu(null)
  }

  const finishAreaRename = (): void => {
    if (!editingArea) return
    if (renameArea(editingArea.original, editingArea.value)) {
      const name = editingArea.value.trim().toUpperCase()
      setOpen(o => ({ ...o, [name]: o[editingArea.original] ?? true }))
      setEditingArea(null)
    }
  }

  const renderModuleRow = (m: AnyModule, nested: boolean): JSX.Element => {
    const alm = moduleAlarm(m.tag, alarms)
    const st = statusText(m)
    return (
      <div
        key={m.tag}
        className={'exp-node exp-mod' + (nested ? ' nested' : '') + (selectedTag === m.tag ? ' sel' : '')}
        onClick={() => { setSetupView('modules'); select(m.tag) }}
        onDoubleClick={() => openStudio(m.tag)}
        onContextMenu={(e) => {
          e.preventDefault()
          setSetupView('modules')
          select(m.tag)
          setMenu({ x: e.clientX, y: e.clientY, kind: 'module', target: m.tag })
        }}
      >
        <span className="exp-caret" />
        <ModuleIcon kind="control" />
        <span className="exp-badge">{TYPE_BADGE[m.type]}</span>
        <b className="exp-tag">{m.tag}</b>
        <span className="exp-desc">{m.description}</span>
        <span className="exp-status" style={{ color: st.color }}>
          {st.text}
        </span>
        {alm && <span className={'exp-alm ' + alm.priority.toLowerCase()}>●</span>}
      </div>
    )
  }

  return (
    <div className="display explorer">
      <div className="explorer-tree">
        <div className="exp-toolbar">
          <button className="tbtn sm" onClick={() => setCreateArea((v) => (v ? null : areas[0]))}>
            {createArea ? '✕ Cancel' : '＋ New Module'}
          </button>
          <button className="tbtn sm" onClick={newArea}>New Area</button>
          <span className="exp-hint">right-click an Area → New ▸ Control Module / Equipment Module</span>
        </div>
        {createArea && (
          <NewModuleForm
            initialArea={createArea}
            initialEquipment={newModuleEm}
            onDone={() => {
              setCreateArea(null)
              setNewModuleEm(undefined)
            }}
          />
        )}
        {createEmArea && (
          <NewEquipmentModuleForm initialArea={createEmArea} onDone={() => setCreateEmArea(null)} />
        )}
        <div className="exp-node exp-cell" onClick={() => toggle('SETUP')}>
          <span className="exp-caret">{open.SETUP === false ? '▸' : '▾'}</span>
          <b>Setup</b>
        </div>
        {open.SETUP !== false && <>
          <div className={'exp-node exp-area' + (setupView === 'namedSets' && !selectedNamedSet ? ' sel' : '')}
            onClick={() => { setSetupView('namedSets'); setSelectedNamedSet(null) }}
            onContextMenu={e => {
              e.preventDefault(); setSetupView('namedSets'); setSelectedNamedSet(null)
              setMenu({ x: e.clientX, y: e.clientY, kind: 'namedSets', target: 'Named Sets' })
            }}>
            <b>Named Sets</b>
          </div>
          {Object.keys(namedSets).map(name => <div key={name}
            className={'exp-node exp-mod nested' + (setupView === 'namedSets' && selectedNamedSet === name ? ' sel' : '')}
            onClick={() => { setSetupView('namedSets'); setSelectedNamedSet(name) }}
            onDoubleClick={() => setNamedSetPropertiesRequest(previous => ({ name, serial: (previous?.serial ?? 0) + 1 }))}
            onContextMenu={e => {
              e.preventDefault(); setSetupView('namedSets'); setSelectedNamedSet(name)
              setMenu({ x: e.clientX, y: e.clientY, kind: 'namedSet', target: name })
            }}>
            <b>{name}</b>
          </div>)}
        </>}
        <div className="exp-node exp-cell" onClick={() => toggle('PROPLUS')}>
          <span className="exp-caret">{open.PROPLUS === false ? '▸' : '▾'}</span><b>ProfessionalPLUS (simulated)</b>
        </div>
        {open.PROPLUS !== false && <button className={'exp-node exp-area' + (setupView === 'licensing' ? ' sel' : '')}
          onClick={() => setSetupView('licensing')}>Licensing Properties</button>}
        <div
          className="exp-node exp-cell"
          onContextMenu={e => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, kind: 'strategies', target: 'Control Strategies' })
          }}
        >
          <b>Control Strategies</b>
        </div>
        <div className="exp-node exp-cell" onClick={() => toggle('CELL')}>
          <span className="exp-caret">{open.CELL ? '▾' : '▸'}</span>
          <ModuleIcon kind="cell" />
          <b>REACTOR_CELL</b>
          <span className="exp-sub">Process Cell</span>
        </div>
        {open.CELL &&
          areas.map((area) => {
            const mods = list.filter((m) => m.area === area)
            const ems = Object.values(equipment).filter((em) => em.area === area)
            const areaSfcs = Object.values(sfcs).filter(sfc => sfc.area === area)
            const unassigned = mods.filter((m) => !m.equipmentModule || !equipment[m.equipmentModule])
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
                  <ModuleIcon kind="area" />
                  {editingArea?.original === area ? (
                    <input
                      aria-label="Area name"
                      className="exp-area-editor"
                      autoFocus
                      value={editingArea.value}
                      onFocus={e => e.target.select()}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setEditingArea({ original: area, value: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          finishAreaRename()
                        } else if (e.key === 'Escape') setEditingArea(null)
                      }}
                    />
                  ) : <span className="exp-area-name" title={area}>{AREA_LABEL[area] ?? area}</span>}
                  <span className="exp-sub">{mods.length + areaSfcs.length} modules</span>
                </div>
                {open[area] && (
                  <>
                    {ems.map((em) => {
                      const emKey = `EM:${em.tag}`
                      const emMods = mods.filter((m) => m.equipmentModule === em.tag)
                      return (
                        <div key={em.tag}>
                          <div
                            className="exp-node exp-em"
                            onClick={() => toggle(emKey)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setMenu({ x: e.clientX, y: e.clientY, kind: 'em', target: em.tag })
                            }}
                          >
                            <span className="exp-caret">{open[emKey] ? '▾' : '▸'}</span>
                            <ModuleIcon kind="equipment" />
                            {em.tag}
                            <span className="exp-sub">
                              {em.description} · {emMods.length} modules
                            </span>
                          </div>
                          {open[emKey] && emMods.map((m) => renderModuleRow(m, true))}
                        </div>
                      )
                    })}
                    {unassigned.length > 0 && (
                      <div>
                        <div className="exp-node exp-em unassigned">
                          <span className="exp-caret">▾</span>
                          <ModuleIcon kind="unassigned" />
                          (Unassigned)
                          <span className="exp-sub">{unassigned.length} modules</span>
                        </div>
                        {unassigned.map((m) => renderModuleRow(m, true))}
                      </div>
                    )}
                    {areaSfcs.map(sfc => <div key={sfc.name}
                      className={'exp-node exp-mod' + (selectedTag === sfc.name ? ' sel' : '')}
                      onClick={() => { setSetupView('modules'); select(sfc.name) }}
                      onDoubleClick={() => openSfc(sfc.name)}
                      onContextMenu={event => {
                        event.preventDefault(); setSetupView('modules'); select(sfc.name)
                        setMenu({ x: event.clientX, y: event.clientY, kind: 'sfc', target: sfc.name })
                      }}>
                      <span className="exp-caret" /><ModuleIcon kind="control" />
                      <span className="exp-badge">SFC</span><b className="exp-tag">{sfc.name}</b>
                      <span className="exp-status">{sfc.status}</span>
                    </div>)}
                  </>
                )}
              </div>
            )
          })}
      </div>

      <div className="explorer-detail">
        {setupView === 'licensing' ? <LicensingProperties /> : setupView === 'namedSets' ? (
          <NamedSetControls selected={selectedNamedSet} onSelect={setSelectedNamedSet}
            createRequest={namedSetCreateRequest} propertiesRequest={namedSetPropertiesRequest}
            onRequestsHandled={() => { setNamedSetCreateRequest(0); setNamedSetPropertiesRequest(null) }} />
        ) : selectedSfc ? (
          <div className="exp-props">
            <div className="exp-props-head">
              <b>{selectedSfc.name}</b><span>Sequential Function Chart · {selectedSfc.area}</span>
              <div className="exp-props-actions">
                <button className="tbtn sm" onClick={() => openSfc(selectedSfc.name)}>Open SFC</button>
              </div>
            </div>
            <SfcLifecycleControls name={selectedSfc.name} />
          </div>
        ) : !selected ? (
          <div className="exp-empty">Select a control module to view its properties.</div>
        ) : (
          <ModuleProperties module={selected} onStudio={() => openStudio(selected.tag)} onFaceplate={() => openFaceplate(selected.tag)} />
        )}
      </div>

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.kind === 'namedSets' ? (
            <>
              <div className="ctx-label">Named Sets</div>
              <button className="ctx-item" onClick={() => {
                setNamedSetCreateRequest(value => value + 1); setMenu(null)
              }}>New Named Set...</button>
            </>
          ) : menu.kind === 'namedSet' ? (
            <>
              <div className="ctx-label">{menu.target}</div>
              <button className="ctx-item" onClick={() => {
                setNamedSetPropertiesRequest(previous => ({ name: menu.target, serial: (previous?.serial ?? 0) + 1 }))
                setMenu(null)
              }}>Properties...</button>
            </>
          ) : menu.kind === 'strategies' ? (
            <>
              <div className="ctx-label">Control Strategies</div>
              <button className="ctx-item" onClick={newArea}>New Area</button>
            </>
          ) : menu.kind === 'area' ? (
            <>
              <div className="ctx-label">{menu.target}</div>
              <button className="ctx-item" onClick={() => {
                setEditingArea({ original: menu.target, value: menu.target })
                setMenu(null)
              }}>Rename</button>
              <div className="ctx-parent">New ▸</div>
              <button
                className="ctx-item ctx-sub"
                onClick={() => {
                  setNewModuleEm(undefined)
                  setCreateArea(menu.target)
                  setMenu(null)
                }}
              >
                Control Module…
              </button>
              <button
                className="ctx-item ctx-sub"
                onClick={() => {
                  setCreateEmArea(menu.target)
                  setMenu(null)
                }}
              >
                Equipment Module…
              </button>
            </>
          ) : menu.kind === 'sfc' ? (
            <>
              <div className="ctx-label">{menu.target}</div>
              <button className="ctx-item" onClick={() => { openSfc(menu.target); setMenu(null) }}>Open SFC</button>
            </>
          ) : menu.kind === 'em' ? (
            <>
              <div className="ctx-label">{menu.target}</div>
              <button
                className="ctx-item"
                onClick={() => {
                  const em = equipment[menu.target]
                  setNewModuleEm(menu.target)
                  setCreateArea(em?.area ?? 'FEED')
                  setMenu(null)
                }}
              >
                New ▸ Control Module…
              </button>
              <button
                className="ctx-item danger"
                onClick={() => {
                  deleteEquipmentModule(menu.target)
                  setMenu(null)
                }}
              >
                Delete Equipment Module
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
  const equipment = useStore((s) => s.equipment)
  const setModuleEquipment = useStore((s) => s.setModuleEquipment)
  const select = useUi((s) => s.select)
  const builtin = BUILTIN_TAGS.has(m.tag)
  const emsInArea = Object.values(equipment).filter((em) => em.area === m.area)
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
  } else if (m.type === 'AO') {
    rows.push(['Mode Target / Actual', `${m.mode} / ${m.actualMode}`],
      ['SP', `${fmt(m.sp, m.decimals)} ${m.unit}`], ['Applied output', `${fmt(m.out, 1)} %`],
      ['PV_SCALE', `${m.pvMin} - ${m.pvMax} ${m.unit}`], ['Quality', m.bad ? 'Bad' : 'Good'])
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
  } else if (m.type === 'FB') {
    rows.push(
      ['Block', m.fbType],
      ['IN1', m.in1.kind === 'const' ? `${m.in1.value}` : m.in1.tag ?? ''],
      ['IN2', m.in2.kind === 'const' ? `${m.in2.value}` : m.in2.tag ?? ''],
      ['OUT', `${fmt(m.out, 3)}`]
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
      <div className="fp-row" style={{ padding: '4px 12px' }}>
        <span className="fp-label">Equipment Module</span>
        <select
          className="exp-alm-select"
          value={m.equipmentModule ?? ''}
          onChange={(e) => setModuleEquipment(m.tag, e.target.value || null)}
        >
          <option value="">(Unassigned)</option>
          {emsInArea.map((em) => (
            <option key={em.tag} value={em.tag}>
              {em.tag}
            </option>
          ))}
        </select>
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
      <ModuleDisplayControls tag={m.tag} />
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

function NewModuleForm({
  onDone,
  initialArea,
  initialEquipment
}: {
  onDone: () => void
  initialArea: string
  initialEquipment?: string
}): JSX.Element {
  const createModule = useStore((s) => s.createModule)
  const areas = useStore((s) => s.areas)
  const modules = useStore((s) => s.modules)
  const sfcs = useStore(s => s.sfcs)
  const equipment = useStore((s) => s.equipment)
  const select = useUi((s) => s.select)
  const [tag, setTag] = useState('')
  const [type, setType] = useState<ModuleType>('PID')
  const [algorithm, setAlgorithm] = useState<'FBD' | 'SFC'>('FBD')
  const [fbType, setFbType] = useState<FbBlockType>('ADD')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState(initialArea)
  const [em, setEm] = useState(initialEquipment ?? '')
  const [unit, setUnit] = useState('%')
  const [pvMin, setPvMin] = useState(0)
  const [pvMax, setPvMax] = useState(100)
  const [motorTemplate, setMotorTemplate] = useState(false)

  const analog = algorithm === 'FBD' && (type === 'PID' || type === 'AI' || type === 'AO')
  const normTag = tag.trim().toUpperCase()
  const nameError = moduleNameError(normTag)
  const exists = normTag.length > 0 && !!(modules[normTag] || sfcs[normTag])
  const areaExists = areas.includes(area)
  const valid = !nameError && !exists && areaExists
  const emsInArea = Object.values(equipment).filter((e) => e.area === area)

  const submit = (): void => {
    if (!valid) return
    if (algorithm === 'SFC') {
      if (!useStore.getState().createSfc(normTag, area, { managed: true })) return
      onDone()
      useUi.getState().openSfc(normTag)
      return
    }
    const spec: NewModuleSpec = {
      tag: normTag,
      type,
      fbType: type === 'FB' ? fbType : undefined,
      description: description.trim() || normTag,
      area,
      equipmentModule: em || undefined,
      unit: analog ? unit : undefined,
      pvMin: analog ? pvMin : undefined,
      pvMax: analog ? pvMax : undefined
    }
    if (type === 'MOTOR' && motorTemplate) {
      if (!useStore.getState().createMotorTemplate(normTag, area, spec.description)) return
      if (em) useStore.getState().setModuleEquipment(normTag, em)
      select(normTag)
      onDone()
      useUi.getState().openStudio(normTag)
      return
    }
    if (!createModule(spec)) return
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
        Algorithm Type
        <select aria-label="New module algorithm type" value={algorithm} onChange={e => setAlgorithm(e.target.value === 'SFC' ? 'SFC' : 'FBD')}>
          <option value="FBD">Function Block Diagram</option>
          <option value="SFC">Sequential Function Chart</option>
        </select>
      </label>
      {algorithm === 'FBD' && <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as ModuleType)}>
          <option value="PID">PID — Control Loop</option>
          <option value="AI">AI — Indicator</option>
          <option value="AO">AO — Analog Output</option>
          <option value="MOTOR">MOTOR</option>
          <option value="VALVE">VALVE (on/off)</option>
          <option value="DI">DI — Discrete Input</option>
          <option value="DO">DO — Discrete Output</option>
          <option value="FB">FB — Math/Logic/Timer Block</option>
        </select>
      </label>}
      {algorithm === 'FBD' && type === 'MOTOR' && <label>Module template
        <select aria-label="Motor module template" value={motorTemplate ? 'MTR-11_ILOCK' : 'LIVE'} onChange={e => setMotorTemplate(e.target.value === 'MTR-11_ILOCK')}>
          <option value="LIVE">Live standalone motor (existing behavior)</option>
          <option value="MTR-11_ILOCK">Library / Motors-2State / MTR-11_ILOCK - owned two-condition strategy</option>
        </select>
      </label>}
      {algorithm === 'FBD' && type === 'FB' && (
        <label>
          Block
          <select value={fbType} onChange={(e) => setFbType(e.target.value as FbBlockType)}>
            <optgroup label="I/O Blocks">
              <option value="ALARM">ALARM — Alarm Detection</option>
              <option value="MAI">MAI — Multiplexed Analog Input</option>
              <option value="FFMDI">FFMDI — Multiple Discrete Input</option>
              <option value="FFMDO">FFMDO — Multiple Discrete Output</option>
              <option value="PIN">PIN — Pulse Input</option>
            </optgroup>
            <optgroup label="Math Blocks">
              <option value="ABS">ABS — Absolute Value</option>
              <option value="ADD">ADD — Add</option>
              <option value="ARITH">ARITH — Arithmetic</option>
              <option value="CMP">CMP — Comparator</option>
              <option value="DIV">DIV — Divide</option>
              <option value="INT">INT — Integrator</option>
              <option value="MLTY">MLTY — Multiply</option>
              <option value="SUB">SUB — Subtract</option>
            </optgroup>
            <optgroup label="Timer/Counter Blocks">
              <option value="CTR">CTR — Counter</option>
              <option value="DTE">DTE — Date Time Event</option>
              <option value="OND">OND — On-Delay Timer</option>
              <option value="OFFD">OFFD — Off-Delay Timer</option>
              <option value="RET">RET — Retentive Timer</option>
              <option value="TP">TP — Timed Pulse</option>
            </optgroup>
            <optgroup label="Logical Blocks">
              <option value="ACT">ACT — Action</option>
              <option value="AND">AND</option>
              <option value="BDE">BDE — Bi-directional Edge Trigger</option>
              <option value="BFI">BFI — Boolean Fan Input</option>
              <option value="BFO">BFO — Boolean Fan Output</option>
              <option value="CND">CND — Condition</option>
              <option value="MLTX">MLTX — Multiplexer</option>
              <option value="NDE">NDE — Negative Edge Trigger</option>
              <option value="NOT">NOT</option>
              <option value="OR">OR</option>
              <option value="PDE">PDE — Positive Edge Trigger</option>
              <option value="RS">RS — Reset/Set Flip-flop</option>
              <option value="SR">SR — Set/Reset Flip-flop</option>
            </optgroup>
            <optgroup label="Analog Control Blocks">
              <option value="BG">BG — Bias/Gain</option>
              <option value="CALC">CALC — Calculation/Logic</option>
              <option value="CTLSL">CTLSL — Control Selector</option>
              <option value="DT">DT — Deadtime</option>
              <option value="FLTR">FLTR — Filter</option>
              <option value="INSEL">INSEL — Input Selector</option>
              <option value="ISELX">ISELX — Input Selector Extended</option>
              <option value="LE">LE — Lab Entry</option>
              <option value="LL">LL — Lead/Lag</option>
              <option value="LIM">LIM — Limit</option>
              <option value="MANLD">MANLD — Manual Loader</option>
              <option value="RAMP">RAMP — Ramp</option>
              <option value="RTLM">RTLM — Rate Limit</option>
              <option value="RTO">RTO — Ratio</option>
              <option value="SCLR">SCLR — Scaler</option>
              <option value="SGCR">SGCR — Signal Characterizer</option>
              <option value="SGGN">SGGN — Signal Generator</option>
              <option value="SGSL">SGSL — Signal Selector</option>
              <option value="SPLTR">SPLTR — Splitter</option>
            </optgroup>
          </select>
        </label>
      )}
      {algorithm === 'FBD' && <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
      </label>}
      <label>
        Area
        <select
          value={area}
          onChange={(e) => {
            setArea(e.target.value)
            setEm('')
          }}
        >
          {!areaExists && <option value={area}>{area} (no longer exists)</option>}
          {areas.map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      {algorithm === 'FBD' && <label>
        Equipment Module
        <select value={em} onChange={(e) => setEm(e.target.value)}>
          <option value="">(Unassigned)</option>
          {emsInArea.map((e) => (
            <option key={e.tag} value={e.tag}>
              {e.tag}
            </option>
          ))}
        </select>
      </label>}
      {algorithm === 'SFC' && <p className="traditional-note">Creates an empty Offline SFC in the selected area; Save and Download are required before execution.
        Native templates, SFC description/equipment membership, palette and restart workflows are not yet implemented.</p>}
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
      {tag.length > 0 && nameError && <div className="exp-newmod-err">{nameError}</div>}
      {!areaExists && <div className="exp-newmod-err">Select an existing plant area.</div>}
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

function NewEquipmentModuleForm({
  onDone,
  initialArea
}: {
  onDone: () => void
  initialArea: string
}): JSX.Element {
  const createEquipmentModule = useStore((s) => s.createEquipmentModule)
  const areas = useStore((s) => s.areas)
  const equipment = useStore((s) => s.equipment)
  const [tag, setTag] = useState('')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState(initialArea)

  const normTag = tag.trim().toUpperCase()
  const exists = normTag.length > 0 && !!equipment[normTag]
  const areaExists = areas.includes(area)
  const valid = normTag.length > 0 && !exists && areaExists

  return (
    <div className="exp-newmod">
      <div className="exp-newmod-title">Create Equipment Module</div>
      <label>
        Tag
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. EM-FEED-DOSING" />
      </label>
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
      </label>
      <label>
        Area
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          {!areaExists && <option value={area}>{area} (no longer exists)</option>}
          {areas.map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      {exists && <div className="exp-newmod-err">Tag already exists</div>}
      {!areaExists && <div className="exp-newmod-err">Select an existing plant area.</div>}
      <div className="exp-newmod-actions">
        <button
          className="tbtn sm"
          disabled={!valid}
          onClick={() => {
            createEquipmentModule(normTag, description.trim() || normTag, area)
            if (!useStore.getState().equipment[normTag]) return
            onDone()
          }}
        >
          Create
        </button>
        <button className="tbtn sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
