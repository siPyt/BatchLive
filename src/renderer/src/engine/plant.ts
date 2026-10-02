import type {
  PlantState,
  PidModule,
  AnalogIndicator,
  MotorModule,
  ValveModule,
  DiscreteInput,
  DiscreteOutput,
  AnyModule,
  ModuleType
} from './types'
import { DEFAULT_MEMBERSHIP } from './equipment'

// Helper builders keep the plant definition compact and readable.

/** Tags wired into the hardcoded plant physics (cannot be deleted). */
export const BUILTIN_TAGS = new Set([
  'FIC-101',
  'LIC-101',
  'LIC-201',
  'TIC-201',
  'PIC-301',
  'AT-301',
  'TI-101',
  'P-101',
  'P-201',
  'XV-101',
  'XV-201',
  'LSH-101',
  'HS-201'
])
function pid(p: Partial<PidModule> & Pick<PidModule, 'tag' | 'description' | 'area' | 'unit'>): PidModule {
  const m: PidModule = {
    type: 'PID',
    mode: 'AUTO',
    actualMode: 'AUTO',
    pv: 0,
    sp: 0,
    out: 0,
    pvMin: 0,
    pvMax: 100,
    decimals: 1,
    gain: 1,
    reset: 20,
    rate: 0,
    casHealthy: true,
    direct: false,
    _integral: 0,
    _prevPv: 0,
    _dFilt: 0,
    alarms: [],
    ...p
  }
  // Bumpless startup: begin at setpoint and hold the configured output so the
  // integrator does not have to wind up from zero on the first scan.
  m.pv = m.sp
  m._prevPv = m.sp
  m._integral = m.out
  m.actualMode = m.mode
  // Every PID has an implicit AI (PV) and AO (OUT) function block, each of
  // which can go Bad on an I/O (CHARM) fault.
  if (!m.alarms.some((a) => a.type === 'PVBAD')) {
    m.alarms = [...m.alarms, { type: 'PVBAD', label: 'PV BAD', priority: 'CRITICAL', enabled: true }]
  }
  return m
}

function ai(p: Partial<AnalogIndicator> & Pick<AnalogIndicator, 'tag' | 'description' | 'area' | 'unit'>): AnalogIndicator {
  const m: AnalogIndicator = {
    type: 'AI',
    pv: 0,
    pvMin: 0,
    pvMax: 100,
    decimals: 1,
    alarms: [],
    ...p
  }
  if (!m.alarms.some((a) => a.type === 'PVBAD')) {
    m.alarms = [...m.alarms, { type: 'PVBAD', label: 'PV BAD', priority: 'CRITICAL', enabled: true }]
  }
  return m
}

/**
 * The simulated plant: Feed system -> Reactor -> Product.
 * Classic cascade: LIC-101 (reactor-feed-tank level) sets the remote SP of
 * FIC-101 (feed flow) which throttles the feed valve.
 */
