import { useStore } from '../engine/store'
import { useUi, type DisplayId } from '../ui/uiStore'
import { clockString, dateString } from '../utils/format'

const NAV: { id: DisplayId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'feed', label: 'Feed' },
  { id: 'reactor', label: 'Reactor' },
  { id: 'product', label: 'Product' },
  { id: 'trend', label: 'Trends' },
  { id: 'alarms', label: 'Alarms' }
]

export function TopBar(): JSX.Element {
  const time = useStore((s) => s.time)
  const running = useStore((s) => s.running)
  const speed = useStore((s) => s.speed)
  const setRunning = useStore((s) => s.setRunning)
  const setSpeed = useStore((s) => s.setSpeed)
  const display = useUi((s) => s.display)
  const navigate = useUi((s) => s.navigate)
  const back = useUi((s) => s.back)
  const forward = useUi((s) => s.forward)
  const histIndex = useUi((s) => s.histIndex)
  const histLen = useUi((s) => s.history.length)

  const current = NAV.find((n) => n.id === display)

  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">BL</span>
        <span>BatchLive</span>
      </div>

      <div className="nav-arrows">
        <button className="navarrow" onClick={back} disabled={histIndex <= 0} title="Back">
          ◀
        </button>
        <button
          className="navarrow"
          onClick={forward}
          disabled={histIndex >= histLen - 1}
          title="Forward"
        >
          ▶
        </button>
        <button className="navarrow" onClick={() => navigate('overview')} title="Home display">
          ⌂
        </button>
      </div>

      {NAV.map((n) => (
        <button
          key={n.id}
          className={'tbtn' + (display === n.id ? ' active' : '')}
          onClick={() => navigate(n.id)}
        >
          {n.label}
        </button>
      ))}

      <span className="crumbs" style={{ marginLeft: 10 }}>
        REACTOR_CELL / <b>{current?.label ?? 'Engineering'}</b>
      </span>

      <div className="spacer" />

      <button
        className={'tbtn' + (running ? ' active' : '')}
        onClick={() => setRunning(!running)}
        title="Run / hold the process simulation"
      >
        {running ? '❚❚ Running' : '▶ Hold'}
      </button>
      <select
        className="select-dark"
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        title="Simulation speed"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={5}>5×</option>
        <option value={10}>10×</option>
      </select>

      <div className="clock">
        {dateString(time)} {clockString(time)}
      </div>
      <div className="user">
        <span>👤</span>
        <span>OPERATOR</span>
      </div>
    </div>
  )
}
