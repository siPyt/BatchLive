import { controllerIsDown, type HardwareState } from './hardware'
import { isValidDeltaVTag } from './naming'
import type { AnyModule } from './types'
import { pidIo, samplePidInput } from './analogStrategy'
import { aoEngineeringValue } from './standaloneAo'
import { serialDatasetStatus, stepSerialCards, type SerialPortId } from './serialIo'
import { fieldbusChannelBad, stepH1Cards, type H1PortId } from './fieldbus'

export type AnalogBindingPort = 'input' | 'output' | 'output2'
export type AnalogDstBindings = Partial<Record<AnalogBindingPort, string>>
export type DeviceBindingPort = 'input' | 'output'
export type DeviceDstBindings = Partial<Record<DeviceBindingPort, string>>

export type TraditionalCardType = 'AI' | 'AO' | 'DI' | 'DO'

export interface TraditionalChannel {
  channel: number
  dst: string
  enabled: boolean
  value: number
  bad: boolean
  tiebackDst?: string
  configuredFilterSeconds?: number
  filterSeconds?: number
  filteredValue?: number
}

export interface TraditionalCard {
  id: string
  controllerTag: string
  slot: number
  type: TraditionalCardType
  channels: TraditionalChannel[]
  /** DV09-086..093: a hidden card exposing one serial dataset as DSTs; not user-editable. */
  serial?: { cardId: string; port: SerialPortId; device: string; dataset: string }
  /** DV09-096..127: a hidden card exposing one commissioned fieldbus function block as a DST. */
  fieldbus?: { cardId: string; port: H1PortId; device: string; block: string }
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
      Object.values(hw.discreteBindings ?? {}).some(dst => dst === channel.dst) ||
      Object.values(hw.deviceBindings ?? {}).some(bindings => Object.values(bindings).includes(channel.dst)) ||
      Object.values(hw.analogBindings ?? {}).some(bindings => Object.values(bindings).includes(channel.dst))
    if (referenced) return `DST ${channel.dst} is in use; disconnect its module bindings and tiebacks before renaming`
  }
  if (patch.tiebackDst) {
    const source = findDst(hw, patch.tiebackDst)
    if (card.type !== 'DI' && card.type !== 'AI') return 'Only input channels support a simulated tieback'
    const type = card.type === 'DI' ? 'DO' : 'AO'
    if (!source || source.card.type !== type) {
      return `Tieback source must be a named ${type} channel`
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
  if (module.type === 'DO' && Object.values(hw.deviceBindings ?? {}).some(bindings =>
    bindings.output === dst)) return `Output DST ${dst} already has a device writer`
  if (Object.values(hw.baseplates).some(plate => plate.channels.some(channel => channel.boundTag === module.tag))) {
    return `${module.tag} already has a CHARM binding; use an unbound training module`
  }
  return null
}

export function channelBad(hw: HardwareState, card: TraditionalCard, channel: TraditionalChannel): boolean {
  const controller = hw.controllers[card.controllerTag]
  if (card.serial && serialDatasetStatus(hw, card) === 'BAD') return true
  if (card.fieldbus && fieldbusChannelBad(hw, card)) return true
  return !controller || controllerIsDown(controller) || !channel.enabled || !channel.dst ||
    !Number.isFinite(channel.value) || (card.type === 'AI' &&
      (!Number.isFinite(channel.filterSeconds ?? 0) || (channel.filterSeconds ?? 0) < 0 ||
        ((channel.filterSeconds ?? 0) > 0 && !Number.isFinite(channel.filteredValue))))
}

export function deviceBindingError(hw: HardwareState, module: AnyModule | undefined,
  port: DeviceBindingPort, dst: string): string | null {
  if (!module || module.type !== 'MOTOR' && module.type !== 'VALVE') return 'Device I/O requires a motor or valve'
  if (port !== 'input' && port !== 'output') return 'Unknown device I/O port'
  if (!dst) return null
  const type = port === 'input' ? 'DI' : 'DO'
  if (findDst(hw, dst)?.card.type !== type) return `Select a named ${type} device channel`
  if (port === 'output' && (Object.values(hw.discreteBindings ?? {}).includes(dst) ||
    Object.entries(hw.deviceBindings ?? {}).some(([tag, binding]) => tag !== module.tag && binding.output === dst))) {
    return `Output DST ${dst} already has a writer`
  }
  if (Object.values(hw.baseplates).some(plate => plate.channels.some(channel => channel.boundTag === module.tag))) {
    return `${module.tag} already has a CHARM binding; use an unbound training module`
  }
  return null
}

export function deviceChannelSignal(hw: HardwareState, dst: string | undefined,
  type: 'DI' | 'DO'): { value: boolean; bad: boolean } {
  const target = dst ? findDst(hw, dst) : undefined
  return { value: !!target && target.channel.value !== 0,
    bad: !target || target.card.type !== type || channelBad(hw, target.card, target.channel) || target.channel.bad }
}

export function analogBindingError(
  hw: HardwareState, module: AnyModule | undefined, port: AnalogBindingPort, dst: string
): string | null {
  if (!module || (module.type !== 'AI' && module.type !== 'PID' && module.type !== 'AO')) return 'Analog DST binding requires an AI, AO or PID module'
  if (!['input', 'output', 'output2'].includes(port)) return 'Unknown analog I/O port'
  if (module.type === 'AI' && port !== 'input') return 'AI modules support IO_IN only'
  if (module.type === 'AO' && port !== 'output') return 'Standalone AO modules support IO_OUT only'
  if (!dst) return null
  if (module.type === 'PID' && port === 'output2' && !pidIo(module).ao2) return 'Enable AO2 before binding its output'
  const type = port === 'input' ? 'AI' : 'AO'
  const target = findDst(hw, dst)
  if (!target || target.card.type !== type) return `Select a named ${type} channel`
  if (port !== 'input' && Object.entries(hw.analogBindings ?? {}).some(([tag, bindings]) =>
    (['output', 'output2'] as const).some(other => bindings[other] === dst &&
      (tag !== module.tag || other !== port)))) return `Output DST ${dst} already has a writer`
  if (Object.values(hw.baseplates).some(plate => plate.channels.some(channel => channel.boundTag === module.tag))) {
    return `${module.tag} already has a CHARM binding; use an unbound training module`
  }
  return null
}

export function analogChannelBad(hw: HardwareState, dst: string, type: 'AI' | 'AO'): boolean {
  const target = findDst(hw, dst)
  return !target || target.card.type !== type || channelBad(hw, target.card, target.channel) ||
    (type === 'AI' && target.channel.bad)
}

export function sampleAnalogInputs(hw: HardwareState, modules: Record<string, AnyModule>): void {
  for (const [tag, bindings] of Object.entries(hw.analogBindings ?? {})) {
    const module = modules[tag]
    if (!bindings.input || !module || (module.type !== 'AI' && module.type !== 'PID')) continue
    const target = findDst(hw, bindings.input)
    const bad = analogChannelBad(hw, bindings.input, 'AI')
    const signal = (target?.channel.filterSeconds ?? 0) > 0 ? target?.channel.filteredValue : target?.channel.value
    const raw = signal !== undefined && target?.channel.tiebackDst
      ? module.pvMin + signal / 100 * (module.pvMax - module.pvMin) : signal
    if (module.type === 'PID') samplePidInput(module, raw ?? pidIo(module).ai.raw, bad)
    else {
      module.pvBad = bad
      if (!bad && raw !== undefined) module.pv = Math.max(module.pvMin, Math.min(module.pvMax, raw))
    }
  }
}

/** AO stages start from hardware readback so failure cannot hold a fictitious output. */
export function sampleAnalogOutputs(hw: HardwareState, modules: Record<string, AnyModule>): void {
  for (const [tag, bindings] of Object.entries(hw.analogBindings ?? {})) {
    const module = modules[tag]
    if (module?.type === 'AO') {
      const target = bindings.output ? findDst(hw, bindings.output) : undefined
      if (target?.card.type === 'AO' && Number.isFinite(target.channel.value)) {
        module.out = target.channel.value
        module.pv = aoEngineeringValue(module, module.out)
      }
      continue
    }
    if (module?.type !== 'PID') continue
    for (const port of ['output', 'output2'] as const) {
      const dst = bindings[port]
      if (!dst) continue
      const stage = port === 'output' ? pidIo(module).ao : pidIo(module).ao2
      const target = findDst(hw, dst)
      if (stage && target?.card.type === 'AO' && Number.isFinite(target.channel.value)) {
        stage.out = target.channel.value
      }
    }
  }
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

export function advanceTraditionalIo(hw: HardwareState, modules: Record<string, AnyModule>, dt = 0): HardwareState {
  if (!hw.traditionalCards) return hw
  const cards = Object.fromEntries(Object.entries(hw.traditionalCards).map(([id, card]) => [id, {
    ...card, channels: card.channels.map(channel => ({ ...channel, bad: channelBad(hw, card, channel) }))
  }]))
  const next: HardwareState = { ...hw, traditionalCards: cards }
  for (const [tag, bindings] of Object.entries(hw.deviceBindings ?? {})) {
    const module = modules[tag]
    if (!module || module.type !== 'MOTOR' && module.type !== 'VALVE') continue
    const target = bindings.output ? findDst(next, bindings.output) : undefined
    if (!target || target.card.type !== 'DO') {
      module.ioOutputBad = true
      continue
    }
    module.ioOutputBad = target.channel.bad || module.downloaded === false
    if (!module.ioOutputBad) target.channel.value = Number(!!module.outputCommand)
    module.appliedCommand = target.channel.value !== 0
  }
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
  for (const [tag, bindings] of Object.entries(hw.analogBindings ?? {})) {
    const module = modules[tag]
    if (module?.type === 'AO') {
      const target = bindings.output ? findDst(next, bindings.output) : undefined
      if (!target || target.card.type !== 'AO') {
        module.bad = true
        module.actualMode = 'OOS'
        continue
      }
      target.channel.bad ||= module.bad || !Number.isFinite(module.out)
      if (!target.channel.bad) target.channel.value = module.out
      module.bad = target.channel.bad
      if (module.bad) module.actualMode = 'OOS'
      if (Number.isFinite(target.channel.value)) module.out = target.channel.value
      module.pv = aoEngineeringValue(module, module.out)
      continue
    }
    if (module?.type !== 'PID') continue
    for (const port of ['output', 'output2'] as const) {
      const dst = bindings[port]
      if (!dst) continue
      const target = findDst(next, dst)
      const stage = port === 'output' ? pidIo(module).ao : pidIo(module).ao2
      if (!target || target.card.type !== 'AO') {
        if (stage) stage.bad = true
        continue
      }
      target.channel.bad ||= !stage || stage.bad || !Number.isFinite(stage.out)
      if (stage && !target.channel.bad) target.channel.value = stage.out
      if (stage) {
        stage.bad = target.channel.bad
        if (Number.isFinite(target.channel.value)) stage.out = target.channel.value
      }
    }
  }
  const serial = stepSerialCards(next, dt)
  if (serial) next.serialCards = serial
  const h1 = stepH1Cards(next, dt)
  if (h1) next.h1Cards = h1
  for (const card of Object.values(cards)) {
    if (card.type !== 'DI' && card.type !== 'AI') continue
    for (const channel of card.channels) {
      if (!channel.tiebackDst) continue
      const source = findDst(next, channel.tiebackDst)
      channel.bad ||= !source || source.card.type !== (card.type === 'DI' ? 'DO' : 'AO') || source.channel.bad
      if (!channel.bad && source) channel.value = source.channel.value
    }
  }
  for (const card of Object.values(cards)) {
    if (card.type !== 'AI') continue
    for (const channel of card.channels) {
      if (channel.bad) continue
      const tau = channel.filterSeconds ?? 0
      if (tau === 0) channel.filteredValue = channel.value
      else if (Number.isFinite(dt) && dt > 0 && channel.filteredValue !== undefined) {
        const alpha = -Math.expm1(-dt / tau)
        channel.filteredValue = channel.filteredValue * (1 - alpha) + channel.value * alpha
      }
    }
  }
  return next
}
