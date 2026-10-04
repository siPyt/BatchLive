import { useEffect, useState } from 'react'
import { SfcPropertiesDialog, type SfcPropertiesTarget } from '../components/SfcPropertiesDialog'
import { SfcLifecycleControls } from '../components/SfcLifecycleControls'
import { sfcEditorDefinition } from '../engine/sfcLifecycle'
import { SfcParameterControls } from '../components/SfcParameterControls'
import { sfcExpressionContext, useStore } from '../engine/store'
import {
  describeAction,
  describeCondition,
  actionIdentity,
  TIMED_QUALIFIERS,
  evalCondition,
  newStep,
  type SfcDef,
  type SfcStep,
  type SfcAction,
  type SfcCondition,
  type CompareOp,
  type ActionQualifier
} from '../engine/sfc'
import type { AnyModule, PlantState } from '../engine/types'

const STATUS_COLOR: Record<SfcDef['status'], string> = {
  READY: '#9aa0a7',
  RUNNING: '#37b24d',
  HELD: '#f2c313',
  COMPLETE: '#1aa7ec'
}

export function SfcDisplay(): JSX.Element {
  const sfcs = useStore((s) => s.sfcs)
  const lifecycles = useStore(s => s.sfcLifecycle)
  const createSfc = useStore((s) => s.createSfc)
  const areas = useStore((s) => s.areas)
  const names = Object.keys(sfcs)
  const [selected, setSelected] = useState<string>(names[0] ?? '')
  const [newName, setNewName] = useState('')
  const [newArea, setNewArea] = useState('FEED')

  const runtime = sfcs[selected]
  const sfc = runtime ? sfcEditorDefinition(runtime, lifecycles[selected]) : undefined

  return (
    <div className="display sfc">
      <div className="sfc-list">
        <div className="exp-toolbar" style={{ display: 'flex', gap: 6 }}>
          <input
            className="sfc-newinput"
            placeholder="New SFC name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select className="exp-alm-select" value={newArea} onChange={(e) => setNewArea(e.target.value)}>
            {!areas.includes(newArea) && <option value={newArea}>{newArea} (no longer exists)</option>}
            {areas.map(name => <option key={name}>{name}</option>)}
          </select>
          <button
            className="tbtn sm"
            disabled={!newName.trim() || !areas.includes(newArea)}
            onClick={() => {
              createSfc(newName, newArea)
              if (!useStore.getState().sfcs[newName.trim().toUpperCase()]) return
              setSelected(newName.trim().toUpperCase())
              setNewName('')
            }}
          >
            Create
          </button>
        </div>
        {names.map((n) => (
          <div
            key={n}
            className={'sfc-listitem' + (selected === n ? ' sel' : '')}
            onClick={() => setSelected(n)}
          >
            <span className="sfc-ico">⇵</span>
            <b>{n}</b>
            <span className="sfc-dot" style={{ background: STATUS_COLOR[sfcs[n].status] }} />
          </div>
        ))}
      </div>

      <div className="sfc-detail">
        {!sfc ? <div className="exp-empty">Select or create an SFC.</div> : <SfcEditor key={sfc.name} sfc={sfc} />}
      </div>
    </div>
  )
}

