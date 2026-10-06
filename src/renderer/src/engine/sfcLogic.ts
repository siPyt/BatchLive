import type { AnyModule, PlantState } from './types'
import { parsePidActualMode, parsePidTargetMode, pidExecutionBad } from './pidModes'
import { readAnalogSignal } from './analogStrategy'
import { namedParameterReferenceError, type SfcExpressionContext } from './sfcParameters'

// ---------------------------------------------------------------------------
// SFC expression language (DV09-064/067). Used by transitions, selective routes, action delay conditions and
// numeric SP/OUT assignments. It is parsed to a tree and evaluated by this engine; no JavaScript is evaluated.
//
//   or      := and ( (OR | XOR) and )*
//   and     := not ( AND not )*
//   not     := NOT not | compare
//   compare := sum ( (= | <> | != | > | < | >= | <=) sum )?
//   sum     := product ( (+ | -) product )*
//   product := unary ( (* | /) unary )*
//   unary   := - unary | primary
//   primary := number | TRUE | FALSE | T_ACTIVE | 'reference' | MODE_NAME | FUNC( args ) | ( or )
//
// References are quoted: '^/TAG/BLOCK/PARAM.CV' module paths or 'LOCAL' SFC parameters. Functions: ABS SQRT ROUND
// MIN MAX IF(condition, a, b). Logic is three-valued: a Bad/OOS source makes a comparison unknown, and an unknown
// result never satisfies a transition (AND/OR still resolve when the other operand decides the answer).
// ---------------------------------------------------------------------------

export const LOGIC_MAX_LENGTH = 500
const MAX_DEPTH = 40
const EPSILON = Number.EPSILON * 64

export type LogicNode =
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'timer' }
  | { t: 'id'; v: string }
  | { t: 'str'; v: string }
  | { t: 'neg'; a: LogicNode }
  | { t: 'not'; a: LogicNode }
  | { t: 'bin'; op: BinaryOp; a: LogicNode; b: LogicNode }
  | { t: 'call'; name: string; args: LogicNode[] }

type BinaryOp = '+' | '-' | '*' | '/' | 'AND' | 'OR' | 'XOR' | '=' | '<>' | '>' | '<' | '>=' | '<='
type Token = { k: 'num' | 'str' | 'word' | 'op' | 'end'; v: string; n?: number }

class LogicError extends Error {}

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  ABS: { min: 1, max: 1 }, SQRT: { min: 1, max: 1 }, ROUND: { min: 1, max: 2 },
  MIN: { min: 2, max: 8 }, MAX: { min: 2, max: 8 }, IF: { min: 3, max: 3 }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let rest = text
  const take = (length: number): string => { const out = rest.slice(0, length); rest = rest.slice(length); return out }
  while (rest.length) {
    if (/^\s/.test(rest)) { take(1); continue }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (number) { take(number[0].length); tokens.push({ k: 'num', v: number[0], n: Number(number[0]) }); continue }
    if (rest[0] === "'" || rest[0] === '"') {
      const close = rest.indexOf(rest[0], 1)
      if (close < 0) throw new LogicError('Quoted reference is missing its closing quote')
      tokens.push({ k: 'str', v: rest.slice(1, close) })
      take(close + 1)
      continue
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (word) { take(word[0].length); tokens.push({ k: 'word', v: word[0].toUpperCase() }); continue }
    const op = rest.match(/^(>=|<=|<>|!=|[><=+\-*/(),])/)
    if (op) { take(op[0].length); tokens.push({ k: 'op', v: op[0] === '!=' ? '<>' : op[0] }); continue }
    throw new LogicError(`Unexpected character '${rest[0]}' in expression`)
  }
  tokens.push({ k: 'end', v: '' })
  return tokens
}

