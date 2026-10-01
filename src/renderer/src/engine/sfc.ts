import type { PlantState, AnyModule, PidModule, ControlMode } from './types'

// ---------------------------------------------------------------------------
// Sequential Function Chart (SFC) engine — mirrors DeltaV Control Studio SFCs.
// An SFC is a list of steps; each step applies actions while active and waits
// for its transition condition before advancing. (DV-09 "Using SFC-T101".)
// ---------------------------------------------------------------------------

export type CompareOp = '>' | '<' | '>=' | '<='

export type SfcAction =
  | { kind: 'mode'; tag: string; mode: ControlMode }
  | { kind: 'sp'; tag: string; value: number }
  | { kind: 'out'; tag: string; value: number }
  | { kind: 'motor'; tag: string; run: boolean }
  | { kind: 'valve'; tag: string; open: boolean }
  | { kind: 'do'; tag: string; on: boolean }

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
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

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

export function describeAction(a: SfcAction): string {
  switch (a.kind) {
    case 'mode':
      return `${a.tag} mode → ${a.mode}`
    case 'sp':
      return `${a.tag} SP = ${a.value}`
    case 'out':
      return `${a.tag} OUT = ${a.value}%`
    case 'motor':
      return `${a.tag} ${a.run ? 'START' : 'STOP'}`
    case 'valve':
      return `${a.tag} ${a.open ? 'OPEN' : 'CLOSE'}`
    case 'do':
      return `${a.tag} ${a.on ? 'ON' : 'OFF'}`
  }
}

export function describeCondition(c: SfcCondition): string {
  switch (c.kind) {
    case 'always':
      return 'TRUE (no wait)'
    case 'timer':
      return `wait ${c.seconds}s`
    case 'pv':
      return `${c.tag}.PV ${c.op} ${c.value}`
    case 'out':
      return `${c.tag}.OUT ${c.op} ${c.value}`
    case 'motorRunning':
      return `${c.tag} ${c.running ? 'RUNNING' : 'STOPPED'}`
    case 'valveOpen':
      return `${c.tag} ${c.open ? 'OPEN' : 'CLOSED'}`
  }
}

function evalCondition(c: SfcCondition, state: PlantState, elapsed: number): boolean {
  const m = 'tag' in c ? (state.modules[c.tag] as AnyModule | undefined) : undefined
  switch (c.kind) {
    case 'always':
      return true
    case 'timer':
      return elapsed >= c.seconds
    case 'pv':
      return m && 'pv' in m ? cmp(m.pv, c.op, c.value) : false
    case 'out':
      return m && m.type === 'PID' ? cmp((m as PidModule).out, c.op, c.value) : false
    case 'motorRunning':
      return m && m.type === 'MOTOR' ? m.running === c.running : false
    case 'valveOpen':
      return m && m.type === 'VALVE' ? m.open === c.open : false
  }
}

function applyAction(m: AnyModule, a: SfcAction): void {
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

/** Advance all running SFCs one scan; mutates a clone of modules with step actions. */
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
    const next: SfcDef = { ...sfc }
    const step = sfc.steps[Math.min(sfc.active, sfc.steps.length - 1)]
    for (const a of step.actions) {
      const m = modules[a.tag]
      if (m) applyAction(m, a)
    }
    next.elapsed = sfc.elapsed + dt
    if (evalCondition(step.transition, state, next.elapsed)) {
      if (sfc.active < sfc.steps.length - 1) {
        next.active = sfc.active + 1
        next.elapsed = 0
      } else {
        next.status = 'COMPLETE'
      }
    }
    sfcs[name] = next
  }
  return { modules, sfcs }
}
