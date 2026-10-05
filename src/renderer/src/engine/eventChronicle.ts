import { create } from 'zustand'
import { useStore } from './store'
import { useSecurity } from './security'
import type { EventCategory, EventLogEntry } from './types'

// ---------------------------------------------------------------------------
// DV09-045 workstation Event Chronicle: configuration (enable, workstation
// name, subscribed event types, sequence-of-events stamping) that takes effect
// only after "Download", and a persistent archive of subscribed events kept in
// this browser profile. Every archived record is chained to the previous one
// by SHA-256, so editing, deleting or reordering stored records is detected.
// This is a training archive: it is NOT a compliant or tamper-proof 21 CFR
// Part 11 record, because whoever controls the browser profile can rewrite the
// whole chain.
// ---------------------------------------------------------------------------

export const CHRONICLE_CATEGORIES: EventCategory[] = ['ALARM', 'RTN', 'ACK', 'OPERATOR', 'DIAGNOSTIC', 'SECURITY', 'BATCH', 'CONFIGURE']
export const CHRONICLE_MAX_RECORDS = 5000
export const CHRONICLE_CONFIG_KEY = 'batchlive.chronicle.config.v1'
export const CHRONICLE_ARCHIVE_KEY = 'batchlive.chronicle.archive.v1'

export interface ChronicleConfig {
  enabled: boolean
  /** Workstation name stamped on every record. */
  name: string
  subscriptions: EventCategory[]
  /** Sequence of events: every record carries a strictly increasing sequence number. */
  soe: boolean
}

export interface ChronicleRecord {
  seq: number
  /** Simulation time of the event (ms). */
  time: number
  /** Wall-clock time the record was archived (epoch ms). */
  wallTime: number
  workstation: string
  category: EventCategory
  tag: string
  user: string
  description: string
  prevHash: string
  hash: string
}

export interface ChronicleArchive {
  records: ChronicleRecord[]
  /** The hash that precedes records[0] (all zeros for a fresh archive, the last dropped hash after rollover). */
  anchor: string
  /** Total records ever archived: detects a truncated tail. */
  total: number
  /** Hash of the newest record, or the anchor when there are none. */
  head: string
}

export const GENESIS_HASH = '0'.repeat(64)

export function defaultChronicleConfig(): ChronicleConfig {
  return { enabled: false, name: 'WORKSTATION', subscriptions: ['ALARM', 'RTN', 'ACK', 'OPERATOR', 'SECURITY'], soe: true }
}

export function chronicleConfigError(config: ChronicleConfig): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(config.name)) return 'The workstation name must be 1-16 characters starting with a letter'
  if (!Array.isArray(config.subscriptions) || config.subscriptions.some((c) => !CHRONICLE_CATEGORIES.includes(c))) return 'Unknown event type in the subscriptions'
  if (new Set(config.subscriptions).size !== config.subscriptions.length) return 'Event types can only be subscribed once'
  if (config.enabled && !config.subscriptions.length) return 'Subscribe to at least one event type'
  return null
}

