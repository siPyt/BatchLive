import type { AnyModule, ControlMode } from './types'
import type { SfcAction, SfcCondition, CompareOp } from './sfc'

export type ExpressionResult<T> = { value: T; error?: never } | { error: string; value?: never }

function path(text: string): { tag: string; parameter: string } | null {
  const match = unquote(text).match(/^\^?\/?([A-Za-z0-9_$-]+)\/([A-Za-z0-9_/.]+)$/)
  return match ? { tag: match[1].toUpperCase(), parameter: match[2].toUpperCase() } : null
}

function unquote(text: string): string {
  return text.trim().replace(/^(['"])(.*)\1$/, '$2')
}

function numericLiteral(text: string): number {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN
}

export function parseSfcAssignment(text: string, modules: Record<string, AnyModule>): ExpressionResult<SfcAction> {
  const match = text.trim().match(/^(.+?)\s*:=\s*(.+)$/)
  const reference = match ? path(match[1]) : null
  if (!match || !reference) return { error: 'Use a supported quoted module/block/parameter path := value assignment' }
  const module = modules[reference.tag]
  if (!module) return { error: `Module ${reference.tag} does not exist` }
  const parameter = reference.parameter
  const value = unquote(match[2])
  const tag = module.tag
  const analogBlock = module.type === 'AO' ? 'AO1' : module.type === 'PID' ? 'PID1' : ''
  if (analogBlock && parameter === `${analogBlock}/MODE.TARGET`) {
    const modes: ControlMode[] = module.type === 'AO' ? ['MAN', 'AUTO', 'CAS'] : ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN']
    const mode = modes.find(item => item === value.toUpperCase())
    return mode ? { value: { kind: 'mode', tag, mode } } : { error: 'Unsupported target mode for this module' }
  }
  if (analogBlock && [`${analogBlock}/SP.CV`, `${analogBlock}/OUT.CV`].includes(parameter)) {
    const numeric = numericLiteral(value)
    if (!Number.isFinite(numeric)) return { error: 'Assignment requires a finite numeric literal' }
    return { value: { kind: parameter.endsWith('/SP.CV') ? 'sp' : 'out', tag, value: numeric } }
  }
  if (value !== '0' && value !== '1') return { error: 'Discrete assignment requires 0 or 1' }
  const on = value === '1'
  if (module.type === 'MOTOR' && parameter === 'DC1/OUT_D.CV') return { value: { kind: 'motor', tag, run: on } }
  if (module.type === 'VALVE' && parameter === 'DC1/OUT_D.CV') return { value: { kind: 'valve', tag, open: on } }
  if (module.type === 'DO' && parameter === 'DO1/SP_D.CV') return { value: { kind: 'do', tag, on } }
  return { error: `Unsupported assignment path ${tag}/${parameter}; Named Sets, module parameters and block activation are not implemented` }
}

export function parseSfcCondition(text: string, modules: Record<string, AnyModule>): ExpressionResult<SfcCondition> {
  const trimmed = text.trim()
  if (/^TRUE$/i.test(trimmed)) return { value: { kind: 'always' } }
  const timer = trimmed.match(/^T_ACTIVE\s*>=\s*([+0-9.eE-]+)\s*s?$/i)
  if (timer) {
    const seconds = Number(timer[1])
    return Number.isFinite(seconds) && seconds >= 0 ? { value: { kind: 'timer', seconds } } :
      { error: 'Timer must be finite and nonnegative' }
  }
  const match = trimmed.match(/^(.+?)\s*(>=|<=|>|<|=)\s*(.+)$/)
  const reference = match ? path(match[1]) : null
  if (!match || !reference) return { error: 'Use TRUE, T_ACTIVE >= seconds, or a supported module-path comparison' }
  const module = modules[reference.tag]
  if (!module) return { error: `Module ${reference.tag} does not exist` }
  const parameter = reference.parameter
  const value = unquote(match[3])
  const tag = module.tag
  if (match[2] === '=' && ['0', '1'].includes(value) && parameter === 'DC1/PV_D.CV') {
    if (module.type === 'MOTOR') return { value: { kind: 'motorRunning', tag, running: value === '1' } }
    if (module.type === 'VALVE') return { value: { kind: 'valveOpen', tag, open: value === '1' } }
  }
  const numeric = numericLiteral(value)
  if (!Number.isFinite(numeric) || !['>', '<', '>=', '<='].includes(match[2])) return { error: 'Unsupported comparison or nonfinite value' }
  const op = match[2] as CompareOp
  if ((module.type === 'PID' || module.type === 'AI') && parameter === 'AI1/PV.CV' ||
    module.type === 'AO' && parameter === 'AO1/PV.CV') return { value: { kind: 'pv', tag, op, value: numeric } }
  if (module.type === 'PID' && parameter === 'PID1/OUT.CV' ||
    module.type === 'AO' && parameter === 'AO1/OUT.CV') return { value: { kind: 'out', tag, op, value: numeric } }
  return { error: `Unsupported condition path ${tag}/${parameter}; arbitrary expressions and Named Sets are not implemented` }
}

export function assignmentExpression(action: SfcAction, module?: AnyModule): string {
  const block = module?.type === 'AO' ? 'AO1' : 'PID1'
  if (action.kind === 'mode') return `'^/${action.tag}/${block}/MODE.TARGET' := ${action.mode}`
  if (action.kind === 'sp' || action.kind === 'out') return `'^/${action.tag}/${block}/${action.kind.toUpperCase()}.CV' := ${action.value}`
  if (action.kind === 'do') return `'^/${action.tag}/DO1/SP_D.CV' := ${Number(action.on)}`
  return `'^/${action.tag}/DC1/OUT_D.CV' := ${Number(action.kind === 'motor' ? action.run : action.open)}`
}

export function conditionExpression(condition: SfcCondition, module?: AnyModule): string {
  if (condition.kind === 'always') return 'TRUE'
  if (condition.kind === 'timer') return `T_ACTIVE >= ${condition.seconds}`
  if (condition.kind === 'motorRunning' || condition.kind === 'valveOpen') {
    return `'^/${condition.tag}/DC1/PV_D.CV' = ${Number(condition.kind === 'motorRunning' ? condition.running : condition.open)}`
  }
  const block = module?.type === 'AO' ? 'AO1' : condition.kind === 'pv' ? 'AI1' : 'PID1'
  return `'^/${condition.tag}/${block}/${condition.kind.toUpperCase()}.CV' ${condition.op} ${condition.value}`
}
