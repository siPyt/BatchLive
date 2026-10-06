import type { PlantState, AnyModule, PidModule, ControlMode, PidTargetMode } from './types'
import { isPidTargetMode, PID_ACTUAL_MODES, pidExecutionBad, pidTargetAllowed } from './pidModes'
import { readAnalogSignal } from './analogStrategy'
import { booleanParameterReferenceError, cloneSfcParameters, namedParameterReferenceError, placeholderStepViews, type SfcExpressionContext, type SfcParameters, type SfcStepView } from './sfcParameters'
import type { NamedSetDefinition } from './namedSets'
import { executeSfcBlock, syncSfcBlockActivation, type SfcBlockConfiguration, type SfcBlockState } from './sfcBlocks'
import { resetDeviceLock } from './simulate'
import { evalLogicBoolean, evalLogicNumber, logicError } from './sfcLogic'

// ---------------------------------------------------------------------------
// Sequential Function Chart (SFC) engine — mirrors DeltaV Control Studio SFCs.
// Steps execute one at a time with sequential, return or selective routes.
// Concurrent parallel paths require a separate active-step/join model.
// ---------------------------------------------------------------------------

export type CompareOp = '>' | '<' | '>=' | '<='
export type SfcActualMode = ControlMode | 'OOS'

export type ActionQualifier = 'N' | 'P' | 'S' | 'R' | 'D' | 'L' | 'SD' | 'DS' | 'SL'
export const TIMED_QUALIFIERS: ActionQualifier[] = ['P', 'D', 'L', 'SD', 'DS', 'SL']

/** Action Properties > Confirm tab: the action is confirmed when the expression becomes TRUE, and fails if the timeout elapses first. */
export interface SfcActionConfirm {
  expression: string
  /** Seconds; 0 or absent waits indefinitely. */
  timeout?: number
  /** Alternative to the time value: the confirmation fails when this expression becomes TRUE. */
  timeoutExpression?: string
}

interface ActionBase {
  confirm?: SfcActionConfirm
  qualifier?: ActionQualifier
  name?: string
  description?: string
  seconds?: number
  timingCondition?: SfcCondition
}

export type SfcAction = ActionBase &
  (
    | { kind: 'mode'; tag: string; mode: PidTargetMode }
    | { kind: 'sp'; tag: string; value: number; /** Numeric expression evaluated on every execution; `value` is its unused placeholder. */ expression?: string }
    | { kind: 'out'; tag: string; value: number; expression?: string }
    | { kind: 'motor'; tag: string; run: boolean }
    | { kind: 'deviceReset'; tag: string; reset: boolean }
    | { kind: 'valve'; tag: string; open: boolean }
    | { kind: 'do'; tag: string; on: boolean }
    | { kind: 'namedSet'; tag: string; parameter: string; namedSet: string; entry: string }
    | { kind: 'boolean'; tag: string; parameter: string }
    | { kind: 'block'; tag: string; block: string }
  )

export type SfcCondition =
  | { kind: 'always' }
  | { kind: 'timer'; seconds: number }
  | { kind: 'pv'; tag: string; op: CompareOp; value: number }
  | { kind: 'out'; tag: string; op: CompareOp; value: number }
  | { kind: 'motorRunning'; tag: string; running: boolean }
  | { kind: 'valveOpen'; tag: string; open: boolean }
  | { kind: 'discrete'; tag: string; state: boolean }
  | { kind: 'mode'; tag: string; mode: SfcActualMode }
  | { kind: 'namedSet'; parameter: string; namedSet: string; entry: string }
  | { kind: 'boolean'; parameter: string; value: boolean }
  | { kind: 'expression'; text: string }

export interface SfcStep {
  id: string
  name: string
  actions: SfcAction[]
  transition: SfcCondition
  transitionDescription?: string
  nextStep?: string | null
  alternatives?: { condition: SfcCondition; nextStep: string; description?: string }[]
  parallelNextSteps?: string[]
  joinFrom?: string[]
}

export type SfcStatus = 'READY' | 'RUNNING' | 'HELD' | 'COMPLETE'

export interface SfcDef extends SfcBlockConfiguration {
  name: string
  area: string
  description?: string
  equipmentModule?: string
  steps: SfcStep[]
  status: SfcStatus
  active: number
  elapsed: number
  actionStates?: Record<string, SfcActionState>
  parameters?: SfcParameters
  activeSteps?: Record<string, number>
  joinArrivals?: Record<string, string[]>
  blockStates?: Record<string, SfcBlockState>
}

export interface SfcActionState {
  action: SfcAction
  stepId: string
  elapsed: number
  active: boolean
  pending: boolean
  fired: boolean
  resetStep?: string
  confirmStatus?: 'pending' | 'confirmed' | 'failed'
  /** Action runtime clock value when its confirmation started. */
  confirmStart?: number
}

const withStep = (context: SfcExpressionContext | undefined, stepId: string): SfcExpressionContext | undefined =>
  context && { ...context, stepId }

/** Per-step built-in parameters derived from the live action runtime and the active step clocks. */
export function buildStepViews(steps: SfcStep[], actionStates: Record<string, SfcActionState>,
  elapsedOf: (id: string) => number | undefined): SfcStepView[] {
  return steps.map(step => {
    const confirmed = Object.values(actionStates).filter(runtime => runtime.stepId === step.id && runtime.confirmStatus !== undefined)
    const time = elapsedOf(step.id)
    return { id: step.id, name: step.name, active: time !== undefined, time: time ?? 0,
      pendingConfirms: confirmed.filter(runtime => runtime.confirmStatus === 'pending').length,
      failedConfirms: confirmed.filter(runtime => runtime.confirmStatus === 'failed').length }
  })
}

export function sfcStepViews(sfc: SfcDef): SfcStepView[] {
  return buildStepViews(sfc.steps, sfc.actionStates ?? {}, id =>
    sfc.status === 'RUNNING' || sfc.status === 'HELD' ? sfcStepElapsed(sfc, sfc.steps.findIndex(step => step.id === id)) : undefined)
}

export function actionIdentity(action: SfcAction): string {
  return action.name?.trim() || actionOutput(action)
}

function actionOutput(action: SfcAction): string {
  return `${action.tag}/${action.kind === 'namedSet' || action.kind === 'boolean' ? action.parameter : action.kind === 'block' ? action.block : action.kind}`
}

