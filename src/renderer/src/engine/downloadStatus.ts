import { controllerIsDown, type HardwareState } from './hardware'
import type { AoLifecycle } from './moduleLifecycle'
import type { PidLifecycle } from './pidLifecycle'
import type { DeviceLifecycle } from './deviceLifecycle'
import type { SfcLifecycle } from './sfcLifecycle'

export type DownloadStatus = 'UNSUPPORTED' | 'NO_CONFIGURATION' | 'UNKNOWN' | 'DIFFERENT' | 'MATCH'
export interface DownloadStatusCheck { signature: string }
export interface DownloadStatusState {
  hardware: HardwareState
  moduleLifecycle: Record<string, AoLifecycle>
  pidLifecycle: Record<string, PidLifecycle>
  deviceLifecycle: Record<string, DeviceLifecycle>
  sfcLifecycle: Record<string, SfcLifecycle>
  downloadStatusChecks: Record<string, DownloadStatusCheck>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

export function compareModuleDownload(state: DownloadStatusState, tag: string):
  { status: DownloadStatus; message: string; signature: string; error?: string } {
  const record = state.moduleLifecycle[tag] ?? state.pidLifecycle[tag] ??
    state.deviceLifecycle[tag] ?? state.sfcLifecycle[tag]
  if (!record) return {
    status: 'UNSUPPORTED', message: 'Download comparison is not modeled for this live/unmanaged module', signature: ''
  }
  const signature = JSON.stringify(canonical([record.saved, record.deployed]))
  if ('replayFullRequired' in record && record.replayFullRequired) return {
    status: 'NO_CONFIGURATION', message: 'Controller recommissioning requires a fresh Full AO module download', signature
  }
  if (!record.deployed) return {
    status: 'NO_CONFIGURATION', message: 'No deployed configuration for this managed module', signature
  }
  const controller = state.hardware.controllers[record.deployed.controllerTag]
  if (!controller || controllerIsDown(controller)) {
    const error = 'Update Download Status requires an available deployed controller'
    return { status: 'UNKNOWN', message: error, signature, error }
  }
  if (!record.saved) {
    const error = 'Saved module configuration is unavailable; comparison cannot be completed'
    return { status: 'UNKNOWN', message: error, signature, error }
  }
  const equal = JSON.stringify(canonical(record.saved)) === JSON.stringify(canonical(record.deployed))
  return { status: equal ? 'MATCH' : 'DIFFERENT', message: equal ?
    'Saved and deployed module configuration match; no download required' :
    'Saved module configuration differs from deployment; module download required', signature }
}

export function moduleDownloadStatus(state: DownloadStatusState, tag: string):
  ReturnType<typeof compareModuleDownload> {
  const comparison = compareModuleDownload(state, tag)
  if (comparison.status === 'DIFFERENT' && state.downloadStatusChecks[tag]?.signature !== comparison.signature) {
    return { ...comparison, status: 'UNKNOWN',
      message: 'Saved configuration changed; Update Download Status to compare this module with deployment' }
  }
  return comparison
}
