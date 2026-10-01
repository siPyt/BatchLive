import type {
  PlantState,
  PidModule,
  AnalogIndicator,
  MotorModule,
  ValveModule,
  DiscreteInput,
  ActiveAlarm,
  AlarmLimit,
  AnyModule
} from './types'
import { BUILTIN_TAGS } from './plant'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const noise = (amp: number): number => (Math.random() - 0.5) * 2 * amp

// DeltaV derivative filter factor (ALPHA), default 0.125 → Tf = ALPHA * RATE.
const DERIV_ALPHA = 0.125

/**
 * DeltaV-style standard-form PID. Matches the default STRUCTURE
 * "PI Action on Error, D Action on PV": proportional + integral act on error,
 * derivative acts on the measurement (no derivative kick on SP changes).
 * GAIN is dimensionless, RESET is seconds/repeat, RATE is derivative seconds.
 */
function computePid(m: PidModule, dt: number): number {
  if (m.mode === 'MAN' || m.mode === 'ROUT') {
    // Operator holds the output directly; keep derivative state bumpless.
    m._prevPv = m.pv
    m._dFilt = 0
    return clamp(m.out, 0, 100)
  }
  const span = m.pvMax - m.pvMin || 1
  let errEu = m.sp - m.pv // reverse acting baseline
  if (m.direct) errEu = -errEu
  const ePct = (errEu / span) * 100

  const pTerm = m.gain * ePct

  // Derivative on measurement, first-order filtered (Tf = ALPHA * RATE).
  let dTerm = 0
  if (m.rate > 0 && dt > 0) {
    const pvRatePct = (((m.pv - m._prevPv) / span) * 100) / dt
    const tf = DERIV_ALPHA * m.rate
    m._dFilt += (dt / (tf + dt)) * (pvRatePct - m._dFilt)
    // Reverse acting: rising PV should lower OUT, so derivative opposes PV rate.
    dTerm = -m.gain * m.rate * m._dFilt
    if (m.direct) dTerm = -dTerm
  } else {
    m._dFilt = 0
  }
  m._prevPv = m.pv

  // Conditional-integration anti-windup: integrate only when it does not push
  // an already-saturated output further into its limit.
  const fixed = pTerm + dTerm
  const pre = clamp(fixed + m._integral, 0, 100)
  const saturated = (pre >= 100 && ePct > 0) || (pre <= 0 && ePct < 0)
  if (!saturated) {
    m._integral += (m.gain / Math.max(m.reset, 0.5)) * ePct * dt
    m._integral = clamp(m._integral, -100, 100)
  }
  return clamp(fixed + m._integral, 0, 100)
}

/** Evaluate analog alarm limits and reconcile with the active alarm list. */
function evalAnalogAlarms(
  tag: string,
  desc: string,
  pv: number,
  unit: string,
  limits: AlarmLimit[],
  existing: ActiveAlarm[],
  now: number
): void {
  for (const lim of limits) {
    if (!lim.enabled || lim.limit === undefined) continue
    let tripped = false
    if (lim.type === 'HI_HI' || lim.type === 'HI' || lim.type === 'DV_HI') tripped = pv >= lim.limit
    if (lim.type === 'LO' || lim.type === 'LO_LO' || lim.type === 'DV_LO') tripped = pv <= lim.limit
    reconcile(existing, tag, desc, lim, tripped, pv, unit, now)
  }
}

function reconcile(
  list: ActiveAlarm[],
  tag: string,
  desc: string,
  lim: AlarmLimit,
  tripped: boolean,
  value: number,
  unit: string,
  now: number
): void {
  const id = `${tag}.${lim.type}`
  const idx = list.findIndex((a) => a.id === id)
  if (tripped) {
    if (idx === -1) {
      list.push({
        id,
        moduleTag: tag,
        moduleDesc: desc,
        type: lim.type,
        label: lim.label,
        priority: lim.priority,
        value,
        unit,
        active: true,
        acknowledged: false,
        time: now
      })
    } else {
      list[idx].active = true
      list[idx].value = value
    }
  } else if (idx !== -1) {
    // Return-to-normal: if already acknowledged, clear it; otherwise keep it
    // visible but mark inactive (operator must still acknowledge).
    if (list[idx].acknowledged) {
      list.splice(idx, 1)
    } else {
      list[idx].active = false
      list[idx].value = value
    }
  }
}

