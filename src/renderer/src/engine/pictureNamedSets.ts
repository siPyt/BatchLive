import type { PicElement } from './pictureStore'
import type { SfcLifecycle } from './sfcLifecycle'
import type { SfcDef } from './sfc'
import type { HardwareState } from './hardware'
import { controllerIsDown } from './hardware'
import { controllerNamedSets } from './sfcParameters'
import { namedSetChoices, type NamedSetState, type NamedSetEntry } from './namedSets'

export interface PictureNamedContext {
  sfcs: Record<string, SfcDef>
  sfcLifecycle: Record<string, SfcLifecycle>
  namedSets: NamedSetState
  hardware: HardwareState
}

export function pictureNamedSignal(el: PicElement, state: PictureNamedContext, configured = false):
  { value: number; text: string; parameter: string; namedSet: string; choices: NamedSetEntry[]; bad: boolean } | { error: string } {
  const name = el.tag ?? ''
  const parameter = (el.path ?? '').trim().replace(/\.CV$/i, '').toUpperCase()
  const lifecycle = state.sfcLifecycle[name]
  const parameters = configured ? lifecycle?.draft.parameters : state.sfcs[name]?.parameters
  const binding = parameters && Object.hasOwn(parameters, parameter) ? parameters[parameter] : undefined
  if (!binding || binding.type !== 'NAMED_SET' || !lifecycle) return { error: `Named Set parameter ${name}/${parameter} does not exist` }
  const sets = configured ? state.namedSets.configured : state.namedSets.deployed.WORKSTATION ?? {}
  const definition = Object.hasOwn(sets, binding.namedSet) ? sets[binding.namedSet] : undefined
  if (!definition) return { error: `${binding.namedSet} is not ${configured ? 'configured' : 'downloaded to this workstation'}` }
  const entry = definition.entries.find(item => item.value === binding.value)
  const controller = lifecycle.deployed ? state.hardware.controllers[lifecycle.deployed.controllerTag] : undefined
  const target = lifecycle.deployed ? controllerNamedSets(state.namedSets, lifecycle.deployed.controllerTag)[binding.namedSet] : undefined
  const targetEntry = target?.entries.find(item => item.value === binding.value)
  const bad = !configured && (!controller || controllerIsDown(controller) || !targetEntry ||
    !entry || targetEntry.name !== entry.name)
  const choices = configured ? namedSetChoices(definition) : namedSetChoices(definition).filter(item =>
    target?.entries.some(candidate => candidate.name === item.name && candidate.value === item.value &&
      candidate.visible && candidate.userSelectable))
  return { value: binding.value, text: entry?.visible ? entry.name : String(binding.value),
    parameter, namedSet: binding.namedSet, choices, bad }
}
