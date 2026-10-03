import type { AnalogOutputStage, SplitterPatch, SplitterState } from './types'

export interface SplitterFeedback {
  value: number
  invited: boolean
  bad: boolean
  limit: 'HIGH' | 'LOW' | 'NONE'
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

export function createSplitter(sp = 0): SplitterState {
  return {
    mode: 'CAS', actualMode: 'CAS', sp, autoSp: sp,
    inArray: [0, 50, 50, 100], outArray: [0, 100, 0, 100],
    lockval: 'HOLD', hysteresisPct: 5, balTimeSec: 40, spRateUp: 0, spRateDown: 0,
    out1: clamp(sp * 2, 0, 100), out2: clamp((sp - 50) * 2, 0, 100), bkcal: sp,
    status: 'GOOD', error: null, inputConnected: true,
    feedback1Connected: true, feedback2Connected: true,
    _locked: false, _invited1: true, _invited2: true,
    _balance1: 0, _balance2: 0, _remaining1: 0, _remaining2: 0
  }
}

export function cloneSplitter(state: SplitterState): SplitterState {
  return { ...state, inArray: [...state.inArray], outArray: [...state.outArray] }
}

export function configureSplitter(state: SplitterState, patch: SplitterPatch): SplitterState {
  const { sp, ...settings } = patch
  const next = { ...cloneSplitter(state), ...settings }
  if (sp !== undefined) next.autoSp = sp
  next.inArray = [...next.inArray]
  next.outArray = [...next.outArray]
  return next
}

export function splitterConfigError(state: SplitterState): string | null {
  const [x11, x12, x21, x22] = state.inArray
  if (!['CAS', 'AUTO', 'OOS'].includes(state.mode)) return 'SPLTR supports CAS, AUTO and OOS targets, not MAN'
  if (!Number.isFinite(state.autoSp)) return 'Splitter AUTO setpoint must be finite'
  if (state.inArray.length !== 4 || state.outArray.length !== 4) return 'Each splitter array requires four coordinates'
  if ([...state.inArray, ...state.outArray].some(value => !Number.isFinite(value))) {
    return 'Splitter coordinates must be finite'
  }
  if (x12 <= x11 || x22 <= x21 || x21 < x11) {
    return 'SPLTR configuration error: X12 > X11, X22 > X21 and X21 >= X11 are required'
  }
  if ([state.balTimeSec, state.hysteresisPct, state.spRateUp, state.spRateDown]
    .some(value => !Number.isFinite(value) || value < 0)) {
    return 'Splitter timing, hysteresis and rate limits must be finite and nonnegative'
  }
  return null
}

export function outputFeedback(stage: AnalogOutputStage, connected: boolean): SplitterFeedback {
  return {
    value: stage.out, invited: connected && stage.mode === 'CAS',
    bad: stage.bad, limit: stage.limitStatus ?? 'NONE'
  }
}

export function splitterValue(state: SplitterState, sp: number, branch: 1 | 2): number {
  const offset = branch === 1 ? 0 : 2
  const [x1, x2] = state.inArray.slice(offset, offset + 2)
  const [y1, y2] = state.outArray.slice(offset, offset + 2)
  if (branch === 1 && state.lockval === 'Y11' && state._locked) return y1
  return y1 + (clamp(sp, x1, x2) - x1) / (x2 - x1) * (y2 - y1)
}

function inverseValue(state: SplitterState, value: number, branch: 1 | 2): number {
  const offset = branch === 1 ? 0 : 2
  const x1 = state.inArray[offset], x2 = state.inArray[offset + 1]
  const y1 = state.outArray[offset], y2 = state.outArray[offset + 1]
  if (y2 === y1) return state.sp
  return clamp(x1 + (value - y1) / (y2 - y1) * (x2 - x1),
    state.inArray[0], state.inArray[3])
}

/** Function reference pp. 278-286: two coordinate curves, mode/status handling,
 * direction-aware limits, initialization and timed downstream balancing. */
export function executeSplitter(
  state: SplitterState, input: { value: number; bad: boolean },
  feedback1: SplitterFeedback, feedback2: SplitterFeedback, dt: number
): void {
  state.error = splitterConfigError(state)
  if (state.error || state.mode === 'OOS') {
    state.actualMode = 'OOS'
    state.status = 'BAD'
    return
  }
  if (state.mode === 'CAS' && (!state.inputConnected || input.bad || !Number.isFinite(input.value))) {
    state.actualMode = 'IMAN'
    state.status = 'BAD'
    return
  }
  state.status = 'GOOD'
  const f1 = { ...feedback1, invited: feedback1.invited && state.feedback1Connected }
  const f2 = { ...feedback2, invited: feedback2.invited && state.feedback2Connected }
  const usable1 = f1.invited && !f1.bad
  const usable2 = f2.invited && !f2.bad
  const previousBothUnavailable = !state._invited1 && !state._invited2
  let target = state.mode === 'CAS' ? input.value : state.autoSp
  if (!usable1 && !usable2) {
    state.actualMode = 'IMAN'
    state.status = 'NOT_INVITED'
    state.sp = inverseValue(state, f1.bad ? f2.value : f1.value, f1.bad ? 2 : 1)
  } else {
    state.actualMode = state.mode
    if (previousBothUnavailable) {
      target = inverseValue(state, usable1 ? f1.value : f2.value, usable1 ? 1 : 2)
    }
    if (state.mode === 'AUTO') {
      const delta = target - state.bkcal
      const rate = delta >= 0 ? state.spRateUp : state.spRateDown
      if (rate > 0) target = state.bkcal + clamp(delta, -rate * dt, rate * dt)
    }
    state.sp = clamp(target, state.inArray[0], state.inArray[3])
  }
  if (state.lockval === 'Y11') {
    const hysteresis = (state.inArray[1] - state.inArray[0]) * state.hysteresisPct / 100
    if (state.sp > state.inArray[1]) state._locked = true
    else if (state.sp < state.inArray[1] - hysteresis) state._locked = false
  } else state._locked = false

  const calculated1 = splitterValue(state, state.sp, 1)
  const calculated2 = splitterValue(state, state.sp, 2)
  const balance = (branch: 1 | 2, feedback: SplitterFeedback, usable: boolean, value: number): number => {
    const invitedKey = branch === 1 ? '_invited1' : '_invited2'
    const balanceKey = branch === 1 ? '_balance1' : '_balance2'
    const remainingKey = branch === 1 ? '_remaining1' : '_remaining2'
    if (!usable) {
      state[balanceKey] = feedback.value - value
      state[remainingKey] = state.balTimeSec
      return feedback.value
    }
    if (!state[invitedKey] && !previousBothUnavailable) {
      state[balanceKey] = feedback.value - value
      state[remainingKey] = state.balTimeSec
    }
    if (previousBothUnavailable) state[remainingKey] = 0
    const fraction = state.balTimeSec > 0 ? state[remainingKey] / state.balTimeSec : 0
    const result = value + state[balanceKey] * fraction
    state[remainingKey] = Math.max(0, state[remainingKey] - dt)
    return result
  }
  state.out1 = balance(1, f1, usable1, calculated1)
  state.out2 = balance(2, f2, usable2, calculated2)
  state._invited1 = usable1
  state._invited2 = usable2
  state.bkcal = state.sp
  refreshSplitterStatus(state, feedback1, feedback2)
}

export function refreshSplitterStatus(
  state: SplitterState, feedback1: SplitterFeedback, feedback2: SplitterFeedback
): void {
  if (state.error || state.mode === 'OOS' || state.status === 'BAD') return
  const f1 = { ...feedback1, invited: feedback1.invited && state.feedback1Connected }
  const f2 = { ...feedback2, invited: feedback2.invited && state.feedback2Connected }
  const usable1 = f1.invited && !f1.bad
  const usable2 = f2.invited && !f2.bad
  if (!usable1 && !usable2) {
    state.status = 'NOT_INVITED'
    state.actualMode = 'IMAN'
    state.bkcal = inverseValue(state, f1.bad ? f2.value : f1.value, f1.bad ? 2 : 1)
    return
  }
  const slope1 = Math.sign(state.outArray[1] - state.outArray[0])
  const slope2 = Math.sign(state.outArray[3] - state.outArray[2])
  const limitsDirection = (feedback: SplitterFeedback, slope: number, high: boolean): boolean =>
    !feedback.bad && feedback.invited && feedback.limit ===
      ((slope >= 0) === high ? 'HIGH' : 'LOW')
  const highLimited = (f1.limit === 'HIGH' && f2.limit === 'HIGH' && usable1 && usable2) ||
    (!usable2 && limitsDirection(f1, slope1, true)) ||
    (!usable1 && limitsDirection(f2, slope2, true)) || state.sp >= state.inArray[3]
  const lowLimited = (f1.limit === 'LOW' && f2.limit === 'LOW' && usable1 && usable2) ||
    (!usable2 && limitsDirection(f1, slope1, false)) ||
    (!usable1 && limitsDirection(f2, slope2, false)) || state.sp <= state.inArray[0]
  state.status = highLimited ? 'HIGH_LIMITED' : lowLimited ? 'LOW_LIMITED' : 'GOOD'
}
