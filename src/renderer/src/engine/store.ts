import { create } from 'zustand'
import type {
  PlantState,
  ControlMode,
  PidModule,
  MotorModule,
  ValveModule,
  DiscreteOutput,
  TrendPoint,
  AnyModule,
  AlarmType,
  AlarmPriority,
  EventLogEntry,
  EventCategory,
  FbInputRef,
  FbCompareOp,
  FbBlockType,
  PidIoPatch,
  SplitterPatch,
  AnalogSignalRef,
  AnalogOutputModule,
  AnalogOutputPatch,
  DeviceLogicPatch
} from './types'
import { buildInitialPlant, buildBlankPlant, makeModule, type NewModuleSpec } from './plant'
import { installPhotoPlant, PHOTO_TANKS, startPhotoSanitation, type PhotoTankId } from './photoPlant'
import { reconcileAlarm, resetDeviceLock, stepPlant } from './simulate'
import { reconcileDeviceAlarms } from './deviceAlarms'
import { useSimulator, validateScale } from './simulatorSession'
import { coldRestartDecision, type ColdRestartDecision } from './coldRestart'
import { DEFAULT_RECIPE_NAME, defaultRecipe, recipeErrors, resolveRecipe, type Recipe } from './recipes'
import { isDefaultSchedule, validateExecutionOrder, validateScanMultiple, type ModuleScheduling } from './moduleScheduling'
import { featureDisabledError, featureEnabled } from './systemPreferences'
import {
  SERIAL_LIMITS,
  SERIAL_PORT_IDS,
  cloneSerialConfig,
  emptySerialRuntime,
  makeSerialCard,
  modbusAddress,
  serialDatasetError,
  serialDeviceError,
  serialDstCount,
  serialPortError,
  syncSerialDatasetCards,
  type SerialCard,
  type SerialCardConfig,
  type SerialDatasetConfig,
  type SerialPortConfig,
  type SerialPortId
} from './serialIo'
import {
  EMPTY_SIGNATURE_CONFIG,
  evaluateSignature,
  requiredSignature,
  signaturePolicyError,
  type SignatureAttempt,
  type SignatureConfig,
  type SignaturePolicy,
  type SignatureRequest
} from './electronicSignatures'
import { captureDevice, cloneDeviceConfiguration, deviceActive, deviceConfigurationError, deviceDirty, deviceDownloadError, deviceEditorModules, prepareDeviceTransfer,
  deviceOperatorError, parseDevice, savedDeviceKey, serializeDevice, type DeviceDraftPatch, type DeviceLifecycle } from './deviceLifecycle'
import { materializeMotorStrategy, motorStrategyError, motorTemplateStrategy, ownedMotorBlock, strategyModules, type MotorBlockConfiguration } from './motorStrategy'
import { clonePidIo, configurePidIo, pidIoPatchError, signalError } from './analogStrategy'
import { aoConfigurationError, aoEngineeringValue } from './standaloneAo'
import {
  aoOperatorError, changedAoParameters, cloneAo, cloneConfiguration, configurationError, deployedAo, downloadError, lifecycleDirty,
  memoryOf, committedAoTransfer, controllerAoRecords, controllerDeployedAoRecords, prepareAoReplay,
  prepareAoTransfer, parseSavedAo, restartAo, savedAoStorageKey, serializeSavedAo, withProjectMembership,
  type AoConfiguration, type AoDraftPatch, type AoLifecycle
} from './moduleLifecycle'
import {
  changedPidTuningParameters, clonePidConfiguration, deployedPid, lifecyclePidModules, parseSavedPid,
  pidConfigurationError, pidDownloadError,
  pidLifecycleDirty, savedPidStorageKey, serializeSavedPid,
  type PidConfiguration, type PidLifecycle, type PidLifecyclePatch, type PidTuningParameter
} from './pidLifecycle'
import { prepareControllerRegulatoryTransfer, type RegulatoryReview } from './controllerRegulatoryTransfer'
import { prepareControllerModuleTransfer, type ManagedReview } from './controllerModuleTransfer'
import { configureSplitter, createSplitter } from './splitter'
import { areaNameError } from './areas'
import { moduleNameError } from './naming'
import { conditionSourceError } from './fbCondition'
import { isPidTargetMode, pidTargetAllowed, pidExecutionBad } from './pidModes'
import { deviceDescriptorCommandError, deviceDescriptorLabel } from './deviceDescriptors'
import { deviceLogicError, deviceSourceError, resetConditionTiming } from './fb'
import {
  analogBindingError, channelConfigurationError, deviceBindingError, discreteBindingError, findDst, makeTraditionalCard,
  type AnalogBindingPort, type DeviceBindingPort, type TraditionalCardType
} from './traditionalIo'
import { advanceBatch, commandBatch, makeBatch, makeDefaultPhases, PROCEDURE, type BatchRuntime, type BatchCommand, type PhaseDef } from './batch'
import { advanceSfcs, resetSfcBooleanActions, sfcStepsError, makeSampleSfc, makeAutoclaveSfc, makeLyoSfc, makeCipSfc, type SfcDef, type SfcStep } from './sfc'
import { cloneSfcBlocks, reconcileSfcAlarms, sfcBlockConfigurationError, type SfcBlockConfiguration } from './sfcBlocks'
import { registerAreaResolver, requireUnlockedKey, useSecurity } from './security'
import { ALARM_FIELD_LOCK, DEFAULT_SUPPRESS_MINUTES, alarmFieldWriteError, parseAlarmFieldPath, readAlarmField } from './alarmFields'
import { compareModuleDownload, type DownloadStatusCheck } from './downloadStatus'
import {
  cloneSfcParameters, controllerNamedSets, sfcParameterError, type SfcExpressionContext, type SfcParameter
} from './sfcParameters'
import {
  cloneSfcConfiguration, parseSavedSfc, savedSfcKey, serializeSavedSfc,
  sfcConfigurationError, sfcDraftDirty, sfcEditorDefinition, sfcMetadataError, prepareSfcTransfer,
  type SfcLifecycle, type SfcConfiguration, type SfcModuleProperties
} from './sfcLifecycle'
import {
  NAMED_SETS_STORAGE_KEY, changedNamedSets, cloneNamedSet, namedSetError, namedSetTargetKey,
  parseNamedSets, serializeNamedSets, type NamedSetState, type NamedSetDefinition, type NamedSetTarget
} from './namedSets'
import {
  MAX_CUSTOM_ALARM_TYPES, changedCustomAlarmTypeNames, cloneCustomAlarmType, customAlarmTypeDefError,
  customAlarmTypeNameError, type CustomAlarmTypeDef, type CustomAlarmTypeState
} from './customAlarmTypes'
import {
  conditionDelayAlarmDefError, stepConditionDelayAlarm, type ConditionDelayAlarmDef, type ConditionDelayAlarmRuntime
} from './conditionDelayAlarms'
import { makeDefaultEquipment, makeBlankEquipment, type EquipmentModule } from './equipment'
import {
  makeDefaultHardware,
  makeBlankHardware,
  allocateControlNetworkAddress,
  controllerIsDown,
  isValidControllerTag,
  MAX_COLD_RESTART_MINUTES,
  MAX_CONTROLLER_DESCRIPTION_LENGTH,
  scanControllerIo,
  type ControllerConfiguration,
  type HardwareState
} from './hardware'

const TREND_SECONDS = 600 // 10 minutes of history
const TREND_HZ = 2

const EVENT_LOG_MAX = 2000

function requireUnlockedLock(lock: 'CAN_CONFIGURE' | 'CAN_DOWNLOAD' | 'BATCH_OPERATE' | 'CONTROL' | 'RESTRICTED_CONTROL', action: string): boolean {
  if (useSecurity.getState().locked) {
    useSecurity.setState({ lastDenied: `Access Denied — ${action} requires an unlocked workstation` })
    return false
  }

  return useSecurity.getState().requireLock(lock, action)
}

function rejectSfc(get: () => StoreState, name: string, message: string): false {
  get().logEvent('DIAGNOSTIC', name, message)
  window.alert(message)
  return false
}

export function sfcExpressionContext(state: StoreState, name: string, online = false): SfcExpressionContext {
  const configuration = online ? state.sfcLifecycle[name]?.deployed : state.sfcLifecycle[name]?.draft
  return { name, parameters: (online ? state.sfcs[name]?.parameters : (configuration ?? state.sfcs[name])?.parameters) ?? {},
    blocks: online ? state.sfcs[name]?.blocks : (configuration ?? state.sfcs[name])?.blocks,
    sets: online ? controllerNamedSets(state.namedSets, configuration?.controllerTag ?? '') : state.namedSets.configured }
}

interface StoreState extends PlantState {
  addPhotoPlant: () => boolean
  startPhotoTankSanitation: (id: PhotoTankId) => boolean
  cancelPhotoTankSanitation: (id: PhotoTankId) => boolean
  trend: TrendPoint[]
  rev: number
  /** Alarm & Event Journal: 21 CFR Part 11 style audit trail of alarms + operator actions. */
  eventLog: EventLogEntry[]
  logEvent: (category: EventCategory, tag: string, description: string, priority?: AlarmPriority) => void
  batch: BatchRuntime
  /** Horn Silence: mutes audible alarm tone without acknowledging (F8). */
  hornSilenced: boolean
  silenceHorn: () => void
  /** Editable phase logic (SFC per phase), keyed by phase name. */
  phases: Record<string, PhaseDef>
  sfcs: Record<string, SfcDef>
  /** Equipment Modules (ISA-88 physical hierarchy), keyed by tag. */
  equipment: Record<string, EquipmentModule>
  /** Physical Network: Controllers / I/O Carriers / CHARM baseplates. */
  hardware: HardwareState
  moduleLifecycle: Record<string, AoLifecycle>
  pidLifecycle: Record<string, PidLifecycle>
  deviceLifecycle: Record<string, DeviceLifecycle>
  enableDeviceLifecycle: (tag: string) => boolean
  editDeviceDraft: (tag: string, patch: DeviceDraftPatch) => boolean
  saveDeviceConfiguration: (tag: string) => boolean
  loadDeviceConfiguration: (tag: string) => boolean
  downloadDeviceConfiguration: (tag: string) => boolean
  setDeviceOnline: (tag: string, online: boolean) => boolean
  createMotorTemplate: (tag: string, area: string, description?: string) => boolean
  editMotorBlock: (tag: string, patch: Partial<MotorBlockConfiguration>) => boolean
  namedSets: NamedSetState
  /** DV09-041 custom alarm type registry: up to 255 named types with a
   * priority and a %P1/%P2 message template, separate from a module's fixed
   * AlarmLimit set and its own Download Changed Setup Data step. */
  /** DV09-080 Electronic Signatures: setup (application/area/module/policy) and staged writes. */
  signature: SignatureConfig
  signaturePending: SignatureRequest[]
  setSignatureApplication: (patch: { operate?: boolean; controlStudio?: boolean }) => boolean
  saveSignaturePolicy: (policy: SignaturePolicy) => string | null
  deleteSignaturePolicy: (name: string) => boolean
  setSignatureArea: (area: string, enabled: boolean) => boolean
  setModuleSignaturePolicy: (tag: string, policy: string | undefined) => boolean
  /** Returns an error message when the signature is rejected (the write stays staged), else null once applied. */
  submitSignature: (id: number, attempt: SignatureAttempt) => string | null
  cancelSignature: (id: number) => boolean
  customAlarmTypes: CustomAlarmTypeState
  defineCustomAlarmType: (name: string, def: CustomAlarmTypeDef) => boolean
  deleteCustomAlarmType: (name: string) => boolean
  downloadCustomAlarmTypeSetup: () => boolean
  /** DV09-047: named two-condition conjunction + strict elapsed-delay alarms,
   * bound to a deployed custom alarm type. conditionDelayAlarmRuntime is
   * pure per-tick runtime state (elapsed timers), not saved configuration. */
  conditionDelayAlarms: Record<string, ConditionDelayAlarmDef>
  conditionDelayAlarmRuntime: Record<string, ConditionDelayAlarmRuntime>
  defineConditionDelayAlarm: (name: string, def: ConditionDelayAlarmDef) => boolean
  deleteConditionDelayAlarm: (name: string) => boolean
  sfcLifecycle: Record<string, SfcLifecycle>
  downloadStatusChecks: Record<string, DownloadStatusCheck>
  updateModuleDownloadStatus: (tag: string) => boolean
  enableSfcLifecycle: (name: string) => boolean
  configureSfcController: (name: string, controllerTag: string, expected?: SfcConfiguration) => boolean
  configureSfcProperties: (name: string, patch: Partial<SfcModuleProperties>, expected?: SfcConfiguration) => boolean
  saveSfc: (name: string) => boolean
  loadSavedSfc: (name: string) => boolean
  downloadSavedSfc: (name: string, expected?: SfcConfiguration) => boolean
  setSfcOnline: (name: string, online: boolean) => boolean
  configureSfcParameter: (name: string, parameter: string, binding: SfcParameter, expected: SfcConfiguration) => boolean
  configureSfcBlocks: (name: string, configuration: SfcBlockConfiguration, expected: SfcConfiguration) => boolean
  writeSfcNamedValue: (name: string, parameter: string, value: number) => boolean
  createNamedSet: (name: string) => boolean
  applyNamedSetProperties: (expected: NamedSetDefinition, draft: NamedSetDefinition) => boolean
  loadSavedNamedSets: () => boolean
  downloadChangedNamedSets: (target: NamedSetTarget) => boolean
  enableModuleLifecycle: (tag: string) => boolean
  setModuleOnline: (tag: string, online: boolean) => boolean
  editModuleDraft: (tag: string, patch: AoDraftPatch) => boolean
  saveModuleConfiguration: (tag: string) => boolean
  loadSavedModuleConfiguration: (tag: string) => boolean
  verifyAoDownload: (tag: string, scope: 'FULL' | 'PARTIAL') => boolean
  downloadModule: (tag: string, scope: 'FULL' | 'PARTIAL', expected?: AoConfiguration) => boolean
  downloadControllerAos: (tag: string, expected?: Record<string, AoConfiguration | undefined>) => boolean
  downloadControllerRegulatory: (tag: string, expected?: RegulatoryReview) => boolean
  downloadControllerManagedModules: (tag: string, expected?: ManagedReview) => boolean
  resendLastGoodModuleDownload: (tag: string) => boolean
  resendControllerAoDownloads: (tag: string, expected?: Record<string, AoConfiguration | undefined>) => boolean
  updateControllerAoRestartMemory: (tag: string) => boolean
  uploadModule: (tag: string) => boolean
  uploadAoParameters: (tag: string, parameterNames: string[]) => boolean
  restartModule: (tag: string) => boolean
  enablePidLifecycle: (tag: string) => boolean
  editPidLifecycle: (tag: string, patch: PidLifecyclePatch) => boolean
  savePidConfiguration: (tag: string) => boolean
  loadSavedPidConfiguration: (tag: string) => boolean
  uploadPidParameters: (tag: string, parameters: PidTuningParameter[]) => boolean
  downloadPidModule: (tag: string, uploadParameters?: PidTuningParameter[]) => boolean
  setPidLifecycleOnline: (tag: string, online: boolean) => boolean
  /** DV09-086..093 Serial Interface (Modbus). Each action returns an error message, or null on success. */
  addSerialCard: (controllerTag: string, slot: number, placeholder?: boolean) => string | null
  removeSerialCard: (cardId: string) => string | null
  configureSerialCard: (cardId: string, patch: Partial<Pick<SerialCardConfig, 'tieback' | 'capacity'>>) => string | null
  configureSerialPort: (cardId: string, port: SerialPortId, patch: Partial<Omit<SerialPortConfig, 'devices'>>) => string | null
  addSerialDevice: (cardId: string, port: SerialPortId, name: string, address: number) => string | null
  removeSerialDevice: (cardId: string, port: SerialPortId, name: string) => string | null
  saveSerialDataset: (cardId: string, port: SerialPortId, device: string, dataset: SerialDatasetConfig, existingName?: string) => string | null
  removeSerialDataset: (cardId: string, port: SerialPortId, device: string, dataset: string) => string | null
  downloadSerialCard: (cardId: string) => string | null
  addTraditionalCard: (controllerTag: string, slot: number, type: TraditionalCardType) => boolean
  configureTraditionalChannel: (cardId: string, channel: number,
    patch: { dst: string; enabled: boolean; tiebackDst?: string }) => boolean
  setTraditionalInput: (dst: string, value: number) => boolean
  configureInputFilter: (cardId: string, channel: number, seconds: number) => boolean
  downloadInputFilters: (cardId: string) => boolean
  bindDiscreteDst: (tag: string, dst: string) => boolean
  bindDeviceDst: (tag: string, port: DeviceBindingPort, dst: string) => boolean
  bindAnalogDst: (tag: string, port: AnalogBindingPort, dst: string) => boolean
  configureStandaloneAo: (tag: string, patch: AnalogOutputPatch) => boolean
  setStandaloneAoMode: (tag: string, mode: AnalogOutputModule['mode']) => boolean
  setStandaloneAoValue: (tag: string, value: number) => boolean
  addAoParameter: (tag: string, name: string, value: number) => boolean
  setAoParameter: (tag: string, name: string, value: number) => boolean
  connectAoParameter: (tag: string, name?: string) => boolean
  setDiscreteMode: (tag: string, mode: 'AUTO' | 'OOS') => boolean
  configureDiscreteAlarm: (tag: string, onValue: boolean, enabled: boolean) => boolean
  // operator actions
  setMode: (tag: string, mode: PidModule['mode']) => boolean
  setPidModeFields: (tag: string, patch: { normalMode?: PidModule['mode']; permittedModes?: PidModule['permittedModes'] }) => boolean
  setSetpoint: (tag: string, sp: number) => boolean
  setOutput: (tag: string, out: number) => boolean
  setTuning: (tag: string, t: { gain?: number; reset?: number; rate?: number }) => boolean
  /** Wire or clear a PID's cascade remote-SP source (CAS_SOURCE) — any tag, any PID, not just a hardcoded pair. */
  setCasSource: (tag: string, source: string | undefined) => void
  /** Configure feedforward (FF_ENABLE/FF_GAIN/FF_VAL source) on any PID. */
  setFeedforward: (tag: string, patch: { enable?: boolean; gain?: number; source?: string }) => void
  /** Configure tracking (TRK_IN_D trigger tag + TRK_VAL source/constant) on any PID. */
  setTracking: (tag: string, patch: { enable?: boolean; source?: string; valueSource?: string; value?: number }) => void
  setPidIo: (tag: string, patch: PidIoPatch) => boolean
  setSplitterConfig: (tag: string, patch: SplitterPatch & {
    feedback1Source?: AnalogSignalRef; feedback2Source?: AnalogSignalRef
  }) => boolean
  /** Wire a function block's IN1/IN2 to a constant value or another module's live value. */
  setFbInput: (tag: string, which: 'in1' | 'in2', ref: FbInputRef) => void
  /** Edit a function block's type-specific configuration (gain/bias/cmpOp/expr/delaySec/tripValue/countUp). */
  setFbConfig: (
    tag: string,
    patch: Partial<{ gain: number; bias: number; cmpOp: FbCompareOp; expr: string; delaySec: number; tripValue: number; countUp: boolean }>
  ) => void
  setFbSafety: (tag: string, option: 'BYPASS' | 'ARM_TRAP' | 'RESET_IN', value: boolean) => boolean
  setAlarmLimit: (
    tag: string,
    type: AlarmType,
    patch: { limit?: number; enabled?: boolean; priority?: AlarmPriority; rank?: number | null }
  ) => void
  /** DV09-043: generic qualified "TAG.ALM[TYPE].FIELD" datalink write (ENAB/
   * PRIAD/MACK), the same resolver builder, faceplates and any other
   * qualified-path consumer share, each enforcing its own Lock & Key. */
  /** DV09-042: configured SUPTMO (minutes) per TAG.TYPE; absent = the default. */
  alarmSuppressMinutes: Record<string, number>
  /** Reads any TAG.ALM[TYPE].FIELD from the live alarm state. */
  readAlarmFieldValue: (path: string) => { value: boolean | number | null } | { error: string }
  writeAlarmField: (path: string, value: boolean | number | null) => boolean
  startMotor: (tag: string) => void
  stopMotor: (tag: string) => void
  openValve: (tag: string) => void
  closeValve: (tag: string) => void
  toggleDO: (tag: string) => void
  toggleInterlock: (tag: string) => void
  injectFault: (tag: string) => void
  /** RESET_D: clears a Locked DC_STATE after a trip (Reset Required device option). */
  resetDevice: (tag: string) => void
  /** PERMISSIVE_D: simulated external permit condition for Motor/Valve modules. */
  setPermissive: (tag: string, ok: boolean) => void
  /** Device options: Permissive / Reset Required, as configured in Control Studio. */
  setDeviceOptions: (tag: string, opts: { permissiveRequired?: boolean; resetRequired?: boolean }) => void
  /** Wire a logic/alarm tag to automatically drive a MOTOR/VALVE's INTERLOCK_D every scan (the missing link between an FB trip and real equipment). */
  setInterlockSource: (tag: string, source: string | undefined) => void
  setPermissiveSource: (tag: string, source: string | undefined) => boolean
  /** Wire a logic/alarm tag to automatically drive a MOTOR/VALVE's SP_D (commanded) every scan, overriding manual Start/Stop or Open/Close. */
  setCommandSource: (tag: string, source: string | undefined) => void
  /** Edit a device's interlock/permissive/force-setpoint condition lists and BYPASSED flag (runtime module). */
  setDeviceLogic: (tag: string, patch: DeviceLogicPatch) => boolean
  /** CAS_IN_D connection health; false sheds a Cas/RCas PID to Auto. */
  setCasHealthy: (tag: string, healthy: boolean) => void
  /** Fail a controller leg (primary, or both legs if not redundant) — bound I/O goes Bad. */
  failController: (tag: string) => boolean
  restoreController: (tag: string) => boolean
  createController: (tag: string, description: string) => boolean
  setControllerConfiguration: (tag: string, patch: Partial<ControllerConfiguration>) => boolean
  commissionController: (tag: string) => boolean
  decommissionController: (tag: string) => boolean
  identifyController: (tag: string, identifying: boolean) => boolean
  autoSenseController: (tag: string) => boolean
  simulateControllerPowerLoss: (tag: string) => boolean
  restoreControllerPower: (tag: string) => boolean
  /** Simulate a loose/removed CHARM on a baseplate channel. */
  pullCharm: (baseplateId: string, slot: number) => void
  reinsertCharm: (baseplateId: string, slot: number) => void
  ackAlarm: (id: string) => void
  ackAll: () => void
  /** ISA-18.2 Shelving: suppress an alarm from the active view for durationMin minutes. */
  shelveAlarm: (id: string, durationMin: number) => void
  unshelveAlarm: (id: string) => void
  setRunning: (r: boolean) => void
  setSpeed: (s: number) => void
  /** Restore the local simulation to its initial process conditions and put it on hold. */
  initializeSimulation: () => boolean
  recipes: Record<string, Recipe>
  activeRecipe: string
  /** DV09-074: create or change a recipe (Build Recipes key); returns an error message or null. */
  saveRecipe: (recipe: Recipe) => string | null
  deleteRecipe: (name: string) => string | null
  /** Choose the recipe the next batch runs (Batch Operate key), only while the batch is READY. */
  selectRecipe: (name: string) => string | null
  moduleScheduling: ModuleScheduling
  /** Set a module's scan multiple (1-255 x 1 s) and/or manual execution order; null order restores automatic order. */
  setModuleSchedule: (tag: string, change: { multiple?: number; order?: number | null }) => boolean
  tick: (dt: number) => void
  batchCommand: (cmd: BatchCommand) => void
  /** Edit a phase's logic (requires Can Configure), mirroring setSfcSteps. */
  setPhaseSteps: (phaseName: string, steps: SfcStep[]) => void
  createModule: (spec: NewModuleSpec) => boolean
  createArea: (name: string) => boolean
  renameArea: (name: string, nextName: string) => boolean
  deleteModule: (tag: string) => void
  createEquipmentModule: (tag: string, description: string, area: string) => void
  deleteEquipmentModule: (tag: string) => void
  /** Assign (or clear, with null) a Control Module's Equipment Module. */
  setModuleEquipment: (moduleTag: string, emTag: string | null) => void
  createSfc: (name: string, area: string, options?: {
    managed: boolean; description?: string; equipmentModule?: string
  }) => boolean
  deleteSfc: (name: string) => void
  setSfcSteps: (name: string, steps: SfcStep[]) => void
  checkSfc: (name: string) => string | null
  applySfcStepProperties: (name: string, expected: SfcStep, patch: Partial<SfcStep>,
    related?: { expected: SfcStep; patch: Partial<SfcStep> }[]) => boolean
  sfcCommand: (name: string, cmd: 'run' | 'hold' | 'reset') => void
  /** File > New: reload either the GMP Pharma Factory baseline or a blank project. */
  newProject: (kind: 'pharma' | 'blank') => void
}

