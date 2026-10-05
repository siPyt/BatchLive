import { create } from 'zustand'
import { findSecurityTarget, SECURITY_TARGETS } from './securityTargets'

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
  | UserLockType

export type UserLockNumber = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10'
export type UserLockType = `USER_LOCK_${UserLockNumber}`

export const USER_LOCKS: UserLockType[] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map(
  (n) => `USER_LOCK_${n}` as UserLockType
)

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
  'SYSTEM_ADMIN',
  ...USER_LOCKS
]

const USER_LOCK_LABELS = Object.fromEntries(USER_LOCKS.map((l) => [l, `User Lock ${l.slice(-2)}`])) as Record<UserLockType, string>
const USER_LOCK_HINTS = Object.fromEntries(
  USER_LOCKS.map((l) => [l, 'Customized security scheme: assign it to a parameter, field or function in Security Properties'])
) as Record<UserLockType, string>

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
  SYSTEM_ADMIN: 'System Admin',
  ...USER_LOCK_LABELS
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
  SYSTEM_ADMIN: 'Database administration: create, copy, rename',
  ...USER_LOCK_HINTS
}

export interface DvUser {
  name: string
  fullName: string
  password: string
  locks: LockType[]
  /** DV09-044 area write keys: areas this user is authorized for. Undefined
   * means authorized for every area (the existing unrestricted default), not
   * an empty/no-access set — restriction is opt-in per user. */
  areas?: string[]
  /** DV09-076 Advanced tab: account status. Undefined/false = enabled. */
  disabled?: boolean
  /** DV09-076 Advanced tab: password status. The user must pick a new password at next logon. */
  mustChangePassword?: boolean
}

/** DV09-077: a named group. Members inherit the group's keys (and, when the
 * member has restricted areas, the group's areas) in addition to their own. */
export interface DvGroup {
  name: string
  description: string
  locks: LockType[]
  members: string[]
  /** Undefined = the group grants no area keys; the user's own area keys apply. */
  areas?: string[]
}

export function effectiveLocks(user: DvUser | undefined, groups: DvGroup[]): LockType[] {
  if (!user) return []
  const out = new Set<LockType>(user.locks)
  for (const g of groups) {
    if (g.members.includes(user.name)) g.locks.forEach((l) => out.add(l))
  }
  return ALL_LOCKS.filter((l) => out.has(l))
}

/** undefined = unrestricted (the user has no area restriction of their own). */
export function effectiveAreas(user: DvUser | undefined, groups: DvGroup[]): string[] | undefined {
  if (!user || !user.areas) return undefined
  const out = new Set<string>(user.areas)
  for (const g of groups) {
    if (g.members.includes(user.name)) (g.areas ?? []).forEach((a) => out.add(a))
  }
  return Array.from(out)
}

export function groupsOf(user: string, groups: DvGroup[]): string[] {
  return groups.filter((g) => g.members.includes(user)).map((g) => g.name)
}

