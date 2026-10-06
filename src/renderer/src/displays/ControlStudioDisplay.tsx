import { useDatabaseClient } from '../components/useDatabaseClient'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../engine/store'
import { isPidTargetMode, PID_TARGET_MODES, pidExecutionBad, pidModeFieldsError, pidNormalMode, pidPermittedModes } from '../engine/pidModes'
import { useUi } from '../ui/uiStore'
import { fmt } from '../utils/format'
import { FbdCanvas } from '../components/FbdCanvas'
import { StandaloneAoControls } from '../components/StandaloneAoControls'
import { ModuleDownloadDialog, ModuleLifecycleRows } from '../components/ModuleLifecycleControls'
import { DownloadStatusIndicator } from '../components/DownloadStatusIndicator'
import { PidLifecycleRows } from '../components/PidLifecycleControls'
import { PidTransferDialog } from '../components/PidTransferDialog'
import { DeviceDownloadDialog, DeviceLifecycleRows } from '../components/DeviceLifecycleControls'
import { deviceEditorModules } from '../engine/deviceLifecycle'
import { lifecycleModules } from '../engine/moduleLifecycle'
import { changedPidTuningParameters, lifecyclePidModules, pidLifecycleDirty } from '../engine/pidLifecycle'
import { ModuleIcon, FunctionBlockIcon } from '../components/EngineeringIcons'
import { RibbonGlyph, type GlyphName } from '../components/StudioRibbonIcons'
import { FB_NEEDS_IN2 } from '../engine/fb'
import { moduleNameError } from '../engine/naming'
import { traditionalChannels, type AnalogBindingPort } from '../engine/traditionalIo'
import { appliedPidOutput, pidIo, readAnalogSignal, signalError } from '../engine/analogStrategy'
import { connectedModuleTags, moduleBlocks } from '../engine/controlDiagram'
import { deviceInterlockSignal, devicePermissiveSignal } from '../engine/simulate'
import { deviceDescriptorCommandError, deviceDescriptorLabel } from '../engine/deviceDescriptors'
import { NewControlModuleDialog } from './ExplorerDisplay'
import { DeviceLogicView, LogicExplanationView } from './ModuleLogicView'
import type {
  AnalogSignalRef, AnyModule, FbBlockType, FunctionBlockModule, PidModule,
  PidBlockName, PidIoPatch, SplitterPatch, SplitterState, FbInputRef,
  MotorModule, ValveModule, AnalogOutputModule
} from '../engine/types'
import type { ReactNode } from 'react'

// Control Studio: a real Function Block Diagram node editor (drag, wire,
// delete) backed by the 10 Hz simulation tick in engine/simulate.ts — every
// CV shown is live-clickable, same as the faceplates.

export function ControlStudioDisplay(): JSX.Element {
  useDatabaseClient('DeltaV Control Studio')
  const studioTag = useUi((s) => s.studioTag)
  const runtimeModules = useStore((s) => s.modules)
  const moduleLifecycle = useStore(s => s.moduleLifecycle)
  const pidLifecycle = useStore(s => s.pidLifecycle)
  const deviceLifecycle = useStore(s => s.deviceLifecycle)
  const modules = useMemo(() => deviceEditorModules(lifecyclePidModules(
    lifecycleModules({ modules: runtimeModules, moduleLifecycle }, studioTag ?? undefined), pidLifecycle), deviceLifecycle),
    [runtimeModules, moduleLifecycle, pidLifecycle, deviceLifecycle, studioTag])
  const m = studioTag ? modules[studioTag] : undefined
  const openFaceplate = useUi((s) => s.openFaceplate)
  const select = useUi((s) => s.select)
  const openStudio = useUi((s) => s.openStudio)
  const [zoom, setZoom] = useState(1)
  const [showHierarchy, setShowHierarchy] = useState(true)
  const [bottomTab, setBottomTab] = useState<'parameters' | 'alarms'>('parameters')
  const [showPalette, setShowPalette] = useState(true)
  const [blockSelection, setBlockSelection] = useState<{ tag: string; block: PidBlockName } | null>(null)
  const [showNew, setShowNew] = useState(false)
  const areas = useStore(s => s.areas)

  if (!m) {
    return (
      <div className="display studio">
        <div className="exp-empty">Open a module from DeltaV Explorer or a graphic, or create a new algorithm.
          {' '}<button className="tbtn" onClick={() => setShowNew(true)}>New...</button>
        </div>
        {showNew && <NewControlModuleDialog initialArea={areas[0] ?? ''} onClose={() => setShowNew(false)} />}
      </div>
    )
  }

  const visibleTags = connectedModuleTags(modules, m.tag)
  const selectedBlock = blockSelection?.tag === m.tag ? blockSelection.block : 'PID1'
  const isDevice = m.type === 'MOTOR' || m.type === 'VALVE'
  const owner = modules[m.tag.split('/')[0]]
  const assigned = owner && 'controllerTag' in owner ? owner.controllerTag : undefined

  return (
    <div className="display studio">
      <StudioRibbon
        tag={m.tag}
        onNew={() => setShowNew(true)}
        onFaceplate={() => openFaceplate(m.tag.split('/')[0])}
        zoom={zoom}
        onZoom={(value) => setZoom(Math.max(0.5, Math.min(1.5, Math.round(value * 10) / 10)))}
        panes={{ hierarchy: showHierarchy, parameters: bottomTab === 'parameters', palette: showPalette, alarms: bottomTab === 'alarms' }}
        onToggle={(pane) => {
          if (pane === 'hierarchy') setShowHierarchy((value) => !value)
          else if (pane === 'parameters' || pane === 'alarms') setBottomTab(pane)
          else setShowPalette((value) => !value)
        }}
      />
      {showNew && <NewControlModuleDialog initialArea={m.area} onClose={() => setShowNew(false)} />}
      <div className="studio-main">
        {showHierarchy && <HierarchyView module={m} selectedBlock={selectedBlock}
          onSelect={(block) => setBlockSelection({ tag: m.tag, block })} />}
        <div className="studio-center">
          <div className="studio-page" role="document" aria-label={`${m.tag} diagram and logic explanation`}>
            {isDevice ? <DeviceLogicView module={m as MotorModule | ValveModule} zoom={zoom} /> : <>
              <div className="studio-canvas studio-canvas-page">
                <FbdCanvas
                  compact
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
              <LogicExplanationView module={m} />
            </>}
            {m.type === 'FB' && m.tag.includes('/') && modules[m.tag.split('/')[0]]?.type === 'MOTOR' &&
              <button className="tbtn sm" onClick={() => openStudio(m.tag.split('/')[0])}>Owning motor: {m.tag.split('/')[0]} - Save / Download</button>}
          </div>
          <div className="studio-bottom">
            <div className="studio-bottom-tabs" role="tablist" aria-label="Bottom panel">
              <button type="button" role="tab" aria-selected={bottomTab === 'parameters'} className={bottomTab === 'parameters' ? 'active' : ''} onClick={() => setBottomTab('parameters')}>Parameter View</button>
              <button type="button" role="tab" aria-selected={bottomTab === 'alarms'} className={bottomTab === 'alarms' ? 'active' : ''} onClick={() => setBottomTab('alarms')}>Alarm View</button>
            </div>
            {bottomTab === 'parameters' && <ParameterView module={m} selectedBlock={selectedBlock} />}
            {bottomTab === 'alarms' && <AlarmView module={m} />}
          </div>
        </div>
        {showPalette && !isDevice && <PaletteView area={m.area} />}
      </div>
      <div className="studio-statusbar">
        <span>Assigned to: {assigned ?? 'Not assigned'}</span>
        <span className="studio-status-zoom">{Math.round(zoom * 100)}%
          <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}>-</button>
          <input type="range" aria-label="Zoom" min={50} max={150} step={10} value={Math.round(zoom * 100)}
            onChange={(event) => setZoom(Number(event.target.value) / 100)} />
          <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(1.5, Math.round((zoom + 0.1) * 10) / 10))}>+</button>
        </span>
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
        {(m.type === 'MOTOR' || m.type === 'VALVE') && !m.tag.includes('/') && <div className="studio-tree-group" aria-label="Module template blocks">
          {['DCC1', 'EDC1', 'CND1', 'MODELOCK'].map((name) => <div key={name} className="studio-tree-node studio-tree-template">{name}</div>)}
        </div>}
      </div>
      <div className="studio-pane-label">Hierarchy View</div>
    </div>
  )
}