export function syncSfcBooleanActions(sfc: SfcDef): void {
  const targets = new Set(sfc.steps.flatMap(step => step.actions.filter(action => action.kind === 'boolean')
    .map(action => action.parameter)))
  for (const parameter of targets) {
    const binding = sfc.parameters?.[parameter]
    if (binding?.type === 'BOOLEAN') binding.value = Object.values(sfc.actionStates ?? {}).some(runtime =>
      runtime.action.kind === 'boolean' && runtime.action.parameter === parameter && runtime.active)
  }
}

export function resetSfcBooleanActions(sfc: SfcDef): SfcParameters | undefined {
  const next = { ...sfc, parameters: cloneSfcParameters(sfc.parameters), actionStates: {} }
  syncSfcBooleanActions(next)
  return next.parameters
}

export function sfcActionStateKey(step: SfcStep, action: SfcAction, parallel: boolean): string {
  return parallel && !isStored(action) && action.qualifier !== 'R' ?
    `${step.id}:${actionIdentity(action)}` : actionIdentity(action)
}

export function hasParallelSteps(steps: SfcStep[]): boolean {
  return steps.some(step => !!step.parallelNextSteps?.length)
}

export function sfcStepElapsed(sfc: SfcDef, index: number): number | undefined {
  return sfc.activeSteps ? sfc.activeSteps[sfc.steps[index].id] :
    sfc.active === index ? sfc.elapsed : undefined
}

export function sequentialTarget(steps: SfcStep[], index: number): string | null {
  return steps[index].nextStep === undefined ? steps[index + 1]?.id ?? null : steps[index].nextStep ?? null
}

export function sfcJoinPredecessors(steps: SfcStep[], join: string): string[] {
  return steps.filter((_, index) => sequentialTarget(steps, index) === join).map(step => step.id)
}

/** Every destination a step can route to: its parallel legs, or its primary and selective targets. */
export function sfcStepRoutes(steps: SfcStep[], index: number): string[] {
  const step = steps[index]
  if (step.parallelNextSteps?.length) return [...step.parallelNextSteps]
  return [sequentialTarget(steps, index), ...(step.alternatives ?? []).map(route => route.nextStep)]
    .filter((id): id is string => !!id)
}

/** A resolved parallel divergence: its disjoint legs (nested structures included), the one join and each leg's tail. */
export interface SfcForkStructure {
  join: string
  tails: string[]
  legs: Set<string>[]
  region: Set<string>
}

class SfcGraphError extends Error {}

/**
 * Resolve every parallel divergence to its legs, convergence and tails. A leg may branch selectively (including loops
 * back inside the leg) and may contain further divergences; each divergence is resolved innermost first and then treated
 * as one atomic region of its enclosing leg. Stops at the first structural error.
 */
export function sfcForkStructures(steps: SfcStep[]): { forks: Map<string, SfcForkStructure>; error: string | null } {
  const forks = new Map<string, SfcForkStructure>()
  const consumed = new Set<string>()
  const resolving = new Set<string>()
  const indexOf = (id: string): number => steps.findIndex(step => step.id === id)
  const converge = 'Parallel legs must converge through the same join after independent steps'
  const disjoint = 'Parallel legs must be disjoint and acyclic before their join'

  const resolve = (forkId: string): SfcForkStructure => {
    const cached = forks.get(forkId)
    if (cached) return cached
    if (resolving.has(forkId)) throw new SfcGraphError(disjoint)
    resolving.add(forkId)
    const fork = steps[indexOf(forkId)]
    const targets = fork.parallelNextSteps ?? []
    if (targets.length < 2 || new Set(targets).size !== targets.length || targets.some(id => indexOf(id) < 0)) {
      throw new SfcGraphError('Parallel fork requires at least two distinct existing destinations')
    }
    if (fork.nextStep !== undefined || fork.alternatives?.length) {
      throw new SfcGraphError('Parallel fork cannot also have sequential/selective destinations')
    }
    let join: string | undefined
    const legs: Set<string>[] = []
    const tails: string[] = []
    for (const target of targets) {
      if (steps[indexOf(target)].joinFrom?.length && !consumed.has(target)) throw new SfcGraphError(converge)
      const leg = new Set<string>()
      const legTails = new Set<string>()
      const queue = [target]
      while (queue.length) {
        const id = queue.pop() as string
        if (leg.has(id)) continue
        if (id === forkId) throw new SfcGraphError(disjoint)
        const index = indexOf(id)
        const step = steps[index]
        leg.add(id)
        if (step.parallelNextSteps?.length) {
          const inner = resolve(id)
          for (const member of inner.region) leg.add(member)
          queue.push(inner.join)
          continue
        }
        if (sequentialTarget(steps, index) === null) throw new SfcGraphError('Every parallel leg must reach its synchronization join')
        for (const next of sfcStepRoutes(steps, index)) {
          const nextIndex = indexOf(next)
          if (nextIndex < 0) throw new SfcGraphError('Parallel leg references a missing destination')
          if (steps[nextIndex].joinFrom?.length && !consumed.has(next)) {
            join ??= next
            if (join !== next) throw new SfcGraphError(converge)
            legTails.add(id)
          } else queue.push(next)
        }
      }
      if (legTails.size === 0) throw new SfcGraphError('Every parallel leg must reach its synchronization join')
      if (legTails.size > 1) throw new SfcGraphError('Each parallel leg must end in exactly one step that feeds the join')
      tails.push([...legTails][0])
      legs.push(leg)
    }
    const region = new Set<string>()
    for (const leg of legs) for (const id of leg) {
      if (region.has(id)) throw new SfcGraphError(disjoint)
      region.add(id)
    }
    const joinStep = steps.find(step => step.id === join)
    if (!joinStep || !joinStep.joinFrom || joinStep.joinFrom.length !== tails.length ||
      tails.some(id => !joinStep.joinFrom?.includes(id)) || consumed.has(joinStep.id)) {
      throw new SfcGraphError('Join must list exactly the independent leg-ending steps of one fork')
    }
    const writers = new Map<string, number>()
    const identities = new Map<string, number>()
    for (const [legIndex, leg] of legs.entries()) for (const id of leg) {
      for (const action of steps[indexOf(id)].actions) {
        const identity = actionIdentity(action)
        if (identities.has(identity) && identities.get(identity) !== legIndex) {
          throw new SfcGraphError('Parallel legs cannot share action/reset identities')
        }
        identities.set(identity, legIndex)
        if (action.qualifier === 'R') continue
        const output = actionOutput(action)
        if (writers.has(output) && writers.get(output) !== legIndex) throw new SfcGraphError('Parallel legs cannot write the same output')
        writers.set(output, legIndex)
      }
    }
    if (region.has(steps[0].id)) throw new SfcGraphError('Initial step cannot be inside a parallel leg')
    for (const [index, source] of steps.entries()) {
      const routes = sfcStepRoutes(steps, index)
      if (routes.includes(joinStep.id) && !tails.includes(source.id)) {
        throw new SfcGraphError('Synchronization join cannot have additional incoming routes')
      }
      if (source.id !== forkId && !region.has(source.id) && routes.some(id => region.has(id))) {
        throw new SfcGraphError('Parallel legs cannot have incoming routes that bypass their fork')
      }
    }
    consumed.add(joinStep.id)
    resolving.delete(forkId)
    const structure = { join: joinStep.id, tails, legs, region }
    forks.set(forkId, structure)
    return structure
  }

  try {
    for (const fork of steps.filter(step => step.parallelNextSteps?.length)) resolve(fork.id)
  } catch (error) {
    if (error instanceof SfcGraphError) return { forks, error: error.message }
    throw error
  }
  return { forks, error: null }
}

