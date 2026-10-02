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
  AlarmPriority
} from './types'
import { buildInitialPlant, buildBlankPlant, makeModule, type NewModuleSpec } from './plant'
import { stepPlant } from './simulate'
import { advanceBatch, commandBatch, makeBatch, makeDefaultPhases, type BatchRuntime, type BatchCommand, type PhaseDef } from './batch'
import { advanceSfcs, makeSampleSfc, makeAutoclaveSfc, makeLyoSfc, type SfcDef, type SfcStep } from './sfc'
import { useSecurity } from './security'
import { makeDefaultEquipment, makeBlankEquipment, type EquipmentModule } from './equipment'
import { makeDefaultHardware, makeBlankHardware, type HardwareState } from './hardware'

const TREND_SECONDS = 600 // 10 minutes of history
const TREND_HZ = 2

interface StoreState extends PlantState {
  trend: TrendPoint[]
  rev: number
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
  // operator actions
  setMode: (tag: string, mode: ControlMode) => void
  setSetpoint: (tag: string, sp: number) => void
  setOutput: (tag: string, out: number) => void
  setTuning: (tag: string, t: { gain?: number; reset?: number; rate?: number }) => void
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
  /** CAS_IN_D connection health; false sheds a Cas/RCas PID to Auto. */
  setCasHealthy: (tag: string, healthy: boolean) => void
  /** Fail a controller leg (primary, or both legs if not redundant) — bound I/O goes Bad. */
  failController: (tag: string) => void
  restoreController: (tag: string) => void
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
  createModule: (spec: NewModuleSpec) => void
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

export const useStore = create<StoreState>((set, get) => ({
  ...initial,
  trend: [],
  rev: 0,
  batch: makeBatch(),
  phases: makeDefaultPhases(),
  sfcs: { 'STARTUP-T101': makeSampleSfc(), 'STERILIZE-AC1': makeAutoclaveSfc(), 'LYO-CYCLE-1': makeLyoSfc() },
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
      const point: TrendPoint = {
        t: next.time,
        values: {
          'FIC-101.PV': next.process.feedFlow,
          'FIC-101.SP': (next.modules['FIC-101'] as PidModule).sp,
          'LIC-101.PV': next.process.feedTankLevel,
          'LIC-101.SP': (next.modules['LIC-101'] as PidModule).sp,
          'LIC-201.PV': next.process.reactorLevel,
          'LIC-201.SP': (next.modules['LIC-201'] as PidModule).sp,
          'TIC-201.PV': next.process.reactorTemp,
          'TIC-201.SP': (next.modules['TIC-201'] as PidModule).sp,
          'PIC-301.PV': next.process.headerPressure,
          'PIC-301.SP': (next.modules['PIC-301'] as PidModule).sp,
          'AT-301.PV': next.process.reactorConc
        }
      }
      const cutoff = next.time - TREND_SECONDS * 1000
      newTrend = [...trend, point].filter((p) => p.t >= cutoff)
    }
    // A brand-new active alarm re-sounds the horn even if it was silenced.
    const priorIds = new Set(s.alarms.map((a) => a.id))
    const hasNewAlarm = next.alarms.some((a) => a.active && !priorIds.has(a.id))
    set({
      ...next,
      trend: newTrend,
      batch,
      sfcs,
      rev: s.rev + 1,
      hornSilenced: hasNewAlarm ? false : s.hornSilenced
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
  },

  setSetpoint: (tag, sp) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set Setpoint ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.sp = Math.max(p.pvMin, Math.min(p.pvMax, sp))
      }
    })
  },

  setOutput: (tag, out) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set Output ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (p.mode === 'MAN' || p.mode === 'ROUT') p.out = Math.max(0, Math.min(100, out))
      }
    })
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
  },

  setAlarmLimit: (tag, type, patch) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Configure alarm ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      const lim = m.alarms.find((a) => a.type === type)
      if (!lim) return
      if (patch.limit !== undefined) lim.limit = patch.limit
      if (patch.enabled !== undefined) lim.enabled = patch.enabled
      if (patch.priority !== undefined) lim.priority = patch.priority
    })
  },

  startMotor: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Start ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = true
    })
  },

  stopMotor: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Stop ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = false
    })
  },

  openValve: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Open ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = true
    })
  },

  closeValve: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Close ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = false
    })
  },

  toggleDO: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Toggle ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'DO') {
        const d = m as DiscreteOutput
        d.commanded = !d.commanded
        d.state = d.commanded
      }
    })
  },

  toggleInterlock: (tag) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Force Interlock ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).interlock = !(m as MotorModule).interlock
      if (m.type === 'VALVE') (m as ValveModule).interlock = !(m as ValveModule).interlock
    })
  },

  injectFault: (tag) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Inject Fault ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).fault = !(m as MotorModule).fault
      if (m.type === 'VALVE') (m as ValveModule).fault = !(m as ValveModule).fault
    })
  },

  resetDevice: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Reset ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') (m as MotorModule | ValveModule).locked = false
    })
  },

  setPermissive: (tag, ok) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Set Permissive ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') (m as MotorModule | ValveModule).permissiveOk = ok
    })
  },

  setDeviceOptions: (tag, opts) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Configure device options ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'MOTOR' && m.type !== 'VALVE') return
      const d = m as MotorModule | ValveModule
      if (opts.permissiveRequired !== undefined) d.permissiveRequired = opts.permissiveRequired
      if (opts.resetRequired !== undefined) d.resetRequired = opts.resetRequired
    })
  },

  setCasHealthy: (tag, healthy) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Force cascade ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') (m as PidModule).casHealthy = healthy
    })
  },

  failController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Fail controller ${tag}`)) return
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c) return {}
      const next = c.redundant
        ? c.primary === 'ACTIVE'
          ? { ...c, primary: 'FAILED' as const, secondary: 'ACTIVE' as const }
          : { ...c, secondary: 'FAILED' as const }
        : { ...c, primary: 'FAILED' as const }
      return { hardware: { ...s.hardware, controllers: { ...s.hardware.controllers, [tag]: next } }, rev: s.rev + 1 }
    })
  },

  restoreController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Restore controller ${tag}`)) return
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c) return {}
      const next = c.redundant
        ? { ...c, primary: 'ACTIVE' as const, secondary: 'STANDBY' as const }
        : { ...c, primary: 'ACTIVE' as const }
      return { hardware: { ...s.hardware, controllers: { ...s.hardware.controllers, [tag]: next } }, rev: s.rev + 1 }
    })
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
  },

  ackAlarm: (id) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Acknowledge alarm')) return
    set((s) => ({
      alarms: s.alarms
        .map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
        .filter((a) => a.active || !a.acknowledged),
      rev: s.rev + 1
    }))
  },

  ackAll: () => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Acknowledge All')) return
    set((s) => ({
      alarms: s.alarms.map((a) => ({ ...a, acknowledged: true })).filter((a) => a.active),
      rev: s.rev + 1
    }))
  },

  shelveAlarm: (id, durationMin) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Shelve alarm')) return
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, shelvedUntil: s.time + durationMin * 60000 } : a)),
      rev: s.rev + 1
    }))
  },

  unshelveAlarm: (id) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Unshelve alarm')) return
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, shelvedUntil: undefined } : a)),
      rev: s.rev + 1
    }))
  },

  setRunning: (r) => set({ running: r }),
  setSpeed: (speed) => set({ speed }),

  batchCommand: (cmd) => {
    if (!useSecurity.getState().requireLock('BATCH_OPERATE', 'Batch command')) return
    set((s) => ({ batch: commandBatch(s.batch, cmd, s.time, s.phases), rev: s.rev + 1 }))
  },

  setPhaseSteps: (phaseName, steps) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit Phase ${phaseName}`)) return
    set((s) => {
      const def = s.phases[phaseName]
      if (!def) return {}
      return { phases: { ...s.phases, [phaseName]: { ...def, steps } }, rev: s.rev + 1 }
    })
  },

  createModule: (spec) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create module ${spec.tag}`)) return
    set((s) => {
      if (s.modules[spec.tag]) return {}
      return { modules: { ...s.modules, [spec.tag]: makeModule(spec) }, rev: s.rev + 1 }
    })
  },

  deleteModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete module ${tag}`)) return
    set((s) => {
      if (!s.modules[tag]) return {}
      const modules = { ...s.modules }
      delete modules[tag]
      return { modules, alarms: s.alarms.filter((a) => a.moduleTag !== tag), rev: s.rev + 1 }
    })
  },

  createEquipmentModule: (tag, description, area) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create Equipment Module ${tag}`)) return
    set((s) => {
      const key = tag.trim().toUpperCase()
      if (!key || s.equipment[key]) return {}
      return { equipment: { ...s.equipment, [key]: { tag: key, description, area } }, rev: s.rev + 1 }
    })
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
  },

  setModuleEquipment: (moduleTag, emTag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Assign ${moduleTag} to Equipment Module`)) return
    mutateModule(set, get, moduleTag, (m) => {
      m.equipmentModule = emTag ?? undefined
    })
  },

  createSfc: (name, area) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create SFC ${name}`)) return
    set((s) => {
      const key = name.trim().toUpperCase()
      if (!key || s.sfcs[key]) return {}
      const sfc: SfcDef = { name: key, area, steps: [], status: 'READY', active: 0, elapsed: 0 }
      return { sfcs: { ...s.sfcs, [key]: sfc }, rev: s.rev + 1 }
    })
  },

  deleteSfc: (name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete SFC ${name}`)) return
    set((s) => {
      if (!s.sfcs[name]) return {}
      const sfcs = { ...s.sfcs }
      delete sfcs[name]
      return { sfcs, rev: s.rev + 1 }
    })
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
  },

  newProject: (kind) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `New Project (${kind})`)) return
    const base = kind === 'blank' ? buildBlankPlant() : buildInitialPlant()
    set({
      ...base,
      trend: [],
      batch: makeBatch(),
      phases: makeDefaultPhases(),
      sfcs: kind === 'blank' ? {} : { 'STARTUP-T101': makeSampleSfc(), 'STERILIZE-AC1': makeAutoclaveSfc(), 'LYO-CYCLE-1': makeLyoSfc() },
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
