import { pidIo } from './analogStrategy'
import { pidExecutionBad } from './pidModes'
import type { AnyModule } from './types'

export interface FlowColorTable {
  name: string
  flowColor: string
  noFlowColor: string
}

export interface FlowCondition {
  tag: string
  path: 'STATE' | 'PV' | 'PID1/OUT' | 'AO1/OUT'
  greaterThan: number
}

export interface FlowAnimation {
  table: string
  conditions: FlowCondition[]
}

export function flowTableError(table: FlowColorTable): string | null {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(table.name)) {
    return 'Table names require a lowercase letter followed by up to 31 lowercase letters, digits or underscores'
  }
  return [table.flowColor, table.noFlowColor].every(color => /^#[0-9a-f]{6}$/i.test(color))
    ? null : 'Flow and no-flow colors require six-digit hex values'
}

export function flowConditionSignal(condition: FlowCondition, modules: Record<string, AnyModule>):
  { value: number; bad: boolean } | { error: string } {
  const module = modules[condition.tag]
  if (!module) return { error: `Flow source module ${condition.tag || '(unassigned)'} does not exist` }
  if (!Number.isFinite(condition.greaterThan)) return { error: 'Flow threshold must be finite' }
  if (condition.path === 'STATE') {
    if (module.type === 'MOTOR') return { value: Number(module.running), bad: !!module.ioInputBad }
    if (module.type === 'VALVE') return { value: Number(module.open), bad: !!module.ioInputBad }
    if (module.type === 'DI' || module.type === 'DO') return { value: Number(module.state), bad: !!module.ioBad }
  }
  if (module.type === 'PID' && condition.path === 'AO1/OUT') {
    const output = pidIo(module).ao
    return { value: output.out, bad: output.bad }
  }
  if (module.type === 'PID' && condition.path === 'PID1/OUT') {
    return { value: module.out, bad: pidExecutionBad(module) }
  }
  if (condition.path === 'PV' && (module.type === 'PID' || module.type === 'AI' || module.type === 'AO')) {
    return { value: module.pv, bad: module.type === 'AO' ? module.bad : module.pvBad }
  }
  return { error: `Unsupported flow source ${condition.tag}/${condition.path}` }
}

export function flowAnimationError(animation: FlowAnimation, modules: Record<string, AnyModule>): string | null {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(animation.table)) return 'Select a valid shared flow color table'
  if (!animation.conditions.length || animation.conditions.length > 8) return 'Flow animation requires 1-8 AND conditions'
  for (const condition of animation.conditions) {
    const signal = flowConditionSignal(condition, modules)
    if ('error' in signal) return signal.error
    if (!Number.isFinite(signal.value)) return `Flow source ${condition.tag}/${condition.path} is not finite`
  }
  return null
}

export function pictureFlowColor(animation: FlowAnimation, tables: Record<string, FlowColorTable>,
  modules: Record<string, AnyModule>): { color: string; flowing: boolean; bad: boolean } | { error: string } {
  const error = flowAnimationError(animation, modules)
  if (error) return { error }
  if (!Object.hasOwn(tables, animation.table)) {
    return { error: `Shared flow color table ${animation.table} does not exist; load or create it` }
  }
  const table = tables[animation.table]
  const tableError = flowTableError(table)
  if (tableError) return { error: tableError }
  let flowing = true
  let bad = false
  for (const condition of animation.conditions) {
    const signal = flowConditionSignal(condition, modules)
    if ('error' in signal) return signal
    bad ||= signal.bad
    flowing &&= signal.value > condition.greaterThan
  }
  // Unknown feedback must not masquerade as confirmed flow or no-flow.
  return { color: bad ? '#aebdc9' : flowing ? table.flowColor : table.noFlowColor, flowing: !bad && flowing, bad }
}

export function parseFlowTables(text: string): Record<string, FlowColorTable> {
  const data: unknown = JSON.parse(text)
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 ||
      !('tables' in data) || !Array.isArray(data.tables)) throw new Error('Invalid saved flow table schema or version')
  const tables: Record<string, FlowColorTable> = {}
  for (const value of data.tables) {
    if (!value || typeof value !== 'object' || typeof value.name !== 'string' ||
        typeof value.flowColor !== 'string' || typeof value.noFlowColor !== 'string') {
      throw new Error('Invalid saved flow table')
    }
    const table: FlowColorTable = { name: value.name, flowColor: value.flowColor, noFlowColor: value.noFlowColor }
    const error = flowTableError(table)
    if (error) throw new Error(error)
    if (Object.hasOwn(tables, table.name)) throw new Error(`Duplicate saved flow table ${table.name}`)
    tables[table.name] = table
  }
  return tables
}
