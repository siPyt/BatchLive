import type { AnyModule } from './types'
import type { HardwareState } from './hardware'
import { analogBindingError, deviceBindingError, discreteBindingError, traditionalChannels, type TraditionalCardType } from './traditionalIo'

export const dstTypes = ['AI', 'AO', 'DI', 'DO'] as const
export interface DstUsageEntry {
  id: string
  signal: string
  type: TraditionalCardType
  controller: string
  enabled: boolean
  references: string[]
}
export interface DstUsageReport {
  entries: DstUsageEntry[]
  errors: string[]
  byType: Record<TraditionalCardType, { configured: number; referenced: number; enabledReferenced: number; unused: number }>
}

export function dstUsage(hw: HardwareState, modules: Record<string, AnyModule>): DstUsageReport {
  const entries = new Map<string, DstUsageEntry>()
  const byName = new Map<string, DstUsageEntry>()
  const errors: string[] = []
  for (const { card, channel } of traditionalChannels(hw)) {
    if (!channel.dst) continue
    const entry = { id: `${card.id}/CH${channel.channel}`, signal: channel.dst,
      type: card.type, controller: card.controllerTag, enabled: channel.enabled, references: [] }
    entries.set(entry.id, entry)
    if (!hw.controllers[card.controllerTag]) errors.push(`${entry.id}: assigned controller missing`)
    if (byName.has(channel.dst)) errors.push(`Duplicate hardware DST ${channel.dst}`)
    else byName.set(channel.dst, entry)
  }
  const bind = (tag: string, port: string, dst: string, error: string | null): void => {
    if (!dst) return
    const entry = byName.get(dst)
    if (error || !entry) { errors.push(`${tag}/${port} -> ${dst}: ${error ?? 'DST missing from hardware'}`); return }
    const reference = `${tag}/${port}`
    if (!entry.references.includes(reference)) entry.references.push(reference)
  }
  for (const [tag, dst] of Object.entries(hw.discreteBindings ?? {})) {
    bind(tag, modules[tag]?.type === 'DO' ? 'IO_OUT' : 'IO_IN', dst, discreteBindingError(hw, modules[tag], dst))
  }
  for (const [tag, bindings] of Object.entries(hw.analogBindings ?? {})) {
    for (const port of ['input', 'output', 'output2'] as const) {
      const dst = bindings[port]
      if (dst) bind(tag, port, dst, analogBindingError(hw, modules[tag], port, dst))
    }
  }
  for (const [tag, bindings] of Object.entries(hw.deviceBindings ?? {})) {
    for (const port of ['input', 'output'] as const) {
      const dst = bindings[port]
      if (dst) bind(tag, port, dst, deviceBindingError(hw, modules[tag], port, dst))
    }
  }
  for (const plate of Object.values(hw.baseplates)) {
    for (const channel of plate.channels) {
      if (!channel.type) {
        if (channel.boundTag) errors.push(`${plate.id}/CH${channel.slot}: bound CHARM has no installed type`)
        continue
      }
      const type = channel.type === 'AI_HART' || channel.type === 'RTD' || channel.type === 'TC' ? 'AI' : channel.type
      const controller = hw.carriers[plate.carrierId]?.controllerTag
      const entry: DstUsageEntry = { id: `${plate.id}/CH${channel.slot}`, signal: '(implicit CHARM signal)',
        type, controller: controller ?? '(missing carrier)', enabled: !channel.pulled, references: [] }
      entries.set(entry.id, entry)
      if (!controller || !hw.controllers[controller]) errors.push(`${entry.id}: assigned controller/carrier missing`)
      if (channel.boundTag) {
        if (!modules[channel.boundTag] || !channel.boundField) errors.push(`${entry.id}: unresolved ${channel.boundTag} module/field`)
        else entry.references.push(`${channel.boundTag}/${channel.boundField}`)
      }
    }
  }
  const signals = [...entries.values()]
  const count = (type: TraditionalCardType): DstUsageReport['byType']['AI'] => {
    const typed = signals.filter(entry => entry.type === type)
    const referenced = typed.filter(entry => entry.references.length > 0)
    return { configured: typed.length, referenced: referenced.length,
      enabledReferenced: referenced.filter(entry => entry.enabled).length, unused: typed.length - referenced.length }
  }
  return { entries: signals, errors, byType: { AI: count('AI'), AO: count('AO'), DI: count('DI'), DO: count('DO') } }
}
