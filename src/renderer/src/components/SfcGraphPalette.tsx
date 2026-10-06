import { useState } from 'react'
import {
  addParallelLeg, addSelectiveRoute, addStepAfter, analyzeSfcGraph, deleteStepHealing, makeParallel, removeParallel,
  removeSelectiveRoute, setPrimaryRoute, type EditResult
} from '../engine/sfcGraph'
import type { SfcStep } from '../engine/sfc'

/** DV09-064..067: SFC graph palette - structural editing of steps, routes, selective branches and parallel legs. */
export function SfcGraphPalette({ steps, selected, onChange, onSelect }: {
  steps: SfcStep[]; selected: number | null; onChange: (steps: SfcStep[]) => void; onSelect: (index: number | null) => void
}): JSX.Element {
  const [target, setTarget] = useState('')
  const [legs, setLegs] = useState(2)
  const [message, setMessage] = useState<string | null>(null)
  const current = selected !== null ? steps[selected] : undefined
  const issues = analyzeSfcGraph(steps)
  const others = steps.filter((s) => s.id !== current?.id)
  const isFork = !!current?.parallelNextSteps?.length
  const apply = (result: EditResult, select?: (next: SfcStep[]) => number | null): void => {
    if ('error' in result) { setMessage(result.error); return }
    setMessage(null)
    onChange(result.steps)
    if (select) onSelect(select(result.steps))
  }
  const needs = (): boolean => { if (!current) { setMessage('Select a step first'); return false } return true }
  const ensureTarget = (): string | null => { if (!target || !steps.some((s) => s.id === target)) { setMessage('Choose a destination step'); return null } return target }

  return (
    <section className="sfc-graph-palette" aria-label="SFC graph palette" style={{ padding: '6px 10px', borderBottom: '1px solid var(--dv-border)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>Graph</b>
        <span style={{ color: 'var(--dv-text-mute)' }}>{current ? `Selected: ${current.name}` : 'Select a step on the chart'}</span>
        <button className="tbtn sm" onClick={() => needs() && apply(addStepAfter(steps, current!.id, `STEP ${steps.length + 1}`), (n) => n.findIndex((s) => s.id !== current!.id && !steps.some((o) => o.id === s.id)))}>+ Step after</button>
        <button className="tbtn sm" onClick={() => needs() && apply(deleteStepHealing(steps, current!.id), () => null)}>Delete (reconnect)</button>
        <span style={{ margin: '0 4px' }}>|</span>
        <select aria-label="Route destination" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Destination…</option>
          {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="tbtn sm" onClick={() => { if (!needs()) return; const to = ensureTarget(); if (to) apply(addSelectiveRoute(steps, current!.id, to)) }}>Selective branch</button>
        <button className="tbtn sm" onClick={() => { if (!needs()) return; const to = ensureTarget(); if (to) apply(setPrimaryRoute(steps, current!.id, to)) }}>Route / loop to</button>
        <button className="tbtn sm" onClick={() => needs() && apply(setPrimaryRoute(steps, current!.id, null))}>Terminate here</button>
        <span style={{ margin: '0 4px' }}>|</span>
        <label>Legs <input aria-label="Parallel legs" type="number" min={2} max={6} style={{ width: 44 }} value={legs} onChange={(e) => setLegs(Number(e.target.value))} /></label>
        <button className="tbtn sm" onClick={() => needs() && apply(makeParallel(steps, current!.id, legs))}>Parallel divergence</button>
        <button className="tbtn sm" disabled={!isFork} onClick={() => needs() && apply(addParallelLeg(steps, current!.id))}>+ Leg</button>
        <button className="tbtn sm" disabled={!isFork} onClick={() => needs() && apply(removeParallel(steps, current!.id))}>Remove parallel</button>
      </div>
      {current?.alternatives?.length ? (
        <div style={{ marginTop: 4, fontSize: 12 }}>
          Selective routes from {current.name}:
          {current.alternatives.map((route, i) => (
            <span key={i} style={{ marginLeft: 8 }}>
              → {steps.find((s) => s.id === route.nextStep)?.name ?? '(missing)'}
              <button className="tbtn sm" aria-label={`Remove route to ${steps.find((s) => s.id === route.nextStep)?.name}`} onClick={() => apply(removeSelectiveRoute(steps, current.id, i))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      {message && <div role="alert" style={{ color: 'var(--dv-critical)', marginTop: 4 }}>{message}</div>}
      {issues.length > 0 && (
        <ul aria-label="Graph findings" style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
          {issues.map((issue, i) => <li key={i} data-severity={issue.severity}>{issue.severity === 'error' ? '⛔ ' : '⚠ '}{issue.text}</li>)}
        </ul>
      )}
      <div style={{ fontSize: 11, color: 'var(--dv-text-mute)', marginTop: 4 }}>
        Edits rewire the existing step routes (sequential, selective, parallel) and are checked by the same rules the engine runs.
        New routes start with a 5 s timer condition; edit it with the transition properties. This is not a native graphical palette.
      </div>
    </section>
  )
}
