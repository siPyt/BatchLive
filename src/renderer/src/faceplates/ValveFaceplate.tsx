import { useStore } from '../engine/store'
import type { ValveModule } from '../engine/types'

export function ValveFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as ValveModule | undefined
  const openValve = useStore((s) => s.openValve)
  const closeValve = useStore((s) => s.closeValve)
  const toggleInterlock = useStore((s) => s.toggleInterlock)
  const injectFault = useStore((s) => s.injectFault)
  if (!m) return null

  const status = m.fault ? 'FAULT' : m.open ? 'OPEN' : 'CLOSED'
  const pill = m.fault ? 'pill-fault' : m.open ? 'pill-run' : 'pill-stop'

  return (
    <div className="fp-body">
      <div className="fp-row">
        <span className="fp-label">Position</span>
        <span className={'fp-status-pill ' + pill}>{status}</span>
      </div>

      <div className="fp-row">
        <button
          className={'fp-btn run' + (m.commandedOpen ? ' active' : '')}
          disabled={m.interlock}
          onClick={() => openValve(tag)}
        >
          OPEN
        </button>
        <button
          className={'fp-btn stop' + (!m.commandedOpen ? ' active' : '')}
          onClick={() => closeValve(tag)}
        >
          CLOSE
        </button>
      </div>

      <div className="fp-row">
        <span className="fp-label">Command</span>
        <span style={{ color: 'var(--dv-text-dim)' }}>{m.commandedOpen ? 'OPEN' : 'CLOSE'}</span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Interlock</span>
        <span style={{ color: m.interlock ? 'var(--dv-critical)' : 'var(--dv-text-dim)', fontWeight: 700 }}>
          {m.interlock ? 'TRIPPED' : 'CLEAR'}
        </span>
      </div>

      <div className="fp-row" style={{ marginTop: 4 }}>
        <button className="fp-btn" onClick={() => toggleInterlock(tag)}>
          {m.interlock ? 'Reset Interlock' : 'Force Interlock'}
        </button>
        <button className="fp-btn" onClick={() => injectFault(tag)}>
          {m.fault ? 'Clear Fault' : 'Inject Fault'}
        </button>
      </div>
    </div>
  )
}
