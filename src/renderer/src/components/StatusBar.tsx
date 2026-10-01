import { useStore } from '../engine/store'

export function StatusBar(): JSX.Element {
  const running = useStore((s) => s.running)
  const alarms = useStore((s) => s.alarms)
  const speed = useStore((s) => s.speed)
  const version = typeof window !== 'undefined' && window.deltav ? window.deltav.version : '1.0.0'

  const active = alarms.filter((a) => a.active).length
  const unack = alarms.filter((a) => !a.acknowledged).length

  return (
    <div className="statusbar">
      <span className="seg">
        <span
          className="dot"
          style={{ background: running ? 'var(--dv-ok)' : 'var(--dv-warning)' }}
        />
        Simulation {running ? 'RUNNING' : 'ON HOLD'} · {speed}×
      </span>
      <span className="seg">
        <span
          className="dot"
          style={{ background: active ? 'var(--dv-critical)' : 'var(--dv-ok)' }}
        />
        {active} active · {unack} unacknowledged
      </span>
      <span className="seg">Node: PRIMARY · Comm: GOOD</span>
      <span className="spacer" />
      <span className="seg">BatchLive v{version}</span>
    </div>
  )
}