interface ParamRow {
  error?: string | null
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
  const setPidModeFields = useStore((s) => s.setPidModeFields)
  const setInterlockSource = useStore((s) => s.setInterlockSource)
  const setPermissiveSource = useStore(s => s.setPermissiveSource)
  const setCommandSource = useStore((s) => s.setCommandSource)
  const setMode = useStore((s) => s.setMode)
  const runtimeModules = useStore(s => s.modules)
  const deviceRecords = useStore(s => s.deviceLifecycle)
  const modules = useMemo(() => deviceEditorModules(runtimeModules, deviceRecords), [runtimeModules, deviceRecords])
  const setFbInput = useStore((s) => s.setFbInput)
  const setFbConfig = useStore((s) => s.setFbConfig)
  const setPidIo = useStore((s) => s.setPidIo)
  const setSplitterConfig = useStore((s) => s.setSplitterConfig)
  const deviceLifecycle = useStore(s => s.deviceLifecycle[m.tag])
  const pidLifecycle = useStore(s => s.pidLifecycle[m.tag])
  const pidOffline = !!pidLifecycle && !pidLifecycle.online
  const namedSets = useStore(s => s.namedSets)
  const selectedSplitter = m.type === 'PID' ? pidIo(m).splitter : undefined
  const ioBlock = m.type === 'PID' && selectedBlock !== 'PID1'
  const bad = m.type === 'PID' ? m.pvBad || pidExecutionBad(m) : m.type === 'AI' ? m.pvBad :
    m.type === 'DI' || m.type === 'DO' ? !!m.ioBad :
      m.type === 'MOTOR' || m.type === 'VALVE' ? !!m.ioInputBad || !!m.ioOutputBad : false