export function sfcParallelJoin(steps: SfcStep[], fork: SfcStep): SfcStep | undefined {
  const resolved = sfcForkStructures(steps).forks.get(fork.id)
  if (resolved) return steps.find(step => step.id === resolved.join)
  let id = fork.parallelNextSteps?.[0]
  const visited = new Set<string>()
  while (id && !visited.has(id)) {
    visited.add(id)
    const index = steps.findIndex(step => step.id === id)
    if (index === -1) return undefined
    if (steps[index].joinFrom?.length) return steps[index]
    id = sequentialTarget(steps, index) ?? undefined
  }
  return undefined
}

export function parallelGraphError(steps: SfcStep[]): string | null {
  if (steps.some(step => step.parallelNextSteps !== undefined && step.parallelNextSteps.length < 2 ||
    step.joinFrom !== undefined && step.joinFrom.length < 2)) return 'Parallel destinations and join predecessors require at least two steps'
  const { forks, error } = sfcForkStructures(steps)
  if (error) return error
  const joins = new Set([...forks.values()].map(fork => fork.join))
  if (steps.some((step, index) => step.joinFrom?.length &&
    (index === 0 || !joins.has(step.id) || new Set(step.joinFrom).size !== step.joinFrom.length))) {
    return 'Join requires a matching parallel fork and distinct predecessor steps; initial step cannot be a join'
  }
  if (joins.size) {
    const storedOutputs = steps.flatMap(step => step.actions.filter(isStored).map(action => ({
      step: step.id, output: actionOutput(action)
    })))
    if (steps.some(step => step.actions.some(action => action.qualifier !== 'R' &&
      storedOutputs.some(stored => stored.step !== step.id &&
        stored.output === actionOutput(action))))) {
      return 'Stored outputs in parallel charts must have one owning step'
    }
  }
  return null
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function timeReached(elapsed: number, seconds: number): boolean {
  return elapsed >= seconds || seconds - elapsed <= Number.EPSILON * Math.max(1, elapsed, seconds) * 64
}

function cmp(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>':
      return a > b
    case '<':
      return a < b
    case '>=':
      return a >= b
    case '<=':
      return a <= b
  }
}

export function describeAction(a: SfcAction, module?: AnyModule): string {
  if (a.qualifier === 'R') return `Reset stored action ${actionIdentity(a)}`
  const q = a.qualifier && a.qualifier !== 'S' ? `[${a.qualifier}${a.seconds !== undefined ? ' ' + a.seconds + 's' : ''}] ` : ''
  const block = module?.type === 'AO' ? 'AO1' : 'PID1'
  switch (a.kind) {
    case 'mode':
      return `${q}^/${a.tag}/${block}/MODE.TARGET := ${a.mode}`
    case 'sp':
      return `${q}^/${a.tag}/${block}/SP.CV := ${a.expression ?? a.value}`
    case 'out':
      return `${q}^/${a.tag}/${block}/OUT.CV := ${a.expression ?? a.value}`
    case 'motor':
      return `${q}^/${a.tag}/DC1/OUT_D.CV := ${a.run ? 1 : 0} (${a.run ? 'START' : 'STOP'})`
    case 'deviceReset':
      return `${q}^/${a.tag}/DC1/RESET_D.CV := ${Number(a.reset)}`
    case 'valve':
      return `${q}^/${a.tag}/DC1/OUT_D.CV := ${a.open ? 1 : 0} (${a.open ? 'OPEN' : 'CLOSE'})`
    case 'do':
      return `${q}^/${a.tag}/DO1/SP_D.CV := ${a.on ? 1 : 0} (${a.on ? 'ON' : 'OFF'})`
    case 'namedSet':
      return `${q}'${a.parameter}' := '${a.namedSet}:${a.entry}'`
    case 'boolean':
      return `${q}Boolean '${a.parameter}.CV'`
    case 'block':
      return `${q}Function Block '${a.block}'`
  }
}

export function describeCondition(c: SfcCondition, module?: AnyModule): string {
  switch (c.kind) {
    case 'always':
      return 'TRUE (no wait)'
    case 'timer':
      return `T_ACTIVE >= ${c.seconds}s`
    case 'pv':
      return `^/${c.tag}/AI1/PV.CV ${c.op} ${c.value}`
    case 'out':
      return `^/${c.tag}/PID1/OUT.CV ${c.op} ${c.value}`
    case 'motorRunning':
      return `^/${c.tag}/DC1/PV_D.CV = ${c.running ? 1 : 0} (${c.running ? 'RUNNING' : 'STOPPED'})`
    case 'valveOpen':
      return `^/${c.tag}/DC1/PV_D.CV = ${c.open ? 1 : 0} (${c.open ? 'OPEN' : 'CLOSED'})`
    case 'discrete':
      return `^/${c.tag}/DI1/PV_D.CV = ${Number(c.state)}`
    case 'mode':
      return `^/${c.tag}/${module?.type === 'AO' ? 'AO1' : 'PID1'}/MODE.ACTUAL = ${c.mode}`
    case 'namedSet':
      return `'${c.parameter}' = '${c.namedSet}:${c.entry}'`
    case 'boolean':
      return `'${c.parameter}.CV' = ${c.value ? 'TRUE' : 'FALSE'}`
    case 'expression':
      return c.text
  }
}