function parse(text: string): LogicNode {
  const tokens = tokenize(text)
  let position = 0
  const peek = (): Token => tokens[position]
  const isOp = (v: string): boolean => peek().k === 'op' && peek().v === v
  const isWord = (v: string): boolean => peek().k === 'word' && peek().v === v
  const expectOp = (v: string): void => {
    if (!isOp(v)) throw new LogicError(`Expected '${v}' in expression`)
    position++
  }
  const guard = (depth: number): void => { if (depth > MAX_DEPTH) throw new LogicError('Expression is nested too deeply') }

  const or = (depth: number): LogicNode => {
    guard(depth)
    let left = and(depth + 1)
    while (isWord('OR') || isWord('XOR')) {
      const op = tokens[position++].v as 'OR' | 'XOR'
      left = { t: 'bin', op, a: left, b: and(depth + 1) }
    }
    return left
  }
  const and = (depth: number): LogicNode => {
    let left = not(depth + 1)
    while (isWord('AND')) { position++; left = { t: 'bin', op: 'AND', a: left, b: not(depth + 1) } }
    return left
  }
  const not = (depth: number): LogicNode => {
    guard(depth)
    if (isWord('NOT')) { position++; return { t: 'not', a: not(depth + 1) } }
    return compare(depth + 1)
  }
  const compare = (depth: number): LogicNode => {
    const left = sum(depth + 1)
    if (peek().k === 'op' && ['=', '<>', '>', '<', '>=', '<='].includes(peek().v)) {
      const op = tokens[position++].v as BinaryOp
      const node: LogicNode = { t: 'bin', op, a: left, b: sum(depth + 1) }
      if (peek().k === 'op' && ['=', '<>', '>', '<', '>=', '<='].includes(peek().v)) {
        throw new LogicError('Comparisons cannot be chained; combine them with AND/OR')
      }
      return node
    }
    return left
  }
  const sum = (depth: number): LogicNode => {
    let left = product(depth + 1)
    while (isOp('+') || isOp('-')) {
      const op = tokens[position++].v as '+' | '-'
      left = { t: 'bin', op, a: left, b: product(depth + 1) }
    }
    return left
  }
  const product = (depth: number): LogicNode => {
    let left = unary(depth + 1)
    while (isOp('*') || isOp('/')) {
      const op = tokens[position++].v as '*' | '/'
      left = { t: 'bin', op, a: left, b: unary(depth + 1) }
    }
    return left
  }
  const unary = (depth: number): LogicNode => {
    guard(depth)
    if (isOp('-')) { position++; return { t: 'neg', a: unary(depth + 1) } }
    return primary(depth + 1)
  }
  const primary = (depth: number): LogicNode => {
    guard(depth)
    const token = tokens[position]
    if (token.k === 'num') { position++; return { t: 'num', v: token.n as number } }
    if (token.k === 'str') { position++; return { t: 'str', v: token.v } }
    if (isOp('(')) {
      position++
      const inner = or(depth + 1)
      expectOp(')')
      return inner
    }
    if (token.k === 'word') {
      position++
      if (token.v === 'TRUE' || token.v === 'FALSE') return { t: 'bool', v: token.v === 'TRUE' }
      if (token.v === 'T_ACTIVE') return { t: 'timer' }
      if (isOp('(')) {
        const spec = FUNCTIONS[token.v]
        if (!spec) throw new LogicError(`Unknown function ${token.v}; use ABS, SQRT, ROUND, MIN, MAX or IF`)
        position++
        const args: LogicNode[] = []
        if (!isOp(')')) {
          do { args.push(or(depth + 1)) } while (isOp(',') && ++position)
        }
        expectOp(')')
        if (args.length < spec.min || args.length > spec.max) {
          throw new LogicError(`${token.v} takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} argument(s)`)
        }
        return { t: 'call', name: token.v, args }
      }
      if (['AND', 'OR', 'XOR', 'NOT'].includes(token.v)) throw new LogicError(`Unexpected ${token.v} in expression`)
      return { t: 'id', v: token.v }
    }
    throw new LogicError(token.k === 'end' ? 'Expression ended unexpectedly' : `Unexpected '${token.v}' in expression`)
  }

  const node = or(0)
  if (peek().k !== 'end') throw new LogicError(`Unexpected '${peek().v}' in expression`)
  return node
}

