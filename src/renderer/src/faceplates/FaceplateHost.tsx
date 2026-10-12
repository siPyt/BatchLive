import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useUi } from '../ui/uiStore'
import { useStore } from '../engine/store'
import { PidFaceplate } from './PidFaceplate'
import { MotorFaceplate } from './MotorFaceplate'
import { ValveFaceplate } from './ValveFaceplate'
import { AiFaceplate } from './AiFaceplate'
import { DiscreteFaceplate } from './DiscreteFaceplate'
import { AoFaceplate } from './AoFaceplate'
import { moduleTrendPens } from '../engine/trendPens'
import { moduleOwnUnacknowledgedAlarms } from '../utils/format'
import { PidDetailDialog } from './PidDetailDialog'
import { FfDeviceFaceplate } from './FfDeviceFaceplate'
import { findFfDevice } from '../engine/deviceAlarms'

/** Renders every open faceplate window. */
export function FaceplateHost(): JSX.Element {
  const faceplates = useUi((s) => s.faceplates)
  const detailTag = useUi(state => state.pidDetailTag)
  const closeDetail = useUi(state => state.closePidDetail)
  const modules = useStore((s) => s.modules)
  const hardware = useStore((s) => s.hardware)
  const order = [...faceplates].sort((a, b) => a.z - b.z)
  const zIndexFor = (tag: string): number => 50 + order.findIndex((f) => f.tag === tag)
  return (
    <>
      {faceplates.map((f) => (
        !modules[f.tag] && findFfDevice(hardware, f.tag)
          ? <FfDeviceFaceplate key={f.tag} tag={f.tag} x={f.x} y={f.y} zIndex={zIndexFor(f.tag)} />
          : <FaceplateWindow key={f.tag} tag={f.tag} x={f.x} y={f.y} zIndex={zIndexFor(f.tag)} />
      ))}
      {detailTag && <PidDetailDialog tag={detailTag} onClose={closeDetail} />}
    </>
  )
}

