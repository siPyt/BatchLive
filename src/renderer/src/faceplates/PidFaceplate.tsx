import { useState } from 'react'
import { useStore } from '../engine/store'
import type { PidModule, ControlMode } from '../engine/types'
import { fmt } from '../utils/format'

const MODES: ControlMode[] = ['MAN', 'AUTO', 'CAS']

export function PidFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as PidModule | undefined
  const setMode = useStore((s) => s.setMode)
  const setSetpoint = useStore((s) => s.setSetpoint)
  const setOutput = useStore((s) => s.setOutput)
  const setTuning = useStore((s) => s.setTuning)
  const [tab, setTab] = useState<'operate' | 'tune'>('operate')

  if (!m) return null
  const span = m.pvMax - m.pvMin || 1
  const pvPct = ((m.pv - m.pvMin) / span) * 100
  const spPct = ((m.sp - m.pvMin) / span) * 100
  const spEditable = m.mode === 'AUTO'
  const outEditable = m.mode === 'MAN' || m.mode === 'ROUT'

  return (
    <div className="fp-body">
      <div className="fp-tabs">
        <button className={'fp-tab' + (tab === 'operate' ? ' active' : '')} onClick={() => setTab('operate')}>
          OPERATE
        </button>
        <button className={'fp-tab' + (tab === 'tune' ? ' active' : '')} onClick={() => setTab('tune')}>
          TUNE
        </button>
      </div>

      {tab === 'operate' ? (
        <>
          <div className="fp-bars">
            <Bar label="PV" cls="pv" pct={pvPct} value={m.pv} decimals={m.decimals} spPct={spPct} />
            <Bar label="SP" cls="pv" pct={spPct} value={m.sp} decimals={m.decimals} hideFill />
            <Bar label="OUT" cls="out" pct={m.out} value={m.out} decimals={1} unit="%" />
          </div>

          <div className="fp-row">
            <span className="fp-label">Units</span>
            <span style={{ color: 'var(--dv-text-dim)' }}>{m.unit}</span>
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
      ) : (
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
