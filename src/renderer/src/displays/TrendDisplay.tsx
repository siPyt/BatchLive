import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import type { TrendPoint } from '../engine/types'

interface Pen {
  key: string
  label: string
  color: string
  min: number
  max: number
  unit: string
}

const PENS: Pen[] = [
  { key: 'FIC-101.PV', label: 'FIC-101 Feed Flow', color: '#4fd1a0', min: 0, max: 120, unit: 'm3/h' },
  { key: 'LIC-101.PV', label: 'LIC-101 Feed Level', color: '#6ec1ff', min: 0, max: 100, unit: '%' },
  { key: 'LIC-201.PV', label: 'LIC-201 Reactor Level', color: '#c792ea', min: 0, max: 100, unit: '%' },
  { key: 'TIC-201.PV', label: 'TIC-201 Reactor Temp', color: '#ff9e64', min: 0, max: 200, unit: 'degC' },
  { key: 'PIC-301.PV', label: 'PIC-301 Header Press', color: '#f7768e', min: 0, max: 500, unit: 'kPa' },
  { key: 'AT-301.PV', label: 'AT-301 Concentration', color: '#e0d040', min: 0, max: 100, unit: '%' }
]

/** Tags with a configured historian pen — faceplates only show a Trend link for these. */
export const PEN_TAGS = new Set(PENS.map((p) => p.key.split('.')[0]))

const W = 1000
const H = 460
const PAD_L = 46
const PAD_R = 16
const PAD_T = 16
const PAD_B = 28

export function TrendDisplay(): JSX.Element {
  const trend = useStore((s) => s.trend)
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(PENS.map((p) => [p.key, true]))
  )
  const [windowSec, setWindowSec] = useState(300)

  const trendFocusTag = useUi((s) => s.trendFocusTag)
  const clearTrendFocus = useUi((s) => s.clearTrendFocus)
  useEffect(() => {
    if (!trendFocusTag) return
    const key = `${trendFocusTag}.PV`
    if (PENS.some((p) => p.key === key)) {
      setEnabled(Object.fromEntries(PENS.map((p) => [p.key, p.key === key])))
    }
    clearTrendFocus()
  }, [trendFocusTag, clearTrendFocus])

  const now = trend.length ? trend[trend.length - 1].t : Date.now()
  const from = now - windowSec * 1000
  const visible = trend.filter((p) => p.t >= from)

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const xFor = (t: number): number => PAD_L + ((t - from) / (windowSec * 1000)) * plotW
  const yFor = (v: number, pen: Pen): number => {
    const frac = (v - pen.min) / (pen.max - pen.min || 1)
    return PAD_T + (1 - Math.max(0, Math.min(1, frac))) * plotH
  }

  return (
    <div className="trend-wrap">
      <div className="toolbar-row">
        <span className="title">Historian Trend</span>
        <span style={{ color: 'var(--dv-text-dim)', fontSize: 12 }}>Window</span>
        <select className="select-dark" value={windowSec} onChange={(e) => setWindowSec(Number(e.target.value))}>
          <option value={60}>1 min</option>
          <option value={300}>5 min</option>
          <option value={600}>10 min</option>
        </select>
      </div>

      <div className="trend-legend">
        {PENS.map((p) => (
          <div
            key={p.key}
            className={'legend-item' + (enabled[p.key] ? '' : ' off')}
            onClick={() => setEnabled((e) => ({ ...e, [p.key]: !e[p.key] }))}
          >
            <span className="legend-swatch" style={{ background: p.color }} />
            {p.label} <span style={{ color: 'var(--dv-text-mute)' }}>({p.unit})</span>
            <LastValue trend={visible} penKey={p.key} color={p.color} />
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        <svg width={W} height={H} style={{ background: '#ffffff', border: '1px solid var(--dv-border)', borderRadius: 4 }}>
          {/* horizontal gridlines (percent of each pen scale) */}
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = PAD_T + (1 - pct / 100) * plotH
            return (
              <g key={pct}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e4e7ea" strokeWidth={1} />
                <text x={PAD_L - 6} y={y + 3} fill="#6b747d" fontSize={9} textAnchor="end">
                  {pct}%
                </text>
              </g>
            )
          })}
          {/* time gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const x = PAD_L + f * plotW
            const secsAgo = Math.round(windowSec * (1 - f))
            return (
              <g key={f}>
                <line x1={x} x2={x} y1={PAD_T} y2={H - PAD_B} stroke="#e4e7ea" strokeWidth={1} />
                <text x={x} y={H - PAD_B + 16} fill="#6b747d" fontSize={9} textAnchor="middle">
                  -{secsAgo}s
                </text>
              </g>
            )
          })}

          {PENS.filter((p) => enabled[p.key]).map((p) => {
            const pts = visible
              .map((pt) => {
                const v = pt.values[p.key]
                if (v === undefined) return null
                return `${xFor(pt.t).toFixed(1)},${yFor(v, p).toFixed(1)}`
              })
              .filter(Boolean)
              .join(' ')
            return <polyline key={p.key} points={pts} fill="none" stroke={p.color} strokeWidth={1.6} />
          })}

          {visible.length === 0 && (
            <text x={W / 2} y={H / 2} fill="#6b747d" fontSize={13} textAnchor="middle">
              Collecting trend data…
            </text>
          )}
        </svg>
      </div>
    </div>
  )
}

function LastValue({ trend, penKey, color }: { trend: TrendPoint[]; penKey: string; color: string }): JSX.Element | null {
  const last = trend[trend.length - 1]
  if (!last || last.values[penKey] === undefined) return null
  return (
    <b style={{ color, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{last.values[penKey].toFixed(1)}</b>
  )
}
