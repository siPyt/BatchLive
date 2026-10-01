import type { PlantState, AnyModule, PidModule, ControlMode } from './types'

// ---------------------------------------------------------------------------
// DeltaV Batch (ISA-88) layer.
// Physical:  Process Cell > Unit > Phase.
// Procedural: Procedure > Operation > Phase (simplified to one operation here).
// Phase logic is a sequential function chart (steps + transitions) per phase.
// ---------------------------------------------------------------------------

export type PhaseState =
  | 'IDLE'
  | 'RUNNING'
  | 'HOLDING'
  | 'HELD'
  | 'RESTARTING'
  | 'STOPPING'
  | 'STOPPED'
  | 'ABORTING'
  | 'ABORTED'
  | 'COMPLETE'

export type BatchStatus = 'READY' | 'RUNNING' | 'HELD' | 'STOPPED' | 'ABORTED' | 'COMPLETE'

export type BatchCommand = 'START' | 'HOLD' | 'RESTART' | 'STOP' | 'ABORT' | 'RESET'

/** One action applied while a step is active (idempotent — re-applied each scan). */
type PhaseAction =
  | { kind: 'mode'; tag: string; mode: ControlMode }
  | { kind: 'sp'; tag: string; value: number }
  | { kind: 'out'; tag: string; value: number }
  | { kind: 'motor'; tag: string; run: boolean }
  | { kind: 'valve'; tag: string; open: boolean }
  | { kind: 'do'; tag: string; on: boolean }

interface PhaseStep {
  name: string
  actions: PhaseAction[]
  /** Transition condition to advance to the next step. */
  until: (p: PlantState, elapsed: number) => boolean
}

export interface PhaseDef {
  name: string
  description: string
  unit: string
  steps: PhaseStep[]
}

export interface BatchEvent {
  t: number
  text: string
}

export interface BatchPhaseRuntime {
  name: string
  description: string
  state: PhaseState
  step: number
  stepName: string
  elapsed: number
}

export interface BatchRuntime {
  id: string
  recipe: string
  unit: string
  status: BatchStatus
  opIndex: number
  phase: BatchPhaseRuntime | null
  log: BatchEvent[]
}

// --- Reactor batch recipe --------------------------------------------------
// Uses the existing reactor plant: feed system charges TK-201, steam heats it,
// a soak holds temperature, then the product pump discharges it.

export const PROCEDURE: string[] = ['CHARGE', 'HEAT', 'REACT', 'DISCHARGE']
export const RECIPE_NAME = 'REACT_A'
export const BATCH_UNIT = 'REACTOR'

