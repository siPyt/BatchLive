import { useStore } from '../engine/store'
import type { DiscreteInput, DiscreteOutput } from '../engine/types'

export function DiscreteFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const module = useStore((s) => s.modules[tag])
  const m: DiscreteInput | DiscreteOutput | undefined =
    module?.type === 'DI' || module?.type === 'DO' ? module : undefined
  const toggleDO = useStore((s) => s.toggleDO)
  const setMode = useStore(s => s.setDiscreteMode)
  if (!m) return null

  const descriptor = m.state ? m.activeDescriptor : m.inactiveDescriptor
  const isOutput = m.type === 'DO'

  return (
    <div className="fp-body">
      <div className="fp-row">
        <span className="fp-label">State</span>
        <span
          className={'fp-status-pill ' + (m.state ? 'pill-run' : 'pill-stop')}
          style={{ fontSize: 13 }}
        >
          {descriptor}
        </span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Type</span>
        <span style={{ color: 'var(--dv-text-dim)' }}>
          {isOutput ? 'Discrete Output' : 'Discrete Input'}
        </span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Mode / I/O quality</span>
        <select aria-label={`${tag} discrete mode`} value={m.mode ?? 'AUTO'}
          onChange={e => setMode(tag, e.target.value === 'OOS' ? 'OOS' : 'AUTO')}>
          <option>AUTO</option><option>OOS</option>
        </select>
        <span>{m.ioBad ? 'Bad — held signal' : 'Good'}</span>
      </div>

      {m.type === 'DO' && (
        <div className="fp-row" style={{ marginTop: 4 }}>
          <button
            className={'fp-btn run' + (m.commanded ? ' active' : '')}
            disabled={m.mode === 'OOS'}
            onClick={() => !m.commanded && toggleDO(tag)}
          >
            {m.activeDescriptor}
          </button>
          <button
            className={'fp-btn stop' + (!m.commanded ? ' active' : '')}
            disabled={m.mode === 'OOS'}
            onClick={() => m.commanded && toggleDO(tag)}
          >
            {m.inactiveDescriptor}
          </button>
        </div>
      )}
    </div>
  )
}
