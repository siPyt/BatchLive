import { useStore } from './store'
import { usePictures } from './pictureStore'
import { useSecurity } from './security'
import { parseSavedPicture } from './pictureDynamics'
import { NAMED_SETS_STORAGE_KEY, serializeNamedSets } from './namedSets'
import {
  EXPORT_KIND_LABEL,
  buildExportPackage,
  controlStrategiesError,
  hardwareError,
  namedSetsExportError,
  parseExportPackage,
  picturesExportError,
  serializeExport,
  type ExportKind,
  type ExportSource
} from './projectExport'
import type { HardwareState } from './hardware'

// DV09-084: the DeltaV Export workshop. Exports and imports go through the
// same Can Configure function key as other configuration changes.

export const EXPORT_FILE_EXTENSION = '.batchlive-export.json'

function source(): ExportSource {
  const s = useStore.getState()
  return {
    hardware: s.hardware,
    areas: s.areas,
    modules: s.modules,
    equipment: s.equipment,
    sfcs: s.sfcs,
    phases: s.phases as unknown as Record<string, unknown>,
    namedSets: s.namedSets.configured,
    pictures: usePictures.getState().pictures
  }
}

function fileName(kind: ExportKind, names: string[]): string {
  const stem = kind === 'named-sets' || kind === 'pictures' ? names.join('+') : EXPORT_KIND_LABEL[kind].replace(/\s+/g, '')
  return `${stem}${EXPORT_FILE_EXTENSION}`
}

export function exportConfiguration(kind: ExportKind, names: string[] = []): { text: string; fileName: string } | { error: string } {
  if (!useSecurity.getState().requireLock('CAN_CONFIGURE', 'Export configuration')) {
    return { error: useSecurity.getState().lastDenied ?? 'Export requires the Can Configure key' }
  }
  const pkg = buildExportPackage(kind, source(), names)
  if ('error' in pkg) return pkg
  useStore.getState().logEvent('CONFIGURE', pkg.name, `${EXPORT_KIND_LABEL[kind]} exported to ${fileName(kind, names)}`)
  return { text: serializeExport(pkg), fileName: fileName(kind, names) }
}

export function importConfiguration(text: string): { kind: ExportKind; summary: string } | { error: string } {
  if (!useSecurity.getState().requireLock('CAN_CONFIGURE', 'Import configuration')) {
    return { error: useSecurity.getState().lastDenied ?? 'Import requires the Can Configure key' }
  }
  const parsed = parseExportPackage(text)
  if (parsed.error || !parsed.package) return { error: parsed.error ?? 'The export package is malformed' }
  const pkg = parsed.package
  const log = useStore.getState().logEvent
  const fail = (message: string): { error: string } => {
    log('DIAGNOSTIC', pkg.name, `Import of ${EXPORT_KIND_LABEL[pkg.kind]} rejected: ${message}`)
    return { error: message }
  }

  if (pkg.kind === 'physical-network') {
    const error = hardwareError(pkg.data)
    if (error) return fail(error)
    useStore.setState((s) => ({ hardware: pkg.data as HardwareState, rev: s.rev + 1 }))
    log('CONFIGURE', pkg.name, 'Physical Network imported; controllers must be commissioned and modules downloaded again')
    return { kind: pkg.kind, summary: `Imported ${Object.keys((pkg.data as HardwareState).controllers).length} controller(s)` }
  }

  if (pkg.kind === 'control-strategies') {
    const error = controlStrategiesError(pkg.data)
    if (error) return fail(error)
    const data = pkg.data as Record<string, never>
    useStore.setState((s) => ({
      areas: data.areas,
      modules: data.modules,
      equipment: data.equipment,
      sfcs: data.sfcs,
      phases: data.phases,
      alarms: [],
      moduleLifecycle: {},
      pidLifecycle: {},
      deviceLifecycle: {},
      sfcLifecycle: {},
      rev: s.rev + 1
    }))
    log('CONFIGURE', pkg.name, 'Control Strategies imported; saved/deployed lifecycle records were reset')
    return { kind: pkg.kind, summary: `Imported ${Object.keys(data.modules).length} module(s) and ${Object.keys(data.sfcs).length} SFC(s)` }
  }

  if (pkg.kind === 'named-sets') {
    const result = namedSetsExportError(pkg.data)
    if (result.error || !result.configured) return fail(result.error ?? 'Named Set data is malformed')
    const configured = { ...useStore.getState().namedSets.configured, ...result.configured }
    try {
      window.localStorage.setItem(NAMED_SETS_STORAGE_KEY, serializeNamedSets(configured))
    } catch (error) {
      return fail(`Named Sets could not be persisted: ${error instanceof Error ? error.message : String(error)}`)
    }
    useStore.setState((s) => ({ namedSets: { ...s.namedSets, configured }, rev: s.rev + 1 }))
    log('CONFIGURE', pkg.name, 'Named Sets imported to the configured set; Changed Setup Data transfer is still required')
    return { kind: pkg.kind, summary: `Imported ${Object.keys(result.configured).join(', ')}` }
  }

  const error = picturesExportError(pkg.data)
  if (error) return fail(error)
  const pictures = pkg.data as Record<string, unknown>
  const checked: Record<string, ReturnType<typeof parseSavedPicture>> = {}
  try {
    for (const [name, picture] of Object.entries(pictures)) {
      checked[name] = parseSavedPicture(JSON.stringify({ version: 1, picture }), name, useStore.getState().modules, useStore.getState())
    }
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : String(caught))
  }
  usePictures.setState((s) => ({ pictures: { ...s.pictures, ...checked } }))
  log('CONFIGURE', pkg.name, 'Operator pictures imported')
  return { kind: pkg.kind, summary: `Imported ${Object.keys(checked).join(', ')}` }
}