export function evalCondition(c: SfcCondition, state: PlantState, elapsed: number, context?: SfcExpressionContext): boolean {
  const m = 'tag' in c ? (state.modules[c.tag] as AnyModule | undefined) : undefined
  switch (c.kind) {
    case 'always':
      return true
    case 'expression':
      return evalLogicBoolean(c.text, state, elapsed, context)
    case 'timer':
      return timeReached(elapsed, c.seconds)
    case 'namedSet': {
      if (namedParameterReferenceError(c.parameter, c.namedSet, c.entry, context)) return false
      const entry = context?.sets[c.namedSet].entries.find(item => item.name === c.entry)
      return !!entry && context?.parameters[c.parameter].value === entry.value
    }
    case 'boolean':
      return !booleanParameterReferenceError(c.parameter, context) && context?.parameters[c.parameter].value === c.value
    case 'pv':
      if (!m || !('pv' in m) || !Number.isFinite(m.pv)) return false
      if (m.type === 'AI' || m.type === 'PID') return !m.pvBad &&
        (m.type !== 'PID' || !pidExecutionBad(m)) && cmp(m.pv, c.op, c.value)
      return m.type === 'AO' && !m.bad && m.actualMode !== 'OOS' && cmp(m.pv, c.op, c.value)
    case 'out': {
      if (!m || (m.type !== 'PID' && m.type !== 'AO')) return false
      const signal = readAnalogSignal({ tag: m.tag, parameter: 'OUT' }, state.modules)
      return !signal.bad && cmp(signal.value, c.op, c.value)
    }
    case 'motorRunning':
      return m && m.type === 'MOTOR' && !m.ioInputBad && !m.ioOutputBad ? m.running === c.running : false
    case 'valveOpen':
      return m && m.type === 'VALVE' && !m.ioInputBad && !m.ioOutputBad ? m.open === c.open : false
    case 'discrete':
      return !!m && m.type === 'DI' && !m.ioBad && m.mode !== 'OOS' && m.state === c.state
    case 'mode':
      return !!m && (m.type === 'PID' || m.type === 'AO') && m.actualMode === c.mode
  }
}

export function applyAction(m: AnyModule, a: SfcAction): void {
  if (m.type === 'AO') {
    if (a.kind === 'mode' && (a.mode === 'MAN' || a.mode === 'AUTO' || a.mode === 'CAS' || a.mode === 'OOS')) {
      if (a.mode === 'MAN' && m.mode !== 'MAN') m.manualOutput = m.out
      if (a.mode === 'AUTO' && m.mode !== 'AUTO') m.sp = m.pv
      m.mode = a.mode
    } else if (a.kind === 'sp' && Number.isFinite(a.value)) m.sp = clamp(a.value, m.spLow, m.spHigh)
    else if (a.kind === 'out' && m.mode === 'MAN' && Number.isFinite(a.value)) m.manualOutput = clamp(a.value, 0, 100)
    return
  }
  if ((a.kind === 'mode' || a.kind === 'sp' || a.kind === 'out') && m.type === 'PID') {
    const p = m as PidModule
    if (p.lifecycleOnline === false) return
    if (a.kind === 'mode' && pidTargetAllowed(p, a.mode)) {
      p.mode = a.mode
      if (a.mode === 'MAN') p._integral = p.out
    } else if (a.kind === 'sp') {
      p.sp = clamp(a.value, p.pvMin, p.pvMax)
    } else if (a.kind === 'out') {
      if ((p.mode === 'MAN' || p.mode === 'ROUT') && p.actualMode !== 'LO' && p.actualMode !== 'OOS') {
        p.out = clamp(a.value, 0, 100)
      }
    }
  } else if (a.kind === 'deviceReset' && (m.type === 'MOTOR' || m.type === 'VALVE')) {
    if (a.reset) resetDeviceLock(m)
  } else if (a.kind === 'motor' && m.type === 'MOTOR') {
    m.commanded = a.run
  } else if (a.kind === 'valve' && m.type === 'VALVE') {
    m.commandedOpen = a.open
  } else if (a.kind === 'do' && m.type === 'DO' && m.mode !== 'OOS') {
    m.commanded = a.on
  }
}

let seq = 0
export function newStep(name: string): SfcStep {
  return { id: `S${Date.now().toString(36)}${seq++}`, name, actions: [], transition: { kind: 'always' } }
}

export function makeSampleSfc(): SfcDef {
  return {
    name: 'STARTUP-T101',
    area: 'FEED',
    status: 'READY',
    active: 0,
    elapsed: 0,
    steps: [
      {
        id: newStep('').id,
        name: 'OPEN BLOCK VALVE',
        actions: [{ kind: 'valve', tag: 'XV-101', open: true }],
        transition: { kind: 'valveOpen', tag: 'XV-101', open: true }
      },
      {
        id: newStep('').id,
        name: 'SET FLOW 50',
        actions: [
          { kind: 'mode', tag: 'FIC-101', mode: 'AUTO' },
          { kind: 'sp', tag: 'FIC-101', value: 50 }
        ],
        transition: { kind: 'out', tag: 'FIC-101', op: '>', value: 30 }
      },
      {
        id: newStep('').id,
        name: 'START PUMP',
        actions: [{ kind: 'motor', tag: 'P-101', run: true }],
        transition: { kind: 'motorRunning', tag: 'P-101', running: true }
      }
    ]
  }
}

