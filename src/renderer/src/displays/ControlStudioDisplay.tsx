import { useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { fmt } from '../utils/format'
import { FbdCanvas } from '../components/FbdCanvas'
import { ModuleIcon, FunctionBlockIcon, engineeringBlockType } from '../components/EngineeringIcons'
import { FB_NEEDS_IN2 } from '../engine/fb'
import type { AnyModule, FbBlockType, FunctionBlockModule, PidModule, ControlMode, MotorModule, ValveModule } from '../engine/types'
import type { ReactNode } from 'react'

// Control Studio: a real Function Block Diagram node editor (drag, wire,
// delete) backed by the 10 Hz simulation tick in engine/simulate.ts — every
// CV shown is live-clickable, same as the faceplates.

export function ControlStudioDisplay(): JSX.Element {
  const studioTag = useUi((s) => s.studioTag)
  const modules = useStore((s) => s.modules)
  const m = studioTag ? modules[studioTag] : undefined
  const openFaceplate = useUi((s) => s.openFaceplate)
  const select = useUi((s) => s.select)
  const openStudio = useUi((s) => s.openStudio)

  if (!m) {
    return (
      <div className="display studio">
        <div className="exp-empty">Open a module from DeltaV Explorer or a graphic to view it online.</div>
      </div>
    )
  }

  const visibleTags = connectedModuleTags(modules, m.tag)

  return (
    <div className="display studio">
      <StudioRibbon tag={m.tag} onFaceplate={() => openFaceplate(m.tag)} />
      <div className="studio-main">
        <HierarchyView module={m} />
        <div className="studio-center">
          <div className="studio-canvas">
            <FbdCanvas
              areaTags={visibleTags}
              selectedTag={m.tag}
              onSelect={(tag) => {
                select(tag)
                openStudio(tag)
              }}
            />
          </div>
          <ParameterView module={m} />
        </div>
        <PaletteView area={m.area} />
      </div>
    </div>
  )
}

/** Show the active module's complete connected strategy, not just one hop. */
function connectedModuleTags(modules: Record<string, AnyModule>, rootTag: string): string[] {
  const neighbors = new Map<string, Set<string>>()
  const connect = (tag: string, source: string | undefined): void => {
    if (!source || !modules[source]) return
    if (!neighbors.has(tag)) neighbors.set(tag, new Set())
    if (!neighbors.has(source)) neighbors.set(source, new Set())
    neighbors.get(tag)?.add(source)
    neighbors.get(source)?.add(tag)
  }

  for (const module of Object.values(modules)) {
    if (module.type === 'FB') {
      if (module.in1.kind === 'ref') connect(module.tag, module.in1.tag)
      if (module.in2.kind === 'ref') connect(module.tag, module.in2.tag)
    } else if (module.type === 'PID') {
      connect(module.tag, module.casSource)
      connect(module.tag, module.ffSource)
      connect(module.tag, module.trackSource)
      connect(module.tag, module.trackValueSource)
    } else if (module.type === 'MOTOR' || module.type === 'VALVE') {
      connect(module.tag, module.interlockSource)
      connect(module.tag, module.commandSource)
    }
  }

  const connected = new Set([rootTag])
  const pending = [rootTag]
  while (pending.length > 0) {
    const tag = pending.pop()
    if (!tag) continue
    for (const neighbor of neighbors.get(tag) ?? []) {
      if (connected.has(neighbor)) continue
      connected.add(neighbor)
      pending.push(neighbor)
    }
  }
  return [rootTag, ...Array.from(connected).filter((tag) => tag !== rootTag).sort()]
}

/** Lists the real blocks inside this Control Module — matches the canvas
 * exactly (the PDF confirms a PID can reference I/O directly, "not using AI
 * and AO function blocks", which is the configuration this engine models:
 * one consolidated PID node, not a fictional separate AI/AO pair). */
function blocksOf(m: AnyModule): { name: string; type: string }[] {
  return [{ name: m.tag, type: engineeringBlockType(m) }]
}

function HierarchyView({ module: m }: { module: AnyModule }): JSX.Element {
  return (
    <div className="studio-pane studio-hier">
      <div className="studio-tree">
        <div className="studio-tree-root">
          <ModuleIcon kind="control" /> {m.tag}
        </div>
        {blocksOf(m).map((b) => (
          <div key={b.name} className="studio-tree-node">
            <FunctionBlockIcon type={b.type} />
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
  const setCasSource = useStore((s) => s.setCasSource)
  const setFeedforward = useStore((s) => s.setFeedforward)
  const setTracking = useStore((s) => s.setTracking)
  const setInterlockSource = useStore((s) => s.setInterlockSource)
  const setCommandSource = useStore((s) => s.setCommandSource)
  const setMode = useStore((s) => s.setMode)
  const modules = useStore((s) => s.modules)
  const setFbInput = useStore((s) => s.setFbInput)
  const setFbConfig = useStore((s) => s.setFbConfig)

  const rows: ParamRow[] = []
  if (m.type === 'PID') {
    const spEditable = m.actualMode === 'AUTO'
    const outEditable = m.actualMode === 'MAN' || m.actualMode === 'ROUT'
    const modeCycle: ControlMode[] = m.casSource ? ['MAN', 'AUTO', 'CAS'] : ['MAN', 'AUTO']
    const nextMode = modeCycle[(modeCycle.indexOf(m.mode) + 1) % modeCycle.length] ?? 'AUTO'
    rows.push(
      { key: 'MODE.TARGET', value: m.mode, toggle: { onClick: () => setMode(m.tag, nextMode), label: `→ ${nextMode}` } },
      { key: 'MODE.ACTUAL', value: m.actualMode },
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
      { key: 'RATE', value: `${m.rate} s`, edit: { kind: 'num', step: 0.5, decimals: 1, raw: m.rate, onChange: (v) => setTuning(m.tag, { rate: v }) } },
      { key: 'BKCAL_OUT', value: bkcalOutStatus(m, modules) }
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
  } else if (m.type !== 'FB') {
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
          {m.type === 'FB' ? (
            <FbParamRows m={m} tags={Object.keys(modules).filter((t) => t !== m.tag).sort()} setFbInput={setFbInput} setFbConfig={setFbConfig} />
          ) : (
            rows.map((r) => (
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
            ))
          )}
          {m.type === 'PID' && (
            <PidStrategyRows
              m={m}
              tags={Object.keys(modules).filter((t) => t !== m.tag).sort()}
              setCasSource={setCasSource}
              setFeedforward={setFeedforward}
              setTracking={setTracking}
            />
          )}
          {(m.type === 'MOTOR' || m.type === 'VALVE') && (
            <DeviceWiringRows
              m={m}
              tags={Object.keys(modules).filter((t) => t !== m.tag).sort()}
              setInterlockSource={setInterlockSource}
              setCommandSource={setCommandSource}
            />
          )}
        </tbody>
      </table>
      <div className="studio-pane-label">Parameter View — {m.tag}</div>
    </div>
  )
}

/** Property Inspector for Math/Logic/Timer/Analog-Control blocks: IN1/IN2
 * wiring (const or any live module tag) plus whichever registers are
 * meaningful for this specific block type — edits apply to the simulation
 * on the next scan (10 Hz tick), same as every other module here. */
function FbParamRows({
  m,
  tags,
  setFbInput,
  setFbConfig
}: {
  m: FunctionBlockModule
  tags: string[]
  setFbInput: (tag: string, which: 'in1' | 'in2', ref: { kind: 'const' | 'ref'; value: number; tag?: string }) => void
  setFbConfig: (tag: string, patch: Record<string, unknown>) => void
}): JSX.Element {
  const needsIn2 = FB_NEEDS_IN2[m.fbType]
  const field = m.fbType
  const showGain = ['ARITH', 'MLTX', 'BG', 'LE', 'LL', 'LIM', 'MANLD', 'RAMP', 'RTLM', 'RTO', 'SCLR', 'SGCR', 'SGGN'].includes(field)
  const gainLabel = field === 'RTO' ? 'RATIO' : field === 'RAMP' || field === 'RTLM' ? 'RATE (EU/s)' : field === 'LE' || field === 'MANLD' ? 'VALUE' : field === 'MLTX' ? 'ELSE' : 'GAIN'
  const showBias = ['ARITH', 'BG', 'LIM', 'SCLR', 'SPLTR'].includes(field)
  const biasLabel = field === 'LIM' || field === 'SCLR' ? 'LO_LIM' : field === 'SPLTR' ? 'THRESHOLD' : 'BIAS'
  const showGainHi = field === 'LIM' || field === 'SCLR'
  const showCmp = ['ALARM', 'CMP', 'CTLSL', 'INSEL', 'ISELX', 'SGSL'].includes(field)
  const showExpr = field === 'ACT' || field === 'CALC' || field === 'CND'
  const showDelay = ['PIN', 'OND', 'OFFD', 'RET', 'TP', 'DT', 'FLTR', 'LL', 'DTE', 'CND', 'SGGN'].includes(field)
  const delayLabel = field === 'PIN' || field === 'DTE' || field === 'SGGN' ? 'PERIOD (s)' : field === 'FLTR' || field === 'LL' ? 'TIME CONST (s)' : 'TIME_DURATION (s)'
  const showTrip = field === 'CTR' || field === 'BFO' || field === 'FFMDO'
  const tripLabel = field === 'CTR' ? 'PRESET' : 'BIT INDEX'
  const showCountUp = field === 'CTR'

  return (
    <>
      <tr>
        <td>BLOCK</td>
        <td className="pv">{m.fbType}</td>
        <td className="good">Good</td>
      </tr>
      <FbWireRow label="IN1" tags={tags} input={m.in1} onSet={(ref) => setFbInput(m.tag, 'in1', ref)} />
      {needsIn2 && <FbWireRow label="IN2" tags={tags} input={m.in2} onSet={(ref) => setFbInput(m.tag, 'in2', ref)} />}
      {showGain && (
        <tr>
          <td>{gainLabel}</td>
          <td className="pv">
            <ParamStepper step={0.1} decimals={3} value={m.gain} onChange={(v) => setFbConfig(m.tag, { gain: v })} />
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showGainHi && (
        <tr>
          <td>HI_LIM</td>
          <td className="pv">
            <ParamStepper step={0.5} decimals={2} value={m.gain} onChange={(v) => setFbConfig(m.tag, { gain: v })} />
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showBias && (
        <tr>
          <td>{biasLabel}</td>
          <td className="pv">
            <ParamStepper step={0.5} decimals={2} value={m.bias} onChange={(v) => setFbConfig(m.tag, { bias: v })} />
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showCmp && (
        <tr>
          <td>OP</td>
          <td className="pv">
            <select className="fb-select" value={m.cmpOp} onChange={(e) => setFbConfig(m.tag, { cmpOp: e.target.value })}>
              {(['>', '<', '>=', '<=', '=='] as const).map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showExpr && (
        <tr>
          <td>EXPR</td>
          <td className="pv">
            <input className="fb-exprinput" type="text" value={m.expr} onChange={(e) => setFbConfig(m.tag, { expr: e.target.value })} />
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showDelay && (
        <tr>
          <td>{delayLabel}</td>
          <td className="pv">
            <ParamStepper step={1} decimals={1} value={m.delaySec} onChange={(v) => setFbConfig(m.tag, { delaySec: Math.max(0, v) })} />
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showTrip && (
        <tr>
          <td>{tripLabel}</td>
          <td className="pv">
            <ParamStepper step={1} decimals={0} value={m.tripValue} onChange={(v) => setFbConfig(m.tag, { tripValue: v })} />
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      {showCountUp && (
        <tr>
          <td>COUNTER_TYPE</td>
          <td className="pv">
            <button className="studio-param-btn" onClick={() => setFbConfig(m.tag, { countUp: !m.countUp })}>
              {m.countUp ? 'Up' : 'Down'}
            </button>
          </td>
          <td className="good">Good</td>
        </tr>
      )}
      <tr>
        <td>OUT</td>
        <td className="pv">{fmt(m.out, 3)}</td>
        <td className="good">Good</td>
      </tr>
    </>
  )
}

/** One IN1/IN2 register row: a dropdown chooses Const (editable number) vs.
 * any live module tag on the plant (resolved fresh every scan). */
function FbWireRow({
  label,
  tags,
  input,
  onSet
}: {
  label: string
  tags: string[]
  input: { kind: 'const' | 'ref'; value: number; tag?: string }
  onSet: (ref: { kind: 'const' | 'ref'; value: number; tag?: string }) => void
}): JSX.Element {
  return (
    <tr>
      <td>{label}</td>
      <td className="pv">
        <span className="fb-wirerow">
          <select
            className="fb-select"
            value={input.kind === 'const' ? 'CONST' : input.tag ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'CONST') onSet({ kind: 'const', value: input.value })
              else onSet({ kind: 'ref', value: 0, tag: v })
            }}
          >
            <option value="CONST">Const</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {input.kind === 'const' && (
            <ParamStepper step={1} decimals={2} value={input.value} onChange={(v) => onSet({ kind: 'const', value: v })} />
          )}
        </span>
      </td>
      <td className="good">Good</td>
    </tr>
  )
}

/** The glue that makes an interlock strategy actually DO something: wire any
 * logic/alarm tag's live boolean output to INTERLOCK_SOURCE or COMMAND_SOURCE
 * on a MOTOR/VALVE, so an OR/latch/comparator block can automatically trip,
 * close, or open real equipment every scan \u2014 not just display a number. */
function DeviceWiringRows({
  m,
  tags,
  setInterlockSource,
  setCommandSource
}: {
  m: MotorModule | ValveModule
  tags: string[]
  setInterlockSource: (tag: string, source: string | undefined) => void
  setCommandSource: (tag: string, source: string | undefined) => void
}): JSX.Element {
  return (
    <>
      <tr>
        <td>INTERLOCK_SOURCE</td>
        <td className="pv">
          <select className="fb-select" value={m.interlockSource ?? ''} onChange={(e) => setInterlockSource(m.tag, e.target.value || undefined)}>
            <option value="">(manual only)</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className="good">Good</td>
      </tr>
      <tr>
        <td>COMMAND_SOURCE</td>
        <td className="pv">
          <select className="fb-select" value={m.commandSource ?? ''} onChange={(e) => setCommandSource(m.tag, e.target.value || undefined)}>
            <option value="">(manual only)</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className="good">Good</td>
      </tr>
    </>
  )
}

/** Cascade (CAS_SOURCE), feedforward (FF_ENABLE/FF_GAIN/FF_VAL), and tracking
 * (TRK_IN_D/TRK_VAL) registers — generic for ANY PID, not a one-off hardcoded
 * pair, so wiring a Control Selector or another loop's OUT into CAS_SOURCE
 * here is how override and cascade control strategies get built. */
function PidStrategyRows({
  m,
  tags,
  setCasSource,
  setFeedforward,
  setTracking
}: {
  m: PidModule
  tags: string[]
  setCasSource: (tag: string, source: string | undefined) => void
  setFeedforward: (tag: string, patch: { enable?: boolean; gain?: number; source?: string }) => void
  setTracking: (tag: string, patch: { enable?: boolean; source?: string; valueSource?: string; value?: number }) => void
}): JSX.Element {
  return (
    <>
      <tr>
        <td>CAS_SOURCE</td>
        <td className="pv">
          <select className="fb-select" value={m.casSource ?? ''} onChange={(e) => setCasSource(m.tag, e.target.value || undefined)}>
            <option value="">(none)</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className="good">Good</td>
      </tr>
      <tr>
        <td>FF_ENABLE</td>
        <td className="pv">
          <button className="studio-param-btn" onClick={() => setFeedforward(m.tag, { enable: !m.ffEnable })}>
            {m.ffEnable ? 'On' : 'Off'}
          </button>
        </td>
        <td className="good">Good</td>
      </tr>
      {m.ffEnable && (
        <>
          <tr>
            <td>FF_VAL source</td>
            <td className="pv">
              <select className="fb-select" value={m.ffSource ?? ''} onChange={(e) => setFeedforward(m.tag, { source: e.target.value || undefined })}>
                <option value="">(none)</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </td>
            <td className="good">Good</td>
          </tr>
          <tr>
            <td>FF_GAIN</td>
            <td className="pv">
              <ParamStepper step={0.1} decimals={2} value={m.ffGain} onChange={(v) => setFeedforward(m.tag, { gain: v })} />
            </td>
            <td className="good">Good</td>
          </tr>
        </>
      )}
      <tr>
        <td>TRK_IN_D</td>
        <td className="pv">
          <button className="studio-param-btn" onClick={() => setTracking(m.tag, { enable: !m.trackEnable })}>
            {m.trackEnable ? 'On' : 'Off'}
          </button>
        </td>
        <td className="good">Good</td>
      </tr>
      {m.trackEnable && (
        <>
          <tr>
            <td>TRK trigger</td>
            <td className="pv">
              <select className="fb-select" value={m.trackSource ?? ''} onChange={(e) => setTracking(m.tag, { source: e.target.value || undefined })}>
                <option value="">(none)</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </td>
            <td className="good">Good</td>
          </tr>
          <tr>
            <td>TRK_VAL source</td>
            <td className="pv">
              <select className="fb-select" value={m.trackValueSource ?? ''} onChange={(e) => setTracking(m.tag, { valueSource: e.target.value || undefined })}>
                <option value="">(const)</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </td>
            <td className="good">Good</td>
          </tr>
          {!m.trackValueSource && (
            <tr>
              <td>TRK_VAL</td>
              <td className="pv">
                <ParamStepper step={1} decimals={1} value={m.trackValue} onChange={(v) => setTracking(m.tag, { value: v })} />
              </td>
              <td className="good">Good</td>
            </tr>
          )}
        </>
      )}
    </>
  )
}


/** Human-readable BKCAL_OUT status for this PID as seen from its downstream
 * cascade child (if any) — mirrors the real Not Invited / Limited / Good
 * status words the PDF's BKCAL topic describes. */
function bkcalOutStatus(m: PidModule, modules: Record<string, AnyModule>): string {
  const child = Object.values(modules).find((mm): mm is PidModule => mm.type === 'PID' && mm.casSource === m.tag)
  if (!child) return '(no downstream)'
  if (child.actualMode !== 'CAS' && child.actualMode !== 'RCAS') return `Not Invited (${child.tag})`
  if (child.out <= 0.001 || child.out >= 99.999) return `Good:Limited (${child.tag} saturated)`
  return `Good (${child.tag})`
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

interface PaletteItem {
  label: string
  create: { type: 'PID' | 'AI' | 'DI' | 'DO' } | { type: 'FB'; fbType: FbBlockType }
}

/** The full DeltaV Function Block Reference (D800018X012) palette, grouped
 * by its own five standard categories — every item is a real, simulated,
 * creatable module (Energy Metering and Advanced Control blocks such as
 * MPC/Fuzzy Logic/steam-property blocks are out of scope: multi-array,
 * thermodynamic-table, or trained-model algorithms that don't fit this
 * engine's single in1/in2 block model). */
const PALETTE: { group: string; items: PaletteItem[] }[] = [
  {
    group: 'I/O Blocks',
    items: [
      { label: 'AI', create: { type: 'AI' } },
      { label: 'DI', create: { type: 'DI' } },
      { label: 'DO', create: { type: 'DO' } },
      { label: 'ALARM', create: { type: 'FB', fbType: 'ALARM' } },
      { label: 'MAI', create: { type: 'FB', fbType: 'MAI' } },
      { label: 'FFMDI', create: { type: 'FB', fbType: 'FFMDI' } },
      { label: 'FFMDO', create: { type: 'FB', fbType: 'FFMDO' } },
      { label: 'PIN', create: { type: 'FB', fbType: 'PIN' } }
    ]
  },
  {
    group: 'Math Blocks',
    items: [
      { label: 'ABS', create: { type: 'FB', fbType: 'ABS' } },
      { label: 'ADD', create: { type: 'FB', fbType: 'ADD' } },
      { label: 'ARITH', create: { type: 'FB', fbType: 'ARITH' } },
      { label: 'CMP', create: { type: 'FB', fbType: 'CMP' } },
      { label: 'DIV', create: { type: 'FB', fbType: 'DIV' } },
      { label: 'INT', create: { type: 'FB', fbType: 'INT' } },
      { label: 'MLTY', create: { type: 'FB', fbType: 'MLTY' } },
      { label: 'SUB', create: { type: 'FB', fbType: 'SUB' } }
    ]
  },
  {
    group: 'Timer/Counter Blocks',
    items: [
      { label: 'CTR', create: { type: 'FB', fbType: 'CTR' } },
      { label: 'DTE', create: { type: 'FB', fbType: 'DTE' } },
      { label: 'OND', create: { type: 'FB', fbType: 'OND' } },
      { label: 'OFFD', create: { type: 'FB', fbType: 'OFFD' } },
      { label: 'RET', create: { type: 'FB', fbType: 'RET' } },
      { label: 'TP', create: { type: 'FB', fbType: 'TP' } }
    ]
  },
  {
    group: 'Logical Blocks',
    items: [
      { label: 'ACT', create: { type: 'FB', fbType: 'ACT' } },
      { label: 'AND', create: { type: 'FB', fbType: 'AND' } },
      { label: 'BDE', create: { type: 'FB', fbType: 'BDE' } },
      { label: 'BFI', create: { type: 'FB', fbType: 'BFI' } },
      { label: 'BFO', create: { type: 'FB', fbType: 'BFO' } },
      { label: 'CND', create: { type: 'FB', fbType: 'CND' } },
      { label: 'MLTX', create: { type: 'FB', fbType: 'MLTX' } },
      { label: 'NDE', create: { type: 'FB', fbType: 'NDE' } },
      { label: 'NOT', create: { type: 'FB', fbType: 'NOT' } },
      { label: 'OR', create: { type: 'FB', fbType: 'OR' } },
      { label: 'PDE', create: { type: 'FB', fbType: 'PDE' } },
      { label: 'RS', create: { type: 'FB', fbType: 'RS' } },
      { label: 'SR', create: { type: 'FB', fbType: 'SR' } }
    ]
  },
  {
    group: 'Analog Control Blocks',
    items: [
      { label: 'PID', create: { type: 'PID' } },
      { label: 'BG', create: { type: 'FB', fbType: 'BG' } },
      { label: 'CALC', create: { type: 'FB', fbType: 'CALC' } },
      { label: 'CTLSL', create: { type: 'FB', fbType: 'CTLSL' } },
      { label: 'DT', create: { type: 'FB', fbType: 'DT' } },
      { label: 'FLTR', create: { type: 'FB', fbType: 'FLTR' } },
      { label: 'INSEL', create: { type: 'FB', fbType: 'INSEL' } },
      { label: 'ISELX', create: { type: 'FB', fbType: 'ISELX' } },
      { label: 'LE', create: { type: 'FB', fbType: 'LE' } },
      { label: 'LL', create: { type: 'FB', fbType: 'LL' } },
      { label: 'LIM', create: { type: 'FB', fbType: 'LIM' } },
      { label: 'MANLD', create: { type: 'FB', fbType: 'MANLD' } },
      { label: 'RAMP', create: { type: 'FB', fbType: 'RAMP' } },
      { label: 'RTLM', create: { type: 'FB', fbType: 'RTLM' } },
      { label: 'RTO', create: { type: 'FB', fbType: 'RTO' } },
      { label: 'SCLR', create: { type: 'FB', fbType: 'SCLR' } },
      { label: 'SGCR', create: { type: 'FB', fbType: 'SGCR' } },
      { label: 'SGGN', create: { type: 'FB', fbType: 'SGGN' } },
      { label: 'SGSL', create: { type: 'FB', fbType: 'SGSL' } },
      { label: 'SPLTR', create: { type: 'FB', fbType: 'SPLTR' } }
    ]
  }
]

function PaletteView({ area }: { area: string }): JSX.Element {
  const createModule = useStore((s) => s.createModule)
  const modules = useStore((s) => s.modules)
  const openStudio = useUi((s) => s.openStudio)
  const [pending, setPending] = useState<PaletteItem | null>(null)
  const [tag, setTag] = useState('')
  const normTag = tag.trim().toUpperCase()
  const exists = normTag.length > 0 && !!modules[normTag]

  const submit = (): void => {
    if (!pending || !normTag || exists) return
    createModule(
      pending.create.type === 'FB'
        ? { tag: normTag, type: 'FB', fbType: pending.create.fbType, description: `${pending.label} block`, area }
        : { tag: normTag, type: pending.create.type, description: `${pending.label} block`, area }
    )
    openStudio(normTag)
    setPending(null)
    setTag('')
  }

  return (
    <div className="studio-pane studio-palette">
      <div className="studio-palette-body">
        {PALETTE.map((g) => (
          <div key={g.group} className="studio-pal-group">
            <div className="studio-pal-head">{g.group}</div>
            {g.items.map((it) => (
              <div
                key={it.label}
                className="studio-pal-item"
                title={`Create a new ${it.label} block`}
                onClick={() => {
                  setPending(it)
                  setTag('')
                }}
              >
                <FunctionBlockIcon type={it.label} />
                <span>{it.label} block</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {pending && (
        <div className="studio-pal-create">
          <div className="studio-pal-create-title">New {pending.label} block</div>
          <input
            className="studio-pal-tag"
            placeholder="Tag, e.g. CALC-101"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
          />
          {exists && <div className="studio-pal-err">Tag already exists</div>}
          <div className="studio-pal-create-btns">
            <button className="tbtn sm" disabled={!normTag || exists} onClick={submit}>
              Create
            </button>
            <button className="tbtn sm" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="studio-pane-label">Palette · click a block to create &amp; wire it</div>
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