// --- SHA-256 (synchronous, so records are chained as they are archived) ------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const length = bytes.length
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6))
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000))
  view.setUint32(padded.length - 4, (length * 8) >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

function recordHash(r: Omit<ChronicleRecord, 'hash'>): string {
  return sha256Hex(JSON.stringify([r.seq, r.time, r.wallTime, r.workstation, r.category, r.tag, r.user, r.description, r.prevHash]))
}

export function emptyArchive(): ChronicleArchive {
  return { records: [], anchor: GENESIS_HASH, total: 0, head: GENESIS_HASH }
}

export function appendRecord(
  archive: ChronicleArchive,
  entry: Pick<EventLogEntry, 'time' | 'category' | 'tag' | 'user' | 'description'>,
  workstation: string,
  wallTime: number
): ChronicleArchive {
  const prevHash = archive.head
  const base = { seq: archive.total + 1, time: entry.time, wallTime, workstation, category: entry.category, tag: entry.tag, user: entry.user, description: entry.description, prevHash }
  const record: ChronicleRecord = { ...base, hash: recordHash(base) }
  let records = [...archive.records, record]
  let anchor = archive.anchor
  if (records.length > CHRONICLE_MAX_RECORDS) {
    anchor = records[0].hash
    records = records.slice(1)
  }
  return { records, anchor, total: record.seq, head: record.hash }
}

export interface ArchiveVerdict {
  ok: boolean
  /** Index in records of the first problem, when there is one. */
  badIndex?: number
  reason?: string
}

export function verifyArchive(archive: ChronicleArchive): ArchiveVerdict {
  let previous = archive.anchor
  let lastSeq = archive.records.length ? archive.records[0].seq - 1 : archive.total
  for (const [index, record] of archive.records.entries()) {
    if (record.prevHash !== previous) return { ok: false, badIndex: index, reason: `Record ${record.seq} is not linked to the one before it` }
    if (record.seq !== lastSeq + 1) return { ok: false, badIndex: index, reason: `Sequence gap or reorder at record ${record.seq}` }
    const { hash, ...rest } = record
    if (recordHash(rest) !== hash) return { ok: false, badIndex: index, reason: `Record ${record.seq} was changed after it was archived` }
    previous = hash
    lastSeq = record.seq
  }
  if (previous !== archive.head || lastSeq !== archive.total) return { ok: false, reason: 'The archive end does not match its recorded head: records were removed or added' }
  return { ok: true }
}

export function parseArchive(text: string | null): ChronicleArchive {
  if (!text) return emptyArchive()
  try {
    const parsed = JSON.parse(text) as Partial<ChronicleArchive>
    if (!Array.isArray(parsed.records) || typeof parsed.anchor !== 'string' || typeof parsed.total !== 'number' || typeof parsed.head !== 'string') return emptyArchive()
    return parsed as ChronicleArchive
  } catch {
    return emptyArchive()
  }
}

function parseConfig(text: string | null): ChronicleConfig | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as ChronicleConfig
    return chronicleConfigError(parsed) === null ? parsed : null
  } catch {
    return null
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

interface ChronicleState {
  /** What the administrator has configured (not yet active). */
  configured: ChronicleConfig
  /** What this workstation is running after Download. */
  deployed: ChronicleConfig | null
  archive: ChronicleArchive
  /** Id of the last event the chronicle processed. */
  lastEventId: string | null
  /** Each returns an error message, or null on success. */
  configure: (config: ChronicleConfig) => string | null
  download: () => string | null
  /** Re-read the saved archive, as after an application restart. */
  reload: () => void
  verify: () => ArchiveVerdict
  clear: () => string | null
}

function saveArchive(archive: ChronicleArchive): void {
  try {
    storage()?.setItem(CHRONICLE_ARCHIVE_KEY, JSON.stringify(archive))
  } catch {
    // The in-memory archive still exists for this session.
  }
}

export const useChronicle = create<ChronicleState>((set, get) => {
  const saved = parseConfig(storage()?.getItem(CHRONICLE_CONFIG_KEY) ?? null)
  return {
    configured: saved ?? defaultChronicleConfig(),
    deployed: saved,
    archive: parseArchive(storage()?.getItem(CHRONICLE_ARCHIVE_KEY) ?? null),
    lastEventId: null,

    configure: (config) => {
      if (!useSecurity.getState().requireLock('CAN_CONFIGURE', 'Configure event chronicle')) return 'Requires the Can Configure key'
      const error = chronicleConfigError(config)
      if (error) return error
      set({ configured: { ...config, subscriptions: [...config.subscriptions] } })
      return null
    },

    download: () => {
      if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', 'Download event chronicle')) return 'Requires the Can Download key'
      const config = get().configured
      const error = chronicleConfigError(config)
      if (error) return error
      try {
        storage()?.setItem(CHRONICLE_CONFIG_KEY, JSON.stringify(config))
      } catch {
        return 'The chronicle configuration could not be saved in this browser profile'
      }
      set({ deployed: { ...config, subscriptions: [...config.subscriptions] } })
      return null
    },

    reload: () => set({ archive: parseArchive(storage()?.getItem(CHRONICLE_ARCHIVE_KEY) ?? null) }),
    verify: () => verifyArchive(get().archive),
    clear: () => {
      if (!useSecurity.getState().requireLock('SYSTEM_ADMIN', 'Clear event chronicle')) return 'Requires the System Admin key'
      const archive = emptyArchive()
      saveArchive(archive)
      set({ archive })
      return null
    }
  }
})

/** Archive the new journal entries that match the downloaded subscriptions. */
export function archiveNewEvents(entries: EventLogEntry[], wallTime = Date.now()): void {
  const state = useChronicle.getState()
  const deployed = state.deployed
  if (!entries.length) return
  const lastIndex = state.lastEventId === null ? -1 : entries.findIndex((e) => e.id === state.lastEventId)
  const fresh = entries.slice(lastIndex + 1)
  const newest = entries[entries.length - 1].id
  if (!deployed || !deployed.enabled) {
    useChronicle.setState({ lastEventId: newest })
    return
  }
  let archive = state.archive
  let changed = false
  for (const entry of fresh) {
    if (!deployed.subscriptions.includes(entry.category)) continue
    archive = appendRecord(archive, entry, deployed.name, wallTime)
    changed = true
  }
  if (changed) saveArchive(archive)
  useChronicle.setState({ archive, lastEventId: newest })
}

let started = false
/** Follow the event journal from now on. Called once at start-up. */
export function startChronicle(): void {
  if (started) return
  started = true
  const log = useStore.getState().eventLog
  useChronicle.setState({ lastEventId: log.length ? log[log.length - 1].id : null })
  useStore.subscribe((state, previous) => {
    if (state.eventLog !== previous.eventLog) archiveNewEvents(state.eventLog)
  })
}

startChronicle()
