import { controllerRegulatoryRecords, prepareControllerRegulatoryTransfer,
  type RegulatoryReview } from './controllerRegulatoryTransfer'
import { cloneDeviceConfiguration, prepareDeviceTransfer,
  type DeviceConfiguration, type DeviceLifecycle } from './deviceLifecycle'
import { prepareSfcTransfer, type SfcConfiguration, type SfcLifecycle } from './sfcLifecycle'
import type { NamedSetState } from './namedSets'
import type { SfcDef } from './sfc'
import { controllerIsDown } from './hardware'

type RegulatoryState = Parameters<typeof prepareControllerRegulatoryTransfer>[0]
interface ManagedState extends RegulatoryState {
  deviceLifecycle: Record<string, DeviceLifecycle>
  sfcLifecycle: Record<string, SfcLifecycle>
  sfcs: Record<string, SfcDef>
  namedSets: NamedSetState
  areas: string[]
  equipment: Record<string, { area: string }>
}
export type ManagedReview = Record<string, RegulatoryReview[string] | DeviceConfiguration | SfcConfiguration>

export function controllerManagedRecords(state: ManagedState, controllerTag: string):
  { tag: string; kind: string; saved: ManagedReview[string] }[] {
  return [
    ...controllerRegulatoryRecords(state, controllerTag).map(({ tag, kind, record }) =>
      ({ tag, kind, saved: record.saved })),
    ...Object.entries(state.deviceLifecycle)
      .filter(([, r]) => r.saved?.controllerTag === controllerTag || r.draft.controllerTag === controllerTag)
      .map(([tag, r]) => ({ tag, kind: r.draft.type, saved: r.saved })),
    ...Object.entries(state.sfcLifecycle)
      .filter(([, r]) => r.saved?.controllerTag === controllerTag || r.draft.controllerTag === controllerTag)
      .map(([tag, r]) => ({ tag, kind: 'SFC', saved: r.saved }))
  ]
}

export function prepareControllerModuleTransfer(state: ManagedState, controllerTag: string, expected?: ManagedReview) {
  const controller = state.hardware.controllers[controllerTag]
  if (!controller || !controller.commissioned || controllerIsDown(controller)) {
    return { error: 'Managed module transfer requires a commissioned available controller' }
  }
  const selections = controllerManagedRecords(state, controllerTag)
  if (!selections.length) return { error: 'No configured managed modules belong to this controller' }
  if (expected && (Object.keys(expected).length !== selections.length ||
    selections.some(({ tag, saved }) => !(tag in expected) || expected[tag] !== saved))) {
    return { error: 'Managed module scope or saved configuration changed during confirmation; no modules transferred' }
  }
  let patch: RegulatoryState = {
    modules: state.modules, hardware: state.hardware,
    moduleLifecycle: state.moduleLifecycle, pidLifecycle: state.pidLifecycle
  }
  if (controllerRegulatoryRecords(state, controllerTag).length) {
    const regulatory = prepareControllerRegulatoryTransfer(state, controllerTag)
    if ('error' in regulatory) return regulatory
    patch = regulatory.patch
  }
  const modules = { ...patch.modules }
  const deviceLifecycle = { ...state.deviceLifecycle }
  const sfcLifecycle = { ...state.sfcLifecycle }
  const sfcs = { ...state.sfcs }
  const deviceBindings = { ...state.hardware.deviceBindings }
  for (const { tag, kind } of selections) {
    if (kind === 'MOTOR' || kind === 'VALVE') {
      const record = state.deviceLifecycle[tag]
      const prepared = prepareDeviceTransfer(record, tag, state.modules, state.hardware, state.namedSets)
      if ('error' in prepared) return { error: `${tag}: ${prepared.error}; no modules transferred` }
      modules[tag] = prepared.module
      deviceLifecycle[tag] = { ...record, deployed: cloneDeviceConfiguration(prepared.configuration),
        deployedRevision: record.savedRevision, online: true }
      deviceBindings[tag] = { input: prepared.configuration.inputDst, output: prepared.configuration.outputDst }
    } else if (kind === 'SFC') {
      const record = state.sfcLifecycle[tag]
      const prepared = prepareSfcTransfer(record, state.sfcs[tag], state)
      if ('error' in prepared) return { error: `${tag}: ${prepared.error}; no modules transferred` }
      sfcLifecycle[tag] = { ...record, deployed: prepared.configuration }
      sfcs[tag] = prepared.runtime
    }
  }
  return { patch: { ...patch, modules, deviceLifecycle, sfcLifecycle, sfcs,
    hardware: { ...patch.hardware, deviceBindings } }, tags: selections.map(({ tag }) => tag) }
}
