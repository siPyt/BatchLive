import type { AlarmLimit, AnyModule, PidIoStrategy, PidModule } from './types'
import type { HardwareState } from './hardware'
import { controllerIsDown } from './hardware'
import { clonePidIo } from './analogStrategy'
import { analogBindingError, findDst } from './traditionalIo'
import { isPidTargetMode, pidTargetAllowed } from './pidModes'
import { moduleNameError } from './naming'

export interface PidConfiguration {
  module: PidModule
  controllerTag: string
  inputDst: string
  outputDst: string
}

export interface PidLifecycle {
  draft: PidConfiguration
  saved?: PidConfiguration
  deployed?: PidConfiguration
  online: boolean
  savedRevision: number
  deployedRevision: number
}

export interface PidLifecyclePatch {
  controllerTag?: string
  inputDst?: string
  outputDst?: string
}

export function clonePidConfiguration(configuration: PidConfiguration): PidConfiguration {
  const module = configuration.module
  return {
    ...configuration,
    module: {
      ...module,
      permittedModes: module.permittedModes ? [...module.permittedModes] : undefined,
      alarms: module.alarms.map(alarm => ({ ...alarm })),
      io: clonePidIo(module)
    }
  }
}

export function pidLifecycleDirty(record: PidLifecycle): boolean {
  return !record.saved || JSON.stringify(record.draft) !== JSON.stringify(record.saved)
}

export function lifecyclePidModules(
  modules: Record<string, AnyModule>,
  records: Record<string, PidLifecycle>
): Record<string, AnyModule> {
  const offline = Object.entries(records).filter(([, record]) => !record.online)
  return offline.length
    ? { ...modules, ...Object.fromEntries(offline.map(([tag, record]) => [tag, record.draft.module])) }
    : modules
}

export function pidConfigurationError(configuration: PidConfiguration): string | null {
  const m = configuration.module
  if (m.type !== 'PID' || m.templateId !== 'PID_LOOP') return 'Saved lifecycle requires a PID_LOOP module'
  if (moduleNameError(m.tag)) return 'PID_LOOP tag is invalid'
  if (!configuration.controllerTag && (configuration.inputDst || configuration.outputDst)) {
    return 'Assign a controller for the configured I/O'
  }
  if (!Number.isFinite(m.pvMin) || !Number.isFinite(m.pvMax) || m.pvMin !== 0 || m.pvMax !== 100) {
    return 'PID_LOOP range must remain 0-100 GPM'
  }
  if (m.unit !== 'GPM' || m.gain !== 0.5 || m.reset !== 3 || m.rate !== 0 || m.direct ||
      m.outputAction !== 'INCREASE_TO_OPEN') return 'PID_LOOP course tuning or I/O action was changed'
  if (m.primaryDisplay !== 'TANK101') return 'PID_LOOP primary display must remain TANK101'
  if (!Number.isFinite(m.sp) || m.sp < m.pvMin || m.sp > m.pvMax) return 'Configured SP must be 0-100 GPM'
  if (!isPidTargetMode(m.mode) || !pidTargetAllowed(m, m.mode)) return 'Configured PID target mode is invalid'
  if (m.normalMode !== 'AUTO' || !m.permittedModes?.length ||
      new Set(m.permittedModes).size !== m.permittedModes.length ||
      m.permittedModes.some(mode => !isPidTargetMode(mode)) ||
      !m.permittedModes.includes(m.normalMode)) {
    return 'PID_LOOP mode fields are invalid'
  }
  if ((m.mode === 'CAS' || m.mode === 'RCAS') && !m.casSource) {
    return 'Configured cascade mode requires a cascade source'
  }
  if (!m.io || !isPidIo(m.io) || m.io.ao2 || m.io.splitter || m.io.actuation === 'HEAT_COOL') {
    return 'PID_LOOP requires its standard AI1/PID1/AO1 strategy'
  }
  if (!m.io.aiConnected || !m.io.aoConnected || !m.io.bkcalConnected) {
    return 'PID_LOOP requires connected AI1, PID1, and AO1 blocks'
  }
  if (!m.alarms.some(alarm => alarm.type === 'LO' && alarm.enabled && alarm.limit === 10) ||
      !m.alarms.some(alarm => alarm.type === 'HI' && alarm.enabled && alarm.limit === 90)) {
    return 'PID_LOOP requires enabled LO10 and HI90 alarms'
  }
  if (m.alarms.some(alarm => !isAlarm(alarm))) return 'Configured PID alarm is invalid'
  return null
}

export function pidDownloadError(configuration: PidConfiguration, hardware: HardwareState): string | null {
  const controller = hardware.controllers[configuration.controllerTag]
  const input = findDst(hardware, configuration.inputDst)
  const output = findDst(hardware, configuration.outputDst)
  const module = configuration.module
  return pidConfigurationError(configuration) ??
    (!controller || !controller.commissioned || controllerIsDown(controller)
      ? 'Assign a commissioned, available controller before downloading' :
    !input || input.card.type !== 'AI' || input.card.controllerTag !== configuration.controllerTag
      ? 'Select an AI input DST on the assigned controller' :
    !output || output.card.type !== 'AO' || output.card.controllerTag !== configuration.controllerTag
      ? 'Select an AO output DST on the assigned controller' :
    analogBindingError(hardware, module, 'input', configuration.inputDst) ??
    analogBindingError(hardware, module, 'output', configuration.outputDst))
}

