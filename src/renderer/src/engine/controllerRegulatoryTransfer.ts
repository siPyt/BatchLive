import type { AnyModule } from './types'
import type { HardwareState } from './hardware'
import { controllerIsDown } from './hardware'
import { committedAoTransfer, controllerAoRecords, prepareAoTransfer,
  type AoConfiguration, type AoLifecycle } from './moduleLifecycle'
import { deployedPid, clonePidConfiguration, pidDownloadError, pidLifecycleDirty,
  type PidConfiguration, type PidLifecycle } from './pidLifecycle'

interface RegulatoryState {
  modules: Record<string, AnyModule>
  hardware: HardwareState
  moduleLifecycle: Record<string, AoLifecycle>
  pidLifecycle: Record<string, PidLifecycle>
}

export type RegulatorySelection =
  | { kind: 'AO'; tag: string; record: AoLifecycle }
  | { kind: 'PID_LOOP'; tag: string; record: PidLifecycle }

export type RegulatoryReview = Record<string, AoConfiguration | PidConfiguration | undefined>

export function controllerRegulatoryRecords(state: RegulatoryState, controllerTag: string): RegulatorySelection[] {
  return [
    ...controllerAoRecords(state.moduleLifecycle, controllerTag).map(([tag, record]): RegulatorySelection =>
      ({ kind: 'AO', tag, record })),
    ...Object.entries(state.pidLifecycle)
      .filter(([, record]) => record.saved?.controllerTag === controllerTag || record.draft.controllerTag === controllerTag)
      .map(([tag, record]): RegulatorySelection => ({ kind: 'PID_LOOP', tag, record }))
  ]
}

export function prepareControllerRegulatoryTransfer(state: RegulatoryState, controllerTag: string,
  expected?: RegulatoryReview): { error: string } | { patch: RegulatoryState; tags: string[] } {
  const controller = state.hardware.controllers[controllerTag]
  if (!controller || !controller.commissioned || controllerIsDown(controller)) {
    return { error: 'Managed regulatory transfer requires a commissioned available controller' }
  }
  const records = controllerRegulatoryRecords(state, controllerTag)
  if (!records.length) return { error: 'No configured managed AO/PID_LOOP modules belong to this controller' }
  if (expected && (Object.keys(expected).length !== records.length ||
    records.some(({ tag, record }) => !(tag in expected) || expected[tag] !== record.saved))) {
    return { error: 'Managed regulatory scope or saved configuration changed after confirmation opened; no modules transferred' }
  }
  const modules = { ...state.modules }
  const moduleLifecycle = { ...state.moduleLifecycle }
  const pidLifecycle = { ...state.pidLifecycle }
  const analogBindings = { ...state.hardware.analogBindings }
  for (const selection of records) {
    const { tag, record } = selection
    const runtime = state.modules[tag]
    if (selection.kind === 'AO') {
      const prepared = prepareAoTransfer(selection.record, runtime, state.hardware, 'FULL')
      if ('error' in prepared) return { error: `${tag}: ${prepared.error}; no modules transferred` }
      modules[tag] = prepared.module
      moduleLifecycle[tag] = committedAoTransfer(selection.record, prepared.saved, prepared.module, 'FULL')
      analogBindings[tag] = { output: prepared.saved.outputDst }
    } else {
      if (!selection.record.saved || selection.record.online || runtime?.type !== 'PID' ||
        pidLifecycleDirty(selection.record)) {
        return { error: `${tag}: Save a valid offline PID_LOOP draft before downloading; no modules transferred` }
      }
      const saved = selection.record.saved
      const error = pidDownloadError(saved, state.hardware)
      if (error) return { error: `${tag}: ${error}; no modules transferred` }
      modules[tag] = deployedPid(saved, runtime)
      pidLifecycle[tag] = { ...selection.record, deployed: clonePidConfiguration(saved),
        deployedRevision: record.savedRevision }
      analogBindings[tag] = { input: saved.inputDst, output: saved.outputDst }
    }
  }
  return { patch: { modules, moduleLifecycle, pidLifecycle,
    hardware: { ...state.hardware, analogBindings } }, tags: records.map(({ tag }) => tag) }
}
