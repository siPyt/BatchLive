import { pidExecutionBad } from './pidModes'
import type {
  AnalogOutputStage, AnalogSignalRef, AnyModule, PidIoPatch, PidIoStrategy, PidModule
} from './types'
import {
  cloneSplitter, configureSplitter, createSplitter, executeSplitter, outputFeedback,
  refreshSplitterStatus
} from './splitter'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function createPidIo(m: PidModule): PidIoStrategy {
  return {
    ai: { mode: 'AUTO', raw: m.pv, out: m.pv, manualValue: m.pv, rawBad: false, bad: m.pvBad },
    ao: { mode: 'CAS', out: m.out, manualValue: m.out, lowLimit: 0, highLimit: 100, bad: false, limited: false },
    aiConnected: true,
    aoConnected: true,
    bkcalConnected: true
  }
}

/** Older projects acquire the same default signal path as newly created modules. */
export function pidIo(m: PidModule): PidIoStrategy {
  return m.io ?? createPidIo(m)
}

export function clonePidIo(m: PidModule): PidIoStrategy {
  const io = pidIo(m)
  return {
    ...io, ai: { ...io.ai }, ao: { ...io.ao }, ao2: io.ao2 ? { ...io.ao2 } : undefined,
    splitter: io.splitter ? cloneSplitter(io.splitter) : undefined,
    inputSource: io.inputSource ? { ...io.inputSource } : undefined,
    outputSource: io.outputSource ? { ...io.outputSource } : undefined,
    output2Source: io.output2Source ? { ...io.output2Source } : undefined
  }
}

export function signalError(ref: AnalogSignalRef, modules: Record<string, AnyModule>): string | null {
  const source = modules[ref.tag]
  if (!source) return `Source module ${ref.tag} does not exist`
  if (ref.block && source.type !== 'PID') return `${ref.tag} has no ${ref.block} block`
  if (ref.block === 'AO2' && (source.type !== 'PID' || !pidIo(source).ao2)) return 'AO2 is not configured'
  if (['OUT_D', 'OUT_INT', 'FIRST_OUT', 'BYPASS'].includes(ref.parameter)) {
    return !ref.block && source.type === 'FB' &&
      (ref.parameter === 'BYPASS' ? source.fbType === 'CND' : source.fbType === 'BFI')
      ? null : `${ref.tag}.${ref.parameter} requires ${ref.parameter === 'BYPASS' ? 'CND' : 'BFI'}`
  }
  if (ref.block === 'SPLTR1' ||
      (source.type === 'FB' && source.fbType === 'SPLTR' && ref.parameter !== 'OUT')) {
    const splitter = source.type === 'PID' ? pidIo(source).splitter :
      source.type === 'FB' ? source.splitter : undefined
    if (!splitter) return 'SPLTR is not configured'
    return ref.parameter === 'OUT_1' || ref.parameter === 'OUT_2'
      ? null : 'SPLTR exposes OUT_1 and OUT_2'
  }
  if (ref.block === 'AI1' || ref.block === 'AO1' || ref.block === 'AO2') {
    return ref.parameter === 'OUT' ? null : `${ref.tag}/${ref.block} exposes OUT, not PV`
  }
  if (ref.parameter === 'PV' && (source.type === 'PID' || source.type === 'AI' || source.type === 'AO')) return null
  if (ref.parameter === 'OUT' && (source.type === 'PID' || source.type === 'FB' || source.type === 'AI' || source.type === 'AO')) return null
  return `${ref.tag}.${ref.parameter} is not an analog signal`
}

