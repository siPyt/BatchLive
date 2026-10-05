import type { LockType } from './security'

// ---------------------------------------------------------------------------
// DeltaV Security Properties (DV-09 chapter 8): every writable parameter,
// writable field and secured function carries a lock, and an administrator can
// reassign it in System Configuration > Setup > Security > Parameter / Field /
// Function Security. Every permission check in the app already passes its
// default lock and a human action label to requireLock(); this registry names
// each secured operation, so a reassigned lock is honoured at every entry
// point without touching the call sites.
// ---------------------------------------------------------------------------

export type SecurityTargetKind = 'parameter' | 'field' | 'function'

export interface SecurityTarget {
  id: string
  kind: SecurityTargetKind
  label: string
  /** The lock the operation carries until an administrator reassigns it. */
  defaultLock: LockType
  /** Matches the action label passed to requireLock (together with defaultLock). */
  pattern: RegExp
}

const t = (
  kind: SecurityTargetKind,
  id: string,
  label: string,
  defaultLock: LockType,
  pattern: RegExp
): SecurityTarget => ({ id, kind, label, defaultLock, pattern })

export const SECURITY_TARGETS: SecurityTarget[] = [
  // Writable parameters
  t('parameter', 'param-sp', 'SP (setpoint) of a control module', 'CONTROL', /^Set Setpoint /),
  t('parameter', 'param-mode', 'MODE of a module or AO', 'CONTROL', /^Set (Mode .+|.+ mode)$/),
  t('parameter', 'param-output', 'OUT (output) of a control module', 'CONTROL', /^Set Output /),
  t('parameter', 'param-device-command', 'Device command (Start, Stop, Open, Close)', 'CONTROL', /^(Start|Stop|Open|Close) (?!sanitation)/),
  t('parameter', 'param-named-set-entry', 'Named Set data entry', 'CONTROL', /^Named Set data entry /),
  t('parameter', 'param-ao-out', 'AO SP / OUT', 'CONTROL', /^Write .+ AO setpoint\/output$/),
  t('parameter', 'param-named', 'Named module parameter (module/parameter)', 'CONTROL', /^Write \S+\/\S+$/),
  t('parameter', 'param-picture-entry', 'Picture numeric data entry', 'CONTROL', /^Picture numeric entry /),
  t('parameter', 'param-tuning', 'GAIN, RESET, RATE, HI_LIM (tuning)', 'TUNING', /^Tune /),
  t('parameter', 'param-tune-test', 'PID Tune Test: run and review', 'TUNING', /^(Test|Review Test) /),
  t('parameter', 'param-tune-test-control', 'PID Tune Test: step the output', 'CONTROL', /^Test /),
  t('parameter', 'param-alarm-limit', 'Alarm limit, priority and enable', 'RESTRICTED_CONTROL', /^Configure alarm /),
  t('parameter', 'param-force-cascade', 'Cascade forcing', 'RESTRICTED_CONTROL', /^Force cascade /),
  t('parameter', 'param-simulate-input', 'Simulated input value', 'RESTRICTED_CONTROL', /^Simulate input /),
  t('parameter', 'param-toggle', 'Discrete value / device command', 'CONTROL', /^Toggle /),
  t('parameter', 'param-reset', 'Device or latch reset', 'CONTROL', /^Reset /),

  // Writable fields
  t('field', 'field-alm-enab', 'ALM[type].ENAB and ALM[type].PRIAD', 'SYSTEM_RECORDS', /^Write \S+\.ALM\[[^\]]+\]\.(ENAB|PRIAD|SUPTMO)$/),
  t('field', 'field-alm-mack', 'ALM[type].MACK', 'ALARMS', /^Write \S+\.ALM\[[^\]]+\]\.(MACK|OPSUP)$/),
  t('field', 'field-fb-safety', 'Function block BYPASS, ARM_TRAP and RESET_IN', 'RESTRICTED_CONTROL', /^(BYPASS|ARM_TRAP|RESET_IN) /),
  t('field', 'field-interlock', 'Interlock override', 'RESTRICTED_CONTROL', /^Force Interlock /),
  t('field', 'field-permissive', 'Permissive override', 'RESTRICTED_CONTROL', /^Set Permissive /),
  t('field', 'field-fault', 'Fault injection', 'RESTRICTED_CONTROL', /^Inject Fault /),
  t('field', 'field-device-options', 'Device options (passive, timeout, masks)', 'RESTRICTED_CONTROL', /^Configure device options /),
  t('field', 'field-alarm-ack', 'Acknowledge an alarm', 'ALARMS', /^Acknowledge alarm$/),
  t('field', 'field-alarm-ack-all', 'Acknowledge all alarms', 'ALARMS', /^Acknowledge All$/),
  t('field', 'field-alarm-shelve', 'Shelve an alarm', 'ALARMS', /^Shelve alarm$/),
  t('field', 'field-alarm-unshelve', 'Unshelve an alarm', 'ALARMS', /^Unshelve alarm$/),

  // Secured functions
  t('function', 'fn-batch', 'Batch operate command', 'BATCH_OPERATE', /^Batch command$/),
  t('function', 'fn-signature-config', 'Electronic signature policies, areas and modules', 'CAN_CONFIGURE', /^Configure electronic signatures$/),
  t('function', 'fn-export-import', 'Export and import configuration', 'CAN_CONFIGURE', /^(Export|Import) configuration$/),
  t('function', 'fn-sfc-command', 'SFC command', 'BATCH_OPERATE', /^SFC command /),
  t('function', 'fn-recipe-edit', 'Create, change and delete recipes (Recipe Studio)', 'BUILD_RECIPES', /^(Save|Delete) recipe /),
  t('function', 'fn-recipe-select', 'Select the recipe a batch runs', 'BATCH_OPERATE', /^Select recipe /),
  t('function', 'fn-module-scan', 'Module scan multiple and execution order', 'CAN_CONFIGURE', /^Configure module scan /),
  t('function', 'fn-simulator-init', 'Initialize simulation', 'CONTROL', /^Initialize simulation$/),
  t('function', 'fn-sanitation', 'Start and cancel sanitation', 'CONTROL', /^(Start|Cancel) sanitation /),
  t('function', 'fn-flow-colors', 'Shared flow color tables', 'CAN_CONFIGURE', /flow color table/),
  t('function', 'fn-picture-edit', 'Edit dynamic pictures and dynamics', 'CAN_CONFIGURE',
    /^(Delete dynamic picture|Create dynamic picture element|Edit dynamic picture element|Remove dynamic picture element|Configure picture dynamics) /),
  t('function', 'fn-picture-file', 'Save and load pictures', 'CAN_CONFIGURE', /^(Save|Load) picture /),
  t('function', 'fn-picture-assign', 'Assign module displays', 'CAN_CONFIGURE', /^Assign module displays /),
  t('function', 'fn-picture-nav', 'Picture navigation', 'CAN_CONFIGURE', /^Configure picture navigation /),
  t('function', 'fn-download-status', 'Update Download Status', 'CAN_CONFIGURE', /^Update Download Status /),
  t('function', 'fn-control-config', 'Control strategy: cascade, feedforward, splitter, analog strategy and wiring', 'CAN_CONFIGURE',
    /^(Set cascade source|Configure feedforward|Wire command source) |^Configure .+ (analog strategy|splitter)$|^Wire .+ CAS_IN$/),
  t('function', 'fn-controller-create', 'Create a controller', 'SYSTEM_ADMIN', /^Create controller /),
  t('function', 'fn-controller-config', 'Configure or decommission a controller', 'CAN_CONFIGURE', /^(Configure|Decommission) controller /),
  t('function', 'fn-controller-commission', 'Commission a controller', 'CAN_DOWNLOAD', /^Commission controller /),
  t('function', 'fn-controller-diagnostics', 'Controller fail, restore, identify, auto-sense and power', 'DIAGNOSTIC',
    /^(Fail|Restore|Identify) controller |^Auto-sense I\/O for controller |^(Simulate power loss for|Restore power to) controller /),
  t('function', 'fn-charm', 'Pull and reinsert a CHARM', 'DIAGNOSTIC', /^(Pull|Reinsert) CHARM /),
  t('function', 'fn-phase', 'Edit a phase', 'CAN_CONFIGURE', /^Edit Phase /),
  t('function', 'fn-area', 'Create or rename a plant area', 'CAN_CONFIGURE', /^(Create|Rename) plant area/),
  t('function', 'fn-traditional-io', 'Traditional I/O cards, channels, filters and binding', 'CAN_CONFIGURE',
    /^Add traditional card to |^Configure \S+ channel |^Configure AI channel filter |^Bind .+ traditional I\/O$/),
  t('function', 'fn-serial-config', 'Serial cards, ports, devices and datasets', 'CAN_CONFIGURE', /^(Add serial card to|Configure serial card) /),
  t('function', 'fn-serial-download', 'Download a serial card', 'CAN_DOWNLOAD', /^Download serial card /),
  t('function', 'fn-h1-config', 'H1 cards, ports, devices, blocks and links', 'CAN_CONFIGURE', /^Configure H1 card /),
  t('function', 'fn-h1-diagnostic', 'Fail or restore an H1 card', 'DIAGNOSTIC', /^Configure H1 card /),
  t('function', 'fn-h1-download', 'Download an H1 card', 'CAN_DOWNLOAD', /^Download H1 card /),
  t('function', 'fn-ff-device-config', 'Field device resource, transducer and calibration', 'CAN_CALIBRATE', /^Configure field device /),
  t('function', 'fn-chronicle-config', 'Event chronicle configuration', 'CAN_CONFIGURE', /^Configure event chronicle$/),
  t('function', 'fn-chronicle-download', 'Download event chronicle', 'CAN_DOWNLOAD', /^Download event chronicle$/),
  t('function', 'fn-chronicle-clear', 'Clear the event chronicle archive', 'SYSTEM_ADMIN', /^Clear event chronicle$/),
  t('function', 'fn-input-filter-download', 'Download input filters', 'CAN_DOWNLOAD', /^Download input filters /),
  t('function', 'fn-module-lifecycle', 'Enable, edit, save and load saved module configuration', 'CAN_CONFIGURE',
    /^(Enable saved lifecycle|Edit offline configuration|Save module configuration|Load saved module|Enable PID_LOOP lifecycle|Edit PID_LOOP assignment|Save PID_LOOP configuration|Load saved PID_LOOP|Enable saved device|Edit saved device|Load saved device|Save device|Go Online PID_LOOP|Go Offline PID_LOOP) /),
  t('function', 'fn-upload', 'Upload module and parameter values', 'CAN_CONFIGURE',
    /^(Upload module|Upload AO parameters|Upload PID_LOOP parameters) /),
  t('function', 'fn-download', 'Download and re-send modules', 'CAN_DOWNLOAD',
    /^(Verify AO download|Confirm verified AO download|Download module|Full Download managed|Update AO cold-restart memory|Re-send last good module download|Re-send controller-owned AO transfers|Download PID_LOOP|Download SFC|Full download device) /),
  t('function', 'fn-cold-restart', 'Cold restart a module', 'DIAGNOSTIC', /^Cold restart module /),
  t('function', 'fn-module-config', 'Configure AO and discrete modules, parameters and alarms', 'CAN_CONFIGURE',
    /^Configure \S+ (AO|discrete alarm)$|^Create \S+ input parameter$/),
  t('function', 'fn-module-create', 'Create a module', 'CAN_CONFIGURE', /^Create module /),
  t('function', 'fn-module-configure', 'Configure a module: mode fields, tracking, generic properties', 'CAN_CONFIGURE',
    /^Configure \S+$|^Configure (mode fields|tracking) /),
  t('function', 'fn-device-config', 'Device configuration: wiring, logic, owned blocks, templates', 'CAN_CONFIGURE',
    /^(Bind \S+ device|Edit device logic|Edit owned block|Wire interlock source|Wire permissive source|Copy \S+ motor template) |^Wire \S+\.\S+$|^Copy \S+ motor template$/),
  t('function', 'fn-sfc-config', 'SFC: create, edit, properties, blocks, alarms and parameters', 'CAN_CONFIGURE',
    /^(Create SFC|Edit SFC|Apply SFC properties|Configure SFC (Module Properties|blocks\/alarms|parameter)) /),
  t('function', 'fn-sfc-lifecycle', 'SFC: enable, save and load saved configuration', 'CAN_CONFIGURE',
    /^(Enable saved SFC lifecycle|Save SFC|Load saved SFC) /),
  t('function', 'fn-named-sets', 'Named Sets: create, properties and load', 'CAN_CONFIGURE',
    /^(Create Named Set|Named Set Properties) |^Load saved Named Sets$/),
  t('function', 'fn-alarm-setup', 'Custom alarm types and condition-delay alarms', 'CAN_CONFIGURE',
    /^(Define|Delete) (custom alarm type|condition-delay alarm) /),
  t('function', 'fn-setup-download', 'Download Changed Setup Data', 'CAN_DOWNLOAD', /^Download Changed Setup Data: /),
  t('function', 'fn-photo-plant', 'Add WFI tank loops and still', 'CAN_CONFIGURE', /^Add WFI tank loops and still$/),
  t('function', 'fn-module-delete', 'Delete a module or SFC', 'CAN_CONFIGURE', /^Delete (module|SFC) /),
  t('function', 'fn-equipment-module', 'Create, delete and assign Equipment Modules', 'CAN_CONFIGURE',
    /^(Create|Delete) Equipment Module |^Assign .+ to Equipment Module$/),
  t('function', 'fn-new-project', 'New Project', 'CAN_CONFIGURE', /^New Project /)
]

export function findSecurityTarget(lock: LockType, action: string): SecurityTarget | undefined {
  return SECURITY_TARGETS.find((x) => x.defaultLock === lock && x.pattern.test(action))
}
