import { controllerIsDown, type HardwareState } from './hardware'
import type { TraditionalCard, TraditionalCardType } from './traditionalIo'

// ---------------------------------------------------------------------------
// Virtual FOUNDATION fieldbus H1 (DV-09 chapters 10-13). An H1 card on a
// controller slot has two ports; each port is a segment with a link active
// scheduler (LAS), field devices (resource, transducer and function blocks),
// macrocycles, publisher/subscriber links (VCRs) and device alarms. Everything
// here is a training model: there is no FOUNDATION stack, device description
// service, physical layer or certified device behavior, and the device catalog
// is a small list of generic virtual instruments.
// ---------------------------------------------------------------------------

export type H1PortId = 'P01' | 'P02'
export const H1_PORT_IDS: H1PortId[] = ['P01', 'P02']

export const H1_LIMITS = {
  totalBlocks: 96,
  deviceBlocks: 64,
  cardBlocks: 32,
  publishers: 35,
  subscribers: 50,
  totalVcrs: 50,
  maxMacrocycles: 4,
  firstAddress: 20,
  lastAddress: 247,
  maxCdSpacingMs: 1000
} as const

export const MACROCYCLE_BANDS_MS = [500, 1000, 2000, 4000] as const

export type FfBlockType = 'AI' | 'AO' | 'MAI' | 'PID' | 'DI' | 'DO' | 'ISEL'
export type FfMode = 'AUTO' | 'MAN' | 'OOS'

/** Milliseconds each function block occupies in a macrocycle. */
export const BLOCK_EXEC_MS: Record<FfBlockType, number> = { AI: 30, AO: 40, PID: 60, MAI: 50, DI: 30, DO: 40, ISEL: 30 }
/** Fixed per-macrocycle communication overhead (token, probe, sync). */
export const MACROCYCLE_OVERHEAD_MS = 100

export interface FfParamDef {
  name: string
  kind: 'number' | 'boolean' | 'enum'
  min?: number
  max?: number
  options?: string[]
  default: number | boolean | string
  /** Manufacturer-specific (extended) rather than a standard FF parameter. */
  extended?: boolean
  /** Configuration writes need the block Out of Service. */
  needsOos: boolean
}

export const FF_BLOCK_PARAMS: Record<FfBlockType, FfParamDef[]> = {
  AI: [
    { name: 'XD_SCALE_LO', kind: 'number', default: 0, needsOos: true },
    { name: 'XD_SCALE_HI', kind: 'number', default: 100, needsOos: true },
    { name: 'L_TYPE', kind: 'enum', options: ['DIRECT', 'INDIRECT'], default: 'DIRECT', needsOos: true },
    { name: 'PV_FTIME', kind: 'number', min: 0, max: 3600, default: 0, needsOos: false },
    { name: 'SENSOR_DAMPING', kind: 'number', min: 0, max: 60, default: 1, extended: true, needsOos: false }
  ],
  AO: [
    { name: 'SHED_OPT', kind: 'enum', options: ['UNINITIALIZED', 'NORMAL_SHED', 'NORMAL_RETURN'], default: 'NORMAL_SHED', needsOos: true },
    { name: 'FSTATE_VAL', kind: 'number', min: 0, max: 100, default: 0, needsOos: false },
    { name: 'TRAVEL_CUTOFF_HI', kind: 'number', min: 90, max: 100, default: 99.5, extended: true, needsOos: false },
    { name: 'TRAVEL_CUTOFF_LO', kind: 'number', min: 0, max: 10, default: 0.5, extended: true, needsOos: false }
  ],
  MAI: [
    { name: 'CHANNELS_USED', kind: 'number', min: 1, max: 8, default: 2, needsOos: true },
    { name: 'MAI_UPDATE_RATE', kind: 'number', min: 1, max: 60, default: 1, extended: true, needsOos: false }
  ],
  PID: [
    { name: 'GAIN', kind: 'number', min: 0, default: 1, needsOos: false },
    { name: 'RESET', kind: 'number', min: 0, default: 10, needsOos: false },
    { name: 'RATE', kind: 'number', min: 0, default: 0, needsOos: false },
    { name: 'BYPASS', kind: 'boolean', default: false, needsOos: false },
    { name: 'FF_GAIN', kind: 'number', min: 0, default: 0, extended: true, needsOos: false }
  ],
  DI: [
    { name: 'INVERT', kind: 'boolean', default: false, needsOos: true },
    { name: 'PV_FTIME', kind: 'number', min: 0, max: 3600, default: 0, needsOos: false }
  ],
  DO: [
    { name: 'INVERT', kind: 'boolean', default: false, needsOos: true },
    { name: 'FSTATE_VAL_D', kind: 'boolean', default: false, needsOos: false }
  ],
  ISEL: [
    { name: 'SELECT_TYPE', kind: 'enum', options: ['FIRST_GOOD', 'MINIMUM', 'MAXIMUM', 'MIDDLE', 'AVERAGE'], default: 'MIDDLE', needsOos: true },
    { name: 'MIN_GOOD', kind: 'number', min: 0, max: 4, default: 0, extended: true, needsOos: false }
  ]
}