export function readAnalogSignal(
  ref: AnalogSignalRef, modules: Record<string, AnyModule>
): { value: number; bad: boolean } {
  const source = modules[ref.tag]
  if (!source || signalError(ref, modules)) return { value: NaN, bad: true }
  if (source.type === 'FB') {
    if (ref.parameter === 'BYPASS') return { value: Number(!!source.bypass), bad: false }
    if (ref.parameter === 'OUT_D') return { value: Number(!!source.outDiscrete), bad: !!source.bad }
    if (ref.parameter === 'OUT_INT') return { value: source.out, bad: !!source.bad }
    if (ref.parameter === 'FIRST_OUT') return { value: source.firstOut ?? 0, bad: !!source.firstOutBad }
  }
  if (source.type === 'PID' && (ref.block === 'AI1' || ref.block === 'AO1' || ref.block === 'AO2')) {
    const stage = ref.block === 'AI1' ? pidIo(source).ai :
      ref.block === 'AO2' ? pidIo(source).ao2 : pidIo(source).ao
    if (!stage) return { value: NaN, bad: true }
    return { value: stage.out, bad: stage.bad || !Number.isFinite(stage.out) }
  }
  if (ref.parameter === 'OUT_1' || ref.parameter === 'OUT_2') {
    const splitter = source.type === 'PID' ? pidIo(source).splitter :
      source.type === 'FB' ? source.splitter : undefined
    if (!splitter) return { value: NaN, bad: true }
    const value = ref.parameter === 'OUT_1' ? splitter.out1 : splitter.out2
    return { value, bad: splitter.status === 'BAD' || !Number.isFinite(value) }
  }
  const value = (source.type === 'PID' || source.type === 'AO') && ref.parameter === 'OUT'
    ? source.out : source.type === 'FB' ? source.out : 'pv' in source ? source.pv : NaN
  return { value, bad: !Number.isFinite(value) ||
    (source.type === 'PID' && pidExecutionBad(source)) ||
    ('pvBad' in source && source.pvBad && (ref.parameter === 'PV' || source.type === 'AI')) ||
    ((source.type === 'FB' || source.type === 'AO') && !!source.bad) }
}

export function pidIoPatchError(
  m: PidModule, patch: PidIoPatch, modules: Record<string, AnyModule>
): string | null {
  const io = pidIo(m)
  const low = patch.outputLow ?? io.ao.lowLimit
  const high = patch.outputHigh ?? io.ao.highLimit
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 100 || low >= high) {
    return 'AO output limits must satisfy 0 <= low < high <= 100'
  }
  if (patch.inputManual !== undefined &&
      (!Number.isFinite(patch.inputManual) || patch.inputManual < m.pvMin || patch.inputManual > m.pvMax)) {
    return `AI manual value must be between ${m.pvMin} and ${m.pvMax} ${m.unit}`
  }
  if (patch.outputManual !== undefined &&
      (!Number.isFinite(patch.outputManual) || patch.outputManual < 0 || patch.outputManual > 100)) {
    return 'AO manual value must be between 0 and 100%'
  }
  if ((patch.output2Mode !== undefined || patch.output2Manual !== undefined ||
      patch.output2Low !== undefined || patch.output2High !== undefined ||
      patch.output2Failed !== undefined || patch.output2Source || patch.ao2Connected !== undefined ||
      patch.actuation || patch.splitter) &&
      !io.splitter && !patch.splitRange) return 'Enable the split-range strategy before editing AO2/SPLTR'
  if (patch.splitRange === false && (patch.output2Source || patch.splitter || patch.actuation)) {
    return 'Cannot configure split-range signals while disabling the split-range strategy'
  }
  const low2 = patch.output2Low ?? io.ao2?.lowLimit ?? 0
  const high2 = patch.output2High ?? io.ao2?.highLimit ?? 100
  if (!Number.isFinite(low2) || !Number.isFinite(high2) || low2 < 0 || high2 > 100 || low2 >= high2) {
    return 'AO2 output limits must satisfy 0 <= low < high <= 100'
  }
  if (patch.output2Manual !== undefined &&
      (!Number.isFinite(patch.output2Manual) || patch.output2Manual < 0 || patch.output2Manual > 100)) {
    return 'AO2 manual value must be between 0 and 100%'
  }
  for (const ref of [patch.inputSource, patch.outputSource, patch.output2Source]) {
    if (ref) {
      const error = signalError(ref, modules)
      if (error) return error
      if (ref.tag === m.tag) return 'Use the internal block connection for signals in this module'
    }
  }
  return null
}

