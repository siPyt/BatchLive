import { create } from 'zustand'
import { useStore } from './store'
import { dstUsage } from './dstUsage'
import { registerDownloadGate, useSecurity } from './security'
import { findSecurityTarget } from './securityTargets'
import type { TraditionalCardType } from './traditionalIo'

/** DV09-054 simulated DST licensing: a System ID Key, license files that must match it, capacity, AO-for-AI substitution and download enforcement. */
export type DstCounts = Record<TraditionalCardType, number>
export const DST_TYPES: TraditionalCardType[] = ['AI', 'AO', 'DI', 'DO']

export const SYSTEM_ID_KEY_NUMBER = 4217
export const MAX_FILE_CAPACITY = 100_000

export interface LicenseFile {
  /** Must equal the number on the System ID Key. */
  fileNumber: number
  capacity: DstCounts
  loadedAt: number
}

export interface LicenseRow {
  type: TraditionalCardType
  used: number
  licensed: number
  /** AI only: usage covered by otherwise unused AO licenses (the course's substitution example). */
  substituted: number
  shortfall: number
}

export interface LicenseReport {
  /** False until a license file is loaded: the training system is unlicensed and not enforced. */
  enforced: boolean
  rows: LicenseRow[]
  /** Unused AO licenses left after substituting for AI. */
  spareAo: number
  shortfall: boolean
}

export const zeroCounts = (): DstCounts => ({ AI: 0, AO: 0, DI: 0, DO: 0 })

export function totalCapacity(files: readonly LicenseFile[]): DstCounts {
  const total = zeroCounts()
  for (const file of files) for (const type of DST_TYPES) total[type] += file.capacity[type]
  return total
}

/** Compare usage with capacity. An AO license may cover an AI requirement; no other substitution is assumed. */
export function licenseReport(used: DstCounts, files: readonly LicenseFile[]): LicenseReport {
  const capacity = totalCapacity(files)
  const enforced = files.length > 0
  const aoShortfall = Math.max(0, used.AO - capacity.AO)
  const spareAo = Math.max(0, capacity.AO - used.AO)
  const aiOver = Math.max(0, used.AI - capacity.AI)
  const substituted = Math.min(aiOver, spareAo)
  const rows: LicenseRow[] = DST_TYPES.map((type) => {
    const over = Math.max(0, used[type] - capacity[type])
    if (type === 'AI') return { type, used: used.AI, licensed: capacity.AI, substituted, shortfall: over - substituted }
    return { type, used: used[type], licensed: capacity[type], substituted: 0, shortfall: type === 'AO' ? aoShortfall : over }
  })
  return { enforced, rows, spareAo: spareAo - substituted, shortfall: enforced && rows.some((r) => r.shortfall > 0) }
}

export function licenseFileError(fileNumber: number, capacity: DstCounts, existing: readonly LicenseFile[], keyNumber: number): string | null {
  if (!Number.isInteger(fileNumber) || fileNumber <= 0) return 'The license file number must be a positive whole number'
  if (fileNumber !== keyNumber) return `The license file number ${fileNumber} does not match the System ID Key number ${keyNumber}`
  if (existing.some((f) => f.fileNumber === fileNumber && JSON.stringify(f.capacity) === JSON.stringify(capacity)))
    return 'An identical license file is already loaded'
  for (const type of DST_TYPES) {
    const v = capacity[type]
    if (!Number.isInteger(v) || v < 0 || v > MAX_FILE_CAPACITY) return `${type} capacity must be a whole number from 0 to ${MAX_FILE_CAPACITY}`
  }
  if (DST_TYPES.every((t) => capacity[t] === 0)) return 'A license file must license at least one DST'
  return null
}

const STORAGE_KEY = 'batchlive.licensing.v1'
interface Persisted { keyPresent: boolean; files: LicenseFile[] }
function load(): Persisted {
  try {
    if (typeof localStorage === 'undefined') return { keyPresent: true, files: [] }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { keyPresent: true, files: [] }
    const value = JSON.parse(raw) as Partial<Persisted>
    const files = Array.isArray(value.files) ? value.files.filter((f): f is LicenseFile =>
      !!f && Number.isInteger(f.fileNumber) && !!f.capacity && DST_TYPES.every((t) => Number.isInteger(f.capacity[t]))) : []
    return { keyPresent: value.keyPresent !== false, files }
  } catch {
    return { keyPresent: true, files: [] }
  }
}
function save(state: Persisted): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable: licensing simply does not persist */
  }
}

interface LicensingState extends Persisted {
  keyNumber: number
  loadFile: (fileNumber: number, capacity: DstCounts) => string | null
  removeFile: (index: number) => string | null
  setKeyPresent: (present: boolean) => string | null
  reload: () => void
}

export const useLicensing = create<LicensingState>((set, get) => ({
  ...load(),
  keyNumber: SYSTEM_ID_KEY_NUMBER,
  loadFile: (fileNumber, capacity) => {
    if (!useSecurity.getState().requireLock('SYSTEM_ADMIN', `Load license file ${fileNumber}`)) return 'Requires the System Admin key'
    const error = licenseFileError(fileNumber, capacity, get().files, get().keyNumber)
    if (error) return error
    const files = [...get().files, { fileNumber, capacity: { ...capacity }, loadedAt: Date.now() }]
    set({ files })
    save({ keyPresent: get().keyPresent, files })
    return null
  },
  removeFile: (index) => {
    if (!useSecurity.getState().requireLock('SYSTEM_ADMIN', `Remove license file ${index + 1}`)) return 'Requires the System Admin key'
    if (!get().files[index]) return 'That license file is not loaded'
    const files = get().files.filter((_, i) => i !== index)
    set({ files })
    save({ keyPresent: get().keyPresent, files })
    return null
  },
  setKeyPresent: (present) => {
    if (!useSecurity.getState().requireLock('SYSTEM_ADMIN', present ? 'Insert System ID Key' : 'Remove System ID Key')) return 'Requires the System Admin key'
    set({ keyPresent: present })
    save({ keyPresent: present, files: get().files })
    return null
  },
  reload: () => set({ ...load() })
}))

/** DST usage of the live project, as the Licensing Properties report counts it. */
export function currentUsage(): DstCounts {
  const { hardware, modules } = useStore.getState()
  const byType = dstUsage(hardware, modules).byType
  return { AI: byType.AI.referenced, AO: byType.AO.referenced, DI: byType.DI.referenced, DO: byType.DO.referenced }
}

const SHORTFALL_GATED = new Set(['fn-download', 'fn-serial-download', 'fn-h1-download'])

/** Why a configuration download is refused right now, or null. Registered with the security store at start-up. */
export function downloadRefusal(action: string): string | null {
  const { keyPresent, files } = useLicensing.getState()
  if (!keyPresent) return 'the System ID Key is not installed on this workstation, so configuration downloads are not permitted'
  const target = findSecurityTarget('CAN_DOWNLOAD', action)
  if (target && SHORTFALL_GATED.has(target.id)) {
    const report = licenseReport(currentUsage(), files)
    if (report.shortfall) {
      const short = report.rows.filter((r) => r.shortfall > 0).map((r) => `${r.type} needs ${r.used}, licensed ${r.licensed}${r.substituted ? ` (+${r.substituted} AO substituted)` : ''}`)
      return `DST license shortfall: ${short.join('; ')}`
    }
  }
  return null
}

registerDownloadGate(downloadRefusal)
