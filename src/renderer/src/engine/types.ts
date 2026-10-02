// ---------------------------------------------------------------------------
// DeltaV Live Simulator — core type model
// Mirrors DeltaV control-module concepts: modules, parameters, modes, alarms.
// ---------------------------------------------------------------------------

export type ModuleType = 'PID' | 'AI' | 'DI' | 'DO' | 'MOTOR' | 'VALVE'

/** DeltaV control modes for a function block. */
export type ControlMode = 'MAN' | 'AUTO' | 'CAS' | 'ROUT' | 'RCAS'

/** DeltaV-style alarm priorities (drive banner color + sort order). */
export type AlarmPriority = 'CRITICAL' | 'WARNING' | 'ADVISORY'

export type AlarmType =
  | 'HI_HI'
  | 'HI'
  | 'LO'
  | 'LO_LO'
  | 'DV_HI'
  | 'DV_LO'
  | 'PVBAD'
  | 'FAIL'
  | 'INTERLOCK'

export interface AlarmLimit {
  type: AlarmType
  label: string
  priority: AlarmPriority
  /** Trip setpoint in engineering units (undefined for discrete/fail alarms). */
  limit?: number
  enabled: boolean
}

export interface ActiveAlarm {
  id: string
  moduleTag: string
  moduleDesc: string
  type: AlarmType
  label: string
  priority: AlarmPriority
  value: number
  unit: string
  active: boolean
  acknowledged: boolean
  /** epoch ms when the alarm went active. */
  time: number
}

/** A simulated engineering-unit analog measurement. */
export interface AnalogParam {
  value: number
  unit: string
  min: number
  max: number
  decimals: number
}

export interface PidModule {
  tag: string
  type: 'PID'
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  mode: ControlMode // target mode (what the operator/host requested)
  /** actual mode the block is executing in; differs from `mode` while shed. */
  actualMode: ControlMode
  pv: number
  sp: number
  out: number // 0-100 %
  unit: string
  pvMin: number
  pvMax: number
  decimals: number
  // tuning
  gain: number
  reset: number // integral time, seconds/repeat
  rate: number // derivative time, seconds
  // cascade linkage
  casSource?: string // tag that supplies remote SP when in CAS
  /** health of the CAS_IN_D remote connection; false forces a shed to Auto (SHED_OPT). */
  casHealthy: boolean
  direct: boolean // true = direct acting (PV up -> OUT up)
  // internal integrator term
  _integral: number
  // derivative-on-measurement state (DeltaV default STRUCTURE: D acts on PV)
  _prevPv: number
  _dFilt: number
  alarms: AlarmLimit[]
}

export interface AnalogIndicator {
  tag: string
  type: 'AI'
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  pv: number
  unit: string
  pvMin: number
  pvMax: number
  decimals: number
  alarms: AlarmLimit[]
}

/**
 * DeltaV Device Control (DC1) block state, DC_STATE. Mirrors the real block:
 * two steady states (Passive/Active), their transient "Going to" states, and
 * the failure/special states (Failed, Shutdown/Interlocked, Locked).
 */
export type DcState =
  | 'CONFIRMED_PASSIVE'
  | 'CONFIRMED_ACTIVE'
  | 'GOING_PASSIVE'
  | 'GOING_ACTIVE'
  | 'FAILED_PASSIVE'
  | 'FAILED_ACTIVE'
  | 'SHUTDOWN'
  | 'LOCKED'

export interface MotorModule {
  tag: string
  type: 'MOTOR'
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  running: boolean
  commanded: boolean
  /** true while transitioning / feedback mismatch. */
  fault: boolean
  /** INTERLOCK_D: true = tripped (forces Passive / Shutdown). */
  interlock: boolean
  /** PERMISSIVE_D: must be true to leave Passive when permissiveRequired is set. */
  permissiveOk: boolean
  /** Permissive device option — gates Passive -> Active transitions. */
  permissiveRequired: boolean
  /** Reset Required device option — after a trip, stays Locked until RESET_D. */
  resetRequired: boolean
  /** DC_STATE = Locked, awaiting an explicit RESET_D (operator Reset). */
  locked: boolean
  /** CFM_ACT_TIME / CFM_PASS_TIME — seconds allowed to confirm a transition. */
  confirmTimeSec: number
  /** TRAVEL_TIMER — seconds elapsed in the current transition. */
  travelTimer: number
  dcState: DcState
  runtimeHrs: number
  alarms: AlarmLimit[]
}

export interface ValveModule {
  tag: string
  type: 'VALVE'
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  /** command open (true) / closed (false) for on-off valves. */
  commandedOpen: boolean
  open: boolean
  fault: boolean
  /** INTERLOCK_D: true = tripped (forces Passive / Shutdown). */
  interlock: boolean
  /** PERMISSIVE_D: must be true to leave Passive when permissiveRequired is set. */
  permissiveOk: boolean
  /** Permissive device option — gates Passive -> Active transitions. */
  permissiveRequired: boolean
  /** Reset Required device option — after a trip, stays Locked until RESET_D. */
  resetRequired: boolean
  /** DC_STATE = Locked, awaiting an explicit RESET_D (operator Reset). */
  locked: boolean
  /** CFM_ACT_TIME / CFM_PASS_TIME — seconds allowed to confirm a transition (valve travel time). */
  confirmTimeSec: number
  /** TRAVEL_TIMER — seconds elapsed in the current transition. */
  travelTimer: number
  dcState: DcState
  alarms: AlarmLimit[]
}

export interface DiscreteInput {
  tag: string
  type: 'DI'
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  state: boolean
  activeDescriptor: string
  inactiveDescriptor: string
  alarms: AlarmLimit[]
}

export interface DiscreteOutput {
  tag: string
  type: 'DO'
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  state: boolean
  commanded: boolean
  activeDescriptor: string
  inactiveDescriptor: string
  alarms: AlarmLimit[]
}

export type AnyModule =
  | PidModule
  | AnalogIndicator
  | MotorModule
  | ValveModule
  | DiscreteInput
  | DiscreteOutput

export interface TrendPoint {
  t: number
  values: Record<string, number>
}

export interface PlantState {
  time: number
  running: boolean
  speed: number // sim speed multiplier
  modules: Record<string, AnyModule>
  alarms: ActiveAlarm[]
  // physical process reservoirs the engine integrates
  process: {
    feedTankLevel: number // %
    reactorLevel: number // %
    reactorTemp: number // degC
    headerPressure: number // kPa
    feedFlow: number // m3/h
    productFlow: number // m3/h
    reactorConc: number // %
  }
}