  const rows: ParamRow[] = []
  if (m.type === 'PID') {
    const spEditable = !pidOffline && m.actualMode === 'AUTO'
    const outEditable = !pidOffline && (m.actualMode === 'MAN' || m.actualMode === 'ROUT')
    rows.push(
      { key: 'MODE.TARGET', value: m.mode },
      { key: 'MODE.ACTUAL', value: m.actualMode },
      { key: 'PV.CV', value: `${fmt(m.pv, m.decimals)} ${m.unit}` },
      ...(m.templateId === 'PID_LOOP' ? [{ key: 'IO_OPTS', value: m.outputAction ?? 'Unset' }] : []),
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
      { key: 'GAIN', value: `${m.gain}`, edit: pidOffline ? undefined : { kind: 'num', step: 0.1, decimals: 2, raw: m.gain, onChange: (v) => setTuning(m.tag, { gain: v }) } },
      { key: 'RESET', value: `${m.reset} s/rpt`, edit: pidOffline ? undefined : { kind: 'num', step: 1, decimals: 0, raw: m.reset, onChange: (v) => setTuning(m.tag, { reset: v }) } },
      { key: 'RATE', value: `${m.rate} s`, edit: pidOffline ? undefined : { kind: 'num', step: 0.5, decimals: 1, raw: m.rate, onChange: (v) => setTuning(m.tag, { rate: v }) } },
      { key: 'BKCAL_OUT', value: bkcalOutStatus(m, modules) }
    )
    if (m.trackError || m.ffError) rows.push({ key: 'EXECUTION DIAGNOSTIC', value: m.trackError || m.ffError || '', error: m.trackError || m.ffError })
  } else if (m.type === 'AI') {
    rows.push({ key: 'PV.CV', value: `${fmt(m.pv, m.decimals)} ${m.unit}` }, { key: 'PV_FTIME', value: '2 s' })
  } else if (m.type === 'MOTOR' || m.type === 'VALVE') {
    const commanded = m.type === 'MOTOR' ? m.commanded : m.commandedOpen
    const feedback = m.type === 'MOTOR' ? m.running : m.open
    const commandLabel = deviceDescriptorLabel(m, namedSets, 'command', commanded)
    const feedbackLabel = deviceDescriptorLabel(m, namedSets, 'feedback', feedback)
    const descriptorError = deviceDescriptorCommandError(m, namedSets)
    rows.push(
      { key: 'SP_D.CV', value: commandLabel.error ? commandLabel.label : `${Number(commanded)} (${commandLabel.label})`, error: descriptorError,
        toggle: commanded || !descriptorError ? { onClick: () => m.type === 'MOTOR' ?
          commanded ? stopMotor(m.tag) : startMotor(m.tag) : commanded ? closeValve(m.tag) : openValve(m.tag),
        label: m.descriptors ? deviceDescriptorLabel(m, namedSets, 'command', !commanded).label :
          m.type === 'MOTOR' ? commanded ? 'Stop' : 'Start' : commanded ? 'Close' : 'Open' } : undefined },
      { key: 'PV_D.CV', value: feedbackLabel.error ? feedbackLabel.label :
        m.descriptors ? `${Number(feedback)} (${feedbackLabel.label})` : `${Number(feedback)}`,
        error: feedbackLabel.error },
      { key: 'INTERLOCK', value: m.interlock ? '1' : '0' }
    )
    if (m.descriptors) rows.push({ key: 'DESCRIPTOR SETUP', value: descriptorError ?? m.descriptors.namedSet, error: descriptorError })
  } else if (m.type === 'DO') {
    rows.push({ key: 'SP_D.CV', value: m.commanded ? '1' : '0',
      toggle: m.mode === 'OOS' ? undefined : { onClick: () => toggleDO(m.tag), label: 'Toggle' } },
      { key: 'PV_D.CV', value: m.state ? '1' : '0' })
  } else if (m.type !== 'FB' && m.type !== 'AO') {
    rows.push({ key: 'PV_D.CV', value: m.state ? '1' : '0' })
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
          {(m.type === 'DI' || m.type === 'DO') && <DiscreteIoRows m={m} />}
          {m.type === 'AI' && <AnalogDstRow tag={m.tag} port="input" bad={m.pvBad} />}
          {m.type === 'AO' && <StandaloneAoRows m={m} />}
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
                  {m.type === 'PID' && r.key === 'MODE.TARGET' ? (
                    <select aria-label={`${m.tag} PID target mode`} value={m.mode} disabled={pidOffline} onChange={event => {
                      if (isPidTargetMode(event.target.value)) setMode(m.tag, event.target.value)
                    }}>
                      {pidPermittedModes(m).map(mode => <option key={mode} value={mode}
                        disabled={mode === 'CAS' && !m.casSource}>{mode}</option>)}
                    </select>
                  ) : r.edit ? (
                    <ParamStepper step={r.edit.step} decimals={r.edit.decimals} value={r.edit.raw} onChange={r.edit.onChange} />
                  ) : r.toggle ? (
                    <button className="studio-param-btn" onClick={r.toggle.onClick}>
                      {r.value} · {r.toggle.label}
                    </button>
                  ) : (
                    r.value
                  )}
                </td>
                <td className={bad || r.error ? 'bad' : 'good'}>{bad || r.error ? 'Bad' : 'Good'}</td>
              </tr>
            ))
          )}
          {m.type === 'PID' && !ioBlock && (
            <>
              <tr>
                <td>MODE.NORMAL</td>
                <td className="pv">
                  <select aria-label={`${m.tag} PID normal mode`} value={pidNormalMode(m)} disabled={pidOffline}
                    onChange={event => { if (isPidTargetMode(event.target.value)) setPidModeFields(m.tag, { normalMode: event.target.value }) }}>
                    {PID_TARGET_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </td>
                <td className={pidModeFieldsError(m) ? 'bad' : 'good'}>
                  {pidModeFieldsError(m) ?? 'Not used by algorithm'}
                </td>
              </tr>
              <tr>
                <td>MODE.ISAN</td>
                <td className="pv">{m.actualMode === pidNormalMode(m) ? '1' : '0'}</td>
                <td className={bad || m.actualMode !== pidNormalMode(m) ? 'bad' : 'good'}>
                  {bad ? 'Bad' : m.actualMode === pidNormalMode(m) ? 'Normal' : 'Not Normal'}
                </td>
              </tr>
              <tr>
                <td>MODE.PERMITTED</td>
                <td className="pv">
                  <select aria-label={`${m.tag} PID permitted modes`} multiple size={4} disabled={pidOffline}
                    value={pidPermittedModes(m)}
                    onChange={event => {
                      const values = Array.from(event.target.selectedOptions, option => option.value)
                        .filter(isPidTargetMode)
                      setPidModeFields(m.tag, { permittedModes: values })
                    }}>
                    {PID_TARGET_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </td>
                <td className={pidModeFieldsError(m) ? 'bad' : 'good'}>
                  {pidModeFieldsError(m) ?? 'Control-click to select multiple'}
                </td>
              </tr>
            </>
          )}
          {m.type === 'PID' && !ioBlock && (
            <PidIoWiringRows m={m} modules={modules} setPidIo={setPidIo} />
          )}
          {m.type === 'PID' && !ioBlock && m.templateId === 'PID_LOOP' && (
            <PidLifecycleRows tag={m.tag} />
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
            <DeviceLifecycleRows tag={m.tag} />
          )}
          {(m.type === 'MOTOR' || m.type === 'VALVE') && (
            <DeviceIoRows m={m} />
          )}
          {(m.type === 'MOTOR' || m.type === 'VALVE') && !deviceLifecycle && (
            <DeviceWiringRows
              m={m}
              tags={Object.keys(modules).filter((t) => t !== m.tag).sort()}
              setInterlockSource={setInterlockSource}
              setPermissiveSource={setPermissiveSource}
              setCommandSource={setCommandSource}
            />
          )}
        </tbody>
      </table>
      <div className="studio-pane-label">Parameter View — {m.tag}{m.type === 'PID' ? `/${selectedBlock}` : ''}</div>
    </div>
  )
}

