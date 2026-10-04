import type { PlantState, AnyModule } from './types'
import { advanceSfcs, type SfcDef, type SfcActionState, type SfcStep } from './sfc'

// ---------------------------------------------------------------------------
// DeltaV Batch (ISA-88) layer.
// Physical:  Process Cell > Unit > Phase.
// Procedural: Procedure > Operation > Phase (simplified to one operation here).
// Phase logic is a sequential function chart (steps + transitions) per phase —
// reuses the same SfcStep/SfcAction/SfcCondition engine as Control Studio SFCs,
// since a DeltaV Phase Class Module's logic IS an SFC.
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

export interface PhaseDef {
  name: string
  description: string
  unit: string
  /** Phase logic, editable in the Batch Operator "Phase Logic" panel. */
  steps: SfcStep[]
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
  actionStates?: Record<string, SfcActionState>
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

/** Fresh copy of the default phase logic — call once per plant/store instance. */
export function makeDefaultPhases(): Record<string, PhaseDef> {
  return {
    CHARGE: {
      name: 'CHARGE',
      description: 'Charge reactor from feed system',
      unit: BATCH_UNIT,
      steps: [
        {
          id: 'charge-1',
          name: 'OPEN_FEED',
          actions: [
            { kind: 'do', tag: 'HS-201', on: true },
            { kind: 'motor', tag: 'P-201', run: false },
            { kind: 'valve', tag: 'XV-101', open: true },
            { kind: 'motor', tag: 'P-101', run: true }
          ],
          transition: { kind: 'pv', tag: 'LIC-201', op: '>=', value: 80 }
        }
      ]
    },
    HEAT: {
      name: 'HEAT',
      description: 'Heat reactor to reaction temperature',
      unit: BATCH_UNIT,
      steps: [
        {
          id: 'heat-1',
          name: 'STOP_FEED',
          actions: [
            { kind: 'motor', tag: 'P-101', run: false },
            { kind: 'valve', tag: 'XV-101', open: false },
            { kind: 'do', tag: 'HS-201', on: true },
            { kind: 'mode', tag: 'TIC-201', mode: 'AUTO' },
            { kind: 'sp', tag: 'TIC-201', value: 92 }
          ],
          transition: { kind: 'pv', tag: 'TIC-201', op: '>=', value: 90 }
        }
      ]
    },
    REACT: {
      name: 'REACT',
      description: 'Hold at reaction temperature (soak)',
      unit: BATCH_UNIT,
      steps: [
        {
          id: 'react-1',
          name: 'SOAK',
          actions: [
            { kind: 'mode', tag: 'TIC-201', mode: 'AUTO' },
            { kind: 'sp', tag: 'TIC-201', value: 92 },
            { kind: 'do', tag: 'HS-201', on: true }
          ],
          transition: { kind: 'timer', seconds: 30 }
        }
      ]
    },
    DISCHARGE: {
      name: 'DISCHARGE',
      description: 'Discharge reactor to product header',
      unit: BATCH_UNIT,
      steps: [
        {
          id: 'discharge-1',
          name: 'PUMP_OUT',
          actions: [
            { kind: 'mode', tag: 'TIC-201', mode: 'MAN' },
            { kind: 'out', tag: 'TIC-201', value: 0 },
            { kind: 'mode', tag: 'LIC-201', mode: 'MAN' },
            { kind: 'out', tag: 'LIC-201', value: 100 },
            { kind: 'motor', tag: 'P-201', run: true },
            { kind: 'do', tag: 'HS-201', on: false }
          ],
          transition: { kind: 'pv', tag: 'LIC-201', op: '<=', value: 10 }
        }
      ]
    }
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

function newPhaseRuntime(phases: Record<string, PhaseDef>, name: string): BatchPhaseRuntime {
  const def = phases[name]
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
export function commandBatch(
  prev: BatchRuntime,
  cmd: BatchCommand,
  now: number,
  phases: Record<string, PhaseDef>
): BatchRuntime {
  const b: BatchRuntime = { ...prev, log: prev.log, phase: prev.phase ? { ...prev.phase } : null }
  switch (cmd) {
    case 'START':
      if (b.status === 'READY') {
        b.status = 'RUNNING'
        b.opIndex = 0
        b.phase = newPhaseRuntime(phases, PROCEDURE[0])
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
  state: PlantState & { batch: BatchRuntime; phases: Record<string, PhaseDef> },
  dt: number,
  now: number
): { modules: Record<string, AnyModule>; batch: BatchRuntime } {
  const b = state.batch
  if (b.status !== 'RUNNING' || !b.phase) {
    return { modules: state.modules, batch: b }
  }

  const phase = { ...b.phase }
  const def = state.phases[phase.name]
  const routine: SfcDef = { name: phase.name, area: def.unit, steps: def.steps,
    status: 'RUNNING', active: phase.step, elapsed: phase.elapsed, actionStates: phase.actionStates }
  const advanced = advanceSfcs({ ...state, sfcs: { [phase.name]: routine } }, state.modules, dt)
  const nextRoutine = advanced.sfcs[phase.name]
  const modules = advanced.modules
  phase.step = nextRoutine.active
  phase.stepName = def.steps[phase.step].name
  phase.elapsed = nextRoutine.elapsed
  phase.actionStates = nextRoutine.actionStates
  const nextBatch: BatchRuntime = { ...b, phase, log: b.log }

  if (nextRoutine.status === 'COMPLETE') {
    // Phase complete → advance to next operation.
    phase.state = 'COMPLETE'
    log(nextBatch, now, `Phase ${phase.name} complete`)
    const nextOp = b.opIndex + 1
    if (nextOp < PROCEDURE.length) {
      nextBatch.opIndex = nextOp
      nextBatch.phase = newPhaseRuntime(state.phases, PROCEDURE[nextOp])
      log(nextBatch, now, `Phase ${PROCEDURE[nextOp]} running`)
    } else {
      nextBatch.status = 'COMPLETE'
      nextBatch.phase = phase
      log(nextBatch, now, `Batch ${b.id} COMPLETE`)
    }
  }

  return { modules, batch: nextBatch }
}
