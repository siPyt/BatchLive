import { cloneNamedSet, parseNamedSets, serializeNamedSets, type NamedSetDefinition } from './namedSets'
import type { HardwareState } from './hardware'
import type { ModuleType } from './types'

// ---------------------------------------------------------------------------
// DeltaV Export (DV-09 chapter 8 workshop): export the Physical Network, the
// Control Strategies and individual Named Sets from the configuration, and
// copy operator pictures to removable media. This simulator writes its own
// versioned JSON package (not native .fhx / .grf files), validates every
// package before importing it, and round-trips the exported configuration.
// ---------------------------------------------------------------------------

export type ExportKind = 'physical-network' | 'control-strategies' | 'named-sets' | 'pictures'

export const EXPORT_KIND_LABEL: Record<ExportKind, string> = {
  'physical-network': 'Physical Network',
  'control-strategies': 'Control Strategies',
  'named-sets': 'Named Sets',
  pictures: 'Operator Pictures'
}

export interface ExportPackage {
  format: 'batchlive-export'
  version: 1
  kind: ExportKind
  /** What was exported: a project part or the names of the sets/pictures. */
  name: string
  exportedAt: number
  data: unknown
}

export interface ControlStrategiesData {
  areas: string[]
  modules: Record<string, unknown>
  equipment: Record<string, unknown>
  sfcs: Record<string, unknown>
  phases: Record<string, unknown>
}

export interface ExportSource {
  hardware: HardwareState
  areas: string[]
  modules: Record<string, unknown>
  equipment: Record<string, unknown>
  sfcs: Record<string, unknown>
  phases: Record<string, unknown>
  namedSets: Record<string, NamedSetDefinition>
  pictures: Record<string, unknown>
}

const MODULE_TYPES: ModuleType[] = ['PID', 'AI', 'AO', 'DI', 'DO', 'MOTOR', 'VALVE', 'FB']
const CHARM_TYPES = ['AI', 'AI_HART', 'AO', 'DI', 'DO', 'RTD', 'TC']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function buildExportPackage(kind: ExportKind, source: ExportSource, names: string[] = []): ExportPackage | { error: string } {
  const base = { format: 'batchlive-export' as const, version: 1 as const, kind, exportedAt: Date.now() }
  if (kind === 'physical-network') return { ...base, name: 'Physical Network', data: clone(source.hardware) }
  if (kind === 'control-strategies') {
    const data: ControlStrategiesData = clone({
      areas: source.areas,
      modules: source.modules,
      equipment: source.equipment,
      sfcs: source.sfcs,
      phases: source.phases
    })
    return { ...base, name: 'Control Strategies', data }
  }
  if (kind === 'named-sets') {
    if (!names.length) return { error: 'Select at least one Named Set to export' }
    const missing = names.find((name) => !Object.hasOwn(source.namedSets, name))
    if (missing) return { error: `Named Set ${missing} does not exist` }
    const selected = Object.fromEntries(names.map((name) => [name, cloneNamedSet(source.namedSets[name])]))
    return { ...base, name: names.join(', '), data: serializeNamedSets(selected) }
  }
  if (!names.length) return { error: 'Select at least one picture to export' }
  const missing = names.find((name) => !Object.hasOwn(source.pictures, name))
  if (missing) return { error: `Picture ${missing} does not exist` }
  return { ...base, name: names.join(', '), data: clone(Object.fromEntries(names.map((name) => [name, source.pictures[name]]))) }
}

export function serializeExport(pkg: ExportPackage): string {
  return JSON.stringify(pkg)
}

export function parseExportPackage(text: string): { package?: ExportPackage; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'The file is not a BatchLive export (invalid JSON)' }
  }
  if (!isRecord(parsed) || parsed.format !== 'batchlive-export') return { error: 'The file is not a BatchLive export package' }
  if (parsed.version !== 1) return { error: `Unsupported export version ${String(parsed.version)}` }
  const kind = parsed.kind
  if (typeof kind !== 'string' || !(kind in EXPORT_KIND_LABEL)) return { error: 'The export package has an unknown kind' }
  if (typeof parsed.name !== 'string' || typeof parsed.exportedAt !== 'number' || parsed.data === undefined) {
    return { error: 'The export package is incomplete' }
  }
  return { package: parsed as unknown as ExportPackage }
}

