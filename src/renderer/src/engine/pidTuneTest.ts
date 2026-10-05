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

export interface PidTuningSuggestion { gain: number; reset: number; rate: number }

/**
 * Calculated open-loop (process reaction curve, two-point / Ziegler-Nichols)
 * tuning estimate from a recorded test. This is a transparent simulator
 * calculation from the captured samples, not native DeltaV Tune system
 * identification; review every suggested value before Update Tuning.
 */
export function suggestPidTuning(samples: PidTuneSample[],
  module: { pvMin: number; pvMax: number }): PidTuningSuggestion | { error: string } {
  const result = analyzePidTuneTest(samples)
  if ('error' in result) return result
  const first = samples[0]
  const last = samples.at(-1)!
  const span = module.pvMax - module.pvMin || 1
  const processGain = (result.pvChange / span * 100) / result.outputChange
  if (!Number.isFinite(processGain) || processGain === 0) {
    return { error: 'Suggested tuning requires a finite, nonzero calculated process gain' }
  }
  const totalChange = last.pv - first.pv
  const direction = totalChange >= 0 ? 1 : -1
  const reached = (fraction: number): PidTuneSample | undefined => {
    const target = first.pv + direction * Math.abs(totalChange) * fraction
    return samples.find(sample => direction > 0 ? sample.pv >= target : sample.pv <= target)
  }
  const onset = reached(0.1)
  const rise = reached(0.632)
  if (!onset || !rise) {
    return { error: 'Suggested tuning could not locate the response onset/63% point; extend the test duration' }
  }
  const deadTime = (onset.time - first.time) / 1000
  const timeConstant = (rise.time - first.time) / 1000 - deadTime
  if (deadTime <= 0 || timeConstant <= 0) {
    return { error: 'Suggested tuning requires a measurable dead time and time constant; extend the test or increase the output step' }
  }
  // Ziegler-Nichols open-loop reaction-curve PI rule: Kc = 0.9*(T/(K*L)), Ti = L/0.3.
  const gain = 0.9 * (timeConstant / (Math.abs(processGain) * deadTime))
  const reset = deadTime / 0.3
  const round = (value: number): number => Math.round(value * 1000) / 1000
  return { gain: round(gain), reset: round(reset), rate: 0 }
}
