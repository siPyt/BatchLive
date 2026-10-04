import { pidExecutionBad } from '../engine/pidModes'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm, fmt, isPid } from '../utils/format'
import type { AlarmLimit } from '../engine/types'

interface Props {
  tag: string
  x: number
  y: number
  /** Render as pure SVG <g> primitives (no HTML/foreignObject) so the dynamo
   * lives natively in the same coordinate space as the piping/vessels and
   * scales identically under viewBox pan/zoom — use wherever a ValueBox sits
   * alongside process graphics. */
  svg?: boolean
}

const MODE_FILL: Record<string, string> = {
  AUTO: '#4A6B82',
  CAS: '#2E6B4F',
  RCAS: '#2C5D73',
  MAN: '#C87820',
  ROUT: '#2C5D73'
}

const LIMIT_TICK_COLOR: Record<string, string> = {
  LO_LO: '#990099',
  LO: '#E6C200',
  HI: '#E6C200',
  HI_HI: '#E60000',
  DV_LO: '#990099',
  DV_HI: '#E60000'
}

/** DeltaV-style numeric dynamo bound to a control module. */
export function ValueBox({ tag, x, y, svg }: Props): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const alarms = useStore((s) => s.alarms)
  const openFaceplate = useUi((s) => s.openFaceplate)
  if (!m) return null

  const alm = moduleAlarm(tag, alarms)
  const bad = m.type === 'AO' ? m.bad : m.type === 'PID' ? m.pvBad || pidExecutionBad(m) : m.type === 'AI' && m.pvBad
  const almClass = (bad ? ' vb-bad' : alm ? ' alm-' + alm.priority.toLowerCase() : '')

  let value = 0
  let unit = ''
  let decimals = 1
  let mode: string | null = null
  let discreteText: string | null = null
  let pvMin: number | null = null
  let pvMax: number | null = null
  let sp: number | undefined
  let moduleAlarms: AlarmLimit[] = []

  if (isPid(m) || m.type === 'AO') {
    value = m.pv
    unit = m.unit
    decimals = m.decimals
    mode = m.type === 'AO' ? m.actualMode : m.mode
    pvMin = m.pvMin
    pvMax = m.pvMax
    sp = m.sp
    moduleAlarms = m.alarms
  } else if (m.type === 'AI') {
    value = m.pv
    unit = m.unit
    decimals = m.decimals
    pvMin = m.pvMin
    pvMax = m.pvMax
    moduleAlarms = m.alarms
  } else if (m.type === 'DI' || m.type === 'DO') {
    discreteText = m.state ? m.activeDescriptor : m.inactiveDescriptor
  }

  if (svg) {
    return (
      <SvgDynamo
        tag={tag}
        x={x}
        y={y}
        value={value}
        unit={unit}
        decimals={decimals}
        mode={mode}
        bad={bad}
        discreteText={discreteText}
        pvMin={pvMin}
        pvMax={pvMax}
        sp={sp}
        alarms={moduleAlarms}
        almPriority={alm?.priority}
        onSelect={() => openFaceplate(tag)}
      />
    )
  }

  return (
    <div
      className={'valbox' + almClass}
      style={{ left: x, top: y }}
      onClick={() => openFaceplate(tag)}
      title={m.description}
    >
      {mode && (
        <span className={'vb-mode mode-' + mode}>{mode}</span>
      )}
      <span className="vb-tag">{tag}</span>
      {bad ? (
        <span className="vb-val" style={{ color: 'var(--dv-bad)' }}>
          BAD
        </span>
      ) : discreteText !== null ? (
        <span className="vb-val" style={{ color: alm ? almColor(alm.priority) : 'var(--dv-text-mute)', fontSize: 12 }}>
          {discreteText}
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span className="vb-val" style={alm ? { color: almColor(alm.priority) } : undefined}>
            {fmt(value, decimals)}
          </span>
          <span className="vb-unit">{unit}</span>
          {sp !== undefined && <span className="vb-sp">SP {fmt(sp, decimals)}</span>}
        </span>
      )}
      {pvMin !== null && pvMax !== null && !bad && (
        <RangeBar pvMin={pvMin} pvMax={pvMax} pv={value} sp={sp} alarms={moduleAlarms} />
      )}
    </div>
  )
}

/** Exact DeltaV Live Level 2 compact analog dynamo: 112x46 well, tag header
 * strip, mode pill, right-aligned readout, and a horizontal deviation bar
 * with alarm-limit ticks + SP caret — no sparklines, no squiggly line charts. */
