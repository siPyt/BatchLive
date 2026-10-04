import { create } from 'zustand'
import type {
  PlantState,
  ControlMode,
  PidModule,
  MotorModule,
  ValveModule,
  DiscreteOutput,
  TrendPoint,
  AnyModule,
  AlarmType,
  AlarmPriority,
  EventLogEntry,
  EventCategory,
  FbInputRef,
  FbCompareOp,
  FbBlockType,
  PidIoPatch,
  SplitterPatch,
  AnalogSignalRef,
  AnalogOutputModule,
  AnalogOutputPatch
} from './types'
import { buildInitialPlant, buildBlankPlant, makeModule, type NewModuleSpec } from './plant'
import { stepPlant } from './simulate'
import { clonePidIo, configurePidIo, pidIoPatchError, signalError } from './analogStrategy'
import { aoConfigurationError, aoEngineeringValue } from './standaloneAo'
import {
  aoOperatorError, cloneAo, cloneConfiguration, configurationError, deployedAo, downloadError, lifecycleDirty,
  memoryOf, parseSavedAo, restartAo, savedAoStorageKey, serializeSavedAo, withProjectMembership,
  type AoDraftPatch, type AoLifecycle
} from './moduleLifecycle'
import { configureSplitter, createSplitter } from './splitter'
import { areaNameError } from './areas'
import { moduleNameError } from './naming'
import {
  analogBindingError, channelConfigurationError, discreteBindingError, findDst, makeTraditionalCard,
  type AnalogBindingPort, type TraditionalCardType
} from './traditionalIo'
import { advanceBatch, commandBatch, makeBatch, makeDefaultPhases, PROCEDURE, type BatchRuntime, type BatchCommand, type PhaseDef } from './batch'
import { advanceSfcs, resetSfcBooleanActions, sfcStepsError, makeSampleSfc, makeAutoclaveSfc, makeLyoSfc, makeCipSfc, type SfcDef, type SfcStep } from './sfc'
import { cloneSfcBlocks, reconcileSfcAlarms, sfcBlockConfigurationError, type SfcBlockConfiguration } from './sfcBlocks'
import { useSecurity } from './security'
import {
  cloneSfcParameters, controllerNamedSets, sfcParameterError, type SfcExpressionContext, type SfcParameter
} from './sfcParameters'
import {
  cloneSfcConfiguration, parseSavedSfc, savedSfcKey, serializeSavedSfc,
  sfcConfigurationError, sfcDraftDirty, sfcEditorDefinition, type SfcLifecycle, type SfcConfiguration
} from './sfcLifecycle'
import {
  NAMED_SETS_STORAGE_KEY, changedNamedSets, cloneNamedSet, namedSetError, namedSetTargetKey,
  parseNamedSets, serializeNamedSets, type NamedSetState, type NamedSetDefinition, type NamedSetTarget
} from './namedSets'
import { makeDefaultEquipment, makeBlankEquipment, type EquipmentModule } from './equipment'
import {
  makeDefaultHardware,
  makeBlankHardware,
  allocateControlNetworkAddress,
  controllerIsDown,
  isValidControllerTag,
  MAX_COLD_RESTART_MINUTES,
  MAX_CONTROLLER_DESCRIPTION_LENGTH,
  scanControllerIo,
  type ControllerConfiguration,
  type HardwareState
} from './hardware'

const TREND_SECONDS = 600 // 10 minutes of history
const TREND_HZ = 2

const EVENT_LOG_MAX = 2000

function requireUnlockedLock(lock: 'CAN_CONFIGURE' | 'CAN_DOWNLOAD' | 'BATCH_OPERATE' | 'CONTROL', action: string): boolean {
  if (useSecurity.getState().locked) {
    useSecurity.setState({ lastDenied: `Access Denied — ${action} requires an unlocked workstation` })
    return false
  }

  return useSecurity.getState().requireLock(lock, action)
}

function rejectSfc(get: () => StoreState, name: string, message: string): false {
  get().logEvent('DIAGNOSTIC', name, message)
  window.alert(message)
  return false
}

export function sfcExpressionContext(state: StoreState, name: string, online = false): SfcExpressionContext {
  const configuration = online ? state.sfcLifecycle[name]?.deployed : state.sfcLifecycle[name]?.draft
  return { name, parameters: (online ? state.sfcs[name]?.parameters : (configuration ?? state.sfcs[name])?.parameters) ?? {},
    blocks: online ? state.sfcs[name]?.blocks : (configuration ?? state.sfcs[name])?.blocks,
    sets: online ? controllerNamedSets(state.namedSets, configuration?.controllerTag ?? '') : state.namedSets.configured }
}

interface StoreState extends PlantState {
  trend: TrendPoint[]
  rev: number
  /** Alarm & Event Journal: 21 CFR Part 11 style audit trail of alarms + operator actions. */
  eventLog: EventLogEntry[]
  logEvent: (category: EventCategory, tag: string, description: string, priority?: AlarmPriority) => void
  batch: BatchRuntime
  /** Horn Silence: mutes audible alarm tone without acknowledging (F8). */
  hornSilenced: boolean
  silenceHorn: () => void
  /** Editable phase logic (SFC per phase), keyed by phase name. */
  phases: Record<string, PhaseDef>
  sfcs: Record<string, SfcDef>
  /** Equipment Modules (ISA-88 physical hierarchy), keyed by tag. */
  equipment: Record<string, EquipmentModule>
  /** Physical Network: Controllers / I/O Carriers / CHARM baseplates. */
  hardware: HardwareState
  moduleLifecycle: Record<string, AoLifecycle>
  namedSets: NamedSetState
  sfcLifecycle: Record<string, SfcLifecycle>
  enableSfcLifecycle: (name: string) => boolean
  configureSfcController: (name: string, controllerTag: string, expected?: SfcConfiguration) => boolean
  saveSfc: (name: string) => boolean
  loadSavedSfc: (name: string) => boolean
  downloadSavedSfc: (name: string, expected?: SfcConfiguration) => boolean
  setSfcOnline: (name: string, online: boolean) => boolean
  configureSfcParameter: (name: string, parameter: string, binding: SfcParameter, expected: SfcConfiguration) => boolean
  configureSfcBlocks: (name: string, configuration: SfcBlockConfiguration, expected: SfcConfiguration) => boolean
  writeSfcNamedValue: (name: string, parameter: string, value: number) => boolean
  createNamedSet: (name: string) => boolean
  applyNamedSetProperties: (expected: NamedSetDefinition, draft: NamedSetDefinition) => boolean
  loadSavedNamedSets: () => boolean
  downloadChangedNamedSets: (target: NamedSetTarget) => boolean
  enableModuleLifecycle: (tag: string) => boolean
  setModuleOnline: (tag: string, online: boolean) => boolean
  editModuleDraft: (tag: string, patch: AoDraftPatch) => boolean
  saveModuleConfiguration: (tag: string) => boolean
  loadSavedModuleConfiguration: (tag: string) => boolean
  downloadModule: (tag: string, scope: 'FULL' | 'PARTIAL') => boolean
  uploadModule: (tag: string) => boolean
  restartModule: (tag: string) => boolean
  addTraditionalCard: (controllerTag: string, slot: number, type: TraditionalCardType) => boolean
  configureTraditionalChannel: (cardId: string, channel: number,
    patch: { dst: string; enabled: boolean; tiebackDst?: string }) => boolean
  setTraditionalInput: (dst: string, value: number) => boolean
  configureInputFilter: (cardId: string, channel: number, seconds: number) => boolean
  downloadInputFilters: (cardId: string) => boolean
  bindDiscreteDst: (tag: string, dst: string) => boolean
  bindAnalogDst: (tag: string, port: AnalogBindingPort, dst: string) => boolean
  configureStandaloneAo: (tag: string, patch: AnalogOutputPatch) => boolean
  setStandaloneAoMode: (tag: string, mode: AnalogOutputModule['mode']) => boolean
  setStandaloneAoValue: (tag: string, value: number) => boolean
  addAoParameter: (tag: string, name: string, value: number) => boolean
  setAoParameter: (tag: string, name: string, value: number) => boolean
  connectAoParameter: (tag: string, name?: string) => boolean
  setDiscreteMode: (tag: string, mode: 'AUTO' | 'OOS') => boolean
  configureDiscreteAlarm: (tag: string, onValue: boolean, enabled: boolean) => boolean
  // operator actions
  setMode: (tag: string, mode: ControlMode) => void
  setSetpoint: (tag: string, sp: number) => void
  setOutput: (tag: string, out: number) => void
  setTuning: (tag: string, t: { gain?: number; reset?: number; rate?: number }) => void
  /** Wire or clear a PID's cascade remote-SP source (CAS_SOURCE) — any tag, any PID, not just a hardcoded pair. */
  setCasSource: (tag: string, source: string | undefined) => void
  /** Configure feedforward (FF_ENABLE/FF_GAIN/FF_VAL source) on any PID. */
  setFeedforward: (tag: string, patch: { enable?: boolean; gain?: number; source?: string }) => void
  /** Configure tracking (TRK_IN_D trigger tag + TRK_VAL source/constant) on any PID. */
  setTracking: (tag: string, patch: { enable?: boolean; source?: string; valueSource?: string; value?: number }) => void
  setPidIo: (tag: string, patch: PidIoPatch) => boolean
  setSplitterConfig: (tag: string, patch: SplitterPatch & {
    feedback1Source?: AnalogSignalRef; feedback2Source?: AnalogSignalRef
  }) => boolean
  /** Wire a function block's IN1/IN2 to a constant value or another module's live value. */
  setFbInput: (tag: string, which: 'in1' | 'in2', ref: FbInputRef) => void
  /** Edit a function block's type-specific configuration (gain/bias/cmpOp/expr/delaySec/tripValue/countUp). */
  setFbConfig: (
    tag: string,
    patch: Partial<{ gain: number; bias: number; cmpOp: FbCompareOp; expr: string; delaySec: number; tripValue: number; countUp: boolean }>
  ) => void
  setAlarmLimit: (
    tag: string,
    type: AlarmType,
    patch: { limit?: number; enabled?: boolean; priority?: AlarmPriority }
  ) => void
  startMotor: (tag: string) => void
  stopMotor: (tag: string) => void
  openValve: (tag: string) => void
  closeValve: (tag: string) => void
  toggleDO: (tag: string) => void
  toggleInterlock: (tag: string) => void
  injectFault: (tag: string) => void
  /** RESET_D: clears a Locked DC_STATE after a trip (Reset Required device option). */
  resetDevice: (tag: string) => void
  /** PERMISSIVE_D: simulated external permit condition for Motor/Valve modules. */
  setPermissive: (tag: string, ok: boolean) => void
  /** Device options: Permissive / Reset Required, as configured in Control Studio. */
  setDeviceOptions: (tag: string, opts: { permissiveRequired?: boolean; resetRequired?: boolean }) => void
  /** Wire a logic/alarm tag to automatically drive a MOTOR/VALVE's INTERLOCK_D every scan (the missing link between an FB trip and real equipment). */
  setInterlockSource: (tag: string, source: string | undefined) => void
  /** Wire a logic/alarm tag to automatically drive a MOTOR/VALVE's SP_D (commanded) every scan, overriding manual Start/Stop or Open/Close. */
  setCommandSource: (tag: string, source: string | undefined) => void
  /** CAS_IN_D connection health; false sheds a Cas/RCas PID to Auto. */
  setCasHealthy: (tag: string, healthy: boolean) => void
  /** Fail a controller leg (primary, or both legs if not redundant) — bound I/O goes Bad. */
  failController: (tag: string) => boolean
  restoreController: (tag: string) => boolean
  createController: (tag: string, description: string) => boolean
  setControllerConfiguration: (tag: string, patch: Partial<ControllerConfiguration>) => boolean
  commissionController: (tag: string) => boolean
  decommissionController: (tag: string) => boolean
  identifyController: (tag: string, identifying: boolean) => boolean
  autoSenseController: (tag: string) => boolean
  simulateControllerPowerLoss: (tag: string) => boolean
  restoreControllerPower: (tag: string) => boolean
  /** Simulate a loose/removed CHARM on a baseplate channel. */
  pullCharm: (baseplateId: string, slot: number) => void
  reinsertCharm: (baseplateId: string, slot: number) => void
  ackAlarm: (id: string) => void
  ackAll: () => void
  /** ISA-18.2 Shelving: suppress an alarm from the active view for durationMin minutes. */
  shelveAlarm: (id: string, durationMin: number) => void
  unshelveAlarm: (id: string) => void
  setRunning: (r: boolean) => void
  setSpeed: (s: number) => void
  tick: (dt: number) => void
  batchCommand: (cmd: BatchCommand) => void
  /** Edit a phase's logic (requires Can Configure), mirroring setSfcSteps. */
  setPhaseSteps: (phaseName: string, steps: SfcStep[]) => void
  createModule: (spec: NewModuleSpec) => boolean
  createArea: (name: string) => boolean
  renameArea: (name: string, nextName: string) => boolean
  deleteModule: (tag: string) => void
  createEquipmentModule: (tag: string, description: string, area: string) => void
  deleteEquipmentModule: (tag: string) => void
  /** Assign (or clear, with null) a Control Module's Equipment Module. */
  setModuleEquipment: (moduleTag: string, emTag: string | null) => void
  createSfc: (name: string, area: string, options?: { managed: boolean }) => boolean
  deleteSfc: (name: string) => void
  setSfcSteps: (name: string, steps: SfcStep[]) => void
  checkSfc: (name: string) => string | null
  applySfcStepProperties: (name: string, expected: SfcStep, patch: Partial<SfcStep>,
    related?: { expected: SfcStep; patch: Partial<SfcStep> }[]) => boolean
  sfcCommand: (name: string, cmd: 'run' | 'hold' | 'reset') => void
  /** File > New: reload either the GMP Pharma Factory baseline or a blank project. */
  newProject: (kind: 'pharma' | 'blank') => void
}

