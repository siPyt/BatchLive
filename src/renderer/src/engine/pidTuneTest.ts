import { pidIo } from './analogStrategy'
import { pidExecutionBad } from './pidModes'
import type { PidModule } from './types'

export interface PidTuneSample {
  time: number
  pv: number
  requestedOut: number
  appliedOut: number
}

export function pidTuneSignature(module: PidModule): string {
  const io = pidIo(module)
  return JSON.stringify({
    tag: module.tag, unit: module.unit, min: module.pvMin, max: module.pvMax,
    gain: module.gain, reset: module.reset, rate: module.rate ?? 0,
    direct: module.direct, outputAction: module.outputAction,
    aiMode: io.ai.mode, inputSource: io.inputSource, outputSource: io.outputSource,
    outputLimits: [io.ao.lowLimit, io.ao.highLimit]
  })
}

export function pidTuneSample(module: PidModule, time: number): PidTuneSample | { error: string } {
  const io = pidIo(module)
  if (module.mode !== 'MAN' || module.actualMode !== 'MAN') {
    return { error: 'Process Test requires target and actual MAN; select MAN and wait for confirmation' }
  }
  if (module.pvBad || io.ai.bad || io.ao.bad || pidExecutionBad(module)) {
    return { error: 'Process Test requires good PV and applied output feedback' }
  }
  if (io.ao2 || io.splitter || !io.aiConnected || !io.aoConnected || io.ao.mode !== 'CAS') {
    return { error: 'Process Test supports a connected single AO stage in CAS, not split-range or overridden output' }
  }
  const sample = { time, pv: module.pv, requestedOut: module.out, appliedOut: io.ao.out }
  return Object.values(sample).every(Number.isFinite) ? sample : { error: 'Process Test values must be finite' }
}

export function analyzePidTuneTest(samples: PidTuneSample[]):
  { duration: number; pvChange: number; outputChange: number; pvSpan: number } | { error: string } {
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last || samples.length < 3 || samples.some((sample, index) =>
    !Object.values(sample).every(Number.isFinite) || index > 0 && sample.time <= samples[index - 1].time)) {
    return { error: 'Process Test requires at least three finite, time-ordered samples' }
  }
  const duration = (last.time - first.time) / 1000
  if (duration < 10) return { error: 'Record at least 10 simulated seconds before reviewing this simulator test' }
  const outputChange = last.appliedOut - first.appliedOut
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(first.appliedOut), Math.abs(last.appliedOut)) * 8
  if (Math.abs(outputChange) + tolerance < 0.1) {
    return { error: 'No applied output step of at least 0.1% was observed; request a manual output change' }
  }
  const pvSpan = Math.max(...samples.map(sample => sample.pv)) - Math.min(...samples.map(sample => sample.pv))
  if (pvSpan < 0.001) return { error: 'No measurable PV response was observed; verify the input/process before Update' }
  return { duration, pvSpan, pvChange: last.pv - first.pv, outputChange }
}
