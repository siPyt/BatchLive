import type { AnyModule, FunctionBlockModule, MotorModule, PidModule, ValveModule } from './types'
import {
  deviceForceConditions, deviceInterlockConditions, devicePermissiveConditions,
  deviceInterlockSignal, devicePermissiveSignal
} from './simulate'
import { readModuleValue } from './fb'

export interface LogicSection { heading: string; lines: string[] }
export interface LogicExplanation {
  title: string
  summary: string
  /** One sentence stating what the module is doing right now and why. */
  decision: string
  sections: LogicSection[]
}

type Device = MotorModule | ValveModule

const num = (value: number, digits = 1): string => Number.isFinite(value) ? value.toFixed(digits) : 'Bad'
const yn = (value: boolean): string => value ? 'True' : 'False'

function valueOf(modules: Record<string, AnyModule>, tag: string): string {
  const m = modules[tag]
  if (!m) return 'missing module'
  const v = readModuleValue(m)
  return Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : 'Bad'
}

const FB_TEXT: Partial<Record<FunctionBlockModule['fbType'], string>> = {
  ADD: 'adds IN1 and IN2', SUB: 'subtracts IN2 from IN1', MLTY: 'multiplies IN1 by IN2', DIV: 'divides IN1 by IN2',
  ABS: 'takes the absolute value of IN1', CMP: 'compares IN1 with IN2 and sets OUT to 1 when the comparison holds',
  AND: 'sets OUT to 1 only while IN1 and IN2 are both non-zero', OR: 'sets OUT to 1 while either IN1 or IN2 is non-zero',
  NOT: 'inverts IN1', OND: 'sets OUT to 1 only after IN1 has stayed true for the delay time (on-delay timer)',
  OFFD: 'holds OUT at 1 for the delay time after IN1 goes false (off-delay timer)', CND: 'evaluates a condition expression over module values',
  CTR: 'counts rising edges of IN1 and trips at the trip value', RS: 'reset-dominant latch', SR: 'set-dominant latch',
  BG: 'applies gain and bias to IN1', RAMP: 'ramps OUT toward the target at the configured rate', LIM: 'limits IN1 between low and high limits',
  FLTR: 'applies a first-order filter to IN1', SPLTR: 'splits one input across two outputs along a configured curve',
  DT: 'delays IN1 by the dead time', CALC: 'evaluates an arithmetic expression of IN1 and IN2', SCLR: 'rescales IN1 between ranges'
}

function deviceDecision(m: Device, modules: Record<string, AnyModule>): string {
  const valve = m.type === 'VALVE'
  const active = valve ? 'Open' : 'Running'
  const passive = valve ? 'Closed' : 'Stopped'
  const requested = valve ? (m as ValveModule).commandedOpen : (m as MotorModule).commanded
  const feedback = valve ? (m as ValveModule).open : (m as MotorModule).running
  const interlocks = deviceInterlockConditions(m, modules).filter(c => c.effective)
  const interlockSignal = deviceInterlockSignal(m, modules)
  const tripped = m.interlock || interlockSignal.value !== 0
  if (tripped) {
    const names = interlocks.map(c => `#${c.index} "${c.description || c.source}"`)
    if (m.interlockSource && interlockSignal.value !== 0) names.push(`source ${m.interlockSource}`)
    return `${m.tag} is held ${passive} (SHUTDOWN) because the interlock is tripped${names.length ? `: ${names.join(', ')}` : ' (forced from the faceplate)'}.` +
      `${m.resetRequired ? ' Reset Required is set, so it stays Locked after the trip clears until the operator resets it.' : ''}`
  }
  if (m.locked) return `${m.tag} is Locked ${passive}: it tripped earlier and Reset Required is set, so it will not move until the operator resets it.`
  const permissive = devicePermissiveSignal(m, modules)
  if (requested && !feedback && m.permissiveRequired && permissive.value === 0) {
    const missing = devicePermissiveConditions(m, modules).filter(c => c.effective).map(c => `#${c.index} "${c.description || c.source}"`)
    return `${m.tag} is refused ${active}: the permissive is not met${missing.length ? ` (${missing.join(', ')})` : ''}, so it stays ${passive}.`
  }
  if (m.fault || m.ioInputBad || m.ioOutputBad || m.dcState.startsWith('FAILED')) {
    return `${m.tag} has FAILED (${m.dcState}): ${m.fault ? 'a device fault is present' : m.ioInputBad ? 'feedback quality is Bad' : m.ioOutputBad ? 'command output quality is Bad' : 'the commanded state was not confirmed in time'}.`
  }
  if (m.dcState === 'GOING_ACTIVE' || m.dcState === 'GOING_PASSIVE') {
    return `${m.tag} is travelling to ${m.dcState === 'GOING_ACTIVE' ? active : passive}: ${num(m.travelTimer)} of ${m.confirmTimeSec} s elapsed before the state must be confirmed.`
  }
  return `${m.tag} is confirmed ${feedback ? active : passive} and the request is ${requested ? active : passive}; no interlock, permissive or failure condition is acting.`
}