function SfcEditor({ sfc }: { sfc: SfcDef }): JSX.Element {
  const lifecycle = useStore(s => s.sfcLifecycle[sfc.name])
  const runtimeStatus = useStore(s => s.sfcs[sfc.name]?.status)
  const modules = useStore((s) => s.modules)
  const setSfcSteps = useStore((s) => s.setSfcSteps)
  const sfcCommand = useStore((s) => s.sfcCommand)
  const deleteSfc = useStore((s) => s.deleteSfc)
  const editable = !lifecycle?.online && (runtimeStatus === 'READY' || runtimeStatus === 'COMPLETE')
  const [selected, setSelected] = useState<number | null>(null)
  const [properties, setProperties] = useState<SfcPropertiesTarget | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: SfcPropertiesTarget } | null>(null)
  const [check, setCheck] = useState<{ steps: SfcStep[]; error: string | null } | null>(null)
  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.ctx-menu')) setMenu(null)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => { if (!editable) { setProperties(null); setMenu(null) } }, [editable])
  const context = (target: SfcPropertiesTarget, x: number, y: number): void => {
    if (!editable) return
    setSelected(sfc.steps.findIndex(step => step.id === target.step.id))
    setMenu({ target, x: Math.min(x, window.innerWidth - 210), y: Math.min(y, window.innerHeight - 130) })
  }

  const update = (steps: SfcStep[]): void => setSfcSteps(sfc.name, steps)
  const setStep = (i: number, patch: Partial<SfcStep>): void =>
    update(sfc.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  return (
    <>
      <div className="sfc-toolbar">
        <span className="sfc-title">{sfc.name}</span>
        <span className="sfc-area">{sfc.area}</span>
        <span className="sfc-status" style={{ background: STATUS_COLOR[sfc.status] }}>
          {sfc.status}
        </span>
        <span style={{ flex: 1 }} />
        <button className="tbtn sm" onClick={() => setCheck({ steps: sfc.steps, error: useStore.getState().checkSfc(sfc.name) })}>Check</button>
        {/* S88 Phase Routine tabs — RUN/HOLD map to real engine commands; RESTART
         * re-runs from the current state, STOP/ABORT reset (the engine does not
         * yet distinguish a controlled stop from an abort). */}
        <div className="sfc-phase-tabs">
          <button className="sfc-tab" disabled={!!lifecycle && !lifecycle.online || sfc.status === 'RUNNING' || sfc.steps.length === 0} onClick={() => sfcCommand(sfc.name, 'run')}>
            RUN
          </button>
          <button className="sfc-tab" disabled={!!lifecycle && !lifecycle.online || sfc.status !== 'RUNNING'} onClick={() => sfcCommand(sfc.name, 'hold')}>
            HOLD
          </button>
          <button className="sfc-tab" disabled={!!lifecycle && !lifecycle.online || sfc.status !== 'HELD'} onClick={() => sfcCommand(sfc.name, 'run')}>
            RESTART
          </button>
          <button className="sfc-tab" disabled={!!lifecycle && !lifecycle.online || sfc.status === 'READY'} onClick={() => sfcCommand(sfc.name, 'reset')}>
            STOP
          </button>
          <button className="sfc-tab danger" disabled={!!lifecycle && !lifecycle.online || sfc.status === 'READY'} onClick={() => sfcCommand(sfc.name, 'reset')}>
            ABORT
          </button>
        </div>
        <button className="tbtn sm danger" onClick={() => deleteSfc(sfc.name)}>
          Delete
        </button>
      </div>
      <SfcLifecycleControls name={sfc.name} />
      <SfcParameterControls name={sfc.name} />
      {check && check.steps === sfc.steps && <div role={check.error ? 'alert' : 'status'} className="traditional-note">
        {check.error ? `Check failed: ${check.error}` : 'Check passed for supported linear actions and conditions.'}
        {' '}This validates configured Named Set references, not arbitrary expressions, graph paths or controller downloads.
      </div>}

      <div className="sfc-canvas-wrap">
        {sfc.steps.length === 0 ? (
          <div className="exp-empty">No steps. Add the first step below.</div>
        ) : (
          <SfcChart sfc={sfc} selected={selected} onSelect={setSelected}
            onContext={context} onProperties={target => editable && setProperties(target)} />
        )}
        {editable && (
          <button
            className="tbtn sm"
            style={{ margin: 8 }}
            onClick={() => update([...sfc.steps, newStep(`STEP ${sfc.steps.length + 1}`)])}
          >
            + Add Step
          </button>
        )}
      </div>

      {editable && selected !== null && sfc.steps[selected] && (
        <StepPropertiesPanel
          step={sfc.steps[selected]}
          modules={modules}
          onClose={() => setSelected(null)}
          onDelete={() => {
            update(sfc.steps.filter((_, idx) => idx !== selected))
            setSelected(null)
          }}
          onChange={(patch) => setStep(selected, patch)}
          onProperties={index => setProperties({ kind: 'action', step: sfc.steps[selected], index })}
          onTransitionProperties={() => setProperties({ kind: 'transition', step: sfc.steps[selected] })}
          onContext={(index, x, y) => context({ kind: 'action', step: sfc.steps[selected], index }, x, y)}
        />
      )}
      {menu && editable && <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        {menu.target.kind === 'action' && <button role="menuitem" className="ctx-item" onClick={() => {
          setProperties({ kind: 'action', step: menu.target.step, index: null }); setMenu(null)
        }}>Add...</button>}
        {(menu.target.kind === 'transition' || menu.target.index !== null) && <button role="menuitem"
          className="ctx-item" onClick={() => { setProperties(menu.target); setMenu(null) }}>Properties...</button>}
      </div>}
      {properties && editable && <SfcPropertiesDialog name={sfc.name} target={properties} onClose={() => setProperties(null)} />}
    </>
  )
}

