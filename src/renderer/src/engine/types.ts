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
  | 'DEV_HI'
  | 'DEV_LO'
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
  mode: ControlMode
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
  direct: boolean // true = direct acting (PV up -> OUT up)
  // internal integrator term
  _integral: number
  alarms: AlarmLimit[]
}

export interface AnalogIndicator {
  tag: string
  type: 'AI'
  description: string
  area: string
  pv: number
  unit: string
  pvMin: number
  pvMax: number
  decimals: number
  alarms: AlarmLimit[]
}

export interface MotorModule {
  tag: string
  type: 'MOTOR'
  description: string
  area: string
  running: boolean
  commanded: boolean
  /** true while transitioning / feedback mismatch. */
  fault: boolean
  interlock: boolean
  runtimeHrs: number
  alarms: AlarmLimit[]
}

export interface ValveModule {
  tag: string
  type: 'VALVE'
  description: string
  area: string
  /** command open (true) / closed (false) for on-off valves. */
  commandedOpen: boolean
  open: boolean
  fault: boolean
  interlock: boolean
  alarms: AlarmLimit[]
}

export interface DiscreteInput {
  tag: string
  type: 'DI'
  description: string
  area: string
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
