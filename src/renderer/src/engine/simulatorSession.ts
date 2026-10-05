import { create } from 'zustand'
import { controllerIsDown, type HardwareState } from './hardware'
import type { AnyModule, PlantState } from './types'

/** Time scaling accepted by the local simulator; the quick-pick presets are shown in the top bar. */
export const SCALE_MIN = 0.1
export const SCALE_MAX = 20
export const SCALE_PRESETS = [0.5, 1, 2, 5, 10]

export type NodeMode = 'single' | 'multi'
export type TestMode = 'continuous' | 'batch'

export const NODE_MODE_LABEL: Record<NodeMode, string> = {
  single: 'Single node (readiness checked for one controller)',
  multi: 'Multi-node (readiness checked for every controller)'
}
export const TEST_MODE_LABEL: Record<TestMode, string> = {
  continuous: 'Continuous process testing',
  batch: 'Batch testing (SFC / batch procedure)'
}

/** Stated wherever the simulator is described so it is never mistaken for vendor DeltaV Simulate. */
export const SIMULATOR_DISCLOSURE =
  'BatchLive runs one local simulation loop. It is not DeltaV Simulate: there are no Simulate licenses, no OPC or ' +
  'network connection to PPN/PSN/ASN/PRO nodes, and "nodes" are the controllers configured on the Physical Network, ' +
  'all executed by this loop on one shared clock. The node mode scopes the readiness checks; it does not isolate execution.'

export function validateScale(value: number): string | null {
  if (!Number.isFinite(value)) return 'Time scale must be a number'
  if (value < SCALE_MIN || value > SCALE_MAX) return `Time scale must be between ${SCALE_MIN}x and ${SCALE_MAX}x`
  return null
}

export interface SimulatorSettings {
  nodeMode: NodeMode
  testMode: TestMode
  /** Node tag under test; only meaningful in single-node mode. */
  nodeUnderTest: string | null
  lastInitialized: { simTime: number; wallTime: number; user: string } | null
}

const STORAGE_KEY = 'batchlive.simulator.v1'
const DEFAULT: SimulatorSettings = { nodeMode: 'multi', testMode: 'continuous', nodeUnderTest: null, lastInitialized: null }

function load(): SimulatorSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT }
    const value = JSON.parse(raw) as Partial<SimulatorSettings>
    const last = value.lastInitialized
    return {
      nodeMode: value.nodeMode === 'single' ? 'single' : 'multi',
      testMode: value.testMode === 'batch' ? 'batch' : 'continuous',
      nodeUnderTest: typeof value.nodeUnderTest === 'string' ? value.nodeUnderTest : null,
      lastInitialized: last && typeof last.simTime === 'number' && typeof last.wallTime === 'number' && typeof last.user === 'string' ?
        { simTime: last.simTime, wallTime: last.wallTime, user: last.user } : null
    }
  } catch {
    return { ...DEFAULT }
  }
}

function save(settings: SimulatorSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable: the settings simply do not persist */
  }
}

interface SimulatorState extends SimulatorSettings {
  setNodeMode: (mode: NodeMode, nodeUnderTest?: string | null) => string | null
  setTestMode: (mode: TestMode) => void
  recordInitialized: (simTime: number, user: string) => void
  /** Reload from storage (used by tests that clear storage between cases). */
  reload: () => void
}

export const useSimulator = create<SimulatorState>((set, get) => ({
  ...load(),
  setNodeMode: (mode, nodeUnderTest = null) => {
    if (mode === 'single' && !nodeUnderTest) return 'Choose the controller node under test'
    const next = { ...get(), nodeMode: mode, nodeUnderTest: mode === 'single' ? nodeUnderTest : null }
    set({ nodeMode: next.nodeMode, nodeUnderTest: next.nodeUnderTest })
    save(settingsOf(next))
    return null
  },
  setTestMode: mode => {
    set({ testMode: mode })
    save(settingsOf({ ...get(), testMode: mode }))
  },
  recordInitialized: (simTime, user) => {
    const lastInitialized = { simTime, wallTime: Date.now(), user }
    set({ lastInitialized })
    save(settingsOf({ ...get(), lastInitialized }))
  },
  reload: () => set(load())
}))

function settingsOf(s: SimulatorSettings): SimulatorSettings {
  return { nodeMode: s.nodeMode, testMode: s.testMode, nodeUnderTest: s.nodeUnderTest, lastInitialized: s.lastInitialized }
}

export interface NodeStatus {
  tag: string
  executing: boolean
  reason: string
}

/** Which configured controllers execute under the chosen node mode, and why not when they do not. */
export function nodeStatuses(hardware: HardwareState, settings: Pick<SimulatorSettings, 'nodeMode' | 'nodeUnderTest'>): NodeStatus[] {
  return Object.values(hardware.controllers).map(controller => {
    const down = controllerIsDown(controller)
    const excluded = settings.nodeMode === 'single' && settings.nodeUnderTest !== controller.tag
    const reason = excluded ? 'Not the node under test' : down ? 'Not commissioned or failed' : 'Executing'
    return { tag: controller.tag, executing: !excluded && !down, reason }
  })
}

export interface ReadinessIssue { severity: 'blocking' | 'note'; text: string }

/** Pre-run checks for the chosen test mode; blocking issues mean the test cannot be meaningfully started. */
export function testReadiness(
  state: Pick<PlantState, 'modules'> & { hardware: HardwareState; sfcs: Record<string, unknown> },
  settings: Pick<SimulatorSettings, 'nodeMode' | 'testMode' | 'nodeUnderTest'>
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = []
  const nodes = nodeStatuses(state.hardware, settings)
  const executing = nodes.filter(node => node.executing)
  if (nodes.length === 0) issues.push({ severity: 'note', text: 'No controllers are configured; modules run without a Physical Network node.' })
  else if (executing.length === 0) issues.push({ severity: 'blocking', text: 'No controller node is executing; commission the node under test.' })
  if (settings.nodeMode === 'single' && settings.nodeUnderTest && !state.hardware.controllers[settings.nodeUnderTest])
    issues.push({ severity: 'blocking', text: `Node under test ${settings.nodeUnderTest} no longer exists` })
  const undownloaded = Object.values(state.modules as Record<string, AnyModule>).filter(module => (module as { downloaded?: boolean }).downloaded === false)
  if (undownloaded.length) issues.push({ severity: 'note', text: `${undownloaded.length} module(s) are not downloaded and will not execute their deployed logic.` })
  if (settings.testMode === 'batch' && Object.keys(state.sfcs).length === 0)
    issues.push({ severity: 'blocking', text: 'Batch testing needs at least one SFC procedure.' })
  return issues
}

export interface ScaleSample { wallMs: number; simMs: number }

/** Achieved simulated-seconds per real-second over a window of samples; null until two samples exist. */
export function achievedScale(samples: ScaleSample[]): number | null {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  const wall = last.wallMs - first.wallMs
  return wall > 0 ? (last.simMs - first.simMs) / wall : null
}
