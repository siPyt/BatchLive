// ---------------------------------------------------------------------------
// DeltaV Live Simulator — core type model
// Mirrors DeltaV control-module concepts: modules, parameters, modes, alarms.
// ---------------------------------------------------------------------------

export type ModuleType = 'PID' | 'AI' | 'DI' | 'DO' | 'MOTOR' | 'VALVE' | 'FB'

/** DeltaV control modes for a function block. IMAN (Initialization Manual) is
 * an actual-mode-only state: the block has a downstream cascade consumer that
 * hasn't accepted Cas/RCas yet ("Not Invited"), so it can't close the loop. */
export type ControlMode = 'MAN' | 'AUTO' | 'CAS' | 'ROUT' | 'RCAS' | 'IMAN'

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
  /** ISA-18.2 Shelving: epoch ms the shelf expires, or undefined if not shelved. */
  shelvedUntil?: number
}

/** DeltaV Event Chronicle categories: process alarms plus the operator/system actions that make up the audit trail. */
export type EventCategory =
  | 'ALARM'
  | 'RTN'
  | 'ACK'
  | 'OPERATOR'
  | 'DIAGNOSTIC'
  | 'SECURITY'
  | 'BATCH'
  | 'CONFIGURE'

/** One row of the Alarm & Event Journal — a 21 CFR Part 11 style audit trail entry. */
export interface EventLogEntry {
  id: string
  time: number
  category: EventCategory
  tag: string
  description: string
  user: string
  priority?: AlarmPriority
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
  /** FF_ENABLE/FF_GAIN/FF_VAL: feedforward term (source value * ffGain) added to OUT ahead of the measured disturbance. */
  ffEnable: boolean
  ffGain: number
  ffSource?: string
  /** TRK_IN_D/TRK_VAL: while trackSource is a non-zero tag, OUT is bumplessly forced to trackValueSource (or trackValue). */
  trackEnable: boolean
  trackSource?: string
  trackValueSource?: string
  trackValue: number
  direct: boolean // true = direct acting (PV up -> OUT up)
  // internal integrator term
  _integral: number
  // derivative-on-measurement state (DeltaV default STRUCTURE: D acts on PV)
  _prevPv: number
  _dFilt: number
  alarms: AlarmLimit[]
  /** STATUS.QUALITY = BAD — PV is frozen (CHARM pulled or controller down). */
  pvBad: boolean
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
  /** STATUS.QUALITY = BAD — PV is frozen (CHARM pulled or controller down). */
  pvBad: boolean
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

/** Math/Logic/Timer/Analog-Control utility blocks (DeltaV Function Block
 * Reference categories: I/O, Math, Logical, Timer/Counter, and Analog
 * Control blocks). Operator/engineer-creatable from the Control Studio
 * palette, each wired to a constant or to another module's live value.
 * Codes are the exact DeltaV Function Block Reference abbreviations
 * (D800018X012), e.g. MLTY = Multiply, RTO = Ratio, OND/OFFD = On/Off-Delay
 * Timer, RET = Retentive Timer, SCLR = Scaler, SGCR = Signal Characterizer,
 * SGGN = Signal Generator, SGSL = Signal Selector, SPLTR = Splitter. */
export type FbBlockType =
  // I/O Blocks
  | 'ALARM'
  | 'MAI'
  | 'FFMDI'
  | 'FFMDO'
  | 'PIN'
  // Math Blocks
  | 'ABS'
  | 'ADD'
  | 'ARITH'
  | 'CMP'
  | 'DIV'
  | 'INT'
  | 'MLTY'
  | 'SUB'
  // Timer/Counter Blocks
  | 'CTR'
  | 'DTE'
  | 'OFFD'
  | 'OND'
  | 'RET'
  | 'TP'
  // Logical Blocks
  | 'ACT'
  | 'AND'
  | 'BDE'
  | 'BFI'
  | 'BFO'
  | 'CND'
  | 'MLTX'
  | 'NDE'
  | 'NOT'
  | 'OR'
  | 'PDE'
  | 'RS'
  | 'SR'
  // Analog Control Blocks
  | 'BG'
  | 'CALC'
  | 'CTLSL'
  | 'DT'
  | 'FLTR'
  | 'INSEL'
  | 'ISELX'
  | 'LE'
  | 'LL'
  | 'LIM'
  | 'MANLD'
  | 'RAMP'
  | 'RTLM'
  | 'RTO'
  | 'SCLR'
  | 'SGCR'
  | 'SGGN'
  | 'SGSL'
  | 'SPLTR'

export type FbCompareOp = '>' | '<' | '>=' | '<=' | '=='

/** One function-block input: either an operator-entered constant, or a live
 * reference to another module's value (PV/OUT/state, resolved each tick). */
export interface FbInputRef {
  kind: 'const' | 'ref'
  value: number
  tag?: string
}

export interface FunctionBlockModule {
  tag: string
  type: 'FB'
  fbType: FbBlockType
  description: string
  area: string
  /** Equipment Module this Control Module belongs to, if any. */
  equipmentModule?: string
  in1: FbInputRef
  in2: FbInputRef
  /** BG/ARITH: gain. RTO: ratio. RAMP/RTLM: rate (EU/s). SCLR/SGCR: scale factor. */
  gain: number
  /** BG/ARITH: bias. LIM: low limit. SCLR: input low. RAMP/SPLTR: target/threshold. */
  bias: number
  /** CMP/CND/CTLSL/INSEL/ISELX/SGSL: comparison or selection operator. */
  cmpOp: FbCompareOp
  /** CALC/ACT/CND: single-line expression using IN1/IN2, basic arithmetic and parentheses only (no eval). */
  expr: string
  /** OND/OFFD/RET/TP/DT/FLTR/LL/PIN/SGGN: delay, time constant, or period in seconds. */
  delaySec: number
  /** CTR: trip value. BFO/FFMDO: bit index to extract. */
  tripValue: number
  /** CTR: true = count up, false = count down from 0. */
  countUp: boolean
  /** Computed result (1/0 for logic/timer/counter types). */
  out: number
  alarms: AlarmLimit[]
  _timerElapsed: number
  _timerOutput: boolean
  _count: number
  _prevIn: boolean
  /** LL: previous sample of IN1, for the lead term. */
  _prevValue: number
  /** DT (Deadtime): rolling {time, value} queue used to replay IN1 after delaySec. */
  _buffer: { t: number; v: number }[]
}

export type AnyModule =
  | PidModule
  | AnalogIndicator
  | MotorModule
  | ValveModule
  | DiscreteInput
  | DiscreteOutput
  | FunctionBlockModule

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
