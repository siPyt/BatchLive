import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { fmt, isPid } from '../utils/format'

// Classic DeltaV Operate (pre-"DeltaV Live") graphic primitives: pale
// gray-blue canvas, green energized / black inactive device symbols,
// and plain black-on-gray data boxes.

export const PALE_BG = '#cdd6de'
export const PALE_EQUIP = '#aebdc9'
export const PALE_BORDER = '#5b7384'
export const PALE_PIPE = '#6b8296'
export const PALE_TEXT = '#17222b'
export const PALE_GREEN = '#3f8f32'
export const PALE_RED = '#c0392b'
const DEVICE_OFF = '#171d18'
const DEVICE_BLUE = '#252887'
type ValveOrientation = 'horizontal' | 'vertical'

function ValveBody({ color, actuatorColor = color, orientation = 'horizontal', actuator = 'block' }: {
  color: string
  actuatorColor?: string
  orientation?: ValveOrientation
  actuator?: 'block' | 'hand' | 'pneumatic'
}): JSX.Element {
  return (
    <g transform={orientation === 'vertical' ? 'rotate(90)' : undefined} fill={color} stroke={color} strokeWidth={0.8}>
      <path d="M-8,-6 L0,-1 L8,-6 V6 L0,1 L-8,6 Z" />
      <path d="M0,0 V-10" fill="none" strokeWidth={2} />
      {actuator === 'block' && <rect x={-8} y={-15} width={16} height={5} fill={actuatorColor} stroke={actuatorColor} />}
      {actuator === 'hand' && <path d="M-5,-10 H5" fill="none" stroke={actuatorColor} strokeWidth={2} />}
      {actuator === 'pneumatic' && <path d="M-9,-10 A9,7 0 0 1 9,-10 Z" fill={actuatorColor} stroke={actuatorColor} />}
    </g>
  )
}

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

/** Pale 3-D cylindrical storage tank: elliptical domed top, dished bottom,
 * three splayed support legs, and a thin internal level column — styled to
 * match the classic DeltaV Operate WFI storage-tank graphic. An optional
 * `below` caption renders a small boxed word (e.g. "Not In Use") under it. */
