import type { DisplayId } from '../ui/uiStore'
import type { LockType } from './security'

/** DV09-003: the DeltaV applications from the course (pp37-50) and the BatchLive display that stands in for each one. */
export type ApplicationRole = 'Operate' | 'Engineering' | 'Diagnostics' | 'Administration' | 'Training'

export interface DeltaVApplication {
  id: string
  /** The native DeltaV application or workflow it represents. */
  native: string
  role: ApplicationRole
  /** The simulator display that executes the real actions. */
  display: DisplayId
  /** What the display really does, in the native application's terms. */
  does: string[]
  /** Native behaviour that is not reproduced; never hidden behind a decorative menu. */
  notSupported: string[]
  /** Keys that gate the display's real actions. */
  keys: LockType[]
}

export const DELTAV_APPLICATIONS: DeltaVApplication[] = [
  {
    id: 'operate-run', native: 'DeltaV Operate (Run mode)', role: 'Operate', display: 'overview',
    does: ['Navigate process pictures, open faceplates, change setpoints, modes and outputs, acknowledge alarms'],
    notSupported: ['Native picture files and the Windows desktop shell', 'Operate toolbar customisation'],
    keys: ['CONTROL', 'ALARMS']
  },
  {
    id: 'operate-configure', native: 'DeltaV Operate (Configure mode) / Graphics Studio', role: 'Engineering', display: 'builder',
    does: ['Create and edit pictures, dynamics, datalinks, dynamo assignments and navigation; save and load pictures'],
    notSupported: ['Native .grf/.fhx files and the full Graphics Studio toolbox', 'Dynamo library import'],
    keys: ['CAN_CONFIGURE']
  },
  {
    id: 'explorer', native: 'DeltaV Explorer', role: 'Engineering', display: 'explorer',
    does: ['Browse Area > Process Cell > Unit > Equipment > Control hierarchy, create modules, Setup (named sets, alarm types, security, signatures, export), Licensing Properties'],
    notSupported: ['Drag-and-drop of modules between units', 'Native Explorer dialogs and the System tree for every node type'],
    keys: ['CAN_CONFIGURE', 'CAN_DOWNLOAD']
  },
  {
    id: 'control-studio', native: 'Control Studio', role: 'Engineering', display: 'studio',
    does: ['Open modules, edit parameters and alarms, wire function blocks, save, download and go online'],
    notSupported: ['Clipboard and native palette/filter workflows', 'Unmanaged algorithm lifecycle parity'],
    keys: ['CAN_CONFIGURE', 'CAN_DOWNLOAD']
  },
  {
    id: 'sfc', native: 'SFC editor (Control Studio)', role: 'Engineering', display: 'sfc',
    does: ['Build steps, transitions, actions and qualifiers, run and hold charts'],
    notSupported: ['Native graph palette and layout', 'Full expression language'],
    keys: ['CAN_CONFIGURE', 'BATCH_OPERATE']
  },
  {
    id: 'diagnostics', native: 'DeltaV Diagnostics', role: 'Diagnostics', display: 'hardware',
    does: ['Identify, commission, auto-sense, power loss and restore controllers; pull and reinsert CHARMs; traditional, serial and fieldbus cards'],
    notSupported: ['Real hardware discovery and firmware views', 'Windows event diagnostics'],
    keys: ['DIAGNOSTIC', 'CAN_CONFIGURE']
  },
  {
    id: 'user-manager', native: 'User Manager', role: 'Administration', display: 'users',
    does: ['Create users and groups, keys, area keys, account status, password policy and expiry, workstation download'],
    notSupported: ['Windows/domain accounts', 'Smart card or biometric logon'],
    keys: ['SYSTEM_ADMIN']
  },
  {
    id: 'system-preferences', native: 'System Preferences and Database Administrator', role: 'Administration', display: 'system',
    does: ['Hidden features, server shutdown/connect and the local simulator controls'],
    notSupported: ['A real database server and client connections', 'DeltaV Simulate licensing'],
    keys: ['SYSTEM_ADMIN']
  },
  {
    id: 'batch', native: 'Batch Operator Interface and Recipe Studio', role: 'Operate', display: 'batch',
    does: ['Start, hold, restart, stop and abort a batch; select and edit recipes'],
    notSupported: ['DeltaV Batch Executive services and unit procedures', 'Batch history and reporting'],
    keys: ['BATCH_OPERATE', 'BUILD_RECIPES']
  },
  {
    id: 'alarms', native: 'Alarm List and Alarm Banner', role: 'Operate', display: 'alarms',
    does: ['View, filter, sort, acknowledge and shelve alarms with area subscription boundaries'],
    notSupported: ['Native column persistence per workstation', 'Alarm horn hardware'],
    keys: ['ALARMS']
  },
  {
    id: 'history', native: 'Process History View', role: 'Operate', display: 'trend',
    does: ['Trend live values with scale and time controls'],
    notSupported: ['A continuous historian database and archived data retrieval'],
    keys: []
  },
  {
    id: 'event-journal', native: 'Event Journal and Event Chronicle', role: 'Operate', display: 'journal',
    does: ['Review events, configure the workstation chronicle and verify the archive'],
    notSupported: ['A compliant tamper-proof archive', 'Remote subscription to other nodes'],
    keys: ['CAN_CONFIGURE']
  },
  {
    id: 'workshops', native: 'DV-09 course workshops', role: 'Training', display: 'workshops',
    does: ['Step-by-step exercises, with evidence-based checking for the commissioning workshop'],
    notSupported: ['Automatic checking for every workshop', 'The printed manual screenshots'],
    keys: []
  }
]

export function applicationFor(display: DisplayId): DeltaVApplication | undefined {
  return DELTAV_APPLICATIONS.find((a) => a.display === display)
}

export function applicationsByRole(): Record<ApplicationRole, DeltaVApplication[]> {
  const groups: Record<ApplicationRole, DeltaVApplication[]> = { Operate: [], Engineering: [], Diagnostics: [], Administration: [], Training: [] }
  for (const app of DELTAV_APPLICATIONS) groups[app.role].push(app)
  return groups
}