const syntaxCache = new Map<string, LogicNode | LogicError>()
function parseCached(text: string): LogicNode {
  if (text.length > LOGIC_MAX_LENGTH) throw new LogicError(`Expression is limited to ${LOGIC_MAX_LENGTH} characters`)
  let cached = syntaxCache.get(text)
  if (!cached) {
    try { cached = parse(text) } catch (error) {
      if (!(error instanceof LogicError)) throw error
      cached = error
    }
    if (syntaxCache.size > 400) syntaxCache.clear()
    syntaxCache.set(text, cached)
  }
  if (cached instanceof LogicError) throw cached
  return cached
}

// --- typing and evaluation -------------------------------------------------

type Value = number | boolean | string | null
interface Env { state: PlantState; elapsed: number; context?: SfcExpressionContext }
type Kind = 'number' | 'boolean' | 'mode' | 'named' | 'text'
interface Compiled {
  kind: Kind
  eval: (env: Env) => Value
  modeSet?: 'actual' | 'target'
  moduleType?: AnyModule['type']
  parameter?: string
  literal?: string | number
}

/** Module paths accept the course's '//TAG/BLOCK/PARAM' absolute form as well as '^/TAG/...' and '/TAG/...'. */
const PATH = /^(?:\^\/|\/\/|\/)?([A-Za-z0-9_$-]+)\/([A-Za-z0-9_/.]+)$/
const LOCAL = /^([A-Za-z0-9_$-]+?)(?:\.CV)?$/i
const STEP_PARAMETERS: Record<string, Kind> = {
  ACTIVE: 'boolean', CONFIRM_FAIL: 'boolean', DISABLED: 'boolean',
  FAILED_CONFIRMS: 'number', PENDING_CONFIRMS: 'number', TIME: 'number'
}
const STEP_PATH = /^(?:\^\/|\/\/|\/)?([A-Za-z0-9_$ -]+)\/(ACTIVE|CONFIRM_FAIL|DISABLED|FAILED_CONFIRMS|PENDING_CONFIRMS|TIME)(?:\.CV)?$/i
const stepKey = (text: string): string => text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')

/** A step parameter by step name ('CLOSE_BLK/PENDING_CONFIRMS.CV'), or the transition's own step when the name is omitted. */
function stepReference(stepName: string | undefined, parameter: string, context?: SfcExpressionContext): Compiled | null {
  const name = parameter.toUpperCase().replace(/\.CV$/, '')
  const kind = STEP_PARAMETERS[name]
  if (!kind || !context?.steps) return null
  const target = stepName === undefined ? context.steps.find(step => step.id === context.stepId) :
    context.steps.find(step => stepKey(step.name) === stepKey(stepName))
  if (!target) return null
  const id = target.id
  return { kind, parameter: name, eval: (env) => {
    const view = env.context?.steps?.find(step => step.id === id)
    if (!view) return null
    switch (name) {
      case 'ACTIVE': return view.active
      case 'CONFIRM_FAIL': return view.failedConfirms > 0
      case 'DISABLED': return false
      case 'FAILED_CONFIRMS': return view.failedConfirms
      case 'PENDING_CONFIRMS': return view.pendingConfirms
      default: return view.time
    }
  } }
}

const eq = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b))

function finite(value: number, bad: boolean): Value {
  return bad || !Number.isFinite(value) ? null : value
}

