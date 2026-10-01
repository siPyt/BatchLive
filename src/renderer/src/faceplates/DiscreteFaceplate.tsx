import { useStore } from '../engine/store'
import type { DiscreteInput, DiscreteOutput } from '../engine/types'

export function DiscreteFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as DiscreteInput | DiscreteOutput | undefined
  const toggleDO = useStore((s) => s.toggleDO)
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

      {isOutput && (
        <div className="fp-row" style={{ marginTop: 4 }}>
          <button
            className={'fp-btn run' + (m.state ? ' active' : '')}
            onClick={() => !m.state && toggleDO(tag)}
          >
            {m.activeDescriptor}
          </button>
          <button
            className={'fp-btn stop' + (!m.state ? ' active' : '')}
            onClick={() => m.state && toggleDO(tag)}
          >
            {m.inactiveDescriptor}
          </button>
        </div>
      )}
    </div>
  )
}