export function buildInitialPlant(): PlantState {
  const modules: Record<string, AnyModule> = {}

  const add = (m: AnyModule): void => {
    modules[m.tag] = m
  }

  // --- Feed flow controller (slave of cascade) ---------------------------
  add(
    pid({
      tag: 'FIC-101',
      description: 'FEED FLOW TO REACTOR',
      area: 'FEED',
      unit: 'm3/h',
      pvMin: 0,
      pvMax: 120,
      sp: 60,
      out: 50,
      mode: 'CAS',
      casSource: 'LIC-101',
      gain: 0.8,
      reset: 8,
      direct: false,
      alarms: [
        { type: 'HI', label: 'HI', priority: 'ADVISORY', limit: 110, enabled: true },
        { type: 'LO', label: 'LO', priority: 'ADVISORY', limit: 8, enabled: true }
      ]
    })
  )

  // --- Feed tank level controller (master of cascade) --------------------
  add(
    pid({
      tag: 'LIC-101',
      description: 'FEED TANK LEVEL',
      area: 'FEED',
      unit: '%',
      pvMin: 0,
      pvMax: 100,
      sp: 55,
      out: 50,
      mode: 'AUTO',
      gain: 1.6,
      reset: 30,
      direct: false,
      alarms: [
        { type: 'HI_HI', label: 'HI HI', priority: 'CRITICAL', limit: 90, enabled: true },
        { type: 'HI', label: 'HI', priority: 'WARNING', limit: 80, enabled: true },
        { type: 'LO', label: 'LO', priority: 'WARNING', limit: 25, enabled: true },
        { type: 'LO_LO', label: 'LO LO', priority: 'CRITICAL', limit: 15, enabled: true }
      ]
    })
  )

  // --- Reactor level controller -----------------------------------------
  add(
    pid({
      tag: 'LIC-201',
      description: 'REACTOR LEVEL',
      area: 'REACTOR',
      unit: '%',
      pvMin: 0,
      pvMax: 100,
      sp: 50,
      out: 45,
      mode: 'AUTO',
      gain: 1.2,
      reset: 25,
      direct: true,
      alarms: [
        { type: 'HI_HI', label: 'HI HI', priority: 'CRITICAL', limit: 90, enabled: true },
        { type: 'HI', label: 'HI', priority: 'WARNING', limit: 80, enabled: true },
        { type: 'LO', label: 'LO', priority: 'WARNING', limit: 20, enabled: true },
        { type: 'LO_LO', label: 'LO LO', priority: 'CRITICAL', limit: 10, enabled: true }
      ]
    })
  )

  // --- Reactor temperature controller (steam) ---------------------------
  add(
    pid({
      tag: 'TIC-201',
      description: 'REACTOR TEMPERATURE',
      area: 'REACTOR',
      unit: 'degC',
      pvMin: 0,
      pvMax: 200,
      decimals: 1,
      sp: 85,
      out: 40,
      mode: 'AUTO',
      gain: 2.2,
      reset: 45,
      rate: 2,
      direct: false,
      alarms: [
        { type: 'HI_HI', label: 'HI HI', priority: 'CRITICAL', limit: 120, enabled: true },
        { type: 'HI', label: 'HI', priority: 'WARNING', limit: 100, enabled: true },
        { type: 'LO', label: 'LO', priority: 'ADVISORY', limit: 55, enabled: true }
      ]
    })
  )

  // --- Header pressure controller ---------------------------------------
  add(
    pid({
      tag: 'PIC-301',
      description: 'PRODUCT HEADER PRESSURE',
      area: 'PRODUCT',
      unit: 'kPa',
      pvMin: 0,
      pvMax: 500,
      decimals: 0,
      sp: 250,
      out: 50,
      mode: 'AUTO',
      gain: 1.0,
      reset: 12,
      direct: true,
      alarms: [
        { type: 'HI_HI', label: 'HI HI', priority: 'CRITICAL', limit: 420, enabled: true },
        { type: 'HI', label: 'HI', priority: 'WARNING', limit: 360, enabled: true },
        { type: 'LO', label: 'LO', priority: 'ADVISORY', limit: 120, enabled: true }
      ]
    })
  )

  // --- Analog indicators -------------------------------------------------
  const at301 = ai({
    tag: 'AT-301',
    description: 'PRODUCT CONCENTRATION',
    area: 'PRODUCT',
    unit: '%',
    pv: 96,
    decimals: 2,
    alarms: [
      { type: 'LO', label: 'LO', priority: 'WARNING', limit: 90, enabled: true },
      { type: 'LO_LO', label: 'LO LO', priority: 'CRITICAL', limit: 85, enabled: true }
    ]
  })
  add(at301)

  const ti101 = ai({
    tag: 'TI-101',
    description: 'FEED TEMPERATURE',
    area: 'FEED',
    pv: 32,
    unit: 'degC',
    pvMax: 120,
    alarms: [{ type: 'HI', label: 'HI', priority: 'ADVISORY', limit: 60, enabled: true }]
  })
  add(ti101)

  // --- Motors ------------------------------------------------------------
  const p101: MotorModule = {
    tag: 'P-101',
    type: 'MOTOR',
    description: 'FEED PUMP',
    area: 'FEED',
    running: true,
    commanded: true,
    fault: false,
    interlock: false,
    permissiveOk: true,
    permissiveRequired: false,
    resetRequired: true,
    locked: false,
    confirmTimeSec: 2,
    travelTimer: 0,
    dcState: 'CONFIRMED_ACTIVE',
    runtimeHrs: 1284.5,
    alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'WARNING', enabled: true }]
  }
  add(p101)

  const p201: MotorModule = {
    tag: 'P-201',
    type: 'MOTOR',
    description: 'PRODUCT PUMP',
    area: 'PRODUCT',
    running: true,
    commanded: true,
    fault: false,
    interlock: false,
    permissiveOk: true,
    permissiveRequired: false,
    resetRequired: true,
    locked: false,
    confirmTimeSec: 2,
    travelTimer: 0,
    dcState: 'CONFIRMED_ACTIVE',
    runtimeHrs: 902.1,
    alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'WARNING', enabled: true }]
  }
  add(p201)

  // --- On/off valves -----------------------------------------------------
  const xv101: ValveModule = {
    tag: 'XV-101',
    type: 'VALVE',
    description: 'FEED ISOLATION VALVE',
    area: 'FEED',
    commandedOpen: true,
    open: true,
    fault: false,
    interlock: false,
    permissiveOk: true,
    permissiveRequired: false,
    resetRequired: true,
    locked: false,
    confirmTimeSec: 5,
    travelTimer: 0,
    dcState: 'CONFIRMED_ACTIVE',
    alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'WARNING', enabled: true }]
  }
  add(xv101)

  const xv201: ValveModule = {
    tag: 'XV-201',
    type: 'VALVE',
    description: 'REACTOR VENT VALVE',
    area: 'REACTOR',
    commandedOpen: false,
    open: false,
    fault: false,
    interlock: false,
    permissiveOk: true,
    permissiveRequired: false,
    resetRequired: true,
    locked: false,
    confirmTimeSec: 5,
    travelTimer: 0,
    dcState: 'CONFIRMED_PASSIVE',
    alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'ADVISORY', enabled: true }]
  }
  add(xv201)

  // --- Discrete devices --------------------------------------------------
  const lsh101: DiscreteInput = {
    tag: 'LSH-101',
    type: 'DI',
    description: 'FEED TANK HIGH LEVEL SWITCH',
    area: 'FEED',
    state: false,
    activeDescriptor: 'HIGH',
    inactiveDescriptor: 'NORMAL',
    alarms: [{ type: 'HI', label: 'HIGH', priority: 'WARNING', enabled: true }]
  }
  add(lsh101)

  const hs201: DiscreteOutput = {
    tag: 'HS-201',
    type: 'DO',
    description: 'REACTOR AGITATOR',
    area: 'REACTOR',
    state: true,
    commanded: true,
    activeDescriptor: 'RUN',
    inactiveDescriptor: 'STOP',
    alarms: []
  }
  add(hs201)

  // --- Equipment Module membership (ISA-88 physical hierarchy) -----------
  for (const [tag, em] of Object.entries(DEFAULT_MEMBERSHIP)) {
    if (modules[tag]) modules[tag].equipmentModule = em
  }

  return {
    time: Date.now(),
    running: true,
    speed: 1,
    modules,
    alarms: [],
    process: {
      feedTankLevel: 55,
      reactorLevel: 50,
      reactorTemp: 85,
      headerPressure: 250,
      feedFlow: 60,
      productFlow: 58,
      reactorConc: 96
    }
  }
}