/** Which module/parameter pairs the language can read, and what they are. */
function pathKind(module: AnyModule, parameter: string): Pick<Compiled, 'kind' | 'modeSet'> | null {
  switch (module.type) {
    case 'PID':
      if (parameter === 'AI1/PV.CV' || parameter === 'PID1/PV.CV' || parameter === 'PID1/SP.CV' || parameter === 'PID1/OUT.CV') return { kind: 'number' }
      if (parameter === 'PID1/MODE.ACTUAL') return { kind: 'mode', modeSet: 'actual' }
      if (parameter === 'PID1/MODE.TARGET') return { kind: 'mode', modeSet: 'target' }
      return null
    case 'AI':
      return parameter === 'AI1/PV.CV' ? { kind: 'number' } : null
    case 'AO':
      if (parameter === 'AO1/PV.CV' || parameter === 'AO1/SP.CV' || parameter === 'AO1/OUT.CV') return { kind: 'number' }
      if (parameter === 'AO1/MODE.ACTUAL') return { kind: 'mode', modeSet: 'actual' }
      if (parameter === 'AO1/MODE.TARGET') return { kind: 'mode', modeSet: 'target' }
      return null
    case 'MOTOR':
    case 'VALVE':
      return parameter === 'DC1/PV_D.CV' || parameter === 'DC1/OUT_D.CV' ? { kind: 'boolean' } : null
    case 'DI':
      return parameter === 'DI1/PV_D.CV' ? { kind: 'boolean' } : null
    case 'DO':
      return parameter === 'DO1/SP_D.CV' ? { kind: 'boolean' } : null
    default:
      return null
  }
}

function readPath(state: PlantState, tag: string, parameter: string): Value {
  const module = state.modules[tag] as AnyModule | undefined
  if (!module) return null
  switch (module.type) {
    case 'PID':
      if (parameter === 'AI1/PV.CV' || parameter === 'PID1/PV.CV') return finite(module.pv, module.pvBad || pidExecutionBad(module))
      if (parameter === 'PID1/SP.CV') return finite(module.sp, false)
      if (parameter === 'PID1/OUT.CV') { const out = readAnalogSignal({ tag, parameter: 'OUT' }, state.modules); return finite(out.value, out.bad) }
      return parameter === 'PID1/MODE.ACTUAL' ? module.actualMode : module.mode
    case 'AI':
      return finite(module.pv, module.pvBad)
    case 'AO':
      if (parameter === 'AO1/PV.CV') return finite(module.pv, module.bad || module.actualMode === 'OOS')
      if (parameter === 'AO1/SP.CV') return finite(module.sp, false)
      if (parameter === 'AO1/OUT.CV') { const out = readAnalogSignal({ tag, parameter: 'OUT' }, state.modules); return finite(out.value, out.bad) }
      return parameter === 'AO1/MODE.ACTUAL' ? module.actualMode : module.mode
    case 'MOTOR':
      return parameter === 'DC1/OUT_D.CV' ? module.commanded : module.ioInputBad || module.ioOutputBad ? null : module.running
    case 'VALVE':
      return parameter === 'DC1/OUT_D.CV' ? module.commandedOpen : module.ioInputBad || module.ioOutputBad ? null : module.open
    case 'DI':
      return module.ioBad || module.mode === 'OOS' ? null : module.state
    case 'DO':
      return module.commanded
    default:
      return null
  }
}

function reference(text: string, modules: Record<string, AnyModule>, context?: SfcExpressionContext): Compiled {
  const stepPath = text.trim().match(STEP_PATH)
  if (stepPath && !modules[stepPath[1].trim().toUpperCase()]) {
    const found = stepReference(stepPath[1], stepPath[2], context)
    if (found) return found
    throw new LogicError(`Step ${stepPath[1].trim()} does not exist in this SFC`)
  }
  const path = text.trim().match(PATH)
  if (path) {
    const tag = path[1].toUpperCase()
    const parameter = path[2].toUpperCase()
    const module = modules[tag]
    if (!module) throw new LogicError(`Module ${tag} does not exist`)
    const kind = pathKind(module, parameter)
    if (!kind) throw new LogicError(`Unsupported path ${tag}/${parameter} in an expression; use PV, SP, OUT, MODE, DC1/PV_D, DI1/PV_D or DO1/SP_D`)
    return { ...kind, moduleType: module.type, parameter, eval: ({ state }) => readPath(state, tag, parameter) }
  }
  const local = text.trim().match(LOCAL)
  const name = local?.[1].toUpperCase()
  if (name && context && Object.hasOwn(context.parameters, name)) {
    return context.parameters[name].type === 'BOOLEAN' ?
      { kind: 'boolean', parameter: name, eval: (env) => {
        const live = env.context?.parameters[name]
        return live?.type === 'BOOLEAN' ? live.value : null
      } } :
      { kind: 'named', parameter: name, eval: () => null }
  }
  if (name) {
    const own = stepReference(undefined, name, context)
    if (own) return own
  }
  return { kind: 'text', literal: text.trim(), eval: () => text.trim() }
}

