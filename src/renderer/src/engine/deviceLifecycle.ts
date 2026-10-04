import type { AnyModule, MotorModule, ValveModule } from './types'
import type { HardwareState } from './hardware'
import { controllerIsDown } from './hardware'
import { deviceBindingError, deviceChannelSignal, findDst } from './traditionalIo'
import { deviceSourceError } from './fb'

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
  confirmTimeSec: m.confirmTimeSec, interlockSource: m.interlockSource,
  permissiveSource: m.permissiveSource, commandSource: m.commandSource }
}
export function deviceConfigurationError(c: DeviceConfiguration, modules: Record<string, AnyModule>): string | null {
  const m = modules[c.tag]
  return !m || m.type !== c.type || (c.type !== 'MOTOR' && c.type !== 'VALVE') ? 'Device tag/type does not match the project' :
    !Number.isFinite(c.confirmTimeSec) || c.confirmTimeSec < 0 ? 'Confirmation time must be finite and nonnegative' :
    typeof c.permissiveRequired !== 'boolean' || typeof c.resetRequired !== 'boolean' ? 'Device options must be Boolean' :
    deviceSourceError(modules, c.tag, c.interlockSource, 'Interlock') ??
    deviceSourceError(modules, c.tag, c.permissiveSource, 'Permissive') ??
    deviceSourceError(modules, c.tag, c.commandSource, 'Command')
}
export function deviceDownloadError(c: DeviceConfiguration, modules: Record<string, AnyModule>, hw: HardwareState): string | null {
  const controller = hw.controllers[c.controllerTag]
  const m = modules[c.tag]
  const input = findDst(hw, c.inputDst)
  const output = findDst(hw, c.outputDst)
  return deviceConfigurationError(c, modules) ??
    (!controller || !controller.commissioned || controllerIsDown(controller) ? 'Assign a commissioned, available controller' :
      !c.inputDst || !c.outputDst ? 'Select both DI confirmation and DO command DSTs' :
      input?.card.controllerTag !== c.controllerTag || output?.card.controllerTag !== c.controllerTag ? 'Both DSTs must belong to the assigned controller' :
      deviceBindingError(hw, m, 'input', c.inputDst) ?? deviceBindingError(hw, m, 'output', c.outputDst) ??
      (deviceChannelSignal(hw, c.inputDst, 'DI').bad || deviceChannelSignal(hw, c.outputDst, 'DO').bad ? 'Both device channels must be enabled and scanned Good' :
        input.channel.value !== 0 || output.channel.value !== 0 ? 'Confirm both physical channels passive before downloading' : null))
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
  return { tag, type: c.type, controllerTag: c.controllerTag, inputDst: c.inputDst, outputDst: c.outputDst,
    permissiveRequired: c.permissiveRequired, resetRequired: c.resetRequired, confirmTimeSec: c.confirmTimeSec,
    interlockSource: 'interlockSource' in c && typeof c.interlockSource === 'string' ? c.interlockSource : undefined,
    permissiveSource: 'permissiveSource' in c && typeof c.permissiveSource === 'string' ? c.permissiveSource : undefined,
    commandSource: 'commandSource' in c && typeof c.commandSource === 'string' ? c.commandSource : undefined }
}
