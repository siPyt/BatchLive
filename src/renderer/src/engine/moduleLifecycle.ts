import type { AlarmLimit, AnalogOutputModule, AnalogOutputPatch, AnyModule } from './types'
import type { HardwareState } from './hardware'
import { controllerIsDown } from './hardware'
import { analogBindingError, findDst } from './traditionalIo'
import { aoConfigurationError, aoEngineeringValue } from './standaloneAo'
import { moduleNameError } from './naming'

export type DownloadBehavior = 'CONFIGURED' | 'CRITICAL' | 'ALL'
export interface AoConfiguration {
  module: AnalogOutputModule
  controllerTag: string
  outputDst: string
  restoreModule: boolean
  restoreParameters: string[]
  downloadBehavior: DownloadBehavior
}
export interface AoMemory {
  mode: AnalogOutputModule['mode']
  sp: number
  out: number
  parameters: Record<string, number>
}
export interface AoLifecycle {
  draft: AoConfiguration
  saved?: AoConfiguration
  deployed?: AoConfiguration
  lastGoodDownload?: AoConfiguration
  replayFullRequired?: boolean
  restartDownload?: AoConfiguration
  restartMemoryRequired?: boolean
  nvm?: AoMemory
  online: boolean
  savedRevision: number
  deployedRevision: number
}
export interface AoDraftPatch extends AnalogOutputPatch {
  controllerTag?: string
  outputDst?: string
  mode?: AnalogOutputModule['mode']
  sp?: number
  manualOutput?: number
  parameter?: { name: string; value: number }
  restoreModule?: boolean
  restoreParameters?: string[]
  downloadBehavior?: DownloadBehavior
}

