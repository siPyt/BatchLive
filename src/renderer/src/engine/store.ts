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
  AnalogSignalRef
} from './types'
import { buildInitialPlant, buildBlankPlant, makeModule, type NewModuleSpec } from './plant'
import { stepPlant } from './simulate'
import { clonePidIo, configurePidIo, pidIoPatchError, signalError } from './analogStrategy'
import { configureSplitter, createSplitter } from './splitter'
import { areaNameError } from './areas'
import { moduleNameError } from './naming'
import {
  analogBindingError, channelConfigurationError, discreteBindingError, findDst, makeTraditionalCard,
  type AnalogBindingPort, type TraditionalCardType
} from './traditionalIo'
import { advanceBatch, commandBatch, makeBatch, makeDefaultPhases, type BatchRuntime, type BatchCommand, type PhaseDef } from './batch'
import { advanceSfcs, makeSampleSfc, makeAutoclaveSfc, makeLyoSfc, makeCipSfc, type SfcDef, type SfcStep } from './sfc'
import { useSecurity } from './security'
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
  addTraditionalCard: (controllerTag: string, slot: number, type: TraditionalCardType) => boolean
  configureTraditionalChannel: (cardId: string, channel: number,
    patch: { dst: string; enabled: boolean; tiebackDst?: string }) => boolean
  setTraditionalInput: (dst: string, value: number) => boolean
  bindDiscreteDst: (tag: string, dst: string) => boolean
  bindAnalogDst: (tag: string, port: AnalogBindingPort, dst: string) => boolean
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
  createSfc: (name: string, area: string) => void
  deleteSfc: (name: string) => void
  setSfcSteps: (name: string, steps: SfcStep[]) => void
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
  hornSilenced: false,

  tick: (dt: number) => {
    const s = get()
    if (!s.running) return
    // Advance the batch first so phase actions set modes/SPs/commands before physics.
    const { modules: cmdModules, batch } = advanceBatch(s, dt, s.time + dt * 1000 * s.speed)
    const { modules: sfcModules, sfcs } = advanceSfcs(s, cmdModules, dt)
    const next = stepPlant({ ...s, modules: sfcModules }, dt)
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
        if (gm.type === 'PID') {
          values[`${t}.PV`] = gm.pv
          values[`${t}.SP`] = gm.sp
        } else if (gm.type === 'AI') {
          values[`${t}.PV`] = gm.pv
        }
      }
      const point: TrendPoint = { t: next.time, values }
      const cutoff = next.time - TREND_SECONDS * 1000
      newTrend = [...trend, point].filter((p) => p.t >= cutoff)
    }
    // A brand-new active alarm re-sounds the horn even if it was silenced.
    const priorIds = new Set(s.alarms.map((a) => a.id))
    const hasNewAlarm = next.alarms.some((a) => a.active && !priorIds.has(a.id))
    // Journal every alarm transition: newly active alarms and returns-to-normal.
    const priorById = new Map(s.alarms.map((a) => [a.id, a]))
    const nextById = new Map(next.alarms.map((a) => [a.id, a]))
    const newEntries: EventLogEntry[] = []
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
      return {
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
    set((s) => ({ batch: commandBatch(s.batch, cmd, s.time, s.phases), rev: s.rev + 1 }))
    get().logEvent('BATCH', get().batch.id, `Batch command: ${cmd}`)
  },

  setPhaseSteps: (phaseName, steps) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit Phase ${phaseName}`)) return
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
      rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', key, `Plant area renamed from ${name}`)
    return true
  },

  createModule: (spec) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create module ${spec.tag}`)) return false
    const tag = spec.tag.trim().toUpperCase()
    const state = get()
    const error = moduleNameError(tag) ?? (state.modules[tag] ? `Module ${tag} already exists` :
      !state.areas.includes(spec.area) ? `Area ${spec.area} does not exist` : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Module creation rejected: ${error}`)
      window.alert(error)
      return false
    }
    set(s => ({ modules: { ...s.modules, [tag]: makeModule({ ...spec, tag }) }, rev: s.rev + 1 }))
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
        ? { ...channel, ...normalized, bad: true } : channel) } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, `Channel ${channelNumber}: DST ${normalized.dst || '(none)'}, enabled ${normalized.enabled}, simulated tieback ${normalized.tiebackDst ?? '(none)'}`)
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

  bindAnalogDst: (tag, port, dst) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Bind ${tag} ${port} traditional I/O`)) return false
    const normalized = dst.trim().toUpperCase()
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
      return { modules, hardware: { ...s.hardware, discreteBindings: bindings, analogBindings },
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

  createSfc: (name, area) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create SFC ${name}`)) return
    if (!get().areas.includes(area)) {
      const message = `Area ${area} does not exist`
      get().logEvent('DIAGNOSTIC', name, `SFC creation rejected: ${message}`)
      window.alert(message)
      return
    }
    set((s) => {
      const key = name.trim().toUpperCase()
      if (!key || s.sfcs[key]) return {}
      const sfc: SfcDef = { name: key, area, steps: [], status: 'READY', active: 0, elapsed: 0 }
      return { sfcs: { ...s.sfcs, [key]: sfc }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', name, 'SFC created')
  },

  deleteSfc: (name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete SFC ${name}`)) return
    set((s) => {
      if (!s.sfcs[name]) return {}
      const sfcs = { ...s.sfcs }
      delete sfcs[name]
      return { sfcs, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', name, 'SFC deleted')
  },

  setSfcSteps: (name, steps) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit SFC ${name}`)) return
    set((s) => {
      const sfc = s.sfcs[name]
      if (!sfc) return {}
      // Editing resets the run so the chart starts clean.
      return {
        sfcs: { ...s.sfcs, [name]: { ...sfc, steps, status: 'READY', active: 0, elapsed: 0 } },
        rev: s.rev + 1
      }
    })
    get().logEvent('CONFIGURE', name, 'SFC steps edited')
  },

  sfcCommand: (name, cmd) => {
    if (!useSecurity.getState().requireLock('BATCH_OPERATE', `SFC command ${name}`)) return
    set((s) => {
      const sfc = s.sfcs[name]
      if (!sfc) return {}
      let next = sfc
      if (cmd === 'run') next = { ...sfc, status: 'RUNNING' }
      else if (cmd === 'hold') next = { ...sfc, status: sfc.status === 'RUNNING' ? 'HELD' : sfc.status }
      else if (cmd === 'reset') next = { ...sfc, status: 'READY', active: 0, elapsed: 0 }
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
      rev: get().rev + 1
    })
  }
}))

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