function explainDevice(m: Device, modules: Record<string, AnyModule>): LogicExplanation {
  const valve = m.type === 'VALVE'
  const noun = valve ? 'valve' : 'motor'
  const active = valve ? 'Open' : 'Running'
  const passive = valve ? 'Closed' : 'Stopped'
  const requested = valve ? (m as ValveModule).commandedOpen : (m as MotorModule).commanded
  const feedback = valve ? (m as ValveModule).open : (m as MotorModule).running
  const interlocks = deviceInterlockConditions(m, modules)
  const permissives = devicePermissiveConditions(m, modules)
  const forces = deviceForceConditions(m, modules)
  const forced = forces.find(c => c.effective)
  const request = forced
    ? `Force setpoint #${forced.index} "${forced.description || forced.source}" is true, so the request is forced to ${forced.state === 'ACTIVE' ? active : passive} and overrides the operator and the command source.`
    : m.commandSource
      ? `The request follows command source ${m.commandSource} (= ${valueOf(modules, m.commandSource)}); the module is in CAS and the operator buttons are overwritten each scan.`
      : 'No command source or force setpoint is active, so the request comes from the operator buttons (MAN).'
  const sections: LogicSection[] = [
    { heading: 'What this module does', lines: [
      `${m.tag} (${m.description}) is a discrete ${noun} control module. It turns a request (SP_D) into a field command, checks that command against interlocks and permissives, and confirms the result from the device feedback (PV_D).`,
      `Passive (fail-safe) state: ${passive}. Active state: ${active}. Execution order every scan: force setpoints, command source, interlocks, permissives, then the device-control state machine.`
    ] },
    { heading: '1. Request (SP_D, REQ_SP)', lines: [request, `Requested now: ${requested ? active : passive}. Mode: ${m.commandSource || forced ? 'CAS' : 'MAN'}.`] },
    { heading: `2. Force setpoints (${forces.length} of 8)`, lines: forces.length ? [
      'The first true condition, in list order, forces the request to its state. The interlock still wins over a force.',
      ...forces.map(c => `#${c.index} "${c.description || c.source}": ${c.source}${c.invert ? ' (inverted)' : ''} = ${yn(c.value)}${c.bad ? ' (Bad)' : ''} -> forces ${c.state}${c.effective ? '  [ACTING]' : ''}`)
    ] : ['None configured. Add a condition to drive this device to a defined state automatically, for example close a valve on a high level.'] },
    { heading: `3. Interlocks (${interlocks.length} of 16${m.interlockSource ? ', plus interlock source' : ''})`, lines: [
      'Any true condition trips the device to Passive (SHUTDOWN). A condition whose source is Bad also trips (fail-safe). Conditions marked bypassable are ignored while BYPASSED is set.',
      ...(m.interlockSource ? [`Interlock source ${m.interlockSource}${m.interlockInverted ? ' (inverted)' : ''} = ${valueOf(modules, m.interlockSource)}`] : []),
      ...interlocks.map(c => `#${c.index} "${c.description || c.source}": ${c.source}${c.invert ? ' (inverted)' : ''} = ${yn(c.value)}${c.bad ? ' (Bad)' : ''}${c.bypassable ? ', bypassable' : ''}${c.bypassed ? '  [BYPASSED]' : c.effective ? '  [TRIPPING]' : ''}`),
      ...(!interlocks.length && !m.interlockSource ? ['None configured. Only the manual Force Interlock on the faceplate can trip this device.'] : []),
      `BYPASSED = ${yn(!!m.bypassed)}. Reset Required = ${yn(m.resetRequired)}${m.resetRequired ? ' (a trip latches until RESET_D)' : ''}.`
    ] },
    { heading: `4. Permissives (${permissives.length} of 8${m.permissiveSource ? ', plus permissive source' : ''})`, lines: [
      m.permissiveRequired ? 'Permissive is required: every condition must be true before the device may leave Passive. A device already Active is not stopped by a lost permissive.'
        : 'Permissive is not required, so these conditions are not enforced.',
      ...(m.permissiveSource ? [`Permissive source ${m.permissiveSource} = ${valueOf(modules, m.permissiveSource)}`] : []),
      ...permissives.map(c => `#${c.index} "${c.description || c.source}": ${c.source}${c.invert ? ' (inverted)' : ''} = ${yn(c.value)}${c.bad ? ' (Bad)' : ''}${c.effective ? '  [MISSING]' : '  [met]'}`),
      ...(!permissives.length && !m.permissiveSource ? ['None configured. The permissive is the manual PERMISSIVE_D flag.'] : [])
    ] },
    { heading: '5. Device control and confirmation (EDC1)', lines: [
      `DC_STATE = ${m.dcState}. Confirmation time ${m.confirmTimeSec} s; travel timer ${num(m.travelTimer)} s.`,
      m.feedbackUnavailable ? 'No feedback signal is wired: the state is confirmed by elapsed time only.'
        : `The confirmed state (PV_D) comes from the ${valve ? 'open' : 'run'} feedback${m.feedbackInverted ? ' (polarity inverted)' : ''}: currently ${feedback ? active : passive}.`,
      m.passiveOnTimeout ? 'If an Active command is not confirmed in time the command reverts to Passive (Passive on timeout).'
        : 'If the command is not confirmed in time the device reports FAILED_ACTIVE or FAILED_PASSIVE.'
    ] },
    { heading: '6. Failure (CND1 -> FAILURE)', lines: [
      'FAILURE is True when any of these is true: device fault, Bad feedback quality, Bad output quality, or a FAILED DC_STATE. It raises the FAIL alarm.',
      `Device fault = ${yn(m.fault)}; feedback Bad = ${yn(!!m.ioInputBad)}; output Bad = ${yn(!!m.ioOutputBad)}; DC_STATE failed = ${yn(m.dcState.startsWith('FAILED'))}.`
    ] },
    { heading: '7. Not simulated', lines: [
      'Mode locking (OWNER_ID, HOLD_REQ, MODELOCK_OVR, MODELOCKED) and Equipment Module acquire/release arbitration are not simulated: the operator mode is always honored.',
      `Equipment Module membership shown for reference: ${m.equipmentModule ?? 'none'}.`
    ] }
  ]
  return { title: `${m.tag} - ${noun} control logic`, decision: deviceDecision(m, modules),
    summary: `Discrete ${noun}: Passive = ${passive}. ${interlocks.length + (m.interlockSource ? 1 : 0)} interlock(s), ${permissives.length + (m.permissiveSource ? 1 : 0)} permissive(s), ${forces.length} force setpoint(s).`, sections }
}

