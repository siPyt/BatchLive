import type {
  PlantState,
  PidModule,
  AnalogIndicator,
  MotorModule,
  ValveModule,
  DiscreteInput,
  DiscreteOutput,
  FunctionBlockModule,
  FbBlockType,
  AnyModule,
  ModuleType
} from './types'
import { DEFAULT_MEMBERSHIP } from './equipment'

// Helper builders keep the plant definition compact and readable.

/** Tags with bespoke named physics in simulate.ts (the reactor train). */
export const CUSTOM_PHYSICS_TAGS = new Set([
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

/** Tags that belong to the default project baseline and cannot be deleted. */
export const BUILTIN_TAGS = new Set([
  ...CUSTOM_PHYSICS_TAGS,
  // Reactor headspace / agitator instrumentation (generic closed-loop simulation)
  'PT-201',
  'SIC-201',
  'II-201',
  'PSV-201',
  // WFI Generation & Distribution Loop (2 stills, generic closed-loop simulation)
  'TIC-401',
  'FI-401',
  'LIC-401',
  'PIC-401',
  'AT-401',
  'TI-402',
  'P-401',
  'XV-401',
  'TIC-411',
  'FI-411',
  'P-402',
  'XV-411',
  'PCV-401',
  // Autoclave 1 & 2 (steam sterilizers) — driven by STERILIZE-AC1/AC2 SFCs
  'TIC-501',
  'PIC-501',
  'XV-501',
  'DI-501',
  'TIC-511',
  'PIC-511',
  'XV-511',
  'DI-511',
  // Lyophilizer 1 & 2 (freeze dryers) — driven by LYO-CYCLE-1/2 SFCs
  'TIC-601',
  'PIC-601',
  'AT-601',
  'XV-601',
  'TIC-611',
  'PIC-611',
  'AT-611',
  'XV-611',
  // CIP Skids 1-3 (Clean-In-Place) — driven by CIP-CYCLE-1/2/3 SFCs
  'TIC-701',
  'FIC-701',
  'AT-701',
  'P-701',
  'XV-701',
  'XV-702',
  'TIC-711',
  'FIC-711',
  'AT-711',
  'P-711',
  'XV-711',
  'XV-712',
  'TIC-721',
  'FIC-721',
  'AT-721',
  'P-721',
  'XV-721',
  'XV-722',
  // TCUs (Temperature Control Units) — continuously-running utility skids
  'TIC-801',
  'FIC-801',
  'P-801',
  'HS-801',
  'TIC-811',
  'FIC-811',
  'P-811',
  'HS-811',
  'TIC-821',
  'FIC-821',
  'P-821',
  'HS-821'
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
    pvBad: false,
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
    pvBad: false,
    ...p
  }
  if (!m.alarms.some((a) => a.type === 'PVBAD')) {
    m.alarms = [...m.alarms, { type: 'PVBAD', label: 'PV BAD', priority: 'CRITICAL', enabled: true }]
  }
  return m
}

function motor(p: Partial<MotorModule> & Pick<MotorModule, 'tag' | 'description' | 'area'>): MotorModule {
  return {
    type: 'MOTOR',
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
    alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'WARNING', enabled: true }],
    ...p
  }
}

function valve(p: Partial<ValveModule> & Pick<ValveModule, 'tag' | 'description' | 'area'>): ValveModule {
  return {
    type: 'VALVE',
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
    alarms: [{ type: 'FAIL', label: 'FAIL', priority: 'ADVISORY', enabled: true }],
    ...p
  }
}

