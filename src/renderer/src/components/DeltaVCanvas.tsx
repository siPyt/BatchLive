import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type MouseEvent,
  type WheelEvent
} from 'react'

interface ViewportTransform {
  x: number
  y: number
  scale: number
}

export interface DeltaVCanvasHandle {
  /** Jump the camera to center a world-space point at a given zoom level. */
  jumpTo: (worldX: number, worldY: number, scale?: number) => void
}

/** DeltaV Live style infinite spatial canvas: ONE master SVG `<g>` camera
 * transform (drag to pan, wheel to zoom-to-cursor, clamped scale) — the
 * entire plant lives on one continuous X/Y coordinate plane, not stacked
 * HTML sections. No viewBox scaling: the camera `<g>` transform is the only
 * source of pan/zoom, so 1 world unit stays 1 CSS pixel at scale 1. */
export const DeltaVCanvas = forwardRef<DeltaVCanvasHandle, { children: ReactNode; initialScale?: number; initialX?: number; initialY?: number }>(
  function DeltaVCanvas({ children, initialScale = 1, initialX = 0, initialY = 0 }, ref) {
    const [transform, setTransform] = useState<ViewportTransform>({ x: initialX, y: initialY, scale: initialScale })
    const [isPanning, setIsPanning] = useState(false)
    const startPanRef = useRef<{ startX: number; startY: number }>({ startX: 0, startY: 0 })
    const containerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      jumpTo: (worldX, worldY, scale) => {
        const s = scale ?? transform.scale
        const rect = containerRef.current?.getBoundingClientRect()
        const viewW = rect?.width ?? 1000
        const viewH = rect?.height ?? 600
        setTransform({ x: viewW / 2 - worldX * s, y: viewH / 2 - worldY * s, scale: s })
      }
    }))

    const handleMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0 && e.button !== 1) return
      setIsPanning(true)
      startPanRef.current = { startX: e.clientX - transform.x, startY: e.clientY - transform.y }
    }

    const handleMouseMove = useCallback(
      (e: MouseEvent) => {
        if (!isPanning) return
        setTransform((prev) => ({ ...prev, x: e.clientX - startPanRef.current.startX, y: e.clientY - startPanRef.current.startY }))
      },
      [isPanning]
    )

    const handleMouseUp = (): void => setIsPanning(false)

    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const zoomFactor = 1.1
      const direction = e.deltaY < 0 ? 1 : -1
      const newScale = direction > 0 ? transform.scale * zoomFactor : transform.scale / zoomFactor
      const clampedScale = Math.max(0.3, Math.min(2.2, newScale))
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const scaleRatio = clampedScale / transform.scale
      const newX = mouseX - (mouseX - transform.x) * scaleRatio
      const newY = mouseY - (mouseY - transform.y) * scaleRatio
      setTransform({ x: newX, y: newY, scale: clampedScale })
    }

    return (
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          cursor: isPanning ? 'grabbing' : 'grab',
          userSelect: 'none',
          background: 'var(--dv-canvas-bg, #eaeaea)'
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            fontSize: 10,
            color: 'var(--dv-text-mute)',
            background: 'var(--dv-panel)',
            padding: '3px 6px',
            borderRadius: 3,
            border: '1px solid var(--dv-border)',
            pointerEvents: 'none'
          }}
        >
          {Math.round(transform.scale * 100)}%
        </div>
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>{children}</g>
        </svg>
      </div>
    )
  }
)

