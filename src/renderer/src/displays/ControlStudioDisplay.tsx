import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { fmt, modeColor } from '../utils/format'
import type { AnyModule, PidModule, MotorModule, ValveModule, DiscreteOutput, DiscreteInput, AnalogIndicator, ControlMode } from '../engine/types'
import type { ReactNode } from 'react'

// Control Studio-style ONLINE function-block diagram for a single module.
// Every CV shown in a port is live-clickable: setpoints, tuning, and discrete
// commands write straight back through the same store actions the faceplates use.

const PID_MODES: ControlMode[] = ['MAN', 'AUTO', 'CAS']

export function ControlStudioDisplay(): JSX.Element {
  const studioTag = useUi((s) => s.studioTag)
  const m = useStore((s) => (studioTag ? s.modules[studioTag] : undefined))
  const openFaceplate = useUi((s) => s.openFaceplate)

  if (!m) {
    return (
      <div className="display studio">
        <div className="exp-empty">Open a module from DeltaV Explorer or a graphic to view it online.</div>
      </div>
    )
  }

  return (
    <div className="display studio">
      <StudioRibbon tag={m.tag} onFaceplate={() => openFaceplate(m.tag)} />
      <div className="studio-main">
        <HierarchyView module={m} />
        <div className="studio-center">
          <div className="studio-canvas">
            <Diagram module={m} />
          </div>
          <ParameterView module={m} />
        </div>
        <PaletteView />
      </div>
    </div>
  )
}

function blocksOf(m: AnyModule): { name: string; type: string }[] {
  if (m.type === 'PID')
    return [
      { name: `${m.tag}/PV`, type: 'AI' },
      { name: m.tag, type: 'PID' },
      { name: `${m.tag}/OUT`, type: 'AO' }
    ]
  if (m.type === 'MOTOR' || m.type === 'VALVE') return [{ name: m.tag, type: 'DC' }]
  return [{ name: m.tag, type: m.type }]
}

function HierarchyView({ module: m }: { module: AnyModule }): JSX.Element {
  return (
    <div className="studio-pane studio-hier">
      <div className="studio-tree">
        <div className="studio-tree-root">
          <span className="exp-ico">▦</span> {m.tag}
        </div>
        {blocksOf(m).map((b) => (
          <div key={b.name} className="studio-tree-node">
            <span className="fb-type">{b.type}</span>
            {b.name}
          </div>
        ))}
      </div>
      <div className="studio-pane-label">Hierarchy View</div>
    </div>
  )
}

interface ParamRow {
  key: string
  value: string
  edit?: { kind: 'num'; step: number; decimals: number; raw: number; onChange: (v: number) => void }
  toggle?: { onClick: () => void; label: string }
}