const initial = buildInitialPlant()

/** Seeds every built-in SFC: reactor startup, both autoclaves, both lyos, all 3 CIP skids. */
function makeDefaultSfcs(): Record<string, SfcDef> {
  return {
    'STARTUP-T101': makeSampleSfc(),
    'STERILIZE-AC1': makeAutoclaveSfc(),
    'STERILIZE-AC2': makeAutoclaveSfc({ name: 'STERILIZE-AC2', tic: 'TIC-511', pic: 'PIC-511', xv: 'XV-511' }),
    'LYO-CYCLE-1': makeLyoSfc(),
    'LYO-CYCLE-2': makeLyoSfc({ name: 'LYO-CYCLE-2', tic: 'TIC-611', pic: 'PIC-611', xv: 'XV-611' }),
    'CIP-CYCLE-1': makeCipSfc({ name: 'CIP-CYCLE-1', tic: 'TIC-701', fic: 'FIC-701', p: 'P-701', xvSupply: 'XV-701', xvReturn: 'XV-702' }),
    'CIP-CYCLE-2': makeCipSfc({ name: 'CIP-CYCLE-2', tic: 'TIC-711', fic: 'FIC-711', p: 'P-711', xvSupply: 'XV-711', xvReturn: 'XV-712' }),
    'CIP-CYCLE-3': makeCipSfc({ name: 'CIP-CYCLE-3', tic: 'TIC-721', fic: 'FIC-721', p: 'P-721', xvSupply: 'XV-721', xvReturn: 'XV-722' })
  }
}