interface SecurityState {
  users: DvUser[]
  groups: DvGroup[]
  /** DV09-075: Security Properties lock reassignments keyed by SecurityTarget id; absent = the default lock. */
  lockAssignments: Record<string, LockType>
  /** name of the currently logged-on user. */
  currentUser: string
  /** FlexLock engaged — blocks the UI until a valid log on. */
  locked: boolean
  /** most recent "Access Denied" reason, consumed by a toast. */
  lastDenied: string | null
  login: (name: string, password: string) => boolean
  /** Why a logon would succeed or fail, without side effects. */
  loginStatus: (name: string, password: string) => 'ok' | 'bad' | 'disabled' | 'must-change'
  lockWorkstation: () => void
  addUser: (u: DvUser) => boolean
  deleteUser: (name: string) => void
  setUserLocks: (name: string, locks: LockType[]) => void
  /** DV09-044: set this user's area write keys; undefined restores unrestricted (all areas). */
  setUserAreas: (name: string, areas: string[] | undefined) => void
  /** DV09-076 Advanced tab. Each returns an error message, or null on success. */
  setUserStatus: (name: string, patch: { disabled?: boolean; mustChangePassword?: boolean }) => string | null
  setUserFullName: (name: string, fullName: string) => string | null
  changePassword: (name: string, oldPassword: string, newPassword: string) => string | null
  /** DV09-075: reassign (or, with undefined, restore) the lock a parameter/field/function carries. */
  setTargetLock: (targetId: string, lock: LockType | undefined) => string | null
  /** The lock currently required for an operation: its reassignment, else its default. */
  lockFor: (lock: LockType, action: string) => LockType
  /** DV09-077 groups. Each returns an error message, or null on success. */
  createGroup: (name: string, description: string) => string | null
  updateGroup: (name: string, patch: { newName?: string; description?: string }) => string | null
  deleteGroup: (name: string) => string | null
  addGroupMember: (group: string, user: string) => string | null
  removeGroupMember: (group: string, user: string) => string | null
  setGroupLocks: (group: string, locks: LockType[]) => string | null
  setGroupAreas: (group: string, areas: string[] | undefined) => string | null
  hasLock: (lock: LockType) => boolean
  /** DV09-044: true if the current user's area write keys authorize this area
   * (undefined area, e.g. an alarm whose module no longer exists, is never authorized). */
  hasAreaKey: (area: string | undefined) => boolean
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

const DEFAULT_GROUPS: DvGroup[] = [
  {
    name: 'Operate',
    description: 'Plant operators: day-to-day control and alarm handling',
    locks: ['CONTROL', 'ALARMS'],
    members: ['OperatorA', 'Supervisor1']
  }
]

export const useSecurity = create<SecurityState>((set, get) => ({
  users: DEFAULT_USERS,
  groups: DEFAULT_GROUPS,
  lockAssignments: {},
  currentUser: 'admin',
  locked: false,
  lastDenied: null,

  login: (name, password) => {
    const u = get().users.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (!u || u.password !== password) return false
    if (u.disabled) {
      set({ lastDenied: `Access Denied — account ${u.name} is disabled` })
      return false
    }
    if (u.mustChangePassword) {
      set({ lastDenied: `Access Denied — ${u.name} must change the password before logging on` })
      return false
    }
    set({ currentUser: u.name, locked: false })
    return true
  },

  loginStatus: (name, password) => {
    const u = get().users.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (!u || u.password !== password) return 'bad'
    if (u.disabled) return 'disabled'
    return u.mustChangePassword ? 'must-change' : 'ok'
  },

  lockWorkstation: () => set({ locked: true }),

  addUser: (u) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Create user ${u.name}`)) return false
    if (!u.name.trim() || get().users.some((x) => x.name.toLowerCase() === u.name.toLowerCase())) return false
    set((s) => ({ users: [...s.users, u] }))
    return true
  },

  deleteUser: (name) =>
    get().requireLock('SYSTEM_ADMIN', `Delete user ${name}`) &&
    set((s) =>
      name === s.currentUser
        ? s
        : {
            users: s.users.filter((u) => u.name !== name),
            groups: s.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== name) }))
          }
    ),

  setUserLocks: (name, locks) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Set keys of user ${name}`)) return
    set((s) => ({ users: s.users.map((u) => (u.name === name ? { ...u, locks } : u)) }))
  },