export const PHASES: Record<string, PhaseDef> = {
  CHARGE: {
    name: 'CHARGE',
    description: 'Charge reactor from feed system',
    unit: BATCH_UNIT,
    steps: [
      {
        name: 'OPEN_FEED',
        actions: [
          { kind: 'do', tag: 'HS-201', on: true },
          { kind: 'motor', tag: 'P-201', run: false },
          { kind: 'valve', tag: 'XV-101', open: true },
          { kind: 'motor', tag: 'P-101', run: true }
        ],
        until: (p) => p.process.reactorLevel >= 80
      }
    ]
  },
  HEAT: {
    name: 'HEAT',
    description: 'Heat reactor to reaction temperature',
    unit: BATCH_UNIT,
    steps: [
      {
        name: 'STOP_FEED',
        actions: [
          { kind: 'motor', tag: 'P-101', run: false },
          { kind: 'valve', tag: 'XV-101', open: false },
          { kind: 'do', tag: 'HS-201', on: true },
          { kind: 'mode', tag: 'TIC-201', mode: 'AUTO' },
          { kind: 'sp', tag: 'TIC-201', value: 92 }
        ],
        until: (p) => p.process.reactorTemp >= 90
      }
    ]
  },
  REACT: {
    name: 'REACT',
    description: 'Hold at reaction temperature (soak)',
    unit: BATCH_UNIT,
    steps: [
      {
        name: 'SOAK',
        actions: [
          { kind: 'mode', tag: 'TIC-201', mode: 'AUTO' },
          { kind: 'sp', tag: 'TIC-201', value: 92 },
          { kind: 'do', tag: 'HS-201', on: true }
        ],
        until: (_p, elapsed) => elapsed >= 30
      }
    ]
  },
  DISCHARGE: {
    name: 'DISCHARGE',
    description: 'Discharge reactor to product header',
    unit: BATCH_UNIT,
    steps: [
      {
        name: 'PUMP_OUT',
        actions: [
          { kind: 'mode', tag: 'TIC-201', mode: 'MAN' },
          { kind: 'out', tag: 'TIC-201', value: 0 },
          { kind: 'mode', tag: 'LIC-201', mode: 'MAN' },
          { kind: 'out', tag: 'LIC-201', value: 100 },
          { kind: 'motor', tag: 'P-201', run: true },
          { kind: 'do', tag: 'HS-201', on: false }
        ],
        until: (p) => p.process.reactorLevel <= 10
      }
    ]
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function applyAction(m: AnyModule, a: PhaseAction): void {
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
  } else if (a.kind === 'do' && m.type === 'DO') {
    m.commanded = a.on
    m.state = a.on
  }
}

export function makeBatch(): BatchRuntime {
  return {
    id: 'B-0001',
    recipe: RECIPE_NAME,
    unit: BATCH_UNIT,
    status: 'READY',
    opIndex: 0,
    phase: null,
    log: []
  }
}

function newPhaseRuntime(name: string): BatchPhaseRuntime {
  const def = PHASES[name]
  return {
    name,
    description: def.description,
    state: 'RUNNING',
    step: 0,
    stepName: def.steps[0].name,
    elapsed: 0
  }
}

function log(b: BatchRuntime, now: number, text: string): void {
  b.log = [{ t: now, text }, ...b.log].slice(0, 50)
}

/** Apply a single operator command to the batch; returns a new runtime. */
export function commandBatch(prev: BatchRuntime, cmd: BatchCommand, now: number): BatchRuntime {
  const b: BatchRuntime = { ...prev, log: prev.log, phase: prev.phase ? { ...prev.phase } : null }
  switch (cmd) {
    case 'START':
      if (b.status === 'READY') {
        b.status = 'RUNNING'
        b.opIndex = 0
        b.phase = newPhaseRuntime(PROCEDURE[0])
        log(b, now, `Batch ${b.id} started · recipe ${b.recipe}`)
      } else if (b.status === 'HELD' && b.phase) {
        b.status = 'RUNNING'
        b.phase.state = 'RUNNING'
        log(b, now, `Resumed from HELD`)
      }
      break
    case 'HOLD':
      if (b.status === 'RUNNING' && b.phase) {
        b.status = 'HELD'
        b.phase.state = 'HELD'
        log(b, now, `Phase ${b.phase.name} HELD`)
      }
      break
    case 'RESTART':
      if (b.status === 'HELD' && b.phase) {
        b.status = 'RUNNING'
        b.phase.state = 'RUNNING'
        log(b, now, `Phase ${b.phase.name} RESTARTING`)
      }
      break
    case 'STOP':
      if ((b.status === 'RUNNING' || b.status === 'HELD') && b.phase) {
        b.status = 'STOPPED'
        b.phase.state = 'STOPPED'
        log(b, now, `Batch STOPPED by operator`)
      }
      break
    case 'ABORT':
      if (b.status === 'RUNNING' || b.status === 'HELD') {
        b.status = 'ABORTED'
        if (b.phase) b.phase.state = 'ABORTED'
        log(b, now, `Batch ABORTED by operator`)
      }
      break
    case 'RESET':
      b.status = 'READY'
      b.opIndex = 0
      b.phase = null
      log(b, now, `Batch reset to READY`)
      break
  }
  return b
}

/**
 * Advance the batch one scan. Mutates a shallow copy of the modules with phase
 * actions (which the physics step then acts on). Returns the module map to use
 * and the updated batch runtime.
 */
export function advanceBatch(
  state: PlantState & { batch: BatchRuntime },
  dt: number,
  now: number
): { modules: Record<string, AnyModule>; batch: BatchRuntime } {
  const b = state.batch
  if (b.status !== 'RUNNING' || !b.phase) {
    return { modules: state.modules, batch: b }
  }

  // Clone modules so phase actions produce fresh references.
  const modules: Record<string, AnyModule> = {}
  for (const k of Object.keys(state.modules)) modules[k] = { ...state.modules[k] }

  const phase = { ...b.phase }
  const def = PHASES[phase.name]
  const step = def.steps[phase.step]

  // Apply the current step's actions (idempotent).
  for (const a of step.actions) {
    const m = modules[a.tag]
    if (m) applyAction(m, a)
  }

  phase.elapsed += dt
  const nextBatch: BatchRuntime = { ...b, phase, log: b.log }

  if (step.until(state, phase.elapsed)) {
    if (phase.step < def.steps.length - 1) {
      phase.step += 1
      phase.stepName = def.steps[phase.step].name
      phase.elapsed = 0
    } else {
      // Phase complete → advance to next operation.
      phase.state = 'COMPLETE'
      log(nextBatch, now, `Phase ${phase.name} complete`)
      const nextOp = b.opIndex + 1
      if (nextOp < PROCEDURE.length) {
        nextBatch.opIndex = nextOp
        nextBatch.phase = newPhaseRuntime(PROCEDURE[nextOp])
        log(nextBatch, now, `Phase ${PROCEDURE[nextOp]} running`)
      } else {
        nextBatch.status = 'COMPLETE'
        nextBatch.phase = phase
        log(nextBatch, now, `Batch ${b.id} COMPLETE`)
      }
    }
  }

  return { modules, batch: nextBatch }
}