export const useStore = create<StoreState>((set, get) => ({
  ...initial,
  trend: [],
  rev: 0,
  eventLog: [],
  logEvent: (category, tag, description, priority) => {
    const entry: EventLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: get().time,
      category,
      tag,
      description,
      user: useSecurity.getState().currentUser,
      priority
    }
    set((s) => ({ eventLog: [...s.eventLog, entry].slice(-EVENT_LOG_MAX) }))
  },
  batch: makeBatch(),
  phases: makeDefaultPhases(),
  sfcs: makeDefaultSfcs(),
  equipment: makeDefaultEquipment(),
  hardware: makeDefaultHardware(),
  moduleLifecycle: {},
  namedSets: { configured: {}, deployed: {} },
  sfcLifecycle: {},
  hornSilenced: false,

  tick: (dt: number) => {
    const s = get()
    if (!s.running) return
    // Advance the batch first so phase actions set modes/SPs/commands before physics.
    const { modules: cmdModules, batch } = advanceBatch(s, dt * s.speed, s.time + dt * 1000 * s.speed)
    const paused: Record<string, SfcDef> = {}
    const sfcDiagnostics: EventLogEntry[] = []
    const runnable = Object.fromEntries(Object.entries(s.sfcs).filter(([name, runtime]) => {
      const lifecycle = s.sfcLifecycle[name]
      if (!lifecycle) return true
      const controller = lifecycle.deployed ? s.hardware.controllers[lifecycle.deployed.controllerTag] : undefined
      if (!controller || controllerIsDown(controller)) return false
      const context = sfcExpressionContext(s, name, true)
      const error = sfcBlockConfigurationError(runtime) ?? sfcParameterError(runtime.parameters, context.sets) ??
        sfcStepsError(runtime.steps, s.modules, { ...context, parameters: runtime.parameters ?? {} })
      if (error && runtime.status === 'RUNNING') {
        paused[name] = { ...runtime, status: 'HELD' }
        sfcDiagnostics.push({ id: `${name}-setup-${s.time}`, time: s.time, category: 'DIAGNOSTIC',
          tag: name, user: 'SYSTEM', description: `SFC held: ${error}` })
        return false
      }
      return true
    }))
    const setsBySfc = Object.fromEntries(Object.keys(runnable).map(name => [name, sfcExpressionContext(s, name, true).sets]))
    const { modules: sfcModules, sfcs: executedSfcs } = advanceSfcs({ ...s, sfcs: runnable }, cmdModules, dt * s.speed, setsBySfc)
    const sfcs = { ...s.sfcs, ...executedSfcs, ...paused }
    const next = stepPlant({ ...s, modules: sfcModules }, dt)
    reconcileSfcAlarms(next.alarms, sfcs, next.time)
    // Sample trend data.
    const trend = s.trend
    const last = trend[trend.length - 1]
    const shouldSample = !last || next.time - last.t >= 1000 / TREND_HZ
    let newTrend = trend
    if (shouldSample) {
      // Sample every PID/AI module generically so any dynamo can render a sparkline, not just the reactor train.
      const values: Record<string, number> = {}
      for (const t of Object.keys(next.modules)) {
        const gm = next.modules[t]
        if (gm.type === 'PID' || gm.type === 'AO') {
          values[`${t}.PV`] = gm.pv
          values[`${t}.SP`] = gm.sp
          if (gm.type === 'AO') values[`${t}.OUT`] = gm.out
        } else if (gm.type === 'AI') {
          values[`${t}.PV`] = gm.pv
        }
      }
      const point: TrendPoint = { t: next.time, values }
      const cutoff = next.time - TREND_SECONDS * 1000
      newTrend = [...trend, point].filter((p) => p.t >= cutoff)
    }
    // A brand-new active alarm re-sounds the horn even if it was silenced.
    const priorById = new Map(s.alarms.map((a) => [a.id, a]))
    const hasNewAlarm = next.alarms.some((a) => a.active && !priorById.get(a.id)?.active)
    // Journal every alarm transition: newly active alarms and returns-to-normal.
    const nextById = new Map(next.alarms.map((a) => [a.id, a]))
    const newEntries: EventLogEntry[] = [...sfcDiagnostics]
    for (const [tag, module] of Object.entries(next.modules)) {
      const old = s.modules[tag]
      const error = module.type === 'PID' ? module.io?.splitter?.error :
        module.type === 'FB' ? module.splitter?.error : undefined
      const previousError = old?.type === 'PID' ? old.io?.splitter?.error :
        old?.type === 'FB' ? old.splitter?.error : undefined
      if (error !== previousError && (error || previousError)) {
        newEntries.push({ id: `${tag}-splitter-${next.time}`, time: next.time,
          category: 'DIAGNOSTIC', tag, user: 'SYSTEM',
          description: error ?? 'SPLTR configuration restored' })
      }
    }
    for (const a of next.alarms) {
      if (a.active && !priorById.get(a.id)?.active) {
        newEntries.push({
          id: `${a.id}-alm-${next.time}`,
          time: next.time,
          category: 'ALARM',
          tag: a.moduleTag,
          description: `${a.label} alarm — ${a.value}${a.unit ? ' ' + a.unit : ''}`,
          user: 'SYSTEM',
          priority: a.priority
        })
      }
    }
    for (const a of s.alarms) {
      if (a.active && !nextById.get(a.id)?.active) {
        newEntries.push({
          id: `${a.id}-rtn-${next.time}`,
          time: next.time,
          category: 'RTN',
          tag: a.moduleTag,
          description: `${a.label} returned to normal`,
          user: 'SYSTEM',
          priority: a.priority
        })
      }
    }
    set({
      ...next,
      moduleLifecycle: Object.fromEntries(Object.entries(s.moduleLifecycle).map(([tag, record]) => {
        const runtime = next.modules[tag]
        const controller = record.deployed ? s.hardware.controllers[record.deployed.controllerTag] : undefined
        return [tag, runtime?.type === 'AO' && runtime.downloaded && controller && !controllerIsDown(controller)
          ? { ...record, nvm: memoryOf(runtime) } : record]
      })),
      trend: newTrend,
      batch,
      sfcs,
      rev: s.rev + 1,
      hornSilenced: hasNewAlarm ? false : s.hornSilenced,
      eventLog: newEntries.length ? [...s.eventLog, ...newEntries].slice(-EVENT_LOG_MAX) : s.eventLog
    })
  },

  silenceHorn: () => set({ hornSilenced: true }),

  setMode: (tag, mode) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set Mode ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.mode = mode
        if (mode === 'MAN') p._integral = p.out
      }
    })
    get().logEvent('OPERATOR', tag, `Mode set to ${mode}`)
  },

  setSetpoint: (tag, sp) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set Setpoint ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.sp = Math.max(p.pvMin, Math.min(p.pvMax, sp))
      }
    })
    get().logEvent('OPERATOR', tag, `SP set to ${sp}`)
  },

  setOutput: (tag, out) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set Output ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (p.mode === 'MAN' || p.mode === 'ROUT') p.out = Math.max(0, Math.min(100, out))
      }
    })
    get().logEvent('OPERATOR', tag, `OUT set to ${out}`)
  },

  setTuning: (tag, t) => {
    if (!useSecurity.getState().requireLock('TUNING', `Tune ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (t.gain !== undefined) p.gain = t.gain
        if (t.reset !== undefined) p.reset = t.reset
        if (t.rate !== undefined) p.rate = t.rate
      }
    })
    get().logEvent('CONFIGURE', tag, `Tuning changed: ${JSON.stringify(t)}`)
  },

  setCasSource: (tag, source) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Set cascade source ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') m.casSource = source
    })
    get().logEvent('CONFIGURE', tag, `CAS_SOURCE set to ${source ?? '(none)'}`)
  },

  setFeedforward: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure feedforward ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'PID') return
      if ('enable' in patch) m.ffEnable = !!patch.enable
      if ('gain' in patch) m.ffGain = patch.gain ?? 0
      if ('source' in patch) m.ffSource = patch.source
    })
    get().logEvent('CONFIGURE', tag, `Feedforward changed: ${JSON.stringify(patch)}`)
  },

  setTracking: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure tracking ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'PID') return
      if ('enable' in patch) m.trackEnable = !!patch.enable
      if ('source' in patch) m.trackSource = patch.source
      if ('valueSource' in patch) m.trackValueSource = patch.valueSource
      if ('value' in patch) m.trackValue = patch.value ?? 0
    })
    get().logEvent('CONFIGURE', tag, `Tracking changed: ${JSON.stringify(patch)}`)
  },

  setFbInput: (tag, which, ref) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Wire ${tag}.${which.toUpperCase()}`)) return
    if (ref.kind === 'ref' && (ref.parameter || ref.block)) {
      const error = ref.tag
        ? signalError({ tag: ref.tag, parameter: ref.parameter ?? 'OUT', block: ref.block }, get().modules)
        : 'A signal source tag is required'
      if (error) {
        get().logEvent('DIAGNOSTIC', tag, `Function block connection rejected: ${error}`)
        window.alert(error)
        return
      }
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'FB') m[which] = ref
    })
    const source = ref.kind === 'const' ? ref.value :
      `${ref.tag}${ref.block ? '/' + ref.block : ''}${ref.parameter ? '.' + ref.parameter : ''}`
    get().logEvent('CONFIGURE', tag, `${which.toUpperCase()} wired to ${source}`)
  },

  setPidIo: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} analog strategy`)) return false
    const module = get().modules[tag]
    const error = patch.splitRange === false && get().hardware.analogBindings?.[tag]?.output2
      ? 'Disconnect the AO2 DST before removing its block'
      : module?.type === 'PID'
      ? pidIoPatchError(module, patch, get().modules)
      : `${tag} is not a PID control module`
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Analog strategy rejected: ${error}`)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') m.io = configurePidIo(m, patch)
    })
    get().logEvent('CONFIGURE', tag, `Analog strategy changed: ${JSON.stringify(patch)}`)
    return true
  },

  setSplitterConfig: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} splitter`)) return false
    const module = get().modules[tag]
    let error = module?.type === 'FB' && module.fbType === 'SPLTR'
      ? null : `${tag} is not a SPLTR block`
    for (const ref of [patch.feedback1Source, patch.feedback2Source]) {
      if (ref && !error) error = signalError(ref, get().modules) ??
        (ref.block !== 'AO1' && ref.block !== 'AO2' ? 'BKCAL feedback must come from an AO stage' : null)
    }
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Splitter configuration rejected: ${error}`)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'FB' || m.fbType !== 'SPLTR') return
      const { feedback1Source, feedback2Source, ...settings } = patch
      m.splitter = configureSplitter(m.splitter ?? createSplitter(), settings)
      if ('feedback1Source' in patch) m.bkcal1Source = feedback1Source
      if ('feedback2Source' in patch) m.bkcal2Source = feedback2Source
    })
    get().logEvent('CONFIGURE', tag, `SPLTR configuration changed: ${JSON.stringify(patch)}`)
    return true
  },

  setFbConfig: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'FB') Object.assign(m, patch)
    })
    get().logEvent('CONFIGURE', tag, `Config changed: ${JSON.stringify(patch)}`)
  },

  setAlarmLimit: (tag, type, patch) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Configure alarm ${tag}`)) return
    const error = !get().modules[tag]?.alarms.some(alarm => alarm.type === type)
      ? `${tag}.${type} is not a configured alarm`
      : patch.limit !== undefined && !Number.isFinite(patch.limit) ? 'Alarm limit must be finite' : null
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Alarm configuration rejected: ${error}`)
      window.alert(error)
      return
    }
    mutateModule(set, get, tag, (m) => {
      m.alarms = m.alarms.map(alarm => {
        if (alarm.type !== type) return alarm
        const next = { ...alarm }
        if (patch.limit !== undefined) next.limit = patch.limit
        if (patch.enabled !== undefined) next.enabled = patch.enabled
        if (patch.priority !== undefined) next.priority = patch.priority
        return next
      })
    })
    get().logEvent('CONFIGURE', tag, `Alarm ${type} configured: ${JSON.stringify(patch)}`)
  },

  startMotor: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Start ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = true
    })
    get().logEvent('OPERATOR', tag, 'Start command issued')
  },

  stopMotor: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Stop ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = false
    })
    get().logEvent('OPERATOR', tag, 'Stop command issued')
  },

  openValve: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Open ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = true
    })
    get().logEvent('OPERATOR', tag, 'Open command issued')
  },

  closeValve: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Close ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = false
    })
    get().logEvent('OPERATOR', tag, 'Close command issued')
  },

  toggleDO: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Toggle ${tag}`)) return
    const module = get().modules[tag]
    if (module?.type !== 'DO' || module.mode === 'OOS') {
      const message = `${tag} must be a DO module in AUTO to accept SP_D writes`
      get().logEvent('DIAGNOSTIC', tag, message)
      window.alert(message)
      return
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'DO') {
        m.commanded = !m.commanded
        if (!get().hardware.discreteBindings?.[tag]) m.state = m.commanded
      }
    })
    get().logEvent('OPERATOR', tag, 'Discrete output toggled')
  },

  toggleInterlock: (tag) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Force Interlock ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).interlock = !(m as MotorModule).interlock
      if (m.type === 'VALVE') (m as ValveModule).interlock = !(m as ValveModule).interlock
    })
    get().logEvent('DIAGNOSTIC', tag, 'Interlock force-toggled')
  },

  injectFault: (tag) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Inject Fault ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).fault = !(m as MotorModule).fault
      if (m.type === 'VALVE') (m as ValveModule).fault = !(m as ValveModule).fault
    })
    get().logEvent('DIAGNOSTIC', tag, 'Fault injection toggled')
  },

  resetDevice: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Reset ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') (m as MotorModule | ValveModule).locked = false
    })
    get().logEvent('OPERATOR', tag, 'Device reset (RESET_D)')
  },

  setPermissive: (tag, ok) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Set Permissive ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') (m as MotorModule | ValveModule).permissiveOk = ok
    })
    get().logEvent('DIAGNOSTIC', tag, `Permissive forced ${ok ? 'OK' : 'NOT OK'}`)
  },

  setDeviceOptions: (tag, opts) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Configure device options ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'MOTOR' && m.type !== 'VALVE') return
      const d = m as MotorModule | ValveModule
      if (opts.permissiveRequired !== undefined) d.permissiveRequired = opts.permissiveRequired
      if (opts.resetRequired !== undefined) d.resetRequired = opts.resetRequired
    })
    get().logEvent('CONFIGURE', tag, `Device options changed: ${JSON.stringify(opts)}`)
  },

  setInterlockSource: (tag, source) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Wire interlock source ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') m.interlockSource = source
    })
    get().logEvent('CONFIGURE', tag, `INTERLOCK_SOURCE set to ${source ?? '(none)'}`)
  },

  setCommandSource: (tag, source) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Wire command source ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') m.commandSource = source
    })
    get().logEvent('CONFIGURE', tag, `COMMAND_SOURCE set to ${source ?? '(none)'}`)
  },

  setCasHealthy: (tag, healthy) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Force cascade ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') (m as PidModule).casHealthy = healthy
    })
    get().logEvent('DIAGNOSTIC', tag, `Cascade connection forced ${healthy ? 'healthy' : 'unhealthy'}`)
  },

  failController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Fail controller ${tag}`)) return false
    let failed = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      failed = true
      const next = c.redundant
        ? c.primary === 'ACTIVE'
          ? { ...c, primary: 'FAILED' as const, secondary: 'ACTIVE' as const }
          : { ...c, secondary: 'FAILED' as const }
        : { ...c, primary: 'FAILED' as const }
      return { hardware: { ...s.hardware, controllers: { ...s.hardware.controllers, [tag]: next } }, rev: s.rev + 1 }
    })
    if (failed) get().logEvent('DIAGNOSTIC', tag, 'Controller leg failed')
    return failed
  },

  restoreController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Restore controller ${tag}`)) return false
    let restored = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      restored = true
      const next = c.redundant
        ? { ...c, primary: 'ACTIVE' as const, secondary: 'STANDBY' as const }
        : { ...c, primary: 'ACTIVE' as const }
      return { hardware: { ...s.hardware, controllers: { ...s.hardware.controllers, [tag]: next } }, rev: s.rev + 1 }
    })
    if (restored) get().logEvent('DIAGNOSTIC', tag, 'Controller restored')
    return restored
  },

  createController: (tag, description) => {
    if (!useSecurity.getState().requireLock('SYSTEM_ADMIN', `Create controller ${tag}`)) return false
    const normalizedTag = tag.trim()
    const normalizedDescription = description.trim()
    const error = !isValidControllerTag(normalizedTag)
      ? 'Controller names must have at most 16 letters, digits, $, - or _, with at least one letter'
      : normalizedDescription.length > MAX_CONTROLLER_DESCRIPTION_LENGTH
        ? `Controller descriptions must have at most ${MAX_CONTROLLER_DESCRIPTION_LENGTH} characters`
        : Object.keys(get().hardware.controllers).some(existing => existing.toLowerCase() === normalizedTag.toLowerCase())
          ? `Controller ${normalizedTag} already exists` : null
    if (error) {
      get().logEvent('DIAGNOSTIC', normalizedTag, `Controller creation rejected: ${error}`)
      window.alert(error)
      return false
    }

    let created = false
    set((s) => {
      if (Object.keys(s.hardware.controllers).some((existing) => existing.toLowerCase() === normalizedTag.toLowerCase())) return {}
      created = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [normalizedTag]: {
              tag: normalizedTag,
              description: normalizedDescription,
              commissioned: false,
              redundant: false,
              networkRedundant: false,
              controlNetworkAddress: null,
              identified: false,
              coldRestartMinutes: 0,
              powerDownAt: null,
              lastAutoSense: null,
              primary: 'N/A' as const,
              secondary: 'N/A' as const,
              scanTimeMs: 0,
              cpuLoadPct: 0,
              carrierIds: []
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (created) get().logEvent('CONFIGURE', normalizedTag, `Decommissioned controller created: ${normalizedDescription}`)
    return created
  },

  setControllerConfiguration: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure controller ${tag}`)) return false
    if (
      patch.coldRestartMinutes !== undefined &&
      (!Number.isInteger(patch.coldRestartMinutes) || patch.coldRestartMinutes < 0 || patch.coldRestartMinutes > MAX_COLD_RESTART_MINUTES)
    ) {
      return false
    }

    let updated = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.powerDownAt !== null || (controllerIsDown(c) && c.commissioned)) return {}
      const redundant = patch.redundant ?? c.redundant
      let primary = c.primary
      let secondary = c.secondary
      if (!c.commissioned) {
        primary = 'N/A'
        secondary = 'N/A'
      } else if (!redundant) {
        secondary = 'N/A'
      } else if (!c.redundant) {
        primary = 'ACTIVE'
        secondary = 'STANDBY'
      } else if (secondary === 'N/A') {
        secondary = 'STANDBY'
      }
      updated = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: {
              ...c,
              ...patch,
              redundant,
              primary,
              secondary
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (updated) get().logEvent('CONFIGURE', tag, `Controller properties changed: ${JSON.stringify(patch)}`)
    return updated
  },

  commissionController: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Commission controller ${tag}`)) return false
    let commissioned = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.commissioned || c.powerDownAt !== null) return {}
      const controlNetworkAddress = c.controlNetworkAddress ?? allocateControlNetworkAddress(s.hardware.controllers)
      if (!controlNetworkAddress) return {}
      commissioned = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: {
              ...c,
              commissioned: true,
              controlNetworkAddress,
              identified: false,
              primary: 'ACTIVE',
              secondary: c.redundant ? 'STANDBY' : 'N/A'
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (commissioned) get().logEvent('CONFIGURE', tag, 'Controller commissioned and added to the control network')
    return commissioned
  },

  decommissionController: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Decommission controller ${tag}`)) return false
    let decommissioned = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      decommissioned = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: { ...c, commissioned: false, identified: false, primary: 'N/A', secondary: 'N/A' }
          }
        },
        rev: s.rev + 1
      }
    })
    if (decommissioned) get().logEvent('CONFIGURE', tag, 'Controller decommissioned; bound I/O is unavailable')
    return decommissioned
  },

  identifyController: (tag, identifying) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Identify controller ${tag}`)) return false
    let changed = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.powerDownAt !== null || c.identified === identifying) return {}
      changed = true
      return {
        hardware: {
          ...s.hardware,
          controllers: { ...s.hardware.controllers, [tag]: { ...c, identified: identifying } }
        },
        rev: s.rev + 1
      }
    })
    if (changed) get().logEvent('DIAGNOSTIC', tag, identifying ? 'Controller identify flashing started' : 'Controller identify flashing stopped')
    return changed
  },

  autoSenseController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Auto-sense I/O for controller ${tag}`)) return false
    const state = get()
    const controller = state.hardware.controllers[tag]
    if (!controller || !controller.commissioned || controllerIsDown(controller)) return false
    const result = scanControllerIo(state.hardware, tag, new Set(Object.keys(state.modules)))
    if (!result) return false
    set((s) => ({
      hardware: {
        ...s.hardware,
        controllers: { ...s.hardware.controllers, [tag]: { ...s.hardware.controllers[tag], lastAutoSense: result } }
      },
      rev: s.rev + 1
    }))
    get().logEvent(
      'DIAGNOSTIC',
      tag,
      `I/O auto-sense complete: ${result.carriersScanned} carriers, ${result.baseplatesScanned} baseplates, ${result.channelsDetected} channels detected, ${result.unresolvedBindings.length} unresolved bindings`
    )
    return true
  },

  simulateControllerPowerLoss: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Simulate power loss for controller ${tag}`)) return false
    let poweredDown = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      poweredDown = true
      return {
        moduleLifecycle: Object.fromEntries(Object.entries(s.moduleLifecycle).map(([moduleTag, record]) => {
          const runtime = s.modules[moduleTag]
          return [moduleTag, record.deployed?.controllerTag === tag && runtime?.type === 'AO' && runtime.downloaded
            ? { ...record, nvm: memoryOf(runtime) } : record]
        })),
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: {
              ...c,
              identified: false,
              powerDownAt: Date.now(),
              primary: 'FAILED',
              secondary: c.redundant ? 'FAILED' : 'N/A'
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (poweredDown) get().logEvent('DIAGNOSTIC', tag, 'Controller power loss simulated; all bound I/O is Bad')
    return poweredDown
  },

  restoreControllerPower: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Restore power to controller ${tag}`)) return false
    let restored = false
    let coldRestartSucceeded = false
    let outageMinutes = 0
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.powerDownAt === null) return {}
      outageMinutes = Math.max(0, (Date.now() - c.powerDownAt) / 60_000)
      coldRestartSucceeded = c.coldRestartMinutes > 0 && outageMinutes <= c.coldRestartMinutes
      restored = true
      const modules = { ...s.modules }
      const moduleLifecycle = { ...s.moduleLifecycle }
      for (const [moduleTag, record] of Object.entries(s.moduleLifecycle)) {
        const runtime = modules[moduleTag]
        if (record.deployed?.controllerTag !== tag || runtime?.type !== 'AO') continue
        const restore = coldRestartSucceeded && runtime.downloaded === true
        modules[moduleTag] = restore ? restartAo(record, runtime, s.hardware)
          : { ...runtime, downloaded: false, bad: true, actualMode: 'OOS' }
        moduleLifecycle[moduleTag] = { ...record, nvm: restore ? memoryOf(modules[moduleTag]) : undefined }
      }
      return {
        modules,
        moduleLifecycle,
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: coldRestartSucceeded
              ? {
                  ...c,
                  commissioned: true,
                  powerDownAt: null,
                  primary: 'ACTIVE',
                  secondary: c.redundant ? 'STANDBY' : 'N/A'
                }
              : {
                  ...c,
                  commissioned: false,
                  identified: false,
                  powerDownAt: null,
                  primary: 'N/A',
                  secondary: 'N/A'
                }
          }
        },
        rev: s.rev + 1
      }
    })
    if (restored) {
      const message = coldRestartSucceeded
        ? `Cold restart succeeded after ${outageMinutes.toFixed(2)} minutes; controller returned to service`
        : `Cold restart unavailable after ${outageMinutes.toFixed(2)} minutes; controller requires commissioning and download`
      get().logEvent('DIAGNOSTIC', tag, message)
    }
    return restored
  },

  pullCharm: (baseplateId, slot) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Pull CHARM ${baseplateId}/${slot}`)) return
    set((s) => {
      const bp = s.hardware.baseplates[baseplateId]
      if (!bp) return {}
      const channels = bp.channels.map((c) => (c.slot === slot ? { ...c, pulled: true } : c))
      return {
        hardware: { ...s.hardware, baseplates: { ...s.hardware.baseplates, [baseplateId]: { ...bp, channels } } },
        rev: s.rev + 1
      }
    })
    get().logEvent('DIAGNOSTIC', `${baseplateId}/${slot}`, 'CHARM pulled')
  },

  reinsertCharm: (baseplateId, slot) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Reinsert CHARM ${baseplateId}/${slot}`)) return
    set((s) => {
      const bp = s.hardware.baseplates[baseplateId]
      if (!bp) return {}
      const channels = bp.channels.map((c) => (c.slot === slot ? { ...c, pulled: false } : c))
      return {
        hardware: { ...s.hardware, baseplates: { ...s.hardware.baseplates, [baseplateId]: { ...bp, channels } } },
        rev: s.rev + 1
      }
    })
    get().logEvent('DIAGNOSTIC', `${baseplateId}/${slot}`, 'CHARM reinserted')
  },

  ackAlarm: (id) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Acknowledge alarm')) return
    const target = get().alarms.find((a) => a.id === id)
    set((s) => ({
      alarms: s.alarms
        .map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
        .filter((a) => a.active || !a.acknowledged),
      rev: s.rev + 1
    }))
    if (target) get().logEvent('ACK', target.moduleTag, `${target.label} alarm acknowledged`, target.priority)
  },

  ackAll: () => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Acknowledge All')) return
    const count = get().alarms.filter((a) => !a.acknowledged).length
    set((s) => ({
      alarms: s.alarms.map((a) => ({ ...a, acknowledged: true })).filter((a) => a.active),
      rev: s.rev + 1
    }))
    get().logEvent('ACK', '—', `Acknowledge All (${count} alarms)`)
  },

  shelveAlarm: (id, durationMin) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Shelve alarm')) return
    const target = get().alarms.find((a) => a.id === id)
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, shelvedUntil: s.time + durationMin * 60000 } : a)),
      rev: s.rev + 1
    }))
    if (target) get().logEvent('ACK', target.moduleTag, `${target.label} alarm shelved for ${durationMin} min`, target.priority)
  },

  unshelveAlarm: (id) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Unshelve alarm')) return
    const target = get().alarms.find((a) => a.id === id)
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, shelvedUntil: undefined } : a)),
      rev: s.rev + 1
    }))
    if (target) get().logEvent('ACK', target.moduleTag, `${target.label} alarm unshelved`, target.priority)
  },

  setRunning: (r) => set({ running: r }),
  setSpeed: (speed) => set({ speed }),

  batchCommand: (cmd) => {
    if (!useSecurity.getState().requireLock('BATCH_OPERATE', 'Batch command')) return
    if (cmd === 'START' || cmd === 'RESTART') {
      const state = get()
      for (const name of PROCEDURE) {
        const phase = state.phases[name]
        const error = !phase || !phase.steps.length ? `Phase ${name} requires steps` : sfcStepsError(phase.steps, state.modules)
        if (error) {
          get().logEvent('DIAGNOSTIC', state.batch.id, `Batch command rejected: ${error}`); window.alert(error)
          return
        }
      }
    }
    set((s) => ({ batch: commandBatch(s.batch, cmd, s.time, s.phases), rev: s.rev + 1 }))
    get().logEvent('BATCH', get().batch.id, `Batch command: ${cmd}`)
  },

  setPhaseSteps: (phaseName, steps) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit Phase ${phaseName}`)) return
    const state = get()
    if (!state.phases[phaseName] || state.batch.status === 'RUNNING' || state.batch.status === 'HELD') {
      const message = !state.phases[phaseName] ? `Phase ${phaseName} does not exist` : 'Reset or stop the batch before editing phase logic'
      get().logEvent('DIAGNOSTIC', phaseName, message); window.alert(message)
      return
    }
    set((s) => {
      const def = s.phases[phaseName]
      if (!def) return {}
      return { phases: { ...s.phases, [phaseName]: { ...def, steps } }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', phaseName, 'Phase logic edited')
  },

  createArea: (name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', 'Create plant area')) return false
    const key = name.trim().toUpperCase()
    const error = areaNameError(key) ?? (get().areas.includes(key) ? `Area ${key} already exists` : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', key, `Area creation rejected: ${error}`)
      window.alert(error)
      return false
    }
    set(s => ({ areas: [...s.areas, key], rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', key, 'Plant area created')
    return true
  },

  renameArea: (name, nextName) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Rename plant area ${name}`)) return false
    const key = nextName.trim().toUpperCase()
    const state = get()
    const error = !state.areas.includes(name) ? `Area ${name} does not exist` :
      areaNameError(key) ?? (key !== name && state.areas.includes(key) ? `Area ${key} already exists` : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', name, `Area rename rejected: ${error}`)
      window.alert(error)
      return false
    }
    if (key === name) return true
    set(s => ({
      areas: s.areas.map(area => area === name ? key : area),
      modules: Object.fromEntries(Object.entries(s.modules).map(([tag, module]) =>
        [tag, module.area === name ? { ...module, area: key } : module])),
      equipment: Object.fromEntries(Object.entries(s.equipment).map(([tag, equipment]) =>
        [tag, equipment.area === name ? { ...equipment, area: key } : equipment])),
      sfcs: Object.fromEntries(Object.entries(s.sfcs).map(([tag, sfc]) =>
        [tag, sfc.area === name ? { ...sfc, area: key } : sfc])),
      sfcLifecycle: Object.fromEntries(Object.entries(s.sfcLifecycle).map(([tag, lifecycle]) =>
        [tag, { ...lifecycle,
          draft: lifecycle.draft.area === name ? { ...lifecycle.draft, area: key } : lifecycle.draft,
          saved: lifecycle.saved?.area === name ? { ...lifecycle.saved, area: key } : lifecycle.saved,
          deployed: lifecycle.deployed?.area === name ? { ...lifecycle.deployed, area: key } : lifecycle.deployed
        }])),
      rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', key, `Plant area renamed from ${name}`)
    return true
  },

  createModule: (spec) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Create module ${spec.tag}`)) return false
    const tag = spec.tag.trim().toUpperCase()
    const state = get()
    const error = moduleNameError(tag) ?? (state.modules[tag] || state.sfcs[tag] ? `Module ${tag} already exists` :
      !state.areas.includes(spec.area) ? `Area ${spec.area} does not exist` : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Module creation rejected: ${error}`)
      window.alert(error)
      return false
    }
    const module = makeModule({ ...spec, tag })
    if (module.type === 'AO') {
      const scaleError = aoConfigurationError(module)
      if (scaleError) return rejectAo(get, tag, scaleError)
    }
    set(s => ({ modules: { ...s.modules, [tag]: module }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Module created')
    return true
  },

  addTraditionalCard: (controllerTag, slot, type) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Add traditional card to ${controllerTag}`)) return false
    const hw = get().hardware
    const error = !hw.controllers[controllerTag] ? 'Controller does not exist' :
      !Number.isInteger(slot) || slot < 1 || slot > 8 ? 'Training card slot must be 1-8' :
      !['AI', 'AO', 'DI', 'DO'].includes(type) ? 'Unsupported traditional card type' :
      Object.values(hw.traditionalCards ?? {}).some(card => card.controllerTag === controllerTag && card.slot === slot)
        ? `Slot ${slot} already has a traditional card` : null
    if (error) {
      get().logEvent('DIAGNOSTIC', controllerTag, `Add card rejected: ${error}`)
      window.alert(error)
      return false
    }
    const card = makeTraditionalCard(controllerTag, slot, type)
    set(s => ({ hardware: { ...s.hardware,
      traditionalCards: { ...s.hardware.traditionalCards, [card.id]: card } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', card.id, `Traditional ${type} card added`)
    return true
  },

  configureTraditionalChannel: (cardId, channelNumber, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${cardId} channel ${channelNumber}`)) return false
    const normalized = { ...patch, dst: patch.dst.trim().toUpperCase(),
      tiebackDst: patch.tiebackDst?.trim().toUpperCase() || undefined }
    const card = get().hardware.traditionalCards?.[cardId]
    const error = channelConfigurationError(get().hardware, cardId, channelNumber, normalized)
    if (error || !card) {
      const message = error ?? 'Traditional card does not exist'
      get().logEvent('DIAGNOSTIC', cardId, `Channel configuration rejected: ${message}`)
      window.alert(message)
      return false
    }
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [cardId]: { ...card, channels: card.channels.map(channel => channel.channel === channelNumber
        ? { ...channel, ...normalized, bad: true,
          // Tieback changes the raw domain from engineering units to percent.
          filteredValue: card.type === 'AI' && normalized.tiebackDst !== channel.tiebackDst ?
            (normalized.tiebackDst ? findDst(s.hardware, normalized.tiebackDst)?.channel.value ?? channel.value :
              channel.value) : channel.filteredValue } : channel) } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, `Channel ${channelNumber}: DST ${normalized.dst || '(none)'}, enabled ${normalized.enabled}, simulated tieback ${normalized.tiebackDst ?? '(none)'}`)
    return true
  },

  configureInputFilter: (cardId, channelNumber, seconds) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure AI channel filter ${cardId}`)) return false
    const card = get().hardware.traditionalCards?.[cardId]
    const channel = card?.channels.find(c => c.channel === channelNumber)
    const error = !card || card.type !== 'AI' || !channel ? 'Select a traditional AI card/channel' :
      !Number.isFinite(seconds) || seconds < 0 ? 'Input filter time must be finite and nonnegative' : null
    if (error || !card) {
      const message = error ?? 'Traditional AI card does not exist'
      get().logEvent('DIAGNOSTIC', cardId, message); window.alert(message)
      return false
    }
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [cardId]: { ...card, channels: card.channels.map(c => c.channel === channelNumber ?
        { ...c, configuredFilterSeconds: seconds } : c) } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, `CH${channelNumber} configured filter ${seconds}s; transfer required`)
    return true
  },

  downloadInputFilters: (cardId) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Download input filters ${cardId}`)) return false
    const state = get()
    const card = state.hardware.traditionalCards?.[cardId]
    const controller = card ? state.hardware.controllers[card.controllerTag] : undefined
    const error = !card || card.type !== 'AI' ? 'Select a traditional AI card' :
      !controller || controllerIsDown(controller) ? 'Input filter transfer requires an available commissioned controller' :
      card.channels.some(c => !Number.isFinite(c.configuredFilterSeconds ?? 0) || (c.configuredFilterSeconds ?? 0) < 0 ||
        ((c.configuredFilterSeconds ?? 0) > 0 && !Number.isFinite(c.filteredValue ?? c.value))) ?
        'Input filter transfer rejected invalid time or readback; runtime retained' : null
    if (error || !card) {
      const message = error ?? 'Traditional AI card does not exist'
      get().logEvent('DIAGNOSTIC', cardId, message); window.alert(message)
      return false
    }
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [cardId]: { ...card, channels: card.channels.map(c => ({ ...c,
        filterSeconds: c.configuredFilterSeconds ?? 0,
        filteredValue: (c.configuredFilterSeconds ?? 0) > 0 ? c.filteredValue ?? c.value : c.value })) } } },
      rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, 'Simulated AI filter-only card transfer committed atomically; not a full card/controller download')
    return true
  },

  setTraditionalInput: (dst, value) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Simulate input ${dst}`)) return false
    const target = findDst(get().hardware, dst)
    const error = !target || (target.card.type !== 'AI' && target.card.type !== 'DI') ? 'Select a named input channel' :
      target.channel.tiebackDst ? 'Disconnect the simulated tieback before forcing this input' :
      !Number.isFinite(value) || (target.card.type === 'DI' && value !== 0 && value !== 1)
        ? 'Input value must be finite; discrete inputs accept only 0 or 1' : null
    if (error) {
      get().logEvent('DIAGNOSTIC', dst, `Input simulation rejected: ${error}`)
      window.alert(error)
      return false
    }
    if (!target) return false
    const { card, channel } = target
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [card.id]: { ...card, channels: card.channels.map(item => item.channel === channel.channel
        ? { ...item, value } : item) } } } }))
    get().logEvent('DIAGNOSTIC', dst, `Simulated input set to ${value}`)
    return true
  },

  bindDiscreteDst: (tag, dst) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Bind ${tag} traditional I/O`)) return false
    const normalized = dst.trim().toUpperCase()
    const error = discreteBindingError(get().hardware, get().modules[tag], normalized)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `I/O binding rejected: ${error}`)
      window.alert(error)
      return false
    }
    const bindings = { ...get().hardware.discreteBindings }
    if (normalized) bindings[tag] = normalized
    else delete bindings[tag]
    set(s => ({ hardware: { ...s.hardware, discreteBindings: bindings }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, `Traditional I/O bound to ${normalized || '(none)'}`)
    return true
  },

  enableModuleLifecycle: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Enable saved lifecycle ${tag}`)) return false
    const state = get()
    const module = state.modules[tag]
    if (module?.type !== 'AO' || state.moduleLifecycle[tag]) {
      return rejectAo(get, tag, 'Saved lifecycle currently requires an unmanaged standalone AO module')
    }
    const dst = state.hardware.analogBindings?.[tag]?.output ?? ''
    const target = findDst(state.hardware, dst)
    const configuration = { module: cloneAo(module), controllerTag: target?.card.controllerTag ?? '',
      outputDst: dst, restoreModule: false, restoreParameters: [], downloadBehavior: 'CONFIGURED' as const }
    const draftModule = configuration.module
    delete draftModule.downloaded
    delete draftModule.controllerTag
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: {
      draft: configuration, online: false, savedRevision: 0, deployedRevision: 0
    } }, modules: { ...s.modules, [tag]: { ...module, downloaded: false, bad: true, actualMode: 'OOS' } },
    rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Opt-in saved AO lifecycle enabled; output held until first download')
    return true
  },

  setModuleOnline: (tag, online) => {
    const record = get().moduleLifecycle[tag]
    if (!record) return rejectAo(get, tag, 'Module does not use the saved lifecycle')
    const module = get().modules[tag]
    if (online && (!record.deployed || module?.type !== 'AO' || !module.downloaded)) {
      return rejectAo(get, tag, 'Download the saved module before going online')
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, online } } }))
    return true
  },

  editModuleDraft: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit offline configuration ${tag}`)) return false
    const record = get().moduleLifecycle[tag]
    if (!record || record.online) return rejectAo(get, tag, 'Go Offline to edit the saved-lifecycle draft')
    const draft = cloneConfiguration(record.draft)
    const { controllerTag, outputDst, restoreModule, restoreParameters, downloadBehavior,
      parameter, ...modulePatch } = patch
    Object.assign(draft.module, modulePatch)
    if (controllerTag !== undefined) draft.controllerTag = controllerTag
    if (outputDst !== undefined) draft.outputDst = outputDst.trim().toUpperCase()
    if (restoreModule !== undefined) draft.restoreModule = restoreModule
    if (restoreParameters !== undefined) draft.restoreParameters = [...restoreParameters]
    if (downloadBehavior !== undefined) draft.downloadBehavior = downloadBehavior
    if (parameter) {
      if (!draft.module.parameters[parameter.name]) return rejectAo(get, tag, 'Configured parameter does not exist')
      draft.module.parameters[parameter.name].value = parameter.value
    }
    const error = configurationError(draft)
    if (error) return rejectAo(get, tag, error)
    if (draft.controllerTag && !get().hardware.controllers[draft.controllerTag]) {
      return rejectAo(get, tag, 'Assigned controller does not exist')
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Offline AO draft changed; runtime unchanged')
    return true
  },

  saveModuleConfiguration: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Save module configuration ${tag}`)) return false
    const record = get().moduleLifecycle[tag]
    const runtime = get().modules[tag]
    if (!record || record.online || runtime?.type !== 'AO') return rejectAo(get, tag, 'Go Offline to save the module draft')
    const draft = withProjectMembership(record.draft, runtime)
    const error = configurationError(draft)
    if (error) return rejectAo(get, tag, error)
    try {
      window.localStorage.setItem(savedAoStorageKey(tag), serializeSavedAo(draft))
    } catch (error) {
      return rejectAo(get, tag, `Save failed; database unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record,
      draft, saved: cloneConfiguration(draft), savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Module saved to the local browser configuration database; runtime unchanged')
    return true
  },

  loadSavedModuleConfiguration: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Load saved module ${tag}`)) return false
    const record = get().moduleLifecycle[tag]
    if (!record || record.online) return rejectAo(get, tag, 'Go Offline before loading saved configuration')
    let saved
    try {
      const text = window.localStorage.getItem(savedAoStorageKey(tag))
      if (text === null) return rejectAo(get, tag, 'No saved AO configuration exists for this tag in this browser profile')
      saved = parseSavedAo(text, tag)
    } catch (error) {
      return rejectAo(get, tag, `Load failed; draft/runtime unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!get().areas.includes(saved.module.area)) return rejectAo(get, tag, 'Create the saved plant area before loading this module')
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record,
      draft: cloneConfiguration(saved), saved, savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Persistent saved configuration loaded offline; download is still required')
    return true
  },

  downloadModule: (tag, scope) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Download module ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    if (!record?.saved || runtime?.type !== 'AO' || lifecycleDirty(record)) {
      return rejectAo(get, tag, 'Save a valid offline draft before downloading')
    }
    if (!['FULL', 'PARTIAL'].includes(scope) || (scope === 'PARTIAL' && (!record.deployed || !runtime.downloaded))) {
      return rejectAo(get, tag, 'First download must be Full; subsequent scope must be Full or Partial')
    }
    const error = downloadError(record.saved, state.hardware)
    if (error) return rejectAo(get, tag, `Download failed; last-good runtime retained: ${error}`)
    const saved = record.saved
    const behavior = scope === 'FULL' ? 'CONFIGURED' : saved.downloadBehavior
    const module = deployedAo(saved, runtime, behavior, state.hardware)
    const transferError = configurationError({ ...saved, module })
    if (transferError) return rejectAo(get, tag, `Preserved runtime values are invalid: ${transferError}`)
    set(s => ({
      modules: { ...s.modules, [tag]: module },
      hardware: { ...s.hardware, analogBindings: { ...s.hardware.analogBindings,
        [tag]: { output: saved.outputDst } } },
      moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record,
        deployed: cloneConfiguration(saved), deployedRevision: record.savedRevision,
        nvm: memoryOf(module) } }, rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', tag, `${scope} simulated module download committed atomically (${behavior}); NVM updated`)
    return true
  },

  uploadModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Upload module ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const controller = record?.deployed ? state.hardware.controllers[record.deployed.controllerTag] : undefined
    if (!record?.deployed || runtime?.type !== 'AO' || !runtime.downloaded) {
      return rejectAo(get, tag, 'Upload requires a downloaded AO module')
    }
    if (!controller || controllerIsDown(controller)) return rejectAo(get, tag, 'Upload requires an available assigned controller')
    const draft = cloneConfiguration(record.deployed)
    draft.module = cloneAo(runtime)
    delete draft.module.downloaded
    delete draft.module.controllerTag
    // Upload defaults, not transient field readback/quality, to the offline draft.
    const defaults = record.deployed.module
    for (const key of ['out', 'pv', 'bad', 'actualMode', 'limited'] as const) {
      Object.assign(draft.module, { [key]: defaults[key] })
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft, online: false } },
      rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Runtime uploaded into offline draft; Save is still required')
    return true
  },

  restartModule: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Cold restart module ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const controller = record?.deployed ? state.hardware.controllers[record.deployed.controllerTag] : undefined
    if (!record?.deployed || runtime?.type !== 'AO' || !runtime.downloaded ||
        !controller || controllerIsDown(controller)) return rejectAo(get, tag, 'Cold restart requires an available downloaded module')
    const module = restartAo(record, runtime, state.hardware)
    set(s => ({ modules: { ...s.modules, [tag]: module }, moduleLifecycle: { ...s.moduleLifecycle,
      [tag]: { ...record, nvm: memoryOf(module) } }, rev: s.rev + 1 }))
    get().logEvent('DIAGNOSTIC', tag, 'Simulated cold restart used deployed defaults and selected NVM restore flags')
    return true
  },

  configureStandaloneAo: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} AO`)) return false
    if (get().moduleLifecycle[tag]) return get().editModuleDraft(tag, patch)
    const module = get().modules[tag]
    const error = module?.type !== 'AO' ? 'Select a standalone AO module' : aoConfigurationError(module, patch)
    if (error) return rejectAo(get, tag, error)
    mutateModule(set, get, tag, m => {
      if (m.type === 'AO') {
        Object.assign(m, patch)
        m.bad = true
        m.actualMode = 'OOS'
        m.pv = aoEngineeringValue(m, m.out)
      }
    })
    get().logEvent('CONFIGURE', tag, `AO scale/limits changed: ${JSON.stringify(patch)}`)
    return true
  },

  setStandaloneAoMode: (tag, mode) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set ${tag} AO mode`)) return false
    const module = get().modules[tag]
    const availability = module?.type === 'AO' ? aoOperatorError(module, get().hardware) : null
    if (availability) return rejectAo(get, tag, availability)
    if (module?.type !== 'AO' || !['CAS', 'AUTO', 'MAN', 'OOS'].includes(mode)) {
      return rejectAo(get, tag, 'AO mode requires CAS, AUTO, MAN or OOS')
    }
    mutateModule(set, get, tag, m => {
      if (m.type !== 'AO') return
      if (mode === 'MAN' && m.mode !== 'MAN') m.manualOutput = m.out
      if (mode === 'AUTO' && m.mode !== 'AUTO') m.sp = m.pv
      m.mode = mode
      if (mode === 'OOS') { m.bad = true; m.actualMode = 'OOS' }
    })
    get().logEvent('OPERATOR', tag, `AO target mode ${mode}`)
    return true
  },

  setStandaloneAoValue: (tag, value) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Write ${tag} AO setpoint/output`)) return false
    const module = get().modules[tag]
    const availability = module?.type === 'AO' ? aoOperatorError(module, get().hardware) : null
    if (availability) return rejectAo(get, tag, availability)
    const error = module?.type !== 'AO' ? 'Select a standalone AO module' :
      module.mode !== 'AUTO' && module.mode !== 'MAN' ? 'AO direct value entry requires AUTO or MAN' :
      !Number.isFinite(value) || value < (module.mode === 'MAN' ? 0 : module.spLow) ||
        value > (module.mode === 'MAN' ? 100 : module.spHigh) ? 'AO value is outside the configured limits' : null
    if (error) return rejectAo(get, tag, error)
    mutateModule(set, get, tag, m => {
      if (m.type === 'AO') {
        if (m.mode === 'MAN') m.manualOutput = value
        else m.sp = value
      }
    })
    get().logEvent('OPERATOR', tag, `AO requested value ${value}`)
    return true
  },

  addAoParameter: (tag, name, value) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create ${tag} input parameter`)) return false
    const key = name.trim().toUpperCase()
    const record = get().moduleLifecycle[tag]
    if (record?.online) return rejectAo(get, tag, 'Go Offline to create configured parameters')
    const module = record?.draft.module ?? get().modules[tag]
    const error = module?.type !== 'AO' ? 'Input parameters currently require a standalone AO module' :
      moduleNameError(key) ?? (['AO1', 'PV', 'SP', 'OUT', 'MODE', 'CAS_IN', 'IO_OUT'].includes(key)
        ? 'Parameter name conflicts with an AO block/parameter' :
        module.parameters[key] ? `Parameter ${key} already exists` :
        !Number.isFinite(value) ? 'Floating Point input value must be finite' : null)
    if (error) return rejectAo(get, tag, error)
    if (record && module.type === 'AO') {
      const draft = cloneConfiguration(record.draft)
      draft.module.parameters[key] = { type: 'FLOAT', value }
      set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    } else mutateModule(set, get, tag, m => {
      if (m.type === 'AO') m.parameters = { ...m.parameters, [key]: { type: 'FLOAT', value } }
    })
    get().logEvent('CONFIGURE', tag, `Floating Point input ${key} created`)
    return true
  },

  setAoParameter: (tag, name, value) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Write ${tag}/${name}`)) return false
    const module = get().modules[tag]
    const availability = module?.type === 'AO' ? aoOperatorError(module, get().hardware) : null
    if (availability) return rejectAo(get, tag, availability)
    const error = module?.type !== 'AO' || !module.parameters[name] ? 'Floating Point input parameter does not exist' :
      !Number.isFinite(value) ? 'Floating Point input value must be finite' : null
    if (error) return rejectAo(get, tag, error)
    mutateModule(set, get, tag, m => {
      if (m.type === 'AO') m.parameters = { ...m.parameters, [name]: { ...m.parameters[name], value } }
    })
    get().logEvent('OPERATOR', tag, `${name}.CV set to ${value}`)
    return true
  },

  connectAoParameter: (tag, name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Wire ${tag} CAS_IN`)) return false
    const record = get().moduleLifecycle[tag]
    if (record?.online) return rejectAo(get, tag, 'Go Offline to change configured CAS_IN wiring')
    const module = record?.draft.module ?? get().modules[tag]
    if (module?.type !== 'AO' || (name !== undefined && !module.parameters[name])) {
      return rejectAo(get, tag, 'Select an existing Floating Point input parameter')
    }
    if (record) {
      const draft = cloneConfiguration(record.draft)
      draft.module.casParameter = name
      set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    } else mutateModule(set, get, tag, m => {
      if (m.type === 'AO') { m.casParameter = name; m.bad = true }
    })
    get().logEvent('CONFIGURE', tag, `AO1.CAS_IN connected to ${name ?? '(none)'}`)
    return true
  },

  bindAnalogDst: (tag, port, dst) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Bind ${tag} ${port} traditional I/O`)) return false
    const normalized = dst.trim().toUpperCase()
    const record = get().moduleLifecycle[tag]
    if (record) {
      if (port !== 'output') return rejectAo(get, tag, 'Standalone AO supports IO_OUT only')
      return get().editModuleDraft(tag, { outputDst: normalized })
    }
    const error = analogBindingError(get().hardware, get().modules[tag], port, normalized)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Analog I/O binding rejected: ${error}`)
      window.alert(error)
      return false
    }
    const bindings = { ...get().hardware.analogBindings }
    const ports = { ...bindings[tag] }
    if (normalized) ports[port] = normalized
    else delete ports[port]
    if (Object.keys(ports).length) bindings[tag] = ports
    else delete bindings[tag]
    set(s => {
      const module = s.modules[tag]
      let next = module
      if (module.type === 'AI') next = { ...module, pvBad: true }
      else if (module.type === 'AO') {
        const target = findDst(s.hardware, normalized)
        const out = target?.card.type === 'AO' && Number.isFinite(target.channel.value) ? target.channel.value : module.out
        next = { ...module, out, pv: aoEngineeringValue(module, out), bad: true, actualMode: 'OOS' }
      }
      else if (module.type === 'PID') {
        const io = clonePidIo(module)
        if (port === 'input') {
          io.ai.rawBad = true
          io.ai.bad = io.ai.mode === 'AUTO'
        } else {
          const stage = port === 'output' ? io.ao : io.ao2
          const target = findDst(s.hardware, normalized)
          if (stage) {
            stage.bad = true
            if (target?.card.type === 'AO' && Number.isFinite(target.channel.value)) stage.out = target.channel.value
          }
        }
        next = { ...module, io, pvBad: port === 'input' && !io.inputSource ? io.ai.bad : module.pvBad }
      }
      return { modules: { ...s.modules, [tag]: next },
        hardware: { ...s.hardware, analogBindings: bindings }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, `${port} traditional I/O bound to ${normalized || '(none)'}`)
    return true
  },

  setDiscreteMode: (tag, mode) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set ${tag} mode`)) return false
    const module = get().modules[tag]
    if (!module || (module.type !== 'DI' && module.type !== 'DO') || !['AUTO', 'OOS'].includes(mode)) {
      const error = 'Discrete mode requires a DI/DO module and AUTO or OOS'
      get().logEvent('DIAGNOSTIC', tag, error)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, m => {
      if (m.type === 'DI' || m.type === 'DO') {
        m.mode = mode
        if (mode === 'OOS') m.ioBad = true
      }
    })
    get().logEvent('OPERATOR', tag, `Discrete mode target set to ${mode}`)
    return true
  },

  configureDiscreteAlarm: (tag, onValue, enabled) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} discrete alarm`)) return false
    if (get().modules[tag]?.type !== 'DI') {
      const error = 'Discrete input alarm configuration requires a DI module'
      get().logEvent('DIAGNOSTIC', tag, error)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, m => {
      if (m.type !== 'DI') return
      m.alarmOnValue = onValue
      const existing = m.alarms.find(alarm => alarm.type === 'HI')
      m.alarms = [...m.alarms.filter(alarm => alarm.type !== 'HI'),
        { ...existing, type: 'HI', label: existing?.label ?? 'DISCRETE',
          priority: existing?.priority ?? 'WARNING', enabled }]
    })
    get().logEvent('CONFIGURE', tag, `Discrete alarm ON VALUE ${Number(onValue)}, enabled ${enabled}`)
    return true
  },

  deleteModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete module ${tag}`)) return
    set((s) => {
      if (!s.modules[tag]) return {}
      const modules = { ...s.modules }
      delete modules[tag]
      const bindings = { ...s.hardware.discreteBindings }
      delete bindings[tag]
      const analogBindings = { ...s.hardware.analogBindings }
      delete analogBindings[tag]
      const moduleLifecycle = { ...s.moduleLifecycle }
      delete moduleLifecycle[tag]
      return { modules, moduleLifecycle, hardware: { ...s.hardware, discreteBindings: bindings, analogBindings },
        alarms: s.alarms.filter((a) => a.moduleTag !== tag), rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, 'Module deleted')
  },

  createEquipmentModule: (tag, description, area) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create Equipment Module ${tag}`)) return
    if (!get().areas.includes(area)) {
      const message = `Area ${area} does not exist`
      get().logEvent('DIAGNOSTIC', tag, `Equipment Module creation rejected: ${message}`)
      window.alert(message)
      return
    }
    set((s) => {
      const key = tag.trim().toUpperCase()
      if (!key || s.equipment[key]) return {}
      return { equipment: { ...s.equipment, [key]: { tag: key, description, area } }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, 'Equipment Module created')
  },

  deleteEquipmentModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete Equipment Module ${tag}`)) return
    set((s) => {
      if (!s.equipment[tag]) return {}
      const equipment = { ...s.equipment }
      delete equipment[tag]
      // Orphaned Control Modules fall back to "(unassigned)" under their Area.
      const modules = { ...s.modules }
      for (const k of Object.keys(modules)) {
        if (modules[k].equipmentModule === tag) modules[k] = { ...modules[k], equipmentModule: undefined }
      }
      return { equipment, modules, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, 'Equipment Module deleted')
  },

  setModuleEquipment: (moduleTag, emTag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Assign ${moduleTag} to Equipment Module`)) return
    mutateModule(set, get, moduleTag, (m) => {
      m.equipmentModule = emTag ?? undefined
    })
    get().logEvent('CONFIGURE', moduleTag, `Assigned to Equipment Module ${emTag ?? '(unassigned)'}`)
  },

  createSfc: (name, area, options) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Create SFC ${name}`)) return false
    const key = name.trim().toUpperCase()
    const state = get()
    const error = moduleNameError(key) ??
      (state.sfcs[key] || state.modules[key] ? `Module ${key} already exists` :
        !state.areas.includes(area) ? `Area ${area} does not exist` : null)
    if (error) return rejectSfc(get, key, `SFC creation rejected: ${error}`)
    const sfc: SfcDef = { name: key, area, steps: [], status: 'READY', active: 0, elapsed: 0 }
    const draft = cloneSfcConfiguration({ name: key, area, controllerTag: '', steps: [] })
    set(s => ({ sfcs: { ...s.sfcs, [key]: sfc },
      sfcLifecycle: options?.managed ? { ...s.sfcLifecycle, [key]: { draft, online: false } } : s.sfcLifecycle,
      rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', key, options?.managed ?
      'SFC module created Offline; configure steps, Save and Download before execution' : 'SFC created')
    return true
  },

  deleteSfc: (name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete SFC ${name}`)) return
    set((s) => {
      if (!s.sfcs[name]) return {}
      const sfcs = { ...s.sfcs }
      delete sfcs[name]
      const sfcLifecycle = { ...s.sfcLifecycle }
      delete sfcLifecycle[name]
      return { sfcs, sfcLifecycle, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', name, 'SFC deleted')
  },

  createNamedSet: (name) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Create Named Set ${name}`)) return false
    const definition: NamedSetDefinition = { name, description: '', entries: [] }
    const error = namedSetError(definition, true) ??
      (Object.hasOwn(get().namedSets.configured, name) ? `Named Set ${name} already exists (case-sensitive)` : null)
    if (error) { get().logEvent('DIAGNOSTIC', name, error); window.alert(error); return false }
    const configured = { ...get().namedSets.configured, [name]: definition }
    try { window.localStorage.setItem(NAMED_SETS_STORAGE_KEY, serializeNamedSets(configured)) }
    catch (error) {
      const message = `Named Set creation could not persist configuration: ${error instanceof Error ? error.message : String(error)}`
      get().logEvent('DIAGNOSTIC', name, message); window.alert(message); return false
    }
    set(s => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Named Set created; properties and Changed Setup Data transfer required')
    return true
  },

  applyNamedSetProperties: (expected, draft) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Named Set Properties ${expected.name}`)) return false
    const current = get().namedSets.configured[expected.name]
    const error = current !== expected ? 'Named Set changed or was removed; cancel and reopen Properties' :
      draft.name !== expected.name ? 'Named Set Properties cannot rename the set' : namedSetError(draft)
    if (error) { get().logEvent('DIAGNOSTIC', expected.name, error); window.alert(error); return false }
    const configured = { ...get().namedSets.configured, [draft.name]: cloneNamedSet(draft) }
    try { window.localStorage.setItem(NAMED_SETS_STORAGE_KEY, serializeNamedSets(configured)) }
    catch (error) {
      const message = `Named Set Properties could not persist configuration: ${error instanceof Error ? error.message : String(error)}`
      get().logEvent('DIAGNOSTIC', expected.name, message); window.alert(message); return false
    }
    set(s => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', draft.name, 'Named Set Properties saved to local configuration; setup transfer still required')
    return true
  },

  loadSavedNamedSets: () => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Load saved Named Sets')) return false
    let text: string | null
    try { text = window.localStorage.getItem(NAMED_SETS_STORAGE_KEY) }
    catch (error) {
      const message = `Saved Named Sets could not be read: ${error instanceof Error ? error.message : String(error)}`
      get().logEvent('DIAGNOSTIC', 'Named Sets', message); window.alert(message); return false
    }
    const parsed = text === null ? { error: 'No saved Named Sets exist for this browser profile' } : parseNamedSets(text)
    const configured = parsed.configured
    if (parsed.error || !configured) {
      const message = parsed.error ?? 'Saved Named Set configuration is missing'
      get().logEvent('DIAGNOSTIC', 'Named Sets', message); window.alert(message); return false
    }
    set(s => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', 'Named Sets', 'Saved Named Set configuration loaded; deployed setup data unchanged')
    return true
  },

  downloadChangedNamedSets: (target) => {
    if (!requireUnlockedLock('CAN_DOWNLOAD', 'Download Changed Setup Data: Named Sets')) return false
    const state = get()
    const controller = target.kind === 'controller' ? state.hardware.controllers[target.tag] : undefined
    const error = target.kind === 'controller' && (!controller || controllerIsDown(controller)) ?
      'Changed Setup Data requires an available commissioned target controller' :
      Object.values(state.namedSets.configured).map(definition => namedSetError(definition)).find(Boolean)
    if (error) { get().logEvent('DIAGNOSTIC', namedSetTargetKey(target), error); window.alert(error); return false }
    const changes = changedNamedSets(state.namedSets, target)
    if (!changes.length) {
      const message = 'No Named Set setup changes for this target'
      get().logEvent('DIAGNOSTIC', namedSetTargetKey(target), message); window.alert(message); return false
    }
    const deployed = { ...state.namedSets.deployed[namedSetTargetKey(target)] }
    for (const name of changes) {
      if (Object.hasOwn(state.namedSets.configured, name)) deployed[name] = cloneNamedSet(state.namedSets.configured[name])
      else delete deployed[name]
    }
    set(s => ({ namedSets: { ...s.namedSets, deployed: { ...s.namedSets.deployed,
      [namedSetTargetKey(target)]: deployed } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', namedSetTargetKey(target), `Changed Setup Data: ${changes.join(', ')}; simulated Named Set subset transferred atomically`)
    return true
  },

  enableSfcLifecycle: name => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Enable saved SFC lifecycle ${name}`)) return false
    const state = get()
    const sfc = state.sfcs[name]
    if (!sfc || state.sfcLifecycle[name] || sfc.status === 'RUNNING' || sfc.status === 'HELD') {
      return rejectSfc(get, name, 'Reset an unmanaged SFC before enabling Save/Download lifecycle')
    }
    const draft = cloneSfcConfiguration({ name, area: sfc.area, controllerTag: '', steps: sfc.steps, ...cloneSfcBlocks(sfc),
      ...(sfc.parameters ? { parameters: sfc.parameters } : {}) })
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { draft, online: false } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Saved SFC lifecycle enabled; Save and Download required before execution')
    return true
  },

  configureSfcController: (name, controllerTag, expected) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Assign SFC controller ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    if (expected && lifecycle?.draft !== expected) return rejectSfc(get, name, 'SFC configuration changed while Module Properties was open; reopen Properties')
    if (!lifecycle || lifecycle.online || state.sfcs[name]?.status === 'RUNNING' || state.sfcs[name]?.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline before assigning the configured SFC controller')
    }
    if (controllerTag && !state.hardware.controllers[controllerTag]) return rejectSfc(get, name, 'Configured target controller does not exist')
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle,
      draft: { ...lifecycle.draft, controllerTag } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `SFC configured controller: ${controllerTag || '(unassigned)'}`)
    return true
  },

  saveSfc: name => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Save SFC ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    if (!lifecycle || lifecycle.online) return rejectSfc(get, name, 'Go Offline to save the configured SFC')
    const error = sfcConfigurationError(lifecycle.draft, state.modules, state.namedSets.configured) ??
      (!state.areas.includes(lifecycle.draft.area) ? 'Configured SFC area no longer exists' : null)
    if (error) return rejectSfc(get, name, error)
    const saved = cloneSfcConfiguration(lifecycle.draft)
    try { window.localStorage.setItem(savedSfcKey(name), serializeSavedSfc(saved)) }
    catch (error) { return rejectSfc(get, name, `SFC Save failed: ${error instanceof Error ? error.message : String(error)}`) }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, saved } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'SFC configuration saved to browser; deployed algorithm unchanged')
    return true
  },

  loadSavedSfc: name => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Load saved SFC ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!lifecycle || lifecycle.online || !runtime || runtime.status === 'RUNNING' || runtime.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline before loading saved SFC configuration')
    }
    let text: string | null
    try { text = window.localStorage.getItem(savedSfcKey(name)) }
    catch (error) { return rejectSfc(get, name, `Saved SFC read failed: ${error instanceof Error ? error.message : String(error)}`) }
    if (text === null) return rejectSfc(get, name, 'No saved SFC configuration exists in this browser profile')
    const parsed = parseSavedSfc(text, state.modules, state.namedSets.configured)
    if (parsed.error !== undefined) return rejectSfc(get, name, parsed.error)
    if (parsed.configuration.name !== name || !state.areas.includes(runtime.area)) {
      return rejectSfc(get, name, 'Saved SFC name/area does not match the current project')
    }
    const saved = { ...parsed.configuration, area: runtime.area }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle,
      draft: cloneSfcConfiguration(saved), saved } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Saved SFC loaded into offline configuration; deployed algorithm unchanged')
    return true
  },

  downloadSavedSfc: (name, expected) => {
    if (!requireUnlockedLock('CAN_DOWNLOAD', `Download SFC ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!lifecycle?.saved || !runtime) return rejectSfc(get, name, 'Save the SFC before downloading')
    if (expected && expected !== lifecycle.saved) return rejectSfc(get, name, 'Saved SFC changed during confirmation; reopen Download')
    if (lifecycle.online || runtime.status === 'RUNNING' || runtime.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline before replacing the deployed SFC')
    }
    if (sfcDraftDirty(lifecycle)) return rejectSfc(get, name, 'Save current SFC edits before downloading')
    const saved = lifecycle.saved
    const controller = state.hardware.controllers[saved.controllerTag]
    const error = sfcConfigurationError(saved, state.modules, controllerNamedSets(state.namedSets, saved.controllerTag)) ??
      (!state.areas.includes(saved.area) ? 'Saved SFC area no longer exists' :
        !controller || controllerIsDown(controller) ? 'Assign an available commissioned controller and Save before downloading' : null)
    if (error) return rejectSfc(get, name, error)
    const deployed = cloneSfcConfiguration(saved)
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, deployed } },
      sfcs: { ...s.sfcs, [name]: { name, area: deployed.area, steps: cloneSfcConfiguration(deployed).steps,
        ...cloneSfcBlocks(deployed), blockStates: {},
        status: 'READY', active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined,
        parameters: cloneSfcParameters(deployed.parameters) } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `Saved SFC downloaded to ${saved.controllerTag}; READY, no actions executed`)
    return true
  },

  setSfcOnline: (name, online) => {
    if (useSecurity.getState().locked) {
      useSecurity.setState({ lastDenied: 'Access Denied — SFC Online requires an unlocked workstation' })
      return false
    }
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    if (!lifecycle) return rejectSfc(get, name, 'SFC does not use Save/Download lifecycle')
    const controller = lifecycle.deployed ? state.hardware.controllers[lifecycle.deployed.controllerTag] : undefined
    if (online && (!controller || controllerIsDown(controller))) {
      return rejectSfc(get, name, 'Download to an available controller before going Online')
    }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, online } } }))
    return true
  },

  configureSfcBlocks: (name, configuration, expected) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure SFC blocks/alarms ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!runtime || !lifecycle || lifecycle.draft !== expected || lifecycle.online ||
      runtime.status === 'RUNNING' || runtime.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline; reopen stale block/alarm Properties before editing')
    }
    const draft = { ...lifecycle.draft, blocks: undefined, alarmTypes: undefined, alarms: undefined,
      ...cloneSfcBlocks(configuration) }
    const error = sfcBlockConfigurationError(draft) ?? sfcStepsError(draft.steps, state.modules,
      { ...sfcExpressionContext(state, name), blocks: draft.blocks })
    if (error) return rejectSfc(get, name, error)
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'SFC function blocks/custom alarm types/alarms configured; Save/Download required')
    return true
  },

  configureSfcParameter: (name, parameter, binding, expected) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure SFC parameter ${name}/${parameter}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!runtime || !lifecycle || lifecycle.draft !== expected || lifecycle.online ||
      runtime?.status === 'RUNNING' || runtime?.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline; reopen stale parameter Properties before editing')
    }
    const parameters = { ...lifecycle.draft.parameters, [parameter]: { ...binding } }
    const error = sfcParameterError(parameters, state.namedSets.configured) ??
      sfcStepsError(lifecycle.draft.steps, state.modules, { name, parameters, sets: state.namedSets.configured, blocks: lifecycle.draft.blocks })
    if (error) return rejectSfc(get, name, error)
    const draft = { ...lifecycle.draft, parameters }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `${parameter} configured as ${binding.type === 'BOOLEAN' ? 'Boolean' : `Named Set ${binding.namedSet}`}; Save/Download required`)
    return true
  },

  writeSfcNamedValue: (name, parameter, value) => {
    if (!requireUnlockedLock('CONTROL', `Named Set data entry ${name}/${parameter}`)) return false
    const state = get()
    const deployed = state.sfcLifecycle[name]?.deployed
    const runtime = state.sfcs[name]
    const binding = runtime?.parameters && Object.hasOwn(runtime.parameters, parameter) ? runtime.parameters[parameter] : undefined
    const controller = deployed ? state.hardware.controllers[deployed.controllerTag] : undefined
    if (!binding || binding.type !== 'NAMED_SET' || !deployed || !controller || controllerIsDown(controller)) {
      return rejectSfc(get, name, 'Named Set entry requires a downloaded parameter on an available controller')
    }
    const controllerSet = controllerNamedSets(state.namedSets, deployed.controllerTag)[binding.namedSet]
    const workstationSet = state.namedSets.deployed.WORKSTATION?.[binding.namedSet]
    const selected = workstationSet?.entries.find(entry => entry.value === value)
    const target = controllerSet?.entries.find(entry => entry.value === value)
    if (!Number.isSafeInteger(value) || !selected || !target || selected.name !== target.name ||
      !selected.visible || !selected.userSelectable || !target.visible || !target.userSelectable) {
      return rejectSfc(get, name, 'Value is not a visible/selectable matching state in workstation and controller setup; transfer Changed Setup Data')
    }
    set(s => ({ sfcs: { ...s.sfcs, [name]: { ...runtime,
      parameters: { ...runtime.parameters, [parameter]: { ...binding, value } } } }, rev: s.rev + 1 }))
    get().logEvent('OPERATOR', name, `${parameter} := ${binding.namedSet}:${selected.name} (${value})`)
    return true
  },

  checkSfc: (name) => {
    const runtime = get().sfcs[name]
    const sfc = runtime ? sfcEditorDefinition(runtime, get().sfcLifecycle[name]) : undefined
    const error = !sfc ? `SFC ${name} does not exist` : !sfc.steps.length ?
      'SFC requires at least one step' : sfcBlockConfigurationError(sfc) ?? sfcParameterError(sfc.parameters,
        sfcExpressionContext(get(), name, !!get().sfcLifecycle[name]?.online).sets) ??
        sfcStepsError(sfc.steps, get().modules, { ...sfcExpressionContext(get(), name, !!get().sfcLifecycle[name]?.online),
          parameters: sfc.parameters ?? {} })
    get().logEvent(error ? 'DIAGNOSTIC' : 'CONFIGURE', name,
      error ? `SFC Check failed: ${error}` : 'SFC Check passed for supported actions/conditions, block/alarm references and routes')
    return error
  },

  applySfcStepProperties: (name, expected, patch, related = []) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Apply SFC properties ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    const sfc = runtime ? sfcEditorDefinition(runtime, lifecycle) : undefined
    const step = sfc?.steps.find(item => item.id === expected.id)
    const candidate = { ...expected, ...patch }
    const steps = sfc?.steps.map(item => {
      const change = related.find(entry => entry.expected.id === item.id)
      return item.id === expected.id ? candidate : change ? { ...item, ...change.patch } : item
    }) ?? []
    const error = !sfc || !step ? 'SFC or selected step no longer exists' :
      lifecycle?.online ? 'Go Offline to edit SFC configuration' :
      runtime?.status !== 'READY' && runtime?.status !== 'COMPLETE' ? 'Reset the SFC before applying Properties' :
      step !== expected ? 'Step changed while Properties was open; cancel and reopen to avoid overwriting edits' :
      related.some(entry => entry.expected.id === expected.id ||
        sfc.steps.find(item => item.id === entry.expected.id) !== entry.expected) ||
        new Set(related.map(entry => entry.expected.id)).size !== related.length ?
        'Related join step changed while Properties was open; cancel and reopen' :
      sfcStepsError(steps, state.modules, sfcExpressionContext(state, name))
    if (error) {
      get().logEvent('DIAGNOSTIC', name, `SFC Properties rejected: ${error}`); window.alert(error)
      return false
    }
    if (!sfc) return false
    if (lifecycle) {
      const draft = { ...lifecycle.draft, steps: cloneSfcConfiguration({ ...lifecycle.draft, steps }).steps }
      set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
      get().logEvent('CONFIGURE', name, `SFC step ${candidate.name} draft Properties applied; Save/Download required`)
      return true
    }
    set(s => ({ sfcs: { ...s.sfcs, [name]: { ...sfc, steps, active: 0, elapsed: 0,
      parameters: resetSfcBooleanActions(sfc),
      status: 'READY', actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `SFC step ${candidate.name} Properties applied`)
    return true
  },

  setSfcSteps: (name, steps) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Edit SFC ${name}`)) return
    const current = get().sfcs[name]
    const lifecycle = get().sfcLifecycle[name]
    if (!current || lifecycle?.online || current.status === 'RUNNING' || current.status === 'HELD') {
      const message = !current ? `SFC ${name} does not exist` : 'Reset the SFC and go Offline before editing its steps'
      get().logEvent('DIAGNOSTIC', name, message); window.alert(message)
      return
    }
    if (lifecycle) {
      const draft = { ...lifecycle.draft, steps: cloneSfcConfiguration({ ...lifecycle.draft, steps }).steps }
      set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
      get().logEvent('CONFIGURE', name, 'SFC draft steps edited; deployed algorithm unchanged')
      return
    }
    set((s) => {
      const sfc = s.sfcs[name]
      if (!sfc) return {}
      // Editing resets the run so the chart starts clean.
      return {
        sfcs: { ...s.sfcs, [name]: { ...sfc, steps, parameters: resetSfcBooleanActions(sfc), status: 'READY', active: 0, elapsed: 0, actionStates: {},
          activeSteps: undefined, joinArrivals: undefined, blockStates: {} } },
        rev: s.rev + 1
      }
    })
    get().logEvent('CONFIGURE', name, 'SFC steps edited')
  },

  sfcCommand: (name, cmd) => {
    if (!requireUnlockedLock('BATCH_OPERATE', `SFC command ${name}`)) return
    const current = get().sfcs[name]
    const lifecycle = get().sfcLifecycle[name]
    const controller = lifecycle?.deployed ? get().hardware.controllers[lifecycle.deployed.controllerTag] : undefined
    const error = !current ? `SFC ${name} does not exist` :
      lifecycle && (!lifecycle.online || !controller || controllerIsDown(controller)) ?
        'Managed SFC commands require Online and an available downloaded controller' : cmd === 'run' ?
      current.steps.length === 0 ? 'SFC requires at least one step' :
        sfcBlockConfigurationError(current) ?? sfcParameterError(current.parameters, sfcExpressionContext(get(), name, true).sets) ??
        sfcStepsError(current.steps, get().modules, { ...sfcExpressionContext(get(), name, true), parameters: current.parameters ?? {} }) : null
    if (error) {
      get().logEvent('DIAGNOSTIC', name, `SFC command rejected: ${error}`); window.alert(error)
      return
    }
    set((s) => {
      const sfc = s.sfcs[name]
      if (!sfc) return {}
      let next = sfc
      if (cmd === 'run') next = sfc.status === 'COMPLETE' ?
        { ...sfc, parameters: resetSfcBooleanActions(sfc), status: 'RUNNING', active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} } : { ...sfc, status: 'RUNNING' }
      else if (cmd === 'hold') next = { ...sfc, status: sfc.status === 'RUNNING' ? 'HELD' : sfc.status }
      else if (cmd === 'reset') next = { ...sfc, parameters: resetSfcBooleanActions(sfc), status: 'READY', active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} }
      return { sfcs: { ...s.sfcs, [name]: next }, rev: s.rev + 1 }
    })
    get().logEvent('BATCH', name, `SFC command: ${cmd}`)
  },

  newProject: (kind) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `New Project (${kind})`)) return
    const base = kind === 'blank' ? buildBlankPlant() : buildInitialPlant()
    set({
      ...base,
      trend: [],
      eventLog: [],
      batch: makeBatch(),
      phases: makeDefaultPhases(),
      sfcs: kind === 'blank' ? {} : makeDefaultSfcs(),
      equipment: kind === 'blank' ? makeBlankEquipment() : makeDefaultEquipment(),
      hardware: kind === 'blank' ? makeBlankHardware() : makeDefaultHardware(),
      moduleLifecycle: {},
      namedSets: { configured: {}, deployed: {} },
      sfcLifecycle: {},
      rev: get().rev + 1
    })
  }
}))

function rejectAo(get: () => StoreState, tag: string, message: string): false {
  get().logEvent('DIAGNOSTIC', tag, `AO action rejected: ${message}`)
  window.alert(message)
  return false
}

function mutateModule(
  set: (fn: (s: StoreState) => Partial<StoreState>) => void,
  get: () => StoreState,
  tag: string,
  fn: (m: AnyModule) => void
): void {
  const s = get()
  const existing = s.modules[tag]
  if (!existing) return
  const clone = { ...existing } as AnyModule
  fn(clone)
  set((st) => ({ modules: { ...st.modules, [tag]: clone }, rev: st.rev + 1 }))
}
