import { useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { fmt } from '../utils/format'
import { FbdCanvas } from '../components/FbdCanvas'
import { ModuleIcon, FunctionBlockIcon } from '../components/EngineeringIcons'
import { FB_NEEDS_IN2 } from '../engine/fb'
import { moduleNameError } from '../engine/naming'
import { appliedPidOutput, pidIo, readAnalogSignal, signalError } from '../engine/analogStrategy'
import { connectedModuleTags, moduleBlocks } from '../engine/controlDiagram'
import type {
  AnalogSignalRef, AnyModule, FbBlockType, FunctionBlockModule, PidModule,
  PidBlockName, PidIoPatch, SplitterPatch, SplitterState, FbInputRef,
  ControlMode, MotorModule, ValveModule
} from '../engine/types'
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
  const [zoom, setZoom] = useState(1)
  const [showHierarchy, setShowHierarchy] = useState(true)
  const [showParameters, setShowParameters] = useState(true)
  const [showPalette, setShowPalette] = useState(true)
  const [blockSelection, setBlockSelection] = useState<{ tag: string; block: PidBlockName } | null>(null)

  if (!m) {
    return (
      <div className="display studio">
        <div className="exp-empty">Open a module from DeltaV Explorer or a graphic to view it online.</div>
      </div>
    )
  }

  const visibleTags = connectedModuleTags(modules, m.tag)
  const selectedBlock = blockSelection?.tag === m.tag ? blockSelection.block : 'PID1'

  return (
    <div className="display studio">
      <StudioRibbon
        tag={m.tag}
        onFaceplate={() => openFaceplate(m.tag)}
        zoom={zoom}
        onZoom={(value) => setZoom(Math.max(0.5, Math.min(1.5, Math.round(value * 10) / 10)))}
        panes={{ hierarchy: showHierarchy, parameters: showParameters, palette: showPalette }}
        onToggle={(pane) => {
          if (pane === 'hierarchy') setShowHierarchy((value) => !value)
          else if (pane === 'parameters') setShowParameters((value) => !value)
          else setShowPalette((value) => !value)
        }}
      />
      <div className="studio-main">
        {showHierarchy && <HierarchyView module={m} selectedBlock={selectedBlock}
          onSelect={(block) => setBlockSelection({ tag: m.tag, block })} />}
        <div className="studio-center">
          <div className="studio-canvas">
            <FbdCanvas
              areaTags={visibleTags}
              selectedTag={m.tag}
              selectedBlock={selectedBlock}
              zoom={zoom}
              onSelect={(tag, block) => {
                select(tag)
                openStudio(tag)
                setBlockSelection({ tag, block: block ?? 'PID1' })
              }}
            />
          </div>
          {showParameters && <ParameterView module={m} selectedBlock={selectedBlock} />}
        </div>
        {showPalette && <PaletteView area={m.area} />}
      </div>
    </div>
  )
}

