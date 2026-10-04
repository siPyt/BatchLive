type Node =
  | { kind: 'number'; value: number }
  | { kind: 'input'; name: 'IN1' | 'IN2' }
  | { kind: 'unary'; op: '+' | '-'; child: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }

class ConditionError extends Error {}

function parse(expression: string): Node {
  const tokens: string[] = []
  let remaining = expression.trim().toUpperCase()
  while (remaining) {
    const token = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|^IN[12]\b|^(?:>=|<=|==|!=|<>|[+\-*/()=<>])/)
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

function evaluate(node: Node, in1: number, in2: number): number {
  let result: number
  if (node.kind === 'number') result = node.value
  else if (node.kind === 'input') result = node.name === 'IN1' ? in1 : in2
  else if (node.kind === 'unary') {
    const value = evaluate(node.child, in1, in2)
    result = node.op === '-' ? -value : value
  } else {
    const a = evaluate(node.left, in1, in2)
    const b = evaluate(node.right, in1, in2)
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

export function evaluateConditionExpression(expression: string, in1: number, in2: number):
  { value: number } | { error: string } {
  try {
    return { value: evaluate(parse(expression), in1, in2) }
  } catch (error) {
    if (error instanceof ConditionError) return { error: error.message }
    throw error
  }
}
