import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  return (
    <>
      {faceplates.map((f) => (
        !modules[f.tag] && findFfDevice(hardware, f.tag)
          ? <FfDeviceFaceplate key={f.tag} tag={f.tag} x={f.x} y={f.y} />
          : <FaceplateWindow key={f.tag} tag={f.tag} x={f.x} y={f.y} />
      ))}
      {detailTag && <PidDetailDialog tag={detailTag} onClose={closeDetail} />}
    </>
  )
}

function FaceplateWindow({ tag, x, y }: { tag: string; x: number; y: number }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const alarms = useStore((s) => s.alarms)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const close = useUi((s) => s.closeFaceplate)
  const move = useUi((s) => s.moveFaceplate)
  const select = useUi((s) => s.select)
  const openStudio = useUi((s) => s.openStudio)
  const focusExplorer = useUi((s) => s.focusExplorer)
  const focusTrend = useUi((s) => s.focusTrend)
  const focusAlarms = useUi((s) => s.focusAlarms)
  const openModuleDisplay = useUi(s => s.openModuleDisplay)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [showHelp, setShowHelp] = useState(false)

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
    <div className="faceplate" style={{ left: x, top: y, maxHeight: `calc(100% - ${Math.max(0, y)}px - 12px)` }} onMouseDown={() => select(tag)}>
      <div
        className="fp-header"
        onMouseDown={(e) => {
          drag.current = { dx: e.clientX - x, dy: e.clientY - y }
        }}
      >
        <span className="fp-tag">{tag}</span>
        <span className="fp-desc">{m.description}</span>
        <button className="fp-close" onClick={() => close(tag)} title="Close">
          ×
        </button>
      </div>
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
    </div>
  )
}