function modeLiteral(value: string | number, compiled: Compiled, tag: AnyModule['type'] | undefined): string {
  const parsed = compiled.modeSet === 'target' ? parsePidTargetMode(String(value)) : parsePidActualMode(String(value))
  if (!parsed || tag === 'AO' && !['MAN', 'AUTO', 'CAS', 'OOS'].includes(parsed)) {
    throw new LogicError(`Unsupported ${compiled.modeSet ?? 'actual'} mode '${value}' for this module`)
  }
  return parsed
}

const isLiteral = (c: Compiled): boolean => c.literal !== undefined

function compile(node: LogicNode, modules: Record<string, AnyModule>, context: SfcExpressionContext | undefined): Compiled {
  const go = (child: LogicNode): Compiled => compile(child, modules, context)
  const need = (compiled: Compiled, kind: Kind, what: string): Compiled => {
    if (compiled.kind !== kind) throw new LogicError(`${what} requires a ${kind} value`)
    return compiled
  }
  switch (node.t) {
    case 'num':
      return { kind: 'number', literal: node.v, eval: () => node.v }
    case 'bool':
      return { kind: 'boolean', eval: () => node.v }
    case 'timer':
      return { kind: 'number', eval: ({ elapsed }) => elapsed }
    case 'id':
      return { kind: 'text', literal: node.v, eval: () => node.v }
    case 'str':
      return reference(node.v, modules, context)
    case 'neg': {
      const a = need(go(node.a), 'number', 'Negation')
      return { kind: 'number', eval: (env) => { const v = a.eval(env); return typeof v === 'number' ? -v : null } }
    }
    case 'not': {
      const a = need(go(node.a), 'boolean', 'NOT')
      return { kind: 'boolean', eval: (env) => { const v = a.eval(env); return typeof v === 'boolean' ? !v : null } }
    }
    case 'call':
      return compileCall(node.name, node.args.map(go))
    case 'bin':
      return compileBinary(node.op, go(node.a), go(node.b), context, modules)
  }
}

function compileCall(name: string, args: Compiled[]): Compiled {
  const numbers = (list: Compiled[]): void => {
    if (list.some(arg => arg.kind !== 'number')) throw new LogicError(`${name} requires numeric arguments`)
  }
  const values = (env: Env, list: Compiled[]): number[] | null => {
    const out: number[] = []
    for (const arg of list) { const v = arg.eval(env); if (typeof v !== 'number') return null; out.push(v) }
    return out
  }
  const result = (value: number): Value => Number.isFinite(value) ? value : null
  switch (name) {
    case 'ABS':
      numbers(args)
      return { kind: 'number', eval: (env) => { const v = values(env, args); return v ? result(Math.abs(v[0])) : null } }
    case 'SQRT':
      numbers(args)
      return { kind: 'number', eval: (env) => { const v = values(env, args); return v && v[0] >= 0 ? result(Math.sqrt(v[0])) : null } }
    case 'ROUND':
      numbers(args)
      return { kind: 'number', eval: (env) => {
        const v = values(env, args)
        if (!v) return null
        const places = Math.max(0, Math.min(6, Math.trunc(v[1] ?? 0)))
        const scale = 10 ** places
        return result(Math.round(v[0] * scale) / scale)
      } }
    case 'MIN':
      numbers(args)
      return { kind: 'number', eval: (env) => { const v = values(env, args); return v ? result(Math.min(...v)) : null } }
    case 'MAX':
      numbers(args)
      return { kind: 'number', eval: (env) => { const v = values(env, args); return v ? result(Math.max(...v)) : null } }
    default: {
      if (args[0].kind !== 'boolean') throw new LogicError('IF requires a true/false condition as its first argument')
      numbers(args.slice(1))
      return { kind: 'number', eval: (env) => {
        const condition = args[0].eval(env)
        if (typeof condition !== 'boolean') return null
        const picked = args[condition ? 1 : 2].eval(env)
        return typeof picked === 'number' ? picked : null
      } }
    }
  }
}

