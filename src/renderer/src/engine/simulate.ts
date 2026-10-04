import type {
  PlantState,
  PidModule,
  AnalogIndicator,
  MotorModule,
  ValveModule,
  DiscreteInput,
  ActiveAlarm,
  AlarmLimit,
  AnyModule,
  DcState,
  FunctionBlockModule,
  FbInputRef
} from './types'
import { CUSTOM_PHYSICS_TAGS } from './plant'
import { FB_NEEDS_IN2, moduleExecutionOrder, readModuleValue } from './fb'
import { advanceControllers, computeBadTags, controllerIsDown, type HardwareState } from './hardware'
import {
  advanceTraditionalIo, analogChannelBad, sampleAnalogInputs, sampleAnalogOutputs, sampleDiscreteInputs
} from './traditionalIo'
import { executeStandaloneAo } from './standaloneAo'
import {
  appliedPidOutput, clonePidIo, executePidOutput, pidIo, pidOutputUnavailable,
  readAnalogSignal, resolvePidInput, samplePidInput
} from './analogStrategy'
import {
  cloneSplitter, createSplitter, executeSplitter, outputFeedback, refreshSplitterStatus,
  type SplitterFeedback
} from './splitter'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const noise = (amp: number): number => (Math.random() - 0.5) * 2 * amp

// DeltaV derivative filter factor (ALPHA), default 0.125 → Tf = ALPHA * RATE.
const DERIV_ALPHA = 0.125

/**
 * Resolve a PID block's actual (executing) mode from its target mode.
 * Mirrors DeltaV's SHED_OPT "Shed with Return": a Cas/RCas target sheds to
 * Auto while the remote cascade connection (casHealthy) is unhealthy, and
 * climbs back to Cas automatically as soon as the connection is restored —
 * the target mode itself never changes.
 *
 * Also implements the real BKCAL "Not Invited" rule: if this block has a
 * downstream block cascading off it (some PID's CAS_SOURCE === this tag) and
 * that downstream block isn't actually in Cas/RCas yet, this block cannot
 * close the loop — its actual mode reports IMAN (Initialization Manual),
 * exactly as the PDF describes ("the block would have remained with mode
 * Auto/IMan because of the Not Invited status").
 */
function resolveActualMode(m: PidModule, modules: Record<string, AnyModule>): PidModule['mode'] {
  const source = m.casSource ? modules[m.casSource] : undefined
  if ((m.mode === 'CAS' || m.mode === 'RCAS') && source?.type === 'AO' && source.bad) return 'AUTO'
  if ((m.mode === 'CAS' || m.mode === 'RCAS') && !m.casHealthy) return 'AUTO'
  if (m.mode === 'MAN' || m.mode === 'ROUT') return m.mode
  const child = findCascadeChild(modules, m.tag)
  if (child && child.actualMode !== 'CAS' && child.actualMode !== 'RCAS') return 'IMAN'
  return m.mode
}

/** The downstream PID (if any) whose CAS_SOURCE points at this tag — the
 * "slave" of a cascade, from the upstream/master's point of view. */
function findCascadeChild(modules: Record<string, AnyModule>, tag: string): PidModule | undefined {
  for (const k of Object.keys(modules)) {
    const mm = modules[k]
    if (mm.type === 'PID' && mm.casSource === tag) return mm
  }
  return undefined
}

/**
 * DeltaV-style standard-form PID. Matches the default STRUCTURE
 * "PI Action on Error, D Action on PV": proportional + integral act on error,
 * derivative acts on the measurement (no derivative kick on SP changes).
 * GAIN is dimensionless, RESET is seconds/repeat, RATE is derivative seconds.
 * ffVal (FF_VAL * FF_GAIN) is summed into OUT ahead of the PID math, exactly
 * like the PDF's feedforward application example (steam flow -> PID.FF_VAL).
 * bkcalLimited mirrors real BKCAL anti-reset-windup: true when the downstream
 * cascade child is saturated, which freezes this block's integral term too.
 */