const initial = installPhotoPlant(buildInitialPlant()).plant

/** Process conditions Initialize Simulation returns to; replaced when File > New loads a different baseline. */
let simulationBaseline = { process: { ...initial.process }, photoPlant: initial.photoPlant }

/** Seeds every built-in SFC: reactor startup, both autoclaves, both lyos, all 3 CIP skids. */
function makeDefaultSfcs(): Record<string, SfcDef> {
  return {
    'STARTUP-T101': makeSampleSfc(),
    'STERILIZE-AC1': makeAutoclaveSfc(),
    'STERILIZE-AC2': makeAutoclaveSfc({ name: 'STERILIZE-AC2', tic: 'TIC-511', pic: 'PIC-511', xv: 'XV-511' }),
    'LYO-CYCLE-1': makeLyoSfc(),
    'LYO-CYCLE-2': makeLyoSfc({ name: 'LYO-CYCLE-2', tic: 'TIC-611', pic: 'PIC-611', xv: 'XV-611' }),
    'CIP-CYCLE-1': makeCipSfc({ name: 'CIP-CYCLE-1', tic: 'TIC-701', fic: 'FIC-701', p: 'P-701', xvSupply: 'XV-701', xvReturn: 'XV-702' }),
    'CIP-CYCLE-2': makeCipSfc({ name: 'CIP-CYCLE-2', tic: 'TIC-711', fic: 'FIC-711', p: 'P-711', xvSupply: 'XV-711', xvReturn: 'XV-712' }),
    'CIP-CYCLE-3': makeCipSfc({ name: 'CIP-CYCLE-3', tic: 'TIC-721', fic: 'FIC-721', p: 'P-721', xvSupply: 'XV-721', xvReturn: 'XV-722' })
  }
}

