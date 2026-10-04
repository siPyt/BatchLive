import type { AnyModule, FbInputRef, FunctionBlockModule, MotorModule } from './types'
import { makeFunctionBlock } from './plant'
import { conditionSourceError } from './fbCondition'
import { signalError } from './analogStrategy'

export interface MotorBlockConfiguration {
  fbType: 'CND' | 'BFI' | 'OR' | 'NOT' | 'AND'
  description: string
  in1: FbInputRef
  in2: FbInputRef
  expr: string
  delaySec: number
  armTrap: boolean
}
export type MotorStrategyConfiguration = Record<string, MotorBlockConfiguration>
export function cloneMotorStrategy(c: MotorStrategyConfiguration): MotorStrategyConfiguration {
  return Object.fromEntries(Object.entries(c).map(([name, b]) => [name, { ...b, in1: { ...b.in1 }, in2: { ...b.in2 } }]))
}
export function motorTemplateStrategy(tag: string): MotorStrategyConfiguration {
  const constant = (value: number): FbInputRef => ({ kind: 'const', value })
  const ref = (name: string, parameter?: FbInputRef['parameter']): FbInputRef =>
    ({ kind: 'ref', tag: `${tag}/${name}`, value: 0, parameter })
  const block = (fbType: MotorBlockConfiguration['fbType'], description: string,
    in1: FbInputRef, in2 = constant(0), expr = 'IN1 != 0', delaySec = 0): MotorBlockConfiguration =>
    ({ fbType, description, in1, in2, expr, delaySec, armTrap: fbType === 'BFI' })
  return {
    CND1: block('CND', 'XVSTAT-101 is closed', constant(0), constant(0), 'IN1 = 0'),
    CND2: block('CND', 'Tank101 level is <50', constant(0), constant(0), 'IN1 < 50', 4),
    BFI1: block('BFI', 'First-out interlock causes', ref('CND1'), ref('CND2')),
    OR1: block('OR', 'BYPASSED condition indication', ref('CND1', 'BYPASS'), ref('CND2', 'BYPASS')),
    NOT1: block('NOT', 'Healthy interlock confirmation', ref('BFI1', 'OUT_D')),
    AND1: block('AND', 'Start permissive conditions', constant(1), constant(1))
  }
}
export function materializeMotorStrategy(tag: string, area: string, c: MotorStrategyConfiguration): Record<string, FunctionBlockModule> {
  return Object.fromEntries(Object.entries(c).map(([name, b]) => [name,
    makeFunctionBlock({ ...b, in1: { ...b.in1 }, in2: { ...b.in2 }, tag: `${tag}/${name}`, area, bad: true })]))
}
export function captureMotorStrategy(m: MotorModule): MotorStrategyConfiguration | undefined {
  if (!m.ownedBlocks) return undefined
  return Object.fromEntries(Object.entries(m.ownedBlocks).map(([name, b]) => {
    if (b.fbType !== 'CND' && b.fbType !== 'BFI' && b.fbType !== 'OR' && b.fbType !== 'NOT' && b.fbType !== 'AND') throw new Error('Unsupported owned motor block')
    return [name, { fbType: b.fbType, description: b.description, in1: { ...b.in1 }, in2: { ...b.in2 },
      expr: b.expr, delaySec: b.delaySec, armTrap: b.armTrap ?? false }]
  }))
}
export function strategyModules(modules: Record<string, AnyModule>): Record<string, AnyModule> {
  const owned = Object.values(modules).flatMap(m => m.type === 'MOTOR' && m.ownedBlocks ? Object.values(m.ownedBlocks) : [])
  return owned.length ? { ...modules, ...Object.fromEntries(owned.map(b => [b.tag, b])) } : modules
}
export function ownedMotorBlock(modules: Record<string, AnyModule>, tag: string): { owner: MotorModule; name: string; block: FunctionBlockModule } | undefined {
  const [ownerTag, name, extra] = tag.split('/')
  const owner = modules[ownerTag]
  const block = owner?.type === 'MOTOR' ? owner.ownedBlocks?.[name] : undefined
  return block && !extra && owner.type === 'MOTOR' ? { owner, name, block } : undefined
}
export function motorStrategyError(tag: string, area: string, c: MotorStrategyConfiguration, modules: Record<string, AnyModule>): string | null {
  if (Object.keys(c).sort().join(',') !== 'AND1,BFI1,CND1,CND2,NOT1,OR1' ||
    c.CND1.fbType !== 'CND' || c.CND2.fbType !== 'CND' || c.BFI1.fbType !== 'BFI' || c.OR1.fbType !== 'OR' ||
    c.NOT1.fbType !== 'NOT' || c.AND1.fbType !== 'AND') {
    return 'The two-condition motor strategy requires CND1, CND2, BFI1, OR1, NOT1 and AND1'
  }
  const view = { ...strategyModules(modules), ...Object.fromEntries(Object.values(materializeMotorStrategy(tag, area, c)).map(b => [b.tag, b])) }
  for (const [name, b] of Object.entries(c)) {
    if (!Number.isFinite(b.delaySec) || b.delaySec < 0) return `${name}: delay must be finite and nonnegative`
    if (b.fbType === 'CND') {
      const error = conditionSourceError(b.expr, view)
      if (error) return `${name}: ${error}`
    }
    for (const input of [b.in1, b.in2]) {
      if (input.kind === 'const') {
        if (!Number.isFinite(input.value)) return `${name}: constant must be finite`
      } else {
        if (!input.tag || !view[input.tag] || input.tag === `${tag}/${name}`) return `${name}: choose an existing, separate source`
        if (input.parameter || input.block) {
          const error = signalError({ tag: input.tag, parameter: input.parameter ?? 'OUT', block: input.block }, view)
          if (error) return `${name}: ${error}`
        }
      }
    }
  }
  return null
}
export function parseMotorStrategy(data: unknown): MotorStrategyConfiguration {
  if (!data || typeof data !== 'object') throw new Error('Invalid saved motor strategy')
  const result: MotorStrategyConfiguration = {}
  const isParameter = (value: unknown): value is NonNullable<FbInputRef['parameter']> =>
    typeof value === 'string' && ['BYPASS', 'OUT_D', 'OUT_INT', 'FIRST_OUT', 'OUT', 'PV', 'OUT_1', 'OUT_2'].includes(value)
  const isBlock = (value: unknown): value is NonNullable<FbInputRef['block']> =>
    typeof value === 'string' && ['AI1', 'PID1', 'SPLTR1', 'AO1', 'AO2'].includes(value)
  const parseInput = (data: unknown): FbInputRef => {
    if (!data || typeof data !== 'object' || !('kind' in data) || !('value' in data) ||
      typeof data.value !== 'number' || !Number.isFinite(data.value)) throw new Error('Invalid saved motor input')
    if (data.kind === 'const') return { kind: 'const', value: data.value }
    if (data.kind !== 'ref' || !('tag' in data) || typeof data.tag !== 'string' ||
      'block' in data && !isBlock(data.block) || 'parameter' in data && !isParameter(data.parameter)) throw new Error('Invalid saved motor reference')
    return { kind: 'ref', tag: data.tag, value: data.value,
      parameter: 'parameter' in data && isParameter(data.parameter) ? data.parameter : undefined,
      block: 'block' in data && isBlock(data.block) ? data.block : undefined }
  }
  for (const [name, b] of Object.entries(data)) {
    if (!b || typeof b !== 'object' || !('fbType' in b) ||
      (b.fbType !== 'CND' && b.fbType !== 'BFI' && b.fbType !== 'OR' && b.fbType !== 'NOT' && b.fbType !== 'AND') ||
      !('description' in b) || typeof b.description !== 'string' || !('in1' in b) || !('in2' in b) ||
      !('expr' in b) || typeof b.expr !== 'string' || !('delaySec' in b) || typeof b.delaySec !== 'number' ||
      !('armTrap' in b) || typeof b.armTrap !== 'boolean') throw new Error('Invalid saved motor block')
    result[name] = { fbType: b.fbType, description: b.description, in1: parseInput(b.in1), in2: parseInput(b.in2),
      expr: b.expr, delaySec: b.delaySec, armTrap: b.armTrap }
  }
  return result
}