function DeviceIoRows({ m }: { m: MotorModule | ValveModule }): JSX.Element {
  const hardware = useStore(s => s.hardware)
  const managed = useStore(s => !!s.deviceLifecycle[m.tag])
  const bind = useStore(s => s.bindDeviceDst)
  const binding = hardware.deviceBindings?.[m.tag]
  return <>
    {(['input', 'output'] as const).map(port => {
      const label = port === 'input' ? 'IO_IN_1' : 'IO_OUT_1'
      const selected = binding?.[port] ?? ''
      const choices = traditionalChannels(hardware).filter(item =>
        item.card.type === (port === 'input' ? 'DI' : 'DO') && item.channel.dst)
      const bad = port === 'input' ? m.ioInputBad : m.ioOutputBad
      return <tr key={port}><td>{label}</td><td>
        <select disabled={managed} aria-label={`${m.tag} ${label}`} value={selected} onChange={e => bind(m.tag, port, e.target.value)}>
          <option value="">(unbound)</option>
          {selected && !choices.some(item => item.channel.dst === selected) &&
            <option value={selected}>{selected} (missing)</option>}
          {choices.map(item => <option key={item.channel.dst} value={item.channel.dst}>
            {item.channel.dst} ({item.card.id} CH{item.channel.channel})
          </option>)}
        </select>
      </td><td className={bad ? 'bad' : 'good'}>{m.downloaded === false ? 'Not downloaded - Bad' : binding ? bad ? 'Bad' : 'Good' : 'Local'}</td></tr>
    })}
    <tr><td>OUT_D.RESOLVED / APPLIED</td><td>{binding ?
      `${Number(!!m.outputCommand)} / ${Number(!!m.appliedCommand)}` : m.downloaded === false ? 'Inhibited; download required' : 'Local confirmation'}</td>
      <td>{m.downloaded === false ? 'Inhibited; first download required' : binding ? 'External DI confirmation; clock never confirms' : 'Internal confirmation timer'}</td></tr>
  </>
}

function DiscreteIoRows({ m }: { m: Extract<AnyModule, { type: 'DI' | 'DO' }> }): JSX.Element {
  const hardware = useStore(s => s.hardware)
  const bind = useStore(s => s.bindDiscreteDst)
  const setMode = useStore(s => s.setDiscreteMode)
  const configureAlarm = useStore(s => s.configureDiscreteAlarm)
  const choices = traditionalChannels(hardware).filter(item => item.card.type === m.type && item.channel.dst)
  const selected = hardware.discreteBindings?.[m.tag] ?? ''
  const alarm = m.alarms.find(item => item.type === 'HI')
  return <>
    <tr><td>{m.type === 'DI' ? 'IO_IN' : 'IO_OUT'}</td><td>
      <select aria-label={`${m.tag} ${m.type === 'DI' ? 'IO_IN' : 'IO_OUT'}`} value={selected}
        onChange={e => bind(m.tag, e.target.value)}>
        <option value="">(none — local simulation)</option>
        {selected && !choices.some(item => item.channel.dst === selected) &&
          <option value={selected}>Missing DST: {selected}</option>}
        {choices.map(item => <option key={item.channel.dst} value={item.channel.dst}>
          {item.channel.dst} ({item.card.id} CH{item.channel.channel})
        </option>)}
      </select>
    </td><td>{selected ? m.ioBad ? 'Bad' : 'Bound' : 'Local'}</td></tr>
    <tr><td>MODE.TARGET</td><td><select aria-label={`${m.tag} discrete mode`}
      value={m.mode ?? 'AUTO'} onChange={e => setMode(m.tag, e.target.value === 'OOS' ? 'OOS' : 'AUTO')}>
      <option>AUTO</option><option>OOS</option>
    </select></td><td>{m.ioBad ? 'Bad' : 'Good'}</td></tr>
    {m.type === 'DI' && <>
      <tr><td>DISCRETE_ALM.ON VALUE</td><td><select aria-label={`${m.tag} alarm on value`}
        value={Number(m.alarmOnValue ?? true)} onChange={e =>
          configureAlarm(m.tag, e.target.value === '1', alarm?.enabled ?? false)}>
        <option value={0}>0</option><option value={1}>1</option>
      </select></td><td>Configured</td></tr>
      <tr><td>DISCRETE_ALM.ENAB</td><td><input type="checkbox"
        aria-label={`${m.tag} discrete alarm enabled`} checked={alarm?.enabled ?? false}
        onChange={e => configureAlarm(m.tag, m.alarmOnValue ?? true, e.target.checked)} /></td><td>Configured</td></tr>
    </>}
  </>
}

function StandaloneAoRows({ m }: { m: AnalogOutputModule }): JSX.Element {
  const record = useStore(s => s.moduleLifecycle[m.tag])
  return <>
    <ModuleLifecycleRows tag={m.tag} />
    <AnalogDstRow tag={m.tag} port="output" bad={m.bad} />
    <StandaloneAoControls module={m} offline={!!record && !record.online} configuration={!record || !record.online} />
  </>
}

