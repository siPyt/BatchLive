import { useState } from 'react'
import { useUi, type DisplayId } from '../ui/uiStore'
import { useProgress } from '../engine/progressStore'
import { COURSE, type Workshop } from '../engine/workshops'

function stepIds(w: Workshop): string[] {
  return w.steps.map((s) => s.id)
}

export function WorkshopsDisplay(): JSX.Element {
  const done = useProgress((s) => s.done)
  const navigate = useUi((s) => s.navigate)
  const all = COURSE.flatMap((m) => m.workshops)
  const [selId, setSelId] = useState<string>(all[0]?.id ?? '')
  const sel = all.find((w) => w.id === selId)

  const pct = (w: Workshop): number => {
    const ids = stepIds(w)
    const n = ids.filter((i) => done[i]).length
    return ids.length ? Math.round((n / ids.length) * 100) : 0
  }

  const totalSteps = all.reduce((a, w) => a + w.steps.length, 0)
  const doneSteps = all.reduce((a, w) => a + stepIds(w).filter((i) => done[i]).length, 0)
  const overall = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0

  return (
    <div className="display workshops">
      <div className="ws-list">
        <div className="ws-overall">
          <div className="ws-overall-top">
            <b>Exercise Checklist</b>
            <span>{overall}%</span>
          </div>
          <div className="ws-bar">
            <div className="ws-bar-fill" style={{ width: overall + '%' }} />
          </div>
          <div className="ws-overall-sub">
            {doneSteps} / {totalSteps} steps checked manually. Not verified DV-09 coverage.
          </div>
        </div>
        {COURSE.map((m) => (
          <div key={m.module}>
            <div className="ws-module">{m.module}</div>
            {m.workshops.map((w) => (
              <div
                key={w.id}
                className={'ws-item' + (selId === w.id ? ' sel' : '')}
                onClick={() => setSelId(w.id)}
              >
                <span className="ws-check" style={{ opacity: pct(w) === 100 ? 1 : 0.25 }}>
                  ✓
                </span>
                <span className="ws-item-title">{w.title}</span>
                <span className="ws-item-pct">{pct(w)}%</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="ws-detail">
        {!sel ? (
          <div className="exp-empty">Select a workshop.</div>
        ) : (
          <WorkshopPanel workshop={sel} onNavigate={navigate} />
        )}
      </div>
    </div>
  )
}

function WorkshopPanel({
  workshop: w,
  onNavigate
}: {
  workshop: Workshop
  onNavigate: (d: DisplayId) => void
}): JSX.Element {
  const done = useProgress((s) => s.done)
  const toggle = useProgress((s) => s.toggle)
  const reset = useProgress((s) => s.reset)

  return (
    <div className="ws-panel">
      <div className="ws-panel-head">
        <h2>{w.title}</h2>
        <button className="tbtn sm" onClick={() => reset(stepIds(w))}>
          Reset
        </button>
      </div>
      <p className="ws-objective">{w.objective}</p>
      {w.note && <div className="ws-note">{w.note}</div>}
      <ol className="ws-steps">
        {w.steps.map((st) => (
          <li key={st.id} className={'ws-step' + (done[st.id] ? ' done' : '')}>
            <button className={'ws-step-box' + (done[st.id] ? ' on' : '')} onClick={() => toggle(st.id)}>
              {done[st.id] ? '✓' : ''}
            </button>
            <span className="ws-step-text">{st.text}</span>
            {st.goto && (
              <button className="tbtn sm" onClick={() => onNavigate(st.goto!)}>
                Open ↗
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