function HierarchyView({ module: m, selectedBlock, onSelect }: {
  module: AnyModule; selectedBlock: PidBlockName; onSelect: (block: PidBlockName) => void
}): JSX.Element {
  return (
    <div className="studio-pane studio-hier">
      <div className="studio-tree">
        <div className="studio-tree-root">
          <ModuleIcon kind="control" /> {m.tag}
        </div>
        {moduleBlocks(m).map((b) => (
          <button key={b.id} type="button"
            className={'studio-tree-node studio-block-select' + (b.part === selectedBlock ? ' active' : '')}
            aria-label={`Select ${b.name}`} aria-pressed={b.part ? b.part === selectedBlock : undefined}
            onClick={() => onSelect(b.part ?? 'PID1')}>
            <FunctionBlockIcon type={b.type} />
            {b.name}
          </button>
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

function ParameterView({ module: m, selectedBlock }: {
  module: AnyModule; selectedBlock: PidBlockName
}): JSX.Element {
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
  const setPidIo = useStore((s) => s.setPidIo)
  const setSplitterConfig = useStore((s) => s.setSplitterConfig)
  const selectedSplitter = m.type === 'PID' ? pidIo(m).splitter : undefined
  const ioBlock = m.type === 'PID' && selectedBlock !== 'PID1'
  const bad = m.type === 'PID' ? m.pvBad : m.type === 'AI' ? m.pvBad : false

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
          {m.type === 'PID' && selectedBlock === 'SPLTR1' && selectedSplitter ? (
            <SplitterParamRows state={selectedSplitter}
              onChange={(patch) => setPidIo(m.tag, { splitter: patch })} />
          ) : m.type === 'PID' && ioBlock ? (
            <AnalogIoParamRows m={m} block={selectedBlock} modules={modules} setPidIo={setPidIo} />
          ) : m.type === 'FB' && m.fbType === 'SPLTR' && m.splitter ? (
            <>
              <FbWireRow label="CAS_IN" tags={Object.keys(modules).filter(t => t !== m.tag)}
                input={m.in1} onSet={(ref) => setFbInput(m.tag, 'in1', ref)} bad={m.bad} />
              <SplitterParamRows state={m.splitter} onChange={(patch) => setSplitterConfig(m.tag, patch)} />
              {([1, 2] as const).map(branch => <tr key={branch}><td>BKCAL_IN_{branch}.SOURCE</td><td>
                <AnalogSourceSelect module={m} modules={modules}
                  feedbackOnly
                  source={branch === 1 ? m.bkcal1Source : m.bkcal2Source}
                  defaultLabel="(not connected)" onChange={(source) => setSplitterConfig(m.tag,
                    branch === 1 ? { feedback1Source: source } : { feedback2Source: source })} />
              </td><td>{(branch === 1 ? m.bkcal1Source : m.bkcal2Source) ? 'Configured' : 'Not connected'}</td></tr>)}
            </>
          ) : m.type === 'FB' ? (
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
                <td className={bad ? 'bad' : 'good'}>{bad ? 'Bad' : 'Good'}</td>
              </tr>
            ))
          )}
          {m.type === 'PID' && !ioBlock && (
            <PidIoWiringRows m={m} modules={modules} setPidIo={setPidIo} />
          )}
          {m.type === 'PID' && !ioBlock && (
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
      <div className="studio-pane-label">Parameter View — {m.tag}{m.type === 'PID' ? `/${selectedBlock}` : ''}</div>
    </div>
  )
}

/** Property Inspector for Math/Logic/Timer/Analog-Control blocks: IN1/IN2
 * wiring (const or any live module tag) plus whichever registers are
 * meaningful for this specific block type — edits apply to the simulation
 * on the next scan (10 Hz tick), same as every other module here. */
function AnalogSourceSelect({ module, modules, source, defaultLabel, onChange, feedbackOnly = false }: {
  module: AnyModule
  modules: Record<string, AnyModule>
  source?: AnalogSignalRef
  defaultLabel: string
  onChange: (source: AnalogSignalRef | undefined) => void
  feedbackOnly?: boolean
}): JSX.Element {
  const choices: { label: string; ref: AnalogSignalRef }[] = []
  for (const other of Object.values(modules)) {
    if (other.tag === module.tag) continue
    if (other.type === 'PID') {
      for (const block of moduleBlocks(other)) {
        if (!block.part) continue
        if (feedbackOnly && block.part !== 'AO1' && block.part !== 'AO2') continue
        const parameters: AnalogSignalRef['parameter'][] = block.part === 'SPLTR1'
          ? ['OUT_1', 'OUT_2'] : ['OUT']
        for (const parameter of parameters) choices.push({
          label: `${other.tag}/${block.part}.${feedbackOnly ? 'BKCAL_OUT' : parameter}`,
          ref: { tag: other.tag, block: block.part, parameter }
        })
      }
      if (!feedbackOnly) choices.push({ label: `${other.tag}/PID1.PV`, ref: {
        tag: other.tag, block: 'PID1', parameter: 'PV'
      } })
    } else if (!feedbackOnly && (other.type === 'AI' || other.type === 'FB')) {
      const parameters: AnalogSignalRef['parameter'][] = other.type === 'AI' ? ['PV'] :
        other.fbType === 'SPLTR' ? ['OUT_1', 'OUT_2'] : ['OUT']
      for (const parameter of parameters) choices.push({
        label: `${other.tag}.${parameter}`, ref: { tag: other.tag, parameter }
      })
    }
  }
  const keyOf = (ref: AnalogSignalRef): string =>
    `${ref.tag}/${ref.block ?? (modules[ref.tag]?.type === 'PID' ? 'PID1' : '')}.${ref.parameter}`
  const selected = source ? keyOf(source) : ''
  return (
    <select className="studio-ref-select" aria-label={`${module.tag} ${defaultLabel} source`}
      value={selected} onChange={(e) => {
        const choice = choices.find((item) => keyOf(item.ref) === e.target.value)
        if (e.target.value && !choice) {
          const message = 'The selected signal source is no longer available'
          useStore.getState().logEvent('DIAGNOSTIC', module.tag, message)
          window.alert(message)
          return
        }
        onChange(choice?.ref)
      }}>
      <option value="">{defaultLabel}</option>
      {source && !choices.some((choice) => keyOf(choice.ref) === selected) &&
        <option value={selected}>{signalError(source, modules) ? 'Bad source' : 'Existing source'}: {selected}</option>}
      {choices.map((choice) =>
        <option key={keyOf(choice.ref)} value={keyOf(choice.ref)}>{choice.label}</option>)}
    </select>
  )
}

function PidIoWiringRows({ m, modules, setPidIo }: {
  m: PidModule; modules: Record<string, AnyModule>
  setPidIo: (tag: string, patch: PidIoPatch) => boolean
}): JSX.Element {
  const io = pidIo(m)
  return (
    <>
      <tr><td>CONTROL STRATEGY</td><td><select aria-label={`${m.tag} control strategy`}
        value={io.splitter ? 'split' : 'simple'} onChange={(e) =>
          setPidIo(m.tag, { splitRange: e.target.value === 'split' })}>
        <option value="simple">AI → PID → AO</option>
        <option value="split">AI → PID → SPLTR → AO1 / AO2</option>
      </select></td><td>Executable</td></tr>
      {io.splitter && <tr><td>ACTUATOR MODEL</td><td><select
        aria-label={`${m.tag} actuator model`} value={io.actuation ?? 'STAGED'}
        onChange={(e) => setPidIo(m.tag, { actuation: e.target.value === 'HEAT_COOL' ? 'HEAT_COOL' : 'STAGED' })}>
        <option value="STAGED">Two staged capacities</option>
        <option value="HEAT_COOL">Heating / cooling pair</option>
      </select></td><td>Simulated process</td></tr>}
      <tr><td>APPLIED FIELD OUTPUT</td><td>{fmt(appliedPidOutput(m), 1)} %</td><td>Actual AO actuation</td></tr>
      <tr><td>BKCAL_IN</td><td>{fmt(io.splitter?.bkcal ?? io.ao.out, 1)} %</td>
        <td>{!io.bkcalConnected ? 'Disconnected' : io.splitter?.status ??
          (io.ao.bad ? 'Bad' : io.ao.mode === 'MAN' || io.outputSource ? 'Not Invited' :
            io.ao.limited ? 'Limited' : 'Good')}</td></tr>
      <tr><td>IN.SOURCE</td><td>
        <AnalogSourceSelect module={m} modules={modules} source={io.inputSource}
          defaultLabel="AI1.OUT" onChange={(source) =>
            setPidIo(m.tag, { inputSource: source, aiConnected: true })} />
      </td><td className={m.pvBad ? 'bad' : 'good'}>{m.pvBad ? 'Bad' : 'Good'}</td></tr>
      <tr><td>AI1.OUT → PID1.IN</td><td>
        <button className="studio-param-btn" onClick={() => setPidIo(m.tag, {
          aiConnected: io.inputSource ? true : !io.aiConnected, inputSource: undefined
        })}>{io.inputSource ? 'External source · Restore AI1' :
          io.aiConnected ? 'Connected · Disconnect' : 'Disconnected · Connect'}</button>
      </td><td className={io.aiConnected ? 'good' : 'bad'}>
        {io.aiConnected ? 'Good' : 'Bad'}</td></tr>
      <tr><td>BKCAL_IN.CV</td><td>{io.bkcalConnected ? `${fmt(io.splitter ? io.splitter.bkcal : io.ao.out, 1)} %` : 'Disconnected'} · {
        !io.bkcalConnected ? 'No feedback' : io.splitter ? io.splitter.status :
          io.ao.bad ? 'Bad output' : io.ao.mode === 'MAN' ? 'Not invited' :
          io.ao.limited ? 'Limited' : 'Good cascade'}</td>
        <td className={io.ao.bad ? 'bad' : 'good'}>{io.ao.bad ? 'Bad' : 'Good'}</td></tr>
      <tr><td>{io.splitter ? 'SPLTR1' : 'AO1'}.BKCAL_OUT → PID1.BKCAL_IN</td><td>
        <button className="studio-param-btn" onClick={() =>
          setPidIo(m.tag, { bkcalConnected: !io.bkcalConnected })}>
          {io.bkcalConnected ? 'Connected · Disconnect' : 'Disconnected · Connect'}
        </button>
      </td><td>{io.bkcalConnected ? 'Feedback active' : 'No back-calculation'}</td></tr>
    </>
  )
}

function AnalogIoParamRows({ m, block, modules, setPidIo }: {
  m: PidModule; block: PidBlockName; modules: Record<string, AnyModule>
  setPidIo: (tag: string, patch: PidIoPatch) => boolean
}): JSX.Element {
  const io = pidIo(m)
  const input = block === 'AI1'
  const second = block === 'AO2'
  const output = second ? io.ao2 : io.ao
  if (!output) return <tr><td colSpan={3} className="bad">AO2 is not configured</td></tr>
  const stage = input ? io.ai : output
  const source = second ? io.output2Source : io.outputSource
  const command = source ? readAnalogSignal(source, modules) : {
    value: io.splitter ? second ? io.splitter.out2 : io.splitter.out1 : m.out,
    bad: io.splitter?.status === 'BAD'
  }
  const mode = stage.mode
  const row = (label: string, content: ReactNode, bad = stage.bad): JSX.Element => (
    <tr key={label}><td>{label}</td><td className="pv">{content}</td>
      <td className={bad ? 'bad' : 'good'}>{bad ? 'Bad' : 'Good'}</td></tr>
  )
  return (
    <>
      {row('MODE.TARGET', <button className="studio-param-btn" onClick={() =>
        setPidIo(m.tag, input ? { inputMode: mode === 'MAN' ? 'AUTO' : 'MAN' } :
          second ? { output2Mode: mode === 'MAN' ? 'CAS' : 'MAN' } :
            { outputMode: mode === 'MAN' ? 'CAS' : 'MAN' })}>
        {mode} · → {mode === 'MAN' ? input ? 'AUTO' : 'CAS' : 'MAN'}
      </button>)}
      {input && row('FIELD_VAL.CV', `${fmt(io.ai.raw, m.decimals)} ${m.unit}`, io.ai.rawBad)}
      {!input && row('CAS_IN.CV', command.bad ? 'Bad source' : `${fmt(command.value, 1)} %`, command.bad)}
      {row('OUT.CV', `${fmt(stage.out, input ? m.decimals : 1)} ${input ? m.unit : '%'}`)}
      {mode === 'MAN' && row('MANUAL_OUT', <ParamStepper
        value={stage.manualValue} step={input ? (m.pvMax - m.pvMin) / 100 : 1}
        decimals={input ? m.decimals : 1} onChange={(value) =>
          setPidIo(m.tag, input ? { inputManual: value } :
            second ? { output2Manual: value } : { outputManual: value })} />)}
      {input ? <>
        {row('OUT_SCALE.LO', `${m.pvMin} ${m.unit}`)}
        {row('OUT_SCALE.HI', `${m.pvMax} ${m.unit}`)}
      </> : <>
        {row('OUT_LO_LIM', <ParamStepper value={output.lowLimit} step={1} decimals={1}
          onChange={(value) => setPidIo(m.tag, second ? { output2Low: value } : { outputLow: value })} />)}
        {row('OUT_HI_LIM', <ParamStepper value={output.highLimit} step={1} decimals={1}
          onChange={(value) => setPidIo(m.tag, second ? { output2High: value } : { outputHigh: value })} />)}
        {row('CAS_IN.SOURCE', <AnalogSourceSelect module={m} modules={modules}
          source={source} defaultLabel={io.splitter ? `SPLTR1.OUT_${second ? 2 : 1}` : 'PID1.OUT'}
          onChange={(value) => setPidIo(m.tag, second
            ? { output2Source: value, ao2Connected: true } : { outputSource: value, aoConnected: true })} />)}
        {row('CAS_IN.CONNECTION', <button className="studio-param-btn" onClick={() =>
          setPidIo(m.tag, second ? { ao2Connected: source ? true : !io.ao2Connected, output2Source: undefined }
            : { aoConnected: source ? true : !io.aoConnected, outputSource: undefined })}>
          {source ? 'External source · Restore strategy' :
            (second ? io.ao2Connected : io.aoConnected) ? 'Connected · Disconnect' : 'Disconnected · Connect'}
        </button>)}
        {row('BKCAL_OUT.CV', `${fmt(stage.out, 1)} %`)}
        {row('SIMULATED I/O FAULT', <button className="studio-param-btn" onClick={() =>
          setPidIo(m.tag, second ? { output2Failed: !io.ao2?.fault } : { outputFailed: !io.ao.fault })}>
          {(second ? io.ao2?.fault : io.ao.fault) ? 'Failed · Restore' : 'Healthy · Inject fault'}
        </button>)}
      </>}
    </>
  )
}

function SplitterParamRows({ state, onChange }: {
  state: SplitterState; onChange: (patch: SplitterPatch) => void
}): JSX.Element {
  const row = (label: string, content: ReactNode): JSX.Element => (
    <tr key={label}><td>{label}</td><td className="pv">{content}</td>
      <td className={state.status === 'BAD' ? 'bad' : 'good'}>
        {state.status === 'BAD' ? 'Bad' : 'Good'}</td></tr>
  )
  return (
    <>
      {row('MODE.TARGET', <button className="studio-param-btn" onClick={() =>
        onChange({ mode: state.mode === 'CAS' ? 'AUTO' : state.mode === 'AUTO' ? 'OOS' : 'CAS' })}>
        {state.mode} · → {state.mode === 'CAS' ? 'AUTO' : state.mode === 'AUTO' ? 'OOS' : 'CAS'}
      </button>)}
      {row('MODE.ACTUAL', state.actualMode)}
      {row('SP', state.mode === 'AUTO'
        ? <ParamStepper value={state.autoSp} step={1} decimals={1}
          onChange={(value) => onChange({ sp: value })} /> : fmt(state.sp, 1))}
      {row('OUT_1', `${fmt(state.out1, 1)} %`)}
      {row('OUT_2', `${fmt(state.out2, 1)} %`)}
      {row('BKCAL_OUT', `${fmt(state.bkcal, 1)} % · ${state.status}`)}
      {row('BLOCK_ERR', state.error ?? (state.mode === 'OOS' ? 'Out of service' : 'None'))}
      {(['inArray', 'outArray'] as const).flatMap(key => state[key].map((value, index) =>
        row(`${key === 'inArray' ? 'IN' : 'OUT'}_ARRAY[${index + 1}]`, <ParamStepper
          value={value} step={1} decimals={1} onChange={(next) => {
            const values: [number, number, number, number] = [...state[key]]
            values[index] = next
            onChange(key === 'inArray' ? { inArray: values } : { outArray: values })
          }} />)))}
      {row('LOCKVAL', <button className="studio-param-btn" onClick={() =>
        onChange({ lockval: state.lockval === 'HOLD' ? 'Y11' : 'HOLD' })}>
        {state.lockval} · Toggle
      </button>)}
      {row('Hysteresis (% of first span)', <ParamStepper value={state.hysteresisPct}
        step={1} decimals={1} onChange={(value) => onChange({ hysteresisPct: value })} />)}
      {row('BAL_TIME (s)', <ParamStepper value={state.balTimeSec} step={1} decimals={1}
        onChange={(value) => onChange({ balTimeSec: value })} />)}
      {row('SP_RATE_UP (%/s)', <ParamStepper value={state.spRateUp} step={1} decimals={1}
        onChange={(value) => onChange({ spRateUp: value })} />)}
      {row('SP_RATE_DN (%/s)', <ParamStepper value={state.spRateDown} step={1} decimals={1}
        onChange={(value) => onChange({ spRateDown: value })} />)}
      {row('CAS_IN.CONNECTION', <button className="studio-param-btn"
        onClick={() => onChange({ inputConnected: !state.inputConnected })}>
        {state.inputConnected ? 'Connected · Disconnect' : 'Disconnected · Connect'}
      </button>)}
      {([1, 2] as const).map(branch => row(`BKCAL_IN_${branch}.CONNECTION`,
        <button className="studio-param-btn" onClick={() => onChange(branch === 1
          ? { feedback1Connected: !state.feedback1Connected }
          : { feedback2Connected: !state.feedback2Connected })}>
          {(branch === 1 ? state.feedback1Connected : state.feedback2Connected)
            ? 'Connected · Disconnect' : 'Disconnected · Connect'}
        </button>))}
    </>
  )
}

function FbParamRows({
  m,
  tags,
  setFbInput,
  setFbConfig
}: {
  m: FunctionBlockModule
  tags: string[]
  setFbInput: (tag: string, which: 'in1' | 'in2', ref: FbInputRef) => void
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
      <FbWireRow label="IN1" tags={tags} input={m.in1} bad={m.bad}
        onSet={(ref) => setFbInput(m.tag, 'in1', ref)} />
      {needsIn2 && <FbWireRow label="IN2" tags={tags} input={m.in2} bad={m.bad}
        onSet={(ref) => setFbInput(m.tag, 'in2', ref)} />}
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
        <td className={m.bad ? 'bad' : 'good'}>{m.bad ? 'Bad' : 'Good'}</td>
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
  onSet,
  bad
}: {
  label: string
  tags: string[]
  input: FbInputRef
  onSet: (ref: FbInputRef) => void
  bad?: boolean
}): JSX.Element {
  const modules = useStore((s) => s.modules)
  const qualified = (ref: FbInputRef): string => ref.parameter
    ? `${ref.tag}${ref.block ? '/' + ref.block : ''}.${ref.parameter}` : ref.tag ?? ''
  const sourceError = input.kind === 'ref' && (!input.tag || !modules[input.tag] ||
    ((input.parameter || input.block) && signalError({
      tag: input.tag, parameter: input.parameter ?? 'OUT', block: input.block
    }, modules)))
  const choices: { label: string; ref: FbInputRef }[] = tags.map(tag => ({
    label: tag, ref: { kind: 'ref', value: 0, tag }
  }))
  for (const tag of tags) {
    const source = modules[tag]
    if (source?.type === 'PID') {
      for (const block of moduleBlocks(source)) {
        if (!block.part) continue
        const parameters: AnalogSignalRef['parameter'][] = block.part === 'SPLTR1' ? ['OUT_1', 'OUT_2'] :
          block.part === 'PID1' ? ['OUT', 'PV'] : ['OUT']
        for (const parameter of parameters) choices.push({
          label: `${tag}/${block.part}.${parameter}`,
          ref: { kind: 'ref', value: 0, tag, block: block.part, parameter }
        })
      }
    } else if (source?.type === 'FB' && source.fbType === 'SPLTR') {
      for (const parameter of ['OUT_1', 'OUT_2'] as const) choices.push({
        label: `${tag}.${parameter}`, ref: { kind: 'ref', value: 0, tag, parameter }
      })
    }
  }
  return (
    <tr>
      <td>{label}</td>
      <td className="pv">
        <span className="fb-wirerow">
          <select
            className="fb-select"
            value={input.kind === 'const' ? 'CONST' : qualified(input)}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'CONST') onSet({ kind: 'const', value: input.value })
              else {
                const choice = choices.find(item => qualified(item.ref) === v)
                if (choice) onSet(choice.ref)
              }
            }}
          >
            <option value="CONST">Const</option>
            {input.kind === 'ref' && !choices.some(choice => qualified(choice.ref) === qualified(input)) &&
              <option value={qualified(input)}>{sourceError ? 'Bad source' : 'Existing source'}: {qualified(input)}</option>}
            {choices.map((choice) => (
              <option key={qualified(choice.ref)} value={qualified(choice.ref)}>
                {choice.label}
              </option>
            ))}
          </select>
          {input.kind === 'const' && (
            <ParamStepper step={1} decimals={2} value={input.value} onChange={(v) => onSet({ kind: 'const', value: v })} />
          )}
        </span>
      </td>
      <td className={bad ? 'bad' : 'good'}>{bad ? 'Bad' : 'Good'}</td>
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
  const nameError = moduleNameError(normTag)
  const exists = normTag.length > 0 && !!modules[normTag]

  const submit = (): void => {
    if (!pending || nameError || exists) return
    const created = createModule(
      pending.create.type === 'FB'
        ? { tag: normTag, type: 'FB', fbType: pending.create.fbType, description: `${pending.label} block`, area }
        : { tag: normTag, type: pending.create.type, description: `${pending.label} block`, area }
    )
    if (!created) return
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
          {tag.length > 0 && nameError && <div className="studio-pal-err">{nameError}</div>}
          <div className="studio-pal-create-btns">
            <button className="tbtn sm" disabled={!!nameError || exists} onClick={submit}>
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

const RIBBON_TABS = ['File', 'Home', 'Diagram', 'View']

type StudioPane = 'hierarchy' | 'parameters' | 'palette'
type RibbonIconKind = 'module' | 'diagram' | 'parameters' | 'zoomIn' | 'zoomOut' | 'reset' | 'download' | 'edit' | 'alarm' | 'history'

function RibbonIcon({ kind }: { kind: RibbonIconKind }): JSX.Element {
  if (kind === 'module') return <ModuleIcon kind="control" size={28} />
  const paths: Record<Exclude<RibbonIconKind, 'module'>, string> = {
    diagram: 'M3,5 H11 V12 H3 Z M19,18 H27 V25 H19 Z M11,8 H23 V18 M7,12 V21 H19',
    parameters: 'M5,3 H25 V27 H5 Z M9,9 H21 M9,15 H21 M9,21 H17',
    zoomIn: 'M21,21 L29,29 M7,13 H19 M13,7 V19',
    zoomOut: 'M21,21 L29,29 M7,13 H19',
    reset: 'M5,11 A11,11 0 1 1 5,22 M5,3 V11 H13',
    download: 'M10,3 H22 V16 H29 L16,29 L3,16 H10 Z',
    edit: 'M5,22 L21,6 L26,11 L10,27 H5 Z M18,9 L23,14',
    alarm: 'M7,22 V13 A9,9 0 0 1 18,4 Q25,7 25,13 V22 Z M4,22 H28 M13,26 H19',
    history: 'M4,4 H28 V28 H4 Z M8,21 L12,13 L17,17 L24,8'
  }
  return (
    <svg width={28} height={28} viewBox="0 0 32 32" aria-hidden="true">
      {(kind === 'zoomIn' || kind === 'zoomOut') && <circle cx={13} cy={13} r={10} fill="#eef1f5" stroke="#63748b" strokeWidth={1.5} />}
      <path d={paths[kind]} fill={kind === 'download' ? '#b7bfd1' : kind === 'alarm' ? '#e1cd79' : 'none'} stroke="#63748b" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

function StudioRibbon({ tag, onFaceplate, zoom, onZoom, panes, onToggle }: {
  tag: string; onFaceplate: () => void; zoom: number; onZoom: (value: number) => void
  panes: Record<StudioPane, boolean>; onToggle: (pane: StudioPane) => void
}): JSX.Element {
  const [tab, setTab] = useState('Diagram')
  const focusExplorer = useUi((s) => s.focusExplorer)
  const focusAlarms = useUi((s) => s.focusAlarms)
  const focusTrend = useUi((s) => s.focusTrend)
  const module = useStore((s) => s.modules[tag])
  const trendAvailable = module?.type === 'PID' || module?.type === 'AI'
  return (
    <div className="ribbon">
      <div className="studio-caption"><ModuleIcon kind="control" size={16} /><span>{tag} — Control Studio</span><span className="studio-caption-status">ONLINE · simulated configuration</span></div>
      <div className="ribbon-tabs">
        {RIBBON_TABS.map((t) => (
          <button key={t} type="button" className={'ribbon-tab' + (t === 'File' ? ' file' : t === tab ? ' active' : '')}
            disabled={t === 'File'}
            title={t === 'File' ? 'File ribbon commands are not implemented' : `${t} commands`}
            aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <span className="ribbon-title">{Math.round(zoom * 100)}%</span>
      </div>
      <div className="ribbon-body">
        {tab === 'Home' && <RibbonGroup label="Clipboard">
          <RibbonBtn ic="parameters" label="Copy" unavailable="Block clipboard operations are not implemented" />
          <RibbonBtn ic="parameters" label="Paste" unavailable="Block clipboard operations are not implemented" />
        </RibbonGroup>}
        {tab !== 'View' && <>
          <RibbonGroup label="Module">
            <RibbonBtn ic="download" label="Download" unavailable="This simulator has no Control Studio module download command" />
            <RibbonBtn ic="module" label="Faceplate" onClick={onFaceplate} />
            <RibbonBtn ic="parameters" label="Properties" onClick={() => focusExplorer(tag)} />
          </RibbonGroup>
          <RibbonGroup label="Algorithm">
            <RibbonBtn ic="diagram" label="Function Block" active onClick={() => setTab('Diagram')} />
            <RibbonBtn ic="edit" label="Edit Object" onClick={onFaceplate} />
          </RibbonGroup>
          <RibbonGroup label="History / Alarms">
            <RibbonBtn ic="history" label="History View" onClick={trendAvailable ? () => focusTrend(tag) : undefined} unavailable={trendAvailable ? undefined : 'Historian pens are available for PID and AI modules'} />
            <RibbonBtn ic="alarm" label="Alarm View" onClick={() => focusAlarms(tag)} />
          </RibbonGroup>
        </>}
        {tab === 'View' && <RibbonGroup label="Windows">
          <RibbonBtn ic="module" label="Hierarchy" active={panes.hierarchy} onClick={() => onToggle('hierarchy')} />
          <RibbonBtn ic="parameters" label="Parameters" active={panes.parameters} onClick={() => onToggle('parameters')} />
          <RibbonBtn ic="diagram" label="Palette" active={panes.palette} onClick={() => onToggle('palette')} />
        </RibbonGroup>}
        <RibbonGroup label="Zoom">
          <RibbonBtn ic="zoomIn" label="Zoom In" onClick={() => onZoom(zoom + 0.1)} unavailable={zoom >= 1.5 ? 'Maximum zoom is 150%' : undefined} />
          <RibbonBtn ic="zoomOut" label="Zoom Out" onClick={() => onZoom(zoom - 0.1)} unavailable={zoom <= 0.5 ? 'Minimum zoom is 50%' : undefined} />
          <RibbonBtn ic="reset" label="100%" onClick={() => onZoom(1)} />
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
  onClick,
  unavailable
}: {
  ic: RibbonIconKind
  label: string
  active?: boolean
  onClick?: () => void
  unavailable?: string
}): JSX.Element {
  return (
    <button type="button" className={'ribbon-btn' + (active ? ' active' : '')} onClick={onClick} disabled={!!unavailable}
      title={unavailable ?? label} aria-label={label} aria-pressed={active === undefined ? undefined : active}>
      <RibbonIcon kind={ic} />
      <span>{label}</span>
    </button>
  )
}
