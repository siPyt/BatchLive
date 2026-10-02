import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { fmt, isPid } from '../utils/format'

// Classic DeltaV Operate (pre-"DeltaV Live") graphic primitives: pale
// gray-blue canvas, flat uncolored equipment, plain black-on-gray data
// boxes. Deliberately a different, lower-saturation art style from the dark
// DeltaV Live theme used everywhere else in this app — validated GMP sites
// commonly keep process graphics this muted so alarm colors are the only
// thing that stands out. Used only by the WFI Storage Tank & Loop display,
// to match the real site reference screenshot.

const PALE_BG = '#cdd6de'
const PALE_EQUIP = '#aebdc9'
const PALE_BORDER = '#5b7384'
const PALE_PIPE = '#6b8296'
const PALE_TEXT = '#17222b'
const PALE_GREEN = '#4a9f4a'
const PALE_RED = '#c0392b'

/** Full-bleed pale background rectangle — call once behind everything else. */
export function ClassicBackground({ w, h }: { w: number; h: number }): JSX.Element {
  return <rect x={0} y={0} width={w} height={h} fill={PALE_BG} />
}

export function ClassicPipe({ d, width = 3 }: { d: string; width?: number }): JSX.Element {
  return <path d={d} fill="none" stroke={PALE_PIPE} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
}

export function ClassicLabel({ x, y, text, anchor = 'middle' }: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }): JSX.Element {
  return (
    <text x={x} y={y} fill={PALE_TEXT} fontSize={10} textAnchor={anchor} fontFamily="'Segoe UI', sans-serif">
      {text}
    </text>
  )
}

/** Pale cylindrical storage tank with an internal level bar and support legs. */
export function ClassicTank({ x, y, w, h, level, label }: { x: number; y: number; w: number; h: number; level: number; label: string }): JSX.Element {
  const fillH = (Math.max(0, Math.min(100, level)) / 100) * (h - 8)
  return (
    <g>
      <ClassicLabel x={x + w / 2} y={y - 8} text={label} />
      <rect x={x} y={y} width={w} height={h} rx={w / 2} fill={PALE_EQUIP} stroke={PALE_BORDER} strokeWidth={2} />
      <rect x={x + 4} y={y + h - 4 - fillH} width={w - 8} height={fillH} rx={(w - 8) / 2} fill="#7fa3bd" opacity={0.7} />
      <line x1={x + w / 2 - 10} y1={y + h} x2={x + w / 2 - 14} y2={y + h + 16} stroke={PALE_BORDER} strokeWidth={2.5} />
      <line x1={x + w / 2 + 10} y1={y + h} x2={x + w / 2 + 14} y2={y + h + 16} stroke={PALE_BORDER} strokeWidth={2.5} />
    </g>
  )
}

/** Plain green/gray "H" hand-valve icon, with an optional blue mode/status
 * badge next to it (the "CA" box seen on the reference screen). */
export function ClassicValve({ x, y, open, tag, statusBadge }: { x: number; y: number; open: boolean; tag: string; statusBadge?: string }): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const color = open ? PALE_GREEN : '#8b97a0'
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <rect x={x - 9} y={y - 9} width={18} height={18} rx={2} fill="#eef1f3" stroke={PALE_BORDER} strokeWidth={1.3} />
      <circle cx={x} cy={y} r={6} fill={color} stroke={PALE_BORDER} strokeWidth={1} />
      <text x={x} y={y + 3.5} fill="#ffffff" fontSize={8} fontWeight={800} textAnchor="middle">
        H
      </text>
      {statusBadge && (
        <g>
          <rect x={x + 12} y={y - 7} width={20} height={14} fill="#dfe9f5" stroke="#3a6ea5" strokeWidth={1} />
          <text x={x + 22} y={y + 3} fill="#1a4a7a" fontSize={7} fontWeight={700} textAnchor="middle">
            {statusBadge}
          </text>
        </g>
      )}
      <ClassicLabel x={x} y={y + 24} text={tag} />
    </g>
  )
}

/** Simple motor/pump circle icon — no mechanical detail, just a labeled disk. */
export function ClassicPump({ x, y, running, tag }: { x: number; y: number; running: boolean; tag: string }): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <circle cx={x} cy={y} r={16} fill={running ? PALE_GREEN : PALE_EQUIP} stroke={PALE_BORDER} strokeWidth={1.5} />
      <text x={x} y={y + 4} fill={PALE_TEXT} fontSize={9} fontWeight={800} textAnchor="middle">
        M
      </text>
      <ClassicLabel x={x} y={y + 30} text={tag} />
    </g>
  )
}

/** Horizontal pill-shaped heat exchanger / cooler / heater silhouette. */
export function ClassicHex({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={1.5} />
      <ClassicLabel x={x + w / 2} y={y + h / 2 + 4} text={label} />
    </g>
  )
}

