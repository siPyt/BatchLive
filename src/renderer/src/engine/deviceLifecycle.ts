import type { AnyModule, MotorModule, ValveModule } from './types'
import type { HardwareState } from './hardware'
import { controllerIsDown } from './hardware'
import { deviceBindingError, deviceChannelSignal, findDst } from './traditionalIo'
import { deviceSourceError } from './fb'
import { descriptorDefinitionError, descriptorMappingError, parseDeviceDescriptors, type DeviceStateDescriptors } from './deviceDescriptors'
import type { NamedSetDefinition, NamedSetState } from './namedSets'
import { captureMotorStrategy, cloneMotorStrategy, materializeMotorStrategy, motorStrategyError, parseMotorStrategy,
  strategyModules, type MotorStrategyConfiguration } from './motorStrategy'

export interface DeviceConfiguration {
  tag: string
  type: 'MOTOR' | 'VALVE'
  controllerTag: string
  inputDst: string
  outputDst: string
  permissiveRequired: boolean
  resetRequired: boolean
  confirmTimeSec: number
  interlockSource?: string
  permissiveSource?: string
  commandSource?: string
  interlockInverted?: boolean
  feedbackInverted?: boolean
  feedbackUnavailable?: boolean
  strategy?: MotorStrategyConfiguration
  descriptors?: DeviceStateDescriptors
}
export interface DeviceLifecycle {
  draft: DeviceConfiguration
  saved?: DeviceConfiguration
  deployed?: DeviceConfiguration
  online: boolean
  savedRevision: number
  deployedRevision: number
}
export type DeviceDraftPatch = Partial<Omit<DeviceConfiguration, 'tag' | 'type'>>
export function cloneDeviceConfiguration(c: DeviceConfiguration): DeviceConfiguration {
  return { ...c, descriptors: c.descriptors ? { ...c.descriptors } : undefined,
    strategy: c.strategy ? cloneMotorStrategy(c.strategy) : undefined }
}
export function deviceEditorModules(modules: Record<string, AnyModule>, records: Record<string, DeviceLifecycle>): Record<string, AnyModule> {
  const view = { ...modules }
  for (const [tag, r] of Object.entries(records)) {
    const m = modules[tag]
    if (m?.type === 'MOTOR' && !r.online && r.draft.strategy) view[tag] = { ...m,
      ownedBlocks: materializeMotorStrategy(tag, m.area, r.draft.strategy) }
  }
  return strategyModules(view)
}
export function deviceDirty(record: DeviceLifecycle): boolean {
  return !record.saved || JSON.stringify(record.draft) !== JSON.stringify(record.saved)
}
export function deviceActive(m: MotorModule | ValveModule): boolean {
  return !!m.appliedCommand || (m.type === 'MOTOR' ? m.commanded || m.running : m.commandedOpen || m.open)
}
export function captureDevice(m: MotorModule | ValveModule, hw: HardwareState): DeviceConfiguration {
  const binding = hw.deviceBindings?.[m.tag]
  return { tag: m.tag, type: m.type, controllerTag: m.controllerTag ??
    (binding?.output ? findDst(hw, binding.output)?.card.controllerTag : '') ?? '',
  inputDst: binding?.input ?? '', outputDst: binding?.output ?? '',
  permissiveRequired: m.permissiveRequired, resetRequired: m.resetRequired,
  confirmTimeSec: m.confirmTimeSec, interlockInverted: m.interlockInverted,
  feedbackInverted: m.feedbackInverted, feedbackUnavailable: m.feedbackUnavailable,
  strategy: m.type === 'MOTOR' ? captureMotorStrategy(m) : undefined, interlockSource: m.interlockSource,
  permissiveSource: m.permissiveSource, commandSource: m.commandSource,
  descriptors: m.descriptors ? { ...m.descriptors } : undefined }
}
export function deviceConfigurationError(c: DeviceConfiguration, modules: Record<string, AnyModule>,
  namedSets?: Record<string, NamedSetDefinition>): string | null {
  const m = modules[c.tag]
  const view = c.strategy && m?.type === 'MOTOR' ? strategyModules({ ...modules, [c.tag]: { ...m,
    ownedBlocks: materializeMotorStrategy(c.tag, m.area, c.strategy) } }) : strategyModules(modules)
  return !m || m.type !== c.type || (c.type !== 'MOTOR' && c.type !== 'VALVE') ? 'Device tag/type does not match the project' :
    !Number.isFinite(c.confirmTimeSec) || c.confirmTimeSec < 0 ? 'Confirmation time must be finite and nonnegative' :
    typeof c.permissiveRequired !== 'boolean' || typeof c.resetRequired !== 'boolean' ? 'Device options must be Boolean' :
    c.interlockInverted !== undefined && typeof c.interlockInverted !== 'boolean' ? 'Interlock polarity must be Boolean' :
    c.feedbackInverted !== undefined && typeof c.feedbackInverted !== 'boolean' ? 'Feedback polarity must be Boolean' :
    c.feedbackUnavailable !== undefined && typeof c.feedbackUnavailable !== 'boolean' ? 'Feedback availability must be Boolean' :
    (c.descriptors ? descriptorMappingError(c.descriptors) ??
      (namedSets ? descriptorDefinitionError(c.descriptors, namedSets[c.descriptors.namedSet]) : null) : null) ??
    (c.strategy ? c.type !== 'MOTOR' ? 'Only motor modules can own this strategy' :
      motorStrategyError(c.tag, m.area, c.strategy, modules) : null) ??
    deviceSourceError(view, c.tag, c.interlockSource, 'Interlock') ??
    deviceSourceError(view, c.tag, c.permissiveSource, 'Permissive') ??
    deviceSourceError(view, c.tag, c.commandSource, 'Command')
}
export function deviceDownloadError(c: DeviceConfiguration, modules: Record<string, AnyModule>, hw: HardwareState,
  namedSets?: NamedSetState): string | null {
  const controller = hw.controllers[c.controllerTag]
  const m = modules[c.tag]
  const input = findDst(hw, c.inputDst)
  const output = findDst(hw, c.outputDst)
  return deviceConfigurationError(c, modules) ??
    (c.descriptors ? descriptorDefinitionError(c.descriptors,
      namedSets?.deployed[`CONTROLLER:${c.controllerTag}`]?.[c.descriptors.namedSet]) : null) ??
    (!controller || !controller.commissioned || controllerIsDown(controller) ? 'Assign a commissioned, available controller' :
      !c.inputDst || !c.outputDst ? 'Select both DI confirmation and DO command DSTs' :
      input?.card.controllerTag !== c.controllerTag || output?.card.controllerTag !== c.controllerTag ? 'Both DSTs must belong to the assigned controller' :
      deviceBindingError(hw, m, 'input', c.inputDst) ?? deviceBindingError(hw, m, 'output', c.outputDst) ??
      (deviceChannelSignal(hw, c.inputDst, 'DI').bad || deviceChannelSignal(hw, c.outputDst, 'DO').bad ? 'Both device channels must be enabled and scanned Good' :
        input.channel.value !== 0 || output.channel.value !== 0 ? 'Confirm both physical channels passive before downloading' : null))
}
export function prepareDeviceTransfer(record: DeviceLifecycle | undefined, tag: string,
  modules: Record<string, AnyModule>, hardware: HardwareState, namedSets: NamedSetState):
  { error: string } | { configuration: DeviceConfiguration; module: MotorModule | ValveModule } {
  const m = modules[tag]
  if (!record?.saved || deviceDirty(record) || !m || (m.type !== 'MOTOR' && m.type !== 'VALVE')) {
    return { error: 'Save the current device draft before downloading' }
  }
  if (deviceActive(m)) return { error: 'Stop/close and confirm the device before downloading' }
  const error = deviceDownloadError(record.saved, modules, hardware, namedSets)
  if (error) return { error: `Device download failed; last-good runtime retained: ${error}` }
  const c = record.saved
  const module = { ...m, permissiveRequired: c.permissiveRequired,
    interlockInverted: c.interlockInverted, feedbackInverted: c.feedbackInverted, feedbackUnavailable: c.feedbackUnavailable,
    descriptors: c.descriptors ? { ...c.descriptors } : undefined,
    resetRequired: c.resetRequired, confirmTimeSec: c.confirmTimeSec, interlockSource: c.interlockSource,
    permissiveSource: c.permissiveSource, commandSource: c.commandSource, controllerTag: c.controllerTag,
    downloaded: true, ioInputBad: true, ioOutputBad: true, outputCommand: false, travelTimer: 0,
    interlock: c.interlockSource ? true : m.interlock, permissiveOk: c.permissiveSource ? false : m.permissiveOk }
  if (module.type === 'MOTOR' && c.strategy) {
    module.templateId = 'MTR-11_ILOCK'
    module.ownedBlocks = materializeMotorStrategy(tag, m.area, c.strategy)
  }
  return { configuration: c, module }
}
export function deviceOperatorError(m: MotorModule | ValveModule, hw: HardwareState): string | null {
  if (m.downloaded === undefined) return null
  if (!m.downloaded) return 'Save and download the device before commanding it active'
  const c = m.controllerTag ? hw.controllers[m.controllerTag] : undefined
  return !c || !c.commissioned || controllerIsDown(c) ? 'Device command requires an available assigned controller' : null
}
export function savedDeviceKey(tag: string): string { return `batchlive.device.v1.${tag}` }
export function serializeDevice(c: DeviceConfiguration): string { return JSON.stringify({ version: 1, configuration: c }) }
export function parseDevice(text: string, tag: string): DeviceConfiguration {
  const data: unknown = JSON.parse(text)
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 ||
    !('configuration' in data) || !data.configuration || typeof data.configuration !== 'object') throw new Error('Invalid saved device schema')
  const c = data.configuration
  if (!('tag' in c) || c.tag !== tag || !('type' in c) || (c.type !== 'MOTOR' && c.type !== 'VALVE') ||
    !('controllerTag' in c) || typeof c.controllerTag !== 'string' || !('inputDst' in c) || typeof c.inputDst !== 'string' ||
    !('outputDst' in c) || typeof c.outputDst !== 'string' || !('permissiveRequired' in c) || typeof c.permissiveRequired !== 'boolean' ||
    !('resetRequired' in c) || typeof c.resetRequired !== 'boolean' || !('confirmTimeSec' in c) ||
    typeof c.confirmTimeSec !== 'number' || !Number.isFinite(c.confirmTimeSec) || c.confirmTimeSec < 0) throw new Error('Invalid saved device configuration')
  if ('interlockSource' in c && typeof c.interlockSource !== 'string' ||
      'permissiveSource' in c && typeof c.permissiveSource !== 'string' ||
      'commandSource' in c && typeof c.commandSource !== 'string') throw new Error('Invalid saved device source')
  if ('interlockInverted' in c && typeof c.interlockInverted !== 'boolean') throw new Error('Invalid saved interlock polarity')
  if ('feedbackInverted' in c && typeof c.feedbackInverted !== 'boolean') throw new Error('Invalid saved feedback polarity')
  if ('feedbackUnavailable' in c && typeof c.feedbackUnavailable !== 'boolean') throw new Error('Invalid saved feedback availability')
  return { tag, type: c.type, controllerTag: c.controllerTag, inputDst: c.inputDst, outputDst: c.outputDst,
    permissiveRequired: c.permissiveRequired, resetRequired: c.resetRequired, confirmTimeSec: c.confirmTimeSec,
    interlockSource: 'interlockSource' in c && typeof c.interlockSource === 'string' ? c.interlockSource : undefined,
    permissiveSource: 'permissiveSource' in c && typeof c.permissiveSource === 'string' ? c.permissiveSource : undefined,
    commandSource: 'commandSource' in c && typeof c.commandSource === 'string' ? c.commandSource : undefined,
    interlockInverted: 'interlockInverted' in c && typeof c.interlockInverted === 'boolean' ? c.interlockInverted : undefined,
    feedbackInverted: 'feedbackInverted' in c && typeof c.feedbackInverted === 'boolean' ? c.feedbackInverted : undefined,
    feedbackUnavailable: 'feedbackUnavailable' in c && typeof c.feedbackUnavailable === 'boolean' ? c.feedbackUnavailable : undefined,
    descriptors: 'descriptors' in c ? parseDeviceDescriptors(c.descriptors) : undefined,
    strategy: 'strategy' in c ? parseMotorStrategy(c.strategy) : undefined }
}