export interface FfCatalogEntry {
  id: string
  manufacturer: string
  model: string
  deviceType: string
  /** Device revisions this simulation accepts for the type. */
  revisions: number[]
  ddRevisions: number[]
  linkMaster: boolean
  blocks: { tag: string; type: FfBlockType }[]
  transducers: { tag: string; kind: string }[]
}

/** Generic virtual instruments; a real device catalog needs genuine device descriptions. */
export const FF_CATALOG: FfCatalogEntry[] = [
  { id: 'VI-PT100', manufacturer: 'Virtual Instruments', model: 'PT-100 pressure transmitter', deviceType: 'PRESSURE', revisions: [1, 2], ddRevisions: [1, 2], linkMaster: false,
    blocks: [{ tag: 'AI1', type: 'AI' }, { tag: 'AI2', type: 'AI' }, { tag: 'PID1', type: 'PID' }], transducers: [{ tag: 'TB1', kind: 'PRESSURE' }] },
  { id: 'VI-TT200', manufacturer: 'Virtual Instruments', model: 'TT-200 temperature transmitter', deviceType: 'TEMPERATURE', revisions: [1, 2, 3], ddRevisions: [1, 2], linkMaster: false,
    blocks: [{ tag: 'AI1', type: 'AI' }, { tag: 'MAI1', type: 'MAI' }], transducers: [{ tag: 'TB1', kind: 'TEMPERATURE' }] },
  { id: 'VI-FV300', manufacturer: 'Virtual Instruments', model: 'FV-300 valve positioner', deviceType: 'POSITIONER', revisions: [2, 3], ddRevisions: [2, 3], linkMaster: true,
    blocks: [{ tag: 'AO1', type: 'AO' }, { tag: 'PID1', type: 'PID' }, { tag: 'ISEL1', type: 'ISEL' }], transducers: [{ tag: 'TB1', kind: 'VALVE' }] },
  { id: 'VI-FM400', manufacturer: 'Virtual Instruments', model: 'FM-400 flow meter', deviceType: 'FLOW', revisions: [1], ddRevisions: [1], linkMaster: false,
    blocks: [{ tag: 'AI1', type: 'AI' }, { tag: 'DI1', type: 'DI' }], transducers: [{ tag: 'TB1', kind: 'FLOW' }] }
]

export const catalogEntry = (id: string): FfCatalogEntry | undefined => FF_CATALOG.find((entry) => entry.id === id)

export type FfParamValue = number | boolean | string

export interface FfBlock {
  tag: string
  type: FfBlockType
  mode: FfMode
  /** Where the block executes: in the field device or in the H1 card. */
  executesIn: 'DEVICE' | 'CARD'
  /** Macrocycle band the block is scheduled in (ms), from the module that drives it. */
  rateMs: number
  params: Record<string, FfParamValue>
}

export interface FfTransducer {
  tag: string
  kind: string
  mode: FfMode
  calibration: { low: number; high: number; calibratedAt?: number }
}

export interface FfResource {
  mode: FfMode
  writeLock: boolean
  features: { reports: boolean; faultState: boolean }
}

