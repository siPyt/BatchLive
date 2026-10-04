import { useEffect, useRef, type ReactNode } from 'react'
import { useUi } from '../ui/uiStore'
import { useStore } from '../engine/store'
import { PidFaceplate } from './PidFaceplate'
import { MotorFaceplate } from './MotorFaceplate'
import { ValveFaceplate } from './ValveFaceplate'
import { AiFaceplate } from './AiFaceplate'
import { DiscreteFaceplate } from './DiscreteFaceplate'
import { AoFaceplate } from './AoFaceplate'
import { moduleTrendPens } from '../engine/trendPens'
import { PidDetailDialog } from './PidDetailDialog'

/** Renders every open faceplate window. */
export function FaceplateHost(): JSX.Element {
  const faceplates = useUi((s) => s.faceplates)
  const detailTag = useUi(state => state.pidDetailTag)
  const closeDetail = useUi(state => state.closePidDetail)
  return (
    <>
      {faceplates.map((f) => (
        <FaceplateWindow key={f.tag} tag={f.tag} x={f.x} y={f.y} />
      ))}
      {detailTag && <PidDetailDialog tag={detailTag} onClose={closeDetail} />}
    </>
  )
}

function FaceplateWindow({ tag, x, y }: { tag: string; x: number; y: number }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const close = useUi((s) => s.closeFaceplate)
  const move = useUi((s) => s.moveFaceplate)
  const select = useUi((s) => s.select)
  const openStudio = useUi((s) => s.openStudio)
  const focusExplorer = useUi((s) => s.focusExplorer)
  const focusTrend = useUi((s) => s.focusTrend)
  const focusAlarms = useUi((s) => s.focusAlarms)
  const openModuleDisplay = useUi(s => s.openModuleDisplay)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

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
    <div className="faceplate" style={{ left: x, top: y }} onMouseDown={() => select(tag)}>
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
      <div className="fp-links">
        <button className="fp-link-btn" onClick={() => openStudio(tag)} title="Open with Control Studio">
          ⌁ Studio
        </button>
        <button className="fp-link-btn" onClick={() => focusExplorer(tag)} title="Locate in DeltaV Explorer">
          ▦ Explorer
        </button>
        {moduleTrendPens(m).length > 0 && (
          <button className="fp-link-btn" onClick={() => focusTrend(tag)} title="Open Historian Trend">
            📈 Trend
          </button>
        )}
        {m.alarms.length > 0 && (
          <button className="fp-link-btn" onClick={() => focusAlarms(tag)} title="Open Alarm List">
            ⚠ Alarms
          </button>
        )}
      </div>
    </div>
  )
}
