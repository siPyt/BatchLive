import type { PlantState, AnyModule, PidModule, ControlMode } from './types'
import { booleanParameterReferenceError, cloneSfcParameters, namedParameterReferenceError, type SfcExpressionContext, type SfcParameters } from './sfcParameters'
import type { NamedSetDefinition } from './namedSets'
import { executeSfcBlock, syncSfcBlockActivation, type SfcBlockConfiguration, type SfcBlockState } from './sfcBlocks'
import { resetDeviceLock } from './simulate'

// ---------------------------------------------------------------------------
// Sequential Function Chart (SFC) engine — mirrors DeltaV Control Studio SFCs.
// Steps execute one at a time with sequential, return or selective routes.
// Concurrent parallel paths require a separate active-step/join model.
// ---------------------------------------------------------------------------

export type CompareOp = '>' | '<' | '>=' | '<='
export type SfcActualMode = ControlMode | 'OOS'

export type ActionQualifier = 'N' | 'P' | 'S' | 'R' | 'D' | 'L' | 'SD' | 'DS' | 'SL'
export const TIMED_QUALIFIERS: ActionQualifier[] = ['P', 'D', 'L', 'SD', 'DS', 'SL']

interface ActionBase {
  qualifier?: ActionQualifier
  name?: string
  description?: string
  seconds?: number
  timingCondition?: SfcCondition
}

