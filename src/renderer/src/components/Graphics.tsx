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
      <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--dv-panel-2)" stroke="var(--dv-border-light)" strokeWidth={2.5} />
      <rect
        x={x + 3}
        y={y + h - 3 - fillH}
        width={w - 6}
        height={fillH}
        rx={3}
        fill={liquidColor}
        opacity={0.5}
      />
      {/* level graduations */}
      {[25, 50, 75].map((p) => (
        <line
          key={p}
          x1={x}
          x2={x + 8}
          y1={y + h - (p / 100) * h}
          y2={y + h - (p / 100) * h}
          stroke="var(--dv-border-light)"
          strokeWidth={1}
        />
      ))}
      <text x={x + w / 2} y={y - 8} fill="var(--dv-text)" fontSize={12} fontWeight={700} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

/** Centrifugal pump dynamo: motor stator housing (with cooling fins) coupled
 * via a lantern spool to the volute casing, with a vertical tangential
 * discharge spout and center shaft hub — standardized ISA-5.1 rotating-
 * machinery silhouette. `orientation` mirrors the whole assembly so the
 * motor/discharge side can be flipped to match the surrounding piping. */
export function Pump({
  x,
  y,
  running,
  tag,
  fault = false,
  orientation = 'right'
}: {
  x: number
  y: number
  running: boolean
  tag: string
  fault?: boolean
  orientation?: 'right' | 'left'
}): JSX.Element {
  const open = useUi((s) => s.openFaceplate)
  // ISA-101: energized equipment reads as a muted slate-cyan, never a
  // high-saturation green; at-rest is pale/hollow; faulted is critical red.
  const bodyFill = fault ? 'var(--dv-critical)' : running ? 'var(--dv-energized)' : 'var(--dv-panel-2)'
  const bodyStroke = fault ? 'var(--dv-critical)' : running ? 'var(--dv-energized-2)' : 'var(--dv-border-light)'
  const flip = orientation === 'left' ? -1 : 1
  return (
    <g transform={`translate(${x} ${y}) scale(${flip}, 1)`} style={{ cursor: 'pointer' }} onClick={() => open(tag)}>
      {/* motor stator housing + cooling fins */}
      <rect x={-36} y={-12} width={20} height={24} rx={1} fill="var(--dv-border-light)" stroke="var(--dv-metal)" strokeWidth={1.5} />
      <line x1={-31} y1={-12} x2={-31} y2={12} stroke="var(--dv-metal)" strokeWidth={1} />
      <line x1={-26} y1={-12} x2={-26} y2={12} stroke="var(--dv-metal)" strokeWidth={1} />
      {/* shaft coupling lantern spool */}
      <line x1={-16} y1={0} x2={-10} y2={0} stroke="var(--dv-metal)" strokeWidth={4} />
      {/* volute casing */}
      <circle cx={0} cy={0} r={18} fill={bodyFill} stroke={bodyStroke} strokeWidth={2} />
      {/* tangential vertical discharge spout */}
      <path d="M 8,0 L 18,0 L 18,-24 L 8,-24 Z" fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
      {/* center shaft hub bearing */}
      <circle cx={0} cy={0} r={4.5} fill="#ffffff" stroke="var(--dv-metal)" strokeWidth={1.5} />
      <text x={0} y={32} transform={`scale(${flip}, 1)`} fill="var(--dv-text-dim)" fontSize={10} fontWeight={700} textAnchor="middle">
        {tag}
      </text>
    </g>
  )
}

/** Agitator drive bridge motor — the same stator-housing-with-fins profile as
 * the pump motor, mounted atop a vessel head with a shaft descending inside. */
export function AgitatorDrive({ x, y, running, tag }: { x: number; y: number; running: boolean; tag: string }): JSX.Element {
  const open = useUi((s) => s.openFaceplate)
  const fill = running ? 'var(--dv-energized)' : 'var(--dv-panel-2)'
  return (
    <g transform={`translate(${x} ${y})`} style={{ cursor: 'pointer' }} onClick={() => open(tag)}>
      <rect x={-13} y={-22} width={26} height={22} rx={2} fill="var(--dv-border-light)" stroke="var(--dv-metal)" strokeWidth={1.5} />
      <line x1={-6} y1={-22} x2={-6} y2={0} stroke="var(--dv-metal)" strokeWidth={1} />
      <line x1={1} y1={-22} x2={1} y2={0} stroke="var(--dv-metal)" strokeWidth={1} />
      <rect x={-5} y={0} width={10} height={9} fill={fill} stroke="var(--dv-metal)" strokeWidth={1.2} />
      <text x={0} y={-27} fill="var(--dv-text-dim)" fontSize={9} fontWeight={700} textAnchor="middle">
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
  // ISA-101: open/energized valves read as muted slate-cyan — only an
  // interlock override turns red.
  const color = interlock ? 'var(--dv-critical)' : open ? 'var(--dv-energized)' : 'var(--dv-stop)'
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
      {/* pneumatic diaphragm actuator */}
      <line x1={x} y1={y} x2={x} y2={y - 14} stroke="#8a97a5" strokeWidth={2} />
      <path
        d={`M ${x - 10},${y - 14} A 10 9 0 0 1 ${x + 10},${y - 14} Z`}
        fill="#e4e7ea"
        stroke="var(--dv-metal)"
        strokeWidth={1.5}
      />
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

/** Static ISA-101 flow-direction chevron — pipes indicate direction with a
 * fixed ">" mark, never animated dashes or glowing dots. */
export function Chevron({
  x,
  y,
  angle = 0,
  active = true
}: {
  x: number
  y: number
  angle?: number
  active?: boolean
}): JSX.Element {
  return (
    <polyline
      points="-4,-5 2,0 -4,5"
      transform={`translate(${x} ${y}) rotate(${angle})`}
      fill="none"
      stroke={active ? 'var(--dv-pipe-active)' : 'var(--dv-pipe)'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={active ? 0.9 : 0.5}
    />
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

/** ISA-5.1 instrument tap: a filled circle on the process line plus a dashed
 * signal leader running to the dynamo — so dynamos never float disconnected
 * from the process they measure. */
export function InstrumentTap({ tapX, tapY, toX, toY }: { tapX: number; tapY: number; toX: number; toY: number }): JSX.Element {
  return (
    <g>
      <line x1={tapX} y1={tapY} x2={toX} y2={toY} stroke="var(--dv-instrument-line)" strokeWidth={1.2} strokeDasharray="4,3" />
      <circle cx={tapX} cy={tapY} r={3.5} fill="var(--dv-metal)" />
    </g>
  )
}

/** Software permissive/interlock diamond badge next to a motor or valve —
 * shows why an actuator is inhibited from running (ISA interlock glyph). */
export function PermissiveFlag({ x, y, ok }: { x: number; y: number; ok: boolean }): JSX.Element {
  const s = 9
  const color = ok ? 'var(--dv-energized)' : 'var(--dv-critical)'
  return (
    <g>
      <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill="#ffffff" stroke={color} strokeWidth={1.5} />
      <text x={x} y={y + 3} fill={color} fontSize={6.5} fontWeight={800} textAnchor="middle">
        {ok ? 'OK' : 'TRIP'}
      </text>
    </g>
  )
}

/** Off-page / off-sheet utility connector arrow — pair with a <Label> for
 * utility lines that route elsewhere rather than dead-ending in space. */
export function OffPageArrow({ x, y, angle = 0 }: { x: number; y: number; angle?: number }): JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <polygon points="0,-7 14,0 0,7" fill="var(--dv-metal)" />
    </g>
  )
}