export interface FfAuditEntry {
  readonly id: number
  readonly time: number
  readonly user: string
  readonly type: 'CONFIG' | 'MODE' | 'CALIBRATION' | 'COMMISSION' | 'DECOMMISSION' | 'TRANSFER' | 'METHOD'
  readonly block: string
  readonly parameter: string
  readonly oldValue: string
  readonly newValue: string
  readonly reason: string
  readonly method: string
  /** Read-only copy of the device configuration after this change, for historical comparison. */
  readonly snapshot: FfSnapshot
}

export interface FfSnapshot {
  resource: FfResource
  transducers: FfTransducer[]
  blocks: FfBlock[]
}

export type FfDeviceState = 'PLACEHOLDER' | 'STANDBY' | 'COMMISSIONED'

export interface FfDevice {
  tag: string
  port: H1PortId
  address: number
  catalogId: string
  deviceRevision: number
  ddRevision: number
  /** Physical device ID matched when commissioned or in standby. */
  deviceId?: string
  state: FfDeviceState
  resource: FfResource
  transducers: FfTransducer[]
  blocks: FfBlock[]
  history: FfAuditEntry[]
}

export interface FfPhysicalDevice {
  id: string
  port: H1PortId
  address: number
  catalogId: string
  serial: string
  deviceRevision: number
  ddRevision: number
  /** The device is powered and answering the segment. */
  communicating: boolean
  /** The process value the device's sensor sees (engineering units) or the valve position feedback. */
  sensorValue: number
  /** Device-generated conditions (DV09-121/122). */
  faults: { failed: boolean; maintenance: boolean; advisory: boolean; abnormal: boolean }
}

export interface FfLink {
  id: string
  /** The block that publishes (owner of the output) and the block that subscribes. */
  from: { owner: string; block: string }
  to: { owner: string; block: string }
  port: H1PortId
}

export interface H1PortConfig {
  enabled: boolean
  description: string
  requestedMacrocycleMs: number
  minCdSpacingMs: number
  devices: Record<string, FfDevice>
  links: FfLink[]
}

export interface H1PortRuntime {
  elapsedMs: number
  cycle: number
  /** Address of the active LAS: the card (1) or a backup link master device. */
  lasAddress: number | null
  lasLostMs: number
  takeoverAt: number | null
  liveList: number[]
  probeCursor: number
  tokenPasses: number
  /** Cycle counters and last delivery time per macrocycle band. */
  bands: Record<string, { elapsedMs: number; cycles: number; lastDeliveryMs: number }>
  /** Latest unscheduled read results. */
  unscheduledQueued: number
  unscheduledServed: number
  failed: boolean
}

export interface H1Card {
  id: string
  controllerTag: string
  slot: number
  series: 2
  redundant: boolean
  /** The partner card slot when redundant (the odd slot plus one). */
  partnerSlot: number | null
  ports: Record<H1PortId, H1PortConfig>
  /** Physical devices attached to each segment (the virtual field). */
  field: Record<string, FfPhysicalDevice>
  downloaded: boolean
  cardFailed: boolean
  /** Blocks assigned to execute in the H1 card instead of a device. */
  runtime: Record<H1PortId, H1PortRuntime>
}

export const CARD_LAS_ADDRESS = 1

function emptyRuntime(): H1PortRuntime {
  return {
    elapsedMs: 0, cycle: 0, lasAddress: null, lasLostMs: 0, takeoverAt: null, liveList: [], probeCursor: H1_LIMITS.firstAddress,
    tokenPasses: 0, bands: {}, unscheduledQueued: 0, unscheduledServed: 0, failed: false
  }
}

export function defaultH1Port(): H1PortConfig {
  return { enabled: false, description: '', requestedMacrocycleMs: 1000, minCdSpacingMs: 20, devices: {}, links: [] }
}

export function makeH1Card(controllerTag: string, slot: number, redundant: boolean): H1Card {
  return {
    id: `${controllerTag}/C${String(slot).padStart(2, '0')}`,
    controllerTag,
    slot,
    series: 2,
    redundant,
    partnerSlot: redundant ? slot + 1 : null,
    ports: { P01: defaultH1Port(), P02: defaultH1Port() },
    field: {},
    downloaded: false,
    cardFailed: false,
    runtime: { P01: emptyRuntime(), P02: emptyRuntime() }
  }
}