function AnalogDstRow({ tag, port, bad }: {
  tag: string; port: AnalogBindingPort; bad: boolean
}): JSX.Element {
  const hardware = useStore(s => s.hardware)
  const bind = useStore(s => s.bindAnalogDst)
  const record = useStore(s => s.moduleLifecycle[tag])
  const input = port === 'input'
  const label = input ? 'IO_IN' : port === 'output2' ? 'AO2.IO_OUT' : 'IO_OUT'
  const pidRecord = useStore(s => s.pidLifecycle[tag])
  const choices = traditionalChannels(hardware).filter(item =>
    item.card.type === (input ? 'AI' : 'AO') && item.channel.dst)
  const selected = record && !record.online ? record.draft.outputDst :
    pidRecord && !pidRecord.online ? port === 'input' ? pidRecord.draft.inputDst : pidRecord.draft.outputDst :
      hardware.analogBindings?.[tag]?.[port] ?? ''
  return <tr><td>{label}</td><td><select aria-label={`${tag} ${label}`} value={selected} disabled={!!record?.online}
    onChange={e => bind(tag, port, e.target.value)}>
    <option value="">(none - local simulation)</option>
    {selected && !choices.some(item => item.channel.dst === selected) &&
      <option value={selected}>Missing DST: {selected}</option>}
    {choices.map(item => <option key={item.channel.dst} value={item.channel.dst}>
      {item.channel.dst} ({item.card.id} CH{item.channel.channel})
    </option>)}
  </select></td><td>{record && !record.online ? 'Offline configuration' :
    selected ? bad ? 'Bad' : input ? 'Engineering signal' : 'Percent output' : 'Local'}</td></tr>
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
      <AnalogDstRow tag={m.tag} port="input" bad={io.ai.bad} />
      <AnalogDstRow tag={m.tag} port="output" bad={io.ao.bad} />
      {io.ao2 && <AnalogDstRow tag={m.tag} port="output2" bad={io.ao2.bad} />}
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
      <AnalogDstRow tag={m.tag} port={input ? 'input' : second ? 'output2' : 'output'} bad={stage.bad} />
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

function ConditionExpressionEditor({ m, onApply }: {
  m: FunctionBlockModule; onApply: (expression: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(m.expr)
  useEffect(() => setDraft(m.expr), [m.tag, m.expr])
  return <span className="condition-expr-editor">
    <input className="fb-exprinput" aria-label={`${m.tag} condition expression`} type="text"
      value={draft} onChange={e => setDraft(e.target.value)} />
    <button className="studio-param-btn" aria-label="Apply Condition Expression"
      onClick={() => onApply(draft)}>Apply</button>
    {draft !== m.expr && <small className="condition-draft-notice">Unapplied draft. Executing: {m.expr}</small>}
  </span>
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
  const setSafety = useStore(s => s.setFbSafety)
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
            {field === 'CND' ? <ConditionExpressionEditor m={m}
              onApply={expr => setFbConfig(m.tag, { expr })} /> :
              <input className="fb-exprinput" type="text" value={m.expr}
                onChange={e => setFbConfig(m.tag, { expr: e.target.value })} />}
          </td>
          <td className={m.bad ? 'bad' : 'good'}>{m.expressionError ?? (m.bad ? 'Bad' : 'Good')}</td>
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
      {field === 'CND' && <tr><td>TIME_ELAPSED (s)</td><td>{fmt(m._timerElapsed, 3)}</td>
        <td className={m.bad ? 'bad' : 'good'}>{m.bad ? 'Bad - timing reset' : 'Continuous true time'}</td></tr>}
      {field === 'CND' && <tr><td>BYPASS</td><td>
        <button className="studio-param-btn" aria-label={`${m.tag} bypass`}
          onClick={() => setSafety(m.tag, 'BYPASS', !m.bypass)}>{m.bypass ? 'BYPASSED - remove bypass' : 'Not bypassed'}</button>
      </td><td>{m.bypass ? 'Condition inhibited; quality still applies' : 'Condition active'}</td></tr>}
      {field === 'BFI' && <>
        <tr><td>ARM_TRAP</td><td><button className="studio-param-btn" aria-label={`${m.tag} arm trap`}
          onClick={() => setSafety(m.tag, 'ARM_TRAP', !m.armTrap)}>{m.armTrap ? 'Armed' : 'Disarmed'}</button></td><td>First-out capture</td></tr>
        <tr><td>RESET_IN</td><td><button className="studio-param-btn" aria-label={`${m.tag} reset first out`}
          onClick={() => setSafety(m.tag, 'RESET_IN', true)}>Reset first out</button></td><td>Rearms after all inputs clear</td></tr>
        <tr><td>FIRST_OUT</td><td>{m.firstOut ?? 0}</td><td className={m.firstOutBad ? 'bad' : 'good'}>{m.firstOutBad ? 'Bad' : 'Good'}</td></tr>
        <tr><td>OUT_D</td><td>{Number(!!m.outDiscrete)}</td><td className={m.bad ? 'bad' : 'good'}>{m.bad ? 'Bad' : 'Good'}</td></tr>
      </>}
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
  const runtimeModules = useStore(s => s.modules)
  const deviceRecords = useStore(s => s.deviceLifecycle)
  const modules = useMemo(() => deviceEditorModules(runtimeModules, deviceRecords), [runtimeModules, deviceRecords])
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
    } else if (source?.type === 'FB' && (source.fbType === 'CND' || source.fbType === 'BFI')) {
      const parameters: AnalogSignalRef['parameter'][] = source.fbType === 'CND' ? ['BYPASS'] :
        ['OUT_D', 'OUT_INT', 'FIRST_OUT']
      for (const parameter of parameters) choices.push({
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
 * logic/alarm tag's live boolean output to interlock, permissive or command
 * on a MOTOR/VALVE, so an OR/latch/comparator block can automatically trip,
 * close, or open real equipment every scan \u2014 not just display a number. */
function DeviceWiringRows({
  m,
  tags,
  setInterlockSource,
  setPermissiveSource,
  setCommandSource
}: {
  m: MotorModule | ValveModule
  tags: string[]
  setInterlockSource: (tag: string, source: string | undefined) => void
  setPermissiveSource: (tag: string, source: string | undefined) => boolean
  setCommandSource: (tag: string, source: string | undefined) => void
}): JSX.Element {
  const modules = useStore(s => s.modules)
  const signal = devicePermissiveSignal(m, modules)
  const interlock = deviceInterlockSignal(m, modules)
  return (
    <>
      <tr>
        <td>PERMISSIVE_SOURCE</td>
        <td className="pv">
          <select className="fb-select" aria-label="Permissive source" value={m.permissiveSource ?? ''}
            onChange={e => setPermissiveSource(m.tag, e.target.value || undefined)}>
            <option value="">(manual; disconnect clears permit)</option>
            {m.permissiveSource && !tags.includes(m.permissiveSource) &&
              <option value={m.permissiveSource}>{m.permissiveSource} (missing)</option>}
            {tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </td>
        <td className={signal.bad ? 'bad' : 'good'}>
          {signal.bad ? 'Bad - denied' : signal.value !== 0 ? 'Good - permitted' : 'Good - denied'}
        </td>
      </tr>
      <tr>
        <td>INTERLOCK_SOURCE</td>
        <td className="pv">
          <select className="fb-select" aria-label="Interlock source" value={m.interlockSource ?? ''} onChange={(e) => setInterlockSource(m.tag, e.target.value || undefined)}>
            <option value="">(manual only)</option>
            {m.interlockSource && !tags.includes(m.interlockSource) &&
              <option value={m.interlockSource}>{m.interlockSource} (missing)</option>}
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className={interlock.bad ? 'bad' : 'good'}>{interlock.bad ? 'Bad - tripped' :
          interlock.value !== 0 ? 'Good - tripped' : 'Good - clear'}</td>
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
  const current = Number.isFinite(value) ? value : 0
  return (
    <span className="fb-stepper">
      <button onClick={() => onChange(current - step)}>−</button>
      <input
        className="fb-numinput"
        type="number"
        value={Number(current.toFixed(decimals))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button onClick={() => onChange(current + step)}>+</button>
    </span>
  )
}

interface PaletteItem {
  label: string
  create: { type: 'PID' | 'AI' | 'AO' | 'DI' | 'DO' } | { type: 'FB'; fbType: FbBlockType }
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
      { label: 'AO', create: { type: 'AO' } },
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
  const sfcs = useStore(s => s.sfcs)
  const openStudio = useUi((s) => s.openStudio)
  const [pending, setPending] = useState<PaletteItem | null>(null)
  const [tag, setTag] = useState('')
  const normTag = tag.trim().toUpperCase()
  const nameError = moduleNameError(normTag)
  const exists = normTag.length > 0 && !!(modules[normTag] || sfcs[normTag])

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

type StudioPane = 'hierarchy' | 'parameters' | 'palette' | 'alarms'
const PARAMETER_FOR: Record<string, string> = { PVBAD: 'PV.STATUS', FAIL: 'FAILURE', INTERLOCK: 'INTERLOCK_D' }

export function AlarmView({ module: m }: { module: AnyModule }): JSX.Element {
  const active = useStore(s => s.alarms)
  const owner = m.tag.split('/')[0]
  const alarms = 'alarms' in m ? m.alarms : []
  return (
    <div className="studio-pane studio-alarms">
      <div className="studio-alarm-scroll">
        <table className="studio-param-table" aria-label={`${m.tag} alarm view`}>
          <thead><tr>
            <th>Alarm</th><th>Word</th><th>State</th><th>Parameter</th><th>Limit Value</th><th>Enabled</th>
            <th>Invert</th><th>Priority</th><th>Functional Class</th><th>Alarm Description</th>
          </tr></thead>
          <tbody>
            {alarms.length === 0 && <tr><td colSpan={10}>No alarms are defined for this module.</td></tr>}
            {alarms.map((alarm) => {
              const live = active.find((a) => a.moduleTag === owner && a.type === alarm.type && a.active)
              return <tr key={`${alarm.type}-${alarm.label}`}>
                <td>{alarm.label}</td><td>{alarm.type}</td><td>{live ? 'Active' : 'Normal'}</td>
                <td>{PARAMETER_FOR[alarm.type] ?? (m.type === 'PID' || m.type === 'AI' ? 'PV' : alarm.type)}</td>
                <td>{alarm.limit !== undefined ? alarm.limit : '-'}</td><td>{alarm.enabled ? 'True' : 'False'}</td>
                <td>False</td><td>{alarm.priority}</td><td>Not classified</td><td>{alarm.label}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="studio-pane-label">Alarm View — {m.tag}</div>
    </div>
  )
}

interface BtnProps {
  glyph: GlyphName; label: string; size?: 'large' | 'small' | 'tiny'; active?: boolean
  onClick?: () => void; unavailable?: string
}

function Btn({ glyph, label, size = 'large', active, onClick, unavailable }: BtnProps): JSX.Element {
  return (
    <button type="button" className={`rb-btn rb-${size}` + (active ? ' active' : '')} onClick={onClick} disabled={!!unavailable}
      title={unavailable ?? label} aria-label={label} aria-pressed={active === undefined ? undefined : active}>
      <RibbonGlyph name={glyph} size={size === 'large' ? 34 : 16} />
      {size !== 'tiny' && <span className="rb-label">{label}</span>}
    </button>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rb-group">
      <div className="rb-group-body">{children}</div>
      <div className="rb-group-label">{label}</div>
    </div>
  )
}

function Stack({ children }: { children: ReactNode }): JSX.Element {
  return <div className="rb-stack">{children}</div>
}

function StudioRibbon({ tag, onNew, onFaceplate, zoom, onZoom, panes, onToggle }: {
  onNew: () => void
  tag: string; onFaceplate: () => void; zoom: number; onZoom: (value: number) => void
  panes: Record<StudioPane, boolean>; onToggle: (pane: StudioPane) => void
}): JSX.Element {
  const [tab, setTab] = useState('Home')
  const [showDownload, setShowDownload] = useState(false)
  const [showPidTransfer, setShowPidTransfer] = useState(false)
  const record = useStore(s => s.moduleLifecycle[tag])
  const pidRecord = useStore(s => s.pidLifecycle[tag])
  const ownerTag = tag.split('/')[0]
  const deviceRecord = useStore(s => s.deviceLifecycle[ownerTag])
  const deviceSave = useStore(s => s.saveDeviceConfiguration)
  const savePid = useStore(s => s.savePidConfiguration)
  const downloadPid = useStore(s => s.downloadPidModule)
  const lifecycle = deviceRecord ?? record ?? pidRecord
  const save = useStore(s => s.saveModuleConfiguration)
  const setDeviceOnline = useStore(s => s.setDeviceOnline)
  const setModuleOnline = useStore(s => s.setModuleOnline)
  const setPidOnline = useStore(s => s.setPidLifecycleOnline)
  const focusExplorer = useUi((s) => s.focusExplorer)
  const focusAlarms = useUi((s) => s.focusAlarms)
  const focusTrend = useUi((s) => s.focusTrend)
  const navigate = useUi((s) => s.navigate)
  const openStudio = useUi((s) => s.openStudio)
  const module = useStore((s) => s.modules[tag])
  const trendAvailable = module?.type === 'PID' || module?.type === 'AI'
  const pidTemplate = module?.type === 'PID' && module.templateId === 'PID_LOOP'
  const pidTuningChanges = changedPidTuningParameters(pidRecord?.saved,
    module?.type === 'PID' ? module : undefined)
  const pidDownloadUnavailable = pidRecord?.online ? 'Go Offline before downloading the PID_LOOP' :
    pidRecord && pidLifecycleDirty(pidRecord) ? 'Save the PID_LOOP configuration before downloading' : undefined
  const firstNested = module?.type === 'MOTOR' && module.ownedBlocks ? Object.values(module.ownedBlocks)[0] : undefined
  const setOnline = (online: boolean): void => {
    if (deviceRecord) setDeviceOnline(ownerTag, online)
    else if (pidRecord) setPidOnline(tag, online)
    else if (record) setModuleOnline(tag, online)
  }
  const licensed = (name: string): string => `${name} is an optional licensed DeltaV application and is not included in this simulator`
  const downloadAction = (): void => {
    if (pidRecord) {
      if (pidTuningChanges.length) setShowPidTransfer(true)
      else if (window.confirm('Full-download this saved PID_LOOP to its assigned simulated controller?')) downloadPid(tag)
    } else setShowDownload(true)
  }
  const downloadUnavailable = pidRecord ? pidDownloadUnavailable : lifecycle ? undefined : pidTemplate ? 'Enable Saved PID_LOOP Lifecycle first' :
    'Enable Saved Module Lifecycle or Saved Device Lifecycle first'
  const saveAction = lifecycle ? () => pidRecord ? savePid(tag) : deviceRecord ? deviceSave(ownerTag) : save(tag) : undefined
  const saveUnavailable = !lifecycle ? 'Enable a saved lifecycle first' : lifecycle.online ? 'Go Offline before saving configuration' : undefined
  const noClipboard = 'Block clipboard operations are not implemented'
  const tinyNote = 'This command is not implemented in the simulator'
  return (
    <div className="ribbon">
      <div className="studio-caption"><ModuleIcon kind="control" size={16} /><span>{tag} — Control Studio{lifecycle?.online ? ' (Read-Only)' : ''}</span><span className="studio-caption-status">{lifecycle ? lifecycle.online ? 'ONLINE - controller runtime' : 'OFFLINE - configuration draft' : 'ONLINE · simulated configuration'}</span><DownloadStatusIndicator tag={deviceRecord ? ownerTag : tag} controls /></div>
      <div className="ribbon-tabs">
        <div className="rb-quick" role="toolbar" aria-label="Quick access">
          <Btn glyph="save" label="Save" size="tiny" onClick={saveAction} unavailable={saveUnavailable} />
          <Btn glyph="undo" label="Undo" size="tiny" unavailable="Undo is not implemented" />
          <Btn glyph="redo" label="Redo" size="tiny" unavailable="Redo is not implemented" />
        </div>
        {RIBBON_TABS.map((t) => (
          <button key={t} type="button" className={'ribbon-tab' + (t === 'File' ? ' file' : t === tab ? ' active' : '')}
            title={`${t} commands`}
            aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <span className="ribbon-title">{Math.round(zoom * 100)}%</span>
      </div>
      <div className="ribbon-body rb-body">
        {tab === 'File' && <Group label="Create">
          <Btn glyph="new" label="New..." onClick={onNew} />
        </Group>}
        {tab === 'Home' && <>
          <Group label="Clipboard">
            <Btn glyph="paste" label="Paste" unavailable={noClipboard} />
            <Stack>
              <Btn glyph="cut" label="Cut" size="small" unavailable={noClipboard} />
              <Btn glyph="copy" label="Copy" size="small" unavailable={noClipboard} />
            </Stack>
          </Group>
          <Group label="Module">
            <Btn glyph="download" label="Download" onClick={downloadAction} unavailable={downloadUnavailable} />
            <Btn glyph="assign" label="Assign To Node" onClick={() => setShowDownload(true)}
              unavailable={pidRecord ? 'Assign the PID_LOOP controller in its lifecycle controls' : lifecycle ? undefined :
                'Enable a saved lifecycle first; the controller is chosen in the Download dialog'} />
            <Stack>
              <Btn glyph="collection" label="History Collection" size="small" unavailable="Per-parameter history collection setup is not implemented; PID and AI values are collected automatically" />
              <Btn glyph="recorder" label="History Recorder" size="small" onClick={trendAvailable ? () => focusTrend(tag) : undefined}
                unavailable={trendAvailable ? undefined : 'Historian pens are available for PID and AI modules'} />
              <Btn glyph="properties" label="Properties" size="small" onClick={() => focusExplorer(ownerTag)} />
            </Stack>
          </Group>
          <Group label="Insert">
            <Btn glyph="moduleParameter" label="Module Parameter" unavailable="Adding module-level parameters is not implemented; the standard interface (SP_D, MODE, PV_D, PV_STATE) is shown in the module diagram" />
            <Stack>
              <Btn glyph="custom" label="Custom" size="small" unavailable="Custom diagram objects are not implemented" />
              <Btn glyph="textBox" label="Text Box" size="small" unavailable="Diagram text boxes are not implemented" />
              <Btn glyph="stateItem" label="State Item" size="small" unavailable="State items are not implemented" />
            </Stack>
            <Stack>
              <Btn glyph="generic" label="Insert options" size="tiny" unavailable={tinyNote} />
              <Btn glyph="generic" label="Insert options" size="tiny" unavailable={tinyNote} />
              <Btn glyph="generic" label="Insert options" size="tiny" unavailable={tinyNote} />
            </Stack>
          </Group>
          <Group label="Alarms">
            <Btn glyph="alarm" label="Alarm" onClick={() => focusAlarms(tag)} />
            <Btn glyph="alarmGroups" label="Alarm Groups Configuration" unavailable="Alarm groups are not modeled" />
            <Btn glyph="alarmGroupRefs" label="Alarm Groups Assignment References" unavailable="Alarm group assignments and references are not modeled" />
          </Group>
          <Group label="Algorithm">
            <Btn glyph="editObject" label="Edit Object" onClick={onFaceplate} />
            <Btn glyph="drillDown" label="Drill Down" onClick={firstNested ? () => openStudio(firstNested.tag) : undefined}
              unavailable={firstNested ? undefined : 'This module has no nested block level to drill into'} />
            <Btn glyph="backOut" label="Back Out" onClick={tag.includes('/') ? () => openStudio(ownerTag) : undefined}
              unavailable={tag.includes('/') ? undefined : 'Already at the module level'} />
          </Group>
          <Group label="Diagram Mode">
            <Btn glyph="onlineDebug" label="On-Line Debug" active={!lifecycle || lifecycle.online}
              onClick={lifecycle && !lifecycle.online ? () => setOnline(true) : undefined} />
            <Btn glyph="edit" label="Edit" active={!!lifecycle && !lifecycle.online}
              onClick={lifecycle?.online ? () => setOnline(false) : undefined}
              unavailable={lifecycle ? undefined : 'Enable a saved lifecycle to edit an offline configuration draft separately from the running module'} />
          </Group>
          <Group label="Class">
            <Stack>
              <Btn glyph="configure" label="Configure" size="small" unavailable="Module classes and library templates are not implemented" />
              <Btn glyph="namedSet" label="Named Set" size="small" onClick={() => navigate('explorer')} />
            </Stack>
          </Group>
          <Group label="Advanced">
            <Stack>
              <Btn glyph="tune" label="Tune with Insight" size="small" unavailable={licensed('Tune with InSight') + '; PID tuning is on the faceplate'} />
              <Btn glyph="predict" label="Predict" size="small" unavailable={licensed('Predict and PredictPro')} />
              <Btn glyph="neural" label="Neural" size="small" unavailable={licensed('Neural')} />
            </Stack>
          </Group>
          <Group label="Version Control">
            <Btn glyph="checkOut" label="Check Out" unavailable="Configuration Audit Trail (Version Control) is an optional licensed feature; configuration changes are recorded in the Event Journal" />
            <Stack>
              <Btn glyph="checkIn" label="Check In" size="tiny" unavailable={tinyNote} />
              <Btn glyph="undoCheckOut" label="Undo Check Out" size="tiny" unavailable={tinyNote} />
            </Stack>
          </Group>
        </>}
        {tab === 'View' && <Group label="Windows">
          <Btn glyph="hierarchy" label="Hierarchy" active={panes.hierarchy} onClick={() => onToggle('hierarchy')} />
          <Btn glyph="parameters" label="Parameters" active={panes.parameters} onClick={() => onToggle('parameters')} />
          <Btn glyph="palette" label="Palette" active={panes.palette} onClick={() => onToggle('palette')} />
          <Btn glyph="alarm" label="Alarm View" active={panes.alarms} onClick={() => onToggle('alarms')} />
        </Group>}
        {(tab === 'Diagram' || tab === 'View') && <Group label="Zoom">
          <Btn glyph="zoomIn" label="Zoom In" onClick={() => onZoom(zoom + 0.1)} unavailable={zoom >= 1.5 ? 'Maximum zoom is 150%' : undefined} />
          <Btn glyph="zoomOut" label="Zoom Out" onClick={() => onZoom(zoom - 0.1)} unavailable={zoom <= 0.5 ? 'Minimum zoom is 50%' : undefined} />
          <Btn glyph="reset" label="100%" onClick={() => onZoom(1)} />
        </Group>}
      </div>
      {showDownload && (deviceRecord ? <DeviceDownloadDialog tag={ownerTag} onClose={() => setShowDownload(false)} /> :
        <ModuleDownloadDialog tag={tag} onClose={() => setShowDownload(false)} />)}
      {showPidTransfer && <PidTransferDialog tag={tag} mode="DOWNLOAD" onClose={() => setShowPidTransfer(false)} />}
    </div>
  )
}