function explainPid(m: PidModule, modules: Record<string, AnyModule>): LogicExplanation {
  const error = m.direct ? 'PV - SP' : 'SP - PV'
  const span = m.pvMax - m.pvMin
  const decision = m.pvBad ? `${m.tag} has a Bad measurement, so its input is frozen and it cannot control.`
    : m.actualMode !== m.mode ? `${m.tag} was asked for ${m.mode} but is actually in ${m.actualMode}.`
      : m.actualMode === 'MAN' || m.actualMode === 'IMAN' ? `${m.tag} is in ${m.actualMode}: the output is set by the operator at ${num(m.out)} %, the loop is not controlling.`
        : `${m.tag} is controlling in ${m.actualMode}: PV ${num(m.pv)} ${m.unit} against SP ${num(m.sp)} ${m.unit}, output ${num(m.out)} %.`
  return {
    title: `${m.tag} - PID loop logic`,
    summary: `${m.direct ? 'Direct' : 'Reverse'}-acting PID, ${num(m.pvMin, 0)} to ${num(m.pvMax, 0)} ${m.unit}.`,
    decision,
    sections: [
      { heading: 'What this module does', lines: [
        `${m.tag} (${m.description}) holds its process variable at the setpoint by adjusting its output. The signal path is analog input (AI1) -> PID1 -> analog output (AO1), all executed every scan.`] },
      { heading: 'Measurement (AI1)', lines: [
        `PV = ${num(m.pv, m.decimals)} ${m.unit} over a range of ${num(span, 0)} ${m.unit} (${num(m.pvMin, 0)} to ${num(m.pvMax, 0)}). Quality: ${m.pvBad ? 'BAD, value frozen' : 'Good'}.`] },
      { heading: 'Mode and setpoint', lines: [
        `Target mode ${m.mode}, actual mode ${m.actualMode}. SP = ${num(m.sp, m.decimals)} ${m.unit}.`,
        'AUTO: the operator sets SP. CAS: SP comes from the cascade source. MAN: the operator sets the output. OOS: the block does not execute. LO: tracking has taken over the output.',
        ...(m.casSource ? [`Cascade source: ${m.casSource} (= ${valueOf(modules, m.casSource)}), connection ${m.casHealthy ? 'healthy' : 'FAILED, shed to AUTO'}.`] : [])] },
      { heading: 'Control algorithm (PID1)', lines: [
        `Error = ${error} (${m.direct ? 'direct: output rises when PV rises' : 'reverse: output rises when PV falls'}).`,
        `OUT = Gain x (error + (1 / Reset) x integral of error + Rate x d(error)/dt), with Gain ${m.gain}, Reset ${m.reset} s/repeat and Rate ${m.rate} s. Derivative acts on the measurement.`,
        `The integral term is held while the output is limited, and bumpless transfer back-calculates it when the mode changes.`] },
      { heading: 'Feedforward and tracking', lines: [
        m.ffEnable ? `Feedforward is enabled: ${m.ffSource ?? '(no source)'} x ${m.ffGain} is added to the output.` : 'Feedforward is disabled.',
        m.trackEnable ? `Output tracking is enabled: while ${m.trackSource ?? '(no trigger)'} is true the output is forced to ${m.trackValueSource ?? num(m.trackValue)}.` : 'Output tracking is disabled.'] },
      { heading: 'Output (AO1) and alarms', lines: [
        `Output ${num(m.out)} %. Alarms: ${m.alarms.length ? m.alarms.map(a => `${a.label}${a.limit !== undefined ? ` ${a.limit}` : ''} (${a.enabled ? a.priority : 'disabled'})`).join('; ') : 'none configured'}.`] }
    ]
  }
}