function fb(p: Partial<FunctionBlockModule> & Pick<FunctionBlockModule, 'tag' | 'description' | 'area' | 'fbType'>): FunctionBlockModule {
  return {
    type: 'FB',
    in1: { kind: 'const', value: 0 },
    in2: { kind: 'const', value: 0 },
    gain: 1,
    bias: 0,
    cmpOp: '>',
    expr: 'IN1 + IN2',
    delaySec: 5,
    tripValue: 10,
    countUp: true,
    out: 0,
    alarms: [],
    _timerElapsed: 0,
    _timerOutput: false,
    _count: 0,
    _prevIn: false,
    _prevValue: 0,
    _buffer: [],
    ...p
  }
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

  // --- Reactor headspace / agitator instrumentation (generic closed-loop simulation) ---
  add(
    ai({
      tag: 'PT-201',
      description: 'REACTOR HEADSPACE PRESSURE',
      area: 'REACTOR',
      unit: 'barg',
      pv: 0.3,
      pvMin: -0.2,
      pvMax: 3,
      decimals: 2,
      alarms: [{ type: 'HI', label: 'HI', priority: 'WARNING', limit: 1.8, enabled: true }]
    })
  )
  add(
    pid({
      tag: 'SIC-201',
      description: 'REACTOR AGITATOR SPEED',
      area: 'REACTOR',
      unit: 'RPM',
      pvMin: 0,
      pvMax: 300,
      sp: 150,
      out: 50,
      mode: 'AUTO',
      gain: 1.2,
      reset: 6,
      direct: false
    })
  )
  add(
    ai({
      tag: 'II-201',
      description: 'REACTOR AGITATOR MOTOR CURRENT',
      area: 'REACTOR',
      unit: 'A',
      pv: 8,
      pvMin: 0,
      pvMax: 30,
      decimals: 1,
      alarms: [{ type: 'HI', label: 'HI', priority: 'ADVISORY', limit: 22, enabled: true }]
    })
  )
  add(valve({ tag: 'PSV-201', description: 'REACTOR HEADSPACE SAFETY RELIEF VALVE', area: 'REACTOR' }))

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

  // =========================================================================
  // GMP Pharma Factory additions — WFI (2 stills), Autoclaves (x2), Lyophilizers
  // (x2), CIP skids (x3), and TCUs (x3). These run on the generic closed-loop
  // /device-control engine (no bespoke physics needed): PID modules
  // self-regulate toward a setpoint-proportional target, and Motor/Valve
  // modules follow the Device Control block already used by the reactor train.
  // =========================================================================

  // --- WFI (Water For Injection) generation & distribution loop ----------
  add(
    pid({
      tag: 'TIC-401',
      description: 'WFI STILL 1 VCD TEMPERATURE',
      area: 'WFI',
      unit: 'degC',
      pvMax: 140,
      sp: 128,
      out: 55,
      mode: 'AUTO',
      gain: 1.5,
      reset: 15,
      direct: false
    })
  )
  add(
    ai({
      tag: 'FI-401',
      description: 'WFI STILL 1 STEAM FLOW',
      area: 'WFI',
      unit: 'kg/h',
      pvMax: 500,
      pv: 320
    })
  )
  add(
    pid({
      tag: 'TIC-411',
      description: 'WFI STILL 2 VCD TEMPERATURE',
      area: 'WFI',
      unit: 'degC',
      pvMax: 140,
      sp: 128,
      out: 55,
      mode: 'AUTO',
      gain: 1.5,
      reset: 15,
      direct: false
    })
  )
  add(
    ai({
      tag: 'FI-411',
      description: 'WFI STILL 2 STEAM FLOW',
      area: 'WFI',
      unit: 'kg/h',
      pvMax: 500,
      pv: 310
    })
  )
  add(
    pid({
      tag: 'LIC-401',
      description: 'WFI STORAGE TANK LEVEL',
      area: 'WFI',
      unit: '%',
      sp: 60,
      out: 50,
      mode: 'AUTO',
      gain: 1.2,
      reset: 20,
      direct: false
    })
  )
  add(
    pid({
      tag: 'PIC-401',
      description: 'WFI DISTRIBUTION LOOP PRESSURE',
      area: 'WFI',
      unit: 'kPa',
      pvMax: 600,
      sp: 300,
      out: 50,
      mode: 'AUTO',
      gain: 1.0,
      reset: 10,
      direct: true
    })
  )
  add(
    ai({
      tag: 'AT-401',
      description: 'WFI CONDUCTIVITY (USP <645>)',
      area: 'WFI',
      unit: 'uS/cm',
      pvMax: 10,
      pv: 0.9,
      decimals: 2,
      alarms: [{ type: 'HI', label: 'HI', priority: 'CRITICAL', limit: 1.3, enabled: true }]
    })
  )
  add(
    ai({
      tag: 'TI-402',
      description: 'WFI LOOP RETURN TEMPERATURE',
      area: 'WFI',
      unit: 'degC',
      pvMax: 90,
      pv: 78,
      alarms: [{ type: 'LO', label: 'LO (COLD LOOP)', priority: 'WARNING', limit: 65, enabled: true }]
    })
  )
  add(motor({ tag: 'P-401', description: 'WFI DISTRIBUTION PUMP 1', area: 'WFI', running: true, commanded: true }))
  add(motor({ tag: 'P-402', description: 'WFI DISTRIBUTION PUMP 2 (STANDBY)', area: 'WFI' }))
  add(valve({ tag: 'XV-401', description: 'WFI LOOP SAMPLE VALVE', area: 'WFI' }))
  add(valve({ tag: 'XV-411', description: 'WFI STILL 2 OUTLET VALVE', area: 'WFI', open: true, commandedOpen: true }))
  add(valve({ tag: 'PCV-401', description: 'WFI LOOP RETURN BACKPRESSURE REGULATING VALVE', area: 'WFI', open: true, commandedOpen: true }))

  // --- Autoclave 1 (steam sterilizer) — cycle run from SFC STERILIZE-AC1 --
  add(
    pid({
      tag: 'TIC-501',
      description: 'AUTOCLAVE 1 CHAMBER TEMPERATURE',
      area: 'AUTOCLAVE',
      unit: 'degC',
      pvMax: 140,
      sp: 25,
      out: 18,
      mode: 'MAN',
      gain: 2.0,
      reset: 8,
      direct: false
    })
  )
  add(
    pid({
      tag: 'PIC-501',
      description: 'AUTOCLAVE 1 CHAMBER PRESSURE',
      area: 'AUTOCLAVE',
      unit: 'kPa',
      pvMin: -100,
      pvMax: 300,
      sp: 0,
      out: 25,
      mode: 'MAN',
      gain: 1.5,
      reset: 8,
      direct: false
    })
  )
  add(valve({ tag: 'XV-501', description: 'AC-1 CHAMBER DRAIN / EXHAUST VALVE', area: 'AUTOCLAVE' }))
  add({
    tag: 'DI-501',
    type: 'DI',
    description: 'AC-1 CHAMBER DOOR CLOSED INTERLOCK',
    area: 'AUTOCLAVE',
    state: true,
    activeDescriptor: 'CLOSED',
    inactiveDescriptor: 'OPEN',
    alarms: [{ type: 'LO', label: 'DOOR OPEN', priority: 'WARNING', enabled: true }]
  })

  // --- Autoclave 2 (steam sterilizer) — cycle run from SFC STERILIZE-AC2 --
  add(
    pid({
      tag: 'TIC-511',
      description: 'AUTOCLAVE 2 CHAMBER TEMPERATURE',
      area: 'AUTOCLAVE',
      unit: 'degC',
      pvMax: 140,
      sp: 25,
      out: 18,
      mode: 'MAN',
      gain: 2.0,
      reset: 8,
      direct: false
    })
  )
  add(
    pid({
      tag: 'PIC-511',
      description: 'AUTOCLAVE 2 CHAMBER PRESSURE',
      area: 'AUTOCLAVE',
      unit: 'kPa',
      pvMin: -100,
      pvMax: 300,
      sp: 0,
      out: 25,
      mode: 'MAN',
      gain: 1.5,
      reset: 8,
      direct: false
    })
  )
  add(valve({ tag: 'XV-511', description: 'AC-2 CHAMBER DRAIN / EXHAUST VALVE', area: 'AUTOCLAVE' }))
  add({
    tag: 'DI-511',
    type: 'DI',
    description: 'AC-2 CHAMBER DOOR CLOSED INTERLOCK',
    area: 'AUTOCLAVE',
    state: true,
    activeDescriptor: 'CLOSED',
    inactiveDescriptor: 'OPEN',
    alarms: [{ type: 'LO', label: 'DOOR OPEN', priority: 'WARNING', enabled: true }]
  })

  // --- Lyophilizer 1 (freeze dryer) — cycle run from SFC LYO-CYCLE-1 ------
  add(
    pid({
      tag: 'TIC-601',
      description: 'LYO 1 SHELF TEMPERATURE',
      area: 'LYO',
      unit: 'degC',
      pvMin: -50,
      pvMax: 50,
      sp: 20,
      out: 70,
      mode: 'MAN',
      gain: 1.8,
      reset: 10,
      direct: false
    })
  )
  add(
    pid({
      tag: 'PIC-601',
      description: 'LYO 1 CHAMBER VACUUM',
      area: 'LYO',
      unit: 'mTorr',
      pvMax: 1000,
      sp: 1000,
      out: 100,
      mode: 'MAN',
      gain: 1.0,
      reset: 10,
      direct: true
    })
  )
  add(
    ai({
      tag: 'AT-601',
      description: 'LYO 1 PRODUCT TEMPERATURE (RTD PROBE)',
      area: 'LYO',
      unit: 'degC',
      pvMin: -60,
      pvMax: 50,
      pv: 20
    })
  )
  add(valve({ tag: 'XV-601', description: 'LYO 1 CHAMBER ISOLATION VALVE', area: 'LYO' }))

  // --- Lyophilizer 2 (freeze dryer) — cycle run from SFC LYO-CYCLE-2 ------
  add(
    pid({
      tag: 'TIC-611',
      description: 'LYO 2 SHELF TEMPERATURE',
      area: 'LYO',
      unit: 'degC',
      pvMin: -50,
      pvMax: 50,
      sp: 20,
      out: 70,
      mode: 'MAN',
      gain: 1.8,
      reset: 10,
      direct: false
    })
  )
  add(
    pid({
      tag: 'PIC-611',
      description: 'LYO 2 CHAMBER VACUUM',
      area: 'LYO',
      unit: 'mTorr',
      pvMax: 1000,
      sp: 1000,
      out: 100,
      mode: 'MAN',
      gain: 1.0,
      reset: 10,
      direct: true
    })
  )
  add(
    ai({
      tag: 'AT-611',
      description: 'LYO 2 PRODUCT TEMPERATURE (RTD PROBE)',
      area: 'LYO',
      unit: 'degC',
      pvMin: -60,
      pvMax: 50,
      pv: 20
    })
  )
  add(valve({ tag: 'XV-611', description: 'LYO 2 CHAMBER ISOLATION VALVE', area: 'LYO' }))

  // --- CIP Skids (Clean-In-Place) — cycles run from CIP-CYCLE-1/2/3 SFCs ---
  const cipSkid = (n: 1 | 2 | 3, tic: string, fic: string, at: string, p: string, xvS: string, xvR: string, serves: string): void => {
    add(
      pid({
        tag: tic,
        description: `CIP-${n} SUPPLY TEMPERATURE (${serves})`,
        area: 'CIP',
        unit: 'degC',
        pvMax: 100,
        sp: 25,
        out: 20,
        mode: 'MAN',
        gain: 1.4,
        reset: 12,
        direct: false
      })
    )
    add(
      pid({
        tag: fic,
        description: `CIP-${n} SUPPLY FLOW`,
        area: 'CIP',
        unit: 'm3/h',
        pvMax: 40,
        sp: 0,
        out: 0,
        mode: 'MAN',
        gain: 0.9,
        reset: 8,
        direct: false
      })
    )
    add(
      ai({
        tag: at,
        description: `CIP-${n} RETURN CONDUCTIVITY (RINSE VERIFY)`,
        area: 'CIP',
        unit: 'uS/cm',
        pvMax: 2000,
        pv: 1500
      })
    )
    add(motor({ tag: p, description: `CIP-${n} SUPPLY PUMP`, area: 'CIP' }))
    add(valve({ tag: xvS, description: `CIP-${n} SUPPLY VALVE (TO ${serves})`, area: 'CIP' }))
    add(valve({ tag: xvR, description: `CIP-${n} RETURN/DIVERT VALVE`, area: 'CIP' }))
  }
  cipSkid(1, 'TIC-701', 'FIC-701', 'AT-701', 'P-701', 'XV-701', 'XV-702', 'REACTOR TRAIN')
  cipSkid(2, 'TIC-711', 'FIC-711', 'AT-711', 'P-711', 'XV-711', 'XV-712', 'WFI/AUTOCLAVE/LYO')
  cipSkid(3, 'TIC-721', 'FIC-721', 'AT-721', 'P-721', 'XV-721', 'XV-722', 'PRODUCT/FILLING')

  // --- TCUs (Temperature Control Units) — continuously-running utility skids
  const tcu = (n: 1 | 2 | 3, tic: string, fic: string, p: string, hs: string, serves: string, spDefault: number): void => {
    add(
      pid({
        tag: tic,
        description: `TCU-${n} SUPPLY TEMPERATURE (${serves})`,
        area: 'TCU',
        unit: 'degC',
        pvMin: -20,
        pvMax: 150,
        sp: spDefault,
        out: 50,
        mode: 'AUTO',
        gain: 1.6,
        reset: 12,
        direct: false
      })
    )
    add(
      pid({
        tag: fic,
        description: `TCU-${n} COOLANT/GLYCOL FLOW`,
        area: 'TCU',
        unit: 'm3/h',
        pvMax: 30,
        sp: 18,
        out: 55,
        mode: 'AUTO',
        gain: 1.0,
        reset: 10,
        direct: false
      })
    )
    add(motor({ tag: p, description: `TCU-${n} CIRCULATION PUMP`, area: 'TCU', running: true, commanded: true }))
    add({
      tag: hs,
      type: 'DO',
      description: `TCU-${n} ELECTRIC HEATER STAGE`,
      area: 'TCU',
      state: true,
      commanded: true,
      activeDescriptor: 'ON',
      inactiveDescriptor: 'OFF',
      alarms: []
    })
  }
  tcu(1, 'TIC-801', 'FIC-801', 'P-801', 'HS-801', 'REACTOR JACKET', 85)
  tcu(2, 'TIC-811', 'FIC-811', 'P-811', 'HS-811', 'LYO-1 SHELVES', -40)
  tcu(3, 'TIC-821', 'FIC-821', 'P-821', 'HS-821', 'LYO-2 SHELVES', -40)

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

/** Empty project: no modules, no process state. */
export function buildBlankPlant(): PlantState {
  return {
    time: Date.now(),
    running: true,
    speed: 1,
    modules: {},
    alarms: [],
    process: {
      feedTankLevel: 0,
      reactorLevel: 0,
      reactorTemp: 25,
      headerPressure: 0,
      feedFlow: 0,
      productFlow: 0,
      reactorConc: 0
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
  /** Required when type === 'FB': which Math/Logic/Timer/Counter block to build. */
  fbType?: FbBlockType
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
    case 'FB':
      return fb({
        tag: s.tag,
        description: s.description,
        area: s.area,
        equipmentModule: s.equipmentModule,
        fbType: s.fbType ?? 'ADD'
      })
  }
}