/** Autoclave sterilization cycle: pre-vacuum pulse, steam-up, hold, exhaust, dry. */
export function makeAutoclaveSfc(
  cfg: { name?: string; tic?: string; pic?: string; xv?: string } = {}
): SfcDef {
  const { name = 'STERILIZE-AC1', tic = 'TIC-501', pic = 'PIC-501', xv = 'XV-501' } = cfg
  return {
    name,
    area: 'AUTOCLAVE',
    status: 'READY',
    active: 0,
    elapsed: 0,
    steps: [
      {
        id: newStep('').id,
        name: 'LOAD CHAMBER',
        actions: [],
        transition: { kind: 'timer', seconds: 5 }
      },
      {
        id: newStep('').id,
        name: 'VACUUM PULSE',
        actions: [
          { kind: 'mode', tag: pic, mode: 'AUTO' },
          { kind: 'sp', tag: pic, value: -80 }
        ],
        transition: { kind: 'pv', tag: pic, op: '<=', value: -75 }
      },
      {
        id: newStep('').id,
        name: 'STEAM UP TO 121C',
        actions: [
          { kind: 'mode', tag: tic, mode: 'AUTO' },
          { kind: 'sp', tag: tic, value: 121 },
          { kind: 'mode', tag: pic, mode: 'AUTO' },
          { kind: 'sp', tag: pic, value: 120 }
        ],
        transition: { kind: 'pv', tag: tic, op: '>=', value: 121 }
      },
      {
        id: newStep('').id,
        name: 'STERILIZE HOLD (121C)',
        actions: [
          { kind: 'mode', tag: tic, mode: 'AUTO' },
          { kind: 'sp', tag: tic, value: 121 }
        ],
        transition: { kind: 'timer', seconds: 20 }
      },
      {
        id: newStep('').id,
        name: 'EXHAUST',
        actions: [
          { kind: 'mode', tag: tic, mode: 'MAN' },
          { kind: 'out', tag: tic, value: 18 },
          { kind: 'mode', tag: pic, mode: 'AUTO' },
          { kind: 'sp', tag: pic, value: 0 },
          { kind: 'valve', tag: xv, open: true }
        ],
        transition: { kind: 'pv', tag: pic, op: '<=', value: 5 }
      },
      {
        id: newStep('').id,
        name: 'VACUUM DRY',
        actions: [
          { kind: 'mode', tag: pic, mode: 'AUTO' },
          { kind: 'sp', tag: pic, value: -50 },
          { kind: 'valve', tag: xv, open: false }
        ],
        transition: { kind: 'timer', seconds: 10 }
      }
    ]
  }
}

/** Lyophilizer cycle: freeze, primary dry (deep vacuum + heat), secondary dry, unload. */
export function makeLyoSfc(cfg: { name?: string; tic?: string; pic?: string; xv?: string } = {}): SfcDef {
  const { name = 'LYO-CYCLE-1', tic = 'TIC-601', pic = 'PIC-601', xv = 'XV-601' } = cfg
  return {
    name,
    area: 'LYO',
    status: 'READY',
    active: 0,
    elapsed: 0,
    steps: [
      {
        id: newStep('').id,
        name: 'LOAD SHELVES',
        actions: [],
        transition: { kind: 'timer', seconds: 5 }
      },
      {
        id: newStep('').id,
        name: 'FREEZING',
        actions: [
          { kind: 'mode', tag: tic, mode: 'AUTO' },
          { kind: 'sp', tag: tic, value: -40 }
        ],
        transition: { kind: 'pv', tag: tic, op: '<=', value: -35 }
      },
      {
        id: newStep('').id,
        name: 'PRIMARY DRYING',
        actions: [
          { kind: 'mode', tag: pic, mode: 'AUTO' },
          { kind: 'sp', tag: pic, value: 100 },
          { kind: 'mode', tag: tic, mode: 'AUTO' },
          { kind: 'sp', tag: tic, value: -20 },
          { kind: 'valve', tag: xv, open: true }
        ],
        transition: { kind: 'pv', tag: pic, op: '<=', value: 110 }
      },
      {
        id: newStep('').id,
        name: 'SECONDARY DRYING',
        actions: [
          { kind: 'mode', tag: tic, mode: 'AUTO' },
          { kind: 'sp', tag: tic, value: 25 }
        ],
        transition: { kind: 'timer', seconds: 15 }
      },
      {
        id: newStep('').id,
        name: 'UNLOAD',
        actions: [{ kind: 'valve', tag: xv, open: false }],
        transition: { kind: 'timer', seconds: 5 }
      }
    ]
  }
}

/** CIP (Clean-In-Place) cycle: pre-rinse, caustic wash, intermediate rinse, acid rinse, drain. */
export function makeCipSfc(cfg: {
  name: string
  tic: string
  fic: string
  p: string
  xvSupply: string
  xvReturn: string
}): SfcDef {
  const { name, tic, fic, p, xvSupply, xvReturn } = cfg
  return {
    name,
    area: 'CIP',
    status: 'READY',
    active: 0,
    elapsed: 0,
    steps: [
      {
        id: newStep('').id,
        name: 'PRE-RINSE',
        actions: [
          { kind: 'valve', tag: xvSupply, open: true },
          { kind: 'valve', tag: xvReturn, open: true },
          { kind: 'motor', tag: p, run: true },
          { kind: 'mode', tag: fic, mode: 'AUTO' },
          { kind: 'sp', tag: fic, value: 20 },
          { kind: 'mode', tag: tic, mode: 'AUTO' },
          { kind: 'sp', tag: tic, value: 25 }
        ],
        transition: { kind: 'timer', seconds: 8 }
      },
      {
        id: newStep('').id,
        name: 'CAUSTIC WASH HEAT-UP',
        actions: [{ kind: 'sp', tag: tic, value: 75 }],
        transition: { kind: 'pv', tag: tic, op: '>=', value: 70 }
      },
      {
        id: newStep('').id,
        name: 'CAUSTIC RECIRC HOLD',
        actions: [],
        transition: { kind: 'timer', seconds: 15 }
      },
      {
        id: newStep('').id,
        name: 'INTERMEDIATE RINSE',
        actions: [{ kind: 'sp', tag: tic, value: 25 }],
        transition: { kind: 'timer', seconds: 8 }
      },
      {
        id: newStep('').id,
        name: 'ACID RINSE',
        actions: [{ kind: 'sp', tag: tic, value: 40 }],
        transition: { kind: 'timer', seconds: 8 }
      },
      {
        id: newStep('').id,
        name: 'FINAL RINSE / DRAIN',
        actions: [
          { kind: 'sp', tag: tic, value: 25 },
          { kind: 'valve', tag: xvSupply, open: false },
          { kind: 'valve', tag: xvReturn, open: false },
          { kind: 'motor', tag: p, run: false }
        ],
        transition: { kind: 'timer', seconds: 5 }
      }
    ]
  }
}

// Qualifiers control execution; ending an assignment never writes its inverse.
function isStored(action: SfcAction): boolean {
  return action.qualifier === 'S' || action.qualifier === 'SD' ||
    action.qualifier === 'DS' || action.qualifier === 'SL'
}

