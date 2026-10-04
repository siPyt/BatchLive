import type { MotorModule, ValveModule } from './types'
import type { NamedSetDefinition, NamedSetState } from './namedSets'
import { isValidDeltaVTag } from './naming'

export const descriptorRoles = ['passiveCommand', 'activeCommand', 'passiveFeedback', 'activeFeedback'] as const
export interface DeviceStateDescriptors {
  namedSet: string
  passiveCommand: number
  activeCommand: number
  passiveFeedback: number
  activeFeedback: number
}

export function descriptorMappingError(d: DeviceStateDescriptors): string | null {
  return !isValidDeltaVTag(d.namedSet) ? 'Select a valid descriptor Named Set' :
    descriptorRoles.some(role => !Number.isSafeInteger(d[role])) ? 'Descriptor values must be safe integers' :
      new Set(descriptorRoles.map(role => d[role])).size !== 4 ? 'Command and feedback require four distinct descriptor entries' : null
}

export function descriptorDefinitionError(d: DeviceStateDescriptors, definition: NamedSetDefinition | undefined): string | null {
  return descriptorMappingError(d) ??
    (!definition || definition.entries.length !== 4 ? `Descriptor Named Set ${d.namedSet} requires four entries` :
      descriptorRoles.some(role => !definition.entries.some(entry => entry.value === d[role] && entry.visible)) ?
        `Descriptor Named Set ${d.namedSet} requires four mapped visible entries` :
        (['passiveCommand', 'activeCommand'] as const).some(role =>
          !definition.entries.some(entry => entry.value === d[role] && entry.userSelectable)) ?
          'Both command descriptors must be User Selectable' : null)
}

export function parseDeviceDescriptors(value: unknown): DeviceStateDescriptors {
  if (!value || typeof value !== 'object' || !('namedSet' in value) || typeof value.namedSet !== 'string' ||
    !('passiveCommand' in value) || typeof value.passiveCommand !== 'number' ||
    !('activeCommand' in value) || typeof value.activeCommand !== 'number' ||
    !('passiveFeedback' in value) || typeof value.passiveFeedback !== 'number' ||
    !('activeFeedback' in value) || typeof value.activeFeedback !== 'number') throw new Error('Malformed saved device descriptors')
  const result = { namedSet: value.namedSet, passiveCommand: value.passiveCommand,
    activeCommand: value.activeCommand, passiveFeedback: value.passiveFeedback, activeFeedback: value.activeFeedback }
  const error = descriptorMappingError(result)
  if (error) throw new Error(error)
  return result
}

export function deviceDescriptorLabel(m: MotorModule | ValveModule, sets: NamedSetState,
  role: 'command' | 'feedback', active: boolean): { label: string; error: string | null } {
  const d = m.descriptors
  if (!d) return { label: role === 'command' ?
    m.type === 'MOTOR' ? active ? 'START' : 'STOP' : active ? 'OPEN' : 'CLOSE' :
    m.type === 'MOTOR' ? active ? 'Running' : 'Stopped' : active ? 'Open' : 'Closed', error: null }
  const definition = sets.deployed.WORKSTATION?.[d.namedSet]
  const error = descriptorDefinitionError(d, definition)
  if (error) return { label: `${Number(active)} (Descriptor Bad)`, error: `Workstation setup: ${error}` }
  const value = role === 'command' ? active ? d.activeCommand : d.passiveCommand :
    active ? d.activeFeedback : d.passiveFeedback
  const entry = definition?.entries.find(item => item.value === value)
  return entry ? { label: entry.name, error: null } :
    { label: `${Number(active)} (Descriptor Bad)`, error: `Missing descriptor value ${value}` }
}

export function deviceDescriptorCommandError(m: MotorModule | ValveModule, sets: NamedSetState): string | null {
  if (!m.descriptors) return null
  return descriptorDefinitionError(m.descriptors, sets.deployed[`CONTROLLER:${m.controllerTag}`]?.[m.descriptors.namedSet]) ??
    deviceDescriptorLabel(m, sets, 'command', true).error
}
