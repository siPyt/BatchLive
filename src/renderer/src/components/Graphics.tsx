import { useUi } from '../ui/uiStore'

/** Reusable SVG process-graphic primitives in DeltaV equipment style. */

export function Tank({
  x,
  y,
  w,
  h,
  level,
  label,
  liquidColor = 'var(--dv-liquid)'
}: {
  x: number
  y: number
  w: number
  h: number
  level: number
  label: string
  liquidColor?: string
}): JSX.Element {
  const fillH = (Math.max(0, Math.min(100, level)) / 100) * (h - 6)
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      <rect
        x={x + 3}
        y={y + h - 3 - fillH}
        width={w - 6}
        height={fillH}
        rx={3}
        fill={liquidColor}
        opacity={0.85}
      />
      {/* level graduations */}
      {[25, 50, 75].map((p) => (
        <line
          key={p}
          x1={x}
          x2={x + 8}
          y1={y + h - (p / 100) * h}
          y2={y + h - (p / 100) * h}
          stroke="var(--dv-metal)"
          strokeWidth={1}
        />
      ))}
      <text x={x + w / 2} y={y - 8} fill="var(--dv-text)" fontSize={12} fontWeight={700} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

export function Pump({
  x,
  y,
  running,
  tag,
  r = 20
}: {
  x: number
  y: number
  running: boolean
  tag: string
  r?: number
}): JSX.Element {
  const open = useUi((s) => s.openFaceplate)
  const color = running ? 'var(--dv-run)' : 'var(--dv-stop)'
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => open(tag)}>
      <circle cx={x} cy={y} r={r} fill="#eef1f4" stroke={color} strokeWidth={2.5} />
      <polygon
        points={`${x - r * 0.4},${y - r * 0.5} ${x - r * 0.4},${y + r * 0.5} ${x + r * 0.6},${y}`}
        fill={color}
      />
      {running && (
        <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={1} opacity={0.5}>
          <animate attributeName="r" from={r} to={r + 6} dur="1.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
      <text x={x} y={y + r + 13} fill="var(--dv-text-dim)" fontSize={10} textAnchor="middle" fontWeight={700}>
        {tag}
      </text>
    </g>
  )
}

export function GateValve({
  x,
  y,
  open,
  tag,
  interlock
}: {
  x: number
  y: number
  open: boolean
  tag: string
  interlock?: boolean
}): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const color = interlock ? 'var(--dv-critical)' : open ? 'var(--dv-run)' : 'var(--dv-stop)'
  const s = 11
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <polygon points={`${x - s},${y - s} ${x + s},${y + s} ${x + s},${y - s} ${x - s},${y + s}`} fill={color} stroke="#0c1013" strokeWidth={1} />
      <text x={x} y={y + s + 13} fill="var(--dv-text-dim)" fontSize={9} textAnchor="middle" fontWeight={700}>
        {tag}
      </text>
    </g>
  )
}

export function ControlValve({
  x,
  y,
  position,
  tag
}: {
  x: number
  y: number
  position: number
  tag: string
}): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const s = 11
  const pct = Math.max(0, Math.min(100, position))
  const col = `rgb(${Math.round(60 + pct * 0.4)}, ${Math.round(140 + pct)}, 214)`
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <polygon
        points={`${x - s},${y - s} ${x + s},${y + s} ${x + s},${y - s} ${x - s},${y + s}`}
        fill={col}
        stroke="#0c1013"
        strokeWidth={1}
      />
      {/* actuator */}
      <line x1={x} y1={y} x2={x} y2={y - 16} stroke="#8a97a5" strokeWidth={2} />
      <rect x={x - 9} y={y - 24} width={18} height={9} rx={2} fill="#e4e7ea" stroke="var(--dv-metal)" strokeWidth={1.5} />
      <text x={x} y={y + s + 13} fill="var(--dv-text-dim)" fontSize={9} textAnchor="middle" fontWeight={700}>
        {tag}
      </text>
    </g>
  )
}

export function Pipe({
  d,
  active = true,
  width = 5
}: {
  d: string
  active?: boolean
  width?: number
}): JSX.Element {
  return (
    <path
      d={d}
      fill="none"
      stroke={active ? 'var(--dv-pipe-active)' : 'var(--dv-pipe)'}
      strokeWidth={width}
      strokeLinejoin="round"
      strokeLinecap="round"
      opacity={active ? 0.95 : 0.6}
    />
  )
}

export function FlowDot({ path, active }: { path: string; active: boolean }): JSX.Element | null {
  if (!active) return null
  return (
    <circle r={3} fill="#2f80c4">
      <animateMotion dur="2s" repeatCount="indefinite" path={path} />
    </circle>
  )
}

export function Label({
  x,
  y,
  text,
  anchor = 'middle'
}: {
  x: number
  y: number
  text: string
  anchor?: 'start' | 'middle' | 'end'
}): JSX.Element {
  return (
    <text x={x} y={y} fill="var(--dv-text-mute)" fontSize={11} textAnchor={anchor} fontWeight={600}>
      {text}
    </text>
  )
}