  setUserAreas: (name, areas) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Set area keys of user ${name}`)) return
    set((s) => ({ users: s.users.map((u) => (u.name === name ? { ...u, areas } : u)) }))
  },

  setUserStatus: (name, patch) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Change account status ${name}`)) return 'Requires the System Admin key'
    const u = get().users.find((x) => x.name === name)
    if (!u) return `User ${name} does not exist`
    if (patch.disabled && name === get().currentUser) return 'The logged-on user cannot disable their own account'
    set((s) => ({ users: s.users.map((x) => (x.name === name ? { ...x, ...patch } : x)) }))
    return null
  },

  setUserFullName: (name, fullName) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Edit user ${name}`)) return 'Requires the System Admin key'
    if (!get().users.some((x) => x.name === name)) return `User ${name} does not exist`
    set((s) => ({ users: s.users.map((x) => (x.name === name ? { ...x, fullName } : x)) }))
    return null
  },

  changePassword: (name, oldPassword, newPassword) => {
    const u = get().users.find((x) => x.name === name)
    if (!u) return `User ${name} does not exist`
    if (u.password !== oldPassword) return 'The current password is incorrect'
    if (!newPassword) return 'The new password cannot be blank'
    if (newPassword === oldPassword) return 'The new password must differ from the current password'
    set((s) => ({
      users: s.users.map((x) => (x.name === name ? { ...x, password: newPassword, mustChangePassword: false } : x))
    }))
    return null
  },

  createGroup: (name, description) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Create group ${name}`)) return 'Requires the System Admin key'
    const n = name.trim()
    if (!n) return 'Group name cannot be blank'
    if (get().groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) return `Group ${n} already exists`
    set((s) => ({ groups: [...s.groups, { name: n, description, locks: [], members: [] }] }))
    return null
  },

  updateGroup: (name, patch) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Modify group ${name}`)) return 'Requires the System Admin key'
    if (!get().groups.some((g) => g.name === name)) return `Group ${name} does not exist`
    const newName = patch.newName?.trim()
    if (patch.newName !== undefined) {
      if (!newName) return 'Group name cannot be blank'
      if (newName !== name && get().groups.some((g) => g.name.toLowerCase() === newName.toLowerCase())) {
        return `Group ${newName} already exists`
      }
    }
    set((s) => ({
      groups: s.groups.map((g) =>
        g.name === name
          ? { ...g, name: newName ?? g.name, description: patch.description ?? g.description }
          : g
      )
    }))
    return null
  },

  deleteGroup: (name) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Delete group ${name}`)) return 'Requires the System Admin key'
    if (!get().groups.some((g) => g.name === name)) return `Group ${name} does not exist`
    set((s) => ({ groups: s.groups.filter((g) => g.name !== name) }))
    return null
  },

  addGroupMember: (group, user) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Add ${user} to group ${group}`)) return 'Requires the System Admin key'
    const g = get().groups.find((x) => x.name === group)
    if (!g) return `Group ${group} does not exist`
    if (!get().users.some((u) => u.name === user)) return `User ${user} does not exist`
    if (g.members.includes(user)) return `${user} is already a member of ${group}`
    set((s) => ({ groups: s.groups.map((x) => (x.name === group ? { ...x, members: [...x.members, user] } : x)) }))
    return null
  },

  removeGroupMember: (group, user) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Remove ${user} from group ${group}`)) return 'Requires the System Admin key'
    const g = get().groups.find((x) => x.name === group)
    if (!g) return `Group ${group} does not exist`
    if (!g.members.includes(user)) return `${user} is not a member of ${group}`
    set((s) => ({
      groups: s.groups.map((x) => (x.name === group ? { ...x, members: x.members.filter((m) => m !== user) } : x))
    }))
    return null
  },

  setGroupLocks: (group, locks) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Set keys of group ${group}`)) return 'Requires the System Admin key'
    if (!get().groups.some((g) => g.name === group)) return `Group ${group} does not exist`
    set((s) => ({ groups: s.groups.map((g) => (g.name === group ? { ...g, locks } : g)) }))
    return null
  },

  setGroupAreas: (group, areas) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Set area keys of group ${group}`)) return 'Requires the System Admin key'
    if (!get().groups.some((g) => g.name === group)) return `Group ${group} does not exist`
    set((s) => ({ groups: s.groups.map((g) => (g.name === group ? { ...g, areas } : g)) }))
    return null
  },

  hasLock: (lock) => {
    const s = get()
    const u = s.users.find((x) => x.name === s.currentUser)
    return effectiveLocks(u, s.groups).includes(lock)
  },

  hasAreaKey: (area) => {
    const s = get()
    const u = s.users.find((x) => x.name === s.currentUser)
    if (!u) return true
    const areas = effectiveAreas(u, s.groups)
    if (!areas) return true
    return area !== undefined && areas.includes(area)
  },

  setTargetLock: (targetId, lock) => {
    if (!get().requireLock('SYSTEM_ADMIN', `Change Security Properties ${targetId}`)) return 'Requires the System Admin key'
    if (!SECURITY_TARGETS.some((x) => x.id === targetId)) return `Unknown secured item ${targetId}`
    if (lock !== undefined && !ALL_LOCKS.includes(lock)) return `Unknown lock ${String(lock)}`
    set((s) => {
      const next = { ...s.lockAssignments }
      const target = SECURITY_TARGETS.find((x) => x.id === targetId)
      if (lock === undefined || lock === target?.defaultLock) delete next[targetId]
      else next[targetId] = lock
      return { lockAssignments: next }
    })
    return null
  },

  lockFor: (lock, action) => {
    const target = findSecurityTarget(lock, action)
    return (target && get().lockAssignments[target.id]) || lock
  },

  requireLock: (lock, action) => {
    const effective = get().lockFor(lock, action)
    if (get().hasLock(effective)) return true
    const moved = effective !== lock ? ` (reassigned from ${LOCK_LABEL[lock]})` : ''
    set({ lastDenied: `Access Denied — ${action} requires the ${LOCK_LABEL[effective]} key${moved}` })
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