/** Native IEC 61131-3 SFC chart: double-bordered initial step, single-bordered
 * standard steps, transition cross-bars with live boolean evaluation, and
 * attached [qualifier | parameter | value] action blocks — a 2D vector
 * flowchart instead of stacked HTML form cards. */
function SfcChart({ sfc, selected, onSelect, onContext, onProperties }: {
  sfc: SfcDef; selected: number | null; onSelect: (i: number) => void
  onContext: (target: SfcPropertiesTarget, x: number, y: number) => void
  onProperties: (target: SfcPropertiesTarget) => void
}): JSX.Element {
  const modules = useStore((s) => s.modules)
  const state = { modules } as PlantState
  const context = { ...sfcExpressionContext(useStore.getState(), sfc.name,
    !!useStore.getState().sfcLifecycle[sfc.name]?.online), parameters: sfc.parameters ?? {} }
  const STEP_W = 120
  const STEP_H = 50
  const GAP = 70
  const CENTER_X = 170
  const rowY = (i: number): number => 30 + i * (STEP_H + GAP)
  const height = 30 + sfc.steps.length * (STEP_H + GAP) + 40
  const routed = sfc.steps.some(step => step.nextStep !== undefined)

  return (
    <svg width="100%" height={height} viewBox={`0 0 760 ${height}`} className="sfc-svg">
      {sfc.steps.map((step, i) => {
        const y = rowY(i)
        const isActive = sfc.status === 'RUNNING' && sfc.active === i
        const isPast = !routed && (sfc.active > i || sfc.status === 'COMPLETE')
        const transY = y + STEP_H + GAP / 2
        const transTrue = isPast || (isActive && evalCondition(step.transition, state, sfc.elapsed, context))
        const isLast = i === sfc.steps.length - 1
        const destination = step.nextStep === null ? -1 : step.nextStep !== undefined ?
          sfc.steps.findIndex(candidate => candidate.id === step.nextStep) : isLast ? -1 : i + 1
        return (
          <g key={step.id}>
            {/* flow line: step bottom -> transition -> next step top */}
            {!isLast && step.nextStep === undefined && (
              <line
                x1={CENTER_X}
                y1={y + STEP_H}
                x2={CENTER_X}
                y2={y + STEP_H + GAP}
                className={isPast ? 'sfc-line-active' : 'sfc-line'}
              />
            )}
            {step.nextStep !== undefined && destination >= 0 && <path
              d={`M ${CENTER_X} ${y + STEP_H} V ${transY + 12} H ${60 + i * 4} V ${rowY(destination) - 16} H ${CENTER_X} V ${rowY(destination)}`}
              fill="none" className={transTrue ? 'sfc-line-active' : 'sfc-line'}>
              <title>Transition returns to {sfc.steps[destination].name}</title>
            </path>}
            {/* step box */}
            <g onClick={() => onSelect(i)} style={{ cursor: 'pointer' }}
              onContextMenu={e => { e.preventDefault(); onContext({ kind: 'action', step, index: null }, e.clientX, e.clientY) }}>
              {i === 0 && (
                <rect x={CENTER_X - STEP_W / 2 - 5} y={y - 5} width={STEP_W + 10} height={STEP_H + 10} rx={1} className="sfc-step-box" />
              )}
              <rect
                x={CENTER_X - STEP_W / 2}
                y={y}
                width={STEP_W}
                height={STEP_H}
                rx={1}
                className={isActive ? 'sfc-step-box sfc-step-active' : 'sfc-step-box'}
                stroke={selected === i ? 'var(--dv-accent)' : undefined}
                strokeWidth={selected === i ? 2.5 : undefined}
              />
              <text x={CENTER_X} y={y + 20} className="step-title" fill={isActive ? '#0088cc' : undefined}>
                {step.name}
              </text>
              <text x={CENTER_X} y={y + 36} className="step-timer" fill={isActive ? '#0088cc' : undefined} fontWeight={isActive ? 700 : 400}>
                T: {isActive ? durationHHMMSS(sfc.elapsed) : isPast ? 'COMPLETE' : '--:--:--'}
              </text>
            </g>

            {/* attached IEC action blocks */}
            {step.actions.length > 0 && (
              <g transform={`translate(${CENTER_X + STEP_W / 2}, ${y + 6})`}>
                <line x1={0} y1={step.actions.length === 1 ? 17 : 21} x2={14} y2={step.actions.length === 1 ? 17 : 21} className={isActive ? 'sfc-line-active' : 'sfc-line'} />
                {step.actions.map((a, ai) => {
                  const [param, value] = splitAction(a, modules[a.tag])
                  const runtime = sfc.actionStates?.[actionIdentity(a)]
                  const actionActive = a.qualifier === 'R' ?
                    sfc.status === 'RUNNING' && sfc.active === i && sfc.elapsed === 0 && runtime?.resetStep === step.id :
                    runtime?.stepId === step.id && runtime.active
                  return (
                    <g key={ai} transform={`translate(14, ${ai * 22})`}
                      onDoubleClick={() => onProperties({ kind: 'action', step, index: ai })}
                      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContext({ kind: 'action', step, index: ai }, e.clientX, e.clientY) }}
                      data-action-name={actionIdentity(a)}
                      data-action-active={!!actionActive}>
                      <title>{a.qualifier === 'R' ? `Reset stored action ${actionIdentity(a)}${actionActive ? ' (Fired)' : ''}` :
                        `${actionIdentity(a)}: ${actionActive ? 'Active' :
                          runtime?.stepId === step.id && runtime.pending ? 'Waiting' : 'Inactive'}`}</title>
                      <rect x={0} y={0} width={20} height={20} className="qual-box" />
                      <text x={10} y={14} className="qual-box">
                        {a.qualifier ?? 'N'}
                      </text>
                      <rect x={20} y={0} width={220} height={20} className="action-box" />
                      <text x={25} y={14} fontSize={9} fontWeight={700} fill="#333">
                        {a.qualifier === 'R' && param.length > 40 ? `${param.slice(0, 37)}...` : param}
                      </text>
                      <text x={240} y={14} fontSize={9} fill="#0070b0" textAnchor="end">
                        {value}
                      </text>
                    </g>
                  )
                })}
              </g>
            )}

            {/* transition cross-bar + live boolean condition text */}
            {(!isLast || step.nextStep !== undefined) && (
              <g transform={`translate(${CENTER_X}, ${transY})`} onClick={() => onSelect(i)} style={{ cursor: 'pointer' }}
                onDoubleClick={() => onProperties({ kind: 'transition', step })}
                onContextMenu={e => { e.preventDefault(); onContext({ kind: 'transition', step }, e.clientX, e.clientY) }}>
                <rect x={-20} y={-2} width={40} height={4} className={transTrue ? 'sfc-trans-bar sfc-trans-true' : 'sfc-trans-bar'} />
                <text x={28} y={3} className="trans-label" fill={transTrue ? '#2e6b4f' : '#555'}>
                  T{String(i + 1).padStart(2, '0')}: {describeCondition(step.transition)}
                </text>
              </g>
            )}
          </g>
        )
      })}
      {sfc.status === 'COMPLETE' && (
        <circle cx={CENTER_X} cy={rowY(sfc.steps.length - 1) + STEP_H + 20} r={8} fill="none" stroke="#2e6b4f" strokeWidth={2} />
      )}
    </svg>
  )
}

