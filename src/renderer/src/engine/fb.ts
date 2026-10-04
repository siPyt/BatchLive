import type { AnyModule, FbBlockType, FunctionBlockModule } from './types'

export function resetConditionTiming(module: FunctionBlockModule): void {
  module._timerElapsed = 0
  module._timerOutput = false
  module.out = 0
  module.bad = true
  module.expressionError = undefined
}

export function deviceSourceError(modules: Record<string, AnyModule>, tag: string,
  source: string | undefined, role: 'Permissive' | 'Interlock'): string | null {
  const module = modules[tag]
  if (!module || module.type !== 'MOTOR' && module.type !== 'VALVE') {
    return `${role} wiring requires an existing motor or valve`
  }
  return source !== undefined && (!modules[source] || source === tag)
    ? `Choose an existing, separate ${role.toLowerCase()} source module` : null
}

// Shared Function Block helpers used by both the simulation engine
// (simulate.ts) and the Control Studio FBD canvas UI.

/** Whether a block type consumes a second input (IN2). */
export const FB_NEEDS_IN2: Record<FbBlockType, boolean> = {
  // I/O
  ALARM: false,
  MAI: true,
  FFMDI: true,
  FFMDO: false,
  PIN: false,
  // Math
  ABS: false,
  ADD: true,
  ARITH: true,
  CMP: true,
  DIV: true,
  INT: true,
  MLTY: true,
  SUB: true,
  // Timer/Counter
  CTR: false,
  DTE: false,
  OFFD: false,
  OND: false,
  RET: true,
  TP: false,
  // Logical
  ACT: true,
  AND: true,
  BDE: false,
  BFI: true,
  BFO: false,
  CND: true,
  MLTX: true,
  NDE: false,
  NOT: false,
  OR: true,
  PDE: false,
  RS: true,
  SR: true,
  // Analog Control
  BG: false,
  CALC: true,
  CTLSL: true,
  DT: false,
  FLTR: false,
  INSEL: true,
  ISELX: true,
  LE: false,
  LL: false,
  LIM: false,
  MANLD: false,
  RAMP: false,
  RTLM: false,
  RTO: false,
  SCLR: false,
  SGCR: false,
  SGGN: false,
  SGSL: true,
  SPLTR: false
}

/** True for block/module types whose live value is boolean-ish (drawn with a
 * green discrete wire instead of a blue analog one). */
export function isDiscreteModule(m: AnyModule): boolean {
  if (m.type === 'MOTOR' || m.type === 'VALVE' || m.type === 'DI' || m.type === 'DO') return true
  if (m.type === 'FB') {
    const discreteTypes: Record<string, boolean> = {
      ALARM: true,
      FFMDO: true,
      AND: true,
      OR: true,
      NOT: true,
      CMP: true,
      BDE: true,
      BFO: true,
      CND: true,
      NDE: true,
      PDE: true,
      RS: true,
      SR: true,
      CTR: true,
      OFFD: true,
      OND: true,
      RET: true,
      TP: true,
      DTE: true
    }
    return !!discreteTypes[m.fbType]
  }
  return false
}

/** Reads the single live numeric value a module exposes on its output pin:
 * PV for AI/PID, 1/0 for discrete states, OUT for AO/function blocks. */
export function readModuleValue(m: AnyModule | undefined): number {
  if (!m) return 0
  switch (m.type) {
    case 'PID':
    case 'AI':
      return m.pv
    case 'MOTOR':
      return m.running ? 1 : 0
    case 'VALVE':
      return m.open ? 1 : 0
    case 'DI':
    case 'DO':
      return m.state ? 1 : 0
    case 'FB':
    case 'AO':
      return m.out
    default:
      return 0
  }
}

/** Short label for a module's single output pin, matching the quantity readModuleValue returns. */
export function outputPinLabel(m: AnyModule): string {
  switch (m.type) {
    case 'PID':
    case 'AI':
      return 'PV'
    case 'MOTOR':
      return 'RUN'
    case 'VALVE':
      return 'OPEN'
    case 'DI':
    case 'DO':
      return 'ST'
    case 'FB':
    case 'AO':
      return 'OUT'
  }

}

/** Execute upstream references first. A cycle's back-edge reads the previous
 * scan value, so a feedback strategy is deterministic and each block runs once. */
export function moduleExecutionOrder(modules: Record<string, AnyModule>): string[] {
  const done = new Set<string>()
  const visiting = new Set<string>()
  const order: string[] = []
  const visit = (tag: string | undefined): void => {
    if (!tag || done.has(tag) || visiting.has(tag) || !modules[tag]) return
    visiting.add(tag)
    const m = modules[tag]
    if (m.type === 'PID') {
      for (const source of [m.casSource, m.ffSource, m.trackSource, m.trackValueSource]) visit(source)
      for (const source of [m.io?.inputSource, m.io?.outputSource, m.io?.output2Source]) {
        if (source?.block !== 'AI1') visit(source?.tag)
      }
    } else if (m.type === 'FB') {
      for (const input of [m.in1, ...(FB_NEEDS_IN2[m.fbType] ? [m.in2] : [])]) {
        if (input.kind === 'ref' && input.block !== 'AI1') visit(input.tag)
      }
    } else if (m.type === 'MOTOR' || m.type === 'VALVE') {
      visit(m.interlockSource)
      visit(m.permissiveSource)
      visit(m.commandSource)
    }
    visiting.delete(tag)
    done.add(tag)
    order.push(tag)
  }
  for (const tag of Object.keys(modules)) visit(tag)
  return order
}
