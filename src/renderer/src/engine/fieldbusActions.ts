import { useStore } from './store'
import { useSecurity, type LockType } from './security'
import { controllerIsDown } from './hardware'
import { usePictures } from './pictureStore'
import { deviceAlarmRankError } from './deviceAlarms'
import { featureDisabledError, featureEnabled } from './systemPreferences'
import {
  FF_BLOCK_PARAMS,
  H1_LIMITS,
  H1_PORT_IDS,
  DEVICE_ALARM_KINDS,
  blockCapacityError,
  blockCardType,
  catalogEntry,
  compareSnapshots,
  ffAddressError,
  ffCompareError,
  ffCompatibilityError,
  ffParamError,
  h1PlacementError,
  h1PortError,
  linkCapacityError,
  macrocycleBand,
  macrocycleViewer,
  makeFfDevice,
  makeH1Card,
  snapshotOf,
  syncFieldbusCards,
  type DeviceAlarmKind,
  type FfAuditEntry,
  type FfBlock,
  type FfDevice,
  type FfDifference,
  type FfLink,
  type FfMode,
  type FfParamValue,
  type FfPhysicalDevice,
  type FfSnapshot,
  type H1Card,
  type H1PortConfig,
  type H1PortId
} from './fieldbus'

// Operations on the virtual H1 fieldbus. Every function returns an error
// message, or null on success, and checks the same keys as other
// configuration: Can Configure for the H1 card/port/links, Can Calibrate for
// device resource/transducer configuration and calibration, Can Download for
// the card download.

const fail = (cardId: string, message: string): string => {
  useStore.getState().logEvent('DIAGNOSTIC', cardId, `Fieldbus action rejected: ${message}`)
  return message
}

/** The reason the last permission check failed (a missing key, or a stopped database server). */
function denial(fallback: string): string {
  return useSecurity.getState().lastDenied ?? fallback
}

function allow(lock: LockType, action: string): boolean {
  return useSecurity.getState().requireLock(lock, action)
}

