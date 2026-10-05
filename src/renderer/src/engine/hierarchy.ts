import { isValidDeltaVTag } from './naming'
import type { EquipmentModule } from './equipment'
import type { AnyModule } from './types'

/** DV09-013 equipment hierarchy: Area > Process Cell > Unit > Equipment Module > Control Module (course pp79-83). */
export interface ProcessCell { name: string; area: string; description: string }
export interface Unit { name: string; cell: string; description: string }

export const HIERARCHY_LEVELS = ['Area', 'Process Cell', 'Unit', 'Equipment Module', 'Control Module'] as const
export const MAX_HIERARCHY_DESCRIPTION = 120

export interface HierarchyState {
  areas: string[]
  processCells: Record<string, ProcessCell>
  units: Record<string, Unit>
  equipment: Record<string, EquipmentModule>
}

/** One process cell and one unit per area, every equipment module placed under its area's unit. */
export function makeDefaultHierarchy(areas: readonly string[], equipment: Record<string, EquipmentModule>): {
  processCells: Record<string, ProcessCell>; units: Record<string, Unit>; equipment: Record<string, EquipmentModule>
} {
  const processCells: Record<string, ProcessCell> = {}
  const units: Record<string, Unit> = {}
  const placed: Record<string, EquipmentModule> = {}
  const hasEquipment = new Set(Object.values(equipment).map((em) => em.area))
  for (const area of areas) {
    if (!hasEquipment.has(area)) continue
    const cell = `${area}_CELL`
    const unit = `${area}_UNIT`
    if (cell.length > 16 || unit.length > 16) continue
    processCells[cell] = { name: cell, area, description: `${area} process cell` }
    units[unit] = { name: unit, cell, description: `${area} unit` }
  }
  for (const [tag, em] of Object.entries(equipment)) placed[tag] = units[`${em.area}_UNIT`] ? { ...em, unit: `${em.area}_UNIT` } : em
  return { processCells, units, equipment: placed }
}

/** Names are unique across the whole hierarchy so a path is never ambiguous. */
export function hierarchyNames(h: HierarchyState): string[] {
  return [...h.areas, ...Object.keys(h.processCells), ...Object.keys(h.units), ...Object.keys(h.equipment)]
}

export function hierarchyNameError(name: string, level: 'Process Cell' | 'Unit', h: HierarchyState): string | null {
  if (!isValidDeltaVTag(name)) return `${level} names must have at most 16 letters, digits, $, - or _, with at least one letter`
  if (hierarchyNames(h).some((n) => n.toLowerCase() === name.toLowerCase())) return `The name ${name} is already used in the equipment hierarchy`
  return null
}

export function processCellError(name: string, area: string, description: string, h: HierarchyState): string | null {
  return hierarchyNameError(name, 'Process Cell', h) ?? (!h.areas.includes(area) ? `Area ${area} does not exist` :
    description.length > MAX_HIERARCHY_DESCRIPTION ? `The description is limited to ${MAX_HIERARCHY_DESCRIPTION} characters` : null)
}

export function unitError(name: string, cell: string, description: string, h: HierarchyState): string | null {
  return hierarchyNameError(name, 'Unit', h) ?? (!h.processCells[cell] ? `Process Cell ${cell} does not exist` :
    description.length > MAX_HIERARCHY_DESCRIPTION ? `The description is limited to ${MAX_HIERARCHY_DESCRIPTION} characters` : null)
}

export function deleteProcessCellError(name: string, h: HierarchyState): string | null {
  if (!h.processCells[name]) return `Process Cell ${name} does not exist`
  const units = Object.values(h.units).filter((u) => u.cell === name).map((u) => u.name)
  return units.length ? `Process Cell ${name} still contains unit(s) ${units.join(', ')}; delete or move them first` : null
}

export function deleteUnitError(name: string, h: HierarchyState): string | null {
  if (!h.units[name]) return `Unit ${name} does not exist`
  const ems = Object.values(h.equipment).filter((em) => em.unit === name).map((em) => em.tag)
  return ems.length ? `Unit ${name} still contains equipment module(s) ${ems.join(', ')}; reassign them first` : null
}

/** An equipment module may only sit under a unit whose process cell is in the module's own area. */
export function assignUnitError(emTag: string, unit: string | null, h: HierarchyState): string | null {
  const em = h.equipment[emTag]
  if (!em) return `Equipment Module ${emTag} does not exist`
  if (unit === null) return null
  const target = h.units[unit]
  if (!target) return `Unit ${unit} does not exist`
  const cell = h.processCells[target.cell]
  if (!cell) return `Unit ${unit} has no process cell`
  if (cell.area !== em.area) return `Unit ${unit} belongs to area ${cell.area}; ${emTag} is in area ${em.area}`
  return null
}

export interface HierarchyPath {
  area: string
  cell?: string
  unit?: string
  equipment?: string
  module?: string
  /** True when every level from Area to the lowest assigned level is present (cell and unit exist for an equipment module). */
  complete: boolean
}

export function equipmentPath(emTag: string, h: HierarchyState): HierarchyPath | undefined {
  const em = h.equipment[emTag]
  if (!em) return undefined
  const unit = em.unit ? h.units[em.unit] : undefined
  const cell = unit ? h.processCells[unit.cell] : undefined
  return { area: em.area, cell: cell?.name, unit: unit?.name, equipment: em.tag, complete: !!unit && !!cell && cell.area === em.area }
}

export function modulePath(module: Pick<AnyModule, 'tag' | 'area'> & { equipmentModule?: string }, h: HierarchyState): HierarchyPath {
  const em = module.equipmentModule ? equipmentPath(module.equipmentModule, h) : undefined
  if (em && h.equipment[module.equipmentModule as string].area === module.area) return { ...em, module: module.tag }
  return { area: module.area, module: module.tag, complete: false }
}

export function describePath(path: HierarchyPath): string {
  return [path.area, path.cell, path.unit, path.equipment, path.module].filter((p): p is string => !!p).join(' > ')
}

/** DeltaV Batch needs a full Area > Process Cell > Unit hierarchy for the unit it runs on (course p2-11). */
export function batchHierarchyError(area: string, h: HierarchyState): string | null {
  if (!h.areas.includes(area)) return `DeltaV Batch needs area ${area}, which does not exist`
  const cells = Object.values(h.processCells).filter((c) => c.area === area)
  if (!cells.length) return `DeltaV Batch requires a full Area > Process Cell > Unit hierarchy: area ${area} has no process cell`
  if (!Object.values(h.units).some((u) => cells.some((c) => c.name === u.cell)))
    return `DeltaV Batch requires a full Area > Process Cell > Unit hierarchy: ${cells[0].name} has no unit`
  return null
}

/** Rename an area inside the hierarchy records. */
export function renameAreaInHierarchy<T extends { area: string }>(records: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.area === from ? { ...v, area: to } : v]))
}