export function configurePidIo(m: PidModule, patch: PidIoPatch): PidIoStrategy {
  const io = clonePidIo(m)
  if (patch.splitRange === true && !io.splitter) {
    io.splitter = createSplitter(m.out)
    io.splitter.balTimeSec = Math.max(2 * m.reset, 1)
    io.ao.out = io.splitter.out1
    io.ao.manualValue = io.ao.out
    io.ao2 = { ...io.ao, out: io.splitter.out2, manualValue: io.splitter.out2,
      mode: 'CAS', bad: false, fault: false }
    io.ao2Connected = true
    io.actuation = 'STAGED'
  } else if (patch.splitRange === false && io.splitter) {
    io.ao.out = appliedPidOutput({ ...m, io })
    io.ao.manualValue = io.ao.out
    io.splitter = undefined
    io.ao2 = undefined
    io.output2Source = undefined
  }
  if (patch.actuation && io.splitter) {
    io.actuation = patch.actuation
    io.splitter = configureSplitter(io.splitter, patch.actuation === 'HEAT_COOL'
      ? { inArray: [0, 49, 51, 100], outArray: [100, 0, 0, 100] }
      : { inArray: [0, 50, 50, 100], outArray: [0, 100, 0, 100] })
  }
  if (patch.splitter && io.splitter) io.splitter = configureSplitter(io.splitter, patch.splitter)
  if (patch.inputMode !== undefined) {
    if (patch.inputMode === 'MAN' && io.ai.mode !== 'MAN') io.ai.manualValue = io.ai.out
    io.ai.mode = patch.inputMode
  }
  if (patch.inputManual !== undefined) io.ai.manualValue = patch.inputManual
  if (patch.outputMode !== undefined) {
    if (patch.outputMode === 'MAN' && io.ao.mode !== 'MAN') io.ao.manualValue = io.ao.out
    io.ao.mode = patch.outputMode
  }
  if (patch.outputManual !== undefined) io.ao.manualValue = patch.outputManual
  if (patch.outputLow !== undefined) io.ao.lowLimit = patch.outputLow
  if (patch.outputHigh !== undefined) io.ao.highLimit = patch.outputHigh
  if (patch.outputFailed !== undefined) io.ao.fault = patch.outputFailed
  if (io.ao2) {
    if (patch.output2Mode !== undefined) {
      if (patch.output2Mode === 'MAN' && io.ao2.mode !== 'MAN') io.ao2.manualValue = io.ao2.out
      io.ao2.mode = patch.output2Mode
    }
    if (patch.output2Manual !== undefined) io.ao2.manualValue = patch.output2Manual
    if (patch.output2Low !== undefined) io.ao2.lowLimit = patch.output2Low
    if (patch.output2High !== undefined) io.ao2.highLimit = patch.output2High
    if (patch.output2Failed !== undefined) io.ao2.fault = patch.output2Failed
  }
  if (patch.aiConnected !== undefined) io.aiConnected = patch.aiConnected
  if (patch.aoConnected !== undefined) io.aoConnected = patch.aoConnected
  if (patch.bkcalConnected !== undefined) io.bkcalConnected = patch.bkcalConnected
  if ('inputSource' in patch) io.inputSource = patch.inputSource
  if ('outputSource' in patch) io.outputSource = patch.outputSource
  if ('output2Source' in patch) io.output2Source = patch.output2Source
  if (patch.ao2Connected !== undefined) io.ao2Connected = patch.ao2Connected
  return io
}

export function samplePidInput(m: PidModule, raw: number, rawBad: boolean): void {
  const io = m.io ?? (m.io = createPidIo(m))
  io.ai.raw = raw
  io.ai.rawBad = rawBad
  io.ai.bad = io.ai.mode === 'AUTO' && (rawBad || !Number.isFinite(raw))
  if (io.ai.mode === 'MAN') io.ai.out = io.ai.manualValue
  else if (!io.ai.bad) io.ai.out = clamp(raw, m.pvMin, m.pvMax)
  if (!io.inputSource) {
    m.pvBad = !io.aiConnected || io.ai.bad
    if (io.aiConnected && !io.ai.bad) m.pv = io.ai.out
  }
}

export function resolvePidInput(m: PidModule, modules: Record<string, AnyModule>): void {
  const io = m.io ?? (m.io = createPidIo(m))
  if (io.inputSource) {
    const signal = readAnalogSignal(io.inputSource, modules)
    m.pvBad = !io.aiConnected || signal.bad
    if (!m.pvBad) m.pv = clamp(signal.value, m.pvMin, m.pvMax)
  } else {
    m.pvBad = !io.aiConnected || io.ai.bad
    if (!m.pvBad) m.pv = io.ai.out
  }
}