function FaceplateWindow({ tag, x, y, zIndex }: { tag: string; x: number; y: number; zIndex: number }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const alarms = useStore((s) => s.alarms)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const close = useUi((s) => s.closeFaceplate)
  const move = useUi((s) => s.moveFaceplate)
  const focusFaceplate = useUi((s) => s.focusFaceplate)
  const openStudio = useUi((s) => s.openStudio)
  const focusExplorer = useUi((s) => s.focusExplorer)
  const focusTrend = useUi((s) => s.focusTrend)
  const focusAlarms = useUi((s) => s.focusAlarms)
  const openModuleDisplay = useUi(s => s.openModuleDisplay)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [scale, setScale] = useState(1)

  // Keep the whole faceplate on screen: if it is taller than the space below its
  // top edge, shrink it uniformly so every control stays visible (never clipped).
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (minimized) { setScale(1); return }
    const recompute = (): void => {
      const naturalH = el.offsetHeight
      if (!naturalH) return
      const avail = window.innerHeight - y - 12
      setScale(Math.max(0.4, Math.min(1, avail / naturalH)))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    window.addEventListener('resize', recompute)
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute) }
  }, [y, minimized, tag, showHelp])

  useEffect(() => {
    function onMove(e: MouseEvent): void {
      if (!drag.current) return
      move(tag, e.clientX - drag.current.dx, e.clientY - drag.current.dy)
    }
    function onUp(): void {
      drag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [tag, move])

  if (!m) return null

  // DV09 real-DeltaV faceplate chrome: "Ack Alarm" acknowledges this module's
  // own active, unacknowledged alarm(s) directly, without opening Alarm Summary.
  const ownUnacked = moduleOwnUnacknowledgedAlarms(tag, alarms)

  let body: ReactNode = null
  switch (m.type) {
    case 'PID':
      body = <PidFaceplate tag={tag} />
      break
    case 'MOTOR':
      body = <MotorFaceplate tag={tag} />
      break
    case 'VALVE':
      body = <ValveFaceplate tag={tag} />
      break
    case 'AI':
      body = <AiFaceplate tag={tag} />
      break
    case 'AO':
      body = <AoFaceplate tag={tag} />
      break
    case 'DI':
    case 'DO':
      body = <DiscreteFaceplate tag={tag} />
      break
  }

  return (
    <div ref={rootRef} className={'faceplate' + (minimized ? ' minimized' : '')}
      style={{ left: x, top: y, zIndex, transform: minimized ? undefined : `scale(${scale})`, transformOrigin: 'top left' }}
      onMouseDown={() => focusFaceplate(tag)}>
      <div
        className="fp-header"
        onMouseDown={(e) => {
          drag.current = { dx: e.clientX - x, dy: e.clientY - y }
        }}
        onDoubleClick={() => setMinimized((v) => !v)}
        title="Double-click to minimize / restore"
      >
        <span className="fp-tag">{tag}</span>
        <span className="fp-desc">{m.description}</span>
        <button className="fp-close" onClick={() => setMinimized((v) => !v)} title={minimized ? 'Restore' : 'Minimize'}>
          {minimized ? '▢' : '—'}
        </button>
        <button className="fp-close" onClick={() => close(tag)} title="Close">
          ×
        </button>
      </div>
      {!minimized && <>
      {body}
      {(m.primaryDisplay || m.detailDisplay || m.type === 'PID') && <div className="fp-links">
        {m.primaryDisplay && <button className="fp-link-btn" onClick={() => openModuleDisplay(tag, 'primary')}
          title={`Primary control display: ${m.primaryDisplay}`}>Primary</button>}
        {(m.detailDisplay || m.type === 'PID') && <button className="fp-link-btn" onClick={() => openModuleDisplay(tag, 'detail')}
          title={m.detailDisplay ? `Detail display: ${m.detailDisplay}` : 'Simulator PID detail tuning'}>Detail</button>}
      </div>}
      <div className="fp-util-icons">
        <button className="fp-icon-btn" onClick={() => openStudio(tag)} title="Open with Control Studio" aria-label="Open with Control Studio">
          ⌁
        </button>
        <button className="fp-icon-btn" onClick={() => focusExplorer(tag)} title="Locate in DeltaV Explorer" aria-label="Locate in DeltaV Explorer">
          ▦
        </button>
        {moduleTrendPens(m).length > 0 && (
          <button className="fp-icon-btn" onClick={() => focusTrend(tag)} title="Open Historian Trend" aria-label="Open Historian Trend">
            📈
          </button>
        )}
        {m.alarms.length > 0 && (
          <button className="fp-icon-btn" onClick={() => focusAlarms(tag)} title="Open Alarm List" aria-label="Open Alarm List">
            ⚠
          </button>
        )}
      </div>
      {showHelp && (
        <div className="fp-help-pop">
          <div><b>{tag}</b> — {m.description}</div>
          <div>Module type: {m.type}</div>
          {m.equipmentModule && <div>Equipment Module: {m.equipmentModule}</div>}
          <div>Use the mode/command controls above to operate this module; use Ack Alarm to acknowledge
            its own active alarms, or the icon row to open Control Studio, DeltaV Explorer, Trend or
            Alarm List for this tag.</div>
        </div>
      )}
      <div className="fp-help-ack">
        <button className="fp-link-btn" onClick={() => setShowHelp((v) => !v)} title="About this faceplate">
          Help
        </button>
        {m.alarms.length > 0 && (
          <button className="fp-link-btn" disabled={ownUnacked.length === 0}
            onClick={() => ownUnacked.forEach((a) => ackAlarm(a.id))}
            title="Acknowledge this module's own active alarm(s) without opening Alarm Summary">
            Ack Alarm
          </button>
        )}
      </div>
      </>}
    </div>
  )
}