export const useStore = create<StoreState>((set, get) => ({
  ...initial,
  addPhotoPlant: () => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Add WFI tank loops and still')) return false
    const state = get()
    if (state.photoPlant) return rejectSfc(get, 'PHOTO-PLANT', 'WFI tank loops and still are already installed')
    const { plant, conflicts } = installPhotoPlant(state)
    if (conflicts.length) return rejectSfc(get, 'PHOTO-PLANT', `Cannot add WFI tank loops and still; existing tags would be overwritten: ${conflicts.join(', ')}`)
    set({ modules: plant.modules, photoPlant: plant.photoPlant, areas: plant.areas, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', 'PHOTO-PLANT', 'Added coupled N3/N1/N1BP WFI tanks, still and shared steam/cooling utilities; N1 feeds legacy WFI storage and CIP supplies; existing modules/process preserved, integrated physics enabled')
    return true
  },
  startPhotoTankSanitation: id => {
    if (!requireUnlockedLock('CONTROL', `Start sanitation ${id}`)) return false
    const state = get()
    const config = PHOTO_TANKS.find(tank => tank.id === id)
    if (!state.photoPlant || !config) return rejectSfc(get, 'PHOTO-PLANT', 'Install the WFI tank loops and still before requesting sanitation')
    const tag = `${config.prefix}-TIC011`
    const loop = state.modules[tag]
    const pump = state.modules[`${config.prefix}-XC002`]
    if (loop?.type !== 'PID' || pump?.type !== 'MOTOR') return rejectSfc(get, tag, 'Sanitation requires the configured temperature loop and recirculation pump')
    if (state.pidLifecycle[tag] || state.deviceLifecycle[pump.tag]) return rejectSfc(get, tag, 'Sanitation shortcut is unavailable for lifecycle-managed modules; use their deployed controls')
    if (loop.pvBad || pidExecutionBad(loop) || loop.downloaded === false || loop.mode === 'OOS' ||
        loop.actualMode === 'LO' || !pidTargetAllowed(loop, 'AUTO') ||
        pump.downloaded === false || pump.fault || pump.interlock || pump.locked || pump.ioInputBad || pump.ioOutputBad)
      return rejectSfc(get, tag, 'Restore deployed, permitted AUTO temperature control and healthy available pump controls before sanitation')
    if (state.photoPlant.tanks[id].sanitation !== 'IDLE') return rejectSfc(get, tag, 'A sanitation cycle is already active')
    set({ photoPlant: startPhotoSanitation(state.photoPlant, id),
      modules: { ...state.modules, [tag]: { ...loop, mode: 'AUTO', sp: 85 },
        [pump.tag]: { ...pump, commanded: true } } })
    get().logEvent('OPERATOR', config.prefix, 'Sanitation requested: heat to 80 degC, continuous 600-second soak, then cool to 30 degC')
    return true
  },
  cancelPhotoTankSanitation: id => {
    if (!requireUnlockedLock('CONTROL', `Cancel sanitation ${id}`)) return false
    const state = get()
    const config = PHOTO_TANKS.find(tank => tank.id === id)
    if (!state.photoPlant || !config || state.photoPlant.tanks[id].sanitation === 'IDLE')
      return rejectSfc(get, 'PHOTO-PLANT', 'No active or aborted sanitation cycle to cancel')
    const tag = `${config.prefix}-TIC011`
    const loop = state.modules[tag]
    if (loop?.type !== 'PID' || state.pidLifecycle[tag] || loop.downloaded === false || loop.mode !== 'AUTO' ||
        loop.actualMode === 'LO' || pidExecutionBad(loop) || loop.pvBad)
      return rejectSfc(get, tag, 'Restore editable AUTO temperature control before cancelling sanitation; manage deployed/overridden controls through their faceplates')
    set({ photoPlant: { ...state.photoPlant, tanks: { ...state.photoPlant.tanks,
      [id]: { ...state.photoPlant.tanks[id], sanitation: 'IDLE', soakSeconds: 0 } } },
      modules: { ...state.modules, [tag]: { ...loop, sp: 25 } } })
    get().logEvent('OPERATOR', config.prefix, 'Sanitation cancelled; temperature target 25 degC; recirculation pump remains under operator control')
    return true
  },
  trend: [],
  rev: 0,
  eventLog: [],
  logEvent: (category, tag, description, priority) => {
    const entry: EventLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: get().time,
      category,
      tag,
      description,
      user: useSecurity.getState().currentUser,
      priority
    }
    set((s) => ({ eventLog: [...s.eventLog, entry].slice(-EVENT_LOG_MAX) }))
  },
  batch: makeBatch(),
  phases: makeDefaultPhases(),
  sfcs: makeDefaultSfcs(),
  equipment: makeDefaultEquipment(),
  hardware: makeDefaultHardware(),
  moduleLifecycle: {},
  pidLifecycle: {},
  deviceLifecycle: {},
  namedSets: { configured: {}, deployed: {} },
  signature: EMPTY_SIGNATURE_CONFIG,
  signaturePending: [],

  setSignatureApplication: (patch) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Configure electronic signatures')) return false
    if ((patch.operate || patch.controlStudio) && !featureEnabled('signaturePolicies')) {
      get().logEvent('DIAGNOSTIC', 'ELECTRONIC SIGNATURES', featureDisabledError('signaturePolicies'))
      window.alert(featureDisabledError('signaturePolicies'))
      return false
    }
    set((s) => ({ signature: { ...s.signature, ...patch } }))
    get().logEvent('CONFIGURE', 'ELECTRONIC SIGNATURES', `Application settings changed: ${JSON.stringify(patch)}`)
    return true
  },

  saveSignaturePolicy: (policy) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Configure electronic signatures')) return 'Requires the Can Configure key'
    if (!featureEnabled('signaturePolicies')) return featureDisabledError('signaturePolicies')
    const error = signaturePolicyError(policy)
    if (error) return error
    set((s) => ({ signature: { ...s.signature, policies: { ...s.signature.policies, [policy.name]: policy } } }))
    get().logEvent('CONFIGURE', policy.name, 'Signature policy saved')
    return null
  },

  deleteSignaturePolicy: (name) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Configure electronic signatures')) return false
    if (!get().signature.policies[name]) return false
    set((s) => {
      const policies = { ...s.signature.policies }
      delete policies[name]
      const modules = Object.fromEntries(Object.entries(s.signature.modules).filter(([, policy]) => policy !== name))
      return { signature: { ...s.signature, policies, modules } }
    })
    get().logEvent('CONFIGURE', name, 'Signature policy deleted')
    return true
  },

  setSignatureArea: (area, enabled) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Configure electronic signatures')) return false
    if (!get().areas.includes(area)) return false
    set((s) => ({
      signature: {
        ...s.signature,
        areas: enabled ? Array.from(new Set([...s.signature.areas, area])) : s.signature.areas.filter((a) => a !== area)
      }
    }))
    get().logEvent('CONFIGURE', area, `Electronic Signature ${enabled ? 'enabled' : 'disabled'} for the area`)
    return true
  },

  setModuleSignaturePolicy: (tag, policy) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Configure electronic signatures')) return false
    if (!get().modules[tag] && !get().sfcs[tag]) return false
    if (policy !== undefined && !get().signature.policies[policy]) return false
    set((s) => {
      const modules = { ...s.signature.modules }
      if (policy === undefined) delete modules[tag]
      else modules[tag] = policy
      return { signature: { ...s.signature, modules } }
    })
    get().logEvent('CONFIGURE', tag, policy === undefined ? 'Electronic Signature policy removed' : `Electronic Signature policy ${policy} associated`)
    return true
  },

  submitSignature: (id, attempt) => {
    const request = get().signaturePending.find((r) => r.id === id)
    const apply = pendingSignatureWrites.get(id)
    if (!request || !apply) return 'There is no pending signature request'
    const verdict = evaluateSignature(request, attempt, useSecurity.getState().authenticate)
    if (!verdict.ok) {
      if (verdict.stage !== 'comment') {
        get().logEvent('SECURITY', request.tag, `Electronic signature attempt for ${request.valueText} failed: ${verdict.reason}`)
      }
      return verdict.reason
    }
    const signers = verdict.verifier ? `confirmed by ${verdict.confirmer} and verified by ${verdict.verifier}` : `confirmed by ${verdict.confirmer}`
    get().logEvent('SECURITY', request.tag, `Electronic signature attempt for ${request.valueText} ${signers}: ${attempt.comment.trim()}`)
    pendingSignatureWrites.delete(id)
    set((s) => ({ signaturePending: s.signaturePending.filter((r) => r.id !== id) }))
    signatureBypass = true
    try {
      apply()
    } finally {
      signatureBypass = false
    }
    return null
  },

  cancelSignature: (id) => {
    const request = get().signaturePending.find((r) => r.id === id)
    if (!request) return false
    pendingSignatureWrites.delete(id)
    set((s) => ({ signaturePending: s.signaturePending.filter((r) => r.id !== id) }))
    get().logEvent('SECURITY', request.tag, `Electronic signature cancelled for ${request.valueText}; the value was not written`)
    return true
  },

  customAlarmTypes: { configured: {}, deployed: {} },
  conditionDelayAlarms: {},
  conditionDelayAlarmRuntime: {},
  downloadStatusChecks: {},
  updateModuleDownloadStatus: tag => {
    if (!requireUnlockedKey('CAN_CONFIGURE', `Update Download Status ${tag}`)) return false
    const comparison = compareModuleDownload(get(), tag)
    const error = comparison.error ?? (comparison.status === 'UNSUPPORTED' ? comparison.message : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Download Status update rejected: ${error}`)
      window.alert(error)
      return false
    }
    set(state => ({ downloadStatusChecks: { ...state.downloadStatusChecks,
      [tag]: { signature: comparison.signature } } }))
    get().logEvent('DIAGNOSTIC', tag, `Module Download Status: ${comparison.status}; ${comparison.message}; comparison only, no transfer`)
    return true
  },
  sfcLifecycle: {},
  hornSilenced: false,

  tick: (dt: number) => {
    const s = get()
    if (!s.running) return
    // Advance the batch first so phase actions set modes/SPs/commands before physics.
    const { modules: cmdModules, batch } = advanceBatch(s, dt * s.speed, s.time + dt * 1000 * s.speed)
    const paused: Record<string, SfcDef> = {}
    const sfcDiagnostics: EventLogEntry[] = []
    const runnable = Object.fromEntries(Object.entries(s.sfcs).filter(([name, runtime]) => {
      const lifecycle = s.sfcLifecycle[name]
      if (!lifecycle) return true
      const controller = lifecycle.deployed ? s.hardware.controllers[lifecycle.deployed.controllerTag] : undefined
      if (!controller || controllerIsDown(controller)) return false
      const context = sfcExpressionContext(s, name, true)
      const error = sfcBlockConfigurationError(runtime) ?? sfcParameterError(runtime.parameters, context.sets) ??
        sfcStepsError(runtime.steps, s.modules, { ...context, parameters: runtime.parameters ?? {} })
      if (error && runtime.status === 'RUNNING') {
        paused[name] = { ...runtime, status: 'HELD' }
        sfcDiagnostics.push({ id: `${name}-setup-${s.time}`, time: s.time, category: 'DIAGNOSTIC',
          tag: name, user: 'SYSTEM', description: `SFC held: ${error}` })
        return false
      }
      return true
    }))
    const setsBySfc = Object.fromEntries(Object.keys(runnable).map(name => [name, sfcExpressionContext(s, name, true).sets]))
    const { modules: sfcModules, sfcs: executedSfcs } = advanceSfcs({ ...s, sfcs: runnable }, cmdModules, dt * s.speed, setsBySfc)
    const sfcs = { ...s.sfcs, ...executedSfcs, ...paused }
    let photoPlant = s.photoPlant
    if (photoPlant) {
      for (const tank of PHOTO_TANKS) {
        if (photoPlant.tanks[tank.id].sanitation !== 'IDLE' && photoPlant.tanks[tank.id].sanitation !== 'ABORTED' &&
            (s.pidLifecycle[`${tank.prefix}-TIC011`] || s.deviceLifecycle[`${tank.prefix}-XC002`])) {
          photoPlant = { ...photoPlant, tanks: { ...photoPlant.tanks,
            [tank.id]: { ...photoPlant.tanks[tank.id], sanitation: 'ABORTED', soakSeconds: 0 } } }
        }
      }
    }
    const next = stepPlant({ ...s, photoPlant, modules: sfcModules }, dt)
    reconcileSfcAlarms(next.alarms, sfcs, next.time)
    // DV09-047: step each configured two-condition + strict-delay custom alarm.
    const conditionDelayAlarmRuntime: Record<string, ConditionDelayAlarmRuntime> = { ...s.conditionDelayAlarmRuntime }
    for (const [name, def] of Object.entries(s.conditionDelayAlarms)) {
      const { runtime, tripped } = stepConditionDelayAlarm(
        s.conditionDelayAlarmRuntime[name] ?? { elapsed: 0 }, def, next.modules, dt * s.speed)
      conditionDelayAlarmRuntime[name] = runtime
      const type = s.customAlarmTypes.deployed[def.customType]
      const host = next.modules[def.hostTag]
      if (type && host) {
        reconcileAlarm(next.alarms, def.hostTag, host.description,
          { type: 'CUSTOM', label: name, priority: type.priority, enabled: true },
          tripped, runtime.elapsed, 's', next.time, `CONDALM.${name}`, name)
      }
    }
    // DV09-121..123: fieldbus device alarms (PlantWeb alerts) are device-state alarms, separate from process alarms.
    reconcileDeviceAlarms(next.alarms, s.hardware, next.time)
    // Sample trend data.
    const trend = s.trend
    const last = trend[trend.length - 1]
    const shouldSample = !last || next.time - last.t >= 1000 / TREND_HZ
    let newTrend = trend
    if (shouldSample) {
      // Sample every PID/AI module generically so any dynamo can render a sparkline, not just the reactor train.
      const values: Record<string, number> = {}
      for (const t of Object.keys(next.modules)) {
        const gm = next.modules[t]
        if (gm.type === 'PID' || gm.type === 'AO') {
          values[`${t}.PV`] = gm.pv
          values[`${t}.SP`] = gm.sp
          values[`${t}.OUT`] = gm.out
        } else if (gm.type === 'AI') {
          values[`${t}.PV`] = gm.pv
        }
      }
      const point: TrendPoint = { t: next.time, values }
      const cutoff = next.time - TREND_SECONDS * 1000
      newTrend = [...trend, point].filter((p) => p.t >= cutoff)
    }
    // A brand-new active alarm re-sounds the horn even if it was silenced.
    const priorById = new Map(s.alarms.map((a) => [a.id, a]))
    const hasNewAlarm = next.alarms.some((a) => (a.active && !priorById.get(a.id)?.active) ||
      (a.active && !a.acknowledged && (a.repeats ?? 0) > (priorById.get(a.id)?.repeats ?? 0)))
    // Journal every alarm transition: newly active alarms and returns-to-normal.
    const nextById = new Map(next.alarms.map((a) => [a.id, a]))
    const newEntries: EventLogEntry[] = [...sfcDiagnostics]
    if (s.photoPlant && next.photoPlant) {
      for (const tank of PHOTO_TANKS) {
        const stage = next.photoPlant.tanks[tank.id].sanitation
        if (stage !== s.photoPlant.tanks[tank.id].sanitation) newEntries.push({
          id: `${tank.prefix}-sanitation-${next.time}`, time: next.time, category: 'DIAGNOSTIC',
          tag: tank.prefix, user: 'SYSTEM', description: `Sanitation changed to ${stage}${stage === 'ABORTED'
            ? ': temperature control unavailable or overridden; no automatic setpoint written, restore control and cancel/reset the cycle' : ''}`
        })
      }
    }
    const nextSignals = strategyModules(next.modules)
    const previousSignals = strategyModules(s.modules)
    for (const [tag, m] of Object.entries(nextSignals)) {
      const old = previousSignals[tag]
      if (m.type === 'FB' && m.fbType === 'CND' && m.expressionError !== (old?.type === 'FB' ? old.expressionError : undefined) &&
        (m.expressionError || old?.type === 'FB' && old.expressionError)) {
        newEntries.push({ id: `${tag}-condition-${next.time}`, time: next.time, category: 'DIAGNOSTIC',
          tag, user: 'SYSTEM', description: m.expressionError ?? 'CND expression source restored' })
      }
    }
    for (const [tag, module] of Object.entries(next.modules)) {
      const old = s.modules[tag]
      const error = module.type === 'PID' ? module.io?.splitter?.error :
        module.type === 'FB' ? module.splitter?.error : undefined
      const previousError = old?.type === 'PID' ? old.io?.splitter?.error :
        old?.type === 'FB' ? old.splitter?.error : undefined
      if (error !== previousError && (error || previousError)) {
        newEntries.push({ id: `${tag}-splitter-${next.time}`, time: next.time,
          category: 'DIAGNOSTIC', tag, user: 'SYSTEM',
          description: error ?? 'SPLTR configuration restored' })
      }
    }
    for (const a of next.alarms) {
      if (a.active && !priorById.get(a.id)?.active) {
        newEntries.push({
          id: `${a.id}-alm-${next.time}`,
          time: next.time,
          category: 'ALARM',
          tag: a.moduleTag,
          description: `${a.label} alarm — ${a.value}${a.unit ? ' ' + a.unit : ''}`,
          user: 'SYSTEM',
          priority: a.priority
        })
      }
    }
    for (const a of s.alarms) {
      if (a.active && !nextById.get(a.id)?.active) {
        newEntries.push({
          id: `${a.id}-rtn-${next.time}`,
          time: next.time,
          category: 'RTN',
          tag: a.moduleTag,
          description: `${a.label} returned to normal`,
          user: 'SYSTEM',
          priority: a.priority
        })
      }
    }
    set({
      ...next,
      moduleLifecycle: Object.fromEntries(Object.entries(s.moduleLifecycle).map(([tag, record]) => {
        const runtime = next.modules[tag]
        const controller = record.deployed ? s.hardware.controllers[record.deployed.controllerTag] : undefined
        return [tag, runtime?.type === 'AO' && runtime.downloaded && controller && !controllerIsDown(controller)
          ? { ...record, nvm: memoryOf(runtime) } : record]
      })),
      trend: newTrend,
      batch,
      sfcs,
      conditionDelayAlarmRuntime,
      rev: s.rev + 1,
      hornSilenced: hasNewAlarm ? false : s.hornSilenced,
      eventLog: newEntries.length ? [...s.eventLog, ...newEntries].slice(-EVENT_LOG_MAX) : s.eventLog
    })
  },

  silenceHorn: () => set({ hornSilenced: true }),

  setMode: (tag, mode) => {
    if (!requireUnlockedLock('CONTROL', `Set Mode ${tag}`)) return false
    if (gateSignature(set, get, tag, ['MODE'], `MODE := ${mode}`, () => get().setMode(tag, mode))) return false
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      rejectPid(get, tag, 'Go Online before writing a managed PID target mode')
      return false
    }
    const module = get().modules[tag]
    if (module?.type !== 'PID' || !isPidTargetMode(mode)) {
      rejectSfc(get, tag, 'PID target requires a supported mode; LO is an actual tracking mode, not a target')
      return false
    }
    if (!pidTargetAllowed(module, mode)) {
      rejectSfc(get, tag, `PID target mode ${mode} is not in MODE.PERMITTED`)
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.mode = mode
        if (mode === 'MAN') p._integral = p.out
      }
    })
    get().logEvent('OPERATOR', tag, `Mode set to ${mode}`)
    return true
  },

  setPidModeFields: (tag, patch) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure mode fields ${tag}`)) return false
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      return rejectPid(get, tag, 'Go Online before changing live PID mode fields')
    }
    const module = get().modules[tag]
    if (module?.type !== 'PID') {
      rejectSfc(get, tag, 'Mode fields can only be configured on a PID')
      return false
    }
    const nextNormal = patch.normalMode ?? module.normalMode ?? 'AUTO'
    const nextPermitted = patch.permittedModes ?? module.permittedModes ??
      ['MAN', 'AUTO', 'CAS', 'ROUT', 'RCAS', 'IMAN', 'OOS']
    if (!isPidTargetMode(nextNormal) || !Array.isArray(nextPermitted) || !nextPermitted.length ||
      nextPermitted.some(mode => !isPidTargetMode(mode)) ||
      new Set(nextPermitted).size !== nextPermitted.length ||
      !nextPermitted.includes(nextNormal) || !nextPermitted.includes(module.mode)) {
      rejectSfc(get, tag, 'Mode fields require a PID, a valid Normal target, and a nonempty unique Permitted list containing the current target')
      return false
    }
    mutateModule(set, get, tag, m => {
      if (m.type !== 'PID') return
      if (patch.normalMode !== undefined) m.normalMode = patch.normalMode
      if (patch.permittedModes !== undefined) m.permittedModes = [...patch.permittedModes]
    })
    get().logEvent('CONFIGURE', tag, `Mode fields changed: ${JSON.stringify(patch)}`)
    return true
  },

  setSetpoint: (tag, sp) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set Setpoint ${tag}`)) return false
    if (gateSignature(set, get, tag, ['SP'], `SP := ${sp}`, () => get().setSetpoint(tag, sp))) return false
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      rejectPid(get, tag, 'Go Online before writing a managed PID setpoint')
      return false
    }
    if (get().modules[tag]?.type !== 'PID' || !Number.isFinite(sp)) {
      rejectSfc(get, tag, 'PID setpoint entry requires a finite value and a PID module')
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.sp = Math.max(p.pvMin, Math.min(p.pvMax, sp))
      }
    })
    get().logEvent('OPERATOR', tag, `SP set to ${sp}`)
    return true
  },

  setOutput: (tag, out) => {
    if (!requireUnlockedLock('CONTROL', `Set Output ${tag}`)) return false
    if (gateSignature(set, get, tag, ['OUT'], `OUT := ${out}`, () => get().setOutput(tag, out))) return false
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      rejectPid(get, tag, 'Go Online before writing a managed PID output')
      return false
    }
    const module = get().modules[tag]
    if (module?.type !== 'PID' || (module.mode !== 'MAN' && module.mode !== 'ROUT') ||
      module.actualMode === 'LO' || module.actualMode === 'OOS' || !Number.isFinite(out)) {
      rejectSfc(get, tag, 'PID output entry requires a finite value and MAN/ROUT target outside LO/OOS')
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (p.mode === 'MAN' || p.mode === 'ROUT') p.out = Math.max(0, Math.min(100, out))
      }
    })
    get().logEvent('OPERATOR', tag, `OUT set to ${out}`)
    return true
  },

  setTuning: (tag, t) => {
    if (!requireUnlockedKey('TUNING', `Tune ${tag}`)) return false
    const tuned = Object.keys(t).map((key) => key.toUpperCase())
    if (gateSignature(set, get, tag, tuned, `Tuning := ${JSON.stringify(t)}`, () => get().setTuning(tag, t))) return false
    const record = get().pidLifecycle[tag]
    if (record) {
      const controller = record.deployed ? get().hardware.controllers[record.deployed.controllerTag] : undefined
      if (!record.online || !controller || controllerIsDown(controller)) {
        return rejectPid(get, tag, 'Tuning requires an Online PID and available deployed controller')
      }
    }
    const module = get().modules[tag]
    if (module?.type !== 'PID' || Object.entries(t).some(([key, value]) =>
      !['gain', 'reset', 'rate'].includes(key) || !Number.isFinite(value) || value < 0)) {
      rejectPid(get, tag, 'Tuning requires a PID module and finite, non-negative GAIN/RESET/RATE values')
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (t.gain !== undefined) p.gain = t.gain
        if (t.reset !== undefined) p.reset = t.reset
        if (t.rate !== undefined) p.rate = t.rate
      }
    })
    get().logEvent('CONFIGURE', tag, `Tuning changed: ${JSON.stringify(t)}`)
    return true
  },

  setCasSource: (tag, source) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Set cascade source ${tag}`)) return
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      rejectPid(get, tag, 'Go Online before changing a managed PID cascade source')
      return
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') m.casSource = source
    })
    get().logEvent('CONFIGURE', tag, `CAS_SOURCE set to ${source ?? '(none)'}`)
  },

  setFeedforward: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure feedforward ${tag}`)) return
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      rejectPid(get, tag, 'Go Online before configuring managed PID feedforward')
      return
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'PID') return
      if ('enable' in patch) m.ffEnable = !!patch.enable
      if ('gain' in patch) m.ffGain = patch.gain ?? 0
      if ('source' in patch) m.ffSource = patch.source
    })
    get().logEvent('CONFIGURE', tag, `Feedforward changed: ${JSON.stringify(patch)}`)
  },

  setTracking: (tag, patch) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure tracking ${tag}`)) return
    const state = get()
    if (state.pidLifecycle[tag] && !state.pidLifecycle[tag].online) {
      rejectPid(get, tag, 'Go Online before configuring managed PID tracking')
      return
    }
    const module = state.modules[tag]
    const enabled = patch.enable ?? (module?.type === 'PID' && module.trackEnable)
    const source = 'source' in patch ? patch.source : module?.type === 'PID' ? module.trackSource : undefined
    if (state.modules[tag]?.type !== 'PID' || patch.value !== undefined &&
      (!Number.isFinite(patch.value) || patch.value < 0 || patch.value > 100) ||
      patch.enable !== undefined && typeof patch.enable !== 'boolean' ||
      patch.source !== undefined && typeof patch.source !== 'string' ||
      patch.valueSource !== undefined && typeof patch.valueSource !== 'string' ||
      enabled && !source ||
      patch.source && (!state.modules[patch.source] || patch.source === tag) ||
      patch.valueSource && (!state.modules[patch.valueSource] || patch.valueSource === tag)) {
      rejectSfc(get, tag, 'Tracking requires a PID, valid independent source tags and a finite 0-100% constant')
      return
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'PID') return
      if ('enable' in patch) m.trackEnable = !!patch.enable
      if ('source' in patch) m.trackSource = patch.source
      if ('valueSource' in patch) m.trackValueSource = patch.valueSource
      if ('value' in patch) m.trackValue = patch.value ?? 0
    })
    get().logEvent('CONFIGURE', tag, `Tracking changed: ${JSON.stringify(patch)}`)
  },

  setFbInput: (tag, which, ref) => {
    if (motorEditorBlock(get(), tag)) { get().editMotorBlock(tag, { [which]: ref }); return }
    if (!requireUnlockedLock('CAN_CONFIGURE', `Wire ${tag}.${which.toUpperCase()}`)) return
    if (ref.kind === 'ref' && (ref.parameter || ref.block)) {
      const error = ref.tag
        ? signalError({ tag: ref.tag, parameter: ref.parameter ?? 'OUT', block: ref.block }, get().modules)
        : 'A signal source tag is required'
      if (error) {
        get().logEvent('DIAGNOSTIC', tag, `Function block connection rejected: ${error}`)
        window.alert(error)
        return
      }
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'FB') {
        m[which] = ref
        if (m.fbType === 'CND') resetConditionTiming(m)
      }
    })
    const source = ref.kind === 'const' ? ref.value :
      `${ref.tag}${ref.block ? '/' + ref.block : ''}${ref.parameter ? '.' + ref.parameter : ''}`
    get().logEvent('CONFIGURE', tag, `${which.toUpperCase()} wired to ${source}`)
  },

  setPidIo: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} analog strategy`)) return false
    if (get().pidLifecycle[tag] && !get().pidLifecycle[tag].online) {
      return rejectPid(get, tag, 'Go Online before editing a managed PID analog strategy')
    }
    const module = get().modules[tag]
    const error = patch.splitRange === false && get().hardware.analogBindings?.[tag]?.output2
      ? 'Disconnect the AO2 DST before removing its block'
      : module?.type === 'PID'
      ? pidIoPatchError(module, patch, get().modules)
      : `${tag} is not a PID control module`
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Analog strategy rejected: ${error}`)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') m.io = configurePidIo(m, patch)
    })
    get().logEvent('CONFIGURE', tag, `Analog strategy changed: ${JSON.stringify(patch)}`)
    return true
  },

  setSplitterConfig: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} splitter`)) return false
    const module = get().modules[tag]
    let error = module?.type === 'FB' && module.fbType === 'SPLTR'
      ? null : `${tag} is not a SPLTR block`
    for (const ref of [patch.feedback1Source, patch.feedback2Source]) {
      if (ref && !error) error = signalError(ref, get().modules) ??
        (ref.block !== 'AO1' && ref.block !== 'AO2' ? 'BKCAL feedback must come from an AO stage' : null)
    }
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Splitter configuration rejected: ${error}`)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'FB' || m.fbType !== 'SPLTR') return
      const { feedback1Source, feedback2Source, ...settings } = patch
      m.splitter = configureSplitter(m.splitter ?? createSplitter(), settings)
      if ('feedback1Source' in patch) m.bkcal1Source = feedback1Source
      if ('feedback2Source' in patch) m.bkcal2Source = feedback2Source
    })
    get().logEvent('CONFIGURE', tag, `SPLTR configuration changed: ${JSON.stringify(patch)}`)
    return true
  },

  setFbConfig: (tag, patch) => {
    if (motorEditorBlock(get(), tag)) {
      if (Object.keys(patch).some(key => key !== 'expr' && key !== 'delaySec')) {
        rejectSfc(get, tag, 'Owned motor blocks expose condition expression and delay configuration'); return
      }
      get().editMotorBlock(tag, patch)
      return
    }
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure ${tag}`)) return
    const module = get().modules[tag]
    if (module?.type !== 'FB') {
      const error = 'Function block configuration requires an existing function block'
      get().logEvent('DIAGNOSTIC', tag, error)
      window.alert(error)
      return
    }
    if (module?.type === 'FB' && module.fbType === 'CND') {
      const error = patch.expr !== undefined ? conditionSourceError(patch.expr, get().modules) : null
      const delayError = patch.delaySec !== undefined && (!Number.isFinite(patch.delaySec) || patch.delaySec < 0)
        ? 'Condition delay must be finite and nonnegative' : null
      if (error || delayError) {
        get().logEvent('DIAGNOSTIC', tag, `Condition configuration rejected: ${error ?? delayError}`)
        window.alert(error ?? delayError)
        return
      }
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'FB') {
        Object.assign(m, patch)
        if (m.fbType === 'CND' && (patch.expr !== undefined || patch.delaySec !== undefined)) resetConditionTiming(m)
      }
    })
    get().logEvent('CONFIGURE', tag, `Config changed: ${JSON.stringify(patch)}`)
  },

  setFbSafety: (tag, option, value) => {
    if (!requireUnlockedLock('RESTRICTED_CONTROL', `${option} ${tag}`)) return false
    const owned = ownedMotorBlock(get().modules, tag)
    if (owned && (!owned.owner.downloaded || !get().deviceLifecycle[owned.owner.tag]?.online)) {
      return rejectSfc(get, tag, 'Download the owned motor strategy and Go Online before safety writes')
    }
    if (owned) {
      const error = deviceOperatorError(owned.owner, get().hardware)
      if (error) return rejectSfc(get, tag, error)
    }
    const module = strategyModules(get().modules)[tag]
    const error = typeof value !== 'boolean' ? 'Safety setting must be Boolean' :
      module?.type !== 'FB' ||
        (option === 'BYPASS' ? module.fbType !== 'CND' :
          !['ARM_TRAP', 'RESET_IN'].includes(option) || module.fbType !== 'BFI')
        ? 'BYPASS requires CND; ARM_TRAP/RESET_IN require BFI' : null
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Safety configuration rejected: ${error}`)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, m => {
      if (m.type !== 'FB') return
      if (option === 'BYPASS') {
        resetConditionTiming(m)
        m.bypass = value
      } else if (option === 'ARM_TRAP') m.armTrap = value
      else m.resetTrap = value
    })
    get().logEvent('CONFIGURE', tag, `${option} set to ${Number(value)}`)
    return true
  },

  setAlarmLimit: (tag, type, patch) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Configure alarm ${tag}`)) return
    const error = !get().modules[tag]?.alarms.some(alarm => alarm.type === type)
      ? `${tag}.${type} is not a configured alarm`
      : patch.limit !== undefined && !Number.isFinite(patch.limit) ? 'Alarm limit must be finite' :
      patch.rank != null && (!Number.isInteger(patch.rank) || patch.rank < 4 || patch.rank > 15)
        ? 'Alarm priority rank must be a whole number from 4 to 15' : null
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Alarm configuration rejected: ${error}`)
      window.alert(error)
      return
    }
    mutateModule(set, get, tag, (m) => {
      m.alarms = m.alarms.map(alarm => {
        if (alarm.type !== type) return alarm
        const next = { ...alarm }
        if (patch.limit !== undefined) next.limit = patch.limit
        if (patch.enabled !== undefined) next.enabled = patch.enabled
        if (patch.priority !== undefined) next.priority = patch.priority
        if (patch.rank !== undefined) next.rank = patch.rank ?? undefined
        return next
      })
    })
    get().logEvent('CONFIGURE', tag, `Alarm ${type} configured: ${JSON.stringify(patch)}`)
  },

  alarmSuppressMinutes: {},
  readAlarmFieldValue: (path) => readAlarmField(get().modules, path, {
    alarms: get().alarms, time: get().time, suppressMinutes: get().alarmSuppressMinutes
  }),

  writeAlarmField: (path, value) => {
    const parsed = parseAlarmFieldPath(path)
    if ('error' in parsed) {
      get().logEvent('DIAGNOSTIC', path, `Alarm field write rejected: ${parsed.error}`)
      window.alert(parsed.error)
      return false
    }
    const lock = ALARM_FIELD_LOCK[parsed.field]
    if (lock && !useSecurity.getState().requireLock(lock, `Write ${path}`)) return false
    const error = alarmFieldWriteError(get().modules, path, value)
    if (error) {
      get().logEvent('DIAGNOSTIC', parsed.tag, `Alarm field write rejected: ${error}`)
      window.alert(error)
      return false
    }
    if (parsed.field === 'SUPTMO') {
      set((s) => ({ alarmSuppressMinutes: { ...s.alarmSuppressMinutes, [`${parsed.tag}.${parsed.type}`]: value as number }, rev: s.rev + 1 }))
      get().logEvent('CONFIGURE', parsed.tag, `${path} = ${value}`)
      return true
    }
    if (parsed.field === 'OPSUP') {
      const id = `${parsed.tag}.${parsed.type}`
      const live = get().alarms.find((a) => a.id === id)
      if (!live) {
        const message = `Nothing to suppress: ${parsed.tag}.${parsed.type} is not in alarm`
        get().logEvent('DIAGNOSTIC', parsed.tag, `Alarm field write rejected: ${message}`)
        window.alert(message)
        return false
      }
      if (value) get().shelveAlarm(id, get().alarmSuppressMinutes[id] ?? DEFAULT_SUPPRESS_MINUTES)
      else get().unshelveAlarm(id)
      get().logEvent('OPERATOR', parsed.tag, `${path} := ${value}`)
      return true
    }
    if (parsed.field === 'MACK') {
      get().ackAlarm(`${parsed.tag}.${parsed.type}`)
      get().logEvent('OPERATOR', parsed.tag, `${path} acknowledged via MACK`)
      return true
    }
    mutateModule(set, get, parsed.tag, (m) => {
      m.alarms = m.alarms.map((alarm) => {
        if (alarm.type !== parsed.type) return alarm
        if (parsed.field === 'ENAB') return { ...alarm, enabled: value as boolean }
        return { ...alarm, rank: (value as number | null) ?? undefined }
      })
    })
    get().logEvent('CONFIGURE', parsed.tag, `${path} = ${value}`)
    return true
  },

  startMotor: (tag) => {
    if (!requireUnlockedLock('CONTROL', `Start ${tag}`)) return
    if (gateSignature(set, get, tag, ['SP_D'], 'SP_D := 1', () => get().startMotor(tag))) return
    const module = get().modules[tag]
    if (module?.type === 'MOTOR') {
      const error = deviceOperatorError(module, get().hardware) ?? deviceDescriptorCommandError(module, get().namedSets)
      if (error) { rejectSfc(get, tag, error); return }
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = true
    })
    get().logEvent('OPERATOR', tag, module?.type === 'MOTOR' && module.descriptors ?
      `${deviceDescriptorLabel(module, get().namedSets, 'command', true).label} command issued (SP_D1)` : 'Start command issued')
  },

  stopMotor: (tag) => {
    if (!requireUnlockedLock('CONTROL', `Stop ${tag}`)) return
    if (gateSignature(set, get, tag, ['SP_D'], 'SP_D := 0', () => get().stopMotor(tag))) return
    const module = get().modules[tag]
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = false
    })
    get().logEvent('OPERATOR', tag, module?.type === 'MOTOR' && module.descriptors ?
      `${deviceDescriptorLabel(module, get().namedSets, 'command', false).label} command issued (SP_D0)` : 'Stop command issued')
  },

  openValve: (tag) => {
    if (!requireUnlockedLock('CONTROL', `Open ${tag}`)) return
    if (gateSignature(set, get, tag, ['SP_D'], 'SP_D := 1', () => get().openValve(tag))) return
    const module = get().modules[tag]
    if (module?.type === 'VALVE') {
      const error = deviceOperatorError(module, get().hardware) ?? deviceDescriptorCommandError(module, get().namedSets)
      if (error) { rejectSfc(get, tag, error); return }
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = true
    })
    get().logEvent('OPERATOR', tag, module?.type === 'VALVE' && module.descriptors ?
      `${deviceDescriptorLabel(module, get().namedSets, 'command', true).label} command issued (SP_D1)` : 'Open command issued')
  },

  closeValve: (tag) => {
    if (!requireUnlockedLock('CONTROL', `Close ${tag}`)) return
    if (gateSignature(set, get, tag, ['SP_D'], 'SP_D := 0', () => get().closeValve(tag))) return
    const module = get().modules[tag]
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = false
    })
    get().logEvent('OPERATOR', tag, module?.type === 'VALVE' && module.descriptors ?
      `${deviceDescriptorLabel(module, get().namedSets, 'command', false).label} command issued (SP_D0)` : 'Close command issued')
  },

  toggleDO: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Toggle ${tag}`)) return
    const module = get().modules[tag]
    if (module?.type !== 'DO' || module.mode === 'OOS') {
      const message = `${tag} must be a DO module in AUTO to accept SP_D writes`
      get().logEvent('DIAGNOSTIC', tag, message)
      window.alert(message)
      return
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'DO') {
        m.commanded = !m.commanded
        if (!get().hardware.discreteBindings?.[tag]) m.state = m.commanded
      }
    })
    get().logEvent('OPERATOR', tag, 'Discrete output toggled')
  },

  toggleInterlock: (tag) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Force Interlock ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).interlock = !(m as MotorModule).interlock
      if (m.type === 'VALVE') (m as ValveModule).interlock = !(m as ValveModule).interlock
    })
    get().logEvent('DIAGNOSTIC', tag, 'Interlock force-toggled')
  },

  injectFault: (tag) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Inject Fault ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).fault = !(m as MotorModule).fault
      if (m.type === 'VALVE') (m as ValveModule).fault = !(m as ValveModule).fault
    })
    get().logEvent('DIAGNOSTIC', tag, 'Fault injection toggled')
  },

  resetDevice: (tag) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Reset ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') resetDeviceLock(m)
    })
    get().logEvent('OPERATOR', tag, 'Device reset (RESET_D)')
  },

  setPermissive: (tag, ok) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Set Permissive ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') (m as MotorModule | ValveModule).permissiveOk = ok
    })
    get().logEvent('DIAGNOSTIC', tag, `Permissive forced ${ok ? 'OK' : 'NOT OK'}`)
  },

  setDeviceOptions: (tag, opts) => {
    if (get().deviceLifecycle[tag]) { get().editDeviceDraft(tag, opts); return }
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Configure device options ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'MOTOR' && m.type !== 'VALVE') return
      const d = m as MotorModule | ValveModule
      if (opts.permissiveRequired !== undefined) d.permissiveRequired = opts.permissiveRequired
      if (opts.resetRequired !== undefined) d.resetRequired = opts.resetRequired
    })
    get().logEvent('CONFIGURE', tag, `Device options changed: ${JSON.stringify(opts)}`)
  },

  setInterlockSource: (tag, source) => {
    if (get().deviceLifecycle[tag]) { get().editDeviceDraft(tag, { interlockSource: source }); return }
    if (!requireUnlockedLock('CAN_CONFIGURE', `Wire interlock source ${tag}`)) return
    const error = deviceSourceError(get().modules, tag, source, 'Interlock')
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Interlock wiring rejected: ${error}`)
      window.alert(error)
      return
    }
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') {
        m.interlockSource = source
        if (source) m.interlock = true
      }
    })
    get().logEvent('CONFIGURE', tag, `INTERLOCK_SOURCE set to ${source ?? '(none)'}`)
  },

  setPermissiveSource: (tag, source) => {
    if (get().deviceLifecycle[tag]) return get().editDeviceDraft(tag, { permissiveSource: source })
    if (!requireUnlockedLock('CAN_CONFIGURE', `Wire permissive source ${tag}`)) return false
    const state = get()
    const error = deviceSourceError(state.modules, tag, source, 'Permissive')
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Permissive wiring rejected: ${error}`)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, module => {
      if (module.type === 'MOTOR' || module.type === 'VALVE') {
        module.permissiveSource = source
        module.permissiveOk = false
      }
    })
    get().logEvent('CONFIGURE', tag, `PERMISSIVE_SOURCE set to ${source ?? '(manual; permit cleared)'}`)
    return true
  },

  setCommandSource: (tag, source) => {
    if (get().deviceLifecycle[tag]) { get().editDeviceDraft(tag, { commandSource: source }); return }
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Wire command source ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR' || m.type === 'VALVE') m.commandSource = source
    })
    get().logEvent('CONFIGURE', tag, `COMMAND_SOURCE set to ${source ?? '(none)'}`)
  },

  setDeviceLogic: (tag, patch) => {
    const state = get()
    if (state.deviceLifecycle[tag]) return rejectSfc(get, tag, 'Device logic is edited on the runtime module; turn off the saved device lifecycle for this device first')
    if (!requireUnlockedLock('CAN_CONFIGURE', `Edit device logic ${tag}`)) return false
    const error = deviceLogicError(state.modules, tag, patch)
    if (error) return rejectSfc(get, tag, error)
    mutateModule(set, get, tag, (m) => {
      if (m.type !== 'MOTOR' && m.type !== 'VALVE') return
      if (patch.interlockConditions) {
        m.interlockConditions = patch.interlockConditions.map(c => ({ ...c }))
        if (!m.interlockConditions.length && !m.interlockSource) m.interlock = false
      }
      if (patch.permissiveConditions) {
        m.permissiveConditions = patch.permissiveConditions.map(c => ({ ...c }))
        if (m.permissiveConditions.length) m.permissiveRequired = true
        else if (!m.permissiveSource) m.permissiveOk = true
      }
      if (patch.forceSetpoints) m.forceSetpoints = patch.forceSetpoints.map(c => ({ ...c }))
      if (patch.bypassed !== undefined) m.bypassed = patch.bypassed
    })
    get().logEvent('CONFIGURE', tag, `Device logic changed: interlocks ${patch.interlockConditions?.length ?? 'unchanged'}, permissives ${patch.permissiveConditions?.length ?? 'unchanged'}, force setpoints ${patch.forceSetpoints?.length ?? 'unchanged'}, bypass ${patch.bypassed ?? 'unchanged'}`)
    return true
  },

  setCasHealthy: (tag, healthy) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Force cascade ${tag}`)) return
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') (m as PidModule).casHealthy = healthy
    })
    get().logEvent('DIAGNOSTIC', tag, `Cascade connection forced ${healthy ? 'healthy' : 'unhealthy'}`)
  },

  failController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Fail controller ${tag}`)) return false
    let failed = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      failed = true
      const next = c.redundant
        ? c.primary === 'ACTIVE'
          ? { ...c, primary: 'FAILED' as const, secondary: 'ACTIVE' as const }
          : { ...c, secondary: 'FAILED' as const }
        : { ...c, primary: 'FAILED' as const }
      return { hardware: { ...s.hardware, controllers: { ...s.hardware.controllers, [tag]: next } }, rev: s.rev + 1 }
    })
    if (failed) get().logEvent('DIAGNOSTIC', tag, 'Controller leg failed')
    return failed
  },

  restoreController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Restore controller ${tag}`)) return false
    let restored = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      restored = true
      const next = c.redundant
        ? { ...c, primary: 'ACTIVE' as const, secondary: 'STANDBY' as const }
        : { ...c, primary: 'ACTIVE' as const }
      return { hardware: { ...s.hardware, controllers: { ...s.hardware.controllers, [tag]: next } }, rev: s.rev + 1 }
    })
    if (restored) get().logEvent('DIAGNOSTIC', tag, 'Controller restored')
    return restored
  },

  createController: (tag, description) => {
    if (!useSecurity.getState().requireLock('SYSTEM_ADMIN', `Create controller ${tag}`)) return false
    const normalizedTag = tag.trim()
    const normalizedDescription = description.trim()
    const error = !isValidControllerTag(normalizedTag)
      ? 'Controller names must have at most 16 letters, digits, $, - or _, with at least one letter'
      : normalizedDescription.length > MAX_CONTROLLER_DESCRIPTION_LENGTH
        ? `Controller descriptions must have at most ${MAX_CONTROLLER_DESCRIPTION_LENGTH} characters`
        : Object.keys(get().hardware.controllers).some(existing => existing.toLowerCase() === normalizedTag.toLowerCase())
          ? `Controller ${normalizedTag} already exists` : null
    if (error) {
      get().logEvent('DIAGNOSTIC', normalizedTag, `Controller creation rejected: ${error}`)
      window.alert(error)
      return false
    }

    let created = false
    set((s) => {
      if (Object.keys(s.hardware.controllers).some((existing) => existing.toLowerCase() === normalizedTag.toLowerCase())) return {}
      created = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [normalizedTag]: {
              tag: normalizedTag,
              description: normalizedDescription,
              commissioned: false,
              redundant: false,
              networkRedundant: false,
              controlNetworkAddress: null,
              identified: false,
              coldRestartMinutes: 0,
              powerDownAt: null,
              lastAutoSense: null,
              primary: 'N/A' as const,
              secondary: 'N/A' as const,
              scanTimeMs: 0,
              cpuLoadPct: 0,
              carrierIds: []
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (created) get().logEvent('CONFIGURE', normalizedTag, `Decommissioned controller created: ${normalizedDescription}`)
    return created
  },

  setControllerConfiguration: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure controller ${tag}`)) return false
    if (
      patch.coldRestartMinutes !== undefined &&
      (!Number.isInteger(patch.coldRestartMinutes) || patch.coldRestartMinutes < 0 || patch.coldRestartMinutes > MAX_COLD_RESTART_MINUTES)
    ) {
      return false
    }

    let updated = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.powerDownAt !== null || (controllerIsDown(c) && c.commissioned)) return {}
      const redundant = patch.redundant ?? c.redundant
      let primary = c.primary
      let secondary = c.secondary
      if (!c.commissioned) {
        primary = 'N/A'
        secondary = 'N/A'
      } else if (!redundant) {
        secondary = 'N/A'
      } else if (!c.redundant) {
        primary = 'ACTIVE'
        secondary = 'STANDBY'
      } else if (secondary === 'N/A') {
        secondary = 'STANDBY'
      }
      updated = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: {
              ...c,
              ...patch,
              redundant,
              primary,
              secondary
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (updated) get().logEvent('CONFIGURE', tag, `Controller properties changed: ${JSON.stringify(patch)}`)
    return updated
  },

  commissionController: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Commission controller ${tag}`)) return false
    let commissioned = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.commissioned || c.powerDownAt !== null) return {}
      const controlNetworkAddress = c.controlNetworkAddress ?? allocateControlNetworkAddress(s.hardware.controllers)
      if (!controlNetworkAddress) return {}
      commissioned = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: {
              ...c,
              commissioned: true,
              controlNetworkAddress,
              identified: false,
              primary: 'ACTIVE',
              secondary: c.redundant ? 'STANDBY' : 'N/A'
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (commissioned) get().logEvent('CONFIGURE', tag, 'Controller commissioned and added to the control network')
    return commissioned
  },

  decommissionController: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Decommission controller ${tag}`)) return false
    let decommissioned = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      decommissioned = true
      return {
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: { ...c, commissioned: false, identified: false, primary: 'N/A', secondary: 'N/A' }
          }
        },
        moduleLifecycle: Object.fromEntries(Object.entries(s.moduleLifecycle).map(([moduleTag, record]) =>
          [moduleTag, record.deployed?.controllerTag === tag
            ? { ...record, lastGoodDownload: undefined, restartDownload: undefined,
              restartMemoryRequired: false, replayFullRequired: true } : record])),
        modules: Object.fromEntries(Object.entries(s.modules).map(([moduleTag, module]) =>
          [moduleTag, module.type === 'AO' && s.moduleLifecycle[moduleTag]?.deployed?.controllerTag === tag
            ? { ...module, downloaded: false, bad: true, actualMode: 'OOS' as const } : module])),
        rev: s.rev + 1
      }
    })
    if (decommissioned) get().logEvent('CONFIGURE', tag, 'Controller decommissioned; bound I/O unavailable; managed AO modules require fresh Full downloads')
    return decommissioned
  },

  identifyController: (tag, identifying) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Identify controller ${tag}`)) return false
    let changed = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.powerDownAt !== null || c.identified === identifying) return {}
      changed = true
      return {
        hardware: {
          ...s.hardware,
          controllers: { ...s.hardware.controllers, [tag]: { ...c, identified: identifying } }
        },
        rev: s.rev + 1
      }
    })
    if (changed) get().logEvent('DIAGNOSTIC', tag, identifying ? 'Controller identify flashing started' : 'Controller identify flashing stopped')
    return changed
  },

  autoSenseController: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Auto-sense I/O for controller ${tag}`)) return false
    const state = get()
    const controller = state.hardware.controllers[tag]
    if (!controller || !controller.commissioned || controllerIsDown(controller)) return false
    const result = scanControllerIo(state.hardware, tag, new Set(Object.keys(state.modules)))
    if (!result) return false
    set((s) => ({
      hardware: {
        ...s.hardware,
        controllers: { ...s.hardware.controllers, [tag]: { ...s.hardware.controllers[tag], lastAutoSense: result } }
      },
      rev: s.rev + 1
    }))
    get().logEvent(
      'DIAGNOSTIC',
      tag,
      `I/O auto-sense complete: ${result.carriersScanned} carriers, ${result.baseplatesScanned} baseplates, ${result.channelsDetected} channels detected, ${result.unresolvedBindings.length} unresolved bindings`
    )
    return true
  },

  simulateControllerPowerLoss: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Simulate power loss for controller ${tag}`)) return false
    let poweredDown = false
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || !c.commissioned || c.powerDownAt !== null) return {}
      poweredDown = true
      return {
        moduleLifecycle: Object.fromEntries(Object.entries(s.moduleLifecycle).map(([moduleTag, record]) => {
          const runtime = s.modules[moduleTag]
          return [moduleTag, record.deployed?.controllerTag === tag && runtime?.type === 'AO' && runtime.downloaded
            ? { ...record, nvm: memoryOf(runtime) } : record]
        })),
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: {
              ...c,
              identified: false,
              powerDownAt: Date.now(),
              primary: 'FAILED',
              secondary: c.redundant ? 'FAILED' : 'N/A'
            }
          }
        },
        rev: s.rev + 1
      }
    })
    if (poweredDown) get().logEvent('DIAGNOSTIC', tag, 'Controller power loss simulated; all bound I/O is Bad')
    return poweredDown
  },

  restoreControllerPower: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Restore power to controller ${tag}`)) return false
    let restored = false
    let coldRestartSucceeded = false
    let outageMinutes = 0
    let decision: ColdRestartDecision = { restart: false, reason: '' }
    set((s) => {
      const c = s.hardware.controllers[tag]
      if (!c || c.powerDownAt === null) return {}
      outageMinutes = Math.max(0, (Date.now() - c.powerDownAt) / 60_000)
      decision = coldRestartDecision(c.coldRestartMinutes, outageMinutes)
      coldRestartSucceeded = decision.restart
      restored = true
      const modules = { ...s.modules }
      const moduleLifecycle = { ...s.moduleLifecycle }
      for (const [moduleTag, record] of Object.entries(s.moduleLifecycle)) {
        const runtime = modules[moduleTag]
        if (record.deployed?.controllerTag !== tag || runtime?.type !== 'AO') continue
        const restore = coldRestartSucceeded && runtime.downloaded === true
        modules[moduleTag] = restore ? restartAo(record, runtime, s.hardware)
          : { ...runtime, downloaded: false, bad: true, actualMode: 'OOS' }
        moduleLifecycle[moduleTag] = { ...record, nvm: restore ? memoryOf(modules[moduleTag]) : undefined }
      }
      return {
        modules,
        moduleLifecycle,
        hardware: {
          ...s.hardware,
          controllers: {
            ...s.hardware.controllers,
            [tag]: coldRestartSucceeded
              ? {
                  ...c,
                  lastRestoration: { at: Date.now(), outageMinutes, coldRestart: true, reason: decision.reason },
                  commissioned: true,
                  powerDownAt: null,
                  primary: 'ACTIVE',
                  secondary: c.redundant ? 'STANDBY' : 'N/A'
                }
              : {
                  ...c,
                  lastRestoration: { at: Date.now(), outageMinutes, coldRestart: false, reason: decision.reason },
                  commissioned: false,
                  identified: false,
                  powerDownAt: null,
                  primary: 'N/A',
                  secondary: 'N/A'
                }
          }
        },
        rev: s.rev + 1
      }
    })
    if (restored) {
      const message = coldRestartSucceeded
        ? `Cold restart succeeded after ${outageMinutes.toFixed(2)} minutes (${decision.reason}); controller returned to service`
        : `Cold restart unavailable after ${outageMinutes.toFixed(2)} minutes (${decision.reason}); controller requires commissioning and download`
      get().logEvent('DIAGNOSTIC', tag, message)
      for (const [moduleTag, record] of Object.entries(get().moduleLifecycle)) {
        if (record.deployed?.controllerTag === tag && record.restartMemoryRequired) {
          get().logEvent('DIAGNOSTIC', moduleTag,
            'AO restart inhibited: transfer memory was not refreshed after Partial download; fresh Full module download required')
        }
      }
    }
    return restored
  },

  pullCharm: (baseplateId, slot) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Pull CHARM ${baseplateId}/${slot}`)) return
    set((s) => {
      const bp = s.hardware.baseplates[baseplateId]
      if (!bp) return {}
      const channels = bp.channels.map((c) => (c.slot === slot ? { ...c, pulled: true } : c))
      return {
        hardware: { ...s.hardware, baseplates: { ...s.hardware.baseplates, [baseplateId]: { ...bp, channels } } },
        rev: s.rev + 1
      }
    })
    get().logEvent('DIAGNOSTIC', `${baseplateId}/${slot}`, 'CHARM pulled')
  },

  reinsertCharm: (baseplateId, slot) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Reinsert CHARM ${baseplateId}/${slot}`)) return
    set((s) => {
      const bp = s.hardware.baseplates[baseplateId]
      if (!bp) return {}
      const channels = bp.channels.map((c) => (c.slot === slot ? { ...c, pulled: false } : c))
      return {
        hardware: { ...s.hardware, baseplates: { ...s.hardware.baseplates, [baseplateId]: { ...bp, channels } } },
        rev: s.rev + 1
      }
    })
    get().logEvent('DIAGNOSTIC', `${baseplateId}/${slot}`, 'CHARM reinserted')
  },

  ackAlarm: (id) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Acknowledge alarm')) return
    const target = get().alarms.find((a) => a.id === id)
    set((s) => ({
      alarms: s.alarms
        .map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
        .filter((a) => a.active || !a.acknowledged),
      rev: s.rev + 1
    }))
    if (target) get().logEvent('ACK', target.moduleTag, `${target.label} alarm acknowledged`, target.priority)
  },

  ackAll: () => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Acknowledge All')) return
    const count = get().alarms.filter((a) => !a.acknowledged).length
    set((s) => ({
      alarms: s.alarms.map((a) => ({ ...a, acknowledged: true })).filter((a) => a.active),
      rev: s.rev + 1
    }))
    get().logEvent('ACK', '—', `Acknowledge All (${count} alarms)`)
  },

  shelveAlarm: (id, durationMin) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Shelve alarm')) return
    const target = get().alarms.find((a) => a.id === id)
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, shelvedUntil: s.time + durationMin * 60000 } : a)),
      rev: s.rev + 1
    }))
    if (target) get().logEvent('ACK', target.moduleTag, `${target.label} alarm shelved for ${durationMin} min`, target.priority)
  },

  unshelveAlarm: (id) => {
    if (!useSecurity.getState().requireLock('ALARMS', 'Unshelve alarm')) return
    const target = get().alarms.find((a) => a.id === id)
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, shelvedUntil: undefined } : a)),
      rev: s.rev + 1
    }))
    if (target) get().logEvent('ACK', target.moduleTag, `${target.label} alarm unshelved`, target.priority)
  },

  setRunning: (r) => set({ running: r }),
  setSpeed: (speed) => {
    const error = validateScale(speed)
    if (error) { get().logEvent('DIAGNOSTIC', 'SIMULATOR', `Time scale rejected: ${error}`); return }
    set({ speed })
    get().logEvent('OPERATOR', 'SIMULATOR', `Time scale set to ${speed}x`)
  },
  moduleScheduling: {},
  setModuleSchedule: (tag, change) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure module scan ${tag}`)) return false
    const state = get()
    const reject = (message: string): false => {
      get().logEvent('DIAGNOSTIC', tag, `Module scan rejected: ${message}`)
      window.alert(message)
      return false
    }
    if (!state.modules[tag]) return reject(`Module ${tag} does not exist`)
    const current = state.moduleScheduling[tag] ?? { multiple: 1, order: null, accum: 0 }
    const multiple = change.multiple ?? current.multiple
    const order = change.order === undefined ? current.order : change.order
    const error = validateScanMultiple(multiple) ?? validateExecutionOrder(order)
    if (error) return reject(error)
    const next = { ...state.moduleScheduling }
    if (isDefaultSchedule({ multiple, order })) delete next[tag]
    else next[tag] = { multiple, order, accum: 0 }
    set({ moduleScheduling: next, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', tag, `Module scan multiple ${multiple} (${multiple} s base period), execution order ${order ?? 'automatic'}`)
    return true
  },
  recipes: { [DEFAULT_RECIPE_NAME]: defaultRecipe() },
  activeRecipe: DEFAULT_RECIPE_NAME,
  saveRecipe: (recipe) => {
    if (!useSecurity.getState().requireLock('BUILD_RECIPES', `Save recipe ${recipe.name}`)) return 'Requires the Build Recipes key'
    const state = get()
    const fail = (message: string): string => {
      get().logEvent('DIAGNOSTIC', recipe.name, `Recipe save rejected: ${message}`)
      return message
    }
    const errors = recipeErrors(recipe, state.phases)
    if (errors.length) return fail(errors.join('; '))
    const busy = state.batch.status === 'RUNNING' || state.batch.status === 'HELD'
    if (busy && state.activeRecipe === recipe.name) return fail('Stop or reset the batch before changing the recipe it is running')
    const existing = state.recipes[recipe.name]
    const saved: Recipe = { ...recipe, procedure: [...recipe.procedure], formula: { ...recipe.formula },
      version: existing ? existing.version + 1 : 1 }
    set({ recipes: { ...state.recipes, [saved.name]: saved }, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', saved.name, `Recipe ${existing ? 'changed' : 'created'}: version ${saved.version}, procedure ${saved.procedure.join(' > ')}`)
    return null
  },
  deleteRecipe: (name) => {
    if (!useSecurity.getState().requireLock('BUILD_RECIPES', `Delete recipe ${name}`)) return 'Requires the Build Recipes key'
    const state = get()
    const message = !state.recipes[name] ? `Recipe ${name} does not exist` :
      name === state.activeRecipe ? 'The selected recipe cannot be deleted; select another recipe first' :
        Object.keys(state.recipes).length <= 1 ? 'The last recipe cannot be deleted' : null
    if (message) { get().logEvent('DIAGNOSTIC', name, `Recipe delete rejected: ${message}`); return message }
    const recipes = { ...state.recipes }
    delete recipes[name]
    set({ recipes, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', name, 'Recipe deleted')
    return null
  },
  selectRecipe: (name) => {
    if (!requireUnlockedLock('BATCH_OPERATE', `Select recipe ${name}`)) return 'Requires the Batch Operate key'
    const state = get()
    const message = !state.recipes[name] ? `Recipe ${name} does not exist` :
      state.batch.status !== 'READY' ? 'Reset the batch to READY before selecting a different recipe' : null
    if (message) { get().logEvent('DIAGNOSTIC', name, `Recipe selection rejected: ${message}`); return message }
    set({ activeRecipe: name, batch: { ...state.batch, recipe: name }, rev: state.rev + 1 })
    get().logEvent('BATCH', state.batch.id, `Recipe ${name} selected`)
    return null
  },
  initializeSimulation: () => {
    if (!requireUnlockedLock('CONTROL', 'Initialize simulation')) return false
    const state = get()
    const modules: Record<string, AnyModule> = {}
    for (const [tag, module] of Object.entries(state.modules))
      modules[tag] = module.type === 'PID' ? { ...module, _integral: 0, _prevPv: module.pv, _dFilt: 0 } : module
    set({
      running: false,
      process: { ...simulationBaseline.process },
      photoPlant: state.photoPlant ? simulationBaseline.photoPlant ?? state.photoPlant : state.photoPlant,
      modules,
      alarms: [],
      trend: [],
      batch: { ...makeBatch(), recipe: state.activeRecipe },
      sfcs: Object.fromEntries(Object.entries(state.sfcs).map(([name, sfc]) => [name, { ...sfc, parameters: resetSfcBooleanActions(sfc),
        status: 'READY' as const, active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} }])),
      rev: state.rev + 1
    })
    useSimulator.getState().recordInitialized(get().time, useSecurity.getState().currentUser)
    get().logEvent('OPERATOR', 'SIMULATOR', 'Simulation initialized: process reservoirs returned to initial conditions, PID integrators cleared, alarms/trend/batch/SFC runtime reset, simulation on hold')
    return true
  },

  batchCommand: (cmd) => {
    if (!useSecurity.getState().requireLock('BATCH_OPERATE', 'Batch command')) return
    let resolved: ReturnType<typeof resolveRecipe> | undefined
    if (cmd === 'START') {
      const recipe = get().recipes[get().activeRecipe]
      resolved = recipe ? resolveRecipe(recipe, get().phases) : { ok: false, errors: [`Recipe ${get().activeRecipe} does not exist`] }
      if (!resolved.ok) {
        const message = `Recipe ${get().activeRecipe} cannot run: ${resolved.errors.join('; ')}`
        get().logEvent('DIAGNOSTIC', get().batch.id, `Batch command rejected: ${message}`); window.alert(message)
        return
      }
    }
    if (cmd === 'START' || cmd === 'RESTART') {
      const state = get()
      const procedure = resolved?.ok ? resolved.resolved.procedure : state.batch.procedure ?? PROCEDURE
      const phaseDefs = resolved?.ok ? resolved.resolved.phases : state.batch.phaseDefs ?? state.phases
      for (const name of procedure) {
        const phase = phaseDefs[name]
        const error = !phase || !phase.steps.length ? `Phase ${name} requires steps` : sfcStepsError(phase.steps, state.modules)
        if (error) {
          get().logEvent('DIAGNOSTIC', state.batch.id, `Batch command rejected: ${error}`); window.alert(error)
          return
        }
      }
    }
    set((s) => ({ batch: commandBatch(s.batch, cmd, s.time, s.phases, resolved?.ok ? resolved.resolved : undefined), rev: s.rev + 1 }))
    get().logEvent('BATCH', get().batch.id, `Batch command: ${cmd}`)
  },

  setPhaseSteps: (phaseName, steps) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit Phase ${phaseName}`)) return
    const state = get()
    if (!state.phases[phaseName] || state.batch.status === 'RUNNING' || state.batch.status === 'HELD') {
      const message = !state.phases[phaseName] ? `Phase ${phaseName} does not exist` : 'Reset or stop the batch before editing phase logic'
      get().logEvent('DIAGNOSTIC', phaseName, message); window.alert(message)
      return
    }
    set((s) => {
      const def = s.phases[phaseName]
      if (!def) return {}
      return { phases: { ...s.phases, [phaseName]: { ...def, steps } }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', phaseName, 'Phase logic edited')
  },

  createArea: (name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', 'Create plant area')) return false
    const key = name.trim().toUpperCase()
    const error = areaNameError(key) ?? (get().areas.includes(key) ? `Area ${key} already exists` : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', key, `Area creation rejected: ${error}`)
      window.alert(error)
      return false
    }
    set(s => ({ areas: [...s.areas, key], rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', key, 'Plant area created')
    return true
  },

  renameArea: (name, nextName) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Rename plant area ${name}`)) return false
    const key = nextName.trim().toUpperCase()
    const state = get()
    const error = !state.areas.includes(name) ? `Area ${name} does not exist` :
      areaNameError(key) ?? (key !== name && state.areas.includes(key) ? `Area ${key} already exists` : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', name, `Area rename rejected: ${error}`)
      window.alert(error)
      return false
    }
    if (key === name) return true
    set(s => ({
      areas: s.areas.map(area => area === name ? key : area),
      modules: Object.fromEntries(Object.entries(s.modules).map(([tag, module]) =>
        [tag, module.area === name ? module.type === 'MOTOR' && module.ownedBlocks ? { ...module, area: key,
          ownedBlocks: Object.fromEntries(Object.entries(module.ownedBlocks).map(([blockName, b]) => [blockName, { ...b, area: key }])) } :
          { ...module, area: key } : module])),
      equipment: Object.fromEntries(Object.entries(s.equipment).map(([tag, equipment]) =>
        [tag, equipment.area === name ? { ...equipment, area: key } : equipment])),
      sfcs: Object.fromEntries(Object.entries(s.sfcs).map(([tag, sfc]) =>
        [tag, sfc.area === name ? { ...sfc, area: key } : sfc])),
      sfcLifecycle: Object.fromEntries(Object.entries(s.sfcLifecycle).map(([tag, lifecycle]) =>
        [tag, { ...lifecycle,
          draft: lifecycle.draft.area === name ? { ...lifecycle.draft, area: key } : lifecycle.draft,
          saved: lifecycle.saved?.area === name ? { ...lifecycle.saved, area: key } : lifecycle.saved,
          deployed: lifecycle.deployed?.area === name ? { ...lifecycle.deployed, area: key } : lifecycle.deployed
        }])),
      rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', key, `Plant area renamed from ${name}`)
    return true
  },

  createModule: (spec) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Create module ${spec.tag}`)) return false
    const tag = spec.tag.trim().toUpperCase()
    const state = get()
    const error = moduleNameError(tag) ?? (state.modules[tag] || state.sfcs[tag] ? `Module ${tag} already exists` :
      !state.areas.includes(spec.area) ? `Area ${spec.area} does not exist` :
      spec.templateId && spec.type !== 'PID' ? 'PID_LOOP template can only create a PID module' : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Module creation rejected: ${error}`)
      window.alert(error)
      return false
    }
    const module = makeModule({ ...spec, tag })
    if (module.type === 'AO') {
      const scaleError = aoConfigurationError(module)
      if (scaleError) return rejectAo(get, tag, scaleError)
    }
    set(s => ({ modules: { ...s.modules, [tag]: module }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Module created')
    return true
  },

  addSerialCard: (controllerTag, slot, placeholder = false) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Add serial card to ${controllerTag}`)) return 'Requires the Can Configure key'
    const hw = get().hardware
    const error = !hw.controllers[controllerTag] ? 'Controller does not exist' :
      !Number.isInteger(slot) || slot < 1 || slot > 8 ? 'Serial card slot must be 1-8' :
      Object.values(hw.traditionalCards ?? {}).some(card => !card.serial && card.controllerTag === controllerTag && card.slot === slot) ||
      Object.values(hw.serialCards ?? {}).some(card => card.controllerTag === controllerTag && card.slot === slot) ||
      Object.values(h1Slots(hw)).some(slots => slots.controllerTag === controllerTag && slots.slots.includes(slot))
        ? `Slot ${slot} already has a card` : null
    if (error) {
      get().logEvent('DIAGNOSTIC', controllerTag, `Add serial card rejected: ${error}`)
      return error
    }
    const card = makeSerialCard(controllerTag, slot, placeholder)
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards, [card.id]: card } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', card.id, placeholder ? 'Serial card placeholder added' : 'Serial card added')
    return null
  },

  removeSerialCard: (cardId) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    if (!card) return 'Serial card does not exist'
    const inUse = Object.values(get().hardware.traditionalCards ?? {}).filter(item => item.serial?.cardId === cardId)
      .flatMap(item => item.channels.map(channel => channel.dst))
    const bound = inUse.find(dst => Object.values(get().hardware.analogBindings ?? {}).some(b => Object.values(b).includes(dst)) ||
      Object.values(get().hardware.deviceBindings ?? {}).some(b => Object.values(b).includes(dst)) ||
      Object.values(get().hardware.discreteBindings ?? {}).includes(dst))
    if (bound) return `DST ${bound} is bound to a module; disconnect its module binding first`
    set(s => {
      const serialCards = { ...s.hardware.serialCards }
      delete serialCards[cardId]
      return { hardware: syncSerialDatasetCards({ ...s.hardware, serialCards }), rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', cardId, 'Serial card removed')
    return null
  },

  configureSerialCard: (cardId, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    if (!card) return 'Serial card does not exist'
    if (patch.capacity !== undefined && patch.capacity !== 'DST' && patch.capacity !== 'SCADA') return 'Capacity must be DST or SCADA'
    const next = { ...card.configured, ...patch }
    const capacity = next.capacity === 'SCADA' ? SERIAL_LIMITS.scadaCapacity : SERIAL_LIMITS.dstCapacity
    if (serialDstCount(next) > capacity) return `The card holds ${serialDstCount(next)} values; the ${next.capacity} limit is ${capacity}`
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards,
      [cardId]: { ...card, configured: next } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, `Serial card configured: ${JSON.stringify(patch)}`)
    return null
  },

  configureSerialPort: (cardId, portId, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    if (!card || !SERIAL_PORT_IDS.includes(portId)) return 'Serial card or port does not exist'
    const port: SerialPortConfig = { ...card.configured.ports[portId], ...patch, devices: card.configured.ports[portId].devices }
    const error = serialPortError(port, portId)
    if (error) {
      get().logEvent('DIAGNOSTIC', cardId, `Serial port configuration rejected: ${error}`)
      return error
    }
    const configured = { ...card.configured, ports: { ...card.configured.ports, [portId]: port } }
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards, [cardId]: { ...card, configured } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', `${cardId}/${portId}`, `Serial port configured: ${JSON.stringify(patch)}`)
    return null
  },

  addSerialDevice: (cardId, portId, name, address) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    if (!card || !SERIAL_PORT_IDS.includes(portId)) return 'Serial card or port does not exist'
    const error = serialDeviceError(card.configured, portId, name, address)
    if (error) {
      get().logEvent('DIAGNOSTIC', cardId, `Serial device rejected: ${error}`)
      return error
    }
    const port = card.configured.ports[portId]
    const configured = { ...card.configured, ports: { ...card.configured.ports,
      [portId]: { ...port, devices: { ...port.devices, [name]: { name, address, datasets: {} } } } } }
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards, [cardId]: { ...card, configured } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', `${cardId}/${portId}/${name}`, `Serial device added at address ${address}`)
    return null
  },

  removeSerialDevice: (cardId, portId, name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    const port = card?.configured.ports[portId]
    if (!card || !port?.devices[name]) return 'Serial device does not exist'
    const devices = { ...port.devices }
    delete devices[name]
    const configured = { ...card.configured, ports: { ...card.configured.ports, [portId]: { ...port, devices } } }
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards, [cardId]: { ...card, configured } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', `${cardId}/${portId}/${name}`, 'Serial device removed')
    return null
  },

  saveSerialDataset: (cardId, portId, deviceName, dataset, existingName) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    if (!card || !SERIAL_PORT_IDS.includes(portId)) return 'Serial card or port does not exist'
    const others = Object.values(get().hardware.serialCards ?? {}).filter(item => item.id !== cardId)
      .flatMap(item => [item.configured])
    const error = serialDatasetError(card.configured, portId, deviceName, dataset, existingName, others)
    if (error) {
      get().logEvent('DIAGNOSTIC', cardId, `Dataset rejected: ${error}`)
      return error
    }
    const port = card.configured.ports[portId]
    const device = port.devices[deviceName]
    const datasets = { ...device.datasets }
    if (existingName && existingName !== dataset.name) delete datasets[existingName]
    datasets[dataset.name] = dataset
    const configured = { ...card.configured, ports: { ...card.configured.ports,
      [portId]: { ...port, devices: { ...port.devices, [deviceName]: { ...device, datasets } } } } }
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards, [cardId]: { ...card, configured } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', `${cardId}/${portId}/${deviceName}/${dataset.name}`,
      `Dataset ${dataset.tag} saved: ${dataset.direction.toLowerCase()} ${dataset.count} ${dataset.plcTable.toLowerCase().replace('_', ' ')} from ${modbusAddress(dataset)}`)
    return null
  },

  removeSerialDataset: (cardId, portId, deviceName, datasetName) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure serial card ${cardId}`)) return 'Requires the Can Configure key'
    const card = get().hardware.serialCards?.[cardId]
    const port = card?.configured.ports[portId]
    const device = port?.devices[deviceName]
    if (!card || !port || !device?.datasets[datasetName]) return 'Dataset does not exist'
    const datasets = { ...device.datasets }
    delete datasets[datasetName]
    const configured = { ...card.configured, ports: { ...card.configured.ports,
      [portId]: { ...port, devices: { ...port.devices, [deviceName]: { ...device, datasets } } } } }
    set(s => ({ hardware: { ...s.hardware, serialCards: { ...s.hardware.serialCards, [cardId]: { ...card, configured } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', `${cardId}/${portId}/${deviceName}/${datasetName}`, 'Dataset removed')
    return null
  },

  downloadSerialCard: (cardId) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Download serial card ${cardId}`)) return 'Requires the Can Download key'
    const hw = get().hardware
    const card = hw.serialCards?.[cardId]
    if (!card) return 'Serial card does not exist'
    const controller = hw.controllers[card.controllerTag]
    const problem = !controller || !controller.commissioned ? `Commission controller ${card.controllerTag} before downloading the card` :
      controllerIsDown(controller) ? `Controller ${card.controllerTag} is not available` : null
    const config = card.configured
    const error = problem ?? SERIAL_PORT_IDS.map(id => serialPortError(config.ports[id], id)).find(Boolean) ??
      (serialDstCount(config) > (config.capacity === 'SCADA' ? SERIAL_LIMITS.scadaCapacity : SERIAL_LIMITS.dstCapacity)
        ? 'The card exceeds its DST/SCADA capacity' : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', cardId, `Serial card download rejected: ${error}`)
      return error
    }
    const deployedCard: SerialCard = { ...card, placeholder: false, deployed: cloneSerialConfig(config), runtime: emptySerialRuntime() }
    set(s => ({ hardware: syncSerialDatasetCards({ ...s.hardware, serialCards: { ...s.hardware.serialCards, [cardId]: deployedCard } }), rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, 'Serial card downloaded; ports and datasets are active')
    return null
  },

  addTraditionalCard: (controllerTag, slot, type) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Add traditional card to ${controllerTag}`)) return false
    const hw = get().hardware
    const error = !hw.controllers[controllerTag] ? 'Controller does not exist' :
      !Number.isInteger(slot) || slot < 1 || slot > 8 ? 'Training card slot must be 1-8' :
      !['AI', 'AO', 'DI', 'DO'].includes(type) ? 'Unsupported traditional card type' :
      Object.values(hw.traditionalCards ?? {}).some(card => card.controllerTag === controllerTag && card.slot === slot) ||
      Object.values(hw.serialCards ?? {}).some(card => card.controllerTag === controllerTag && card.slot === slot) ||
      Object.values(h1Slots(hw)).some(slots => slots.controllerTag === controllerTag && slots.slots.includes(slot))
        ? `Slot ${slot} already has a traditional card` : null
    if (error) {
      get().logEvent('DIAGNOSTIC', controllerTag, `Add card rejected: ${error}`)
      window.alert(error)
      return false
    }
    const card = makeTraditionalCard(controllerTag, slot, type)
    set(s => ({ hardware: { ...s.hardware,
      traditionalCards: { ...s.hardware.traditionalCards, [card.id]: card } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', card.id, `Traditional ${type} card added`)
    return true
  },

  configureTraditionalChannel: (cardId, channelNumber, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${cardId} channel ${channelNumber}`)) return false
    const normalized = { ...patch, dst: patch.dst.trim().toUpperCase(),
      tiebackDst: patch.tiebackDst?.trim().toUpperCase() || undefined }
    const card = get().hardware.traditionalCards?.[cardId]
    const error = channelConfigurationError(get().hardware, cardId, channelNumber, normalized)
    if (error || !card) {
      const message = error ?? 'Traditional card does not exist'
      get().logEvent('DIAGNOSTIC', cardId, `Channel configuration rejected: ${message}`)
      window.alert(message)
      return false
    }
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [cardId]: { ...card, channels: card.channels.map(channel => channel.channel === channelNumber
        ? { ...channel, ...normalized, bad: true,
          // Tieback changes the raw domain from engineering units to percent.
          filteredValue: card.type === 'AI' && normalized.tiebackDst !== channel.tiebackDst ?
            (normalized.tiebackDst ? findDst(s.hardware, normalized.tiebackDst)?.channel.value ?? channel.value :
              channel.value) : channel.filteredValue } : channel) } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, `Channel ${channelNumber}: DST ${normalized.dst || '(none)'}, enabled ${normalized.enabled}, simulated tieback ${normalized.tiebackDst ?? '(none)'}`)
    return true
  },

  configureInputFilter: (cardId, channelNumber, seconds) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure AI channel filter ${cardId}`)) return false
    const card = get().hardware.traditionalCards?.[cardId]
    const channel = card?.channels.find(c => c.channel === channelNumber)
    const error = !card || card.type !== 'AI' || !channel ? 'Select a traditional AI card/channel' :
      !Number.isFinite(seconds) || seconds < 0 ? 'Input filter time must be finite and nonnegative' : null
    if (error || !card) {
      const message = error ?? 'Traditional AI card does not exist'
      get().logEvent('DIAGNOSTIC', cardId, message); window.alert(message)
      return false
    }
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [cardId]: { ...card, channels: card.channels.map(c => c.channel === channelNumber ?
        { ...c, configuredFilterSeconds: seconds } : c) } } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, `CH${channelNumber} configured filter ${seconds}s; transfer required`)
    return true
  },

  downloadInputFilters: (cardId) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Download input filters ${cardId}`)) return false
    const state = get()
    const card = state.hardware.traditionalCards?.[cardId]
    const controller = card ? state.hardware.controllers[card.controllerTag] : undefined
    const error = !card || card.type !== 'AI' ? 'Select a traditional AI card' :
      !controller || controllerIsDown(controller) ? 'Input filter transfer requires an available commissioned controller' :
      card.channels.some(c => !Number.isFinite(c.configuredFilterSeconds ?? 0) || (c.configuredFilterSeconds ?? 0) < 0 ||
        ((c.configuredFilterSeconds ?? 0) > 0 && !Number.isFinite(c.filteredValue ?? c.value))) ?
        'Input filter transfer rejected invalid time or readback; runtime retained' : null
    if (error || !card) {
      const message = error ?? 'Traditional AI card does not exist'
      get().logEvent('DIAGNOSTIC', cardId, message); window.alert(message)
      return false
    }
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [cardId]: { ...card, channels: card.channels.map(c => ({ ...c,
        filterSeconds: c.configuredFilterSeconds ?? 0,
        filteredValue: (c.configuredFilterSeconds ?? 0) > 0 ? c.filteredValue ?? c.value : c.value })) } } },
      rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', cardId, 'Simulated AI filter-only card transfer committed atomically; not a full card/controller download')
    return true
  },

  setTraditionalInput: (dst, value) => {
    if (!useSecurity.getState().requireLock('RESTRICTED_CONTROL', `Simulate input ${dst}`)) return false
    const target = findDst(get().hardware, dst)
    const error = !target || (target.card.type !== 'AI' && target.card.type !== 'DI') ? 'Select a named input channel' :
      target.card.serial ? 'Serial dataset values come from the Modbus transport and cannot be simulated here' :
      target.channel.tiebackDst ? 'Disconnect the simulated tieback before forcing this input' :
      !Number.isFinite(value) || (target.card.type === 'DI' && value !== 0 && value !== 1)
        ? 'Input value must be finite; discrete inputs accept only 0 or 1' : null
    if (error) {
      get().logEvent('DIAGNOSTIC', dst, `Input simulation rejected: ${error}`)
      window.alert(error)
      return false
    }
    if (!target) return false
    const { card, channel } = target
    set(s => ({ hardware: { ...s.hardware, traditionalCards: { ...s.hardware.traditionalCards,
      [card.id]: { ...card, channels: card.channels.map(item => item.channel === channel.channel
        ? { ...item, value } : item) } } } }))
    get().logEvent('DIAGNOSTIC', dst, `Simulated input set to ${value}`)
    return true
  },

  bindDiscreteDst: (tag, dst) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Bind ${tag} traditional I/O`)) return false
    const normalized = dst.trim().toUpperCase()
    const error = discreteBindingError(get().hardware, get().modules[tag], normalized)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `I/O binding rejected: ${error}`)
      window.alert(error)
      return false
    }
    const bindings = { ...get().hardware.discreteBindings }
    if (normalized) bindings[tag] = normalized
    else delete bindings[tag]
    set(s => ({ hardware: { ...s.hardware, discreteBindings: bindings }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, `Traditional I/O bound to ${normalized || '(none)'}`)
    return true
  },

  bindDeviceDst: (tag, port, dst) => {
    if (get().deviceLifecycle[tag]) {
      if (port !== 'input' && port !== 'output') return rejectSfc(get, tag, 'Unknown device I/O port')
      return get().editDeviceDraft(tag, port === 'input' ? { inputDst: dst } : { outputDst: dst })
    }
    if (!requireUnlockedLock('CAN_CONFIGURE', `Bind ${tag} device ${port}`)) return false
    const normalized = dst.trim().toUpperCase()
    const state = get()
    const module = state.modules[tag]
    const active = module?.type === 'MOTOR' ? module.commanded || module.running || module.appliedCommand :
      module?.type === 'VALVE' ? module.commandedOpen || module.open || module.appliedCommand : false
    const error = deviceBindingError(state.hardware, module, port, normalized) ??
      (active ? 'Stop/close and confirm the device before changing its physical I/O bindings' : null)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Device I/O rejected: ${error}`)
      window.alert(error)
      return false
    }
    const bindings = { ...state.hardware.deviceBindings }
    const binding = { ...bindings[tag] }
    if (normalized) binding[port] = normalized
    else delete binding[port]
    if (Object.keys(binding).length) bindings[tag] = binding
    else delete bindings[tag]
    set(s => ({ hardware: { ...s.hardware, deviceBindings: bindings },
      modules: { ...s.modules, [tag]: { ...s.modules[tag], ioInputBad: !!bindings[tag],
        ioOutputBad: !!bindings[tag], outputCommand: false, appliedCommand: false, travelTimer: 0 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, `Device IO_${port === 'input' ? 'IN' : 'OUT'}_1 bound to ${normalized || '(none)'}`)
    return true
  },

  enableDeviceLifecycle: (tag) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Enable saved device ${tag}`)) return false
    const state = get()
    const m = state.modules[tag]
    if (!m || (m.type !== 'MOTOR' && m.type !== 'VALVE') || state.deviceLifecycle[tag]) {
      return rejectSfc(get, tag, 'Choose an unmanaged motor or valve')
    }
    if (deviceActive(m)) return rejectSfc(get, tag, 'Stop/close and confirm the device before enabling saved lifecycle')
    if (Object.values(state.hardware.baseplates).some(plate => plate.channels.some(channel => channel.boundTag === tag))) {
      return rejectSfc(get, tag, 'Saved device lifecycle requires independent traditional DI/DO, not a CHARM-bound device')
    }
    const draft = captureDevice(m, state.hardware)
    if ([draft.inputDst, draft.outputDst].some(dst => dst && findDst(state.hardware, dst)?.channel.value !== 0)) {
      return rejectSfc(get, tag, 'Confirm bound physical channels passive before enabling saved lifecycle')
    }
    set(s => ({ deviceLifecycle: { ...s.deviceLifecycle, [tag]: { draft, online: false, savedRevision: 0, deployedRevision: 0 } },
      modules: { ...s.modules, [tag]: { ...m, downloaded: false, ioInputBad: true, ioOutputBad: true, outputCommand: false } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Saved device lifecycle enabled; inactive device inhibited until first download')
    return true
  },

  editDeviceDraft: (tag, patch) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Edit saved device ${tag}`)) return false
    const state = get()
    const record = state.deviceLifecycle[tag]
    if (!record || record.online) return rejectSfc(get, tag, 'Go Offline to edit device configuration')
    const draft = cloneDeviceConfiguration({ ...record.draft, ...patch })
    draft.inputDst = draft.inputDst.trim().toUpperCase()
    draft.outputDst = draft.outputDst.trim().toUpperCase()
    const error = deviceConfigurationError(draft, state.modules, state.namedSets.configured) ??
      (patch.controllerTag !== undefined && draft.controllerTag && !state.hardware.controllers[draft.controllerTag] ? 'Assigned controller does not exist' : null)
    if (error) return rejectSfc(get, tag, error)
    set(s => ({ deviceLifecycle: { ...s.deviceLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Offline device draft changed; runtime and physical bindings unchanged')
    return true
  },

  saveDeviceConfiguration: (tag) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Save device ${tag}`)) return false
    const state = get()
    const record = state.deviceLifecycle[tag]
    if (!record || record.online) return rejectSfc(get, tag, 'Go Offline to save device configuration')
    const error = deviceConfigurationError(record.draft, state.modules, state.namedSets.configured)
    if (error) return rejectSfc(get, tag, error)
    try { window.localStorage.setItem(savedDeviceKey(tag), serializeDevice(record.draft)) }
    catch (error) { return rejectSfc(get, tag, `Device save failed; database unchanged: ${error instanceof Error ? error.message : String(error)}`) }
    set(s => ({ deviceLifecycle: { ...s.deviceLifecycle, [tag]: { ...record,
      saved: cloneDeviceConfiguration(record.draft), savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Device configuration saved to local browser database; runtime unchanged')
    return true
  },

  loadDeviceConfiguration: (tag) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Load saved device ${tag}`)) return false
    const state = get()
    const record = state.deviceLifecycle[tag]
    if (!record || record.online) return rejectSfc(get, tag, 'Go Offline to load device configuration')
    let saved
    try {
      const text = window.localStorage.getItem(savedDeviceKey(tag))
      if (text === null) return rejectSfc(get, tag, 'No saved device exists for this tag in this browser profile')
      saved = parseDevice(text, tag)
    } catch (error) { return rejectSfc(get, tag, `Device load failed; draft/runtime unchanged: ${error instanceof Error ? error.message : String(error)}`) }
    const error = deviceConfigurationError(saved, state.modules, state.namedSets.configured)
    if (error) return rejectSfc(get, tag, error)
    set(s => ({ deviceLifecycle: { ...s.deviceLifecycle, [tag]: { ...record, draft: cloneDeviceConfiguration(saved),
      saved, savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Saved device loaded offline; download still required')
    return true
  },

  downloadDeviceConfiguration: (tag) => {
    if (!requireUnlockedLock('CAN_DOWNLOAD', `Full download device ${tag}`)) return false
    const state = get()
    const record = state.deviceLifecycle[tag]
    const prepared = prepareDeviceTransfer(record, tag, state.modules, state.hardware, state.namedSets)
    if ('error' in prepared) return rejectSfc(get, tag, prepared.error)
    if (!record) return rejectSfc(get, tag, 'Managed device lifecycle no longer exists')
    const { configuration: c, module: deployedModule } = prepared
    set(s => ({ modules: { ...s.modules, [tag]: deployedModule },
    hardware: { ...s.hardware, deviceBindings: { ...s.hardware.deviceBindings, [tag]: { input: c.inputDst, output: c.outputDst } } },
    deviceLifecycle: { ...s.deviceLifecycle, [tag]: { ...record, deployed: cloneDeviceConfiguration(c), deployedRevision: record.savedRevision, online: true } },
    rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, `Saved device revision ${record.savedRevision} Full downloaded to simulated ${c.controllerTag}; external confirmation required`)
    return true
  },

  setDeviceOnline: (tag, online) => {
    const state = get()
    const record = state.deviceLifecycle[tag]
    const m = state.modules[tag]
    if (!record || online && (!record.deployed || !m || (m.type !== 'MOTOR' && m.type !== 'VALVE') || deviceOperatorError(m, state.hardware))) {
      return rejectSfc(get, tag, 'Download to an available controller before going online')
    }
    set(s => ({ deviceLifecycle: { ...s.deviceLifecycle, [tag]: { ...record, online } } }))
    return true
  },

  createMotorTemplate: (rawTag, area, description) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Copy MTR-11_ILOCK motor template')) return false
    const tag = rawTag.trim().toUpperCase()
    const state = get()
    const error = moduleNameError(tag) ?? (state.modules[tag] || state.sfcs[tag] ? `Module ${tag} already exists` :
      !state.areas.includes(area) ? `Area ${area} does not exist` : null)
    if (error) return rejectSfc(get, tag, error)
    const module = makeModule({ tag, area, type: 'MOTOR', description: description?.trim() || 'Two-condition interlocked motor' })
    if (module.type !== 'MOTOR') return rejectSfc(get, tag, 'Motor template construction failed')
    module.templateId = 'MTR-11_ILOCK'
    module.ownedBlocks = materializeMotorStrategy(tag, area, motorTemplateStrategy(tag))
    module.interlockSource = `${tag}/NOT1`
    module.interlockInverted = true
    module.permissiveSource = `${tag}/AND1`
    module.permissiveRequired = true
    module.permissiveOk = false
    module.downloaded = false
    module.ioInputBad = true
    module.ioOutputBad = true
    const draft = captureDevice(module, state.hardware)
    set(s => ({ modules: { ...s.modules, [tag]: module }, deviceLifecycle: { ...s.deviceLifecycle,
      [tag]: { draft, online: false, savedRevision: 0, deployedRevision: 0 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'MTR-11_ILOCK modeled two-condition template copied with owned CND1/CND2/BFI1/OR1/NOT1/AND1 and native healthy interlock polarity; Save/Full Download required')
    return true
  },

  editMotorBlock: (tag, patch) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Edit owned block ${tag}`)) return false
    const state = get()
    const owned = motorEditorBlock(state, tag)
    const record = owned ? state.deviceLifecycle[owned.owner.tag] : undefined
    if (!owned || !record?.draft.strategy || record.online) return rejectSfc(get, tag, 'Go Offline to edit an owned motor strategy')
    const draft = cloneDeviceConfiguration(record.draft)
    const blocks = draft.strategy
    if (!blocks) return rejectSfc(get, tag, 'Motor strategy is not configured')
    blocks[owned.name] = { ...blocks[owned.name], ...patch }
    if (patch.in1) blocks[owned.name].in1 = { ...patch.in1 }
    if (patch.in2) blocks[owned.name].in2 = { ...patch.in2 }
    const error = motorStrategyError(owned.owner.tag, owned.owner.area, blocks, state.modules)
    if (error) return rejectSfc(get, tag, error)
    return get().editDeviceDraft(owned.owner.tag, { strategy: blocks })
  },

  enableModuleLifecycle: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Enable saved lifecycle ${tag}`)) return false
    const state = get()
    const module = state.modules[tag]
    if (module?.type !== 'AO' || state.moduleLifecycle[tag]) {
      return rejectAo(get, tag, 'Saved lifecycle currently requires an unmanaged standalone AO module')
    }
    const dst = state.hardware.analogBindings?.[tag]?.output ?? ''
    const target = findDst(state.hardware, dst)
    const configuration = { module: cloneAo(module), controllerTag: target?.card.controllerTag ?? '',
      outputDst: dst, restoreModule: false, restoreParameters: [], downloadBehavior: 'CONFIGURED' as const }
    const draftModule = configuration.module
    delete draftModule.downloaded
    delete draftModule.controllerTag
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: {
      draft: configuration, online: false, savedRevision: 0, deployedRevision: 0
    } }, modules: { ...s.modules, [tag]: { ...module, downloaded: false, bad: true, actualMode: 'OOS' } },
    rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Opt-in saved AO lifecycle enabled; output held until first download')
    return true
  },

  setModuleOnline: (tag, online) => {
    const record = get().moduleLifecycle[tag]
    if (!record) return rejectAo(get, tag, 'Module does not use the saved lifecycle')
    const module = get().modules[tag]
    if (online && (!record.deployed || module?.type !== 'AO' || !module.downloaded)) {
      return rejectAo(get, tag, 'Download the saved module before going online')
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, online } } }))
    return true
  },

  editModuleDraft: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit offline configuration ${tag}`)) return false
    const record = get().moduleLifecycle[tag]
    if (!record || record.online) return rejectAo(get, tag, 'Go Offline to edit the saved-lifecycle draft')
    const draft = cloneConfiguration(record.draft)
    const { controllerTag, outputDst, restoreModule, restoreParameters, downloadBehavior,
      parameter, ...modulePatch } = patch
    Object.assign(draft.module, modulePatch)
    if (controllerTag !== undefined) draft.controllerTag = controllerTag
    if (outputDst !== undefined) draft.outputDst = outputDst.trim().toUpperCase()
    if (restoreModule !== undefined) draft.restoreModule = restoreModule
    if (restoreParameters !== undefined) draft.restoreParameters = [...restoreParameters]
    if (downloadBehavior !== undefined) draft.downloadBehavior = downloadBehavior
    if (parameter) {
      if (!draft.module.parameters[parameter.name]) return rejectAo(get, tag, 'Configured parameter does not exist')
      draft.module.parameters[parameter.name].value = parameter.value
    }
    const error = configurationError(draft)
    if (error) return rejectAo(get, tag, error)
    if (draft.controllerTag && !get().hardware.controllers[draft.controllerTag]) {
      return rejectAo(get, tag, 'Assigned controller does not exist')
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Offline AO draft changed; runtime unchanged')
    return true
  },

  saveModuleConfiguration: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Save module configuration ${tag}`)) return false
    const record = get().moduleLifecycle[tag]
    const runtime = get().modules[tag]
    if (!record || record.online || runtime?.type !== 'AO') return rejectAo(get, tag, 'Go Offline to save the module draft')
    const draft = withProjectMembership(record.draft, runtime)
    const error = configurationError(draft)
    if (error) return rejectAo(get, tag, error)
    try {
      window.localStorage.setItem(savedAoStorageKey(tag), serializeSavedAo(draft))
    } catch (error) {
      return rejectAo(get, tag, `Save failed; database unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record,
      draft, saved: cloneConfiguration(draft), savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Module saved to the local browser configuration database; runtime unchanged')
    return true
  },

  loadSavedModuleConfiguration: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Load saved module ${tag}`)) return false
    const record = get().moduleLifecycle[tag]
    if (!record || record.online) return rejectAo(get, tag, 'Go Offline before loading saved configuration')
    let saved
    try {
      const text = window.localStorage.getItem(savedAoStorageKey(tag))
      if (text === null) return rejectAo(get, tag, 'No saved AO configuration exists for this tag in this browser profile')
      saved = parseSavedAo(text, tag)
    } catch (error) {
      return rejectAo(get, tag, `Load failed; draft/runtime unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!get().areas.includes(saved.module.area)) return rejectAo(get, tag, 'Create the saved plant area before loading this module')
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record,
      draft: cloneConfiguration(saved), saved, savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Persistent saved configuration loaded offline; download is still required')
    return true
  },

  verifyAoDownload: (tag, scope) => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Verify AO download ${tag}`)) return false
    const state = get()
    const prepared = prepareAoTransfer(state.moduleLifecycle[tag], state.modules[tag], state.hardware, scope)
    if ('error' in prepared) return rejectAo(get, tag, `Download verification rejected: ${prepared.error}`)
    get().logEvent('DIAGNOSTIC', tag,
      `AO ${scope} verification passed: saved references, controller, output ownership and preserved values checked; no transfer`)
    return true
  },

  downloadModule: (tag, scope, expected) => {
    if (expected && !requireUnlockedKey('CAN_DOWNLOAD', `Confirm verified AO download ${tag}`)) return false
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Download module ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const prepared = prepareAoTransfer(record, runtime, state.hardware, scope, expected)
    if ('error' in prepared) return rejectAo(get, tag, prepared.error)
    if (!record) return rejectAo(get, tag, 'Managed AO lifecycle no longer exists')
    const { saved, module, behavior } = prepared
    set(s => ({
      modules: { ...s.modules, [tag]: module },
      hardware: { ...s.hardware, analogBindings: { ...s.hardware.analogBindings,
        [tag]: { output: saved.outputDst } } },
      moduleLifecycle: { ...s.moduleLifecycle, [tag]: committedAoTransfer(record, saved, module, scope) },
      rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', tag, `${scope} simulated module download committed atomically (${behavior}); NVM updated`)
    return true
  },

  downloadControllerAos: (tag, expected) => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Full Download managed AOs on ${tag}`)) return false
    const state = get()
    const controller = state.hardware.controllers[tag]
    if (!controller || !controller.commissioned || controllerIsDown(controller)) {
      return rejectAo(get, tag, 'Managed AO controller transfer requires a commissioned available controller')
    }
    const records = controllerAoRecords(state.moduleLifecycle, tag)
    if (!records.length) return rejectAo(get, tag, 'No configured managed AOs belong to this controller')
    if (expected && (Object.keys(expected).length !== records.length ||
      records.some(([moduleTag, record]) => !(moduleTag in expected) || expected[moduleTag] !== record.saved))) {
      return rejectAo(get, tag, 'Managed AO scope or saved configuration changed after confirmation opened; no modules transferred')
    }
    const modules = { ...state.modules }
    const moduleLifecycle = { ...state.moduleLifecycle }
    const analogBindings = { ...state.hardware.analogBindings }
    for (const [moduleTag, record] of records) {
      const prepared = prepareAoTransfer(record, state.modules[moduleTag], state.hardware, 'FULL')
      if ('error' in prepared) {
        return rejectAo(get, tag, `Managed AO controller transfer rejected for ${moduleTag}: ${prepared.error}; no modules transferred`)
      }
      const { saved, module } = prepared
      modules[moduleTag] = module
      moduleLifecycle[moduleTag] = committedAoTransfer(record, saved, module, 'FULL')
      analogBindings[moduleTag] = { output: saved.outputDst }
    }
    set({ modules, moduleLifecycle, hardware: { ...state.hardware, analogBindings }, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', tag, `FULL managed-AO controller transfer committed atomically for ${records.length} modules: ${records.map(([name]) => name).join(', ')}; other algorithms, cards and Setup excluded`)
    return true
  },

  downloadControllerRegulatory: (tag, expected) => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Full Download managed regulatory modules ${tag}`)) return false
    const state = get()
    const prepared = prepareControllerRegulatoryTransfer(state, tag, expected)
    if ('error' in prepared) return rejectAo(get, tag, prepared.error)
    set({ ...prepared.patch, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', tag, `FULL managed regulatory transfer committed atomically: ${prepared.tags.join(', ')}; AO uses saved defaults, PID_LOOP held Offline/OOS until Go Online; device/SFC/cards/Setup excluded; no tuning upload`)
    return true
  },

  downloadControllerManagedModules: (tag, expected) => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Full Download managed modules ${tag}`)) return false
    const state = get()
    const prepared = prepareControllerModuleTransfer(state, tag, expected)
    if ('error' in prepared) return rejectSfc(get, tag, prepared.error)
    set({ ...prepared.patch, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', tag, `FULL managed-module transfer committed atomically: ${prepared.tags.join(', ')}; AO saved defaults, PID Offline/OOS, devices passive awaiting confirmation, SFC READY/Offline; cards/Setup/unmanaged algorithms excluded`)
    return true
  },

  updateControllerAoRestartMemory: tag => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Update AO cold-restart memory ${tag}`)) return false
    const state = get()
    const controller = state.hardware.controllers[tag]
    if (!controller || !controller.commissioned || controllerIsDown(controller)) {
      return rejectAo(get, tag, 'AO restart-memory update requires a commissioned available controller')
    }
    const records = controllerDeployedAoRecords(state.moduleLifecycle, tag)
    if (!records.length) return rejectAo(get, tag, 'No downloaded managed AO modules belong to this controller')
    for (const [moduleTag, record] of records) {
      const runtime = state.modules[moduleTag]
      const error = !record.lastGoodDownload || record.replayFullRequired || runtime?.type !== 'AO' || !runtime.downloaded
        ? 'Fresh Full module download required' : downloadError(record.lastGoodDownload, state.hardware)
      if (error) return rejectAo(get, tag, `AO restart-memory update rejected for ${moduleTag}: ${error}; no memory changed`)
    }
    const updated = { ...state.moduleLifecycle }
    for (const [moduleTag, record] of records) {
      if (record.lastGoodDownload) updated[moduleTag] = { ...record,
        restartDownload: cloneConfiguration(record.lastGoodDownload), restartMemoryRequired: false }
    }
    set({ moduleLifecycle: updated })
    get().logEvent('CONFIGURE', tag, `AO cold-restart download memory updated for ${records.length} managed modules; working configuration and saved database unchanged`)
    return true
  },

  resendLastGoodModuleDownload: tag => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Re-send last good module download ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const prepared = prepareAoReplay(record, runtime, state.hardware)
    if ('error' in prepared) return rejectAo(get, tag, prepared.error)
    if (!record) return rejectAo(get, tag, 'Managed AO lifecycle no longer exists')
    const { snapshot, module } = prepared
    set(s => ({
      modules: { ...s.modules, [tag]: module },
      hardware: { ...s.hardware, analogBindings: { ...s.hardware.analogBindings, [tag]: { output: snapshot.outputDst } } },
      moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, nvm: memoryOf(module) } },
      rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', tag, `Last-good AO module transfer re-sent to ${snapshot.controllerTag}; saved/draft edits not downloaded`)
    return true
  },

  resendControllerAoDownloads: (tag, expected) => {
    if (!requireUnlockedKey('CAN_DOWNLOAD', `Re-send controller-owned AO transfers ${tag}`)) return false
    const state = get()
    const controller = state.hardware.controllers[tag]
    if (!controller || !controller.commissioned || controllerIsDown(controller)) {
      return rejectAo(get, tag, 'Controller-owned AO replay requires a commissioned available controller')
    }
    const records = controllerDeployedAoRecords(state.moduleLifecycle, tag)
    if (!records.length) return rejectAo(get, tag, 'No deployed managed AOs belong to this controller')
    if (expected && (Object.keys(expected).length !== records.length ||
      records.some(([moduleTag, record]) => !(moduleTag in expected) || expected[moduleTag] !== record.lastGoodDownload))) {
      return rejectAo(get, tag, 'Controller-owned AO replay scope or last-good transfer changed after confirmation opened; no modules replayed')
    }
    const modules = { ...state.modules }
    const moduleLifecycle = { ...state.moduleLifecycle }
    const analogBindings = { ...state.hardware.analogBindings }
    for (const [moduleTag, record] of records) {
      const prepared = prepareAoReplay(record, state.modules[moduleTag], state.hardware)
      if ('error' in prepared) {
        return rejectAo(get, tag, `Controller-owned AO replay rejected for ${moduleTag}: ${prepared.error}; no modules replayed`)
      }
      const { snapshot, module } = prepared
      if (snapshot.controllerTag !== tag) {
        return rejectAo(get, tag, `Last-good target for ${moduleTag} does not match ${tag}; no modules replayed`)
      }
      modules[moduleTag] = module
      moduleLifecycle[moduleTag] = { ...record, nvm: memoryOf(module) }
      analogBindings[moduleTag] = { output: snapshot.outputDst }
    }
    set({ modules, moduleLifecycle, hardware: { ...state.hardware, analogBindings }, rev: state.rev + 1 })
    get().logEvent('CONFIGURE', tag, `Last-good AO transfers re-sent atomically for ${records.length} modules: ${records.map(([name]) => name).join(', ')}; newer saved/draft edits excluded; other algorithms/cards/Setup not replayed`)
    return true
  },

  uploadModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Upload module ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const controller = record?.deployed ? state.hardware.controllers[record.deployed.controllerTag] : undefined
    if (!record?.deployed || runtime?.type !== 'AO' || !runtime.downloaded) {
      return rejectAo(get, tag, 'Upload requires a downloaded AO module')
    }
    if (!controller || controllerIsDown(controller)) return rejectAo(get, tag, 'Upload requires an available assigned controller')
    const draft = cloneConfiguration(record.deployed)
    draft.module = cloneAo(runtime)
    delete draft.module.downloaded
    delete draft.module.controllerTag
    // Upload defaults, not transient field readback/quality, to the offline draft.
    const defaults = record.deployed.module
    for (const key of ['out', 'pv', 'bad', 'actualMode', 'limited'] as const) {
      Object.assign(draft.module, { [key]: defaults[key] })
    }
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft, online: false } },
      rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Runtime uploaded into offline draft; Save is still required')
    return true
  },

  uploadAoParameters: (tag, parameterNames) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Upload AO parameters ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const controller = record?.deployed ? state.hardware.controllers[record.deployed.controllerTag] : undefined
    if (!record?.deployed || runtime?.type !== 'AO' || !runtime.downloaded) {
      return rejectAo(get, tag, 'Upload requires a downloaded AO module')
    }
    if (!controller || controllerIsDown(controller)) return rejectAo(get, tag, 'Upload requires an available assigned controller')
    const selected = [...new Set(parameterNames)]
    const draftParameters = record.draft.module.parameters
    if (selected.some(name => !draftParameters[name] || !runtime.parameters[name])) {
      return rejectAo(get, tag, 'Upload selection contains an unsupported AO parameter')
    }
    if (!selected.length) {
      get().logEvent('CONFIGURE', tag, 'AO parameter upload selected no parameters; offline draft unchanged')
      return true
    }
    const changed = changedAoParameters(record, runtime)
    const uploading = selected.filter(name => changed.includes(name))
    if (!uploading.length) {
      get().logEvent('CONFIGURE', tag, 'Selected AO parameters already match the offline draft')
      return true
    }
    const draft = cloneConfiguration(record.draft)
    for (const name of uploading) draft.module.parameters[name].value = runtime.parameters[name].value
    set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag,
      `AO parameters uploaded into offline draft: ${uploading.join(', ')}; Save is still required`)
    return true
  },

  restartModule: (tag) => {
    if (!useSecurity.getState().requireLock('DIAGNOSTIC', `Cold restart module ${tag}`)) return false
    const state = get()
    const record = state.moduleLifecycle[tag]
    const runtime = state.modules[tag]
    const controller = record?.deployed ? state.hardware.controllers[record.deployed.controllerTag] : undefined
    if (record?.restartMemoryRequired) return rejectAo(get, tag, 'Update controller AO cold-restart memory after the Partial download before restarting')
    if (!record?.deployed || runtime?.type !== 'AO' || !runtime.downloaded ||
        !controller || controllerIsDown(controller)) return rejectAo(get, tag, 'Cold restart requires an available downloaded module')
    const module = restartAo(record, runtime, state.hardware)
    set(s => ({ modules: { ...s.modules, [tag]: module }, moduleLifecycle: { ...s.moduleLifecycle,
      [tag]: { ...record, nvm: memoryOf(module) } }, rev: s.rev + 1 }))
    get().logEvent('DIAGNOSTIC', tag, 'Simulated cold restart used deployed defaults and selected NVM restore flags')
    return true
  },

  enablePidLifecycle: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Enable PID_LOOP lifecycle ${tag}`)) return false
    const state = get()
    const module = state.modules[tag]
    if (module?.type !== 'PID' || module.templateId !== 'PID_LOOP' || state.pidLifecycle[tag]) {
      return rejectPid(get, tag, 'Saved PID lifecycle currently requires an unmanaged PID_LOOP module')
    }
    const bindings = state.hardware.analogBindings?.[tag]
    const inputDst = bindings?.input ?? ''
    const outputDst = bindings?.output ?? ''
    const inputController = findDst(state.hardware, inputDst)?.card.controllerTag
    const outputController = findDst(state.hardware, outputDst)?.card.controllerTag
    const controllerTag = inputController && inputController === outputController
      ? inputController : inputController ?? outputController ?? ''
    const configuration: PidConfiguration = {
      module: clonePidConfiguration({ module, controllerTag, inputDst, outputDst }).module,
      controllerTag,
      inputDst,
      outputDst
    }
    delete configuration.module.downloaded
    delete configuration.module.lifecycleOnline
    delete configuration.module.controllerTag
    const error = pidConfigurationError(configuration)
    if (error) return rejectPid(get, tag, error)
    set(s => ({
      pidLifecycle: { ...s.pidLifecycle, [tag]: {
        draft: configuration, online: false, savedRevision: 0, deployedRevision: 0
      } },
      modules: { ...s.modules, [tag]: { ...module, mode: 'OOS', actualMode: 'OOS',
        downloaded: false, lifecycleOnline: false, pvBad: true } },
      rev: s.rev + 1
    }))
    get().logEvent('CONFIGURE', tag, 'Opt-in PID_LOOP lifecycle enabled; control held until Full download and Online')
    return true
  },

  editPidLifecycle: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Edit PID_LOOP assignment ${tag}`)) return false
    const record = get().pidLifecycle[tag]
    if (!record || record.online) return rejectPid(get, tag, 'Go Offline to edit the PID_LOOP assignment')
    const draft = clonePidConfiguration(record.draft)
    if (patch.controllerTag !== undefined) {
      draft.controllerTag = patch.controllerTag.trim().toUpperCase()
      if (draft.controllerTag && !get().hardware.controllers[draft.controllerTag]) {
        return rejectPid(get, tag, 'Assigned controller does not exist')
      }
    }
    if (patch.inputDst !== undefined) draft.inputDst = patch.inputDst.trim().toUpperCase()
    if (patch.outputDst !== undefined) draft.outputDst = patch.outputDst.trim().toUpperCase()
    const error = pidConfigurationError(draft)
    if (error) return rejectPid(get, tag, error)
    if (draft.inputDst) {
      const bindingError = analogBindingError(get().hardware, draft.module, 'input', draft.inputDst)
      if (bindingError) return rejectPid(get, tag, bindingError)
    }
    if (draft.outputDst) {
      const bindingError = analogBindingError(get().hardware, draft.module, 'output', draft.outputDst)
      if (bindingError) return rejectPid(get, tag, bindingError)
    }
    set(s => ({ pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Offline PID_LOOP controller and physical DST assignments changed')
    return true
  },

  savePidConfiguration: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Save PID_LOOP configuration ${tag}`)) return false
    const state = get()
    const record = state.pidLifecycle[tag]
    const runtime = state.modules[tag]
    if (!record || record.online || runtime?.type !== 'PID') {
      return rejectPid(get, tag, 'Go Offline to save the PID_LOOP draft')
    }
    const draft = clonePidConfiguration(record.draft)
    draft.module.area = runtime.area
    draft.module.equipmentModule = runtime.equipmentModule
    draft.module.primaryDisplay = runtime.primaryDisplay
    draft.module.detailDisplay = runtime.detailDisplay
    const error = pidConfigurationError(draft)
    if (error) return rejectPid(get, tag, error)
    try {
      window.localStorage.setItem(savedPidStorageKey(tag), serializeSavedPid(draft))
    } catch (error) {
      return rejectPid(get, tag, `PID_LOOP save failed; configuration unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    set(s => ({ pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record, draft,
      saved: clonePidConfiguration(draft), savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'PID_LOOP saved to the local browser configuration database; runtime unchanged')
    return true
  },

  loadSavedPidConfiguration: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Load saved PID_LOOP ${tag}`)) return false
    const record = get().pidLifecycle[tag]
    if (!record || record.online) return rejectPid(get, tag, 'Go Offline before loading the saved PID_LOOP configuration')
    let saved: PidConfiguration
    try {
      const text = window.localStorage.getItem(savedPidStorageKey(tag))
      if (text === null) return rejectPid(get, tag, 'No saved PID_LOOP configuration exists for this tag in this browser profile')
      saved = parseSavedPid(text, tag)
    } catch (error) {
      return rejectPid(get, tag, `PID_LOOP load failed; draft/runtime unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!get().areas.includes(saved.module.area)) return rejectPid(get, tag, 'Create the saved plant area before loading this PID_LOOP')
    set(s => ({ pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record,
      draft: clonePidConfiguration(saved), saved: clonePidConfiguration(saved),
      savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, 'Persistent PID_LOOP configuration loaded offline; Full download is still required')
    return true
  },

  uploadPidParameters: (tag, parameters) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Upload PID_LOOP parameters ${tag}`)) return false
    const state = get()
    const record = state.pidLifecycle[tag]
    const runtime = state.modules[tag]
    const selected = [...new Set(parameters)]
    const supported: PidTuningParameter[] = ['gain', 'reset', 'rate']
    if (selected.some(parameter => !supported.includes(parameter))) {
      return rejectPid(get, tag, 'Upload selection contains an unsupported PID_LOOP parameter')
    }
    const controller = record?.deployed
      ? state.hardware.controllers[record.deployed.controllerTag] : undefined
    if (!record?.deployed || !record.saved || !record.online || runtime?.type !== 'PID' ||
        !runtime.downloaded || pidLifecycleDirty(record)) {
      return rejectPid(get, tag, 'Upload requires a clean, downloaded PID_LOOP that is Online')
    }
    if (!controller || controllerIsDown(controller)) {
      return rejectPid(get, tag, 'Upload requires an available assigned controller')
    }
    if (!selected.length) {
      get().logEvent('CONFIGURE', tag, 'PID_LOOP upload selected no parameters; configured values unchanged')
      return true
    }
    const changed = changedPidTuningParameters(record.saved, runtime)
    const uploading = selected.filter(parameter => changed.includes(parameter))
    if (!uploading.length) {
      get().logEvent('CONFIGURE', tag, 'Selected PID_LOOP tuning parameters already match configured values')
      return true
    }
    const configuration = clonePidConfiguration(record.saved)
    for (const parameter of uploading) configuration.module[parameter] = runtime[parameter]
    const error = pidConfigurationError(configuration)
    if (error) return rejectPid(get, tag, `PID_LOOP upload rejected; configuration unchanged: ${error}`)
    try {
      window.localStorage.setItem(savedPidStorageKey(tag), serializeSavedPid(configuration))
    } catch (error) {
      return rejectPid(get, tag, `PID_LOOP upload failed; configuration unchanged: ${error instanceof Error ? error.message : String(error)}`)
    }
    set(s => ({ pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record,
      draft: clonePidConfiguration(configuration), saved: clonePidConfiguration(configuration),
      savedRevision: record.savedRevision + 1 } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', tag, `Uploaded online PID_LOOP values to configuration: ${uploading.join(', ').toUpperCase()}`)
    return true
  },

  downloadPidModule: (tag, uploadParameters = []) => {
    if (!useSecurity.getState().requireLock('CAN_DOWNLOAD', `Download PID_LOOP ${tag}`)) return false
    const state = get()
    const record = state.pidLifecycle[tag]
    const runtime = state.modules[tag]
    if (!record || record.online || !record.saved || runtime?.type !== 'PID' || pidLifecycleDirty(record)) {
      return rejectPid(get, tag, 'Save a valid offline PID_LOOP draft before downloading')
    }
    const selected = [...new Set(uploadParameters)]
    const supported: PidTuningParameter[] = ['gain', 'reset', 'rate']
    if (selected.some(parameter => !supported.includes(parameter))) {
      return rejectPid(get, tag, 'Download upload selection contains an unsupported PID_LOOP parameter')
    }
    const changed = changedPidTuningParameters(record.saved, runtime)
    const uploading = selected.filter(parameter => changed.includes(parameter))
    const configuration = clonePidConfiguration(record.saved)
    for (const parameter of uploading) configuration.module[parameter] = runtime[parameter]
    const error = pidDownloadError(configuration, state.hardware)
    if (error) return rejectPid(get, tag, `PID_LOOP download failed; last-good runtime retained: ${error}`)
    const savedRevision = record.savedRevision + Number(uploading.length > 0)
    if (uploading.length) {
      try {
        window.localStorage.setItem(savedPidStorageKey(tag), serializeSavedPid(configuration))
      } catch (error) {
        return rejectPid(get, tag, `PID_LOOP upload before download failed; last-good runtime retained: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const deployed = deployedPid(configuration, runtime)
    set(s => ({
      modules: { ...s.modules, [tag]: deployed },
      hardware: { ...s.hardware, analogBindings: { ...s.hardware.analogBindings,
        [tag]: { input: configuration.inputDst, output: configuration.outputDst } } },
      pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record,
        ...(uploading.length ? { draft: clonePidConfiguration(configuration),
          saved: clonePidConfiguration(configuration), savedRevision } : {}),
        deployed: clonePidConfiguration(configuration), deployedRevision: savedRevision } },
      rev: s.rev + 1
    }))
    if (uploading.length) {
      get().logEvent('CONFIGURE', tag, `Uploaded selected online PID_LOOP values before download: ${uploading.join(', ').toUpperCase()}`)
    } else if (changed.length) {
      get().logEvent('CONFIGURE', tag, 'No online PID_LOOP values selected for upload; configured tuning retained')
    }
    get().logEvent('CONFIGURE', tag, `Full simulated PID_LOOP download committed atomically to ${configuration.controllerTag}; Go Online to execute`)
    return true
  },

  setPidLifecycleOnline: (tag, online) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `${online ? 'Go Online' : 'Go Offline'} PID_LOOP ${tag}`)) return false
    const state = get()
    const record = state.pidLifecycle[tag]
    const runtime = state.modules[tag]
    if (!record) return rejectPid(get, tag, 'Module does not use the saved PID_LOOP lifecycle')
    if (online) {
      const controller = record.deployed ? state.hardware.controllers[record.deployed.controllerTag] : undefined
      if (!record.deployed || compareModuleDownload(state, tag).status !== 'MATCH' || pidLifecycleDirty(record) ||
          runtime?.type !== 'PID' || !runtime.downloaded ||
          !controller || controllerIsDown(controller) || pidDownloadError(record.deployed, state.hardware)) {
        return rejectPid(get, tag, 'Save and Full-download the current PID_LOOP to an available assigned controller before Online')
      }
      const module = { ...runtime, mode: record.deployed.module.mode, actualMode: 'OOS' as const,
        lifecycleOnline: true, controllerTag: record.deployed.controllerTag }
      set(s => ({ modules: { ...s.modules, [tag]: module },
        pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record, online: true } }, rev: s.rev + 1 }))
    } else {
      if (runtime?.type !== 'PID') return rejectPid(get, tag, 'PID_LOOP runtime does not exist')
      set(s => ({ modules: { ...s.modules, [tag]: { ...runtime, mode: 'OOS', actualMode: 'OOS',
        lifecycleOnline: false, pvBad: true } },
        pidLifecycle: { ...s.pidLifecycle, [tag]: { ...record, online: false } }, rev: s.rev + 1 }))
    }
    get().logEvent('CONFIGURE', tag, online ? 'PID_LOOP placed Online' : 'PID_LOOP taken Offline; output control inhibited')
    return true
  },

  configureStandaloneAo: (tag, patch) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} AO`)) return false
    if (get().moduleLifecycle[tag]) return get().editModuleDraft(tag, patch)
    const module = get().modules[tag]
    const error = module?.type !== 'AO' ? 'Select a standalone AO module' : aoConfigurationError(module, patch)
    if (error) return rejectAo(get, tag, error)
    mutateModule(set, get, tag, m => {
      if (m.type === 'AO') {
        Object.assign(m, patch)
        m.bad = true
        m.actualMode = 'OOS'
        m.pv = aoEngineeringValue(m, m.out)
      }
    })
    get().logEvent('CONFIGURE', tag, `AO scale/limits changed: ${JSON.stringify(patch)}`)
    return true
  },

  setStandaloneAoMode: (tag, mode) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set ${tag} AO mode`)) return false
    const module = get().modules[tag]
    const availability = module?.type === 'AO' ? aoOperatorError(module, get().hardware) : null
    if (availability) return rejectAo(get, tag, availability)
    if (module?.type !== 'AO' || !['CAS', 'AUTO', 'MAN', 'OOS'].includes(mode)) {
      return rejectAo(get, tag, 'AO mode requires CAS, AUTO, MAN or OOS')
    }
    mutateModule(set, get, tag, m => {
      if (m.type !== 'AO') return
      if (mode === 'MAN' && m.mode !== 'MAN') m.manualOutput = m.out
      if (mode === 'AUTO' && m.mode !== 'AUTO') m.sp = m.pv
      m.mode = mode
      if (mode === 'OOS') { m.bad = true; m.actualMode = 'OOS' }
    })
    get().logEvent('OPERATOR', tag, `AO target mode ${mode}`)
    return true
  },

  setStandaloneAoValue: (tag, value) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Write ${tag} AO setpoint/output`)) return false
    const module = get().modules[tag]
    const availability = module?.type === 'AO' ? aoOperatorError(module, get().hardware) : null
    if (availability) return rejectAo(get, tag, availability)
    const error = module?.type !== 'AO' ? 'Select a standalone AO module' :
      module.mode !== 'AUTO' && module.mode !== 'MAN' ? 'AO direct value entry requires AUTO or MAN' :
      !Number.isFinite(value) || value < (module.mode === 'MAN' ? 0 : module.spLow) ||
        value > (module.mode === 'MAN' ? 100 : module.spHigh) ? 'AO value is outside the configured limits' : null
    if (error) return rejectAo(get, tag, error)
    mutateModule(set, get, tag, m => {
      if (m.type === 'AO') {
        if (m.mode === 'MAN') m.manualOutput = value
        else m.sp = value
      }
    })
    get().logEvent('OPERATOR', tag, `AO requested value ${value}`)
    return true
  },

  addAoParameter: (tag, name, value) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create ${tag} input parameter`)) return false
    const key = name.trim().toUpperCase()
    const record = get().moduleLifecycle[tag]
    if (record?.online) return rejectAo(get, tag, 'Go Offline to create configured parameters')
    const module = record?.draft.module ?? get().modules[tag]
    const error = module?.type !== 'AO' ? 'Input parameters currently require a standalone AO module' :
      moduleNameError(key) ?? (['AO1', 'PV', 'SP', 'OUT', 'MODE', 'CAS_IN', 'IO_OUT'].includes(key)
        ? 'Parameter name conflicts with an AO block/parameter' :
        module.parameters[key] ? `Parameter ${key} already exists` :
        !Number.isFinite(value) ? 'Floating Point input value must be finite' : null)
    if (error) return rejectAo(get, tag, error)
    if (record && module.type === 'AO') {
      const draft = cloneConfiguration(record.draft)
      draft.module.parameters[key] = { type: 'FLOAT', value }
      set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    } else mutateModule(set, get, tag, m => {
      if (m.type === 'AO') m.parameters = { ...m.parameters, [key]: { type: 'FLOAT', value } }
    })
    get().logEvent('CONFIGURE', tag, `Floating Point input ${key} created`)
    return true
  },

  setAoParameter: (tag, name, value) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Write ${tag}/${name}`)) return false
    const module = get().modules[tag]
    const availability = module?.type === 'AO' ? aoOperatorError(module, get().hardware) : null
    if (availability) return rejectAo(get, tag, availability)
    const error = module?.type !== 'AO' || !module.parameters[name] ? 'Floating Point input parameter does not exist' :
      !Number.isFinite(value) ? 'Floating Point input value must be finite' : null
    if (error) return rejectAo(get, tag, error)
    mutateModule(set, get, tag, m => {
      if (m.type === 'AO') m.parameters = { ...m.parameters, [name]: { ...m.parameters[name], value } }
    })
    get().logEvent('OPERATOR', tag, `${name}.CV set to ${value}`)
    return true
  },

  connectAoParameter: (tag, name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Wire ${tag} CAS_IN`)) return false
    const record = get().moduleLifecycle[tag]
    if (record?.online) return rejectAo(get, tag, 'Go Offline to change configured CAS_IN wiring')
    const module = record?.draft.module ?? get().modules[tag]
    if (module?.type !== 'AO' || (name !== undefined && !module.parameters[name])) {
      return rejectAo(get, tag, 'Select an existing Floating Point input parameter')
    }
    if (record) {
      const draft = cloneConfiguration(record.draft)
      draft.module.casParameter = name
      set(s => ({ moduleLifecycle: { ...s.moduleLifecycle, [tag]: { ...record, draft } }, rev: s.rev + 1 }))
    } else mutateModule(set, get, tag, m => {
      if (m.type === 'AO') { m.casParameter = name; m.bad = true }
    })
    get().logEvent('CONFIGURE', tag, `AO1.CAS_IN connected to ${name ?? '(none)'}`)
    return true
  },

  bindAnalogDst: (tag, port, dst) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Bind ${tag} ${port} traditional I/O`)) return false
    const normalized = dst.trim().toUpperCase()
    const record = get().moduleLifecycle[tag]
    if (record) {
      if (port !== 'output') return rejectAo(get, tag, 'Standalone AO supports IO_OUT only')
      return get().editModuleDraft(tag, { outputDst: normalized })
    }
    const pidRecord = get().pidLifecycle[tag]
    if (pidRecord) {
      if (pidRecord.online) return rejectPid(get, tag, 'Go Offline before changing PID_LOOP I/O assignments')
      if (port === 'output2') return rejectPid(get, tag, 'PID_LOOP lifecycle only supports its configured AI1/AO1 pair')
      return get().editPidLifecycle(tag, port === 'input' ? { inputDst: normalized } : { outputDst: normalized })
    }
    const error = analogBindingError(get().hardware, get().modules[tag], port, normalized)
    if (error) {
      get().logEvent('DIAGNOSTIC', tag, `Analog I/O binding rejected: ${error}`)
      window.alert(error)
      return false
    }
    const bindings = { ...get().hardware.analogBindings }
    const ports = { ...bindings[tag] }
    if (normalized) ports[port] = normalized
    else delete ports[port]
    if (Object.keys(ports).length) bindings[tag] = ports
    else delete bindings[tag]
    set(s => {
      const module = s.modules[tag]
      let next = module
      if (module.type === 'AI') next = { ...module, pvBad: true }
      else if (module.type === 'AO') {
        const target = findDst(s.hardware, normalized)
        const out = target?.card.type === 'AO' && Number.isFinite(target.channel.value) ? target.channel.value : module.out
        next = { ...module, out, pv: aoEngineeringValue(module, out), bad: true, actualMode: 'OOS' }
      }
      else if (module.type === 'PID') {
        const io = clonePidIo(module)
        if (port === 'input') {
          io.ai.rawBad = true
          io.ai.bad = io.ai.mode === 'AUTO'
        } else {
          const stage = port === 'output' ? io.ao : io.ao2
          const target = findDst(s.hardware, normalized)
          if (stage) {
            stage.bad = true
            if (target?.card.type === 'AO' && Number.isFinite(target.channel.value)) stage.out = target.channel.value
          }
        }
        next = { ...module, io, pvBad: port === 'input' && !io.inputSource ? io.ai.bad : module.pvBad }
      }
      return { modules: { ...s.modules, [tag]: next },
        hardware: { ...s.hardware, analogBindings: bindings }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, `${port} traditional I/O bound to ${normalized || '(none)'}`)
    return true
  },

  setDiscreteMode: (tag, mode) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Set ${tag} mode`)) return false
    const module = get().modules[tag]
    if (!module || (module.type !== 'DI' && module.type !== 'DO') || !['AUTO', 'OOS'].includes(mode)) {
      const error = 'Discrete mode requires a DI/DO module and AUTO or OOS'
      get().logEvent('DIAGNOSTIC', tag, error)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, m => {
      if (m.type === 'DI' || m.type === 'DO') {
        m.mode = mode
        if (mode === 'OOS') m.ioBad = true
      }
    })
    get().logEvent('OPERATOR', tag, `Discrete mode target set to ${mode}`)
    return true
  },

  configureDiscreteAlarm: (tag, onValue, enabled) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure ${tag} discrete alarm`)) return false
    if (get().modules[tag]?.type !== 'DI') {
      const error = 'Discrete input alarm configuration requires a DI module'
      get().logEvent('DIAGNOSTIC', tag, error)
      window.alert(error)
      return false
    }
    mutateModule(set, get, tag, m => {
      if (m.type !== 'DI') return
      m.alarmOnValue = onValue
      const existing = m.alarms.find(alarm => alarm.type === 'HI')
      m.alarms = [...m.alarms.filter(alarm => alarm.type !== 'HI'),
        { ...existing, type: 'HI', label: existing?.label ?? 'DISCRETE',
          priority: existing?.priority ?? 'WARNING', enabled }]
    })
    get().logEvent('CONFIGURE', tag, `Discrete alarm ON VALUE ${Number(onValue)}, enabled ${enabled}`)
    return true
  },

  deleteModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete module ${tag}`)) return
    if (motorEditorBlock(get(), tag)) {
      rejectSfc(get, tag, 'Owned template blocks cannot be deleted independently; delete the stopped/confirmed owning motor'); return
    }
    const module = get().modules[tag]
    if (get().hardware.deviceBindings?.[tag] &&
      (module?.type === 'MOTOR' && (module.commanded || module.running || module.appliedCommand) ||
       module?.type === 'VALVE' && (module.commandedOpen || module.open || module.appliedCommand))) {
      const error = 'Stop/close and confirm the device before deleting its physical I/O bindings'
      get().logEvent('DIAGNOSTIC', tag, `Module deletion rejected: ${error}`)
      window.alert(error)
      return
    }
    set((s) => {
      if (!s.modules[tag]) return {}
      const modules = { ...s.modules }
      delete modules[tag]
      const bindings = { ...s.hardware.discreteBindings }
      delete bindings[tag]
      const analogBindings = { ...s.hardware.analogBindings }
      delete analogBindings[tag]
      const deviceBindings = { ...s.hardware.deviceBindings }
      delete deviceBindings[tag]
      const moduleLifecycle = { ...s.moduleLifecycle }
      delete moduleLifecycle[tag]
      const pidLifecycle = { ...s.pidLifecycle }
      delete pidLifecycle[tag]
      const deviceLifecycle = { ...s.deviceLifecycle }
      delete deviceLifecycle[tag]
      return { modules, moduleLifecycle, pidLifecycle, deviceLifecycle, hardware: { ...s.hardware, discreteBindings: bindings, analogBindings, deviceBindings },
        alarms: s.alarms.filter((a) => a.moduleTag !== tag), rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, 'Module deleted')
  },

  createEquipmentModule: (tag, description, area) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Create Equipment Module ${tag}`)) return
    if (!get().areas.includes(area)) {
      const message = `Area ${area} does not exist`
      get().logEvent('DIAGNOSTIC', tag, `Equipment Module creation rejected: ${message}`)
      window.alert(message)
      return
    }
    set((s) => {
      const key = tag.trim().toUpperCase()
      if (!key || s.equipment[key]) return {}
      return { equipment: { ...s.equipment, [key]: { tag: key, description, area } }, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, 'Equipment Module created')
  },

  deleteEquipmentModule: (tag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete Equipment Module ${tag}`)) return
    set((s) => {
      if (!s.equipment[tag]) return {}
      const equipment = { ...s.equipment }
      delete equipment[tag]
      // Orphaned Control Modules fall back to "(unassigned)" under their Area.
      const modules = { ...s.modules }
      for (const k of Object.keys(modules)) {
        if (modules[k].equipmentModule === tag) modules[k] = { ...modules[k], equipmentModule: undefined }
      }
      const sfcs = Object.fromEntries(Object.entries(s.sfcs).map(([name, chart]) =>
        [name, !s.sfcLifecycle[name] && chart.equipmentModule === tag ? { ...chart, equipmentModule: undefined } : chart]))
      const sfcLifecycle = Object.fromEntries(Object.entries(s.sfcLifecycle).map(([name, record]) =>
        [name, record.draft.equipmentModule === tag ? { ...record,
          draft: { ...record.draft, equipmentModule: undefined } } : record]))
      return { equipment, modules, sfcs, sfcLifecycle, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', tag, 'Equipment Module deleted')
  },

  setModuleEquipment: (moduleTag, emTag) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Assign ${moduleTag} to Equipment Module`)) return
    mutateModule(set, get, moduleTag, (m) => {
      m.equipmentModule = emTag ?? undefined
    })
    get().logEvent('CONFIGURE', moduleTag, `Assigned to Equipment Module ${emTag ?? '(unassigned)'}`)
  },

  createSfc: (name, area, options) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Create SFC ${name}`)) return false
    const key = name.trim().toUpperCase()
    const state = get()
    const error = moduleNameError(key) ??
      (state.sfcs[key] || state.modules[key] ? `Module ${key} already exists` :
        !state.areas.includes(area) ? `Area ${area} does not exist` : null) ??
      sfcMetadataError({ area, description: options?.description, equipmentModule: options?.equipmentModule }, state.equipment)
    if (error) return rejectSfc(get, key, `SFC creation rejected: ${error}`)
    const metadata = { description: options?.description, equipmentModule: options?.equipmentModule }
    const sfc: SfcDef = { name: key, area, ...metadata, steps: [], status: 'READY', active: 0, elapsed: 0 }
    const draft = cloneSfcConfiguration({ name: key, area, ...metadata, controllerTag: '', steps: [] })
    set(s => ({ sfcs: { ...s.sfcs, [key]: sfc },
      sfcLifecycle: options?.managed ? { ...s.sfcLifecycle, [key]: { draft, online: false } } : s.sfcLifecycle,
      rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', key, options?.managed ?
      'SFC module created Offline; configure steps, Save and Download before execution' : 'SFC created')
    return true
  },

  deleteSfc: (name) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Delete SFC ${name}`)) return
    set((s) => {
      if (!s.sfcs[name]) return {}
      const sfcs = { ...s.sfcs }
      delete sfcs[name]
      const sfcLifecycle = { ...s.sfcLifecycle }
      delete sfcLifecycle[name]
      return { sfcs, sfcLifecycle, rev: s.rev + 1 }
    })
    get().logEvent('CONFIGURE', name, 'SFC deleted')
  },

  createNamedSet: (name) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Create Named Set ${name}`)) return false
    const definition: NamedSetDefinition = { name, description: '', entries: [] }
    const error = namedSetError(definition, true) ??
      (Object.hasOwn(get().namedSets.configured, name) ? `Named Set ${name} already exists (case-sensitive)` : null)
    if (error) { get().logEvent('DIAGNOSTIC', name, error); window.alert(error); return false }
    const configured = { ...get().namedSets.configured, [name]: definition }
    try { window.localStorage.setItem(NAMED_SETS_STORAGE_KEY, serializeNamedSets(configured)) }
    catch (error) {
      const message = `Named Set creation could not persist configuration: ${error instanceof Error ? error.message : String(error)}`
      get().logEvent('DIAGNOSTIC', name, message); window.alert(message); return false
    }
    set(s => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Named Set created; properties and Changed Setup Data transfer required')
    return true
  },

  applyNamedSetProperties: (expected, draft) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Named Set Properties ${expected.name}`)) return false
    const current = get().namedSets.configured[expected.name]
    const error = current !== expected ? 'Named Set changed or was removed; cancel and reopen Properties' :
      draft.name !== expected.name ? 'Named Set Properties cannot rename the set' : namedSetError(draft)
    if (error) { get().logEvent('DIAGNOSTIC', expected.name, error); window.alert(error); return false }
    const configured = { ...get().namedSets.configured, [draft.name]: cloneNamedSet(draft) }
    try { window.localStorage.setItem(NAMED_SETS_STORAGE_KEY, serializeNamedSets(configured)) }
    catch (error) {
      const message = `Named Set Properties could not persist configuration: ${error instanceof Error ? error.message : String(error)}`
      get().logEvent('DIAGNOSTIC', expected.name, message); window.alert(message); return false
    }
    set(s => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', draft.name, 'Named Set Properties saved to local configuration; setup transfer still required')
    return true
  },

  loadSavedNamedSets: () => {
    if (!requireUnlockedLock('CAN_CONFIGURE', 'Load saved Named Sets')) return false
    let text: string | null
    try { text = window.localStorage.getItem(NAMED_SETS_STORAGE_KEY) }
    catch (error) {
      const message = `Saved Named Sets could not be read: ${error instanceof Error ? error.message : String(error)}`
      get().logEvent('DIAGNOSTIC', 'Named Sets', message); window.alert(message); return false
    }
    const parsed = text === null ? { error: 'No saved Named Sets exist for this browser profile' } : parseNamedSets(text)
    const configured = parsed.configured
    if (parsed.error || !configured) {
      const message = parsed.error ?? 'Saved Named Set configuration is missing'
      get().logEvent('DIAGNOSTIC', 'Named Sets', message); window.alert(message); return false
    }
    set(s => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', 'Named Sets', 'Saved Named Set configuration loaded; deployed setup data unchanged')
    return true
  },

  downloadChangedNamedSets: (target) => {
    if (!requireUnlockedLock('CAN_DOWNLOAD', 'Download Changed Setup Data: Named Sets')) return false
    const state = get()
    const controller = target.kind === 'controller' ? state.hardware.controllers[target.tag] : undefined
    const error = target.kind === 'controller' && (!controller || controllerIsDown(controller)) ?
      'Changed Setup Data requires an available commissioned target controller' :
      Object.values(state.namedSets.configured).map(definition => namedSetError(definition)).find(Boolean)
    if (error) { get().logEvent('DIAGNOSTIC', namedSetTargetKey(target), error); window.alert(error); return false }
    const changes = changedNamedSets(state.namedSets, target)
    if (!changes.length) {
      const message = 'No Named Set setup changes for this target'
      get().logEvent('DIAGNOSTIC', namedSetTargetKey(target), message); window.alert(message); return false
    }
    const deployed = { ...state.namedSets.deployed[namedSetTargetKey(target)] }
    for (const name of changes) {
      if (Object.hasOwn(state.namedSets.configured, name)) deployed[name] = cloneNamedSet(state.namedSets.configured[name])
      else delete deployed[name]
    }
    set(s => ({ namedSets: { ...s.namedSets, deployed: { ...s.namedSets.deployed,
      [namedSetTargetKey(target)]: deployed } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', namedSetTargetKey(target), `Changed Setup Data: ${changes.join(', ')}; simulated Named Set subset transferred atomically`)
    return true
  },

  defineCustomAlarmType: (name, def) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Define custom alarm type ${name}`)) return false
    const state = get()
    const isNew = !Object.hasOwn(state.customAlarmTypes.configured, name)
    const error = customAlarmTypeNameError(name) ?? customAlarmTypeDefError(def) ??
      (isNew && Object.keys(state.customAlarmTypes.configured).length >= MAX_CUSTOM_ALARM_TYPES
        ? `Custom alarm type registry is full (maximum ${MAX_CUSTOM_ALARM_TYPES})` : null)
    if (error) { get().logEvent('DIAGNOSTIC', name, error); window.alert(error); return false }
    const configured = { ...state.customAlarmTypes.configured, [name]: cloneCustomAlarmType(def) }
    set(s => ({ customAlarmTypes: { ...s.customAlarmTypes, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `Custom alarm type ${isNew ? 'defined' : 'updated'}; Changed Setup Data download required`)
    return true
  },

  deleteCustomAlarmType: (name) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Delete custom alarm type ${name}`)) return false
    const state = get()
    if (!Object.hasOwn(state.customAlarmTypes.configured, name)) {
      const error = `Custom alarm type ${name} does not exist`
      get().logEvent('DIAGNOSTIC', name, error); window.alert(error); return false
    }
    const configured = { ...state.customAlarmTypes.configured }
    delete configured[name]
    set(s => ({ customAlarmTypes: { ...s.customAlarmTypes, configured }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Custom alarm type deleted; Changed Setup Data download required')
    return true
  },

  downloadCustomAlarmTypeSetup: () => {
    if (!requireUnlockedLock('CAN_DOWNLOAD', 'Download Changed Setup Data: Alarm Types')) return false
    const state = get()
    const changes = changedCustomAlarmTypeNames(state.customAlarmTypes)
    if (!changes.length) {
      const message = 'No alarm type setup changes to download'
      get().logEvent('DIAGNOSTIC', 'Alarm Types', message); window.alert(message); return false
    }
    const deployed = { ...state.customAlarmTypes.deployed }
    for (const name of changes) {
      if (Object.hasOwn(state.customAlarmTypes.configured, name)) deployed[name] = cloneCustomAlarmType(state.customAlarmTypes.configured[name])
      else delete deployed[name]
    }
    set(s => ({ customAlarmTypes: { ...s.customAlarmTypes, deployed }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', 'Alarm Types', `Changed Setup Data: ${changes.join(', ')}; simulated alarm type subset transferred atomically`)
    return true
  },

  defineConditionDelayAlarm: (name, def) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Define condition-delay alarm ${name}`)) return false
    const state = get()
    const error = customAlarmTypeNameError(name) ?? conditionDelayAlarmDefError(def, state.modules, state.customAlarmTypes.deployed)
    if (error) { get().logEvent('DIAGNOSTIC', name, error); window.alert(error); return false }
    const conditionDelayAlarms = { ...state.conditionDelayAlarms, [name]: { ...def } }
    set(s => ({ conditionDelayAlarms, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `Condition-delay alarm defined: ${def.conditionA} AND ${def.conditionB} for >${def.delaySeconds}s`)
    return true
  },

  deleteConditionDelayAlarm: (name) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Delete condition-delay alarm ${name}`)) return false
    const state = get()
    if (!Object.hasOwn(state.conditionDelayAlarms, name)) {
      const error = `Condition-delay alarm ${name} does not exist`
      get().logEvent('DIAGNOSTIC', name, error); window.alert(error); return false
    }
    const conditionDelayAlarms = { ...state.conditionDelayAlarms }
    delete conditionDelayAlarms[name]
    const conditionDelayAlarmRuntime = { ...state.conditionDelayAlarmRuntime }
    delete conditionDelayAlarmRuntime[name]
    const alarms = state.alarms.filter(a => a.id !== `CONDALM.${name}`)
    set(s => ({ conditionDelayAlarms, conditionDelayAlarmRuntime, alarms, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Condition-delay alarm deleted')
    return true
  },

  enableSfcLifecycle: name => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Enable saved SFC lifecycle ${name}`)) return false
    const state = get()
    const sfc = state.sfcs[name]
    if (!sfc || state.sfcLifecycle[name] || sfc.status === 'RUNNING' || sfc.status === 'HELD') {
      return rejectSfc(get, name, 'Reset an unmanaged SFC before enabling Save/Download lifecycle')
    }
    const draft = cloneSfcConfiguration({ name, area: sfc.area, controllerTag: '', steps: sfc.steps, ...cloneSfcBlocks(sfc),
      description: sfc.description, equipmentModule: sfc.equipmentModule,
      ...(sfc.parameters ? { parameters: sfc.parameters } : {}) })
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { draft, online: false } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Saved SFC lifecycle enabled; Save and Download required before execution')
    return true
  },

  configureSfcController: (name, controllerTag, expected) => {
    return get().configureSfcProperties(name, { controllerTag }, expected)
  },

  configureSfcProperties: (name, patch, expected) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure SFC Module Properties ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    if (expected && lifecycle?.draft !== expected) return rejectSfc(get, name, 'SFC configuration changed while Module Properties was open; reopen Properties')
    if (!lifecycle || lifecycle.online || state.sfcs[name]?.status === 'RUNNING' || state.sfcs[name]?.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline before changing SFC Module Properties')
    }
    const draft = { ...lifecycle.draft, ...patch }
    const error = Object.keys(patch).some(key => !['controllerTag', 'description', 'equipmentModule'].includes(key))
      ? 'Unsupported SFC Module Property' : typeof draft.controllerTag !== 'string' ||
        draft.controllerTag && !Object.hasOwn(state.hardware.controllers, draft.controllerTag)
        ? 'Configured target controller does not exist' : sfcMetadataError(draft, state.equipment)
    if (error) return rejectSfc(get, name, error)
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle,
      draft: cloneSfcConfiguration(draft) } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name,
      `SFC Module Properties: controller=${draft.controllerTag || '(unassigned)'}, description=${draft.description ?? ''}, Equipment Module=${draft.equipmentModule ?? '(unassigned)'}`)
    return true
  },

  saveSfc: name => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Save SFC ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    if (!lifecycle || lifecycle.online) return rejectSfc(get, name, 'Go Offline to save the configured SFC')
    const error = sfcMetadataError(lifecycle.draft, state.equipment) ??
      sfcConfigurationError(lifecycle.draft, state.modules, state.namedSets.configured) ??
      (!state.areas.includes(lifecycle.draft.area) ? 'Configured SFC area no longer exists' : null)
    if (error) return rejectSfc(get, name, error)
    const saved = cloneSfcConfiguration(lifecycle.draft)
    try { window.localStorage.setItem(savedSfcKey(name), serializeSavedSfc(saved)) }
    catch (error) { return rejectSfc(get, name, `SFC Save failed: ${error instanceof Error ? error.message : String(error)}`) }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, saved } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'SFC configuration saved to browser; deployed algorithm unchanged')
    return true
  },

  loadSavedSfc: name => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Load saved SFC ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!lifecycle || lifecycle.online || !runtime || runtime.status === 'RUNNING' || runtime.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline before loading saved SFC configuration')
    }
    let text: string | null
    try { text = window.localStorage.getItem(savedSfcKey(name)) }
    catch (error) { return rejectSfc(get, name, `Saved SFC read failed: ${error instanceof Error ? error.message : String(error)}`) }
    if (text === null) return rejectSfc(get, name, 'No saved SFC configuration exists in this browser profile')
    const parsed = parseSavedSfc(text, state.modules, state.namedSets.configured)
    if (parsed.error !== undefined) return rejectSfc(get, name, parsed.error)
    if (parsed.configuration.name !== name || !state.areas.includes(runtime.area)) {
      return rejectSfc(get, name, 'Saved SFC name/area does not match the current project')
    }
    const saved = { ...parsed.configuration, area: runtime.area }
    const metadataError = sfcMetadataError(saved, state.equipment)
    if (metadataError) return rejectSfc(get, name, metadataError)
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle,
      draft: cloneSfcConfiguration(saved), saved } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'Saved SFC loaded into offline configuration; deployed algorithm unchanged')
    return true
  },

  downloadSavedSfc: (name, expected) => {
    if (!requireUnlockedLock('CAN_DOWNLOAD', `Download SFC ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    const prepared = prepareSfcTransfer(lifecycle, runtime, state, expected)
    if ('error' in prepared) return rejectSfc(get, name, prepared.error)
    if (!lifecycle) return rejectSfc(get, name, 'Managed SFC lifecycle no longer exists')
    const { configuration: deployed } = prepared
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, deployed } },
      sfcs: { ...s.sfcs, [name]: prepared.runtime }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `Saved SFC downloaded to ${deployed.controllerTag}; READY, no actions executed`)
    return true
  },

  setSfcOnline: (name, online) => {
    if (useSecurity.getState().locked) {
      useSecurity.setState({ lastDenied: 'Access Denied — SFC Online requires an unlocked workstation' })
      return false
    }
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    if (!lifecycle) return rejectSfc(get, name, 'SFC does not use Save/Download lifecycle')
    const controller = lifecycle.deployed ? state.hardware.controllers[lifecycle.deployed.controllerTag] : undefined
    if (online && (!controller || controllerIsDown(controller))) {
      return rejectSfc(get, name, 'Download to an available controller before going Online')
    }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, online } } }))
    return true
  },

  configureSfcBlocks: (name, configuration, expected) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure SFC blocks/alarms ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!runtime || !lifecycle || lifecycle.draft !== expected || lifecycle.online ||
      runtime.status === 'RUNNING' || runtime.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline; reopen stale block/alarm Properties before editing')
    }
    const draft = { ...lifecycle.draft, blocks: undefined, alarmTypes: undefined, alarms: undefined,
      ...cloneSfcBlocks(configuration) }
    const error = sfcBlockConfigurationError(draft) ?? sfcStepsError(draft.steps, state.modules,
      { ...sfcExpressionContext(state, name), blocks: draft.blocks })
    if (error) return rejectSfc(get, name, error)
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, 'SFC function blocks/custom alarm types/alarms configured; Save/Download required')
    return true
  },

  configureSfcParameter: (name, parameter, binding, expected) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Configure SFC parameter ${name}/${parameter}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    if (!runtime || !lifecycle || lifecycle.draft !== expected || lifecycle.online ||
      runtime?.status === 'RUNNING' || runtime?.status === 'HELD') {
      return rejectSfc(get, name, 'Reset and go Offline; reopen stale parameter Properties before editing')
    }
    const parameters = { ...lifecycle.draft.parameters, [parameter]: { ...binding } }
    const error = sfcParameterError(parameters, state.namedSets.configured) ??
      sfcStepsError(lifecycle.draft.steps, state.modules, { name, parameters, sets: state.namedSets.configured, blocks: lifecycle.draft.blocks })
    if (error) return rejectSfc(get, name, error)
    const draft = { ...lifecycle.draft, parameters }
    set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `${parameter} configured as ${binding.type === 'BOOLEAN' ? 'Boolean' : `Named Set ${binding.namedSet}`}; Save/Download required`)
    return true
  },

  writeSfcNamedValue: (name, parameter, value) => {
    if (!requireUnlockedLock('CONTROL', `Named Set data entry ${name}/${parameter}`)) return false
    if (gateSignature(set, get, name, [parameter.toUpperCase()], `${parameter} := ${value}`,
      () => get().writeSfcNamedValue(name, parameter, value))) return false
    const state = get()
    const deployed = state.sfcLifecycle[name]?.deployed
    const runtime = state.sfcs[name]
    const binding = runtime?.parameters && Object.hasOwn(runtime.parameters, parameter) ? runtime.parameters[parameter] : undefined
    const controller = deployed ? state.hardware.controllers[deployed.controllerTag] : undefined
    if (!binding || binding.type !== 'NAMED_SET' || !deployed || !controller || controllerIsDown(controller)) {
      return rejectSfc(get, name, 'Named Set entry requires a downloaded parameter on an available controller')
    }
    const controllerSet = controllerNamedSets(state.namedSets, deployed.controllerTag)[binding.namedSet]
    const workstationSet = state.namedSets.deployed.WORKSTATION?.[binding.namedSet]
    const selected = workstationSet?.entries.find(entry => entry.value === value)
    const target = controllerSet?.entries.find(entry => entry.value === value)
    if (!Number.isSafeInteger(value) || !selected || !target || selected.name !== target.name ||
      !selected.visible || !selected.userSelectable || !target.visible || !target.userSelectable) {
      return rejectSfc(get, name, 'Value is not a visible/selectable matching state in workstation and controller setup; transfer Changed Setup Data')
    }
    set(s => ({ sfcs: { ...s.sfcs, [name]: { ...runtime,
      parameters: { ...runtime.parameters, [parameter]: { ...binding, value } } } }, rev: s.rev + 1 }))
    get().logEvent('OPERATOR', name, `${parameter} := ${binding.namedSet}:${selected.name} (${value})`)
    return true
  },

  checkSfc: (name) => {
    const runtime = get().sfcs[name]
    const sfc = runtime ? sfcEditorDefinition(runtime, get().sfcLifecycle[name]) : undefined
    const error = !sfc ? `SFC ${name} does not exist` : !sfc.steps.length ?
      'SFC requires at least one step' : sfcBlockConfigurationError(sfc) ?? sfcParameterError(sfc.parameters,
        sfcExpressionContext(get(), name, !!get().sfcLifecycle[name]?.online).sets) ??
        sfcStepsError(sfc.steps, get().modules, { ...sfcExpressionContext(get(), name, !!get().sfcLifecycle[name]?.online),
          parameters: sfc.parameters ?? {} })
    get().logEvent(error ? 'DIAGNOSTIC' : 'CONFIGURE', name,
      error ? `SFC Check failed: ${error}` : 'SFC Check passed for supported actions/conditions, block/alarm references and routes')
    return error
  },

  applySfcStepProperties: (name, expected, patch, related = []) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Apply SFC properties ${name}`)) return false
    const state = get()
    const lifecycle = state.sfcLifecycle[name]
    const runtime = state.sfcs[name]
    const sfc = runtime ? sfcEditorDefinition(runtime, lifecycle) : undefined
    const step = sfc?.steps.find(item => item.id === expected.id)
    const candidate = { ...expected, ...patch }
    const steps = sfc?.steps.map(item => {
      const change = related.find(entry => entry.expected.id === item.id)
      return item.id === expected.id ? candidate : change ? { ...item, ...change.patch } : item
    }) ?? []
    const error = !sfc || !step ? 'SFC or selected step no longer exists' :
      lifecycle?.online ? 'Go Offline to edit SFC configuration' :
      runtime?.status !== 'READY' && runtime?.status !== 'COMPLETE' ? 'Reset the SFC before applying Properties' :
      step !== expected ? 'Step changed while Properties was open; cancel and reopen to avoid overwriting edits' :
      related.some(entry => entry.expected.id === expected.id ||
        sfc.steps.find(item => item.id === entry.expected.id) !== entry.expected) ||
        new Set(related.map(entry => entry.expected.id)).size !== related.length ?
        'Related join step changed while Properties was open; cancel and reopen' :
      sfcStepsError(steps, state.modules, sfcExpressionContext(state, name))
    if (error) {
      get().logEvent('DIAGNOSTIC', name, `SFC Properties rejected: ${error}`); window.alert(error)
      return false
    }
    if (!sfc) return false
    if (lifecycle) {
      const draft = { ...lifecycle.draft, steps: cloneSfcConfiguration({ ...lifecycle.draft, steps }).steps }
      set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
      get().logEvent('CONFIGURE', name, `SFC step ${candidate.name} draft Properties applied; Save/Download required`)
      return true
    }
    set(s => ({ sfcs: { ...s.sfcs, [name]: { ...sfc, steps, active: 0, elapsed: 0,
      parameters: resetSfcBooleanActions(sfc),
      status: 'READY', actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} } }, rev: s.rev + 1 }))
    get().logEvent('CONFIGURE', name, `SFC step ${candidate.name} Properties applied`)
    return true
  },

  setSfcSteps: (name, steps) => {
    if (!requireUnlockedLock('CAN_CONFIGURE', `Edit SFC ${name}`)) return
    const current = get().sfcs[name]
    const lifecycle = get().sfcLifecycle[name]
    if (!current || lifecycle?.online || current.status === 'RUNNING' || current.status === 'HELD') {
      const message = !current ? `SFC ${name} does not exist` : 'Reset the SFC and go Offline before editing its steps'
      get().logEvent('DIAGNOSTIC', name, message); window.alert(message)
      return
    }
    if (lifecycle) {
      const draft = { ...lifecycle.draft, steps: cloneSfcConfiguration({ ...lifecycle.draft, steps }).steps }
      set(s => ({ sfcLifecycle: { ...s.sfcLifecycle, [name]: { ...lifecycle, draft } }, rev: s.rev + 1 }))
      get().logEvent('CONFIGURE', name, 'SFC draft steps edited; deployed algorithm unchanged')
      return
    }
    set((s) => {
      const sfc = s.sfcs[name]
      if (!sfc) return {}
      // Editing resets the run so the chart starts clean.
      return {
        sfcs: { ...s.sfcs, [name]: { ...sfc, steps, parameters: resetSfcBooleanActions(sfc), status: 'READY', active: 0, elapsed: 0, actionStates: {},
          activeSteps: undefined, joinArrivals: undefined, blockStates: {} } },
        rev: s.rev + 1
      }
    })
    get().logEvent('CONFIGURE', name, 'SFC steps edited')
  },

  sfcCommand: (name, cmd) => {
    if (!requireUnlockedLock('BATCH_OPERATE', `SFC command ${name}`)) return
    const current = get().sfcs[name]
    const lifecycle = get().sfcLifecycle[name]
    const controller = lifecycle?.deployed ? get().hardware.controllers[lifecycle.deployed.controllerTag] : undefined
    const error = !current ? `SFC ${name} does not exist` :
      lifecycle && (!lifecycle.online || !controller || controllerIsDown(controller)) ?
        'Managed SFC commands require Online and an available downloaded controller' : cmd === 'run' ?
      current.steps.length === 0 ? 'SFC requires at least one step' :
        sfcBlockConfigurationError(current) ?? sfcParameterError(current.parameters, sfcExpressionContext(get(), name, true).sets) ??
        sfcStepsError(current.steps, get().modules, { ...sfcExpressionContext(get(), name, true), parameters: current.parameters ?? {} }) : null
    if (error) {
      get().logEvent('DIAGNOSTIC', name, `SFC command rejected: ${error}`); window.alert(error)
      return
    }
    set((s) => {
      const sfc = s.sfcs[name]
      if (!sfc) return {}
      let next = sfc
      if (cmd === 'run') next = sfc.status === 'COMPLETE' ?
        { ...sfc, parameters: resetSfcBooleanActions(sfc), status: 'RUNNING', active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} } : { ...sfc, status: 'RUNNING' }
      else if (cmd === 'hold') next = { ...sfc, status: sfc.status === 'RUNNING' ? 'HELD' : sfc.status }
      else if (cmd === 'reset') next = { ...sfc, parameters: resetSfcBooleanActions(sfc), status: 'READY', active: 0, elapsed: 0, actionStates: {}, activeSteps: undefined, joinArrivals: undefined, blockStates: {} }
      return { sfcs: { ...s.sfcs, [name]: next }, rev: s.rev + 1 }
    })
    get().logEvent('BATCH', name, `SFC command: ${cmd}`)
  },

  newProject: (kind) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `New Project (${kind})`)) return
    const base = kind === 'blank' ? buildBlankPlant() : installPhotoPlant(buildInitialPlant()).plant
    simulationBaseline = { process: { ...base.process }, photoPlant: kind === 'blank' ? undefined : base.photoPlant }
    set({
      ...base,
      photoPlant: kind === 'blank' ? undefined : base.photoPlant,
      trend: [],
      eventLog: [],
      batch: makeBatch(),
      phases: makeDefaultPhases(),
      sfcs: kind === 'blank' ? {} : makeDefaultSfcs(),
      equipment: kind === 'blank' ? makeBlankEquipment() : makeDefaultEquipment(),
      hardware: kind === 'blank' ? makeBlankHardware() : makeDefaultHardware(),
      moduleLifecycle: {},
      pidLifecycle: {},
      deviceLifecycle: {},
      namedSets: { configured: {}, deployed: {} },
      signature: EMPTY_SIGNATURE_CONFIG,
      signaturePending: [],
      alarmSuppressMinutes: {},
      customAlarmTypes: { configured: {}, deployed: {} },
      conditionDelayAlarms: {},
      conditionDelayAlarmRuntime: {},
      moduleScheduling: {},
      recipes: { [DEFAULT_RECIPE_NAME]: defaultRecipe() },
      activeRecipe: DEFAULT_RECIPE_NAME,
      sfcLifecycle: {},
      downloadStatusChecks: {},
      rev: get().rev + 1
    })
  }
}))

function rejectAo(get: () => StoreState, tag: string, message: string): false {
  get().logEvent('DIAGNOSTIC', tag, `AO action rejected: ${message}`)
  window.alert(message)
  return false
}

function rejectPid(get: () => StoreState, tag: string, message: string): false {
  get().logEvent('DIAGNOSTIC', tag, `PID_LOOP action rejected: ${message}`)
  window.alert(message)
  return false
}

function motorEditorBlock(state: StoreState, tag: string): ReturnType<typeof ownedMotorBlock> {
  return ownedMotorBlock(deviceEditorModules(state.modules, state.deviceLifecycle), tag)
}

function mutateModule(
  set: (fn: (s: StoreState) => Partial<StoreState>) => void,
  get: () => StoreState,
  tag: string,
  fn: (m: AnyModule) => void
): void {
  const s = get()
  const owned = ownedMotorBlock(s.modules, tag)
  if (owned) {
    const block = { ...owned.block }
    fn(block)
    set(st => ({ modules: { ...st.modules, [owned.owner.tag]: { ...owned.owner,
      ownedBlocks: { ...owned.owner.ownedBlocks, [owned.name]: block } } }, rev: st.rev + 1 }))
    return
  }
  const existing = s.modules[tag]
  if (!existing) return
  const clone = { ...existing } as AnyModule
  fn(clone)
  set((st) => ({ modules: { ...st.modules, [tag]: clone }, rev: st.rev + 1 }))
}

// DV09-079: lets the security store find the plant area of the module an action targets.
registerAreaResolver((action) => {
  const modules = useStore.getState().modules
  for (const token of action.match(/[A-Za-z0-9_-]+/g) ?? []) {
    const area = modules[token]?.area
    if (area !== undefined) return area
  }
  return undefined
})


// DV09-080: operator writes that need an electronic signature are staged here until signed.
let signatureBypass = false
let nextSignatureId = 1
const pendingSignatureWrites = new Map<number, () => void>()

function gateSignature(
  set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => StoreState,
  tag: string,
  parameters: string[],
  valueText: string,
  apply: () => void
): boolean {
  if (signatureBypass) return false
  const state = get()
  const area = state.modules[tag]?.area ?? (state.sfcs[tag] as { area?: string } | undefined)?.area
  let level: 0 | 1 | 2 = 0
  let policy: SignaturePolicy | undefined
  for (const parameter of parameters) {
    const required = requiredSignature(state.signature, { tag, area }, parameter)
    if (required.level > level) {
      level = required.level
      policy = required.policy
    }
  }
  if (level === 0 || !policy) return false
  const parameter = parameters.join(',')
  const superseded = state.signaturePending.filter((r) => r.tag === tag && r.parameter === parameter)
  superseded.forEach((r) => pendingSignatureWrites.delete(r.id))
  const request: SignatureRequest = {
    id: nextSignatureId++,
    tag,
    parameter,
    valueText,
    level,
    policy: policy.name,
    allowSamePerson: policy.allowSamePerson,
    requestedBy: useSecurity.getState().currentUser,
    requestedAt: Date.now()
  }
  pendingSignatureWrites.set(request.id, apply)
  set((s) => ({ signaturePending: [...s.signaturePending.filter((r) => !superseded.includes(r)), request] }))
  get().logEvent(
    'SECURITY',
    tag,
    `Electronic signature required for ${valueText} (${level === 2 ? 'confirm and verify' : 'confirm'}, policy ${policy.name})`
  )
  return true
}

/** Slots occupied by H1 cards (a redundant card also holds its partner slot). */
function h1Slots(hw: HardwareState): { controllerTag: string; slots: number[] }[] {
  return Object.values(hw.h1Cards ?? {}).map(card => ({ controllerTag: card.controllerTag, slots: card.partnerSlot ? [card.slot, card.partnerSlot] : [card.slot] }))
}
