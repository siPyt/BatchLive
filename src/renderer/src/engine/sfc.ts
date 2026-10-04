import type { PlantState, AnyModule, PidModule, ControlMode } from './types'

// ---------------------------------------------------------------------------
// Sequential Function Chart (SFC) engine — mirrors DeltaV Control Studio SFCs.
// An SFC is a list of steps; each step applies actions while active and waits
// for its transition condition before advancing. (DV-09 "Using SFC-T101".)
// ---------------------------------------------------------------------------

export type CompareOp = '>' | '<' | '>=' | '<='

export type ActionQualifier = 'N' | 'P' | 'S' | 'R' | 'D' | 'L' | 'SD' | 'DS' | 'SL'
export const TIMED_QUALIFIERS: ActionQualifier[] = ['P', 'D', 'L', 'SD', 'DS', 'SL']

interface ActionBase {
  qualifier?: ActionQualifier
  name?: string
  seconds?: number
  timingCondition?: SfcCondition
}

export type SfcAction = ActionBase &
  (
    | { kind: 'mode'; tag: string; mode: ControlMode }
    | { kind: 'sp'; tag: string; value: number }
    | { kind: 'out'; tag: string; value: number }
    | { kind: 'motor'; tag: string; run: boolean }
    | { kind: 'valve'; tag: string; open: boolean }
    | { kind: 'do'; tag: string; on: boolean }
  )

export type SfcCondition =
  | { kind: 'always' }
  | { kind: 'timer'; seconds: number }
  | { kind: 'pv'; tag: string; op: CompareOp; value: number }
  | { kind: 'out'; tag: string; op: CompareOp; value: number }
  | { kind: 'motorRunning'; tag: string; running: boolean }
  | { kind: 'valveOpen'; tag: string; open: boolean }

export interface SfcStep {
  id: string
  name: string
  actions: SfcAction[]
  transition: SfcCondition
}

export type SfcStatus = 'READY' | 'RUNNING' | 'HELD' | 'COMPLETE'

export interface SfcDef {
  name: string
  area: string
  steps: SfcStep[]
  status: SfcStatus
  active: number
  elapsed: number
  actionStates?: Record<string, SfcActionState>
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
  return action.name?.trim() || `${action.tag}/${action.kind}`
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
    case 'valve':
      return `${q}^/${a.tag}/DC1/OUT_D.CV := ${a.open ? 1 : 0} (${a.open ? 'OPEN' : 'CLOSE'})`
    case 'do':
      return `${q}^/${a.tag}/DO1/OUT_D.CV := ${a.on ? 1 : 0} (${a.on ? 'ON' : 'OFF'})`
  }
}

export function describeCondition(c: SfcCondition): string {
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
  }
}

export function evalCondition(c: SfcCondition, state: PlantState, elapsed: number): boolean {
  const m = 'tag' in c ? (state.modules[c.tag] as AnyModule | undefined) : undefined
  switch (c.kind) {
    case 'always':
      return true
    case 'timer':
      return timeReached(elapsed, c.seconds)
    case 'pv':
      return m && 'pv' in m ? cmp(m.pv, c.op, c.value) : false
    case 'out':
      return m && (m.type === 'PID' || m.type === 'AO') ? cmp(m.out, c.op, c.value) : false
    case 'motorRunning':
      return m && m.type === 'MOTOR' ? m.running === c.running : false
    case 'valveOpen':
      return m && m.type === 'VALVE' ? m.open === c.open : false
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

function conditionError(condition: SfcCondition, modules: Record<string, AnyModule>): string | null {
  if (condition.kind === 'timer') {
    return !Number.isFinite(condition.seconds) || condition.seconds < 0 ? 'Timer must be finite and nonnegative' : null
  }
  if (condition.kind === 'always') return null
  const module = modules[condition.tag]
  if (!module) return `Missing condition module ${condition.tag}`
  if (condition.kind === 'motorRunning') return module.type !== 'MOTOR' ? 'Running condition requires a motor' : null
  if (condition.kind === 'valveOpen') return module.type !== 'VALVE' ? 'Open condition requires a valve' : null
  if (!Number.isFinite(condition.value) || !['>', '<', '>=', '<='].includes(condition.op)) return 'Invalid comparison'
  if (condition.kind === 'pv') return !['PID', 'AI', 'AO'].includes(module.type) ? 'PV condition requires an analog module' : null
  return !['PID', 'AO'].includes(module.type) ? 'OUT condition requires PID or AO' : null
}

export function sfcStepsError(steps: SfcStep[], modules: Record<string, AnyModule>): string | null {
  const ids = new Set<string>()
  const stored = new Set(steps.flatMap(step => step.actions.filter(isStored).map(actionIdentity)))
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) return 'SFC step IDs must be nonempty and unique'
    ids.add(step.id)
    const transitionError = conditionError(step.transition, modules)
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
      const module = modules[action.tag]
      if (!module) return `Missing action module ${action.tag}`
      const required = action.kind === 'motor' ? 'MOTOR' : action.kind === 'valve' ? 'VALVE' : action.kind === 'do' ? 'DO' : null
      if (required ? module.type !== required : module.type !== 'PID' && module.type !== 'AO') return 'Action/module type mismatch'
      if ((action.kind === 'sp' || action.kind === 'out') && !Number.isFinite(action.value)) return 'Action value must be finite'
      if (action.kind === 'mode' && (module.type === 'AO' ?
        !['MAN', 'AUTO', 'CAS'].includes(action.mode) :
        !['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN'].includes(action.mode))) return 'Invalid target mode'
      if (TIMED_QUALIFIERS.includes(action.qualifier ?? 'N')) {
        if (action.timingCondition) {
          const error = conditionError(action.timingCondition, modules)
          if (error) return error
        } else if (!Number.isFinite(action.seconds ?? 0) || (action.seconds ?? 0) < 0) return 'Action time must be finite and nonnegative'
      }
    }
  }
  return null
}

