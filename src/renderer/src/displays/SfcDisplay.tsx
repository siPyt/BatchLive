import { useState } from 'react'
import { useStore } from '../engine/store'
import {
  describeAction,
  describeCondition,
  newStep,
  type SfcDef,
  type SfcStep,
  type SfcAction,
  type SfcCondition,
  type CompareOp,
  type ActionQualifier
} from '../engine/sfc'
import type { AnyModule } from '../engine/types'

const STATUS_COLOR: Record<SfcDef['status'], string> = {
  READY: '#9aa0a7',
  RUNNING: '#37b24d',
  HELD: '#f2c313',
  COMPLETE: '#1aa7ec'
}

export function SfcDisplay(): JSX.Element {
  const sfcs = useStore((s) => s.sfcs)
  const createSfc = useStore((s) => s.createSfc)
  const names = Object.keys(sfcs)
  const [selected, setSelected] = useState<string>(names[0] ?? '')
  const [newName, setNewName] = useState('')
  const [newArea, setNewArea] = useState('FEED')

  const sfc = sfcs[selected]

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
            <option>FEED</option>
            <option>REACTOR</option>
            <option>PRODUCT</option>
            <option>WFI</option>
            <option>AUTOCLAVE</option>
            <option>LYO</option>
            <option>CIP</option>
            <option>TCU</option>
          </select>
          <button
            className="tbtn sm"
            disabled={!newName.trim()}
            onClick={() => {
              createSfc(newName, newArea)
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
        {!sfc ? <div className="exp-empty">Select or create an SFC.</div> : <SfcEditor sfc={sfc} />}
      </div>
    </div>
  )
}

function SfcEditor({ sfc }: { sfc: SfcDef }): JSX.Element {
  const modules = useStore((s) => s.modules)
  const setSfcSteps = useStore((s) => s.setSfcSteps)
  const sfcCommand = useStore((s) => s.sfcCommand)
  const deleteSfc = useStore((s) => s.deleteSfc)
  const editable = sfc.status === 'READY' || sfc.status === 'COMPLETE'

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
        <button className="tbtn sm" disabled={sfc.status === 'RUNNING' || sfc.steps.length === 0} onClick={() => sfcCommand(sfc.name, 'run')}>
          ▶ Run
        </button>
        <button className="tbtn sm" disabled={sfc.status !== 'RUNNING'} onClick={() => sfcCommand(sfc.name, 'hold')}>
          ❚❚ Hold
        </button>
        <button className="tbtn sm" onClick={() => sfcCommand(sfc.name, 'reset')}>
          ⟲ Reset
        </button>
        <button className="tbtn sm danger" onClick={() => deleteSfc(sfc.name)}>
          Delete
        </button>
      </div>

      <div className="sfc-canvas">
        {sfc.steps.length === 0 && <div className="exp-empty">No steps. Add the first step below.</div>}
        {sfc.steps.map((step, i) => (
          <div key={step.id} className="sfc-stepwrap">
            <div
              className={
                'sfc-step' + (i === 0 ? ' initial' : '') + (sfc.status === 'RUNNING' && sfc.active === i ? ' active' : '')
              }
            >
              <div className="sfc-step-head">
                <span className="sfc-step-num">{i + 1}</span>
                {editable ? (
                  <input
                    className="sfc-stepname"
                    value={step.name}
                    onChange={(e) => setStep(i, { name: e.target.value })}
                  />
                ) : (
                  <b>{step.name}</b>
                )}
                {editable && (
                  <button className="sfc-x" onClick={() => update(sfc.steps.filter((_, idx) => idx !== i))}>
                    ✕
                  </button>
                )}
              </div>
              <div className="sfc-actions">
                {step.actions.map((a, ai) => (
                  <div key={ai} className="sfc-action">
                    {editable ? (
                      <ActionEditor
                        action={a}
                        modules={modules}
                        onChange={(na) => setStep(i, { actions: step.actions.map((x, idx) => (idx === ai ? na : x)) })}
                        onRemove={() => setStep(i, { actions: step.actions.filter((_, idx) => idx !== ai) })}
                      />
                    ) : (
                      <span>• {describeAction(a)}</span>
                    )}
                  </div>
                ))}
                {editable && (
                  <button
                    className="sfc-add"
                    onClick={() =>
                      setStep(i, { actions: [...step.actions, { kind: 'valve', tag: firstTag(modules, 'VALVE'), open: true }] })
                    }
                  >
                    + action
                  </button>
                )}
              </div>
            </div>
            <div className="sfc-trans">
              <span className="sfc-trans-bar" />
              {editable ? (
                <TransitionEditor cond={step.transition} modules={modules} onChange={(c) => setStep(i, { transition: c })} />
              ) : (
                <span className="sfc-trans-txt">⟶ {describeCondition(step.transition)}</span>
              )}
            </div>
          </div>
        ))}
        {sfc.steps.length > 0 && sfc.status === 'COMPLETE' && <div className="sfc-terminal">O</div>}
        {editable && (
          <button
            className="tbtn sm"
            onClick={() => update([...sfc.steps, newStep(`STEP ${sfc.steps.length + 1}`)])}
          >
            + Add Step
          </button>
        )}
      </div>
    </>
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
const QUALIFIERS: ActionQualifier[] = ['S', 'N', 'P', 'R', 'D', 'L']

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
  const tags = tagsOf(modules, typeFor(action.kind))

  const changeKind = (k: SfcAction['kind']): void => {
    const tag = firstTag(modules, typeFor(k))
    if (k === 'mode') onChange({ kind: 'mode', tag, mode: 'AUTO' })
    else if (k === 'sp') onChange({ kind: 'sp', tag, value: 50 })
    else if (k === 'out') onChange({ kind: 'out', tag, value: 0 })
    else if (k === 'motor') onChange({ kind: 'motor', tag, run: true })
    else if (k === 'valve') onChange({ kind: 'valve', tag, open: true })
    else onChange({ kind: 'do', tag, on: true })
  }

  return (
    <div className="sfc-edit-row">
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
        value={action.qualifier ?? 'S'}
        onChange={(e) => {
          const q = e.target.value as ActionQualifier
          onChange({ ...action, qualifier: q, seconds: q === 'D' || q === 'L' ? (action.seconds ?? 5) : undefined })
        }}
      >
        {QUALIFIERS.map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
      </select>
      {(action.qualifier === 'D' || action.qualifier === 'L') && (
        <input
          className="fp-numinput sm"
          type="number"
          title="seconds"
          value={action.seconds ?? 0}
          onChange={(e) => onChange({ ...action, seconds: Number(e.target.value) })}
        />
      )}
      <button className="sfc-x" onClick={onRemove}>
        ✕
      </button>
    </div>
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
    else if (k === 'pv') onChange({ kind: 'pv', tag: firstTag(modules, 'PID'), op: '>', value: 50 })
    else if (k === 'out') onChange({ kind: 'out', tag: firstTag(modules, 'PID'), op: '>', value: 30 })
    else if (k === 'motorRunning') onChange({ kind: 'motorRunning', tag: firstTag(modules, 'MOTOR'), running: true })
    else onChange({ kind: 'valveOpen', tag: firstTag(modules, 'VALVE'), open: true })
  }
  const tagType = cond.kind === 'motorRunning' ? 'MOTOR' : cond.kind === 'valveOpen' ? 'VALVE' : 'PID'
  const tags = cond.kind === 'pv' ? [...tagsOf(modules, 'PID'), ...tagsOf(modules, 'AI')] : tagsOf(modules, tagType)

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