/** Splits a described action into [parameter path, assigned value] for the
 * two-column IEC action block (e.g. "XV-101/SET_PV.CV" | "OPEN"). */
function splitAction(a: SfcAction, module?: AnyModule): [string, string] {
  const full = describeAction(a, module)
  const i = full.lastIndexOf(':=')
  if (i === -1) return [full, '']
  return [full.slice(0, i).replace(/^\[[^\]]*\]\s*/, '').trim(), full.slice(i + 2).trim()]
}

function durationHHMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':')
}

/** Selection-driven properties panel (replaces the always-visible stacked
 * dropdown cards) — editing still uses the existing dropdown controls, just
 * tucked away until a step is actually selected for configuration. */
function StepPropertiesPanel({
  step,
  modules,
  onClose,
  onDelete,
  onChange,
  onProperties,
  onTransitionProperties,
  onContext
}: {
  step: SfcStep
  modules: Record<string, AnyModule>
  onClose: () => void
  onDelete: () => void
  onChange: (patch: Partial<SfcStep>) => void
  onProperties: (index: number | null) => void
  onTransitionProperties: () => void
  onContext: (index: number | null, x: number, y: number) => void
}): JSX.Element {
  return (
    <div className="sfc-props">
      <div className="sfc-props-head">
        <input className="sfc-stepname" value={step.name} onChange={(e) => onChange({ name: e.target.value })} />
        <span style={{ flex: 1 }} />
        <button className="sfc-x" onClick={onDelete} title="Delete step">
          🗑
        </button>
        <button className="sfc-x" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <div className="sfc-props-section"
        onContextMenu={e => { e.preventDefault(); onContext(null, e.clientX, e.clientY) }}>
        <div className="sfc-props-label">Actions</div>
        {step.actions.map((a, ai) => (
          <div key={ai} className="sfc-action"
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContext(ai, e.clientX, e.clientY) }}>
            <ActionEditor
              action={a}
              modules={modules}
              onChange={(na) => onChange({ actions: step.actions.map((x, idx) => (idx === ai ? na : x)) })}
              onRemove={() => onChange({ actions: step.actions.filter((_, idx) => idx !== ai) })}
            />
            <button className="tbtn sm" onClick={() => onProperties(ai)}>Properties...</button>
          </div>
        ))}
        <button
          className="sfc-add"
          onClick={() => onProperties(null)}
        >
          + action
        </button>
      </div>
      <div className="sfc-props-section">
        <div className="sfc-props-label">Transition</div>
        <TransitionEditor cond={step.transition} modules={modules} onChange={(c) => onChange({ transition: c })} />
        <button className="tbtn sm" onClick={onTransitionProperties}>Transition Properties...</button>
      </div>
    </div>
  )
}