export function cloneAo(m: AnalogOutputModule): AnalogOutputModule {
  return { ...m, parameters: Object.fromEntries(Object.entries(m.parameters).map(([name, p]) =>
    [name, { ...p }])), alarms: m.alarms.map(a => ({ ...a })) }
}
export function cloneConfiguration(c: AoConfiguration): AoConfiguration {
  return { ...c, module: cloneAo(c.module), restoreParameters: [...c.restoreParameters] }
}
export function withProjectMembership(c: AoConfiguration, runtime: AnalogOutputModule): AoConfiguration {
  const configuration = cloneConfiguration(c)
  configuration.module.area = runtime.area
  configuration.module.equipmentModule = runtime.equipmentModule
  configuration.module.primaryDisplay = runtime.primaryDisplay
  configuration.module.detailDisplay = runtime.detailDisplay
  return configuration
}
export function lifecycleDirty(record: AoLifecycle): boolean {
  return !record.saved || JSON.stringify(record.draft) !== JSON.stringify(record.saved)
}
export function changedAoParameters(record: AoLifecycle | undefined, runtime: AnyModule | undefined): string[] {
  if (!record || runtime?.type !== 'AO') return []
  const draftParameters = record.draft.module.parameters
  return Object.keys(draftParameters).filter(name =>
    runtime.parameters[name] !== undefined && draftParameters[name].value !== runtime.parameters[name].value)
}
export function lifecycleModules(state: {
  modules: Record<string, AnyModule>; moduleLifecycle: Record<string, AoLifecycle>
}, rootTag?: string): Record<string, AnyModule> {
  if (rootTag && state.moduleLifecycle[rootTag]?.online) return state.modules
  const offline = Object.entries(state.moduleLifecycle).filter(([, r]) => !r.online)
  if (!offline.length) return state.modules
  return { ...state.modules, ...Object.fromEntries(offline.map(([tag, r]) => [tag, r.draft.module])) }
}
export function configurationError(c: AoConfiguration): string | null {
  const m = c.module
  return aoConfigurationError(m) ??
    (!Number.isInteger(m.decimals) || m.decimals < 0 || m.decimals > 100 ? 'Display precision must be an integer from 0 to 100' :
      !['CAS', 'AUTO', 'MAN', 'OOS'].includes(m.mode) ? 'Invalid configured AO mode' :
      !Number.isFinite(m.sp) || m.sp < m.spLow || m.sp > m.spHigh ? 'Configured SP is outside SP limits' :
      !Number.isFinite(m.manualOutput) || m.manualOutput < 0 || m.manualOutput > 100 ? 'Configured manual output must be 0-100%' :
      Object.values(m.parameters).some(p => p.type !== 'FLOAT' || !Number.isFinite(p.value)) ? 'Input defaults must be finite Floating Point values' :
      m.casParameter && !m.parameters[m.casParameter] ? 'CAS_IN references a missing input parameter' :
      !['CONFIGURED', 'CRITICAL', 'ALL'].includes(c.downloadBehavior) ? 'Invalid partial download behavior' :
      c.restoreParameters.some(name => !['AO1/MODE', 'AO1/SP', 'AO1/OUT'].includes(name) &&
        !m.parameters[name]) ? 'Restart restoration references a missing parameter' : null)
}
export function downloadError(c: AoConfiguration, hw: HardwareState): string | null {
  const controller = hw.controllers[c.controllerTag]
  const target = findDst(hw, c.outputDst)
  return configurationError(c) ??
    (!controller || !controller.commissioned || controllerIsDown(controller) ? 'Assign a commissioned, available controller before downloading' :
      !c.outputDst ? 'Select an AO output DST before downloading' :
      !target || target.card.controllerTag !== c.controllerTag ? 'Output DST must belong to the assigned controller' :
      c.module.mode === 'CAS' && !c.module.casParameter ? 'Connect CAS_IN before downloading configured CAS mode' :
      analogBindingError(hw, c.module, 'output', c.outputDst))
}
export function aoOperatorError(m: AnalogOutputModule, hw: HardwareState): string | null {
  if (m.downloaded === undefined) return null
  if (!m.downloaded) return 'Download before online operator writes'
  const controller = m.controllerTag ? hw.controllers[m.controllerTag] : undefined
  return !controller || controllerIsDown(controller) ? 'Online writes require an available assigned controller' : null
}
export function memoryOf(m: AnalogOutputModule): AoMemory {
  return { mode: m.mode, sp: m.sp, out: m.mode === 'MAN' ? m.manualOutput : m.out,
    parameters: Object.fromEntries(Object.entries(m.parameters).map(([name, p]) => [name, p.value])) }
}
export function capturedAoDownload(configuration: AoConfiguration, applied: AnalogOutputModule): AoConfiguration {
  const snapshot = cloneConfiguration(configuration)
  snapshot.module.mode = applied.mode
  snapshot.module.sp = applied.sp
  snapshot.module.manualOutput = applied.manualOutput
  snapshot.module.parameters = cloneAo(applied).parameters
  return snapshot
}
export function deployedAo(c: AoConfiguration, runtime: AnalogOutputModule, behavior: DownloadBehavior,
  hw: HardwareState): AnalogOutputModule {
  const m = withProjectMembership(c, runtime).module
  if (behavior !== 'CONFIGURED') {
    m.mode = runtime.mode
    m.sp = Math.max(m.spLow, Math.min(m.spHigh, runtime.sp))
    m.manualOutput = runtime.manualOutput
  }
  if (behavior === 'ALL') {
    for (const [name, p] of Object.entries(m.parameters)) {
      if (runtime.parameters[name]?.type === p.type) p.value = runtime.parameters[name].value
    }
  }
  const target = findDst(hw, c.outputDst)
  m.out = target && Number.isFinite(target.channel.value) ? target.channel.value : runtime.out
  m.pv = aoEngineeringValue(m, m.out)
  m.bad = true
  m.actualMode = 'OOS'
  m.controllerTag = c.controllerTag
  m.downloaded = true
  return m
}
export function prepareAoTransfer(record: AoLifecycle | undefined, runtime: AnyModule | undefined,
  hardware: HardwareState, scope: 'FULL' | 'PARTIAL', expected?: AoConfiguration):
  { error: string } | { saved: AoConfiguration; module: AnalogOutputModule; behavior: DownloadBehavior } {
  if (expected && record?.saved !== expected) return { error: 'Saved AO configuration changed after verification; verify again' }
  if (!record?.saved || runtime?.type !== 'AO' || lifecycleDirty(record)) {
    return { error: 'Save a valid offline draft before downloading' }
  }
  if (!['FULL', 'PARTIAL'].includes(scope) || scope === 'PARTIAL' && (!record.deployed || !runtime.downloaded)) {
    return { error: 'First download must be Full; subsequent scope must be Full or Partial' }
  }
  if (scope === 'PARTIAL' && record.replayFullRequired) {
    return { error: 'Perform a fresh Full module download after controller recommissioning' }
  }
  const error = downloadError(record.saved, hardware)
  if (error) return { error: `Download failed; last-good runtime retained: ${error}` }
  const saved = record.saved
  const behavior = scope === 'FULL' ? 'CONFIGURED' : saved.downloadBehavior
  const module = deployedAo(saved, runtime, behavior, hardware)
  const transferError = configurationError({ ...saved, module })
  return transferError ? { error: `Preserved runtime values are invalid: ${transferError}` } :
    { saved, module, behavior }
}
export function controllerAoRecords(records: Record<string, AoLifecycle>, controllerTag: string): [string, AoLifecycle][] {
  return Object.entries(records).filter(([, record]) =>
    record.saved?.controllerTag === controllerTag || record.draft.controllerTag === controllerTag)
}
export function controllerDeployedAoRecords(records: Record<string, AoLifecycle>, controllerTag: string): [string, AoLifecycle][] {
  return Object.entries(records).filter(([, record]) => record.deployed?.controllerTag === controllerTag)
}
export function prepareAoReplay(record: AoLifecycle | undefined, runtime: AnyModule | undefined,
  hardware: HardwareState): { error: string } | { snapshot: AoConfiguration; module: AnalogOutputModule } {
  if (!record?.lastGoodDownload || record.replayFullRequired || runtime?.type !== 'AO') {
    return { error: 'Perform a fresh Full AO module download before re-sending a last-good snapshot' }
  }
  const snapshot = record.lastGoodDownload
  const error = downloadError(snapshot, hardware)
  return error ? { error: `Last-good module replay failed; runtime unchanged: ${error}` } :
    { snapshot, module: deployedAo(snapshot, runtime, 'CONFIGURED', hardware) }
}
export function committedAoTransfer(record: AoLifecycle, saved: AoConfiguration,
  module: AnalogOutputModule, scope: 'FULL' | 'PARTIAL'): AoLifecycle {
  return { ...record, deployed: cloneConfiguration(saved), deployedRevision: record.savedRevision,
    lastGoodDownload: capturedAoDownload(saved, module), replayFullRequired: false,
    ...(record.restartDownload ? scope === 'FULL' ?
      { restartDownload: capturedAoDownload(saved, module), restartMemoryRequired: false } :
      { restartMemoryRequired: true } : {}),
    nvm: memoryOf(module) }
}
export function restartAo(record: AoLifecycle, runtime: AnalogOutputModule, hw: HardwareState): AnalogOutputModule {
  if (!record.deployed || record.replayFullRequired || record.restartMemoryRequired) return { ...runtime, downloaded: false, bad: true, actualMode: 'OOS' }
  const c = record.restartDownload ?? record.deployed
  const m = deployedAo(c, runtime, 'CONFIGURED', hw)
  if (c.restoreModule && record.nvm) {
    const memory = record.nvm
    for (const name of c.restoreParameters) {
      if (name === 'AO1/MODE') m.mode = memory.mode
      else if (name === 'AO1/SP') m.sp = Math.max(m.spLow, Math.min(m.spHigh, memory.sp))
      else if (name === 'AO1/OUT') m.manualOutput = memory.out
      else if (m.parameters[name] && Number.isFinite(memory.parameters[name])) {
        m.parameters[name].value = memory.parameters[name]
      }
    }
  }
  return m
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isAlarm(value: unknown): value is AlarmLimit {
  return object(value) && typeof value.type === 'string' &&
    ['HI_HI', 'HI', 'LO', 'LO_LO', 'DV_HI', 'DV_LO', 'PVBAD', 'FAIL', 'INTERLOCK'].includes(value.type) &&
    typeof value.label === 'string' && typeof value.priority === 'string' &&
    ['CRITICAL', 'WARNING', 'ADVISORY'].includes(value.priority) && typeof value.enabled === 'boolean' &&
    (value.limit === undefined || typeof value.limit === 'number' && Number.isFinite(value.limit)) &&
    (value.rank === undefined ||
      typeof value.rank === 'number' && Number.isInteger(value.rank) && value.rank >= 4 && value.rank <= 15)
}
function isConfiguration(value: unknown): value is AoConfiguration {
  if (!object(value) || !object(value.module)) return false
  const m = value.module
  return m.type === 'AO' && typeof m.tag === 'string' && moduleNameError(m.tag) === null &&
    typeof m.description === 'string' && typeof m.area === 'string' &&
    typeof m.unit === 'string' &&
    ['pvMin', 'pvMax', 'decimals', 'spLow', 'spHigh', 'sp', 'pv', 'out', 'manualOutput'].every(k =>
      typeof m[k] === 'number' && Number.isFinite(m[k])) &&
    typeof m.mode === 'string' && ['CAS', 'AUTO', 'MAN', 'OOS'].includes(m.mode) &&
    typeof m.actualMode === 'string' && ['CAS', 'AUTO', 'MAN', 'OOS'].includes(m.actualMode) &&
    typeof m.bad === 'boolean' && typeof m.limited === 'boolean' &&
    (m.casParameter === undefined || typeof m.casParameter === 'string') &&
    (m.equipmentModule === undefined || typeof m.equipmentModule === 'string') &&
    [m.primaryDisplay, m.detailDisplay].every(v => v === undefined || typeof v === 'string') &&
    m.downloaded === undefined && m.controllerTag === undefined &&
    Array.isArray(m.alarms) && m.alarms.every(isAlarm) &&
    object(m.parameters) && Object.entries(m.parameters).every(([name, p]) =>
      moduleNameError(name) === null && object(p) && p.type === 'FLOAT' &&
      typeof p.value === 'number' && Number.isFinite(p.value)) &&
    typeof value.controllerTag === 'string' && typeof value.outputDst === 'string' &&
    typeof value.restoreModule === 'boolean' && Array.isArray(value.restoreParameters) &&
    value.restoreParameters.every(name => typeof name === 'string') &&
    typeof value.downloadBehavior === 'string' && ['CONFIGURED', 'CRITICAL', 'ALL'].includes(value.downloadBehavior)
}
export function savedAoStorageKey(tag: string): string {
  return `batchlive.saved-ao.v1.${tag}`
}
export function serializeSavedAo(configuration: AoConfiguration): string {
  const error = configurationError(configuration)
  if (error) throw new Error(error)
  return JSON.stringify({ version: 1, configuration })
}
export function parseSavedAo(text: string, tag: string): AoConfiguration {
  const data: unknown = JSON.parse(text)
  if (!object(data) || data.version !== 1 || !isConfiguration(data.configuration) ||
      data.configuration.module.tag !== tag) throw new Error('Saved AO configuration has an invalid schema, version or tag')
  const error = configurationError(data.configuration)
  if (error) throw new Error(error)
  return cloneConfiguration(data.configuration)
}