/**
 * Advance the plant by dt seconds. Returns a NEW PlantState (fresh references)
 * so React/zustand subscribers re-render.
 */
export function stepPlant(prev: PlantState, dtReal: number): PlantState {
  const dt = dtReal * prev.speed
  const now = prev.time + dt * 1000
  const proc = { ...prev.process }

  // Clone modules shallowly so references change for subscribers.
  const modules: Record<string, AnyModule> = {}
  for (const k of Object.keys(prev.modules)) {
    modules[k] = { ...prev.modules[k] }
  }

  const fic = modules['FIC-101'] as PidModule
  const lic101 = modules['LIC-101'] as PidModule
  const lic201 = modules['LIC-201'] as PidModule
  const tic = modules['TIC-201'] as PidModule
  const pic = modules['PIC-301'] as PidModule
  const p101 = modules['P-101'] as MotorModule
  const p201 = modules['P-201'] as MotorModule
  const xv101 = modules['XV-101'] as ValveModule
  const xv201 = modules['XV-201'] as ValveModule
  const at301 = modules['AT-301'] as AnalogIndicator
  const ti101 = modules['TI-101'] as AnalogIndicator
  const lsh101 = modules['LSH-101'] as DiscreteInput

  // --- Discrete device actuation ---------------------------------------
  p101.running = p101.commanded && !p101.interlock
  p201.running = p201.commanded && !p201.interlock
  xv101.open = xv101.commandedOpen && !xv101.interlock
  xv201.open = xv201.commandedOpen && !xv201.interlock

  // --- Cascade: LIC-101 (master) sets remote SP of FIC-101 (slave) ------
  const lic101Out = computePid(lic101, dt)
  lic101.out = lic101Out
  if (fic.mode === 'CAS' || fic.mode === 'RCAS') {
    fic.sp = (lic101Out / 100) * fic.pvMax
  }
  const ficOut = computePid(fic, dt)
  fic.out = ficOut

  // --- Feed flow physics ------------------------------------------------
  const feedEnabled = p101.running && xv101.open
  const feedCmd = feedEnabled ? (ficOut / 100) * fic.pvMax : 0
  // First-order lag toward commanded flow.
  proc.feedFlow += (feedCmd - proc.feedFlow) * clamp(dt / 3, 0, 1)
  proc.feedFlow = clamp(proc.feedFlow + noise(0.3), 0, fic.pvMax)

  // --- Feed tank level: inflow (feed) minus outflow (to reactor) -------
  const reactorDraw = p101.running ? 55 : 0
  proc.feedTankLevel += (proc.feedFlow - reactorDraw) * dt * 0.05
  proc.feedTankLevel = clamp(proc.feedTankLevel, 0, 100)

  // --- Reactor level: feed in minus product out ------------------------
  lic201.out = computePid(lic201, dt)
  const productOut = p201.running ? (lic201.out / 100) * 110 : 0
  proc.productFlow += (productOut - proc.productFlow) * clamp(dt / 3, 0, 1)
  proc.reactorLevel += (reactorDraw - proc.productFlow) * dt * 0.05
  proc.reactorLevel = clamp(proc.reactorLevel, 0, 100)

  // --- Reactor temperature: steam heats, cold feed + losses cool -------
  tic.out = computePid(tic, dt)
  const steamHeat = (tic.out / 100) * 2.4
  const cooling = 0.012 * (proc.reactorTemp - 25) + proc.feedFlow * 0.004
  proc.reactorTemp += (steamHeat - cooling) * dt
  proc.reactorTemp = clamp(proc.reactorTemp + noise(0.05), 0, 200)

  // --- Header pressure: product flow builds it, PIC relief bleeds it ----
  pic.out = computePid(pic, dt)
  const relief = (pic.out / 100) * 12 + (xv201.open ? 4 : 0)
  proc.headerPressure += (proc.productFlow * 0.08 + 1.2 - relief) * dt * 4
  proc.headerPressure = clamp(proc.headerPressure + noise(0.5), 0, 500)

  // --- Concentration: best at the ideal reactor temperature -------------
  const idealTemp = 85
  const target = 97 - Math.abs(proc.reactorTemp - idealTemp) * 0.35 - Math.abs(proc.reactorLevel - 50) * 0.05
  proc.reactorConc += (target - proc.reactorConc) * clamp(dt / 6, 0, 1)
  proc.reactorConc = clamp(proc.reactorConc + noise(0.05), 0, 100)

  // --- Write PVs back to modules ---------------------------------------
  fic.pv = proc.feedFlow
  lic101.pv = proc.feedTankLevel
  lic201.pv = proc.reactorLevel
  tic.pv = proc.reactorTemp
  pic.pv = proc.headerPressure
  at301.pv = proc.reactorConc
  ti101.pv = clamp(ti101.pv + (32 - ti101.pv) * 0.02 + noise(0.05), 28, 70)
  lsh101.state = proc.feedTankLevel >= 85

  // --- Generic simulation for operator-created modules -----------------
  for (const tag of Object.keys(modules)) {
    if (BUILTIN_TAGS.has(tag)) continue
    const gm = modules[tag]
    if (gm.type === 'PID') {
      gm.out = computePid(gm, dt)
      const gspan = gm.pvMax - gm.pvMin || 1
      // Self-regulating first-order process: PV rises with controller output.
      const target = gm.pvMin + (gm.out / 100) * gspan
      gm.pv = clamp(gm.pv + (target - gm.pv) * clamp(dt / 4, 0, 1) + noise(gspan * 0.0015), gm.pvMin, gm.pvMax)
    } else if (gm.type === 'AI') {
      const gspan = gm.pvMax - gm.pvMin || 1
      const mid = gm.pvMin + gspan / 2
      gm.pv = clamp(gm.pv + (mid - gm.pv) * 0.01 + noise(gspan * 0.002), gm.pvMin, gm.pvMax)
    } else if (gm.type === 'MOTOR') {
      gm.running = gm.commanded && !gm.interlock
      if (gm.running) gm.runtimeHrs += dt / 3600
    } else if (gm.type === 'VALVE') {
      gm.open = gm.commandedOpen && !gm.interlock
    }
  }

  // --- Alarm evaluation -------------------------------------------------
  const alarms = prev.alarms.map((a) => ({ ...a }))
  for (const tag of Object.keys(modules)) {
    const m = modules[tag]
    if (m.type === 'PID') {
      evalAnalogAlarms(m.tag, m.description, m.pv, m.unit, m.alarms, alarms, now)
    } else if (m.type === 'AI') {
      evalAnalogAlarms(m.tag, m.description, m.pv, m.unit, m.alarms, alarms, now)
    } else if (m.type === 'MOTOR') {
      const fail = m.alarms.find((a) => a.type === 'FAIL')
      if (fail) reconcile(alarms, m.tag, m.description, fail, m.fault, 0, '', now)
    } else if (m.type === 'VALVE') {
      const fail = m.alarms.find((a) => a.type === 'FAIL')
      if (fail) reconcile(alarms, m.tag, m.description, fail, m.fault, 0, '', now)
    } else if (m.type === 'DI') {
      const hi = m.alarms.find((a) => a.type === 'HI')
      if (hi) reconcile(alarms, m.tag, m.description, hi, m.state, 0, '', now)
    }
  }

  // Motor runtime accumulation.
  if (p101.running) p101.runtimeHrs += dt / 3600
  if (p201.running) p201.runtimeHrs += dt / 3600

  return {
    ...prev,
    time: now,
    modules,
    alarms,
    process: proc
  }
}
