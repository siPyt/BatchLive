import { controllerIsDown, type HardwareState } from './hardware'
import { isValidDeltaVTag } from './naming'
import type { AnyModule } from './types'

export type TraditionalCardType = 'AI' | 'AO' | 'DI' | 'DO'

export interface TraditionalChannel {
  channel: number
  dst: string
  enabled: boolean
  value: number
  bad: boolean
  tiebackDst?: string
}

export interface TraditionalCard {
  id: string
  controllerTag: string
  slot: number
  type: TraditionalCardType
  channels: TraditionalChannel[]
}

export function makeTraditionalCard(controllerTag: string, slot: number, type: TraditionalCardType): TraditionalCard {
  return {
    id: `${controllerTag}/C${String(slot).padStart(2, '0')}`, controllerTag, slot, type,
    channels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1, dst: '', enabled: false, value: 0, bad: true
    }))
  }
}

export function traditionalChannels(hw: HardwareState): {
  card: TraditionalCard; channel: TraditionalChannel
}[] {
  return Object.values(hw.traditionalCards ?? {}).flatMap(card =>
    card.channels.map(channel => ({ card, channel })))
}

export function findDst(hw: HardwareState, dst: string) {
  if (!dst) return undefined
  return traditionalChannels(hw).find(item => item.channel.dst === dst)
}

export function channelConfigurationError(
  hw: HardwareState, cardId: string, channelNumber: number,
  patch: { dst: string; enabled: boolean; tiebackDst?: string }
): string | null {
  const card = hw.traditionalCards?.[cardId]
  const channel = card?.channels.find(item => item.channel === channelNumber)
  if (!card || !channel) return 'Traditional card/channel does not exist'
  if (patch.dst && !isValidDeltaVTag(patch.dst)) return 'DST must use 1-16 characters with a letter and only letters, digits, $, - or _'
  if (patch.enabled && !patch.dst) return 'An enabled channel requires a DST'
  if (patch.dst && traditionalChannels(hw).some(item =>
    item.channel.dst === patch.dst && item.channel !== channel)) return `DST ${patch.dst} already exists`
  if (patch.dst !== channel.dst && channel.dst) {
    const referenced = traditionalChannels(hw).some(item => item.channel.tiebackDst === channel.dst) ||
      Object.values(hw.discreteBindings ?? {}).some(dst => dst === channel.dst)
    if (referenced) return `DST ${channel.dst} is in use; disconnect its module bindings and tiebacks before renaming`
  }
  if (patch.tiebackDst) {
    const source = findDst(hw, patch.tiebackDst)
    if (card.type !== 'DI') return 'Only DI channels support a simulated tieback in this training model'
    if (!source || source.card.type !== 'DO') {
      return 'Tieback source must be a named DO channel'
    }
  }
  return null
}

export function discreteBindingError(hw: HardwareState, module: AnyModule | undefined, dst: string): string | null {
  if (!module || (module.type !== 'DI' && module.type !== 'DO')) return 'Traditional discrete binding requires a DI or DO module'
  if (!dst) return null
  const target = findDst(hw, dst)
  if (!target || target.card.type !== module.type) return `Select a named ${module.type} channel`
  if (module.type === 'DO' && Object.entries(hw.discreteBindings ?? {}).some(([tag, bound]) =>
    tag !== module.tag && bound === dst)) return `Output DST ${dst} already has a writer`
  if (Object.values(hw.baseplates).some(plate => plate.channels.some(channel => channel.boundTag === module.tag))) {
    return `${module.tag} already has a CHARM binding; use an unbound training module`
  }
  return null
}

export function channelBad(hw: HardwareState, card: TraditionalCard, channel: TraditionalChannel): boolean {
  const controller = hw.controllers[card.controllerTag]
  return !controller || controllerIsDown(controller) || !channel.enabled || !channel.dst
}

/** Read inputs from the preceding hardware scan; write outputs after module execution. */
export function sampleDiscreteInputs(hw: HardwareState, modules: Record<string, AnyModule>): void {
  for (const module of Object.values(modules)) {
    if (module.type === 'DI' || module.type === 'DO') module.ioBad = module.mode === 'OOS'
  }
  for (const [tag, dst] of Object.entries(hw.discreteBindings ?? {})) {
    const module = modules[tag]
    if (!module || (module.type !== 'DI' && module.type !== 'DO')) continue
    const target = findDst(hw, dst)
    module.ioBad = !target || target.card.type !== module.type ||
      channelBad(hw, target.card, target.channel) || target.channel.bad || module.mode === 'OOS'
    if (module.type === 'DI' && !module.ioBad && target) module.state = target.channel.value !== 0
  }
}

export function advanceTraditionalIo(hw: HardwareState, modules: Record<string, AnyModule>): HardwareState {
  if (!hw.traditionalCards) return hw
  const cards = Object.fromEntries(Object.entries(hw.traditionalCards).map(([id, card]) => [id, {
    ...card, channels: card.channels.map(channel => ({ ...channel, bad: channelBad(hw, card, channel) }))
  }]))
  const next: HardwareState = { ...hw, traditionalCards: cards }
  const writers = new Map<string, string>()
  for (const [tag, dst] of Object.entries(hw.discreteBindings ?? {})) {
    if (modules[tag]?.type === 'DO') writers.set(dst, tag)
  }
  for (const card of Object.values(cards)) {
    if (card.type !== 'DO') continue
    for (const channel of card.channels) {
      const tag = writers.get(channel.dst)
      const module = tag ? modules[tag] : undefined
      if (module?.type !== 'DO') continue
      channel.bad ||= module.mode === 'OOS'
      module.ioBad = channel.bad
      if (!channel.bad) channel.value = module.commanded ? 1 : 0
      module.state = channel.value !== 0
    }
  }
  for (const card of Object.values(cards)) {
    if (card.type !== 'DI') continue
    for (const channel of card.channels) {
      if (!channel.tiebackDst) continue
      const source = findDst(next, channel.tiebackDst)
      channel.bad ||= !source || source.card.type !== 'DO' || source.channel.bad
      if (!channel.bad && source) channel.value = source.channel.value
    }
  }
  return next
}