function conditionError(condition: SfcCondition, modules: Record<string, AnyModule>, context?: SfcExpressionContext): string | null {
  if (condition.kind === 'boolean') return typeof condition.value !== 'boolean' ? 'Boolean comparison requires true or false' :
    booleanParameterReferenceError(condition.parameter, context)
  if (condition.kind === 'namedSet') return namedParameterReferenceError(condition.parameter, condition.namedSet, condition.entry, context)
  if (condition.kind === 'timer') {
    return !Number.isFinite(condition.seconds) || condition.seconds < 0 ? 'Timer must be finite and nonnegative' : null
  }
  if (condition.kind === 'always') return null
  if (condition.kind === 'expression') return logicError(condition.text, modules, context, 'boolean')
  const module = modules[condition.tag]
  if (!module) return `Missing condition module ${condition.tag}`
  if (condition.kind === 'motorRunning') return module.type !== 'MOTOR' ? 'Running condition requires a motor' : null
  if (condition.kind === 'valveOpen') return module.type !== 'VALVE' ? 'Open condition requires a valve' : null
  if (condition.kind === 'discrete') return module.type !== 'DI' ? 'Discrete feedback condition requires a DI module' : null
  if (condition.kind === 'mode') return module.type !== 'PID' && module.type !== 'AO' ? 'Actual mode condition requires PID or AO' :
    (module.type === 'AO' ? ['MAN', 'AUTO', 'CAS', 'OOS'] : PID_ACTUAL_MODES).includes(condition.mode) ?
      null : 'Unsupported actual mode'
  if (!Number.isFinite(condition.value) || !['>', '<', '>=', '<='].includes(condition.op)) return 'Invalid comparison'
  if (condition.kind === 'pv') return !['PID', 'AI', 'AO'].includes(module.type) ? 'PV condition requires an analog module' : null
  return !['PID', 'AO'].includes(module.type) ? 'OUT condition requires PID or AO' : null
}

export function sfcStepsError(steps: SfcStep[], modules: Record<string, AnyModule>, context?: SfcExpressionContext): string | null {
  const graphError = parallelGraphError(steps)
  if (graphError) return graphError
  const viewContext = context && { ...context, steps: placeholderStepViews(steps) }
  const ids = new Set<string>()
  const stored = new Set(steps.flatMap(step => step.actions.filter(isStored).map(actionIdentity)))
  const blocks = steps.flatMap(step => step.actions.filter(action => action.kind === 'block' && action.qualifier !== 'R').map(actionOutput))
  if (new Set(blocks).size !== blocks.length) return 'Each SFC function block requires one owning non-reset action'
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) return 'SFC step IDs must be nonempty and unique'
    ids.add(step.id)
    const stepContext = withStep(viewContext, step.id)
    if (step.nextStep !== undefined && step.nextStep !== null &&
      (typeof step.nextStep !== 'string' || !steps.some(candidate => candidate.id === step.nextStep))) {
      return `Missing transition target for step ${step.name}`
    }
    if (step.alternatives?.length && step.nextStep === undefined) return 'Selective routes require an explicit primary destination'
    for (const route of step.alternatives ?? []) {
      if (!route.nextStep || !steps.some(candidate => candidate.id === route.nextStep)) {
        return `Missing selective transition target for step ${step.name}`
      }
      const error = conditionError(route.condition, modules, stepContext)
      if (error) return error
    }
    const transitionError = conditionError(step.transition, modules, stepContext)
    if (transitionError) return transitionError
    const names = new Set<string>()
    for (const action of step.actions) {
      const identity = actionIdentity(action)
      if (names.has(identity)) return `Duplicate action identity ${identity} in step ${step.name}`
      names.add(identity)
      if (action.qualifier !== undefined && !['N', 'P', 'S', 'R', 'D', 'L', 'SD', 'DS', 'SL'].includes(action.qualifier)) {
        return 'Unsupported action qualifier'
      }
      if (action.qualifier === 'R') {
        if (action.confirm) return 'A reset action cannot be confirmed'
        if (!stored.has(identity)) return `Reset target ${identity} has no stored action`
        continue
      }
      if (action.kind === 'namedSet') {
        if (action.tag !== context?.name) return 'Named Set assignments must address their owning SFC'
        const error = namedParameterReferenceError(action.parameter, action.namedSet, action.entry, context)
        if (error) return error
      }
      if (action.kind === 'boolean') {
        if (action.tag !== context?.name) return 'Boolean actions must address their owning SFC'
        const error = booleanParameterReferenceError(action.parameter, context)
        if (error) return error
      }
      if (action.kind === 'block' && (action.tag !== context?.name || !Object.hasOwn(context.blocks ?? {}, action.block))) {
        return 'Function-block actions require an existing block in their owning SFC'
      }
      const module = modules[action.tag]
      if (action.kind !== 'namedSet' && action.kind !== 'boolean' && action.kind !== 'block') {
        if (!module) return `Missing action module ${action.tag}`
        if (action.kind === 'deviceReset') {
          if (module.type !== 'MOTOR' && module.type !== 'VALVE' || typeof action.reset !== 'boolean') {
            return 'Device reset requires a motor/valve and Boolean reset request'
          }
        } else {
          const required = action.kind === 'motor' ? 'MOTOR' : action.kind === 'valve' ? 'VALVE' : action.kind === 'do' ? 'DO' : null
          if (required ? module.type !== required : module.type !== 'PID' && module.type !== 'AO') return 'Action/module type mismatch'
        }
        if ((action.kind === 'sp' || action.kind === 'out') && action.expression !== undefined) {
          const problem = logicError(action.expression, modules, context, 'number')
          if (problem) return problem
        } else if ((action.kind === 'sp' || action.kind === 'out') && !Number.isFinite(action.value)) return 'Action value must be finite'
        if (action.kind === 'mode' && (module.type === 'AO' ?
          !['MAN', 'AUTO', 'CAS', 'OOS'].includes(action.mode) :
          module.type !== 'PID' || !pidTargetAllowed(module, action.mode))) return 'Invalid or non-permitted target mode'
      }
      if (TIMED_QUALIFIERS.includes(action.qualifier ?? 'N')) {
        if (action.timingCondition) {
          const error = conditionError(action.timingCondition, modules, stepContext)
          if (error) return error
        } else if (!Number.isFinite(action.seconds ?? 0) || (action.seconds ?? 0) < 0) return 'Action time must be finite and nonnegative'
      }
      if (action.confirm) {
        const confirm = action.confirm
        const problem = typeof confirm.expression !== 'string' ? 'Confirm requires an expression' :
          logicError(confirm.expression, modules, stepContext, 'boolean')
        if (problem) return `Confirm expression: ${problem}`
        if (confirm.timeout !== undefined && confirm.timeoutExpression !== undefined) return 'Confirm timeout is a time value or an expression, not both'
        if (confirm.timeout !== undefined && (!Number.isFinite(confirm.timeout) || confirm.timeout < 0)) return 'Confirm timeout must be finite and nonnegative'
        if (confirm.timeoutExpression !== undefined) {
          const timeoutProblem = logicError(confirm.timeoutExpression, modules, stepContext, 'boolean')
          if (timeoutProblem) return `Confirm timeout expression: ${timeoutProblem}`
        }
      }
    }
    // Course 7009-8 p8-24: a step with confirmed actions must follow with a transition that lets the confirmation complete.
    if (step.actions.some(action => action.confirm) &&
      !(step.transition.kind === 'expression' && /\b(PENDING_CONFIRMS|FAILED_CONFIRMS|CONFIRM_FAIL)\b/i.test(step.transition.text))) {
      return `Step ${step.name} has confirmed actions; its transition must test PENDING_CONFIRMS, FAILED_CONFIRMS or CONFIRM_FAIL`
    }
  }
  return null
}