export type SfcAction = ActionBase &
  (
    | { kind: 'mode'; tag: string; mode: ControlMode }
    | { kind: 'sp'; tag: string; value: number }
    | { kind: 'out'; tag: string; value: number }
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

function sequentialTarget(steps: SfcStep[], index: number): string | null {
  return steps[index].nextStep === undefined ? steps[index + 1]?.id ?? null : steps[index].nextStep ?? null
}

export function sfcJoinPredecessors(steps: SfcStep[], join: string): string[] {
  return steps.filter((_, index) => sequentialTarget(steps, index) === join).map(step => step.id)
}

export function sfcParallelJoin(steps: SfcStep[], fork: SfcStep): SfcStep | undefined {
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

function parallelGraphError(steps: SfcStep[]): string | null {
  if (steps.some(step => step.parallelNextSteps !== undefined && step.parallelNextSteps.length < 2 ||
    step.joinFrom !== undefined && step.joinFrom.length < 2)) return 'Parallel destinations and join predecessors require at least two steps'
  const joins = new Set<string>()
  for (const fork of steps.filter(step => step.parallelNextSteps?.length)) {
    const targets = fork.parallelNextSteps ?? []
    if (targets.length < 2 || new Set(targets).size !== targets.length ||
      targets.some(id => !steps.some(step => step.id === id))) return 'Parallel fork requires at least two distinct existing destinations'
    if (fork.nextStep !== undefined || fork.alternatives?.length) return 'Parallel fork cannot also have sequential/selective destinations'
    const visited = new Set<string>([fork.id])
    const writers = new Map<string, number>()
    const identities = new Map<string, number>()
    const tails: string[] = []
    let join: string | undefined
    for (const [leg, target] of targets.entries()) {
      let id: string | null = target
      let previous = fork.id
      while (id) {
        const index = steps.findIndex(step => step.id === id)
        if (index < 0) return 'Parallel leg references a missing destination'
        const step = steps[index]
        if (step.joinFrom?.length) {
          if (!join) join = id
          if (join !== id || previous === fork.id) return 'Parallel legs must converge through the same join after independent steps'
          tails.push(previous)
          break
        }
        if (visited.has(id)) return 'Parallel legs must be disjoint and acyclic before their join'
        visited.add(id)
        if (step.parallelNextSteps?.length || step.alternatives?.length) return 'Nested/selective parallel legs are not supported'
        for (const action of step.actions) {
          const identity = actionIdentity(action)
          if (identities.has(identity) && identities.get(identity) !== leg) return 'Parallel legs cannot share action/reset identities'
          identities.set(identity, leg)
          if (action.qualifier === 'R') continue
          const output = actionOutput(action)
          if (writers.has(output) && writers.get(output) !== leg) return 'Parallel legs cannot write the same output'
          writers.set(output, leg)
        }
        previous = id
        id = sequentialTarget(steps, index)
      }
      if (!id) return 'Every parallel leg must reach its synchronization join'
    }
    const joinStep = steps.find(step => step.id === join)
    if (!joinStep || !joinStep.joinFrom || joinStep.joinFrom.length !== tails.length ||
      tails.some(id => !joinStep.joinFrom?.includes(id)) || joins.has(joinStep.id)) return 'Join must list exactly the independent leg-ending steps of one fork'
    joins.add(joinStep.id)
    if (visited.has(steps[0].id) && steps[0].id !== fork.id) return 'Initial step cannot be inside a parallel leg'
    for (const [index, source] of steps.entries()) {
      if ((sequentialTarget(steps, index) === joinStep.id ||
        source.alternatives?.some(route => route.nextStep === joinStep.id)) && !tails.includes(source.id)) {
        return 'Synchronization join cannot have additional incoming routes'
      }
      const destinations = source.parallelNextSteps ?? [sequentialTarget(steps, index),
        ...(source.alternatives ?? []).map(route => route.nextStep)]
      if (!visited.has(source.id) && destinations.some(id => id && id !== fork.id && visited.has(id))) {
        return 'Parallel legs cannot have incoming routes that bypass their fork'
      }
    }
  }
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
      return `${q}^/${a.tag}/${block}/SP.CV := ${a.value}`
    case 'out':
      return `${q}^/${a.tag}/${block}/OUT.CV := ${a.value}`
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
  }
}

export function evalCondition(c: SfcCondition, state: PlantState, elapsed: number, context?: SfcExpressionContext): boolean {
  const m = 'tag' in c ? (state.modules[c.tag] as AnyModule | undefined) : undefined
  switch (c.kind) {
    case 'always':
      return true
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
      if (m.type === 'AI' || m.type === 'PID') return !m.pvBad && cmp(m.pv, c.op, c.value)
      return m.type === 'AO' && !m.bad && m.actualMode !== 'OOS' && cmp(m.pv, c.op, c.value)
    case 'out':
      return m && (m.type === 'PID' || m.type === 'AO') ? cmp(m.out, c.op, c.value) : false
    case 'motorRunning':
      return m && m.type === 'MOTOR' ? m.running === c.running : false
    case 'valveOpen':
      return m && m.type === 'VALVE' ? m.open === c.open : false
    case 'discrete':
      return !!m && m.type === 'DI' && !m.ioBad && m.mode !== 'OOS' && m.state === c.state
    case 'mode':
      return !!m && (m.type === 'PID' || m.type === 'AO') && m.actualMode === c.mode
  }
}

export function applyAction(m: AnyModule, a: SfcAction): void {
  if (m.type === 'AO') {
    if (a.kind === 'mode' && (a.mode === 'MAN' || a.mode === 'AUTO' || a.mode === 'CAS')) {
      if (a.mode === 'MAN' && m.mode !== 'MAN') m.manualOutput = m.out
      if (a.mode === 'AUTO' && m.mode !== 'AUTO') m.sp = m.pv
      m.mode = a.mode
    } else if (a.kind === 'sp' && Number.isFinite(a.value)) m.sp = clamp(a.value, m.spLow, m.spHigh)
    else if (a.kind === 'out' && m.mode === 'MAN' && Number.isFinite(a.value)) m.manualOutput = clamp(a.value, 0, 100)
    return
  }
  if ((a.kind === 'mode' || a.kind === 'sp' || a.kind === 'out') && m.type === 'PID') {
    const p = m as PidModule
    if (a.kind === 'mode') {
      p.mode = a.mode
      if (a.mode === 'MAN') p._integral = p.out
    } else if (a.kind === 'sp') {
      p.sp = clamp(a.value, p.pvMin, p.pvMax)
    } else if (a.kind === 'out') {
      if (p.mode === 'MAN' || p.mode === 'ROUT') p.out = clamp(a.value, 0, 100)
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
  const module = modules[condition.tag]
  if (!module) return `Missing condition module ${condition.tag}`
  if (condition.kind === 'motorRunning') return module.type !== 'MOTOR' ? 'Running condition requires a motor' : null
  if (condition.kind === 'valveOpen') return module.type !== 'VALVE' ? 'Open condition requires a valve' : null
  if (condition.kind === 'discrete') return module.type !== 'DI' ? 'Discrete feedback condition requires a DI module' : null
  if (condition.kind === 'mode') return module.type !== 'PID' && module.type !== 'AO' ? 'Actual mode condition requires PID or AO' :
    (module.type === 'AO' ? ['MAN', 'AUTO', 'CAS', 'OOS'] : ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN']).includes(condition.mode) ?
      null : 'Unsupported actual mode'
  if (!Number.isFinite(condition.value) || !['>', '<', '>=', '<='].includes(condition.op)) return 'Invalid comparison'
  if (condition.kind === 'pv') return !['PID', 'AI', 'AO'].includes(module.type) ? 'PV condition requires an analog module' : null
  return !['PID', 'AO'].includes(module.type) ? 'OUT condition requires PID or AO' : null
}

export function sfcStepsError(steps: SfcStep[], modules: Record<string, AnyModule>, context?: SfcExpressionContext): string | null {
  const graphError = parallelGraphError(steps)
  if (graphError) return graphError
  const ids = new Set<string>()
  const stored = new Set(steps.flatMap(step => step.actions.filter(isStored).map(actionIdentity)))
  const blocks = steps.flatMap(step => step.actions.filter(action => action.kind === 'block' && action.qualifier !== 'R').map(actionOutput))
  if (new Set(blocks).size !== blocks.length) return 'Each SFC function block requires one owning non-reset action'
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) return 'SFC step IDs must be nonempty and unique'
    ids.add(step.id)
    if (step.nextStep !== undefined && step.nextStep !== null &&
      (typeof step.nextStep !== 'string' || !steps.some(candidate => candidate.id === step.nextStep))) {
      return `Missing transition target for step ${step.name}`
    }
    if (step.alternatives?.length && step.nextStep === undefined) return 'Selective routes require an explicit primary destination'
    for (const route of step.alternatives ?? []) {
      if (!route.nextStep || !steps.some(candidate => candidate.id === route.nextStep)) {
        return `Missing selective transition target for step ${step.name}`
      }
      const error = conditionError(route.condition, modules, context)
      if (error) return error
    }
    const transitionError = conditionError(step.transition, modules, context)
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
        if ((action.kind === 'sp' || action.kind === 'out') && !Number.isFinite(action.value)) return 'Action value must be finite'
        if (action.kind === 'mode' && (module.type === 'AO' ?
          !['MAN', 'AUTO', 'CAS'].includes(action.mode) :
          !['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN'].includes(action.mode))) return 'Invalid target mode'
      }
      if (TIMED_QUALIFIERS.includes(action.qualifier ?? 'N')) {
        if (action.timingCondition) {
          const error = conditionError(action.timingCondition, modules, context)
          if (error) return error
        } else if (!Number.isFinite(action.seconds ?? 0) || (action.seconds ?? 0) < 0) return 'Action time must be finite and nonnegative'
      }
    }
  }
  return null
}

function updateActionState(runtime: SfcActionState, state: PlantState, stepActive: boolean, context?: SfcExpressionContext): SfcActionState {
  const action = runtime.action
  const q = action.qualifier
  const reached = action.timingCondition ? evalCondition(action.timingCondition, state, runtime.elapsed, context) :
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
  return next
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
        elapsed, active: false, pending: true, fired: false }
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
    const primary = evalCondition(step.transition, state, active[id], context)
    const alternate = !primary ? step.alternatives?.find(route => evalCondition(route.condition, state, active[id], context)) : undefined
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
        if (module) applyAction(module, action)
      }
    }
    if (hasParallelSteps(sfc.steps)) {
      sfcs[name] = advanceParallelSfc(next, state, dt, actionStates, execute, context)
      continue
    }
    const step = sfc.steps[Math.min(sfc.active, sfc.steps.length - 1)]
    next.elapsed = sfc.elapsed + dt
    beginStepActions(step, actionStates, sfc.elapsed)
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
    const primary = evalCondition(step.transition, state, next.elapsed, context)
    const alternate = !primary ? step.alternatives?.find(route => evalCondition(route.condition, state, next.elapsed, context)) : undefined
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