function updateActionState(runtime: SfcActionState, state: PlantState, stepActive: boolean): SfcActionState {
  const action = runtime.action
  const q = action.qualifier
  const reached = action.timingCondition ? evalCondition(action.timingCondition, state, runtime.elapsed) :
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

function beginStepActions(step: SfcStep, states: Record<string, SfcActionState>, elapsed: number): void {
  for (const action of step.actions) {
    const identity = actionIdentity(action)
    if (action.qualifier === 'R') {
      if (elapsed === 0 && states[identity] && states[identity].resetStep !== step.id) {
        states[identity] = { ...states[identity], active: false, pending: false, fired: true, resetStep: step.id }
      }
    } else if (!states[identity] || states[identity].stepId !== step.id) {
      states[identity] = { action: { ...action }, stepId: step.id,
        elapsed, active: false, pending: true, fired: false }
    }
  }
}

export function advanceSfcs(
  state: PlantState & { sfcs: Record<string, SfcDef> },
  modulesIn: Record<string, AnyModule>,
  dt: number
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
    const next: SfcDef = { ...sfc, actionStates }
    const step = sfc.steps[Math.min(sfc.active, sfc.steps.length - 1)]
    next.elapsed = sfc.elapsed + dt
    beginStepActions(step, actionStates, sfc.elapsed)
    for (const [identity, runtime] of Object.entries(actionStates)) {
      const stepActive = runtime.stepId === step.id
      const reset = step.actions.some(action => action.qualifier === 'R' && actionIdentity(action) === identity)
      if (reset) continue
      // Stored timers continue across steps; HOLD pauses this simulated routine.
      const updated = updateActionState({ ...runtime, elapsed: runtime.elapsed + dt }, state, stepActive)
      actionStates[identity] = updated
      const module = modules[updated.action.tag]
      if (updated.active && module) applyAction(module, updated.action)
    }
    if (evalCondition(step.transition, state, next.elapsed)) {
      for (const [identity, runtime] of Object.entries(actionStates)) {
        if (!isStored(runtime.action) || sfc.active === sfc.steps.length - 1) {
          actionStates[identity] = { ...runtime, active: false, pending: false }
        } else if (runtime.action.qualifier === 'DS' && !runtime.active) {
          actionStates[identity] = { ...runtime, pending: false }
        }
      }
      if (sfc.active < sfc.steps.length - 1) {
        next.active = sfc.active + 1
        next.elapsed = 0
        const entering = sfc.steps[next.active]
        beginStepActions(entering, actionStates, 0)
        for (const action of entering.actions) {
          if (action.qualifier === 'R') continue
          const identity = actionIdentity(action)
          const updated = updateActionState(actionStates[identity], state, true)
          actionStates[identity] = updated
          const module = modules[action.tag]
          if (updated.active && module) applyAction(module, action)
        }
      } else {
        next.status = 'COMPLETE'
      }
    }
    sfcs[name] = next
  }
  return { modules, sfcs }
}
