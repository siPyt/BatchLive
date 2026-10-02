import { useStore } from '../engine/store'
import type { AnalogIndicator } from '../engine/types'
import { fmt, fmtQ, moduleAlarm } from '../utils/format'

export function AiFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as AnalogIndicator | undefined
  const alarms = useStore((s) => s.alarms)
  if (!m) return null

  const span = m.pvMax - m.pvMin || 1
  const pvPct = Math.max(0, Math.min(100, ((m.pv - m.pvMin) / span) * 100))
  const alm = moduleAlarm(tag, alarms)

  return (
    <div className="fp-body">
      <div className="fp-bars">
        <div className="fp-bar">
          <span className="bar-num" style={{ color: m.pvBad ? 'var(--dv-bad)' : alm ? 'var(--dv-critical)' : undefined }}>
            {fmtQ(m.pv, m.decimals, m.pvBad)}
          </span>
          <div className="track">
            <div className="fill pv" style={{ height: pvPct + '%' }} />
          </div>
          <span className="bar-lbl">PV {m.unit}</span>
        </div>
      </div>

      <div className="fp-row">
        <span className="fp-label">Value</span>
        <span className="fp-value fp-pv" style={m.pvBad ? { color: 'var(--dv-bad)' } : undefined}>
          {fmtQ(m.pv, m.decimals, m.pvBad)} {m.unit}
        </span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Range</span>
        <span style={{ color: 'var(--dv-text-dim)' }}>
          {fmt(m.pvMin, 0)} – {fmt(m.pvMax, 0)} {m.unit}
        </span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Status</span>
        <span style={{ color: m.pvBad ? 'var(--dv-bad)' : alm ? 'var(--dv-critical)' : 'var(--dv-ok)', fontWeight: 700 }}>
          {m.pvBad ? 'BAD (I/O)' : alm ? alm.label + ' ALARM' : 'NORMAL'}
        </span>
      </div>

      <div style={{ borderTop: '1px solid var(--dv-border)', paddingTop: 6 }}>
        <span className="fp-label">Alarm limits</span>
        {m.alarms.map((a) => (
          <div className="fp-row" key={a.type} style={{ marginTop: 3 }}>
            <span style={{ color: 'var(--dv-text-dim)' }}>{a.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {a.limit !== undefined ? fmt(a.limit, m.decimals) : '—'} {m.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