// --- capacity and placement -------------------------------------------------

export function h1PlacementError(slot: number, redundant: boolean, occupied: number[]): string | null {
  if (!Number.isInteger(slot) || slot < 1 || slot > 8) return 'H1 card slot must be 1-8'
  if (redundant && slot % 2 === 0) return 'A redundant H1 card pair must start in an odd slot (1, 3, 5 or 7)'
  if (occupied.includes(slot)) return `Slot ${slot} already has a card`
  if (redundant && occupied.includes(slot + 1)) return `The redundant partner slot ${slot + 1} is already in use`
  return null
}

export function blockCounts(card: H1Card): { device: number; card: number; total: number } {
  let device = 0
  let onCard = 0
  for (const portId of H1_PORT_IDS) {
    for (const d of Object.values(card.ports[portId].devices)) {
      for (const b of d.blocks) {
        if (b.executesIn === 'CARD') onCard++
        else device++
      }
    }
  }
  return { device, card: onCard, total: device + onCard }
}

export function blockCapacityError(card: H1Card, extraDevice: number, extraCard: number): string | null {
  const c = blockCounts(card)
  if (c.device + extraDevice > H1_LIMITS.deviceBlocks) return `At most ${H1_LIMITS.deviceBlocks} device blocks per H1 card (${c.device} used)`
  if (c.card + extraCard > H1_LIMITS.cardBlocks) return `At most ${H1_LIMITS.cardBlocks} H1 card blocks per card (${c.card} used)`
  if (c.total + extraDevice + extraCard > H1_LIMITS.totalBlocks) return `At most ${H1_LIMITS.totalBlocks} blocks per H1 card`
  return null
}

// --- macrocycles ------------------------------------------------------------

/** Course rule: the actual macrocycle is the larger of the requested and the calculated time. */
export function actualMacrocycleMs(requestedMs: number, calculatedMs: number): number {
  return Math.max(requestedMs, calculatedMs)
}

/** Module scan period -> the macrocycle band (500/1000/2000/4000 ms) that carries its blocks. */
export function macrocycleBand(moduleScanMs: number): number | null {
  if (!Number.isFinite(moduleScanMs) || moduleScanMs <= 0) return null
  for (const band of MACROCYCLE_BANDS_MS) if (moduleScanMs <= band) return band
  return null
}

function allBlocks(port: H1PortConfig): FfBlock[] {
  return Object.values(port.devices).flatMap((d) => d.blocks)
}

export function linkCounts(port: H1PortConfig): { publishers: number; subscribers: number; total: number } {
  const devices = new Set(Object.keys(port.devices))
  let publishers = 0
  let subscribers = 0
  for (const link of port.links) {
    if (devices.has(link.from.owner)) publishers++
    if (devices.has(link.to.owner)) subscribers++
  }
  return { publishers, subscribers, total: publishers + subscribers }
}

export function linkCapacityError(port: H1PortConfig, extra: FfLink): string | null {
  const next = { ...port, links: [...port.links, extra] }
  const c = linkCounts(next)
  if (c.publishers > H1_LIMITS.publishers) return `At most ${H1_LIMITS.publishers} publisher VCRs per port`
  if (c.subscribers > H1_LIMITS.subscribers) return `At most ${H1_LIMITS.subscribers} subscriber VCRs per port`
  if (c.total > H1_LIMITS.totalVcrs) return `At most ${H1_LIMITS.totalVcrs} total VCRs per port`
  return null
}

/** Bus time one band needs: scheduled block time + one compel-data transfer per publisher + overhead, rounded up to 100 ms. */
export function calculatedMacrocycleMs(port: H1PortConfig, band: number): number {
  const blocks = allBlocks(port).filter((b) => b.rateMs === band)
  const publishers = port.links.filter((l) => {
    const owner = port.devices[l.from.owner]
    return owner?.blocks.some((b) => b.tag === l.from.block && b.rateMs === band)
  }).length
  const total = blocks.reduce((sum, b) => sum + BLOCK_EXEC_MS[b.type], 0) + publishers * port.minCdSpacingMs + MACROCYCLE_OVERHEAD_MS
  return Math.ceil(total / 100) * 100
}