export function ClassicTank({ x, y, w, h, level, label, below, belowX }: { x: number; y: number; w: number; h: number; level: number; label: string; below?: string; belowX?: number }): JSX.Element {
  const uid = `${label}${x}${y}`.replace(/[^a-zA-Z0-9]/g, '')
  const lv = Math.max(0, Math.min(100, level))
  const domeH = 12
  const dishH = 16
  const cx = x + w / 2
  const bodyTop = y + domeH
  const bodyBot = y + h - dishH
  const bodyH = bodyBot - bodyTop
  const fillH = (lv / 100) * (bodyH - 6)
  const legY = y + h
  const captionX = belowX ?? cx
  return (
    <g>
      {label && <ClassicLabel x={cx} y={y - 6} text={label} />}
      <defs>
        <linearGradient id={`tk${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#96a9b8" />
          <stop offset="0.35" stopColor="#d9e1e8" />
          <stop offset="0.6" stopColor="#d4dce3" />
          <stop offset="1" stopColor="#8ea2b1" />
        </linearGradient>
      </defs>
      <path d={`M ${x},${bodyBot} Q ${cx},${bodyBot + dishH * 2} ${x + w},${bodyBot} Z`} fill={`url(#tk${uid})`} stroke={PALE_BORDER} strokeWidth={1.5} />
      <rect x={x} y={bodyTop} width={w} height={bodyH} fill={`url(#tk${uid})`} stroke={PALE_BORDER} strokeWidth={1.5} />
      <path d={`M ${x},${bodyTop} Q ${cx},${y - domeH} ${x + w},${bodyTop} Z`} fill={`url(#tk${uid})`} stroke={PALE_BORDER} strokeWidth={1.5} />
      <rect x={cx - 3} y={bodyTop + 3} width={6} height={bodyH - 6} fill="#eef2f5" stroke={PALE_BORDER} strokeWidth={0.6} />
      <rect x={cx - 3} y={bodyBot - 3 - fillH} width={6} height={fillH} fill="#5f7f94" opacity={0.8} />
      <line x1={cx - w * 0.28} y1={bodyBot + 2} x2={cx - w * 0.42} y2={legY + 18} stroke={PALE_BORDER} strokeWidth={3} />
      <line x1={cx} y1={bodyBot + dishH} x2={cx} y2={legY + 18} stroke={PALE_BORDER} strokeWidth={3} />
      <line x1={cx + w * 0.28} y1={bodyBot + 2} x2={cx + w * 0.42} y2={legY + 18} stroke={PALE_BORDER} strokeWidth={3} />
      {below && (
        <g>
          <rect x={captionX - 36} y={legY + 22} width={72} height={16} fill="#eceeef" stroke="#6b7680" strokeWidth={1} />
          <text x={captionX} y={legY + 33} fill={PALE_TEXT} fontSize={8.5} fontWeight={700} textAnchor="middle">{below}</text>
        </g>
      )}
    </g>
  )
}

export function ClassicValve({ x, y, open, tag, statusBadge, orientation }: { x: number; y: number; open: boolean; tag: string; statusBadge?: string; orientation?: ValveOrientation }): JSX.Element {
  return <ClassicSanitaryValve x={x} y={y} open={open} tag={tag} mode={statusBadge} orientation={orientation} />
}

/** Compact volute, shaft hub, foot and tangential outlet from IMG_0433. */
export function ClassicPump({
  x,
  y,
  running,
  tag,
  label = tag,
  labelPosition = 'below',
  discharge = 'up',
  animationColor
}: {
  x: number
  y: number
  running: boolean
  tag: string
  label?: string
  labelPosition?: 'below' | 'left' | 'right'
  discharge?: 'up' | 'right'
  animationColor?: string
}): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const stateColor = animationColor ?? (running ? PALE_GREEN : DEVICE_OFF)
  const outline = animationColor ? PALE_BORDER : running ? '#24551b' : DEVICE_OFF
  return (
    <g data-equipment-tag={tag} data-state={running ? 'running' : 'stopped'} style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <title>{`${label} (${tag}): ${running ? 'Running' : 'Stopped'}`}</title>
      <g transform={`translate(${x} ${y})`} fill={stateColor} stroke={outline} strokeWidth={1.2}>
        <path d="M-6,7 H6 L10,13 H-10 Z" />
        <path d={discharge === 'up' ? 'M5,-4 H13 V-15 H7 V-10 H5 Z' : 'M4,-10 H15 V-4 H8 Z'} />
        <circle r={10.5} />
        <circle r={5} fill="none" strokeWidth={1.5} />
      </g>
      <ClassicLabel
        x={labelPosition === 'right' ? x + 24 : labelPosition === 'left' ? x - 22 : x}
        y={labelPosition === 'below' ? y + 27 : y + 3}
        text={label}
        anchor={labelPosition === 'right' ? 'start' : labelPosition === 'left' ? 'end' : 'middle'}
      />
    </g>
  )
}

export function ClassicControlValve({ x, y, position, tag, label = tag, labelPosition = 'below', animationColor, actuatorAnimationColor, stateLabel }: {
  x: number; y: number; position: number; tag: string; label?: string; labelPosition?: 'above' | 'below'
  /** Replaces the percent-output tooltip for a two-position device (for example RECIRC / TRANSFER). */
  stateLabel?: string
  animationColor?: string
  actuatorAnimationColor?: string
}): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const pct = Math.max(0, Math.min(100, position))
  const color = animationColor ?? (pct > 0 ? PALE_GREEN : DEVICE_OFF)
  return (
    <g data-equipment-tag={tag} data-state={pct > 0 ? 'open' : 'closed'} style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <title>{`${label} (${tag}): ${stateLabel ?? `${pct.toFixed(1)}% output`}`}</title>
      <g transform={`translate(${x} ${y})`}>
        <ValveBody color={color} actuatorColor={actuatorAnimationColor} actuator="pneumatic" />
        <rect x={-10} y={10} width={20} height={3} fill="#eef1f3" stroke={PALE_BORDER} strokeWidth={0.5} />
        <rect x={-10} y={10} width={pct / 5} height={3} fill={color} />
      </g>
      <ClassicLabel x={x} y={labelPosition === 'above' ? y - 24 : y + 26} text={label} />
    </g>
  )
}