function updateActionState(runtime: SfcActionState, state: PlantState, stepActive: boolean, context?: SfcExpressionContext): SfcActionState {
  const action = runtime.action
  const q = action.qualifier
  const reached = action.timingCondition ? evalCondition(action.timingCondition, state, runtime.elapsed, withStep(context, runtime.stepId)) :
    timeReached(runtime.elapsed, action.seconds ?? 0)
  const next = { ...runtime }
  if (!stepActive && !isStored(action)) {
    next.active = false
    next.pending = false
  } else if (q === 'P') {
    next.active = !runtime.fired && reached
    next.fired = runtime.fired || next.active
    next.pending = !next.fired
  } else if (q === 'D' || q === 'SD' || q === 'DS') {
    next.active = runtime.active || (runtime.pending && reached)
    next.pending = runtime.pending && !next.active && (stepActive || q === 'SD')
  } else if (q === 'L' || q === 'SL') {
    next.active = !runtime.fired && !reached
    next.fired = runtime.fired || reached
    next.pending = false
  } else {
    next.active = !runtime.fired
    next.pending = false
  }
  return updateConfirm(next, state, context)
}

/** A confirmation starts when the action first runs, then resolves to confirmed (expression TRUE) or failed (timeout first). */
function updateConfirm(runtime: SfcActionState, state: PlantState, context?: SfcExpressionContext): SfcActionState {
  const confirm = runtime.action.confirm
  if (!confirm || runtime.confirmStatus !== 'pending' || !(runtime.active || runtime.fired)) return runtime
  const start = runtime.confirmStart ?? runtime.elapsed
  const since = runtime.elapsed - start
  const scope = withStep(context, runtime.stepId)
  if (evalLogicBoolean(confirm.expression, state, since, scope)) return { ...runtime, confirmStatus: 'confirmed', confirmStart: start }
  const timedOut = confirm.timeoutExpression !== undefined ? evalLogicBoolean(confirm.timeoutExpression, state, since, scope) :
    (confirm.timeout ?? 0) > 0 && timeReached(since, confirm.timeout ?? 0)
  return { ...runtime, confirmStatus: timedOut ? 'failed' : 'pending', confirmStart: start }
}

function beginStepActions(step: SfcStep, states: Record<string, SfcActionState>, elapsed: number, entering = false, parallel = false): void {
  for (const action of step.actions) {
    const identity = sfcActionStateKey(step, action, parallel)
    if (action.qualifier === 'R') {
      if (elapsed === 0 && states[identity] && (entering || states[identity].resetStep !== step.id)) {
        states[identity] = { ...states[identity], active: false, pending: false, fired: true, resetStep: step.id }
      }
    } else if (!states[identity] || states[identity].stepId !== step.id ||
      entering && !(isStored(action) && (states[identity].active || states[identity].pending))) {
      states[identity] = { action: { ...action }, stepId: step.id,
        elapsed, active: false, pending: true, fired: false,
        ...(action.confirm ? { confirmStatus: 'pending' as const } : {}) }
    }
  }
}

function advanceParallelSfc(sfc: SfcDef, state: PlantState, dt: number,
  actionStates: Record<string, SfcActionState>, execute: (action: SfcAction, elapsed: number) => void,
  context: SfcExpressionContext): SfcDef {
  const active = { ...(sfc.activeSteps ?? { [sfc.steps[sfc.active].id]: sfc.elapsed }) }
  const arrivals = Object.fromEntries(Object.entries(sfc.joinArrivals ?? {}).map(([id, sources]) => [id, [...sources]]))
  const original = Object.keys(active)
  for (const id of original) {
    const step = sfc.steps.find(item => item.id === id)!
    beginStepActions(step, actionStates, active[id], false, true)
    active[id] += dt
  }
  context.steps = buildStepViews(sfc.steps, actionStates, id => active[id])
  const reset = new Set(original.flatMap(id => sfc.steps.find(step => step.id === id)!.actions
    .filter(action => action.qualifier === 'R').map(actionIdentity)))
  for (const [key, runtime] of Object.entries(actionStates)) {
    if (reset.has(key)) continue
    const updated = updateActionState({ ...runtime, elapsed: runtime.elapsed + dt }, state,
      original.includes(runtime.stepId), context)
    actionStates[key] = updated
    if (updated.active) execute(updated.action, updated.elapsed)
  }
  syncSfcBooleanActions(sfc)
  context.steps = buildStepViews(sfc.steps, actionStates, id => active[id])
  const entering = new Set<string>()
  const arrive = (id: string, source: string): void => {
    const target = sfc.steps.find(step => step.id === id)!
    if (target.joinFrom?.length) {
      const pending = arrivals[id] ?? []
      if (!pending.includes(source)) pending.push(source)
      arrivals[id] = pending
      if (!target.joinFrom.every(predecessor => pending.includes(predecessor))) return
      delete arrivals[id]
    }
    entering.add(id)
  }
  for (const id of original) {
    const index = sfc.steps.findIndex(step => step.id === id)
    const step = sfc.steps[index]
    const scope = withStep(context, id)
    const primary = evalCondition(step.transition, state, active[id], scope)
    const alternate = !primary ? step.alternatives?.find(route => evalCondition(route.condition, state, active[id], scope)) : undefined
    if (!primary && !alternate) continue
    delete active[id]
    for (const [key, runtime] of Object.entries(actionStates)) {
      if (runtime.stepId !== id) continue
      if (!isStored(runtime.action)) actionStates[key] = { ...runtime, active: false, pending: false }
      else if (runtime.action.qualifier === 'DS' && !runtime.active) actionStates[key] = { ...runtime, pending: false }
    }
    const destinations = primary && step.parallelNextSteps?.length ? step.parallelNextSteps :
      [alternate ? alternate.nextStep : sequentialTarget(sfc.steps, index)]
    for (const destination of destinations) if (destination) arrive(destination, id)
  }
  for (const id of entering) {
    active[id] = 0
    const step = sfc.steps.find(item => item.id === id)!
    beginStepActions(step, actionStates, 0, true, true)
    for (const action of step.actions) {
      if (action.qualifier === 'R') continue
      const key = sfcActionStateKey(step, action, true)
      const updated = updateActionState(actionStates[key], state, true, context)
      actionStates[key] = updated
      if (updated.active) execute(updated.action, updated.elapsed)
    }
  }
  const complete = !Object.keys(active).length && !Object.keys(arrivals).length
  if (complete) for (const [key, runtime] of Object.entries(actionStates)) {
    actionStates[key] = { ...runtime, active: false, pending: false }
  }
  const first = sfc.steps.findIndex(step => Object.hasOwn(active, step.id))
  syncSfcBooleanActions(sfc)
  syncSfcBlockActivation(sfc)
  return { ...sfc, status: complete ? 'COMPLETE' : 'RUNNING', actionStates,
    activeSteps: active, joinArrivals: arrivals, active: first < 0 ? sfc.active : first,
    elapsed: first < 0 ? 0 : active[sfc.steps[first].id] }
}