export interface MacrocycleRow {
  bandMs: number
  blocks: string[]
  calculatedMs: number
  actualMs: number
}

/** The macrocycle viewer: every active band with its blocks and actual time. */
export function macrocycleViewer(port: H1PortConfig): { rows: MacrocycleRow[]; error: string | null } {
  const bands = Array.from(new Set(allBlocks(port).map((b) => b.rateMs))).sort((a, b) => a - b)
  const rows = bands.map((bandMs) => {
    const calculatedMs = calculatedMacrocycleMs(port, bandMs)
    return {
      bandMs,
      blocks: Object.values(port.devices).flatMap((d) => d.blocks.filter((b) => b.rateMs === bandMs).map((b) => `${d.tag}/${b.tag}`)),
      calculatedMs,
      actualMs: actualMacrocycleMs(bandMs, calculatedMs)
    }
  })
  return { rows, error: rows.length > H1_LIMITS.maxMacrocycles ? `At most ${H1_LIMITS.maxMacrocycles} simultaneous macrocycles per port` : null }
}

export function portMacrocycle(port: H1PortConfig): { requestedMs: number; calculatedMs: number; actualMs: number } {
  const calculatedMs = calculatedMacrocycleMs(port, port.requestedMacrocycleMs)
  return { requestedMs: port.requestedMacrocycleMs, calculatedMs, actualMs: actualMacrocycleMs(port.requestedMacrocycleMs, calculatedMs) }
}

export function h1PortError(patch: Partial<H1PortConfig>): string | null {
  if (patch.requestedMacrocycleMs !== undefined && !(MACROCYCLE_BANDS_MS as readonly number[]).includes(patch.requestedMacrocycleMs)) {
    return `Requested macrocycle must be one of ${MACROCYCLE_BANDS_MS.join(', ')} ms`
  }
  if (patch.minCdSpacingMs !== undefined && (!Number.isInteger(patch.minCdSpacingMs) || patch.minCdSpacingMs < 0 || patch.minCdSpacingMs > H1_LIMITS.maxCdSpacingMs)) {
    return `Minimum CD spacing must be a whole number from 0 to ${H1_LIMITS.maxCdSpacingMs} ms`
  }
  return null
}

// --- devices and blocks -----------------------------------------------------

export function makeFfDevice(tag: string, port: H1PortId, address: number, entry: FfCatalogEntry, revision: number, ddRevision: number, state: FfDeviceState): FfDevice {
  return {
    tag, port, address, catalogId: entry.id, deviceRevision: revision, ddRevision, state,
    resource: { mode: 'AUTO', writeLock: false, features: { reports: true, faultState: true } },
    transducers: entry.transducers.map((t) => ({ tag: t.tag, kind: t.kind, mode: 'AUTO', calibration: { low: 0, high: 100 } })),
    blocks: entry.blocks.map((b) => ({
      tag: b.tag, type: b.type, mode: b.type === 'PID' ? 'OOS' : 'AUTO', executesIn: 'DEVICE', rateMs: 1000,
      params: Object.fromEntries(FF_BLOCK_PARAMS[b.type].map((p) => [p.name, p.default]))
    })),
    history: []
  }
}

export function ffAddressError(port: H1PortConfig, address: number, except?: string): string | null {
  if (!Number.isInteger(address) || address < H1_LIMITS.firstAddress || address > H1_LIMITS.lastAddress) {
    return `Device address must be a whole number from ${H1_LIMITS.firstAddress} to ${H1_LIMITS.lastAddress}`
  }
  if (Object.values(port.devices).some((d) => d.address === address && d.tag !== except)) return `Address ${address} is already used on this segment`
  return null
}