function getCard(cardId: string): H1Card | undefined {
  return useStore.getState().hardware.h1Cards?.[cardId]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/** Clone the card, let `edit` change it, and commit only when `edit` returns null. */
function mutate(cardId: string, edit: (card: H1Card) => string | null, resync = false): string | null {
  const card = getCard(cardId)
  if (!card) return 'H1 card does not exist'
  const next = clone(card)
  const error = edit(next)
  if (error) return fail(cardId, error)
  for (const id of H1_PORT_IDS) for (const device of Object.values(next.ports[id].devices)) device.history.forEach(deepFreeze)
  useStore.setState((s) => {
    const hardware = { ...s.hardware, h1Cards: { ...s.hardware.h1Cards, [cardId]: next } }
    return { hardware: resync ? syncFieldbusCards(hardware) : hardware, rev: s.rev + 1 }
  })
  return null
}

function record(
  device: FfDevice,
  type: FfAuditEntry['type'],
  block: string,
  parameter: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
  method = ''
): void {
  const entry: FfAuditEntry = Object.freeze({
    id: device.history.length + 1,
    time: Date.now(),
    user: useSecurity.getState().currentUser,
    type,
    block,
    parameter,
    oldValue: String(oldValue),
    newValue: String(newValue),
    reason,
    method,
    snapshot: snapshotOf(device) as FfSnapshot
  })
  device.history = [...device.history, entry]
}

const needsReason = (device: FfDevice, reason: string): string | null =>
  device.state !== 'PLACEHOLDER' && !reason.trim() ? 'A reason is required for a change to a commissioned or standby device' : null

function findDevice(card: H1Card, tag: string): FfDevice | undefined {
  for (const id of H1_PORT_IDS) if (card.ports[id].devices[tag]) return card.ports[id].devices[tag]
  return undefined
}

// --- H1 card and port -------------------------------------------------------

export function addH1Card(controllerTag: string, slot: number, redundant: boolean): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card on ${controllerTag}`)) return denial('Requires the Can Configure key')
  if (!featureEnabled('fieldbus')) return fail(controllerTag, featureDisabledError('fieldbus'))
  const hw = useStore.getState().hardware
  if (!hw.controllers[controllerTag]) return fail(controllerTag, 'Controller does not exist')
  const occupied = [
    ...Object.values(hw.traditionalCards ?? {}).filter((c) => !c.serial && !c.fieldbus && c.controllerTag === controllerTag).map((c) => c.slot),
    ...Object.values(hw.serialCards ?? {}).filter((c) => c.controllerTag === controllerTag).map((c) => c.slot),
    ...Object.values(hw.h1Cards ?? {}).filter((c) => c.controllerTag === controllerTag).flatMap((c) => (c.partnerSlot ? [c.slot, c.partnerSlot] : [c.slot]))
  ]
  const error = h1PlacementError(slot, redundant, occupied)
  if (error) return fail(controllerTag, error)
  const card = makeH1Card(controllerTag, slot, redundant)
  useStore.setState((s) => ({ hardware: { ...s.hardware, h1Cards: { ...s.hardware.h1Cards, [card.id]: card } }, rev: s.rev + 1 }))
  useStore.getState().logEvent('CONFIGURE', card.id, `${redundant ? 'Redundant' : 'Simplex'} Series 2 H1 card added`)
  return null
}

export function removeH1Card(cardId: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  const card = getCard(cardId)
  if (!card) return 'H1 card does not exist'
  const dsts = Object.values(useStore.getState().hardware.traditionalCards ?? {}).filter((c) => c.fieldbus?.cardId === cardId).flatMap((c) => c.channels.map((ch) => ch.dst))
  const hw = useStore.getState().hardware
  const bound = dsts.find((dst) => Object.values(hw.analogBindings ?? {}).some((b) => Object.values(b).includes(dst)) ||
    Object.values(hw.deviceBindings ?? {}).some((b) => Object.values(b).includes(dst)) || Object.values(hw.discreteBindings ?? {}).includes(dst))
  if (bound) return fail(cardId, `DST ${bound} is bound to a module; disconnect it first`)
  useStore.setState((s) => {
    const h1Cards = { ...s.hardware.h1Cards }
    delete h1Cards[cardId]
    return { hardware: syncFieldbusCards({ ...s.hardware, h1Cards }), rev: s.rev + 1 }
  })
  useStore.getState().logEvent('CONFIGURE', cardId, 'H1 card removed')
  return null
}

export function configureH1Port(cardId: string, port: H1PortId, patch: Partial<Pick<H1PortConfig, 'enabled' | 'description' | 'requestedMacrocycleMs' | 'minCdSpacingMs'>>): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  const error = h1PortError(patch)
  if (error) return fail(cardId, error)
  return mutate(cardId, (card) => {
    if (!H1_PORT_IDS.includes(port)) return 'H1 port does not exist'
    Object.assign(card.ports[port], patch)
    return null
  })
}

export function failH1Card(cardId: string, failed: boolean): string | null {
  if (!allow('DIAGNOSTIC', `Configure H1 card ${cardId}`)) return denial('Requires the Diagnostic key')
  return mutate(cardId, (card) => { card.cardFailed = failed; return null })
}

export function downloadH1Card(cardId: string): string | null {
  if (!allow('CAN_DOWNLOAD', `Download H1 card ${cardId}`)) return denial('Requires the Can Download key')
  const card = getCard(cardId)
  if (!card) return 'H1 card does not exist'
  const controller = useStore.getState().hardware.controllers[card.controllerTag]
  if (!controller || !controller.commissioned) return fail(cardId, `Commission controller ${card.controllerTag} before downloading the card`)
  if (controllerIsDown(controller)) return fail(cardId, `Controller ${card.controllerTag} is not available`)
  for (const id of H1_PORT_IDS) {
    const viewer = macrocycleViewer(card.ports[id])
    if (viewer.error) return fail(cardId, `${id}: ${viewer.error}`)
  }
  const error = mutate(cardId, (next) => {
    next.downloaded = true
    for (const id of H1_PORT_IDS) {
      next.runtime[id] = { elapsedMs: 0, cycle: 0, lasAddress: null, lasLostMs: 0, takeoverAt: null, liveList: [], probeCursor: H1_LIMITS.firstAddress, tokenPasses: 0, bands: {}, unscheduledQueued: 0, unscheduledServed: 0, failed: false, seen: [] }
    }
    return null
  }, true)
  if (!error) useStore.getState().logEvent('CONFIGURE', cardId, 'H1 card downloaded; ports and schedules are active')
  return error
}

// --- the virtual field ------------------------------------------------------

export function attachFieldDevice(
  cardId: string,
  spec: { port: H1PortId; catalogId: string; address: number; revision: number; ddRevision: number; serial?: string; sensorValue?: number }
): { id: string } | { error: string } {
  const result: { id?: string } = {}
  const error = mutate(cardId, (card) => {
    const port = card.ports[spec.port]
    if (!port) return 'H1 port does not exist'
    if (!Number.isInteger(spec.address) || spec.address < H1_LIMITS.firstAddress || spec.address > H1_LIMITS.lastAddress) return `Device address must be from ${H1_LIMITS.firstAddress} to ${H1_LIMITS.lastAddress}`
    if (Object.values(card.field).some((d) => d.port === spec.port && d.address === spec.address)) return `Address ${spec.address} already has a device on the segment`
    const serial = spec.serial ?? String(1000 + Object.keys(card.field).length + 1)
    const id = `${spec.catalogId}-${serial}`
    if (card.field[id]) return `Device ${id} is already attached`
    card.field[id] = {
      id, port: spec.port, address: spec.address, catalogId: spec.catalogId, serial,
      deviceRevision: spec.revision, ddRevision: spec.ddRevision, communicating: true, sensorValue: spec.sensorValue ?? 0,
      faults: { failed: false, maintenance: false, advisory: false, abnormal: false }
    }
    result.id = id
    return null
  })
  return error || !result.id ? { error: error ?? 'Device was not attached' } : { id: result.id }
}

export function detachFieldDevice(cardId: string, deviceId: string): string | null {
  return mutate(cardId, (card) => {
    if (!card.field[deviceId]) return `Device ${deviceId} is not on the segment`
    delete card.field[deviceId]
    return null
  })
}

export function setFieldDevice(
  cardId: string,
  deviceId: string,
  patch: { communicating?: boolean; sensorValue?: number; faults?: Partial<FfPhysicalDevice['faults']> }
): string | null {
  return mutate(cardId, (card) => {
    const device = card.field[deviceId]
    if (!device) return `Device ${deviceId} is not on the segment`
    if (patch.sensorValue !== undefined && !Number.isFinite(patch.sensorValue)) return 'The sensor value must be a finite number'
    if (patch.communicating !== undefined) device.communicating = patch.communicating
    if (patch.sensorValue !== undefined) device.sensorValue = patch.sensorValue
    if (patch.faults) device.faults = { ...device.faults, ...patch.faults }
    return null
  })
}

export interface FfInventoryRow {
  address: number
  deviceId: string
  tag: string
  state: 'Commissioned' | 'Standby' | 'Unknown' | 'Placeholder' | 'Not communicating'
  integrity: 'Good' | 'Bad'
  model: string
  revision: number
  ddRevision: number
}

/** The device port rescan result: what the segment actually reports, never a fixed table. */
export function ffInventory(card: H1Card, port: H1PortId): FfInventoryRow[] {
  const runtime = card.runtime[port]
  const config = Object.values(card.ports[port].devices)
  const rows: FfInventoryRow[] = []
  for (const physical of Object.values(card.field).filter((d) => d.port === port)) {
    const entry = catalogEntry(physical.catalogId)
    const owner = config.find((d) => d.deviceId === physical.id)
    const live = physical.communicating && runtime.liveList.includes(physical.address)
    rows.push({
      address: physical.address, deviceId: physical.id, tag: owner?.tag ?? '',
      state: !live ? 'Not communicating' : !entry ? 'Unknown' : owner?.state === 'COMMISSIONED' ? 'Commissioned' : 'Standby',
      integrity: live && !!entry ? 'Good' : 'Bad', model: entry?.model ?? 'Unknown device', revision: physical.deviceRevision, ddRevision: physical.ddRevision
    })
  }
  for (const device of config.filter((d) => d.state !== 'PLACEHOLDER' && d.deviceId && !card.field[d.deviceId])) {
    rows.push({ address: device.address, deviceId: device.deviceId as string, tag: device.tag, state: 'Not communicating', integrity: 'Bad', model: catalogEntry(device.catalogId)?.model ?? '', revision: device.deviceRevision, ddRevision: device.ddRevision })
  }
  for (const device of config.filter((d) => d.state === 'PLACEHOLDER')) {
    rows.push({ address: device.address, deviceId: '', tag: device.tag, state: 'Placeholder', integrity: 'Bad', model: catalogEntry(device.catalogId)?.model ?? '', revision: device.deviceRevision, ddRevision: device.ddRevision })
  }
  return rows.sort((a, b) => a.address - b.address)
}

// --- configuration devices --------------------------------------------------

export function addFfDevice(cardId: string, port: H1PortId, tag: string, address: number, catalogId: string, revision: number, ddRevision: number): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const p = card.ports[port]
    if (!p) return 'H1 port does not exist'
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(tag)) return 'Device tag must be 1-16 characters starting with a letter'
    if (findDevice(card, tag)) return `Device ${tag} already exists`
    const compat = ffCompatibilityError(catalogEntry(catalogId), revision, ddRevision)
    if (compat) return compat
    const addressError = ffAddressError(p, address)
    if (addressError) return addressError
    const entry = catalogEntry(catalogId)
    if (!entry) return 'Unknown device type'
    const capacity = blockCapacityError(card, entry.blocks.length, 0)
    if (capacity) return capacity
    p.devices[tag] = makeFfDevice(tag, port, address, entry, revision, ddRevision, 'PLACEHOLDER')
    return null
  }, true)
}

export function removeFfDevice(cardId: string, tag: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    const hw = useStore.getState().hardware
    const bound = device.blocks.map((b) => `${tag}/${b.tag}/OUT`).find((dst) => Object.values(hw.analogBindings ?? {}).some((b) => Object.values(b).includes(dst)) ||
      Object.values(hw.deviceBindings ?? {}).some((b) => Object.values(b).includes(dst)) || Object.values(hw.discreteBindings ?? {}).includes(dst))
    if (bound) return `DST ${bound} is bound to a module; disconnect it first`
    delete card.ports[device.port].devices[tag]
    card.ports[device.port].links = card.ports[device.port].links.filter((l) => l.from.owner !== tag && l.to.owner !== tag)
    return null
  }, true)
}

export function commissionFfDevice(cardId: string, tag: string, deviceId: string, reason: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    const physical = card.field[deviceId]
    if (!physical) return `Device ${deviceId} is not on the segment`
    if (physical.port !== device.port) return 'The physical device is on a different segment'
    const compat = ffCompatibilityError(catalogEntry(physical.catalogId), physical.deviceRevision, physical.ddRevision)
    if (compat) return compat
    if (physical.catalogId !== device.catalogId) return `${tag} is a ${catalogEntry(device.catalogId)?.model}; the device found is a ${catalogEntry(physical.catalogId)?.model}`
    if (physical.deviceRevision !== device.deviceRevision) return `${tag} expects revision ${device.deviceRevision}; the device is revision ${physical.deviceRevision}`
    if (Object.values(card.ports[device.port].devices).some((d) => d.deviceId === deviceId && d.tag !== tag)) return `${deviceId} is already commissioned as another device`
    const addressError = ffAddressError(card.ports[device.port], physical.address, tag)
    if (addressError) return addressError
    const before = device.state
    device.deviceId = deviceId
    device.address = physical.address
    device.ddRevision = physical.ddRevision
    device.state = 'COMMISSIONED'
    record(device, 'COMMISSION', 'RESOURCE', 'STATE', before, 'COMMISSIONED', reason || 'Commissioned', 'Commission')
    return null
  }, true)
}

export function decommissionFfDevice(cardId: string, tag: string, reason: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device || device.state !== 'COMMISSIONED') return `Device ${tag} is not commissioned`
    if (!reason.trim()) return 'A reason is required to decommission a device'
    device.state = 'STANDBY'
    record(device, 'DECOMMISSION', 'RESOURCE', 'STATE', 'COMMISSIONED', 'STANDBY', reason, 'Decommission')
    return null
  }, true)
}

export function setFfMode(cardId: string, tag: string, target: string, mode: FfMode, reason: string): string | null {
  if (!allow('CAN_CALIBRATE', `Configure field device ${tag}`)) return denial('Requires the Can Calibrate key')
  if (!['AUTO', 'MAN', 'OOS'].includes(mode)) return fail(cardId, 'Mode must be Auto, Man or Out of Service')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    const missing = needsReason(device, reason)
    if (missing) return missing
    if (target === 'RESOURCE') {
      const before = device.resource.mode
      if (mode === 'MAN') return 'The resource block supports Auto and Out of Service only'
      device.resource.mode = mode
      record(device, 'MODE', 'RESOURCE', 'MODE', before, mode, reason)
      return null
    }
    const transducer = device.transducers.find((t) => t.tag === target)
    if (transducer) {
      if (mode === 'MAN') return 'A transducer block supports Auto and Out of Service only'
      const before = transducer.mode
      transducer.mode = mode
      record(device, 'MODE', transducer.tag, 'MODE', before, mode, reason)
      return null
    }
    const block = device.blocks.find((b) => b.tag === target)
    if (!block) return `Device ${tag} has no block ${target}`
    if (mode === 'MAN' && block.type !== 'PID' && block.type !== 'AO') return `${block.type} blocks do not support Man`
    const before = block.mode
    block.mode = mode
    record(device, 'MODE', block.tag, 'MODE', before, mode, reason)
    return null
  }, true)
}

export function writeFfParam(cardId: string, tag: string, blockTag: string, name: string, value: FfParamValue, reason: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    if (device.resource.writeLock) return `${tag} is write locked; unlock the resource block first`
    const block = device.blocks.find((b) => b.tag === blockTag)
    if (!block) return `Device ${tag} has no block ${blockTag}`
    const missing = needsReason(device, reason)
    if (missing) return missing
    const error = ffParamError(block, name, value)
    if (error) return error
    const before = block.params[name]
    block.params[name] = value
    record(device, 'CONFIG', block.tag, name, before, value, reason)
    return null
  })
}

export function setFfWriteLock(cardId: string, tag: string, locked: boolean, reason: string): string | null {
  if (!allow('CAN_CALIBRATE', `Configure field device ${tag}`)) return denial('Requires the Can Calibrate key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    const missing = needsReason(device, reason)
    if (missing) return missing
    const before = device.resource.writeLock
    device.resource.writeLock = locked
    record(device, 'CONFIG', 'RESOURCE', 'WRITE_LOCK', before, locked, reason)
    return null
  })
}

export function calibrateFfTransducer(cardId: string, tag: string, transducerTag: string, low: number, high: number, reason: string): string | null {
  if (!allow('CAN_CALIBRATE', `Configure field device ${tag}`)) return denial('Requires the Can Calibrate key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    const transducer = device.transducers.find((t) => t.tag === transducerTag)
    if (!transducer) return `Device ${tag} has no transducer ${transducerTag}`
    if (device.resource.writeLock) return `${tag} is write locked; unlock the resource block first`
    if (transducer.mode !== 'OOS') return `${transducerTag} must be Out of Service before calibration`
    if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return 'The calibration low trim must be below the high trim'
    const missing = needsReason(device, reason)
    if (missing) return missing
    const before = `${transducer.calibration.low}..${transducer.calibration.high}`
    transducer.calibration = { low, high, calibratedAt: Date.now() }
    record(device, 'CALIBRATION', transducer.tag, 'SENSOR_TRIM', before, `${low}..${high}`, reason, 'Two point sensor trim (virtual)')
    return null
  })
}

// --- blocks, rates and links ------------------------------------------------

export function setFfBlockRate(cardId: string, tag: string, blockTag: string, moduleScanMs: number): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  const band = macrocycleBand(moduleScanMs)
  if (band === null) return fail(cardId, `A module scan of ${moduleScanMs} ms does not map to a macrocycle (500, 1000, 2000 or 4000 ms)`)
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    const block = device?.blocks.find((b) => b.tag === blockTag)
    if (!device || !block) return `Block ${tag}/${blockTag} does not exist`
    const previous = block.rateMs
    block.rateMs = band
    const viewer = macrocycleViewer(card.ports[device.port])
    if (viewer.error) { block.rateMs = previous; return viewer.error }
    return null
  })
}

export function assignFfBlock(cardId: string, tag: string, blockTag: string, executesIn: 'DEVICE' | 'CARD'): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    const block = device?.blocks.find((b) => b.tag === blockTag)
    if (!device || !block) return `Block ${tag}/${blockTag} does not exist`
    if (block.executesIn === executesIn) return null
    const capacity = executesIn === 'CARD' ? blockCapacityError(card, -1, 1) : blockCapacityError(card, 1, -1)
    if (capacity) return capacity
    block.executesIn = executesIn
    return null
  })
}

export function addFfLink(cardId: string, port: H1PortId, link: Omit<FfLink, 'id' | 'port'>): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const p = card.ports[port]
    if (!p) return 'H1 port does not exist'
    const full: FfLink = { ...link, port, id: `L${p.links.length + 1}-${link.from.owner}.${link.from.block}-${link.to.owner}.${link.to.block}` }
    for (const end of [link.from, link.to]) {
      const device = p.devices[end.owner]
      if (device && !device.blocks.some((b) => b.tag === end.block)) return `Device ${end.owner} has no block ${end.block}`
    }
    if (!p.devices[link.from.owner] && !p.devices[link.to.owner]) return 'A link needs at least one block in a device on this segment'
    if (p.links.some((l) => l.id === full.id)) return 'That link already exists'
    const error = linkCapacityError(p, full)
    if (error) return error
    p.links.push(full)
    return null
  })
}

export function removeFfLink(cardId: string, port: H1PortId, id: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const p = card.ports[port]
    if (!p?.links.some((l) => l.id === id)) return 'Link does not exist'
    p.links = p.links.filter((l) => l.id !== id)
    return null
  })
}

/** Queue an unscheduled access (a parameter read or alarm); the LAS grants it between scheduled transfers. */
export function queueUnscheduled(cardId: string, port: H1PortId): string | null {
  return mutate(cardId, (card) => {
    if (!card.downloaded) return 'Download the H1 card first'
    card.runtime[port].unscheduledQueued++
    return null
  })
}

// --- compare and transfer ---------------------------------------------------

export type CompareSource = { cardId: string; tag: string; history?: number }

function resolveSnapshot(source: CompareSource): { device?: FfDevice; snapshot?: FfSnapshot; error?: string } {
  const device = (() => { const card = getCard(source.cardId); return card ? findDevice(card, source.tag) : undefined })()
  if (!device) return { error: `Device ${source.tag} does not exist` }
  if (source.history === undefined) return { device, snapshot: snapshotOf(device) }
  const entry = device.history.find((h) => h.id === source.history)
  if (!entry) return { error: `History entry ${source.history} does not exist` }
  return { device, snapshot: entry.snapshot }
}

export function compareFfDevices(left: CompareSource, right: CompareSource): { differences: FfDifference[] } | { error: string } {
  const a = resolveSnapshot(left)
  const b = resolveSnapshot(right)
  if (a.error || b.error) return { error: (a.error ?? b.error) as string }
  const error = ffCompareError(a.device, b.device)
  if (error) return { error }
  return { differences: compareSnapshots(a.snapshot as FfSnapshot, b.snapshot as FfSnapshot) }
}

/** Copy the selected differing values from `from` (current or historical, read-only) into the current configuration of `to`. */
export function transferFfValues(from: CompareSource, to: { cardId: string; tag: string }, keys: string[], reason: string): string | null {
  if (!allow('CAN_CALIBRATE', `Configure field device ${to.tag}`)) return denial('Requires the Can Calibrate key')
  const source = resolveSnapshot(from)
  if (source.error) return source.error
  const target = resolveSnapshot({ cardId: to.cardId, tag: to.tag })
  if (target.error) return target.error
  const compat = ffCompareError(source.device, target.device)
  if (compat) return compat
  const differences = compareSnapshots(target.snapshot as FfSnapshot, source.snapshot as FfSnapshot)
  const chosen = differences.filter((d) => keys.includes(`${d.scope}/${d.parameter}`))
  if (!chosen.length) return 'Select at least one differing value to transfer'
  return mutate(to.cardId, (card) => {
    const device = findDevice(card, to.tag) as FfDevice
    if (device.resource.writeLock) return `${to.tag} is write locked; unlock the resource block first`
    const missing = needsReason(device, reason)
    if (missing) return missing
    for (const diff of chosen) {
      const block = device.blocks.find((b) => b.tag === diff.scope)
      const transducer = device.transducers.find((t) => t.tag === diff.scope)
      if (diff.scope === 'RESOURCE') {
        if (diff.parameter === 'MODE') device.resource.mode = diff.right as FfMode
        else if (diff.parameter === 'WRITE_LOCK') device.resource.writeLock = diff.right === 'true'
        else if (diff.parameter === 'FEATURES.REPORTS') device.resource.features.reports = diff.right === 'true'
        else if (diff.parameter === 'FEATURES.FAULT_STATE') device.resource.features.faultState = diff.right === 'true'
      } else if (transducer) {
        if (diff.parameter === 'MODE') transducer.mode = diff.right as FfMode
        if (diff.parameter === 'CAL_LOW') transducer.calibration.low = Number(diff.right)
        if (diff.parameter === 'CAL_HIGH') transducer.calibration.high = Number(diff.right)
      } else if (block) {
        if (diff.parameter === 'MODE') block.mode = diff.right as FfMode
        else {
          const def = FF_BLOCK_PARAMS[block.type].find((p) => p.name === diff.parameter)
          block.params[diff.parameter] = def?.kind === 'number' ? Number(diff.right) : def?.kind === 'boolean' ? diff.right === 'true' : diff.right
        }
      }
      record(device, 'TRANSFER', diff.scope, diff.parameter, diff.left, diff.right, reason, 'Compare and transfer')
    }
    return null
  })
}

// --- device alarms (DV09-121..123) ------------------------------------------

/** Enable Device Alarms on the H1 card (controller): the prerequisite for every device alarm. */
export function enableDeviceAlarms(cardId: string, enabled: boolean): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => { card.deviceAlarms = enabled; return null })
}

export function configureDeviceAlarm(cardId: string, tag: string, kind: DeviceAlarmKind, patch: { enabled?: boolean; rank?: number }): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  if (!DEVICE_ALARM_KINDS.includes(kind)) return fail(cardId, `Unknown device alarm ${String(kind)}`)
  if (patch.rank !== undefined) {
    const error = deviceAlarmRankError(patch.rank)
    if (error) return fail(cardId, error)
  }
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    Object.assign(device.alarms.settings[kind], patch)
    return null
  })
}

/** The device's area comes from its controller's assigned area or from a chosen module. */
export function setDeviceAlarmArea(cardId: string, tag: string, mode: 'CONTROLLER' | 'MODULE', module?: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  const modules = useStore.getState().modules
  if (mode === 'MODULE' && (!module || !modules[module])) return fail(cardId, 'Select an existing module to take the area from')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    device.alarms.areaMode = mode
    device.alarms.areaModule = mode === 'MODULE' ? module : undefined
    return null
  })
}

export function setControllerArea(controllerTag: string, area: string | null): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card on ${controllerTag}`)) return denial('Requires the Can Configure key')
  const s = useStore.getState()
  if (!s.hardware.controllers[controllerTag]) return fail(controllerTag, 'Controller does not exist')
  if (area !== null && !s.areas.includes(area)) return fail(controllerTag, `Area ${area} does not exist`)
  useStore.setState((st) => {
    const controllerAreas = { ...st.hardware.controllerAreas }
    if (area === null) delete controllerAreas[controllerTag]
    else controllerAreas[controllerTag] = area
    return { hardware: { ...st.hardware, controllerAreas }, rev: st.rev + 1 }
  })
  return null
}

/** Repeat annunciation only where the device supports it. */
export function setDeviceReannunciation(cardId: string, tag: string, enabled: boolean, seconds: number): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    if (enabled && !catalogEntry(device.catalogId)?.reannunciation) return `${catalogEntry(device.catalogId)?.model ?? tag} does not support repeat annunciation`
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) return 'The repeat interval must be a whole number of seconds from 5 to 3600'
    device.alarms.reannunciate = enabled
    device.alarms.reannounceSeconds = seconds
    return null
  })
}

export function setDevicePrimaryDisplay(cardId: string, tag: string, picture: string): string | null {
  if (!allow('CAN_CONFIGURE', `Configure H1 card ${cardId}`)) return denial('Requires the Can Configure key')
  const name = picture.trim().toUpperCase()
  if (name && !usePictures.getState().pictures[name]) return fail(cardId, `Picture ${name} does not exist`)
  return mutate(cardId, (card) => {
    const device = findDevice(card, tag)
    if (!device) return `Device ${tag} does not exist`
    device.alarms.primaryDisplay = name
    return null
  })
}

export { blockCardType }
export type { FfBlock }
