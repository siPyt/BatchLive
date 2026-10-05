import { create } from 'zustand'
import { registerServerGate, useSecurity } from './security'

// ---------------------------------------------------------------------------
// DeltaV System Preferences and Database Administrator (DV-09 chapters 8 and
// 12). Some system features are hidden until they are enabled in System
// Preferences; the change stays pending until the database server is shut
// down and reconnected. Open database applications block both steps. This is
// a simulated database server: it models state transitions and rights, not a
// real DeltaV database.
// ---------------------------------------------------------------------------

export type SystemFeature = 'fieldbus' | 'signaturePolicies'
export const SYSTEM_FEATURES: SystemFeature[] = ['fieldbus', 'signaturePolicies']

export const FEATURE_LABEL: Record<SystemFeature, string> = {
  fieldbus: 'FOUNDATION fieldbus (H1 cards, device library and device alarms)',
  signaturePolicies: 'Electronic Signature policies'
}

export type ServerState = 'RUNNING' | 'STOPPED'

export interface SystemState {
  /** Features that are active in the running system. */
  features: Record<SystemFeature, boolean>
  /** Selections made in System Preferences that take effect after a server restart. */
  pending: Partial<Record<SystemFeature, boolean>>
  /** The administrator has acknowledged the pending changes dialog. */
  acknowledged: boolean
  serverState: ServerState
  restarts: number
  /** Database applications that are open (Explorer, Control Studio, Display Builder, ...). */
  clients: string[]
  registerClient: (name: string) => void
  closeClient: (name: string) => void
  closeAllClients: () => void
  /** Each returns an error message, or null on success. */
  setPendingFeature: (feature: SystemFeature, enabled: boolean) => string | null
  acknowledgePending: () => string | null
  shutdownServer: () => string | null
  connectServer: () => string | null
}

const STORAGE_KEY = 'batchlive.system.v1'

function noFeatures(): Record<SystemFeature, boolean> {
  return { fieldbus: false, signaturePolicies: false }
}

function load(): Pick<SystemState, 'features' | 'pending' | 'acknowledged'> {
  const empty = { features: noFeatures(), pending: {}, acknowledged: false }
  try {
    if (typeof localStorage === 'undefined') return empty
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<Pick<SystemState, 'features' | 'pending' | 'acknowledged'>>
    const features = noFeatures()
    for (const f of SYSTEM_FEATURES) features[f] = parsed.features?.[f] === true
    const pending: Partial<Record<SystemFeature, boolean>> = {}
    for (const f of SYSTEM_FEATURES) if (typeof parsed.pending?.[f] === 'boolean') pending[f] = parsed.pending[f]
    return { features, pending, acknowledged: parsed.acknowledged === true && Object.keys(pending).length > 0 }
  } catch {
    return empty
  }
}

function persist(state: Pick<SystemState, 'features' | 'pending' | 'acknowledged'>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The state still applies for this session.
  }
}

function admin(action: string): string | null {
  return useSecurity.getState().requireLock('SYSTEM_ADMIN', action) ? null : 'Requires the System Admin key'
}

function openClientsError(clients: string[], action: string): string | null {
  return clients.length ? `Close the database applications before you ${action}: ${clients.join(', ')}` : null
}

export const useSystem = create<SystemState>((set, get) => ({
  ...load(),
  serverState: 'RUNNING',
  restarts: 0,
  clients: [],

  registerClient: (name) => set((s) => (s.clients.includes(name) ? s : { clients: [...s.clients, name] })),
  closeClient: (name) => set((s) => ({ clients: s.clients.filter((c) => c !== name) })),
  closeAllClients: () => set({ clients: [] }),

  setPendingFeature: (feature, enabled) => {
    const denied = admin(`Change System Preferences ${feature}`)
    if (denied) return denied
    if (!SYSTEM_FEATURES.includes(feature)) return `Unknown system feature ${String(feature)}`
    const s = get()
    if (s.serverState !== 'RUNNING') return 'The database server is stopped; connect to the server first'
    const open = openClientsError(s.clients, 'change System Preferences')
    if (open) return open
    const pending = { ...s.pending }
    if (s.features[feature] === enabled) delete pending[feature]
    else pending[feature] = enabled
    const next = { features: s.features, pending, acknowledged: false }
    persist(next)
    set({ pending, acknowledged: false })
    return null
  },

  acknowledgePending: () => {
    const denied = admin('Acknowledge System Preferences changes')
    if (denied) return denied
    if (!Object.keys(get().pending).length) return 'There are no pending preference changes'
    persist({ features: get().features, pending: get().pending, acknowledged: true })
    set({ acknowledged: true })
    return null
  },

  shutdownServer: () => {
    const denied = admin('Shut down the database server')
    if (denied) return denied
    const s = get()
    if (s.serverState !== 'RUNNING') return 'The database server is already stopped'
    const open = openClientsError(s.clients, 'shut down the server')
    if (open) return open
    if (Object.keys(s.pending).length && !s.acknowledged) return 'Acknowledge the pending preference changes before you shut down the server'
    set({ serverState: 'STOPPED' })
    return null
  },

  connectServer: () => {
    const denied = admin('Connect to the database server')
    if (denied) return denied
    const s = get()
    if (s.serverState !== 'STOPPED') return 'The database server is already running'
    const features = { ...s.features, ...s.pending } as Record<SystemFeature, boolean>
    persist({ features, pending: {}, acknowledged: false })
    set({ serverState: 'RUNNING', features, pending: {}, acknowledged: false, restarts: s.restarts + 1 })
    return null
  }
}))

/** True when the feature is active in the running system (a pending selection does not count). */
export function featureEnabled(feature: SystemFeature): boolean {
  return useSystem.getState().features[feature]
}

export function featureDisabledError(feature: SystemFeature): string {
  return `${FEATURE_LABEL[feature]} is not enabled. Enable it in System Preferences, then shut down and reconnect the database server.`
}

registerServerGate(() => useSystem.getState().serverState)
