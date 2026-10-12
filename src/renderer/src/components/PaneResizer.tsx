import { useEffect, useState } from 'react'

/** Persisted pane size (px) stored in localStorage so the operator's layout survives reloads. */
export function usePersistentSize(key: string, initial: number): [number, (value: number) => void] {
  const [value, setValue] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(key)
      const n = raw != null ? Number(raw) : NaN
      return Number.isFinite(n) ? n : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      /* storage unavailable (private mode) — keep the in-memory value */
    }
  }, [key, value])
  return [value, setValue]
}

interface PaneResizerProps {
  /** 'x' resizes a width by dragging left/right; 'y' resizes a height by dragging up/down. */
  axis: 'x' | 'y'
  /** +1 when the resized pane precedes the handle (grows dragging toward the end),
   *  -1 when it follows the handle (grows dragging toward the start). */
  sign: 1 | -1
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  label: string
}

/** A VS Code-style draggable splitter. Drag to resize the neighbouring pane; arrow keys nudge it. */
export function PaneResizer({ axis, sign, value, min, max, onChange, label }: PaneResizerProps): JSX.Element {
  const clamp = (v: number): number => Math.max(min, Math.min(max, v))

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const start = axis === 'x' ? event.clientX : event.clientY
    const base = value
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    target.classList.add('dragging')

    const move = (ev: PointerEvent): void => {
      const pos = axis === 'x' ? ev.clientX : ev.clientY
      onChange(clamp(base + (pos - start) * sign))
    }
    const up = (): void => {
      target.classList.remove('dragging')
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        /* pointer already released */
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 48 : 16
    if (axis === 'x' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      onChange(clamp(value + (event.key === 'ArrowRight' ? 1 : -1) * sign * step))
    } else if (axis === 'y' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onChange(clamp(value + (event.key === 'ArrowDown' ? 1 : -1) * sign * step))
    }
  }

  return (
    <div
      className={`pane-resizer pane-resizer-${axis}`}
      role="separator"
      tabIndex={0}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  )
}