function compileBinary(op: BinaryOp, a: Compiled, b: Compiled, context: SfcExpressionContext | undefined,
  modules: Record<string, AnyModule>): Compiled {
  if (op === '+' || op === '-' || op === '*' || op === '/') {
    if (a.kind !== 'number' || b.kind !== 'number') throw new LogicError(`'${op}' requires numeric operands`)
    return { kind: 'number', eval: (env) => {
      const x = a.eval(env)
      const y = b.eval(env)
      if (typeof x !== 'number' || typeof y !== 'number') return null
      const value = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : y === 0 ? NaN : x / y
      return Number.isFinite(value) ? value : null
    } }
  }
  if (op === 'AND' || op === 'OR' || op === 'XOR') {
    if (a.kind !== 'boolean' || b.kind !== 'boolean') throw new LogicError(`${op} requires true/false operands`)
    return { kind: 'boolean', eval: (env) => {
      const x = a.eval(env)
      const y = b.eval(env)
      const known = (v: Value): v is boolean => typeof v === 'boolean'
      if (op === 'AND') return x === false || y === false ? false : known(x) && known(y) ? true : null
      if (op === 'OR') return x === true || y === true ? true : known(x) && known(y) ? false : null
      return known(x) && known(y) ? x !== y : null
    } }
  }
  return compileComparison(op, a, b, context, modules)
}

function compileComparison(op: BinaryOp, a: Compiled, b: Compiled, context: SfcExpressionContext | undefined,
  modules: Record<string, AnyModule>): Compiled {
  const equality = op === '=' || op === '<>'
  const negate = op === '<>'
  const result = (value: boolean | null): Value => value === null ? null : negate ? !value : value
  if (a.kind === 'number' && b.kind === 'number') {
    return { kind: 'boolean', eval: (env) => {
      const x = a.eval(env)
      const y = b.eval(env)
      if (typeof x !== 'number' || typeof y !== 'number') return null
      switch (op) {
        case '=': return eq(x, y)
        case '<>': return !eq(x, y)
        case '>': return x > y && !eq(x, y)
        case '<': return x < y && !eq(x, y)
        case '>=': return x > y || eq(x, y)
        default: return x < y || eq(x, y)
      }
    } }
  }
  if (!equality) throw new LogicError(`'${op}' compares numbers only; use = or <> for true/false, mode and Named Set values`)
  // Discrete values compare with TRUE/FALSE or the literals 0/1, as DeltaV discrete parameters do.
  const asBoolean = (c: Compiled): Compiled | null => c.kind === 'boolean' ? c :
    c.kind === 'number' && (c.literal === 0 || c.literal === 1) ? { ...c, kind: 'boolean', eval: () => c.literal === 1 } : null
  if (a.kind === 'boolean' || b.kind === 'boolean') {
    const x = asBoolean(a)
    const y = asBoolean(b)
    if (!x || !y) throw new LogicError('A true/false value can only be compared with TRUE, FALSE, 0 or 1')
    return { kind: 'boolean', eval: (env) => {
      const l = x.eval(env)
      const r = y.eval(env)
      return typeof l === 'boolean' && typeof r === 'boolean' ? result(l === r) : null
    } }
  }
  if (a.kind === 'mode' || b.kind === 'mode') {
    const mode = a.kind === 'mode' ? a : b
    const other = a.kind === 'mode' ? b : a
    let literal: string | undefined
    if (other.kind !== 'mode') {
      if (!isLiteral(other) || other.kind !== 'text' && other.kind !== 'number') throw new LogicError('A mode can only be compared with another mode or a mode name such as AUTO')
      literal = modeLiteral(other.literal as string | number, mode, mode.moduleType)
    }
    return { kind: 'boolean', eval: (env) => {
      const l = mode.eval(env)
      const r = literal ?? other.eval(env)
      return typeof l === 'string' && typeof r === 'string' ? result(l === r) : null
    } }
  }
  if (a.kind === 'named' || b.kind === 'named') {
    const named = a.kind === 'named' ? a : b
    const other = a.kind === 'named' ? b : a
    const parameter = named.parameter as string
    const read = (env: Env, p: string): number | null => {
      const binding = env.context?.parameters[p]
      return binding?.type === 'NAMED_SET' ? binding.value : null
    }
    if (other.kind === 'named') {
      const left = context?.parameters[parameter]
      const right = context?.parameters[other.parameter as string]
      if (left?.type !== 'NAMED_SET' || right?.type !== 'NAMED_SET' || left.namedSet !== right.namedSet) {
        throw new LogicError('Named Set parameters can only be compared when they use the same Named Set')
      }
      return { kind: 'boolean', eval: (env) => { const l = read(env, parameter); const r = read(env, other.parameter as string); return l === null || r === null ? null : result(l === r) } }
    }
    const text = other.kind === 'text' ? String(other.literal ?? '') : ''
    const split = text.match(/^([^:]+):(.+)$/)
    if (!split) throw new LogicError(`Compare a Named Set parameter with 'SET:ENTRY', for example '${parameter}' = 'SETNAME:ENTRY'`)
    const problem = namedParameterReferenceError(parameter, split[1], split[2], context)
    if (problem) throw new LogicError(problem)
    const entry = context?.sets[split[1]].entries.find(item => item.name === split[2])
    return { kind: 'boolean', eval: (env) => { const l = read(env, parameter); return l === null || !entry ? null : result(l === entry.value) } }
  }
  throw new LogicError('Operands cannot be compared; use numbers, TRUE/FALSE, modes or Named Set entries')
}

