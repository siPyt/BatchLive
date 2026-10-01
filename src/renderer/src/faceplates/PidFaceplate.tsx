import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import type { PidModule, ControlMode, AlarmPriority } from '../engine/types'
import { fmt } from '../utils/format'

const MODES: ControlMode[] = ['MAN', 'AUTO', 'CAS']
type Tab = 'operate' | 'tune' | 'alarm' | 'trend'

export function PidFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as PidModule | undefined
  const setMode = useStore((s) => s.setMode)
  const setSetpoint = useStore((s) => s.setSetpoint)
  const setOutput = useStore((s) => s.setOutput)
  const setTuning = useStore((s) => s.setTuning)
  const [tab, setTab] = useState<Tab>('operate')

  if (!m) return null
  const span = m.pvMax - m.pvMin || 1
  const pvPct = ((m.pv - m.pvMin) / span) * 100
  const spPct = ((m.sp - m.pvMin) / span) * 100
  const spEditable = m.mode === 'AUTO'
  const outEditable = m.mode === 'MAN' || m.mode === 'ROUT'

  return (
    <div className="fp-body">
      <div className="fp-tabs">
        {(['operate', 'tune', 'alarm', 'trend'] as Tab[]).map((t) => (
          <button key={t} className={'fp-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'operate' ? 'OPER' : t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'operate' && (
        <>
          <div className="fp-readouts">
            <Readout label="PV" cls="fp-pv" value={fmt(m.pv, m.decimals)} unit={m.unit} />
            <Readout label="SP" cls="fp-sp" value={fmt(m.sp, m.decimals)} unit={m.unit} />
            <Readout label="OUT" cls="fp-out" value={fmt(m.out, 1)} unit="%" />
          </div>

          <div className="fp-bars">
            <Bar label="OUT" cls="out" pct={m.out} value={m.out} decimals={1} unit="%" />
            <Bar label="PV" cls="pv" pct={pvPct} value={m.pv} decimals={m.decimals} spPct={spPct} unit={m.unit} />
          </div>

          <div className="fp-moderow">
            <span className="fp-label">Mode</span>
            <span className="fp-modeind">
              Tgt <b>{m.mode}</b> · Act <b>{m.mode}</b>
            </span>
          </div>

          <div className="fp-modes">
            {MODES.map((mode) => (
              <button
                key={mode}
                data-mode={mode}
                className={'fp-mode-btn' + (m.mode === mode ? ' active' : '')}
                disabled={mode === 'CAS' && !m.casSource}
                onClick={() => setMode(tag, mode)}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="fp-row">
            <span className="fp-label">Setpoint</span>
            <Stepper
              value={m.sp}
              decimals={m.decimals}
              step={span / 100}
              disabled={!spEditable}
              onChange={(v) => setSetpoint(tag, v)}
            />
          </div>

          <div className="fp-row">
            <span className="fp-label">Output %</span>
            <Stepper
              value={m.out}
              decimals={1}
              step={1}
              disabled={!outEditable}
              onChange={(v) => setOutput(tag, v)}
            />
          </div>

          {m.casSource && (
            <div className="fp-row">
              <span className="fp-label">Cascade src</span>
              <span style={{ color: 'var(--mode-cas)', fontWeight: 700 }}>{m.casSource}</span>
            </div>
          )}
        </>
      )}

      {tab === 'tune' && (
        <>
          <TuneRow label="Gain (Kp)" value={m.gain} step={0.1} decimals={2} onChange={(v) => setTuning(tag, { gain: v })} />
          <TuneRow label="Reset (s/rpt)" value={m.reset} step={1} decimals={0} onChange={(v) => setTuning(tag, { reset: v })} />
          <TuneRow label="Rate (s)" value={m.rate} step={0.5} decimals={1} onChange={(v) => setTuning(tag, { rate: v })} />
          <div className="fp-row">
            <span className="fp-label">Acting</span>
            <span style={{ color: 'var(--dv-text-dim)' }}>{m.direct ? 'Direct' : 'Reverse'}</span>
          </div>
          <div className="fp-row">
            <span className="fp-label">PV range</span>
            <span style={{ color: 'var(--dv-text-dim)' }}>
              {fmt(m.pvMin, 0)} – {fmt(m.pvMax, 0)} {m.unit}
            </span>
          </div>
        </>
      )}

      {tab === 'alarm' && <AlarmTab m={m} />}
      {tab === 'trend' && <TrendTab tag={tag} />}
    </div>
  )
}

function Readout({ label, cls, value, unit }: { label: string; cls: string; value: string; unit: string }): JSX.Element {
  return (
    <div className="fp-readout">
      <span className="fp-label">{label}</span>
      <span className={'fp-value ' + cls}>
        {value}
        <span className="fp-ro-unit">{unit}</span>
      </span>
    </div>
  )
}

function Bar({
  label,
  cls,
  pct,
  value,
  decimals,
  spPct,
  unit,
  hideFill
}: {
  label: string
  cls: string
  pct: number
  value: number
  decimals: number
  spPct?: number
  unit?: string
  hideFill?: boolean
}): JSX.Element {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="fp-bar">
      <span className="bar-num">{fmt(value, decimals)}</span>
      <div className="track">
        {!hideFill && <div className={'fill ' + cls} style={{ height: clamped + '%' }} />}
        {spPct !== undefined && (
          <div className="sp-marker" style={{ bottom: Math.max(0, Math.min(100, spPct)) + '%' }} />
        )}
      </div>
      <span className="bar-lbl">
        {label}
        {unit ? ' ' + unit : ''}
      </span>
    </div>
  )
}

function Stepper({
  value,
  decimals,
  step,
  disabled,
  onChange
}: {
  value: number
  decimals: number
  step: number
  disabled?: boolean
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="fp-stepper">
      <button disabled={disabled} onClick={() => onChange(value - step)}>
        −
      </button>
      <input
        className="fp-numinput"
        type="number"
        disabled={disabled}
        value={Number(value.toFixed(decimals))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button disabled={disabled} onClick={() => onChange(value + step)}>
        +
      </button>
    </div>
  )
}

function TuneRow({
  label,
  value,
  step,
  decimals,
  onChange
}: {
  label: string
  value: number
  step: number
  decimals: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="fp-row">
      <span className="fp-label">{label}</span>
      <Stepper value={value} decimals={decimals} step={step} onChange={onChange} />
    </div>
  )
}

function AlarmTab({ m }: { m: PidModule }): JSX.Element {
  const setAlarmLimit = useStore((s) => s.setAlarmLimit)
  if (m.alarms.length === 0) return <div className="exp-empty sm">No alarms configured</div>
  return (
    <div className="fp-alarms">
      {m.alarms.map((a) => (
        <div key={a.type} className="fp-alm-row">
          <input
            type="checkbox"
            checked={a.enabled}
            onChange={(e) => setAlarmLimit(m.tag, a.type, { enabled: e.target.checked })}
          />
          <span className="fp-alm-lbl">
            <span className={'prio-chip ' + a.priority.toLowerCase()} />
            {a.label}
          </span>
          <input
            className="fp-numinput sm"
            type="number"
            value={a.limit ?? 0}
            onChange={(e) => setAlarmLimit(m.tag, a.type, { limit: Number(e.target.value) })}
          />
          <select
            className="exp-alm-select"
            value={a.priority}
            onChange={(e) => setAlarmLimit(m.tag, a.type, { priority: e.target.value as AlarmPriority })}
          >
            <option value="CRITICAL">CRIT</option>
            <option value="WARNING">WARN</option>
            <option value="ADVISORY">ADV</option>
          </select>
        </div>
      ))}
    </div>
  )
}

function TrendTab({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as PidModule | undefined
  const [hist, setHist] = useState<{ pv: number; sp: number; out: number }[]>([])

  useEffect(() => {
    const id = setInterval(() => {
      const mod = useStore.getState().modules[tag] as PidModule | undefined
      if (!mod) return
      setHist((h) => [...h.slice(-79), { pv: mod.pv, sp: mod.sp, out: mod.out }])
    }, 400)
    return () => clearInterval(id)
  }, [tag])

  if (!m) return null
  const W = 236
  const H = 120
  const span = m.pvMax - m.pvMin || 1
  const xi = (i: number): number => (i / Math.max(hist.length - 1, 1)) * W
  const yPv = (v: number): number => H - ((v - m.pvMin) / span) * H
  const yOut = (v: number): number => H - (v / 100) * H
  const line = (sel: (p: { pv: number; sp: number; out: number }) => number, y: (v: number) => number): string =>
    hist.map((p, i) => `${xi(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(' ')

  return (
    <div>
      <svg width={W} height={H} className="fp-trend">
        {[0, 25, 50, 75, 100].map((p) => (
          <line
            key={p}
            x1={0}
            x2={W}
            y1={(H * (100 - p)) / 100}
            y2={(H * (100 - p)) / 100}
            stroke="#e4e7ea"
            strokeWidth={1}
          />
        ))}
        <polyline points={line((p) => p.out, yOut)} fill="none" stroke="var(--dv-out)" strokeWidth={1} />
        <polyline
          points={line((p) => p.sp, yPv)}
          fill="none"
          stroke="var(--dv-sp)"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
        <polyline points={line((p) => p.pv, yPv)} fill="none" stroke="var(--dv-pv)" strokeWidth={1.6} />
      </svg>
      <div className="fp-trend-legend">
        <span style={{ color: 'var(--dv-pv)' }}>■ PV</span>
        <span style={{ color: 'var(--dv-sp)' }}>■ SP</span>
        <span style={{ color: 'var(--dv-out)' }}>■ OUT</span>
      </div>
      {hist.length < 2 && <div className="exp-empty sm">Collecting trend…</div>}
    </div>
  )
}