/** Agitator/mixer drive motor mounted on a vessel roof — same flat classic
 * palette, plain box + shaft lines, no mechanical housing detail. */
export function ClassicAgitatorDrive({ x, y, running, tag }: { x: number; y: number; running: boolean; tag: string }): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const color = running ? PALE_GREEN : DEVICE_OFF
  return (
    <g transform={`translate(${x} ${y})`} data-equipment-tag={tag} data-state={running ? 'running' : 'stopped'} style={{ cursor: 'pointer' }} onClick={() => openFp(tag)}>
      <title>{`${tag}: ${running ? 'Running' : 'Stopped'}`}</title>
      <rect x={-13} y={-22} width={26} height={22} rx={2} fill={color} stroke={PALE_BORDER} strokeWidth={1.5} />
      <line x1={-6} y1={-22} x2={-6} y2={0} stroke={PALE_BORDER} strokeWidth={1} />
      <line x1={1} y1={-22} x2={1} y2={0} stroke={PALE_BORDER} strokeWidth={1} />
      <rect x={-5} y={0} width={10} height={9} fill={color} stroke={PALE_BORDER} strokeWidth={1.2} />
      <text x={0} y={-27} fill={PALE_TEXT} fontSize={9} fontWeight={700} textAnchor="middle">
        {tag}
      </text>
    </g>
  )
}

/** Plain diamond permissive/interlock badge — matches the flat classic
 * style (no colored diamond outline glow, just a thin bordered marker). */
export function ClassicPermissiveFlag({ x, y, ok }: { x: number; y: number; ok: boolean }): JSX.Element {
  const s = 9
  const color = ok ? PALE_GREEN : PALE_RED
  return (
    <g>
      <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill="#eef1f3" stroke={color} strokeWidth={1.5} />
      <text x={x} y={y + 3} fill={color} fontSize={6.5} fontWeight={800} textAnchor="middle">
        {ok ? 'OK' : 'TRIP'}
      </text>
    </g>
  )
}

/** Plain bordered rounded-rect vessel shell (no level fill) — for header
 * vessels, chambers, and skid tanks drawn without a liquid-level readout. */
export function ClassicVessel({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label?: string }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={2} />
      {label && <ClassicLabel x={x + w / 2} y={y - 8} text={label} />}
    </g>
  )
}

/** Horizontal shell-and-tube heat exchanger: capsule shell with tube-sheet
 * end caps, an internal tube bundle, and a centered service label. Use `\n`
 * in `label` for a two-line caption (e.g. "WFI Recirc\nTrim Cooler"). */