function build(text: string, modules: Record<string, AnyModule>, context: SfcExpressionContext | undefined, want: 'boolean' | 'number'): Compiled {
  const compiled = compile(parseCached(text), modules, context)
  if (compiled.kind !== want) {
    throw new LogicError(want === 'boolean' ?
      'A transition expression must produce true or false; add a comparison such as > or =' :
      'An SP/OUT assignment must produce a number')
  }
  return compiled
}

/** Validation error for an expression (syntax, references, types), or null when it can run. */
export function logicError(text: string, modules: Record<string, AnyModule>, context: SfcExpressionContext | undefined,
  want: 'boolean' | 'number'): string | null {
  try { build(text, modules, context, want); return null } catch (error) {
    if (error instanceof LogicError) return error.message
    throw error
  }
}

/** Evaluate a transition expression; an unknown (Bad/OOS) result is false. */
export function evalLogicBoolean(text: string, state: PlantState, elapsed: number, context?: SfcExpressionContext): boolean {
  try {
    const compiled = build(text, state.modules, context, 'boolean')
    return compiled.eval({ state, elapsed, context }) === true
  } catch (error) {
    if (error instanceof LogicError) return false
    throw error
  }
}

/** Evaluate a numeric expression; null when the result is unknown. */
export function evalLogicNumber(text: string, state: PlantState, elapsed: number, context?: SfcExpressionContext): number | null {
  try {
    const compiled = build(text, state.modules, context, 'number')
    const value = compiled.eval({ state, elapsed, context })
    return typeof value === 'number' ? value : null
  } catch (error) {
    if (error instanceof LogicError) return null
    throw error
  }
}

/** True when text uses expression-only syntax, so a specific expression error is more useful than a simple-form error. */
export function looksLikeLogic(text: string): boolean {
  return /\b(AND|OR|XOR|NOT|IF|ABS|SQRT|ROUND|MIN|MAX)\b|[()+*/,]|<>|!=/i.test(text.replace(/'[^']*'|"[^"]*"/g, "''"))
}
