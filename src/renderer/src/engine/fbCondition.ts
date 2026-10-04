import type { AnyModule } from './types'

export interface ConditionReference { tag: string; block: 'AI1' | 'DI1'; parameter: 'PV' | 'PV_D' }
type Node =
  | { kind: 'number'; value: number }
  | { kind: 'input'; name: 'IN1' | 'IN2' }
  | { kind: 'reference'; ref: ConditionReference }
  | { kind: 'unary'; op: '+' | '-'; child: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }

class ConditionError extends Error {}

function parse(expression: string): Node {
  const tokens: string[] = []
  let remaining = expression.trim().toUpperCase()
  while (remaining) {
    const token = remaining.match(/^'\/\/[A-Z0-9_-]+\/(?:AI1\/PV|DI1\/PV_D)(?:\.CV)?'|^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|^IN[12]\b|^(?:>=|<=|==|!=|<>|[+\-*/()=<>])/)
    if (!token) throw new ConditionError(`Unsupported condition token: ${remaining.slice(0, 20)}`)
    tokens.push(token[0])
    remaining = remaining.slice(token[0].length).trimStart()
  }
  let position = 0
  const factor = (): Node => {
    const token = tokens[position++]
    if (token === '+' || token === '-') return { kind: 'unary', op: token, child: factor() }
    if (token === '(') {
      const node = comparison()
      if (tokens[position++] !== ')') throw new ConditionError('Condition is missing a closing parenthesis')
      return node
    }
    if (token === 'IN1' || token === 'IN2') return { kind: 'input', name: token }
    if (token?.startsWith("'//")) {
      const [tag, block, qualified] = token.slice(3, -1).split('/')
      const parameter = qualified.replace(/\.CV$/, '')
      if ((block === 'AI1' || block === 'DI1') && (parameter === 'PV' || parameter === 'PV_D')) {
        return { kind: 'reference', ref: { tag, block, parameter } }
      }
    }
    if (token && Number.isFinite(Number(token))) return { kind: 'number', value: Number(token) }
    throw new ConditionError(`Expected a number, IN1, IN2 or parenthesis; received ${token ?? 'end of expression'}`)
  }
  const term = (): Node => {
    let node = factor()
    while (tokens[position] === '*' || tokens[position] === '/') {
      const op = tokens[position++]
      node = { kind: 'binary', op, left: node, right: factor() }
    }
    return node
  }
  const arithmetic = (): Node => {
    let node = term()
    while (tokens[position] === '+' || tokens[position] === '-') {
      const op = tokens[position++]
      node = { kind: 'binary', op, left: node, right: term() }
    }
    return node
  }
  const comparison = (): Node => {
    const left = arithmetic()
    if (!['>', '<', '>=', '<=', '=', '==', '!=', '<>'].includes(tokens[position])) return left
    const op = tokens[position++]
    return { kind: 'binary', op, left, right: arithmetic() }
  }
  const result = comparison()
  if (position !== tokens.length) throw new ConditionError(`Unexpected condition token: ${tokens[position]}`)
  return result
}

function evaluate(node: Node, in1: number, in2: number,
  resolve?: (ref: ConditionReference) => { value: number; bad: boolean }): number {
  let result: number
  if (node.kind === 'number') result = node.value
  else if (node.kind === 'input') result = node.name === 'IN1' ? in1 : in2
  else if (node.kind === 'reference') {
    const signal = resolve?.(node.ref)
    if (!signal || signal.bad || !Number.isFinite(signal.value)) throw new ConditionError(`Condition source Bad or unavailable: ${node.ref.tag}/${node.ref.block}/${node.ref.parameter}`)
    result = signal.value
  }
  else if (node.kind === 'unary') {
    const value = evaluate(node.child, in1, in2, resolve)
    result = node.op === '-' ? -value : value
  } else {
    const a = evaluate(node.left, in1, in2, resolve)
    const b = evaluate(node.right, in1, in2, resolve)
    switch (node.op) {
      case '+': result = a + b; break
      case '-': result = a - b; break
      case '*': result = a * b; break
      case '/':
        if (b === 0) throw new ConditionError('Condition division by zero')
        result = a / b
        break
      case '>': result = Number(a > b); break
      case '<': result = Number(a < b); break
      case '>=': result = Number(a >= b); break
      case '<=': result = Number(a <= b); break
      case '=':
      case '==': result = Number(a === b); break
      case '!=':
      case '<>': result = Number(a !== b); break
      default: throw new ConditionError(`Unsupported condition operator: ${node.op}`)
    }
  }
  if (!Number.isFinite(result)) throw new ConditionError('Condition result is not finite')
  return result
}

export function conditionExpressionError(expression: string): string | null {
  try {
    parse(expression)
    return null
  } catch (error) {
    if (error instanceof ConditionError) return error.message
    throw error
  }
}

export function conditionReferences(expression: string): { references: ConditionReference[] } | { error: string } {
  try {
    const references: ConditionReference[] = []
    const visit = (n: Node): void => {
      if (n.kind === 'reference') references.push(n.ref)
      else if (n.kind === 'unary') visit(n.child)
      else if (n.kind === 'binary') { visit(n.left); visit(n.right) }
    }
    visit(parse(expression))
    return { references }
  } catch (error) {
    if (error instanceof ConditionError) return { error: error.message }
    throw error
  }
}
export function conditionSourceError(expression: string, modules: Record<string, AnyModule>): string | null {
  const result = conditionReferences(expression)
  if ('error' in result) return result.error
  for (const ref of result.references) {
    const m = modules[ref.tag]
    if (ref.block === 'DI1' ? m?.type !== 'DI' : m?.type !== 'AI' && m?.type !== 'PID') {
      return `Condition reference requires ${ref.block === 'DI1' ? 'DI' : 'AI/PID'} source ${ref.tag}`
    }
  }
  return null
}
export function evaluateConditionExpression(expression: string, in1: number, in2: number,
  resolve?: (ref: ConditionReference) => { value: number; bad: boolean }):
  { value: number } | { error: string } {
  try {
    return { value: evaluate(parse(expression), in1, in2, resolve) }
  } catch (error) {
    if (error instanceof ConditionError) return { error: error.message }
    throw error
  }
}
