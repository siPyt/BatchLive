import { useStore } from '../engine/store'
import type { MotorModule } from '../engine/types'
import { fmt } from '../utils/format'

export function MotorFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as MotorModule | undefined
  const startMotor = useStore((s) => s.startMotor)
  const stopMotor = useStore((s) => s.stopMotor)
  const toggleInterlock = useStore((s) => s.toggleInterlock)
  const injectFault = useStore((s) => s.injectFault)
  if (!m) return null

  const status = m.fault ? 'FAULT' : m.running ? 'RUNNING' : 'STOPPED'
  const pill = m.fault ? 'pill-fault' : m.running ? 'pill-run' : 'pill-stop'

  return (
    <div className="fp-body">
      <div className="fp-row">
        <span className="fp-label">Status</span>
        <span className={'fp-status-pill ' + pill}>
          <span
            className="dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: m.fault ? 'var(--dv-critical)' : m.running ? 'var(--dv-run)' : 'var(--dv-stop)'
            }}
          />
          {status}
        </span>
      </div>

      <div className="fp-row">
        <button
          className={'fp-btn run' + (m.commanded ? ' active' : '')}
          disabled={m.interlock}
          onClick={() => startMotor(tag)}
        >
          START
        </button>
        <button
          className={'fp-btn stop' + (!m.commanded ? ' active' : '')}
          onClick={() => stopMotor(tag)}
        >
          STOP
        </button>
      </div>

      <div className="fp-row">
        <span className="fp-label">Command</span>
        <span style={{ color: 'var(--dv-text-dim)' }}>{m.commanded ? 'START' : 'STOP'}</span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Interlock</span>
        <span style={{ color: m.interlock ? 'var(--dv-critical)' : 'var(--dv-text-dim)', fontWeight: 700 }}>
          {m.interlock ? 'TRIPPED' : 'CLEAR'}
        </span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Runtime</span>
        <span style={{ color: 'var(--dv-text-dim)' }}>{fmt(m.runtimeHrs, 1)} hrs</span>
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