function computePid(m: PidModule, dt: number, ffVal = 0, bkcalLimited = false): number {
  if (m.actualMode === 'MAN' || m.actualMode === 'ROUT' || m.actualMode === 'IMAN') {
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
  // an already-saturated output further into its limit, OR when BKCAL says
  // the downstream cascade child is itself already saturated (real anti-reset-
  // windup: a limited slave tells the master to stop integrating too).
  const fixed = pTerm + dTerm + ffVal
  const pre = clamp(fixed + m._integral, 0, 100)
  const saturated = bkcalLimited || (pre >= 100 && ePct > 0) || (pre <= 0 && ePct < 0)
  if (!saturated) {
    m._integral += (m.gain / Math.max(m.reset, 0.5)) * ePct * dt
    m._integral = clamp(m._integral, -100, 100)
  }
  return clamp(fixed + m._integral, 0, 100)
}

/**
 * Generic cascade + feedforward + tracking wrapper, usable by ANY PID (the
 * custom reactor-train pair and every operator-created one alike) — not a
 * one-off special case for a single hardcoded tag pair. Also implements the
 * BKCAL anti-reset-windup feedback described in the PDF: if this block itself
 * is the master of a cascade, a saturated downstream child freezes its
 * integral term (see computePid's bkcalLimited argument).
 *  - Cascade: while CAS/RCas, SP is pulled from casSource every scan (a PID
 *    or standalone AO source supplies OUT as percent-of-range; others supply their
 *    live value directly in EU, matching CAS_IN's "EU of PV_SCALE").
 *  - Tracking: while trackSource is non-zero, OUT is bumplessly forced to
 *    trackValueSource (or the constant trackValue), mirroring TRK_IN_D/TRK_VAL.
 *  - Feedforward: FF_VAL (from ffSource) * FF_GAIN is summed into OUT.
 * Simplification vs. full BKCAL: status resolves fresh every scan rather than
 * a multi-step acknowledgement handshake, so transfers are bumpless in
 * practice but not status-negotiated message-by-message.
 */
function stepPidWithStrategy(m: PidModule, modules: Record<string, AnyModule>, dt: number): void {
  resolvePidInput(m, modules)
  const io = pidIo(m)
  const previousMode = m.actualMode
  m.actualMode = resolveActualMode(m, modules)
  const outputUnavailable = pidOutputUnavailable(m)
  if (m.mode !== 'MAN' && m.mode !== 'ROUT' && (m.pvBad || (io.bkcalConnected && outputUnavailable))) {
    m.actualMode = 'IMAN'
    if (io.bkcalConnected && outputUnavailable) {
      m.out = io.splitter ? io.splitter.bkcal : io.ao.out
      m._integral = m.out
    }
  }
  if ((m.actualMode === 'CAS' || m.actualMode === 'RCAS') && m.casSource) {
    const src = modules[m.casSource]
    if (src) m.sp = clamp(src.type === 'PID' || src.type === 'AO'
      ? m.pvMin + (src.out / 100) * (m.pvMax - m.pvMin) : readModuleValue(src), m.pvMin, m.pvMax)
  }
  if (m.trackEnable && m.trackSource && readModuleValue(modules[m.trackSource]) !== 0) {
    const trackVal = m.trackValueSource ? readModuleValue(modules[m.trackValueSource]) : m.trackValue
    m.out = clamp(trackVal, 0, 100)
    m._integral = m.out
    m._prevPv = m.pv
    m._dFilt = 0
    return
  }
  const ffVal = m.ffEnable && m.ffSource ? readModuleValue(modules[m.ffSource]) * m.ffGain : 0
  if (previousMode === 'IMAN' && m.actualMode !== 'IMAN' &&
      m.actualMode !== 'MAN' && m.actualMode !== 'ROUT') {
    const errorPct = ((m.sp - m.pv) / (m.pvMax - m.pvMin || 1)) * 100 * (m.direct ? -1 : 1)
    m._integral = clamp(m.out - m.gain * errorPct - ffVal, -100, 100)
  }
  const child = findCascadeChild(modules, m.tag)
  const errorDirection = (m.sp - m.pv) * (m.direct ? -1 : 1)
  const outputLimited = io.splitter
    ? (io.splitter.status === 'HIGH_LIMITED' && errorDirection > 0) ||
      (io.splitter.status === 'LOW_LIMITED' && errorDirection < 0)
    : io.ao.limited
  const bkcalLimited = (!!child && (child.out <= 0.001 || child.out >= 99.999)) ||
    (io.bkcalConnected && outputLimited)
  m.out = computePid(m, dt, ffVal, bkcalLimited)
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
 * Core of the DeltaV Device Control (DC1) function block: resolves DC_STATE
 * from a commanded setpoint (desired Active/Passive), confirming the
 * transition after `confirmTimeSec` (TRAVEL_TIMER), and honoring the
 * Permissive, Interlock, and Reset Required device options.
 */
interface DcIo {
  desired: boolean // SP_D: true = Active, false = Passive
  confirmed: boolean // FV_D / PV_D: true = Active, false = Passive
  interlock: boolean // INTERLOCK_D tripped (true = trip condition active)
  permissiveOk: boolean // PERMISSIVE_D
  permissiveRequired: boolean
  resetRequired: boolean
  locked: boolean
  fault: boolean // simulated stuck/failed field device (manual "Inject Fault")
  confirmTimeSec: number
  travelTimer: number
  dcState: DcState
}

function stepDeviceControl(io: DcIo, dt: number): void {
  // SHUTDOWN_D / tripped INTERLOCK_D forces and holds the Passive state.
  if (io.interlock) {
    io.confirmed = false
    io.dcState = 'SHUTDOWN'
    io.travelTimer = 0
    if (io.resetRequired) io.locked = true
    return
  }
  // Reset Required device option: stays Locked (Passive) until an explicit Reset.
  if (io.locked) {
    io.confirmed = false
    io.dcState = 'LOCKED'
    return
  }
  // Permissive device option: blocks a Passive -> Active transition only.
  const wantsActive = io.desired
  const blockedByPermissive = wantsActive && !io.confirmed && io.permissiveRequired && !io.permissiveOk
  const target = blockedByPermissive ? false : wantsActive

  if (io.fault) {
    // A stuck/failed field device never confirms the commanded state.
    io.dcState = target ? 'FAILED_ACTIVE' : 'FAILED_PASSIVE'
    io.travelTimer += dt
    return
  }

  if (target === io.confirmed) {
    io.dcState = io.confirmed ? 'CONFIRMED_ACTIVE' : 'CONFIRMED_PASSIVE'
    io.travelTimer = 0
    return
  }

  // In transit (Going to Active / Going to Passive) for the travel/confirm time.
  io.dcState = target ? 'GOING_ACTIVE' : 'GOING_PASSIVE'
  io.travelTimer += dt
  if (io.travelTimer >= io.confirmTimeSec) {
    io.confirmed = target
    io.dcState = target ? 'CONFIRMED_ACTIVE' : 'CONFIRMED_PASSIVE'
    io.travelTimer = 0
  }
}

function applyMotorDC(m: MotorModule, dt: number, modules: Record<string, AnyModule>): void {
  if (m.interlockSource) m.interlock = readModuleValue(modules[m.interlockSource]) !== 0
  if (m.commandSource) m.commanded = readModuleValue(modules[m.commandSource]) !== 0
  const io: DcIo = {
    desired: m.commanded,
    confirmed: m.running,
    interlock: m.interlock,
    permissiveOk: m.permissiveOk,
    permissiveRequired: m.permissiveRequired,
    resetRequired: m.resetRequired,
    locked: m.locked,
    fault: m.fault,
    confirmTimeSec: m.confirmTimeSec,
    travelTimer: m.travelTimer,
    dcState: m.dcState
  }
  stepDeviceControl(io, dt)
  m.running = io.confirmed
  m.locked = io.locked
  m.travelTimer = io.travelTimer
  m.dcState = io.dcState
  if (m.running) m.runtimeHrs += dt / 3600
}

function applyValveDC(m: ValveModule, dt: number, modules: Record<string, AnyModule>): void {
  if (m.interlockSource) m.interlock = readModuleValue(modules[m.interlockSource]) !== 0
  if (m.commandSource) m.commandedOpen = readModuleValue(modules[m.commandSource]) !== 0
  const io: DcIo = {
    desired: m.commandedOpen,
    confirmed: m.open,
    interlock: m.interlock,
    permissiveOk: m.permissiveOk,
    permissiveRequired: m.permissiveRequired,
    resetRequired: m.resetRequired,
    locked: m.locked,
    fault: m.fault,
    confirmTimeSec: m.confirmTimeSec,
    travelTimer: m.travelTimer,
    dcState: m.dcState
  }
  stepDeviceControl(io, dt)
  m.open = io.confirmed
  m.locked = io.locked
  m.travelTimer = io.travelTimer
  m.dcState = io.dcState
}

/** Reads the live numeric value a function block can wire to: PV for AI/PID,
 * 1/0 for discrete states, and OUT for another function block's result. */
function resolveFbInput(
  modules: Record<string, AnyModule>, ref: FbInputRef
): { value: number; bad: boolean } {
  if (ref.kind === 'const') return { value: ref.value, bad: !Number.isFinite(ref.value) }
  if (ref.tag && (ref.parameter || ref.block)) {
    return readAnalogSignal({ tag: ref.tag, parameter: ref.parameter ?? 'OUT', block: ref.block }, modules)
  }
  const m = ref.tag ? modules[ref.tag] : undefined
  return {
    value: readModuleValue(m),
    bad: !m || ('pvBad' in m && m.pvBad) || ('ioBad' in m && !!m.ioBad) ||
      ((m.type === 'FB' || m.type === 'AO') && !!m.bad)
  }
}

/** Minimal recursive-descent evaluator for CALC blocks — supports add, subtract,
 * multiply, divide and parentheses, numeric literals, and the IN1/IN2 variables.
 * No eval()/Function(): operator text is untrusted configuration data, not code to execute. */
function evalExpr(expr: string, in1: number, in2: number): number {
  const tokens = expr.toUpperCase().match(/\d+\.?\d*|[+\-*/()]|IN1|IN2/g) ?? []
  let pos = 0
  const peek = (): string | undefined => tokens[pos]
  const take = (): string | undefined => tokens[pos++]
  const parseFactor = (): number => {
    const t = take()
    if (t === '(') {
      const v = parseExpr()
      take() // consume ')'
      return v
    }
    if (t === '-') return -parseFactor()
    if (t === 'IN1') return in1
    if (t === 'IN2') return in2
    return t ? Number(t) || 0 : 0
  }
  const parseTerm = (): number => {
    let v = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = take()
      const rhs = parseFactor()
      v = op === '*' ? v * rhs : rhs !== 0 ? v / rhs : 0
    }
    return v
  }
  const parseExpr = (): number => {
    let v = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = take()
      v = op === '+' ? v + parseTerm() : v - parseTerm()
    }
    return v
  }
  try {
    return parseExpr()
  } catch {
    return 0
  }
}