function SvgDynamo({
  tag,
  x,
  y,
  value,
  unit,
  decimals,
  mode,
  bad,
  discreteText,
  pvMin,
  pvMax,
  sp,
  alarms,
  almPriority,
  onSelect
}: {
  tag: string
  x: number
  y: number
  value: number
  unit: string
  decimals: number
  mode: string | null
  bad: boolean
  discreteText: string | null
  pvMin: number | null
  pvMax: number | null
  sp?: number
  alarms: AlarmLimit[]
  almPriority?: string
  onSelect: () => void
}): JSX.Element {
  const W = 112
  const H = 46
  const pvColor = bad ? '#D9383A' : almPriority ? almColor(almPriority) : '#111111'
  const span = pvMin !== null && pvMax !== null ? pvMax - pvMin || 1 : 1
  const pct = (v: number): number => (pvMin === null ? 0 : Math.max(0, Math.min(100, ((v - pvMin) / span) * 100)))
  return (
    <g transform={`translate(${x} ${y})`} style={{ cursor: 'pointer' }} onClick={onSelect}>
      <rect x={0} y={0} width={W} height={H} rx={2} fill="#ffffff" stroke="#a0a0a0" strokeWidth={1} />
      <rect x={0} y={0} width={W} height={15} fill="#d6d6d6" />
      <text x={6} y={11} fontFamily="'Segoe UI', sans-serif" fontSize={9} fontWeight={700} fill="#333333">
        {tag}
      </text>
      {mode && (
        <>
          <rect x={W - 34} y={2} width={30} height={11} rx={1} fill={MODE_FILL[mode] ?? '#666'} />
          <text x={W - 19} y={10} fontFamily="'Segoe UI', sans-serif" fontSize={8} fontWeight={700} fill="#ffffff" textAnchor="middle">
            {mode}
          </text>
        </>
      )}
      {discreteText !== null ? (
        <text x={W / 2} y={30} fontFamily="'Segoe UI', sans-serif" fontSize={12} fontWeight={700} fill={pvColor} textAnchor="middle">
          {discreteText}
        </text>
      ) : bad ? (
        <text x={46} y={30} fontFamily="'Consolas', monospace" fontSize={14} fontWeight={700} fill={pvColor} textAnchor="end">
          ????
        </text>
      ) : (
        <>
          <text x={46} y={30} fontFamily="'Consolas', monospace" fontSize={14} fontWeight={700} fill={pvColor} textAnchor="end">
            {fmt(value, decimals)}
          </text>
          <text x={50} y={29} fontFamily="'Segoe UI', sans-serif" fontSize={9} fontWeight={600} fill="#666666">
            {unit}
          </text>
          {sp !== undefined && (
            <text x={W - 6} y={29} fontFamily="'Segoe UI', sans-serif" fontSize={9} fill="#555555" textAnchor="end">
              SP {fmt(sp, decimals)}
            </text>
          )}
        </>
      )}
      {pvMin !== null && pvMax !== null && !bad && discreteText === null && (
        <g>
          <rect x={6} y={38} width={100} height={3} fill="#dfdfdf" />
          <rect x={6} y={38} width={Math.max(0, Math.min(100, pct(value)))} height={3} fill="#8da1b0" />
          {sp !== undefined && <polygon points={`${6 + pct(sp)},36 ${3 + pct(sp)},33 ${9 + pct(sp)},33`} fill="#222222" />}
          {alarms
            .filter((a) => a.enabled && a.limit !== undefined)
            .map((a) => (
              <line key={a.type} x1={6 + pct(a.limit!)} x2={6 + pct(a.limit!)} y1={36} y2={43} stroke={LIMIT_TICK_COLOR[a.type] ?? '#666'} strokeWidth={1.5} />
            ))}
        </g>
      )}
    </g>
  )
}


/** Engineering-range baseline bar with HI/HI-HI/LO/LO-LO limit ticks and an
 * SP target marker — so operators can see alarm margin at a glance. */
function RangeBar({
  pvMin,
  pvMax,
  pv,
  sp,
  alarms
}: {
  pvMin: number
  pvMax: number
  pv: number
  sp?: number
  alarms: AlarmLimit[]
}): JSX.Element {
  const span = pvMax - pvMin || 1
  const pct = (v: number): number => Math.max(0, Math.min(100, ((v - pvMin) / span) * 100))
  return (
    <svg className="vb-range" viewBox="0 0 100 7" preserveAspectRatio="none">
      <rect x={0} y={2} width={100} height={3} fill="var(--dv-bg-3)" />
      <rect x={0} y={2} width={pct(pv)} height={3} fill="var(--dv-accent)" opacity={0.55} />
      {alarms
        .filter((a) => a.enabled && a.limit !== undefined)
        .map((a) => (
          <line
            key={a.type}
            x1={pct(a.limit!)}
            x2={pct(a.limit!)}
            y1={0}
            y2={7}
            stroke={a.priority === 'CRITICAL' ? 'var(--dv-critical)' : a.priority === 'WARNING' ? 'var(--dv-warning)' : 'var(--dv-advisory)'}
            strokeWidth={1.2}
          />
        ))}
      {sp !== undefined && <polygon points={`${pct(sp) - 2.2},0 ${pct(sp) + 2.2},0 ${pct(sp)},5`} fill="var(--dv-text-dim)" />}
    </svg>
  )
}

function almColor(p: string): string {
  if (p === 'CRITICAL') return '#c0202a'
  if (p === 'WARNING') return '#9a7a10'
  return '#a32bb0'
}