export function advanceSfcs(
  state: PlantState & { sfcs: Record<string, SfcDef> },
  modulesIn: Record<string, AnyModule>,
  dt: number,
  namedSetsBySfc: Record<string, Record<string, NamedSetDefinition>> = {}
): { modules: Record<string, AnyModule>; sfcs: Record<string, SfcDef> } {
  const running = Object.values(state.sfcs).some((s) => s.status === 'RUNNING')
  if (!running) return { modules: modulesIn, sfcs: state.sfcs }

  const modules: Record<string, AnyModule> = {}
  for (const k of Object.keys(modulesIn)) modules[k] = { ...modulesIn[k] }

  const sfcs: Record<string, SfcDef> = { ...state.sfcs }
  for (const name of Object.keys(sfcs)) {
    const sfc = sfcs[name]
    if (sfc.status !== 'RUNNING' || sfc.steps.length === 0) continue
    const actionStates: Record<string, SfcActionState> = Object.fromEntries(
      Object.entries(sfc.actionStates ?? {}).map(([key, action]) => [key, { ...action }]))
    const next: SfcDef = { ...sfc, actionStates, blockStates: { ...sfc.blockStates },
      ...(sfc.parameters ? { parameters: cloneSfcParameters(sfc.parameters) } : {}) }
    const context: SfcExpressionContext = { name, parameters: next.parameters ?? {}, sets: namedSetsBySfc[name] ?? {}, blocks: next.blocks }
    const execute = (action: SfcAction, elapsed: number): void => {
      if (action.kind === 'namedSet') {
        if (namedParameterReferenceError(action.parameter, action.namedSet, action.entry, context)) return
        const entry = context.sets[action.namedSet].entries.find(item => item.name === action.entry)
        const binding = context.parameters[action.parameter]
        if (entry && binding.type === 'NAMED_SET') binding.value = entry.value
      } else if (action.kind === 'boolean') {
        const binding = context.parameters[action.parameter]
        if (binding?.type === 'BOOLEAN') binding.value = true
      } else if (action.kind === 'block') {
        executeSfcBlock(next, action.block, elapsed, state.modules)
      } else {
        const module = modules[action.tag]
        if (module && (action.kind === 'sp' || action.kind === 'out') && action.expression !== undefined) {
          const value = evalLogicNumber(action.expression, state, elapsed, context)
          if (value !== null) applyAction(module, { ...action, value })
        } else if (module) applyAction(module, action)
      }
    }
    if (hasParallelSteps(sfc.steps)) {
      sfcs[name] = advanceParallelSfc(next, state, dt, actionStates, execute, context)
      continue
    }
    const step = sfc.steps[Math.min(sfc.active, sfc.steps.length - 1)]
    next.elapsed = sfc.elapsed + dt
    beginStepActions(step, actionStates, sfc.elapsed)
    context.steps = buildStepViews(sfc.steps, actionStates, id => id === step.id ? next.elapsed : undefined)
    for (const [identity, runtime] of Object.entries(actionStates)) {
      const stepActive = runtime.stepId === step.id
      const reset = step.actions.some(action => action.qualifier === 'R' && actionIdentity(action) === identity)
      if (reset) continue
      // Stored timers continue across steps; HOLD pauses this simulated routine.
      const updated = updateActionState({ ...runtime, elapsed: runtime.elapsed + dt }, state, stepActive, context)
      actionStates[identity] = updated
      if (updated.active) execute(updated.action, updated.elapsed)
    }
    syncSfcBooleanActions(next)
    context.steps = buildStepViews(sfc.steps, actionStates, id => id === step.id ? next.elapsed : undefined)
    const scope = withStep(context, step.id)
    const primary = evalCondition(step.transition, state, next.elapsed, scope)
    const alternate = !primary ? step.alternatives?.find(route => evalCondition(route.condition, state, next.elapsed, scope)) : undefined
    if (primary || alternate) {
      const target = alternate ? alternate.nextStep : step.nextStep
      const destination = target === null ? -1 : target !== undefined ?
        sfc.steps.findIndex(candidate => candidate.id === target) :
        sfc.active + 1 < sfc.steps.length ? sfc.active + 1 : -1
      for (const [identity, runtime] of Object.entries(actionStates)) {
        if (!isStored(runtime.action) || destination === -1) {
          actionStates[identity] = { ...runtime, active: false, pending: false }
        } else if (runtime.action.qualifier === 'DS' && !runtime.active) {
          actionStates[identity] = { ...runtime, pending: false }
        }
      }
      if (destination !== -1) {
        next.active = destination
        next.elapsed = 0
        const entering = sfc.steps[next.active]
        beginStepActions(entering, actionStates, 0, true)
        for (const action of entering.actions) {
          if (action.qualifier === 'R') continue
          const identity = actionIdentity(action)
          const updated = updateActionState(actionStates[identity], state, true, context)
          actionStates[identity] = updated
          if (updated.active) execute(action, updated.elapsed)
        }
      } else {
        next.status = 'COMPLETE'
      }
    }
    syncSfcBooleanActions(next)
    syncSfcBlockActivation(next)
    sfcs[name] = next
  }
  return { modules, sfcs }
}