/** Executes one DeltaV Math/Logic/Timer/Counter/simple-Analog-Control block
 * per scan, resolving its wired inputs against the current module set. Codes
 * are the exact DeltaV Function Block Reference abbreviations. */
function stepFunctionBlock(m: FunctionBlockModule, modules: Record<string, AnyModule>, dt: number): void {
  const input1 = resolveFbInput(modules, m.in1)
  const input2 = resolveFbInput(modules, m.in2)
  if (m.fbType === 'SPLTR') {
    const state = m.splitter ?? (m.splitter = createSplitter())
    const feedback = (ref: FunctionBlockModule['bkcal1Source'], branch: 1 | 2): SplitterFeedback => {
      const source = ref ? modules[ref.tag] : undefined
      if (!ref || source?.type !== 'PID' || (ref.block !== 'AO1' && ref.block !== 'AO2')) {
        return { value: 0, bad: true, invited: false, limit: 'NONE' }
      }
      const io = pidIo(source)
      const stage = ref.block === 'AO1' ? io.ao : io.ao2
      const command = ref.block === 'AO1' ? io.outputSource : io.output2Source
      if (!stage) return { value: 0, bad: true, invited: false, limit: 'NONE' }
      const connected = ref.block === 'AO1' ? io.aoConnected : !!io.ao2Connected
      return outputFeedback(stage, connected && command?.tag === m.tag &&
        (command.parameter === (branch === 1 ? 'OUT_1' : 'OUT_2') ||
          (branch === 1 && command.parameter === 'OUT')))
    }
    executeSplitter(state, input1, feedback(m.bkcal1Source, 1), feedback(m.bkcal2Source, 2), dt)
    m.out = state.out1
    m.bad = state.status === 'BAD'
    return
  }
  m.bad = input1.bad || (FB_NEEDS_IN2[m.fbType] && input2.bad)
  if (m.bad) return // Bad input holds the last output; quality is visible to downstream blocks.
  const a = input1.value
  const b = input2.value
  const cmp = (x: number, y: number): boolean => {
    if (m.cmpOp === '>') return x > y
    if (m.cmpOp === '<') return x < y
    if (m.cmpOp === '>=') return x >= y
    if (m.cmpOp === '<=') return x <= y
    return x === y
  }
  switch (m.fbType) {
    // ---------------- I/O Blocks ----------------
    case 'ALARM':
      m.out = cmp(a, m.bias) ? 1 : 0
      break
    case 'MAI':
      m.out = (a + b) / 2
      break
    case 'FFMDI':
      m.out = (a !== 0 ? 1 : 0) + (b !== 0 ? 2 : 0)
      break
    case 'FFMDO':
      m.out = (Math.floor(a) >> Math.max(0, Math.round(m.tripValue))) & 1
      break
    case 'PIN': {
      const inOn = a !== 0
      if (inOn && !m._prevIn) m._count++
      m._prevIn = inOn
      m._timerElapsed += dt
      if (m._timerElapsed >= Math.max(m.delaySec, 0.5)) {
        m.out = m._count / m._timerElapsed
        m._count = 0
        m._timerElapsed = 0
      }
      break
    }

    // ---------------- Math Blocks ----------------
    case 'ABS':
      m.out = Math.abs(a)
      break
    case 'ADD':
      m.out = a + b
      break
    case 'ARITH':
      m.out = a * m.gain + m.bias + b
      break
    case 'CMP':
      m.out = cmp(a, b) ? 1 : 0
      break
    case 'DIV':
      m.out = b !== 0 ? a / b : 0
      break
    case 'INT':
      if (b !== 0) m._count = 0
      else m._count += a * dt
      m.out = m._count
      break
    case 'MLTY':
      m.out = a * b
      break
    case 'SUB':
      m.out = a - b
      break

    // ---------------- Timer/Counter Blocks ----------------
    case 'CTR': {
      const inOn = a !== 0
      if (inOn && !m._prevIn) m._count += m.countUp ? 1 : -1
      m._prevIn = inOn
      m.out = (m.countUp ? m._count >= m.tripValue : m._count <= m.tripValue) ? 1 : 0
      break
    }
    case 'DTE':
      m._timerElapsed += dt
      m.out = m._timerElapsed % Math.max(m.delaySec, 1) < 1 ? 1 : 0
      break
    case 'OND': {
      const inOn = a !== 0
      if (inOn) {
        m._timerElapsed += dt
        m._timerOutput = m._timerElapsed >= m.delaySec
      } else {
        m._timerElapsed = 0
        m._timerOutput = false
      }
      m.out = m._timerOutput ? 1 : 0
      break
    }
    case 'OFFD': {
      const inOn = a !== 0
      if (inOn) {
        m._timerElapsed = 0
        m._timerOutput = true
      } else {
        m._timerElapsed += dt
        if (m._timerElapsed >= m.delaySec) m._timerOutput = false
      }
      m.out = m._timerOutput ? 1 : 0
      break
    }
    case 'RET': {
      if (b !== 0) {
        m._timerElapsed = 0
        m._timerOutput = false
      } else if (a !== 0) {
        m._timerElapsed += dt
        if (m._timerElapsed >= m.delaySec) m._timerOutput = true
      }
      m.out = m._timerOutput ? 1 : 0
      break
    }
    case 'TP': {
      const inOn = a !== 0
      if (inOn && !m._prevIn) {
        m._timerOutput = true
        m._timerElapsed = 0
      }
      m._prevIn = inOn
      if (m._timerOutput) {
        m._timerElapsed += dt
        if (m._timerElapsed >= m.delaySec) m._timerOutput = false
      }
      m.out = m._timerOutput ? 1 : 0
      break
    }

    // ---------------- Logical Blocks ----------------
    case 'ACT':
      if (b !== 0) m.out = evalExpr(m.expr, a, b)
      break
    case 'AND':
      m.out = a !== 0 && b !== 0 ? 1 : 0
      break
    case 'BDE': {
      const inOn = a !== 0
      m.out = inOn !== m._prevIn ? 1 : 0
      m._prevIn = inOn
      break
    }
    case 'BFI':
      m.out = (a !== 0 ? 1 : 0) + (b !== 0 ? 2 : 0)
      break
    case 'BFO':
      m.out = (Math.floor(a) >> Math.max(0, Math.round(m.tripValue))) & 1
      break
    case 'CND': {
      const condTrue = evalExpr(m.expr, a, b) !== 0
      if (condTrue) {
        m._timerElapsed += dt
        m._timerOutput = m._timerElapsed >= m.delaySec
      } else {
        m._timerElapsed = 0
        m._timerOutput = false
      }
      m.out = m._timerOutput ? 1 : 0
      break
    }
    case 'MLTX':
      m.out = b !== 0 ? a : m.gain
      break
    case 'NDE': {
      const inOn = a !== 0
      m.out = !inOn && m._prevIn ? 1 : 0
      m._prevIn = inOn
      break
    }
    case 'NOT':
      m.out = a !== 0 ? 0 : 1
      break
    case 'OR':
      m.out = a !== 0 || b !== 0 ? 1 : 0
      break
    case 'PDE': {
      const inOn = a !== 0
      m.out = inOn && !m._prevIn ? 1 : 0
      m._prevIn = inOn
      break
    }
    case 'RS':
      // Reset/Set flip-flop (NOR logic): Reset (IN2) dominates Set (IN1).
      if (b !== 0) m._timerOutput = false
      else if (a !== 0) m._timerOutput = true
      m.out = m._timerOutput ? 1 : 0
      break
    case 'SR':
      // Set/Reset flip-flop (NAND logic): Set (IN1) dominates Reset (IN2).
      if (a !== 0) m._timerOutput = true
      else if (b !== 0) m._timerOutput = false
      m.out = m._timerOutput ? 1 : 0
      break

    // ---------------- Analog Control Blocks ----------------
    case 'BG':
      m.out = a * m.gain + m.bias
      break
    case 'CALC':
      m.out = evalExpr(m.expr, a, b)
      break
    case 'CTLSL':
      m.out = m.cmpOp === '<' ? Math.min(a, b) : m.cmpOp === '>' ? Math.max(a, b) : (a + b) / 2
      break
    case 'DT': {
      m._timerElapsed += dt
      m._buffer.push({ t: m._timerElapsed, v: a })
      const cutoff = m._timerElapsed - m.delaySec
      while (m._buffer.length > 1 && m._buffer[1].t <= cutoff) m._buffer.shift()
      m.out = m._buffer[0].t <= cutoff ? m._buffer[0].v : 0
      break
    }
    case 'FLTR': {
      const tau = Math.max(m.delaySec, 0.1)
      m.out += (a - m.out) * Math.min(1, dt / tau)
      break
    }
    case 'INSEL':
    case 'ISELX':
    case 'SGSL':
      m.out = m.cmpOp === '<' ? Math.min(a, b) : m.cmpOp === '>' ? Math.max(a, b) : (a + b) / 2
      break
    case 'LE':
      m.out = m.gain
      break
    case 'LL': {
      const tau = Math.max(m.delaySec, 0.1)
      const lag = m.out + (a - m.out) * Math.min(1, dt / tau)
      const lead = dt > 0 ? m.gain * ((a - m._prevValue) / dt) : 0
      m._prevValue = a
      m.out = lag + lead
      break
    }
    case 'LIM':
      m.out = Math.max(Math.min(m.bias, m.gain), Math.min(Math.max(m.bias, m.gain), a))
      break
    case 'MANLD':
      m.out = m.gain
      break
    case 'RAMP': {
      const maxStep = Math.max(m.gain, 0) * dt
      const diff = a - m.out
      m.out += Math.max(-maxStep, Math.min(maxStep, diff))
      break
    }
    case 'RTLM': {
      const maxStep = Math.max(m.gain, 0) * dt
      const diff = a - m.out
      m.out += Math.max(-maxStep, Math.min(maxStep, diff))
      break
    }
    case 'RTO':
      m.out = a * m.gain
      break
    case 'SCLR': {
      const span = m.gain - m.bias || 1
      m.out = ((a - m.bias) / span) * 100
      break
    }
    case 'SGCR':
      m.out = Math.sign(a) * Math.sqrt(Math.abs(a)) * m.gain
      break
    case 'SGGN':
      m._timerElapsed += dt
      m.out = m.gain * Math.sin((2 * Math.PI * m._timerElapsed) / Math.max(m.delaySec, 1))
      break
  }
}