export function hardwareError(data: unknown): string | null {
  if (!isRecord(data)) return 'Physical Network data is missing'
  const { controllers, carriers, baseplates } = data
  if (!isRecord(controllers) || !isRecord(carriers) || !isRecord(baseplates)) {
    return 'Physical Network requires controllers, carriers and baseplates'
  }
  for (const [key, c] of Object.entries(controllers)) {
    if (!isRecord(c) || c.tag !== key) return `Controller ${key} is malformed or its tag does not match`
    if (!Array.isArray(c.carrierIds) || c.carrierIds.some((id) => typeof id !== 'string' || !(id in carriers))) {
      return `Controller ${key} references a carrier that is not in the package`
    }
  }
  for (const [key, carrier] of Object.entries(carriers)) {
    if (!isRecord(carrier) || carrier.id !== key) return `Carrier ${key} is malformed or its id does not match`
    if (typeof carrier.controllerTag !== 'string' || !(carrier.controllerTag in controllers)) {
      return `Carrier ${key} references an unknown controller`
    }
    if (!Array.isArray(carrier.baseplateIds) || carrier.baseplateIds.some((id) => typeof id !== 'string' || !(id in baseplates))) {
      return `Carrier ${key} references a baseplate that is not in the package`
    }
  }
  for (const [key, plate] of Object.entries(baseplates)) {
    if (!isRecord(plate) || plate.id !== key) return `Baseplate ${key} is malformed or its id does not match`
    if (typeof plate.carrierId !== 'string' || !(plate.carrierId in carriers)) return `Baseplate ${key} references an unknown carrier`
    if (!Array.isArray(plate.channels) || plate.channels.length !== 8) return `Baseplate ${key} must have exactly 8 channels`
    for (const [index, channel] of plate.channels.entries()) {
      if (!isRecord(channel) || channel.slot !== index + 1) return `Baseplate ${key} channel ${index + 1} is malformed`
      if (channel.type !== null && !CHARM_TYPES.includes(channel.type as string)) return `Baseplate ${key} channel ${index + 1} has an unknown CHARM type`
    }
  }
  for (const optional of ['traditionalCards', 'discreteBindings', 'analogBindings', 'deviceBindings'] as const) {
    if (data[optional] !== undefined && !isRecord(data[optional])) return `Physical Network ${optional} is malformed`
  }
  return null
}

export function controlStrategiesError(data: unknown): string | null {
  if (!isRecord(data)) return 'Control Strategies data is missing'
  const { areas, modules, equipment, sfcs, phases } = data
  if (!Array.isArray(areas) || !areas.length || areas.some((a) => typeof a !== 'string' || !a.trim())) return 'Control Strategies require a list of plant areas'
  if (new Set(areas).size !== areas.length) return 'Plant area names must be unique'
  if (!isRecord(modules) || !isRecord(equipment) || !isRecord(sfcs) || !isRecord(phases)) {
    return 'Control Strategies require modules, equipment, sfcs and phases'
  }
  for (const [key, m] of Object.entries(modules)) {
    if (!isRecord(m) || m.tag !== key) return `Module ${key} is malformed or its tag does not match`
    if (!key.trim() || /\s/.test(key)) return `Module name ${key} must not be blank or contain spaces`
    if (!MODULE_TYPES.includes(m.type as ModuleType)) return `Module ${key} has an unknown type`
    if (typeof m.area !== 'string' || !areas.includes(m.area)) return `Module ${key} is in an area that is not in the package`
  }
  for (const [key, em] of Object.entries(equipment)) {
    if (!isRecord(em) || em.tag !== key) return `Equipment Module ${key} is malformed or its tag does not match`
    if (typeof em.area !== 'string' || !areas.includes(em.area)) return `Equipment Module ${key} is in an area that is not in the package`
  }
  for (const [key, sfc] of Object.entries(sfcs)) {
    if (!isRecord(sfc) || sfc.name !== key) return `SFC ${key} is malformed or its name does not match`
    if (!Array.isArray(sfc.steps)) return `SFC ${key} has no steps list`
  }
  return null
}

export function namedSetsExportError(data: unknown): { configured?: Record<string, NamedSetDefinition>; error?: string } {
  if (typeof data !== 'string') return { error: 'Named Set data is missing' }
  const parsed = parseNamedSets(data)
  if (parsed.error || !parsed.configured) return { error: parsed.error ?? 'Named Set data is malformed' }
  if (!Object.keys(parsed.configured).length) return { error: 'The package contains no Named Sets' }
  return parsed
}

export function picturesExportError(data: unknown): string | null {
  if (!isRecord(data) || !Object.keys(data).length) return 'The package contains no pictures'
  for (const [name, picture] of Object.entries(data)) {
    if (!isRecord(picture) || !Array.isArray(picture.elements)) return `Picture ${name} is malformed`
  }
  return null
}