export function ClassicHex({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }): JSX.Element {
  const uid = `${label}${x}${y}`.replace(/[^a-zA-Z0-9]/g, '')
  const cy = y + h / 2
  const lines = label.split('\n')
  const cap = h * 0.55
  return (
    <g>
      <defs>
        <linearGradient id={`hx${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c6d2db" />
          <stop offset="0.5" stopColor="#e4ebf0" />
          <stop offset="1" stopColor="#b7c5d0" />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={`url(#hx${uid})`} stroke={PALE_BORDER} strokeWidth={1.3} />
      <line x1={x + cap} y1={y + 3} x2={x + cap} y2={y + h - 3} stroke={PALE_BORDER} strokeWidth={0.8} opacity={0.6} />
      <line x1={x + w - cap} y1={y + 3} x2={x + w - cap} y2={y + h - 3} stroke={PALE_BORDER} strokeWidth={0.8} opacity={0.6} />
      {[0.3, 0.7].map((f) => (
        <line key={f} x1={x + cap} y1={y + h * f} x2={x + w - cap} y2={y + h * f} stroke={PALE_BORDER} strokeWidth={0.6} opacity={0.4} />
      ))}
      {lines.map((ln, i) => (
        <text key={i} x={x + w / 2} y={cy - (lines.length - 1) * 5 + i * 10 + 3.5} fill={PALE_TEXT} fontSize={9} fontWeight={600} textAnchor="middle" fontFamily="'Segoe UI', sans-serif">{ln}</text>
      ))}
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
  if (isPid(m) || m.type === 'AO') {
    rows.push(['PV', m.type === 'AO' && m.bad ? '????' : `${fmt(m.pv, m.decimals)}${m.unit}`],
      ['SP', `${fmt(m.sp, m.decimals)}${m.unit}`],
      ['OUT', m.type === 'AO' && m.bad ? '????' : `${fmt(m.out, 1)}%`])
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

/** Centered bold screen title, matching the DeltaV graphic header bar. */
export function ClassicTitle({ x, y, text }: { x: number; y: number; text: string }): JSX.Element {
  return (
    <text x={x} y={y} fill={PALE_TEXT} fontSize={16} fontWeight={800} textAnchor="middle" fontFamily="'Segoe UI', sans-serif">
      {text}
    </text>
  )
}

export function ClassicSanitaryValve({ x, y, open, tag, mode = 'CA', label = tag ?? 'Reference valve', orientation = 'horizontal', labelPosition = 'below', labelOffsetY = 0, animationColor, actuatorAnimationColor }: {
  x: number; y: number; open: boolean; tag?: string; mode?: string; label?: string
  orientation?: ValveOrientation; labelPosition?: 'above' | 'below' | 'right'
  labelOffsetY?: number
  animationColor?: string
  actuatorAnimationColor?: string
}): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const color = animationColor ?? (open ? PALE_GREEN : DEVICE_OFF)
  const vertical = orientation === 'vertical'
  return (
    <g data-equipment-tag={tag} data-state={open ? 'open' : 'closed'} style={{ cursor: tag ? 'pointer' : 'default' }} onClick={tag ? () => openFp(tag) : undefined}>
      <title>{`${label}${tag ? ` (${tag})` : ' (reference symbol only)'}: ${open ? 'Open' : 'Closed'}`}</title>
      <rect x={x - (vertical ? 26 : 23)} y={y - (vertical ? 19 : 20)} width={vertical ? 44 : 46} height={vertical ? 38 : 34} fill={PALE_BG} stroke={DEVICE_BLUE} strokeWidth={2} />
      <g transform={`translate(${x} ${y})`}><ValveBody color={color} actuatorColor={actuatorAnimationColor} orientation={orientation} /></g>
      <rect x={x - 20} y={y + 7} width={4} height={5} fill={DEVICE_BLUE} />
      <line x1={x - 18} y1={y + 8} x2={x - 18} y2={y + 11} stroke="#eef1f3" strokeWidth={0.6} />
      <text x={vertical ? x - 17 : x} y={vertical ? y + 3 : y + 11} fill={PALE_TEXT} fontSize={7} textAnchor="middle">{mode}</text>
      <ClassicLabel x={labelPosition === 'right' ? x + 23 : x} y={(labelPosition === 'above' ? y - 25 : labelPosition === 'right' ? y + 3 : y + 29) + labelOffsetY} text={label} anchor={labelPosition === 'right' ? 'start' : 'middle'} />
    </g>
  )
}

export function ClassicHandValve({ x, y, open = true, tag, label, orientation = 'horizontal', labelPosition = 'below' }: {
  x: number; y: number; open?: boolean; tag?: string; label?: string
  orientation?: ValveOrientation; labelPosition?: 'below' | 'right'
}): JSX.Element {
  const openFp = useUi((s) => s.openFaceplate)
  const color = open ? PALE_GREEN : DEVICE_OFF
  const click = tag ? () => openFp(tag) : undefined
  return (
    <g style={{ cursor: tag ? 'pointer' : 'default' }} onClick={click}>
      <title>{`${label ?? tag ?? 'Manual valve'}: ${open ? 'Open' : 'Closed'}${tag ? '' : ' (reference symbol only)'}`}</title>
      <g transform={`translate(${x} ${y})`}><ValveBody color={color} orientation={orientation} actuator="hand" /></g>
      {label && <ClassicLabel x={labelPosition === 'right' ? x + 22 : x} y={labelPosition === 'right' ? y + 3 : y + 24} text={label} anchor={labelPosition === 'right' ? 'start' : 'middle'} />}
    </g>
  )
}

/** Blue-bordered faceplate data box: mode letters on the left, PV/SP/OUT rows
 * and a small OUT% bargraph \u2014 the live loop dynamo on the WFI graphic. */
export function ClassicPidBox({ tag, x, y, label }: { tag: string; x: number; y: number; label?: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const openFaceplate = useUi((s) => s.openFaceplate)
  if (!m || !isPid(m)) return null
  const w = 120
  const h = 46
  const mode = m.actualMode === 'LO' ? 'LO' : m.mode === 'MAN' ? 'MA' : m.mode === 'CAS' ? 'CA' : m.mode === 'AUTO' ? 'AU' : m.mode
  const outFrac = Math.max(0, Math.min(1, m.out / 100))
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => openFaceplate(tag)}>
      <rect x={x} y={y} width={w} height={h} fill="#eef2f6" stroke="#2f5f96" strokeWidth={1.4} />
      <text x={x + 5} y={y + 11} fill={PALE_TEXT} fontSize={8} fontWeight={700}>{label ?? tag}</text>
      <text x={x + 7} y={y + 31} fill="#1a4a7a" fontSize={9} fontWeight={800}>{mode}</text>
      <text x={x + 32} y={y + 23} fill="#3a4550" fontSize={8}>PV</text>
      <text x={x + w - 5} y={y + 23} fill={PALE_TEXT} fontSize={8} fontWeight={700} textAnchor="end">{fmt(m.pv, m.decimals)}{m.unit}</text>
      <text x={x + 32} y={y + 33} fill="#3a4550" fontSize={8}>SP</text>
      <text x={x + w - 5} y={y + 33} fill={PALE_TEXT} fontSize={8} fontWeight={700} textAnchor="end">{fmt(m.sp, m.decimals)}</text>
      <text x={x + 32} y={y + 43} fill="#3a4550" fontSize={8}>OUT</text>
      <rect x={x + 58} y={y + 37} width={w - 63} height={6} fill="#d7dde2" stroke="#9aa6af" strokeWidth={0.5} />
      <rect x={x + 58} y={y + 37} width={(w - 63) * outFrac} height={6} fill="#4a9f4a" />
    </g>
  )
}

/** Plain white value box with an explicit instrument tag caption and a value
 * string — used for the many 3T-8120 indicator tags on the WFI graphic. An
 * optional `bindTag` makes it clickable to the matching live faceplate. */
export function ClassicNamedValue({ x, y, tag, value, w = 96, bindTag }: { x: number; y: number; tag: string; value: string; w?: number; bindTag?: string }): JSX.Element {
  const openFaceplate = useUi((s) => s.openFaceplate)
  const click = bindTag ? () => openFaceplate(bindTag) : undefined
  return (
    <g style={{ cursor: bindTag ? 'pointer' : 'default' }} onClick={click}>
      <ClassicLabel x={x + w / 2} y={y - 2} text={tag} />
      <rect x={x} y={y} width={w} height={16} fill="#ffffff" stroke="#6b7680" strokeWidth={1} />
      <text x={x + w / 2} y={y + 11.5} fill={PALE_TEXT} fontSize={9} fontWeight={700} textAnchor="middle">{value}</text>
    </g>
  )
}

/** Bottom-of-screen navigation button (plain bordered label block). */
export function ClassicNavButton({ x, y, w = 92, h = 34, text, onClick }: { x: number; y: number; w?: number; h?: number; text: string; onClick?: () => void }): JSX.Element {
  const lines = text.split('\n')
  return (
    <g style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick} aria-disabled={onClick ? undefined : true}>
      {!onClick && <title>{`${text.replace(/\n/g, ' ')}: reference navigation only; this destination is not modeled`}</title>}
      <rect x={x} y={y} width={w} height={h} fill="#dfe3e6" stroke="#2b3137" strokeWidth={1.3} />
      {lines.map((ln, i) => (
        <text key={i} x={x + w / 2} y={y + h / 2 - (lines.length - 1) * 6 + i * 12 + 4} fill={PALE_TEXT} fontSize={10} fontWeight={800} textAnchor="middle">{ln}</text>
      ))}
    </g>
  )
}
