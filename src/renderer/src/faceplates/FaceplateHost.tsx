import { useEffect, useRef, type ReactNode } from 'react'
import { useUi } from '../ui/uiStore'
import { useStore } from '../engine/store'
import { PidFaceplate } from './PidFaceplate'
import { MotorFaceplate } from './MotorFaceplate'
import { ValveFaceplate } from './ValveFaceplate'
import { AiFaceplate } from './AiFaceplate'
import { DiscreteFaceplate } from './DiscreteFaceplate'

/** Renders every open faceplate window. */
export function FaceplateHost(): JSX.Element {
  const faceplates = useUi((s) => s.faceplates)
  return (
    <>
      {faceplates.map((f) => (
        <FaceplateWindow key={f.tag} tag={f.tag} x={f.x} y={f.y} />
      ))}
    </>
  )
}

function FaceplateWindow({ tag, x, y }: { tag: string; x: number; y: number }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const close = useUi((s) => s.closeFaceplate)
  const move = useUi((s) => s.moveFaceplate)
  const select = useUi((s) => s.select)
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
    </div>
  )
}