function ParameterView({ module: m }: { module: AnyModule }): JSX.Element {
  const setSetpoint = useStore((s) => s.setSetpoint)
  const setOutput = useStore((s) => s.setOutput)
  const setTuning = useStore((s) => s.setTuning)
  const startMotor = useStore((s) => s.startMotor)
  const stopMotor = useStore((s) => s.stopMotor)
  const openValve = useStore((s) => s.openValve)
  const closeValve = useStore((s) => s.closeValve)
  const toggleDO = useStore((s) => s.toggleDO)

  const rows: ParamRow[] = []
  if (m.type === 'PID') {
    const spEditable = m.actualMode === 'AUTO'
    const outEditable = m.actualMode === 'MAN' || m.actualMode === 'ROUT'
    rows.push(
      { key: 'MODE.TARGET', value: m.mode },
      { key: 'PV.CV', value: `${fmt(m.pv, m.decimals)} ${m.unit}` },
      {
        key: 'SP.CV',
        value: `${fmt(m.sp, m.decimals)} ${m.unit}`,
        edit: spEditable
          ? { kind: 'num', step: (m.pvMax - m.pvMin) / 100, decimals: m.decimals, raw: m.sp, onChange: (v) => setSetpoint(m.tag, v) }
          : undefined
      },
      {
        key: 'OUT.CV',
        value: `${fmt(m.out, 1)} %`,
        edit: outEditable ? { kind: 'num', step: 1, decimals: 1, raw: m.out, onChange: (v) => setOutput(m.tag, v) } : undefined
      },
      { key: 'GAIN', value: `${m.gain}`, edit: { kind: 'num', step: 0.1, decimals: 2, raw: m.gain, onChange: (v) => setTuning(m.tag, { gain: v }) } },
      { key: 'RESET', value: `${m.reset} s/rpt`, edit: { kind: 'num', step: 1, decimals: 0, raw: m.reset, onChange: (v) => setTuning(m.tag, { reset: v }) } },
      { key: 'RATE', value: `${m.rate} s`, edit: { kind: 'num', step: 0.5, decimals: 1, raw: m.rate, onChange: (v) => setTuning(m.tag, { rate: v }) } }
    )
  } else if (m.type === 'AI') {
    rows.push({ key: 'PV.CV', value: `${fmt(m.pv, m.decimals)} ${m.unit}` }, { key: 'PV_FTIME', value: '2 s' })
  } else if (m.type === 'MOTOR') {
    rows.push(
      { key: 'SP_D.CV', value: m.commanded ? '1 (START)' : '0 (STOP)', toggle: { onClick: () => (m.commanded ? stopMotor(m.tag) : startMotor(m.tag)), label: m.commanded ? 'Stop' : 'Start' } },
      { key: 'PV_D.CV', value: m.running ? '1' : '0' },
      { key: 'INTERLOCK', value: m.interlock ? '1' : '0' }
    )
  } else if (m.type === 'VALVE') {
    rows.push(
      { key: 'SP_D.CV', value: m.commandedOpen ? '1 (OPEN)' : '0 (CLOSE)', toggle: { onClick: () => (m.commandedOpen ? closeValve(m.tag) : openValve(m.tag)), label: m.commandedOpen ? 'Close' : 'Open' } },
      { key: 'PV_D.CV', value: m.open ? '1' : '0' },
      { key: 'INTERLOCK', value: m.interlock ? '1' : '0' }
    )
  } else if (m.type === 'DO') {
    rows.push({ key: 'OUT_D.CV', value: m.commanded ? '1' : '0', toggle: { onClick: () => toggleDO(m.tag), label: 'Toggle' } })
  } else {
    rows.push({ key: 'OUT_D.CV', value: m.state ? '1' : '0' })
  }

  return (
    <div className="studio-pane studio-params">
      <table className="studio-param-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td className="pv">
                {r.edit ? (
                  <ParamStepper step={r.edit.step} decimals={r.edit.decimals} value={r.edit.raw} onChange={r.edit.onChange} />
                ) : r.toggle ? (
                  <button className="studio-param-btn" onClick={r.toggle.onClick}>
                    {r.value} · {r.toggle.label}
                  </button>
                ) : (
                  r.value
                )}
              </td>
              <td className="good">Good</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="studio-pane-label">Parameter View — {m.tag}</div>
    </div>
  )
}

