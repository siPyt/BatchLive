import { isValidDeltaVTag } from './naming'

export interface NamedSetEntry {
  name: string
  value: number
  visible: boolean
  userSelectable: boolean
}

export interface NamedSetDefinition {
  name: string
  description: string
  entries: NamedSetEntry[]
}

export interface NamedSetState {
  configured: Record<string, NamedSetDefinition>
  deployed: Record<string, Record<string, NamedSetDefinition>>
}

export type NamedSetTarget = { kind: 'controller'; tag: string } | { kind: 'workstation' }
export const NAMED_SETS_STORAGE_KEY = 'batchlive.namedSets.v1'

export function namedSetTargetKey(target: NamedSetTarget): string {
  return target.kind === 'workstation' ? 'WORKSTATION' : `CONTROLLER:${target.tag}`
}

export function namedSetError(definition: NamedSetDefinition, allowEmpty = false): string | null {
  if (!isValidDeltaVTag(definition.name) || definition.name !== definition.name.trim()) {
    return 'Named Set name must use the supported 1-16-character module-name syntax; case is preserved'
  }
  if (!allowEmpty && !definition.entries.length) return `Named Set ${definition.name} requires at least one entry`
  const names = new Set<string>()
  const values = new Set<number>()
  for (const entry of definition.entries) {
    if (!entry.name.trim() || entry.name !== entry.name.trim()) return 'Entry name must be nonempty without leading/trailing whitespace'
    if (names.has(entry.name)) return `Duplicate case-sensitive entry name ${entry.name}`
    if (!Number.isSafeInteger(entry.value)) return 'Named Set values must be safe integers in this simulator'
    if (values.has(entry.value)) return `Duplicate Named Set value ${entry.value}`
    if (typeof entry.visible !== 'boolean' || typeof entry.userSelectable !== 'boolean') return 'Visible and User Selectable must be Boolean'
    names.add(entry.name)
    values.add(entry.value)
  }
  return null
}

export function cloneNamedSet(definition: NamedSetDefinition): NamedSetDefinition {
  return { name: definition.name, description: definition.description, entries: definition.entries.map(entry => ({ ...entry })) }
}

export function changedNamedSets(state: NamedSetState, target: NamedSetTarget): string[] {
  const deployed = state.deployed[namedSetTargetKey(target)] ?? {}
  return [...new Set([...Object.keys(state.configured), ...Object.keys(deployed)])].filter(name =>
    JSON.stringify(state.configured[name]) !== JSON.stringify(deployed[name]))
}

export function namedSetChoices(definition: NamedSetDefinition): NamedSetEntry[] {
  return definition.entries.filter(entry => entry.visible && entry.userSelectable).map(entry => ({ ...entry }))
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseNamedSets(text: string): { configured?: Record<string, NamedSetDefinition>; error?: string } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { error: 'Saved Named Sets are not valid JSON' } }
  if (!record(parsed) || parsed.version !== 1 || !Array.isArray(parsed.definitions)) return { error: 'Unsupported saved Named Set schema/version' }
  const definitions: [string, NamedSetDefinition][] = []
  const names = new Set<string>()
  for (const item of parsed.definitions) {
    if (!record(item) || typeof item.name !== 'string' || !Array.isArray(item.entries)) return { error: 'Malformed saved Named Set' }
    const entries: NamedSetEntry[] = []
    for (const entry of item.entries) {
      if (!record(entry) || typeof entry.name !== 'string' || typeof entry.value !== 'number' ||
        typeof entry.visible !== 'boolean' || typeof entry.userSelectable !== 'boolean') return { error: 'Malformed saved Named Set entry' }
      entries.push({ name: entry.name, value: entry.value, visible: entry.visible, userSelectable: entry.userSelectable })
    }
    if (item.description !== undefined && typeof item.description !== 'string') return { error: 'Malformed Named Set description' }
    const definition = { name: item.name, description: item.description ?? '', entries }
    const error = namedSetError(definition, true)
    if (error) return { error }
    if (names.has(definition.name)) return { error: `Duplicate saved Named Set ${definition.name}` }
    names.add(definition.name)
    definitions.push([definition.name, definition])
  }
  return { configured: Object.fromEntries(definitions) }
}

export function serializeNamedSets(configured: Record<string, NamedSetDefinition>): string {
  return JSON.stringify({ version: 1, definitions: Object.values(configured).map(cloneNamedSet) })
}