/** Rounded "flag" off-page utility connector badge (pointed end toward flow
 * direction), matching the real site screen's Glycol/Steam/Drain tags. */
export function ClassicFlag({ x, y, w = 70, h = 20, text, pointRight = true }: { x: number; y: number; w?: number; h?: number; text: string; pointRight?: boolean }): JSX.Element {
  const tip = pointRight ? 10 : -10
  const body = pointRight ? `M ${x},${y} H ${x + w} L ${x + w + tip},${y + h / 2} L ${x + w},${y + h} H ${x} Z` : `M ${x},${y + h} H ${x - w} L ${x - w + tip},${y + h / 2} L ${x - w},${y} H ${x} Z`
  return (
    <g>
      <path d={body} fill="#f4ecd0" stroke="#9a8a4a" strokeWidth={1.3} />
      <text x={pointRight ? x + w / 2 : x - w / 2} y={y + h / 2 + 4} fill={PALE_TEXT} fontSize={8} fontWeight={700} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

/** Flat gray data box: stacked PV/SP/OUT rows, plain black text, no color —
 * the classic Operate dynamo look (as opposed to DeltaV Live's styled dynamo). */
export function ClassicReadout({ tag, x, y }: { tag: string; x: number; y: number }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const openFaceplate = useUi((s) => s.openFaceplate)
  if (!m) return null
  const w = 96
  const rows: [string, string][] = []
  if (isPid(m)) {
    rows.push(['PV', `${fmt(m.pv, m.decimals)}${m.unit}`], ['SP', `${fmt(m.sp, m.decimals)}${m.unit}`], ['OUT', `${fmt(m.out, 1)}%`])
  } else if (m.type === 'AI') {
    rows.push(['PV', `${fmt(m.pv, m.decimals)}${m.unit}`])
  } else if (m.type === 'DI' || m.type === 'DO') {
    rows.push(['ST', m.state ? m.activeDescriptor : m.inactiveDescriptor])
  }
  const h = 13 + rows.length * 11
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => openFaceplate(tag)}>
      <rect x={x} y={y} width={w} height={h} fill="#eceeef" stroke="#6b7680" strokeWidth={1} />
      <text x={x + 4} y={y + 10} fill={PALE_TEXT} fontSize={8.5} fontWeight={700}>
        {tag}
      </text>
      {rows.map(([k, v], i) => (
        <g key={k}>
          <text x={x + 4} y={y + 22 + i * 11} fill="#3a4550" fontSize={8}>
            {k}
          </text>
          <text x={x + w - 4} y={y + 22 + i * 11} fill={PALE_TEXT} fontSize={8} fontWeight={700} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Plain status word (e.g. a TAH-xxx temperature-high switch) — just the tag
 * and a Normal/High word, no symbol, matching the real screen's alarm row. */
export function ClassicStatusWord({ x, y, tag, tripped }: { x: number; y: number; tag: string; tripped: boolean }): JSX.Element {
  return (
    <g>
      <text x={x} y={y} fill={PALE_TEXT} fontSize={8.5} fontWeight={700} textAnchor="middle">
        {tag}
      </text>
      <text x={x} y={y + 11} fill={tripped ? PALE_RED : '#3a7a3a'} fontSize={8.5} fontWeight={700} textAnchor="middle">
        {tripped ? 'High' : 'Normal'}
      </text>
    </g>
  )
}

/** Plain bordered info box (the Sani Schedule panel's real chrome: a thin
 * border, no dark header bar, with a button row underneath). */
export function ClassicPanel({ x, y, w, h, title, rows, button }: { x: number; y: number; w: number; h: number; title: string; rows: [string, string][]; button?: string }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#eceeef" stroke="#6b7680" strokeWidth={1.3} />
      <text x={x + w / 2} y={y + 13} fill={PALE_TEXT} fontSize={9} fontWeight={800} textAnchor="middle">
        {title}
      </text>
      {rows.map(([k, v], i) => (
        <g key={k}>
          <text x={x + 6} y={y + 28 + i * 13} fill="#3a4550" fontSize={8.5}>
            {k}
          </text>
          <text x={x + w - 6} y={y + 28 + i * 13} fill={PALE_TEXT} fontSize={8.5} fontWeight={700} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {button && (
        <g>
          <rect x={x + w / 2 - 36} y={y + h - 18} width={72} height={14} fill="#dfe3e6" stroke="#6b7680" strokeWidth={1} />
          <text x={x + w / 2} y={y + h - 8} fill={PALE_TEXT} fontSize={7.5} fontWeight={700} textAnchor="middle">
            {button}
          </text>
        </g>
      )}
    </g>
  )
}
