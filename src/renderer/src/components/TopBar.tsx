import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi, type DisplayId } from '../ui/uiStore'
import { useSecurity } from '../engine/security'
import { clockString, dateString } from '../utils/format'

const NAV: { id: DisplayId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'feed', label: 'Feed' },
  { id: 'reactor', label: 'Reactor' },
  { id: 'product', label: 'Product' },
  { id: 'trend', label: 'Trends' },
  { id: 'alarms', label: 'Alarms' }
]

interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

function DropdownMenu({ label, items }: { label: string; items: MenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="topmenu" ref={ref}>
      <button className={'tbtn sm' + (open ? ' active' : '')} onClick={() => setOpen((v) => !v)}>
        {label} ▾
      </button>
      {open && (
        <div className="topmenu-pop">
          {items.map((it, i) => (
            <button
              key={i}
              className={'ctx-item' + (it.danger ? ' danger' : '')}
              onClick={() => {
                it.onClick()
                setOpen(false)
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TopBar(): JSX.Element {
  const time = useStore((s) => s.time)
  const running = useStore((s) => s.running)
  const speed = useStore((s) => s.speed)
  const setRunning = useStore((s) => s.setRunning)
  const setSpeed = useStore((s) => s.setSpeed)
  const newProject = useStore((s) => s.newProject)
  const display = useUi((s) => s.display)
  const navigate = useUi((s) => s.navigate)
  const back = useUi((s) => s.back)
  const forward = useUi((s) => s.forward)
  const histIndex = useUi((s) => s.histIndex)
  const histLen = useUi((s) => s.history.length)
  const resetToOverview = useUi((s) => s.resetToOverview)
  const currentUser = useSecurity((s) => s.currentUser)
  const users = useSecurity((s) => s.users)
  const lockWorkstation = useSecurity((s) => s.lockWorkstation)
  const logEvent = useStore((s) => s.logEvent)
  const fullName = users.find((u) => u.name === currentUser)?.fullName ?? currentUser

  const lockAndLog = (): void => {
    logEvent('SECURITY', currentUser, 'Workstation locked (FlexLock)')
    lockWorkstation()
  }

  const current = NAV.find((n) => n.id === display)

  const startNewProject = (kind: 'pharma' | 'blank'): void => {
    const label = kind === 'blank' ? 'a new blank project' : 'the GMP Pharma Factory baseline'
    if (!window.confirm(`Discard the current project and load ${label}? This cannot be undone.`)) return
    newProject(kind)
    resetToOverview()
  }

  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">BL</span>
        <span className="brand-text" title="BatchLive - Charles R. Freeman, software engineer">
          <span className="brand-name">BatchLive</span>
          <span className="brand-credit">Charles R. Freeman, software engineer</span>
        </span>
      </div>

      <DropdownMenu
        label="File"
        items={[
          { label: '＋ New Blank Project', onClick: () => startNewProject('blank') },
          { label: '🏭 New GMP Pharma Factory', onClick: () => startNewProject('pharma') }
        ]}
      />
      <DropdownMenu
        label="Utilities"
        items={[
          { label: '▦ DeltaV Explorer', onClick: () => navigate('explorer') },
          { label: '🖧 Physical Network', onClick: () => navigate('hardware') },
          { label: '⬓ Control Studio', onClick: () => navigate('studio') },
          { label: '⇵ SFC Charts', onClick: () => navigate('sfc') },
          { label: '⚙ Batch Operator', onClick: () => navigate('batch') },
          { label: '▤ Display Builder', onClick: () => navigate('builder') },
          { label: '🔑 User Manager', onClick: () => navigate('users') },
          { label: '🎓 DV-09 Workshops', onClick: () => navigate('workshops') }
        ]}
      />

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

      <span className="crumbs" title={`REACTOR_CELL / ${current?.label ?? 'Engineering'}`}>
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
        <span className="user-name" title={fullName}>{fullName}</span>
        <button className="navarrow" onClick={lockAndLog} title="Lock Workstation (FlexLock)" style={{ marginLeft: 6 }}>
          🔒
        </button>
      </div>
    </div>
  )
}