function executeAnalogOutput(
  stage: AnalogOutputStage, source: { value: number; bad: boolean },
  connected: boolean, hardwareBad: boolean
): void {
  const command = stage.mode === 'MAN' ? stage.manualValue : source.value
  stage.bad = hardwareBad || !!stage.fault || !Number.isFinite(command) ||
    (stage.mode === 'CAS' && (!connected || source.bad))
  if (!stage.bad) stage.out = clamp(command, stage.lowLimit, stage.highLimit)
  stage.limited = !stage.bad && stage.out !== command
  stage.limitStatus = stage.bad ? 'NONE' : command >= stage.highLimit ? 'HIGH' :
    command <= stage.lowLimit ? 'LOW' : 'NONE'
}

export function appliedPidOutput(m: PidModule): number {
  const io = pidIo(m)
  if (!io.splitter || !io.ao2) return io.ao.out
  return clamp(io.actuation === 'HEAT_COOL'
    ? (100 + io.ao2.out - io.ao.out) / 2 : (io.ao.out + io.ao2.out) / 2, 0, 100)
}

export function executePidOutput(
  m: PidModule, modules: Record<string, AnyModule>, hardwareBad: boolean, dt = 0, hardware2Bad = false
): void {
  const io = m.io ?? (m.io = createPidIo(m))
  if (io.splitter && io.ao2) {
    const split = io.splitter
    const feedback1 = outputFeedback(io.ao, io.aoConnected && !io.outputSource)
    const feedback2 = outputFeedback(io.ao2, !!io.ao2Connected && !io.output2Source)
    executeSplitter(split, { value: m.out, bad: pidExecutionBad(m) }, feedback1, feedback2, dt)
    executeAnalogOutput(io.ao, io.outputSource ? readAnalogSignal(io.outputSource, modules) :
      { value: split.out1, bad: split.status === 'BAD' }, io.aoConnected, hardwareBad)
    executeAnalogOutput(io.ao2, io.output2Source ? readAnalogSignal(io.output2Source, modules) :
      { value: split.out2, bad: split.status === 'BAD' }, !!io.ao2Connected, hardware2Bad)
    if (split.mode === 'CAS' && io.bkcalConnected) {
      refreshSplitterStatus(split,
        outputFeedback(io.ao, io.aoConnected && !io.outputSource),
        outputFeedback(io.ao2, !!io.ao2Connected && !io.output2Source))
      if (!pidExecutionBad(m) && m.actualMode !== 'LO' && m.mode !== 'MAN' && m.mode !== 'ROUT' &&
          (m.actualMode === 'IMAN' || split.status === 'NOT_INVITED' || split.status === 'BAD')) {
        if (split.status === 'NOT_INVITED' || split.status === 'BAD') m.actualMode = 'IMAN'
        m.out = split.bkcal
        m._integral = m.out
      }
    }
    return
  }
  if (io.splitter) {
    io.splitter.error = 'SPLTR configuration error: AO2 is missing'
    io.splitter.status = 'BAD'
    io.splitter.actualMode = 'OOS'
    return
  }
  const source = io.outputSource ? readAnalogSignal(io.outputSource, modules) : { value: m.out, bad: pidExecutionBad(m) }
  executeAnalogOutput(io.ao, source, io.aoConnected, hardwareBad)
  if (!pidExecutionBad(m) && m.actualMode !== 'LO' && io.bkcalConnected && io.ao.limited && io.ao.mode === 'CAS' && !io.outputSource) {
    m._integral += io.ao.out - m.out
  }
}

export function pidOutputUnavailable(m: PidModule): boolean {
  const io = pidIo(m)
  return io.splitter
    ? io.splitter.mode !== 'CAS' || !io.splitter.inputConnected ||
      io.splitter.status === 'BAD' || io.splitter.status === 'NOT_INVITED'
    : io.ao.mode === 'MAN' || io.ao.bad || !io.aoConnected || !!io.outputSource
}
