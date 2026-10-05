import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { useSecurity } from '../engine/security'
import { clockString, dateString } from '../utils/format'
import { DISPLAY_NAVIGATION } from '../ui/displayNavigation'
import { OperatorRibbonIcon, type RibbonIconKind } from './OperatorRibbonIcon'

function RibbonButton({ icon, label, onClick, disabled, pressed }: {
  icon: RibbonIconKind
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}): JSX.Element {
  return <button className="ribbon-button" title={label} aria-label={label}
    disabled={disabled} aria-pressed={pressed} onClick={onClick}>
    <OperatorRibbonIcon kind={icon} />
  </button>
}

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
  const navigationOpen = useUi(s => s.navigationOpen)
  const toggleNavigation = useUi(s => s.toggleNavigation)
  const resetProcessView = useUi(s => s.resetProcessView)
  const modules = useStore(s => s.modules)
  const openFaceplate = useUi(s => s.openFaceplate)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)
  const currentUser = useSecurity((s) => s.currentUser)
  const users = useSecurity((s) => s.users)
  const lockWorkstation = useSecurity((s) => s.lockWorkstation)
  const logEvent = useStore((s) => s.logEvent)
  const fullName = users.find((u) => u.name === currentUser)?.fullName ?? currentUser

  const lockAndLog = (): void => {
    logEvent('SECURITY', currentUser, 'Workstation locked (FlexLock)')
    lockWorkstation()
  }

  const current = DISPLAY_NAVIGATION.find(n => n.id === display)
  const searchText = query.trim().toLowerCase()
  const matchingDisplays = DISPLAY_NAVIGATION.filter(n => n.label.toLowerCase().includes(searchText))
  const matchingModules = Object.values(modules).filter(m =>
    `${m.tag} ${m.description}`.toLowerCase().includes(searchText)
  )

  useEffect(() => {
    if (!searchOpen) return
    const close = (event: MouseEvent): void => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [searchOpen])

  const startNewProject = (kind: 'pharma' | 'blank'): void => {
    const label = kind === 'blank' ? 'a new blank project' : 'the GMP Pharma Factory baseline'
    if (!window.confirm(`Discard the current project and load ${label}? This cannot be undone.`)) return
    newProject(kind)
    resetToOverview()
  }

  return (
    <div className="topbar operator-ribbons">
      <div className="operator-ribbon utility-ribbon" role="toolbar" aria-label="Operator utilities">
        <div className="ribbon-search" ref={searchRef}>
          <RibbonButton icon="search" label="Search displays and modules" pressed={searchOpen} onClick={() => setSearchOpen(v => !v)} />
          {searchOpen && <div className="ribbon-search-pop" role="dialog" aria-label="Search displays and modules">
            <input autoFocus aria-label="Display or module search" placeholder="Display, tag or description"
              value={query} onChange={event => setQuery(event.target.value)} />
            <div className="ribbon-search-results">
              {matchingDisplays.map(n => <button key={n.id} onClick={() => { navigate(n.id); setSearchOpen(false) }}>
                {n.label}
              </button>)}
              {matchingModules.map(m => <button key={m.tag} onClick={() => { openFaceplate(m.tag); setSearchOpen(false) }}>
                <b>{m.tag}</b> {m.description}
              </button>)}
              {!matchingDisplays.length && !matchingModules.length && <span role="status">No matching displays or modules</span>}
            </div>
          </div>}
        </div>
        <RibbonButton icon="diagnostics" label="Simulated hardware diagnostics" onClick={() => navigate('hardware')} />
        <RibbonButton icon="tools" label="Control Studio" onClick={() => navigate('studio')} />
        <RibbonButton icon="reset" label="Reset graphic view (does not reset process)" disabled={!current?.operator} onClick={resetProcessView} />
        <RibbonButton icon="alarm" label="Alarm List" onClick={() => navigate('alarms')} />
        <RibbonButton icon="explorer" label="DeltaV Explorer" onClick={() => navigate('explorer')} />
        <RibbonButton icon="batch" label="Batch Operator" onClick={() => navigate('batch')} />
        <RibbonButton icon="trend" label="Historian Trends" onClick={() => navigate('trend')} />
        <RibbonButton icon="builder" label="Display Builder" onClick={() => navigate('builder')} />
        <RibbonButton icon="user" label="User Manager" onClick={() => navigate('users')} />
        <RibbonButton icon="security" label="Lock Workstation (FlexLock)" onClick={lockAndLog} />
        <RibbonButton icon="hardware" label="Physical Network" onClick={() => navigate('hardware')} />
        <div className="spacer" />
      <div className="brand">
        <span className="logo">BL</span>
        <span className="brand-text" title="BatchLive - Charles R. Freeman, software engineer">
          <span className="brand-name">BatchLive</span>
          <span className="brand-credit">Charles R. Freeman, software engineer</span>
        </span>
      </div>
        <div className="clock">{dateString(time)} {clockString(time)}</div>
        <div className="user"><span className="user-name" title={fullName}>{fullName}</span></div>
      </div>
      <div className="operator-ribbon action-ribbon" role="toolbar" aria-label="Display actions">
        <RibbonButton icon="eye" label="Show navigation sidebar" pressed={navigationOpen} onClick={toggleNavigation} />
        <RibbonButton icon="display" label="Plant Overview" onClick={() => navigate('overview')} />
        <RibbonButton icon="info" label="Event Journal" onClick={() => navigate('journal')} />
        <RibbonButton icon="sfc" label="SFC Charts" onClick={() => navigate('sfc')} />
        <RibbonButton icon="help" label="DV-09 Workshops" onClick={() => navigate('workshops')} />
        <RibbonButton icon="forward" label="Next display in history" disabled={histIndex >= histLen - 1} onClick={forward} />
        <RibbonButton icon="alarm" label="Alarm List" onClick={() => navigate('alarms')} />
        <span className="ribbon-separator" />
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
        <div className="spacer" />
        <button className={'tbtn sm' + (running ? ' active' : '')} onClick={() => setRunning(!running)}
          title="Run / hold the process simulation">{running ? '❚❚ Running' : '▶ Hold'}</button>
        <select className="select-dark" value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="Simulation speed">
          <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
          <option value={5}>5×</option><option value={10}>10×</option>
        </select>
      </div>
      <div className="operator-ribbon navigation-ribbon" role="toolbar" aria-label="Picture navigation">
      <div className="nav-arrows">
        <RibbonButton icon="back" label="Back" disabled={histIndex <= 0} onClick={back} />
        <RibbonButton icon="forward" label="Forward" disabled={histIndex >= histLen - 1} onClick={forward} />
        <RibbonButton icon="up" label="Up to Plant Overview" disabled={display === 'overview'} onClick={() => navigate('overview')} />
        <RibbonButton icon="home" label="Home display" onClick={() => navigate('overview')} />
      </div>
      <select className="picture-selector" aria-label="Current display" value={display}
        onChange={event => {
          const target = DISPLAY_NAVIGATION.find(n => n.id === event.target.value)
          if (target) navigate(target.id)
        }}>
        <optgroup label="Process displays">{DISPLAY_NAVIGATION.filter(n => n.operator).map(n =>
          <option key={n.id} value={n.id}>{n.label}</option>
        )}</optgroup>
        <optgroup label="Tools and engineering">{DISPLAY_NAVIGATION.filter(n => !n.operator).map(n =>
          <option key={n.id} value={n.id}>{n.label}</option>
        )}</optgroup>
      </select>
        <span className="ribbon-picture-name">{current?.label}</span>
      </div>
    </div>
  )
}