function ParamStepper({
  value,
  step,
  decimals,
  onChange
}: {
  value: number
  step: number
  decimals: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <span className="fb-stepper">
      <button onClick={() => onChange(value - step)}>−</button>
      <input
        className="fb-numinput"
        type="number"
        value={Number(value.toFixed(decimals))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button onClick={() => onChange(value + step)}>+</button>
    </span>
  )
}

const PALETTE = [
  { group: 'I/O', items: ['AI', 'AO', 'DI', 'DO'] },
  { group: 'Control', items: ['PID', 'DC', 'RATIO', 'BG'] },
  { group: 'Logic', items: ['AND', 'OR', 'NOT', 'CND'] },
  { group: 'Math', items: ['ADD', 'MUL', 'CALC', 'INT'] },
  { group: 'SFC', items: ['STEP', 'TRAN', 'TERM'] }
]

function PaletteView(): JSX.Element {
  return (
    <div className="studio-pane studio-palette">
      <div className="studio-palette-body">
        {PALETTE.map((g) => (
          <div key={g.group} className="studio-pal-group">
            <div className="studio-pal-head">{g.group}</div>
            {g.items.map((i) => (
              <div key={i} className="studio-pal-item" draggable title={`${i} function block`}>
                <span className="fb-type">{i}</span>
                <span>{i} block</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="studio-pane-label">Palette · All Function Blocks</div>
    </div>
  )
}

const RIBBON_TABS = ['File', 'Home', 'Diagram', 'View', 'Settings']

function StudioRibbon({ tag, onFaceplate }: { tag: string; onFaceplate: () => void }): JSX.Element {
  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        {RIBBON_TABS.map((t) => (
          <span key={t} className={'ribbon-tab' + (t === 'File' ? ' file' : t === 'View' ? ' active' : '')}>
            {t}
          </span>
        ))}
        <span className="ribbon-title">[REACTOR_CELL/{tag}] — Control Studio · ONLINE</span>
      </div>
      <div className="ribbon-body">
        <RibbonGroup label="Diagram">
          <RibbonBtn ic="▣" label="Show as FBD" active />
          <RibbonBtn ic="⊟" label="Show as SFC" />
          <RibbonBtn ic="✓" label="Verify" />
        </RibbonGroup>
        <RibbonGroup label="Windows">
          <RibbonBtn ic="☰" label="Parameters" active />
          <RibbonBtn ic="🔔" label="Alarm View" />
          <RibbonBtn ic="▭" label="Status Bar" active />
        </RibbonGroup>
        <RibbonGroup label="Zoom">
          <RibbonBtn ic="🔍" label="Zoom In" />
          <RibbonBtn ic="⊖" label="Zoom Out" />
        </RibbonGroup>
        <RibbonGroup label="Module">
          <RibbonBtn ic="▦" label="Faceplate" onClick={onFaceplate} />
          <RibbonBtn ic="●" label="Online" active />
        </RibbonGroup>
      </div>
    </div>
  )
}

function RibbonGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-btns">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  )
}

function RibbonBtn({
  ic,
  label,
  active,
  onClick
}: {
  ic: string
  label: string
  active?: boolean
  onClick?: () => void
}): JSX.Element {
  return (
    <button className={'ribbon-btn' + (active ? ' active' : '')} onClick={onClick}>
      <span className="ic">{ic}</span>
      {label}
    </button>
  )
}

function Diagram({ module: m }: { module: AnyModule }): JSX.Element {
  if (m.type === 'PID') return <PidDiagram m={m} />
  if (m.type === 'AI') return <AiDiagram m={m} />
  if (m.type === 'MOTOR') return <MotorDiagram m={m} />
  if (m.type === 'VALVE') return <ValveDiagram m={m} />
  if (m.type === 'DO') return <DoDiagram m={m} />
  return <DiDiagram m={m} />
}

function AiDiagram({ m }: { m: AnalogIndicator }): JSX.Element {
  return (
    <div className="fb-row">
      <Block type="AI" tag={m.tag} ports={[<Port key="OUT" name="OUT" value={`${fmt(m.pv, m.decimals)} ${m.unit}`} />]} />
    </div>
  )
}

function PidDiagram({ m }: { m: PidModule }): JSX.Element {
  const setMode = useStore((s) => s.setMode)
  const setSetpoint = useStore((s) => s.setSetpoint)
  const setOutput = useStore((s) => s.setOutput)
  const setTuning = useStore((s) => s.setTuning)
  const cascaded = !!m.casSource
  const spEditable = m.actualMode === 'AUTO'
  const outEditable = m.actualMode === 'MAN' || m.actualMode === 'ROUT'
  const span = m.pvMax - m.pvMin || 1

  return (
    <div className="fb-row">
      {cascaded && (
        <>
          <Block type="PID" tag={m.casSource as string} ports={[<Port key="OUT" name="OUT" value="→ remote SP" />]} subdued />
          <Wire label="CAS_IN" />
        </>
      )}
      <Block type="AI" tag={`${m.tag}/PV`} ports={[<Port key="OUT" name="OUT" value={`${fmt(m.pv, m.decimals)} ${m.unit}`} />]} />
      <Wire label="IN" />
      <div className="fb-block pid">
        <div className="fb-head">
          <span className="fb-type">PID</span>
          <b>{m.tag}</b>
          <span className="fb-mode" style={{ color: modeColor(m.mode) }}>
            {m.mode}
          </span>
        </div>
        <div className="fb-ports">
          <Port name="PV" value={`${fmt(m.pv, m.decimals)} ${m.unit}`} />
          <Port
            name="SP"
            value={`${fmt(m.sp, m.decimals)} ${m.unit}`}
            rawValue={m.sp}
            editStep={spEditable ? span / 100 : undefined}
            editDecimals={m.decimals}
            onEdit={spEditable ? (v) => setSetpoint(m.tag, v) : undefined}
          />
          <Port
            name="OUT"
            value={`${fmt(m.out, 1)} %`}
            rawValue={m.out}
            editStep={outEditable ? 1 : undefined}
            editDecimals={1}
            onEdit={outEditable ? (v) => setOutput(m.tag, v) : undefined}
          />
          <Port name="GAIN" value={`${m.gain}`} rawValue={m.gain} editStep={0.1} editDecimals={2} onEdit={(v) => setTuning(m.tag, { gain: v })} />
          <Port name="RESET" value={`${m.reset} s`} rawValue={m.reset} editStep={1} editDecimals={0} onEdit={(v) => setTuning(m.tag, { reset: v })} />
          <Port name="RATE" value={`${m.rate} s`} rawValue={m.rate} editStep={0.5} editDecimals={1} onEdit={(v) => setTuning(m.tag, { rate: v })} />
        </div>
        <div className="fb-modebar">
          {PID_MODES.map((mode) => (
            <button
              key={mode}
              className={'fb-modebtn' + (m.mode === mode ? ' active' : '')}
              disabled={mode === 'CAS' && !m.casSource}
              onClick={() => setMode(m.tag, mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <Wire label="OUT %" />
      <Block type="AO" tag={`${m.tag}/OUT`} ports={[<Port key="OUT" name="OUT" value={`${fmt(m.out, 1)} %`} />]} />
    </div>
  )
}

function MotorDiagram({ m }: { m: MotorModule }): JSX.Element {
  const startMotor = useStore((s) => s.startMotor)
  const stopMotor = useStore((s) => s.stopMotor)
  const toggleInterlock = useStore((s) => s.toggleInterlock)
  const injectFault = useStore((s) => s.injectFault)
  const resetDevice = useStore((s) => s.resetDevice)
  const startDisabled = m.interlock || m.locked || (m.permissiveRequired && !m.permissiveOk && !m.running)

  return (
    <div className="fb-row">
      <div className="fb-block dc">
        <div className="fb-head">
          <span className="fb-type">DC</span>
          <b>{m.tag}</b>
        </div>
        <div className="fb-ports">
          <Port name="PV_D" value={m.running ? 'RUNNING' : 'STOPPED'} />
          <Port
            name="INTERLOCK"
            value={m.interlock ? 'TRIPPED' : 'clear'}
            toggleLabel={m.interlock ? 'Clear' : 'Trip'}
            onToggle={() => toggleInterlock(m.tag)}
          />
          <Port name="FAULT" value={m.fault ? 'YES' : 'no'} toggleLabel={m.fault ? 'Clear' : 'Inject'} onToggle={() => injectFault(m.tag)} />
        </div>
        <div className="fb-dcbar">
          <button className="fb-dcbtn start" disabled={startDisabled} onClick={() => startMotor(m.tag)}>
            START
          </button>
          <button className="fb-dcbtn stop" onClick={() => stopMotor(m.tag)}>
            STOP
          </button>
          {m.locked && (
            <button className="fb-dcbtn reset" onClick={() => resetDevice(m.tag)}>
              RESET
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ValveDiagram({ m }: { m: ValveModule }): JSX.Element {
  const openValve = useStore((s) => s.openValve)
  const closeValve = useStore((s) => s.closeValve)
  const toggleInterlock = useStore((s) => s.toggleInterlock)
  const injectFault = useStore((s) => s.injectFault)
  const resetDevice = useStore((s) => s.resetDevice)
  const openDisabled = m.interlock || m.locked || (m.permissiveRequired && !m.permissiveOk && !m.open)

  return (
    <div className="fb-row">
      <div className="fb-block dc">
        <div className="fb-head">
          <span className="fb-type">DC</span>
          <b>{m.tag}</b>
        </div>
        <div className="fb-ports">
          <Port name="PV_D" value={m.open ? 'OPEN' : 'CLOSED'} />
          <Port
            name="INTERLOCK"
            value={m.interlock ? 'TRIPPED' : 'clear'}
            toggleLabel={m.interlock ? 'Clear' : 'Trip'}
            onToggle={() => toggleInterlock(m.tag)}
          />
          <Port name="FAULT" value={m.fault ? 'YES' : 'no'} toggleLabel={m.fault ? 'Clear' : 'Inject'} onToggle={() => injectFault(m.tag)} />
        </div>
        <div className="fb-dcbar">
          <button className="fb-dcbtn start" disabled={openDisabled} onClick={() => openValve(m.tag)}>
            OPEN
          </button>
          <button className="fb-dcbtn stop" onClick={() => closeValve(m.tag)}>
            CLOSE
          </button>
          {m.locked && (
            <button className="fb-dcbtn reset" onClick={() => resetDevice(m.tag)}>
              RESET
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DoDiagram({ m }: { m: DiscreteOutput }): JSX.Element {
  const toggleDO = useStore((s) => s.toggleDO)
  return (
    <div className="fb-row">
      <Block
        type="DO"
        tag={m.tag}
        ports={[
          <Port
            key="OUT_D"
            name="OUT_D"
            value={m.state ? m.activeDescriptor : m.inactiveDescriptor}
            toggleLabel={m.commanded ? m.inactiveDescriptor : m.activeDescriptor}
            onToggle={() => toggleDO(m.tag)}
          />
        ]}
      />
    </div>
  )
}

function DiDiagram({ m }: { m: DiscreteInput }): JSX.Element {
  return (
    <div className="fb-row">
      <Block type="DI" tag={m.tag} ports={[<Port key="OUT_D" name="OUT_D" value={m.state ? m.activeDescriptor : m.inactiveDescriptor} />]} />
    </div>
  )
}

function Block({
  type,
  tag,
  ports,
  subdued
}: {
  type: string
  tag: string
  ports: ReactNode[]
  subdued?: boolean
}): JSX.Element {
  return (
    <div className={'fb-block' + (subdued ? ' subdued' : '')}>
      <div className="fb-head">
        <span className="fb-type">{type}</span>
        <b>{tag}</b>
      </div>
      <div className="fb-ports">{ports}</div>
    </div>
  )
}

function Port({
  name,
  value,
  rawValue,
  editStep,
  editDecimals,
  onEdit,
  toggleLabel,
  onToggle
}: {
  name: string
  value: string
  /** Numeric value backing an editable port (required together with onEdit). */
  rawValue?: number
  /** When provided with onEdit, renders an inline +/- stepper instead of plain text. */
  editStep?: number
  editDecimals?: number
  onEdit?: (v: number) => void
  /** When provided with onToggle, renders a small command button next to the value. */
  toggleLabel?: string
  onToggle?: () => void
}): JSX.Element {
  if (onEdit && editStep !== undefined && rawValue !== undefined) {
    const raw = rawValue
    return (
      <div className="fb-port editable">
        <span className="fb-port-name">{name}</span>
        <span className="fb-stepper">
          <button onClick={() => onEdit(raw - editStep)}>−</button>
          <input
            className="fb-numinput"
            type="number"
            value={Number(raw.toFixed(editDecimals ?? 1))}
            onChange={(e) => onEdit(Number(e.target.value))}
          />
          <button onClick={() => onEdit(raw + editStep)}>+</button>
        </span>
      </div>
    )
  }
  return (
    <div className="fb-port">
      <span className="fb-port-name">{name}</span>
      <span className="fb-port-val">{value}</span>
      {onToggle && (
        <button className="fb-port-toggle" onClick={onToggle}>
          {toggleLabel}
        </button>
      )}
    </div>
  )
}

function Wire({ label }: { label: string }): JSX.Element {
  return (
    <div className="fb-wire">
      <span className="fb-wire-lbl">{label}</span>
      <span className="fb-wire-arrow">→</span>
    </div>
  )
}