function tagsOf(modules: Record<string, AnyModule>, type: AnyModule['type']): string[] {
  return Object.values(modules)
    .filter((m) => m.type === type)
    .map((m) => m.tag)
}
export function firstTag(modules: Record<string, AnyModule>, type: AnyModule['type']): string {
  return tagsOf(modules, type)[0] ?? ''
}

const ACTION_KINDS: SfcAction['kind'][] = ['mode', 'sp', 'out', 'motor', 'valve', 'do']
const QUALIFIERS: ActionQualifier[] = ['N', 'R', 'L', 'D', 'P', 'S', 'SD', 'DS', 'SL']

export function ActionEditor({
  action,
  modules,
  onChange,
  onRemove
}: {
  action: SfcAction
  modules: Record<string, AnyModule>
  onChange: (a: SfcAction) => void
  onRemove: () => void
}): JSX.Element {
  const typeFor = (k: SfcAction['kind']): AnyModule['type'] =>
    k === 'motor' ? 'MOTOR' : k === 'valve' ? 'VALVE' : k === 'do' ? 'DO' : 'PID'
  const tags = [...tagsOf(modules, typeFor(action.kind)),
    ...(['mode', 'sp', 'out'].includes(action.kind) ? tagsOf(modules, 'AO') : [])]

  const changeKind = (k: SfcAction['kind']): void => {
    const tag = firstTag(modules, typeFor(k)) || (['mode', 'sp', 'out'].includes(k) ? firstTag(modules, 'AO') : '')
    const timing = { name: action.name, qualifier: action.qualifier, seconds: action.seconds, timingCondition: action.timingCondition }
    if (k === 'mode') onChange({ ...timing, kind: 'mode', tag, mode: 'AUTO' })
    else if (k === 'sp') onChange({ ...timing, kind: 'sp', tag, value: 50 })
    else if (k === 'out') onChange({ ...timing, kind: 'out', tag, value: 0 })
    else if (k === 'motor') onChange({ ...timing, kind: 'motor', tag, run: true })
    else if (k === 'valve') onChange({ ...timing, kind: 'valve', tag, open: true })
    else onChange({ ...timing, kind: 'do', tag, on: true })
  }

  if (action.kind === 'namedSet') return <div className="sfc-edit-row">
    <span>{describeAction(action)} [{action.qualifier ?? 'N'}]</span>
    <button className="sfc-x" onClick={onRemove}>Remove</button>
  </div>

  return (
    <>
    <div className="sfc-edit-row">
      <input className="fp-numinput" aria-label="Action name or reset target" placeholder="Action name (optional)"
        value={action.name ?? ''} onChange={e => onChange({ ...action, name: e.target.value })} />
      <select className="exp-alm-select" value={action.kind} onChange={(e) => changeKind(e.target.value as SfcAction['kind'])}>
        {ACTION_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <select className="exp-alm-select" value={action.tag} onChange={(e) => onChange({ ...action, tag: e.target.value })}>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {action.kind === 'mode' && (
        <select className="exp-alm-select" value={action.mode} onChange={(e) => onChange({ ...action, mode: e.target.value as 'MAN' | 'AUTO' | 'CAS' })}>
          <option>MAN</option>
          <option>AUTO</option>
          <option>CAS</option>
        </select>
      )}
      {(action.kind === 'sp' || action.kind === 'out') && (
        <input className="fp-numinput sm" type="number" value={action.value} onChange={(e) => onChange({ ...action, value: Number(e.target.value) })} />
      )}
      {action.kind === 'motor' && (
        <select className="exp-alm-select" value={action.run ? '1' : '0'} onChange={(e) => onChange({ ...action, run: e.target.value === '1' })}>
          <option value="1">START</option>
          <option value="0">STOP</option>
        </select>
      )}
      {action.kind === 'valve' && (
        <select className="exp-alm-select" value={action.open ? '1' : '0'} onChange={(e) => onChange({ ...action, open: e.target.value === '1' })}>
          <option value="1">OPEN</option>
          <option value="0">CLOSE</option>
        </select>
      )}
      {action.kind === 'do' && (
        <select className="exp-alm-select" value={action.on ? '1' : '0'} onChange={(e) => onChange({ ...action, on: e.target.value === '1' })}>
          <option value="1">ON</option>
          <option value="0">OFF</option>
        </select>
      )}
      <select
        className="exp-alm-select"
        title="Action qualifier (IEC 61131-3)"
        value={action.qualifier ?? 'N'}
        onChange={(e) => {
          const q = e.target.value as ActionQualifier
          onChange({ ...action, qualifier: q,
            seconds: TIMED_QUALIFIERS.includes(q) ? (action.seconds ?? (q === 'P' ? 0 : 5)) : undefined,
            timingCondition: TIMED_QUALIFIERS.includes(q) ? action.timingCondition : undefined })
        }}
      >
        {QUALIFIERS.map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
      </select>
      {TIMED_QUALIFIERS.includes(action.qualifier ?? 'N') && !action.timingCondition && (
        <input
          className="fp-numinput sm"
          type="number"
          title="seconds" min={0} step="any"
          aria-label="Action time seconds"
          value={action.seconds ?? 0}
          onChange={(e) => onChange({ ...action, seconds: Number(e.target.value) })}
        />
      )}
      {TIMED_QUALIFIERS.includes(action.qualifier ?? 'N') && <label>
        <input type="checkbox" checked={!!action.timingCondition} onChange={e => onChange({ ...action,
          timingCondition: e.target.checked ? { kind: 'timer', seconds: action.seconds ?? 0 } : undefined })} />
        Timing condition
      </label>}
      <button className="sfc-x" onClick={onRemove}>
        ✕
      </button>
    </div>
    {action.timingCondition && <TransitionEditor cond={action.timingCondition} modules={modules}
      onChange={cond => onChange({ ...action, timingCondition: cond })} />}
    </>
  )
}

const COND_KINDS: SfcCondition['kind'][] = ['always', 'timer', 'pv', 'out', 'motorRunning', 'valveOpen']
const OPS: CompareOp[] = ['>', '<', '>=', '<=']

export function TransitionEditor({
  cond,
  modules,
  onChange
}: {
  cond: SfcCondition
  modules: Record<string, AnyModule>
  onChange: (c: SfcCondition) => void
}): JSX.Element {
  const changeKind = (k: SfcCondition['kind']): void => {
    if (k === 'always') onChange({ kind: 'always' })
    else if (k === 'timer') onChange({ kind: 'timer', seconds: 5 })
    else if (k === 'pv') onChange({ kind: 'pv', tag: firstTag(modules, 'PID') || firstTag(modules, 'AI') ||
      firstTag(modules, 'AO'), op: '>', value: 50 })
    else if (k === 'out') onChange({ kind: 'out', tag: firstTag(modules, 'PID') || firstTag(modules, 'AO'), op: '>', value: 30 })
    else if (k === 'motorRunning') onChange({ kind: 'motorRunning', tag: firstTag(modules, 'MOTOR'), running: true })
    else onChange({ kind: 'valveOpen', tag: firstTag(modules, 'VALVE'), open: true })
  }
  const tagType = cond.kind === 'motorRunning' ? 'MOTOR' : cond.kind === 'valveOpen' ? 'VALVE' : 'PID'
  const tags = cond.kind === 'pv' ? [...tagsOf(modules, 'PID'), ...tagsOf(modules, 'AI'), ...tagsOf(modules, 'AO')] :
    cond.kind === 'out' ? [...tagsOf(modules, 'PID'), ...tagsOf(modules, 'AO')] : tagsOf(modules, tagType)

  if (cond.kind === 'namedSet') return <div className="sfc-edit-row sfc-trans-edit">{describeCondition(cond)}</div>
  return (
    <div className="sfc-edit-row sfc-trans-edit">
      <span className="sfc-trans-arrow">⟶</span>
      <select className="exp-alm-select" value={cond.kind} onChange={(e) => changeKind(e.target.value as SfcCondition['kind'])}>
        {COND_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {cond.kind === 'timer' && (
        <input className="fp-numinput sm" type="number" value={cond.seconds} onChange={(e) => onChange({ ...cond, seconds: Number(e.target.value) })} />
      )}
      {(cond.kind === 'pv' || cond.kind === 'out' || cond.kind === 'motorRunning' || cond.kind === 'valveOpen') && (
        <select className="exp-alm-select" value={cond.tag} onChange={(e) => onChange({ ...cond, tag: e.target.value })}>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
      {(cond.kind === 'pv' || cond.kind === 'out') && (
        <>
          <select className="exp-alm-select" value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as CompareOp })}>
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input className="fp-numinput sm" type="number" value={cond.value} onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })} />
        </>
      )}
      {cond.kind === 'motorRunning' && (
        <select className="exp-alm-select" value={cond.running ? '1' : '0'} onChange={(e) => onChange({ ...cond, running: e.target.value === '1' })}>
          <option value="1">RUNNING</option>
          <option value="0">STOPPED</option>
        </select>
      )}
      {cond.kind === 'valveOpen' && (
        <select className="exp-alm-select" value={cond.open ? '1' : '0'} onChange={(e) => onChange({ ...cond, open: e.target.value === '1' })}>
          <option value="1">OPEN</option>
          <option value="0">CLOSED</option>
        </select>
      )}
    </div>
  )
}