function explainOther(m: AnyModule, modules: Record<string, AnyModule>): LogicExplanation {
  if (m.type === 'AI') return {
    title: `${m.tag} - analog input logic`, summary: `Analog indicator, ${num(m.pvMin, 0)} to ${num(m.pvMax, 0)} ${m.unit}.`,
    decision: m.pvBad ? `${m.tag} has Bad quality; the last good value is held.` : `${m.tag} reads ${num(m.pv, m.decimals)} ${m.unit} with Good quality.`,
    sections: [{ heading: 'What this module does', lines: [`${m.tag} (${m.description}) reads one measurement, scales it to engineering units and compares it with its alarm limits.`] },
      { heading: 'Alarms', lines: m.alarms.length ? m.alarms.map(a => `${a.label}: ${a.type}${a.limit !== undefined ? ` at ${a.limit} ${m.unit}` : ''}, ${a.priority}, ${a.enabled ? 'enabled' : 'disabled'}`) : ['No alarms configured.'] }]
  }
  if (m.type === 'AO') return {
    title: `${m.tag} - analog output logic`, summary: `Analog output module, setpoint ${num(m.spLow, 0)} to ${num(m.spHigh, 0)} ${m.unit}.`,
    decision: `${m.tag} is in ${m.actualMode}, output ${num(m.out)} % for a setpoint of ${num(m.sp)} ${m.unit}.`,
    sections: [{ heading: 'What this module does', lines: [`${m.tag} converts a setpoint in engineering units to a percentage output, limited to its setpoint range, and reports the readback PV.`,
      `Mode ${m.mode} (actual ${m.actualMode}); output ${m.bad ? 'BAD' : 'Good'}${m.limited ? ', limited' : ''}.`] }]
  }
  if (m.type === 'DI' || m.type === 'DO') return {
    title: `${m.tag} - discrete ${m.type === 'DI' ? 'input' : 'output'} logic`, summary: `Discrete ${m.type}: ${m.inactiveDescriptor} / ${m.activeDescriptor}.`,
    decision: `${m.tag} is ${m.state ? m.activeDescriptor : m.inactiveDescriptor}${m.type === 'DI' && m.ioBad ? ' (Bad quality)' : ''}.`,
    sections: [{ heading: 'What this module does', lines: [m.type === 'DI' ? `${m.tag} reads one on/off field signal and shows it as ${m.inactiveDescriptor} or ${m.activeDescriptor}.`
      : `${m.tag} drives one on/off field output: ${m.inactiveDescriptor} or ${m.activeDescriptor}.`] }]
  }
  const fb = m as FunctionBlockModule
  const inputText = (ref: FunctionBlockModule['in1']): string => ref.kind === 'const' ? String(ref.value) : `${ref.tag ?? '(unwired)'} (= ${ref.tag ? valueOf(modules, ref.tag) : '?'})`
  return {
    title: `${fb.tag} - ${fb.fbType} function block logic`, summary: `${fb.fbType} function block.`,
    decision: `${fb.tag} output is ${num(fb.out, 3)}${fb.bad ? ' (Bad input quality, held)' : ''}.`,
    sections: [{ heading: 'What this module does', lines: [
      `${fb.tag} (${fb.description}) ${FB_TEXT[fb.fbType] ?? `computes OUT from its inputs using the ${fb.fbType} algorithm`}.`,
      `IN1 = ${inputText(fb.in1)}; IN2 = ${inputText(fb.in2)}.`,
      `Gain ${fb.gain}, bias ${fb.bias}, operator ${fb.cmpOp}, delay ${fb.delaySec} s${fb.fbType === 'CND' ? `, expression ${fb.expr}` : ''}.`] }]
  }
}

export function explainModuleLogic(m: AnyModule, modules: Record<string, AnyModule>): LogicExplanation {
  if (m.type === 'MOTOR' || m.type === 'VALVE') return explainDevice(m, modules)
  if (m.type === 'PID') return explainPid(m, modules)
  return explainOther(m, modules)
}