export function savedPidStorageKey(tag: string): string {
  return `batchlive.saved-pid-loop.v1.${tag}`
}

export function serializeSavedPid(configuration: PidConfiguration): string {
  const error = pidConfigurationError(configuration)
  if (error) throw new Error(error)
  return JSON.stringify({ version: 1, configuration })
}

export function parseSavedPid(text: string, tag: string): PidConfiguration {
  const data: unknown = JSON.parse(text)
  if (!isObject(data) || data.version !== 1 || !isObject(data.configuration) ||
      !isPidConfiguration(data.configuration) || data.configuration.module.tag !== tag) {
    throw new Error('Saved PID_LOOP configuration has an invalid schema, version or tag')
  }
  const error = pidConfigurationError(data.configuration)
  if (error) throw new Error(error)
  return clonePidConfiguration(data.configuration)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAlarm(value: unknown): value is AlarmLimit {
  return isObject(value) && typeof value.type === 'string' && typeof value.label === 'string' &&
    ['HI_HI', 'HI', 'LO', 'LO_LO', 'DV_HI', 'DV_LO', 'PVBAD', 'FAIL', 'INTERLOCK'].includes(value.type) &&
    typeof value.priority === 'string' && ['CRITICAL', 'WARNING', 'ADVISORY'].includes(value.priority) &&
    typeof value.enabled === 'boolean' &&
    (value.limit === undefined || typeof value.limit === 'number' && Number.isFinite(value.limit))
}

function isPidIo(value: unknown): value is PidIoStrategy {
  if (!isObject(value) || !isObject(value.ai) || !isObject(value.ao)) return false
  const ai = value.ai
  const ao = value.ao
  return (ai.mode === 'AUTO' || ai.mode === 'MAN') &&
    ['raw', 'out', 'manualValue'].every(key => typeof ai[key] === 'number' && Number.isFinite(ai[key])) &&
    typeof ai.rawBad === 'boolean' && typeof ai.bad === 'boolean' &&
    (ao.mode === 'CAS' || ao.mode === 'MAN') &&
    ['out', 'manualValue', 'lowLimit', 'highLimit'].every(key =>
      typeof ao[key] === 'number' && Number.isFinite(ao[key])) &&
    typeof ao.lowLimit === 'number' && typeof ao.highLimit === 'number' &&
    ao.lowLimit <= ao.highLimit && typeof ao.bad === 'boolean' && typeof ao.limited === 'boolean' &&
    typeof value.aiConnected === 'boolean' && typeof value.aoConnected === 'boolean' &&
    typeof value.bkcalConnected === 'boolean' &&
    (value.actuation === undefined || value.actuation === 'STAGED') &&
    (value.inputSource === undefined || isSignalRef(value.inputSource)) &&
    (value.outputSource === undefined || isSignalRef(value.outputSource)) &&
    (value.output2Source === undefined || isSignalRef(value.output2Source))
}

function isSignalRef(value: unknown): boolean {
  return isObject(value) && typeof value.tag === 'string' &&
    ['PV', 'OUT', 'OUT_1', 'OUT_2', 'OUT_D', 'OUT_INT', 'FIRST_OUT', 'BYPASS'].includes(String(value.parameter)) &&
    (value.block === undefined || ['AI1', 'PID1', 'SPLTR1', 'AO1', 'AO2'].includes(String(value.block)))
}

function isPidConfiguration(value: Record<string, unknown>): value is Record<string, unknown> & PidConfiguration {
  if (!isObject(value.module)) return false
  const m = value.module
  return m.type === 'PID' && m.templateId === 'PID_LOOP' &&
    typeof m.tag === 'string' && moduleNameError(m.tag) === null &&
    typeof m.description === 'string' && typeof m.area === 'string' &&
    typeof m.unit === 'string' && typeof m.direct === 'boolean' &&
    ['gain', 'reset', 'rate', 'sp', 'pv', 'out', 'pvMin', 'pvMax', 'decimals', '_integral', '_prevPv', '_dFilt'].every(key =>
      typeof m[key] === 'number' && Number.isFinite(m[key])) &&
    isPidTargetMode(m.mode) && Array.isArray(m.alarms) && m.alarms.every(isAlarm) &&
    (m.permittedModes === undefined || Array.isArray(m.permittedModes) &&
      m.permittedModes.every(isPidTargetMode)) &&
    (m.io === undefined || isPidIo(m.io)) &&
    typeof value.controllerTag === 'string' && typeof value.inputDst === 'string' &&
    typeof value.outputDst === 'string'
}