export function ffParamError(block: FfBlock, name: string, value: FfParamValue): string | null {
  const def = FF_BLOCK_PARAMS[block.type].find((p) => p.name === name)
  if (!def) return `${block.type} block ${block.tag} has no parameter ${name}`
  if (def.kind === 'boolean' && typeof value !== 'boolean') return `${name} must be true or false`
  if (def.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a finite number`
    if (def.min !== undefined && value < def.min) return `${name} must be at least ${def.min}`
    if (def.max !== undefined && value > def.max) return `${name} must be at most ${def.max}`
  }
  if (def.kind === 'enum' && (typeof value !== 'string' || !def.options?.includes(value))) return `${name} must be one of ${def.options?.join(', ')}`
  if (def.needsOos && block.mode !== 'OOS') return `${name} can only be written while ${block.tag} is Out of Service`
  return null
}

/** A catalog match must agree on manufacturer/type, a known revision and a supported DD revision. */
export function ffCompatibilityError(entry: FfCatalogEntry | undefined, revision: number, ddRevision: number): string | null {
  if (!entry) return 'Unknown device type: no matching manufacturer/device description in the virtual catalog'
  if (!entry.revisions.includes(revision)) return `${entry.model} revision ${revision} is not supported (supported: ${entry.revisions.join(', ')})`
  if (!entry.ddRevisions.includes(ddRevision)) return `${entry.model} DD revision ${ddRevision} is not available (available: ${entry.ddRevisions.join(', ')})`
  return null
}

export function snapshotOf(device: FfDevice): FfSnapshot {
  return JSON.parse(JSON.stringify({ resource: device.resource, transducers: device.transducers, blocks: device.blocks })) as FfSnapshot
}

export interface FfDifference {
  scope: string
  parameter: string
  left: string
  right: string
}

function flatten(snapshot: FfSnapshot): Map<string, string> {
  const out = new Map<string, string>()
  out.set('RESOURCE/MODE', snapshot.resource.mode)
  out.set('RESOURCE/WRITE_LOCK', String(snapshot.resource.writeLock))
  out.set('RESOURCE/FEATURES.REPORTS', String(snapshot.resource.features.reports))
  out.set('RESOURCE/FEATURES.FAULT_STATE', String(snapshot.resource.features.faultState))
  for (const t of snapshot.transducers) {
    out.set(`${t.tag}/MODE`, t.mode)
    out.set(`${t.tag}/CAL_LOW`, String(t.calibration.low))
    out.set(`${t.tag}/CAL_HIGH`, String(t.calibration.high))
  }
  for (const b of snapshot.blocks) {
    out.set(`${b.tag}/MODE`, b.mode)
    for (const [name, value] of Object.entries(b.params)) out.set(`${b.tag}/${name}`, String(value))
  }
  return out
}

/** Differences between two same-type, same-revision configurations (resource and transducer data included). */
export function compareSnapshots(left: FfSnapshot, right: FfSnapshot): FfDifference[] {
  const a = flatten(left)
  const b = flatten(right)
  const keys = Array.from(new Set([...a.keys(), ...b.keys()]))
  return keys
    .filter((key) => a.get(key) !== b.get(key))
    .map((key) => {
      const [scope, ...rest] = key.split('/')
      return { scope, parameter: rest.join('/'), left: a.get(key) ?? '', right: b.get(key) ?? '' }
    })
}

export function ffCompareError(left: FfDevice | undefined, right: FfDevice | undefined): string | null {
  if (!left || !right) return 'Both devices must exist'
  if (left.catalogId !== right.catalogId) return 'Devices of different types cannot be compared'
  if (left.deviceRevision !== right.deviceRevision) return 'Devices of different revisions cannot be compared'
  return null
}

// --- cable budget -----------------------------------------------------------

export type CableType = 'A' | 'B' | 'C' | 'D'
export const CABLE_MAX_M: Record<CableType, number> = { A: 1900, B: 1200, C: 400, D: 200 }

export interface CableSegment {
  type: CableType
  length: number
}

/** Trunk plus every spur: the sum of length / max length per cable type must not exceed 1. */
export function cableBudget(segments: CableSegment[], unit: 'm' | 'ft' = 'm'): { ratio: number; acceptable: boolean; error: string | null } {
  let ratio = 0
  for (const segment of segments) {
    if (!(segment.type in CABLE_MAX_M)) return { ratio: 0, acceptable: false, error: `Unknown cable type ${String(segment.type)}` }
    if (!Number.isFinite(segment.length) || segment.length < 0) return { ratio: 0, acceptable: false, error: 'Cable lengths must be finite and not negative' }
    const meters = unit === 'ft' ? segment.length * 0.3048 : segment.length
    ratio += meters / CABLE_MAX_M[segment.type]
  }
  const rounded = Math.round(ratio * 1e9) / 1e9
  return { ratio: rounded, acceptable: rounded <= 1, error: null }
}

// --- derived DSTs and the virtual bus ---------------------------------------

export function ffDstName(device: string, block: string): string {
  return `${device}/${block}/OUT`
}

export function blockCardType(type: FfBlockType): TraditionalCardType | null {
  return type === 'AI' || type === 'MAI' ? 'AI' : type === 'AO' ? 'AO' : type === 'DI' ? 'DI' : type === 'DO' ? 'DO' : null
}

/** Commissioned device I/O blocks are exposed to modules as DSTs through hidden traditional cards. */
export function syncFieldbusCards(hw: HardwareState): HardwareState {
  const cards = Object.fromEntries(Object.entries(hw.traditionalCards ?? {}).filter(([, card]) => !card.fieldbus)) as Record<string, TraditionalCard>
  const previous = new Map<string, number>()
  for (const card of Object.values(hw.traditionalCards ?? {})) if (card.fieldbus) for (const ch of card.channels) previous.set(ch.dst, ch.value)
  for (const h1 of Object.values(hw.h1Cards ?? {})) {
    for (const portId of H1_PORT_IDS) {
      for (const device of Object.values(h1.ports[portId].devices)) {
        if (device.state !== 'COMMISSIONED') continue
        for (const block of device.blocks) {
          const type = blockCardType(block.type)
          if (!type) continue
          const dst = ffDstName(device.tag, block.tag)
          const id = `${h1.id}/${portId}/${device.tag}/${block.tag}`
          cards[id] = {
            id, controllerTag: h1.controllerTag, slot: h1.slot, type,
            fieldbus: { cardId: h1.id, port: portId, device: device.tag, block: block.tag },
            channels: [{ channel: 1, dst, enabled: true, value: previous.get(dst) ?? 0, bad: true }]
          }
        }
      }
    }
  }
  return { ...hw, traditionalCards: cards }
}

function deviceComm(card: H1Card, portId: H1PortId, device: FfDevice): boolean {
  const physical = device.deviceId ? card.field[device.deviceId] : undefined
  const runtime = card.runtime[portId]
  return !!physical && physical.communicating && physical.address === device.address && runtime.liveList.includes(device.address)
}

export function fieldbusChannelBad(hw: HardwareState, card: TraditionalCard): boolean {
  const ref = card.fieldbus
  if (!ref) return false
  const h1 = hw.h1Cards?.[ref.cardId]
  const controller = h1 ? hw.controllers[h1.controllerTag] : undefined
  if (!h1 || !controller || controllerIsDown(controller) || !controller.commissioned || !h1.downloaded || h1.cardFailed) return true
  const port = h1.ports[ref.port]
  const device = port.devices[ref.device]
  const block = device?.blocks.find((b) => b.tag === ref.block)
  if (!port.enabled || !device || !block || block.mode === 'OOS' || device.resource.mode === 'OOS' || device.state !== 'COMMISSIONED') return true
  if (!deviceComm(h1, ref.port, device)) return true
  const band = h1.runtime[ref.port].bands[String(block.rateMs)]
  return !band || band.cycles < 1
}

/** Advance every downloaded H1 card by dt seconds: macrocycles, delivery, probing and LAS takeover. */
export function stepH1Cards(hw: HardwareState, dt: number): Record<string, H1Card> | undefined {
  if (!hw.h1Cards) return undefined
  const out: Record<string, H1Card> = {}
  for (const [id, card] of Object.entries(hw.h1Cards)) out[id] = card.downloaded ? stepCard(hw, card, dt) : card
  return out
}

function stepCard(hw: HardwareState, source: H1Card, dt: number): H1Card {
  const card: H1Card = { ...source, field: JSON.parse(JSON.stringify(source.field)) as Record<string, FfPhysicalDevice>, runtime: JSON.parse(JSON.stringify(source.runtime)) as Record<H1PortId, H1PortRuntime> }
  const controller = hw.controllers[source.controllerTag]
  const controllerUp = !!controller && !controllerIsDown(controller) && controller.commissioned && !source.cardFailed
  for (const portId of H1_PORT_IDS) {
    const port = source.ports[portId]
    const rt = card.runtime[portId]
    if (!port.enabled) { rt.lasAddress = null; rt.liveList = []; continue }
    const stepMs = dt * 1000
    rt.elapsedMs += stepMs
    // LAS: the card schedules while healthy; otherwise a link-master device takes over after three requested macrocycles.
    if (controllerUp) {
      rt.lasAddress = CARD_LAS_ADDRESS
      rt.lasLostMs = 0
      rt.takeoverAt = null
    } else {
      rt.lasLostMs += stepMs
      if (rt.lasAddress === CARD_LAS_ADDRESS && rt.lasLostMs >= 3 * port.requestedMacrocycleMs) {
        const backup = Object.values(port.devices)
          .filter((d) => d.state === 'COMMISSIONED' && catalogEntry(d.catalogId)?.linkMaster && deviceComm(card, portId, d))
          .sort((a, b) => a.address - b.address)[0]
        rt.lasAddress = backup ? backup.address : null
        rt.takeoverAt = backup ? rt.elapsedMs : null
      }
    }
    const lasActive = rt.lasAddress !== null
    const physical = Object.values(card.field).filter((d) => d.port === portId)
    // Live list: the LAS probes a few unlisted addresses per macrocycle; removed devices drop out at once.
    rt.liveList = rt.liveList.filter((address) => physical.some((d) => d.address === address && d.communicating))
    const bandSet = Array.from(new Set([port.requestedMacrocycleMs, ...Object.values(port.devices).flatMap((d) => d.blocks.map((b) => b.rateMs))]))
    for (const band of bandSet) {
      const key = String(band)
      const state = (rt.bands[key] ??= { elapsedMs: 0, cycles: 0, lastDeliveryMs: 0 })
      if (!lasActive) continue
      state.elapsedMs += stepMs
      const actual = actualMacrocycleMs(band, calculatedMacrocycleMs(port, band))
      while (state.elapsedMs >= actual) {
        state.elapsedMs -= actual
        state.cycles++
        state.lastDeliveryMs = rt.elapsedMs
        if (band === port.requestedMacrocycleMs) {
          rt.cycle++
          rt.tokenPasses += rt.liveList.length + 1
          for (let i = 0; i < 8; i++) {
            const address = rt.probeCursor
            rt.probeCursor = rt.probeCursor >= H1_LIMITS.lastAddress ? H1_LIMITS.firstAddress : rt.probeCursor + 1
            const found = physical.find((d) => d.address === address && d.communicating)
            if (found && !rt.liveList.includes(address)) rt.liveList.push(address)
          }
          const served = Math.min(rt.unscheduledQueued, 4)
          rt.unscheduledQueued -= served
          rt.unscheduledServed += served
        }
        deliverBand(hw, card, portId, band)
      }
    }
  }
  return card
}

function deliverBand(hw: HardwareState, card: H1Card, portId: H1PortId, band: number): void {
  const port = card.ports[portId]
  for (const device of Object.values(port.devices)) {
    if (device.state !== 'COMMISSIONED' || !deviceComm(card, portId, device)) continue
    const physical = card.field[device.deviceId as string]
    for (const block of device.blocks) {
      if (block.rateMs !== band || block.mode === 'OOS' || device.resource.mode === 'OOS') continue
      const type = blockCardType(block.type)
      if (!type) continue
      const dst = hw.traditionalCards?.[`${card.id}/${portId}/${device.tag}/${block.tag}`]
      const channel = dst?.channels[0]
      if (!channel) continue
      if (type === 'AI' || type === 'DI') channel.value = type === 'DI' ? Number(physical.sensorValue !== 0) : physical.sensorValue
      else physical.sensorValue = channel.value
    }
  }
}
