import type { AnyModule } from './types'

export interface TrendPen {
  key: string
  tag: string
  label: string
  color: string
  min: number
  max: number
  unit: string
}

export const DEFAULT_TREND_TAGS = ['FIC-101', 'LIC-101', 'LIC-201', 'TIC-201', 'PIC-301', 'AT-301']
const COLORS = ['#4fd1a0', '#6ec1ff', '#c792ea', '#ff9e64', '#f7768e', '#e0d040']

export function moduleTrendPens(module: AnyModule | undefined, color = COLORS[0]): TrendPen[] {
  if (!module || (module.type !== 'PID' && module.type !== 'AI' && module.type !== 'AO')) return []
  const common = { tag: module.tag, min: module.pvMin, max: module.pvMax, unit: module.unit }
  const pv = { ...common, key: `${module.tag}.PV`, label: `${module.tag} PV`, color }
  if (module.type === 'AI') return [pv]
  return [pv,
    { ...common, key: `${module.tag}.SP`, label: `${module.tag} SP`, color: '#2f6fbe' },
    { tag: module.tag, key: `${module.tag}.OUT`, label: `${module.tag} OUT`,
      min: 0, max: 100, unit: '%', color: '#c07a24' }]
}

export function availableTrendPens(modules: Record<string, AnyModule>): TrendPen[] {
  return Object.values(modules).flatMap((module, index) => {
    const defaultIndex = DEFAULT_TREND_TAGS.indexOf(module.tag)
    return moduleTrendPens(module, COLORS[(defaultIndex >= 0 ? defaultIndex : index) % COLORS.length])
  })
}
