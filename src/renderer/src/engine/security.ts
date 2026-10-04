import { create } from 'zustand'

// ---------------------------------------------------------------------------
// DeltaV Security: Locks & Keys, Users, FlexLock.
// Mirrors Course DV-09 "DeltaV Security": parameters/actions carry a lock,
// users hold a set of keys, and a write is only permitted when the logged-on
// user's keys include the lock required for that action.
// ---------------------------------------------------------------------------

export type LockType =
  | 'CONTROL'
  | 'RESTRICTED_CONTROL'
  | 'TUNING'
  | 'SYSTEM_RECORDS'
  | 'DIAGNOSTIC'
  | 'ALARMS'
  | 'BATCH_OPERATE'
  | 'BUILD_RECIPES'
  | 'CAN_CALIBRATE'
  | 'CAN_CONFIGURE'
  | 'CAN_DOWNLOAD'
  | 'SYSTEM_ADMIN'

export const ALL_LOCKS: LockType[] = [
  'CONTROL',
  'RESTRICTED_CONTROL',
  'TUNING',
  'SYSTEM_RECORDS',
  'DIAGNOSTIC',
  'ALARMS',
  'BATCH_OPERATE',
  'BUILD_RECIPES',
  'CAN_CALIBRATE',
  'CAN_CONFIGURE',
  'CAN_DOWNLOAD',
  'SYSTEM_ADMIN'
]

export const LOCK_LABEL: Record<LockType, string> = {
  CONTROL: 'Control',
  RESTRICTED_CONTROL: 'Restricted Control',
  TUNING: 'Tuning',
  SYSTEM_RECORDS: 'System Records',
  DIAGNOSTIC: 'Diagnostic',
  ALARMS: 'Alarms',
  BATCH_OPERATE: 'Batch Operate',
  BUILD_RECIPES: 'Build Recipes',
  CAN_CALIBRATE: 'Can Calibrate',
  CAN_CONFIGURE: 'Can Configure',
  CAN_DOWNLOAD: 'Can Download',
  SYSTEM_ADMIN: 'System Admin'
}

export const LOCK_HINT: Record<LockType, string> = {
  CONTROL: 'MODE, SP, OUT — day-to-day operator writes',
  RESTRICTED_CONTROL: 'BKCAL_IN, FF_ENABLE, interlock/permissive overrides',
  TUNING: 'GAIN, RESET, HI_LIM — controller tuning',
  SYSTEM_RECORDS: 'ENAB and other system record fields',
  DIAGNOSTIC: 'Diagnostic information maintained by the system',
  ALARMS: 'HORN, MACK, NALM — acknowledge / alarm handling',
  BATCH_OPERATE: 'Operate the DeltaV Batch subsystem',
  BUILD_RECIPES: 'Use Recipe Studio',
  CAN_CALIBRATE: 'AMS device configuration and calibration',
  CAN_CONFIGURE: 'Change the configuration database (new/delete modules)',
  CAN_DOWNLOAD: 'Download configurations to nodes',
  SYSTEM_ADMIN: 'Database administration: create, copy, rename'
}

export interface DvUser {
  name: string
  fullName: string
  password: string
  locks: LockType[]
}

interface SecurityState {
  users: DvUser[]
  /** name of the currently logged-on user. */
  currentUser: string
  /** FlexLock engaged — blocks the UI until a valid log on. */
  locked: boolean
  /** most recent "Access Denied" reason, consumed by a toast. */
  lastDenied: string | null
  login: (name: string, password: string) => boolean
  lockWorkstation: () => void
  addUser: (u: DvUser) => boolean
  deleteUser: (name: string) => void
  setUserLocks: (name: string, locks: LockType[]) => void
  hasLock: (lock: LockType) => boolean
  /** Checks the current user's keys; records an Access Denied reason if missing. */
  requireLock: (lock: LockType, action: string) => boolean
  clearDenied: () => void
}

// Seeded from the DV-09 "Defining Users" workshop (OperatorA / Supervisor1)
// plus full-access accounts so nothing is locked out of the box.
const DEFAULT_USERS: DvUser[] = [
  { name: 'admin', fullName: 'Administrator', password: 'admin123', locks: [...ALL_LOCKS] },
  { name: 'ENGINEER', fullName: 'System Engineer', password: 'engineer', locks: [...ALL_LOCKS] },
  {
    name: 'Supervisor1',
    fullName: 'Sarge Supervisor',
    password: 'supervisor1',
    locks: ['CONTROL', 'RESTRICTED_CONTROL', 'TUNING', 'ALARMS', 'BATCH_OPERATE', 'CAN_DOWNLOAD']
  },
  {
    name: 'OperatorA',
    fullName: 'Alpha Operator',
    password: 'operatora',
    locks: ['CONTROL', 'ALARMS', 'BATCH_OPERATE']
  }
]

export const useSecurity = create<SecurityState>((set, get) => ({
  users: DEFAULT_USERS,
  currentUser: 'admin',
  locked: false,
  lastDenied: null,

  login: (name, password) => {
    const u = get().users.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (!u || u.password !== password) return false
    set({ currentUser: u.name, locked: false })
    return true
  },

  lockWorkstation: () => set({ locked: true }),

  addUser: (u) => {
    if (!u.name.trim() || get().users.some((x) => x.name.toLowerCase() === u.name.toLowerCase())) return false
    set((s) => ({ users: [...s.users, u] }))
    return true
  },

  deleteUser: (name) =>
    set((s) => (name === s.currentUser ? s : { users: s.users.filter((u) => u.name !== name) })),

  setUserLocks: (name, locks) =>
    set((s) => ({ users: s.users.map((u) => (u.name === name ? { ...u, locks } : u)) })),

  hasLock: (lock) => {
    const s = get()
    const u = s.users.find((x) => x.name === s.currentUser)
    return !!u && u.locks.includes(lock)
  },

  requireLock: (lock, action) => {
    if (get().hasLock(lock)) return true
    set({ lastDenied: `Access Denied — ${action} requires the ${LOCK_LABEL[lock]} key` })
    return false
  },

  clearDenied: () => set({ lastDenied: null })
}))

export function requireUnlockedKey(lock: LockType, action: string): boolean {
  if (useSecurity.getState().locked) {
    useSecurity.setState({ lastDenied: `Access Denied — ${action} requires an unlocked workstation` })
    return false
  }
  return useSecurity.getState().requireLock(lock, action)
}