/**
 * Advance the plant by dt seconds. Returns a NEW PlantState (fresh references)
 * so React/zustand subscribers re-render.
 */
export function stepPlant(
  prev: PlantState & { hardware: HardwareState },
  dtReal: number
): PlantState & { hardware: HardwareState } {
  const dt = dtReal * prev.speed
  const now = prev.time + dt * 1000
  const proc = { ...prev.process }
  const { badPvTags, badCmdTags, badOutTags } = computeBadTags(prev.hardware)

  // Clone modules shallowly so references change for subscribers.
  const modules: Record<string, AnyModule> = {}
  for (const k of Object.keys(prev.modules)) {
    const module = prev.modules[k]
    modules[k] = module.type === 'PID' ? { ...module, io: clonePidIo(module) } :
      module.type === 'FB' && module.splitter ? { ...module, splitter: cloneSplitter(module.splitter) } :
        { ...module }
  }
  sampleDiscreteInputs(prev.hardware, modules)
  sampleAnalogOutputs(prev.hardware, modules)
  const boundInput = (tag: string): boolean => !!prev.hardware.analogBindings?.[tag]?.input
  const analogOutputBad = (tag: string, second = false): boolean => {
    const dst = prev.hardware.analogBindings?.[tag]?.[second ? 'output2' : 'output']
    return (second ? false : badOutTags.has(tag)) || (!!dst && analogChannelBad(prev.hardware, dst, 'AO'))
  }
  for (const module of Object.values(modules)) {
    if (module.type === 'AI') module.pvBad = badPvTags.has(module.tag)
    if ((module.type === 'MOTOR' || module.type === 'VALVE') && badCmdTags.has(module.tag)) module.fault = true
    if (module.type !== 'PID') continue
    const io = pidIo(module)
    if (!boundInput(module.tag)) samplePidInput(module, io.ai.raw, badPvTags.has(module.tag))
    io.ao.bad = analogOutputBad(module.tag) || !!io.ao.fault ||
      (io.ao.mode === 'CAS' && !io.aoConnected)
    if (io.ao2) io.ao2.bad = analogOutputBad(module.tag, true) || !!io.ao2.fault ||
      (io.ao2.mode === 'CAS' && !io.ao2Connected)
    if (io.splitter && io.ao2) {
      refreshSplitterStatus(io.splitter, outputFeedback(io.ao, io.aoConnected && !io.outputSource),
        outputFeedback(io.ao2, !!io.ao2Connected && !io.output2Source))
    }
  }
  sampleAnalogInputs(prev.hardware, modules)
  const executeLoop = (m: PidModule): number => {
    stepPidWithStrategy(m, modules, dt)
    executePidOutput(m, modules, analogOutputBad(m.tag), dt, analogOutputBad(m.tag, true))
    const io = pidIo(m)
    if (m.actualMode === 'IMAN' && io.bkcalConnected &&
        pidOutputUnavailable(m)) {
      m.out = io.splitter ? io.splitter.bkcal : io.ao.out
      m._integral = m.out
    }
    return appliedPidOutput(m)
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
  const hasReactorTrain = fic?.type === 'PID' && lic101?.type === 'PID' && lic201?.type === 'PID' &&
    tic?.type === 'PID' && pic?.type === 'PID' && p101?.type === 'MOTOR' &&
    p201?.type === 'MOTOR' && xv101?.type === 'VALVE' && xv201?.type === 'VALVE' &&
    at301?.type === 'AI' && ti101?.type === 'AI' && lsh101?.type === 'DI'

  // Inputs, control algorithms and field outputs execute once in dependency order.
  for (const tag of moduleExecutionOrder(modules)) {
    const module = modules[tag]
    if (module.type === 'PID') executeLoop(module)
    else if (module.type === 'FB') stepFunctionBlock(module, modules, dt)
    else if (module.type === 'AO') executeStandaloneAo(module, analogOutputBad(tag) ||
      (!!module.controllerTag && (!prev.hardware.controllers[module.controllerTag] ||
        controllerIsDown(prev.hardware.controllers[module.controllerTag]))))
    else if (module.type === 'MOTOR') applyMotorDC(module, dt, modules)
    else if (module.type === 'VALVE') applyValveDC(module, dt, modules)
    else if (module.type === 'DO' && !prev.hardware.discreteBindings?.[tag] && module.mode !== 'OOS') {
      module.state = module.commanded
    }
    else if (module.type === 'AI' && !boundInput(tag) &&
        !(hasReactorTrain && CUSTOM_PHYSICS_TAGS.has(tag)) && !module.pvBad) {
      const span = module.pvMax - module.pvMin || 1
      const mid = module.pvMin + span / 2
      module.pv = clamp(module.pv + (mid - module.pv) * 0.01 + noise(span * 0.002),
        module.pvMin, module.pvMax)
    }
  }

  // --- Cascade: LIC-101 (master) sets remote SP of FIC-101 (slave), via the
  // generic cascade/feedforward/tracking wrapper (same one every user PID uses) ---
  // Blank/course projects do not contain the complete pharma reactor train.
  if (hasReactorTrain) {
    const ficOut = appliedPidOutput(fic)

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
    const productCommand = appliedPidOutput(lic201)
    const productOut = p201.running ? (productCommand / 100) * 110 : 0
    proc.productFlow += (productOut - proc.productFlow) * clamp(dt / 3, 0, 1)
    proc.reactorLevel += (reactorDraw - proc.productFlow) * dt * 0.05
    proc.reactorLevel = clamp(proc.reactorLevel, 0, 100)

    // --- Reactor temperature: steam heats, cold feed + losses cool -------
    const temperatureCommand = appliedPidOutput(tic)
    const steamHeat = (temperatureCommand / 100) * 2.4
    const cooling = 0.012 * (proc.reactorTemp - 25) + proc.feedFlow * 0.004
    proc.reactorTemp += (steamHeat - cooling) * dt
    proc.reactorTemp = clamp(proc.reactorTemp + noise(0.05), 0, 200)

    // --- Header pressure: product flow builds it, PIC relief bleeds it ----
    const pressureCommand = appliedPidOutput(pic)
    const relief = (pressureCommand / 100) * 12 + (xv201.open ? 4 : 0)
    proc.headerPressure += (proc.productFlow * 0.08 + 1.2 - relief) * dt * 4
    proc.headerPressure = clamp(proc.headerPressure + noise(0.5), 0, 500)

    // --- Concentration: best at the ideal reactor temperature -------------
    const idealTemp = 85
    const target = 97 - Math.abs(proc.reactorTemp - idealTemp) * 0.35 - Math.abs(proc.reactorLevel - 50) * 0.05
    proc.reactorConc += (target - proc.reactorConc) * clamp(dt / 6, 0, 1)
    proc.reactorConc = clamp(proc.reactorConc + noise(0.05), 0, 100)

    // --- Write PVs back to modules ---------------------------------------
    if (!boundInput(fic.tag)) samplePidInput(fic, proc.feedFlow, badPvTags.has(fic.tag))
    if (!boundInput(lic101.tag)) samplePidInput(lic101, proc.feedTankLevel, badPvTags.has(lic101.tag))
    if (!boundInput(lic201.tag)) samplePidInput(lic201, proc.reactorLevel, badPvTags.has(lic201.tag))
    if (!boundInput(tic.tag)) samplePidInput(tic, proc.reactorTemp, badPvTags.has(tic.tag))
    if (!boundInput(pic.tag)) samplePidInput(pic, proc.headerPressure, badPvTags.has(pic.tag))
    if (!boundInput(at301.tag)) at301.pv = proc.reactorConc
    if (!boundInput(ti101.tag)) ti101.pv = clamp(ti101.pv + (32 - ti101.pv) * 0.02 + noise(0.05), 28, 70)
    lsh101.state = proc.feedTankLevel >= 85
  }

  // --- Generic simulation for operator-created modules -----------------
  for (const tag of Object.keys(modules)) {
    if (hasReactorTrain && CUSTOM_PHYSICS_TAGS.has(tag)) continue
    const gm = modules[tag]
    if (gm.type === 'PID' && !boundInput(tag)) {
      const output = appliedPidOutput(gm)
      const gspan = gm.pvMax - gm.pvMin || 1
      // Self-regulating first-order process: PV rises with controller output.
      const target = gm.pvMin + (output / 100) * gspan
      const raw = pidIo(gm).ai.raw
      samplePidInput(gm, clamp(raw + (target - raw) * clamp(dt / 4, 0, 1) +
        noise(gspan * 0.0015), gm.pvMin, gm.pvMax), badPvTags.has(tag))
    }
  }

  // --- Physical Network: CHARM/controller I/O faults propagate to modules
  for (const tag of badPvTags) {
    const m = modules[tag]
    const prevM = prev.modules[tag]
    if (m && prevM && m.type === 'AI' && 'pv' in prevM) {
      m.pv = prevM.pv // Bad I/O: freeze at the last known-good value.
    }
  }
  for (const tag of badCmdTags) {
    const m = modules[tag]
    if (m && (m.type === 'MOTOR' || m.type === 'VALVE')) m.fault = true
  }
  for (const tag of Object.keys(modules)) {
    const m = modules[tag]
    if (m.type === 'AI' && !boundInput(tag)) m.pvBad = badPvTags.has(tag)
  }

  // --- Alarm evaluation -------------------------------------------------
  const alarms = prev.alarms.map((a) => ({ ...a }))
  // ISA-18.2 Shelving: automatically return a shelved alarm to view on expiry.
  for (const a of alarms) {
    if (a.shelvedUntil !== undefined && now >= a.shelvedUntil) a.shelvedUntil = undefined
  }
  for (const tag of Object.keys(modules)) {
    const m = modules[tag]
    if (m.type === 'PID') {
      evalAnalogAlarms(m.tag, m.description, m.pv, m.unit, m.alarms, alarms, now)
      const pvbad = m.alarms.find((a) => a.type === 'PVBAD')
      if (pvbad) reconcile(alarms, m.tag, m.description, pvbad, m.pvBad, m.pv, m.unit, now)
    } else if (m.type === 'AI') {
      evalAnalogAlarms(m.tag, m.description, m.pv, m.unit, m.alarms, alarms, now)
      const pvbad = m.alarms.find((a) => a.type === 'PVBAD')
      if (pvbad) reconcile(alarms, m.tag, m.description, pvbad, m.pvBad, m.pv, m.unit, now)
    } else if (m.type === 'MOTOR') {
      const fail = m.alarms.find((a) => a.type === 'FAIL')
      if (fail) reconcile(alarms, m.tag, m.description, fail, m.fault, 0, '', now)
    } else if (m.type === 'VALVE') {
      const fail = m.alarms.find((a) => a.type === 'FAIL')
      if (fail) reconcile(alarms, m.tag, m.description, fail, m.fault, 0, '', now)
    } else if (m.type === 'DI') {
      const hi = m.alarms.find((a) => a.type === 'HI')
      if (hi) reconcile(alarms, m.tag, m.description, hi,
        hi.enabled && !m.ioBad && m.mode !== 'OOS' && m.state === (m.alarmOnValue ?? true), Number(m.state), '', now)
    }
  }

  return {
    ...prev,
    time: now,
    modules,
    alarms,
    process: proc,
    hardware: { ...advanceTraditionalIo(prev.hardware, modules, dt),
      controllers: advanceControllers(prev.hardware.controllers, dt) }
  }
}