export interface NewModuleSpec {
  tag: string
  type: ModuleType
  description: string
  area: string
  /** Equipment Module to assign this Control Module to, if any. */
  equipmentModule?: string
  unit?: string
  pvMin?: number
  pvMax?: number
}

/** Build a new control module from an operator/engineer spec (Explorer "New Module"). */
export function makeModule(s: NewModuleSpec): AnyModule {
  const unit = s.unit ?? ''
  const pvMin = s.pvMin ?? 0
  const pvMax = s.pvMax ?? 100
  const mid = (pvMin + pvMax) / 2
  switch (s.type) {
    case 'PID':
      return pid({
        tag: s.tag,
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        unit,
        pvMin,
        pvMax,
        sp: mid,
        out: 50,
        mode: 'AUTO',
        gain: 1,
        reset: 20,
        direct: false,
        alarms: [
          { type: 'HI', label: 'HI', priority: 'WARNING', limit: pvMin + (pvMax - pvMin) * 0.9, enabled: true },
          { type: 'LO', label: 'LO', priority: 'WARNING', limit: pvMin + (pvMax - pvMin) * 0.1, enabled: true }
        ]
      })
    case 'AI':
      return ai({
        tag: s.tag,
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        pv: mid,
        unit,
        pvMin,
        pvMax
      })
    case 'MOTOR':
      return {
        tag: s.tag,
        type: 'MOTOR',
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        running: false,
        commanded: false,
        fault: false,
        interlock: false,
        permissiveOk: true,
        permissiveRequired: false,
        resetRequired: true,
        locked: false,
        confirmTimeSec: 2,
        travelTimer: 0,
        dcState: 'CONFIRMED_PASSIVE',
        runtimeHrs: 0,
        alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'WARNING', enabled: true }]
      }
    case 'VALVE':
      return {
        tag: s.tag,
        type: 'VALVE',
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        commandedOpen: false,
        open: false,
        fault: false,
        interlock: false,
        permissiveOk: true,
        permissiveRequired: false,
        resetRequired: true,
        locked: false,
        confirmTimeSec: 5,
        travelTimer: 0,
        dcState: 'CONFIRMED_PASSIVE',
        alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'ADVISORY', enabled: true }]
      }
    case 'DI':
      return {
        tag: s.tag,
        type: 'DI',
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        state: false,
        activeDescriptor: 'ACTIVE',
        inactiveDescriptor: 'NORMAL',
        alarms: []
      }
    case 'DO':
      return {
        tag: s.tag,
        type: 'DO',
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        state: false,
        commanded: false,
        activeDescriptor: 'ON',
        inactiveDescriptor: 'OFF',
        alarms: []
      }
  }
}
