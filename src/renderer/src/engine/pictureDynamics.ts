import { pidExecutionBad, pidModeFieldsError, pidNormalMode, pidPermittedModes } from './pidModes'
import type { ActiveAlarm, AnyModule, PidTargetMode } from './types'
import type { PicElement, Picture } from './pictureStore'
import { pictureNamedSignal, type PictureNamedContext } from './pictureNamedSets'
import { flowAnimationError } from './pictureFlow'

export interface PictureSignal {
  value: number
  unit: string
  bad: boolean
  low?: number
  high?: number
  parameter?: string
}
export type PictureSignalResult = PictureSignal | { error: string }
export interface PictureModeSignal {
  current: string
  choices?: PidTargetMode[]
  isNormal?: boolean
}
export type PictureModeSignalResult = PictureModeSignal | { error: string }
export interface PictureAlarmSignal {
  active: boolean
  text: string
}
export type PictureAlarmSignalResult = PictureAlarmSignal | { error: string }
export type PictureDynamicPatch = Pick<Partial<PicElement>,
  'path' | 'entry' | 'fill' | 'width' | 'height' | 'color' | 'backgroundColor' | 'tag' | 'flashWhenNotNormal' | 'flowAnimation'>

function pictureModePath(path: string): 'target' | 'actual' | null {
  const normalized = path.trim().toUpperCase().replace(/^PID1\//, '').replace(/\.CV$/, '')
  if (normalized === 'MODE.A_TARGET') return 'target'
  if (normalized === 'MODE.A_ACTUAL') return 'actual'
  return null
}

export function pictureModeSignal(el: Pick<PicElement, 'tag' | 'path'>,
  modules: Record<string, AnyModule>): PictureModeSignalResult {
  const tag = el.tag ?? ''
  const module = modules[tag]
  const modePath = pictureModePath(el.path ?? '')
  if (!module || module.type !== 'PID' || !modePath) {
    return { error: `Unsupported mode source ${tag || '(unassigned)'}/${el.path ?? ''}` }
  }
  const error = pidModeFieldsError(module)
  if (error) return { error: `${tag}: ${error}` }
  return modePath === 'target'
    ? { current: module.mode, choices: pidPermittedModes(module) }
    : { current: module.actualMode, isNormal: module.actualMode === pidNormalMode(module) }
}

function pictureAlarmPath(path: string): boolean {
  return /^ALARMS\[1\]\.A_LAALM$/i.test(path.trim())
}

export function pictureAlarmSignal(el: Pick<PicElement, 'tag' | 'path'>,
  modules: Record<string, AnyModule>, alarms: ActiveAlarm[]): PictureAlarmSignalResult {
  const tag = el.tag ?? ''
  const module = modules[tag]
  if (!module || !pictureAlarmPath(el.path ?? '')) {
    return { error: `Unsupported alarm source ${tag || '(unassigned)'}/${el.path ?? ''}` }
  }
  if (!module.alarms.length) return { error: `${tag} has no configured alarms` }
  const active = alarms.some(alarm => alarm.moduleTag === tag && alarm.active)
  return { active, text: active ? 'ALARM' : '' }
}

export function pictureSignal(el: PicElement, modules: Record<string, AnyModule>): PictureSignalResult {
  const m = el.tag ? modules[el.tag] : undefined
  if (!m) return { error: `Module ${el.tag || '(unassigned)'} does not exist` }
  const path = (el.path ?? el.param ?? 'PV').trim().toUpperCase()
  let parameter = path.replace(/\.(F_)?CV$/, '')
  let result: PictureSignal
  if (m.type === 'PID' && /^(?:PID1\/)?SP(?:\.(?:F_)?CV)?$/.test(path)) {
    parameter = 'PID1/SP'
    result = { value: m.sp, unit: m.unit, low: m.pvMin, high: m.pvMax,
      bad: m.pvBad || pidExecutionBad(m), parameter }
  } else if (parameter === 'AI1/PV' && m.type === 'PID') {
    result = { value: m.io?.ai.out ?? m.pv, unit: m.unit, low: m.pvMin, high: m.pvMax,
      bad: m.io?.ai.bad ?? m.pvBad }
  } else if ((parameter === 'PV' || parameter === 'AI1/PV' && m.type !== 'AO') &&
      (m.type === 'AI' || m.type === 'PID' || m.type === 'AO')) {
    result = { value: m.pv, unit: m.unit, low: m.pvMin, high: m.pvMax,
      bad: m.type === 'AO' ? m.bad : m.pvBad || (m.type === 'PID' && pidExecutionBad(m)) }
  } else if (m.type === 'AO' && m.parameters[parameter]) {
    result = { value: m.parameters[parameter].value, unit: '', bad: m.bad, parameter }
  } else if ((parameter === 'SP' || parameter === 'AO1/SP' && m.type === 'AO') && (m.type === 'PID' || m.type === 'AO')) {
    result = { value: m.sp, unit: m.unit, bad: m.type === 'PID' ? m.pvBad || pidExecutionBad(m) : m.bad,
      low: m.type === 'AO' ? m.spLow : m.pvMin, high: m.type === 'AO' ? m.spHigh : m.pvMax }
  } else if ((parameter === 'OUT' || parameter === 'AO1/OUT' && m.type === 'AO') && (m.type === 'PID' || m.type === 'AO')) {
    result = { value: m.out, unit: '%', low: 0, high: 100,
      bad: m.type === 'PID' ? pidExecutionBad(m) || (m.io?.ao.bad ?? m.pvBad) : m.bad }
  } else return { error: `Unsupported numeric source ${m.tag}/${path}` }
  return Number.isFinite(result.value) ? result : { error: `Source ${m.tag}/${path} is not finite` }
}

export function pictureLimits(settings: { fetchLimits: boolean; low: number; high: number },
  source: PictureSignal): { low: number; high: number } | { error: string } {
  const low = settings.fetchLimits ? source.low : settings.low
  const high = settings.fetchLimits ? source.high : settings.high
  if (low === undefined || high === undefined || !Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
    return { error: settings.fetchLimits ? 'Source does not provide valid limits; configure explicit limits' :
      'Limits require finite low < high' }
  }
  return { low, high }
}

export function pictureElementError(el: PicElement, modules: Record<string, AnyModule>, context?: PictureNamedContext): string | null {
  if (!Number.isFinite(el.x) || !Number.isFinite(el.y) || el.x < 0 || el.y < 0) return 'Element position must be finite and nonnegative'
  if (el.type === 'pump' && modules[el.tag ?? '']?.type !== 'MOTOR') return 'Pump dynamo requires a MOTOR module'
  if (el.type === 'valve' && !['PID', 'VALVE'].includes(modules[el.tag ?? '']?.type ?? '')) {
    return 'Valve dynamo requires a PID output or VALVE feedback module'
  }
  if (el.type === 'pipe' && ![el.width ?? 120, el.height ?? 12].every(value => Number.isFinite(value) && value > 0)) {
    return 'Pipe dimensions must be finite and positive'
  }
  if (el.flowAnimation) {
    if (!['pipe', 'pump', 'valve', 'rectangle', 'dynamo'].includes(el.type)) return 'Flow color animation requires a pipe, pump, valve, rectangle or dynamo'
    const error = flowAnimationError(el.flowAnimation, modules)
    if (error) return error
  }
  if (el.type === 'rectangle' && (![el.width ?? 64, el.height ?? 160].every(v => Number.isFinite(v) && v > 0))) {
    return 'Rectangle dimensions must be finite and positive'
  }
  if ([el.color, el.backgroundColor].some(v => v !== undefined && !/^#[0-9a-f]{6}$/i.test(v))) return 'Colors require six-digit hex values'
  if (el.entry && el.type !== 'datalink') return 'Data Entry requires a datalink'
  if (el.flashWhenNotNormal && pictureModePath(el.path ?? '') !== 'actual') {
    return 'Flash-when-not-normal requires a PID MODE.A_ACTUAL datalink'
  }
  if (el.entry?.method === 'NAMED_SET' || el.type === 'datalink' && !!context?.sfcLifecycle[el.tag ?? ''] && el.path !== undefined) {
    if (el.entry && el.entry.method !== 'NAMED_SET') return 'SFC Named Set sources require Named Set entry, not numeric entry'
    if (el.fill) return 'Named Set sources do not support numeric fill animations'
    if (!context) return 'Named Set datalinks require the SFC configuration context'
    const source = pictureNamedSignal(el, context, true)
    return 'error' in source ? source.error : null
  }
  if (el.entry?.method === 'PID_MODE') {
    const source = pictureModeSignal(el, modules)
    if ('error' in source) return source.error
    return source.choices ? null : 'Only MODE.A_TARGET supports Multiple-Item Select entry'
  }
  if (el.path !== undefined && pictureAlarmPath(el.path)) {
    const source = pictureAlarmSignal(el, modules, [])
    return 'error' in source ? source.error : null
  }
  if (el.entry && el.entry.method !== 'NUMERIC') return 'Unsupported Data Entry method'
  if (el.fill && el.type !== 'rectangle') return 'Fill animation requires a rectangle'
  if (el.fill && typeof el.fill.vertical !== 'boolean') return 'Fill direction must be vertical or horizontal'
  if (el.path !== undefined && pictureModePath(el.path)) {
    const source = pictureModeSignal(el, modules)
    if ('error' in source) return source.error
    if (el.entry) return 'Mode targets require Multiple-Item Select entry'
    if (el.fill) return 'Mode paths do not support numeric fill animations'
    return null
  }
  if (!el.entry && !el.fill && el.path === undefined) return null
  const source = pictureSignal(el, modules)
  if ('error' in source) return source.error
  if (el.entry && !source.parameter) return 'Numeric entry requires PID1/SP or a standalone AO Floating Point parameter'
  const module = el.tag ? modules[el.tag] : undefined
  if (el.entry && source.parameter !== 'PID1/SP') {
    if (!source.parameter || module?.type !== 'AO' || !module.parameters[source.parameter]) {
      return 'Numeric entry supports PID1/SP or a standalone AO Floating Point parameter'
    }
  }
  for (const settings of [el.entry, el.fill]) {
    if (!settings) continue
    if (typeof settings.fetchLimits !== 'boolean') return 'Fetch Limits must be a Boolean'
    if (![settings.low, settings.high].every(Number.isFinite)) return 'Limits must be finite'
    const limits = pictureLimits(settings, source)
    if ('error' in limits) return limits.error
  }
  return null
}

export function pictureFill(el: PicElement, modules: Record<string, AnyModule>): PictureSignalResult & { percent?: number } {
  const source = pictureSignal(el, modules)
  if ('error' in source || !el.fill) return source
  const limits = pictureLimits(el.fill, source)
  if ('error' in limits) return limits
  return { ...source, percent: Math.max(0, Math.min(100, (source.value - limits.low) / (limits.high - limits.low) * 100)) }
}

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function limits(v: unknown): boolean {
  return object(v) && typeof v.fetchLimits === 'boolean' &&
    typeof v.low === 'number' && Number.isFinite(v.low) && typeof v.high === 'number' && Number.isFinite(v.high)
}
function element(v: unknown): v is PicElement {
  return object(v) && typeof v.id === 'string' && typeof v.type === 'string' &&
    ['text', 'datalink', 'dynamo', 'rectangle', 'tank', 'pipe', 'pump', 'valve'].includes(v.type) &&
    typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y) &&
    ['content', 'color', 'backgroundColor', 'tag', 'path'].every(k => v[k] === undefined || typeof v[k] === 'string') &&
    ['fontSize', 'width', 'height'].every(k => v[k] === undefined || typeof v[k] === 'number' && Number.isFinite(v[k])) &&
    ['label', 'bold'].every(k => v[k] === undefined || typeof v[k] === 'boolean') &&
    (v.flashWhenNotNormal === undefined || typeof v.flashWhenNotNormal === 'boolean') &&
    (v.flowAnimation === undefined || object(v.flowAnimation) &&
      typeof v.flowAnimation.table === 'string' && Array.isArray(v.flowAnimation.conditions) &&
      v.flowAnimation.conditions.every(condition => object(condition) && typeof condition.tag === 'string' &&
        typeof condition.path === 'string' && ['STATE', 'PV', 'PID1/OUT', 'AO1/OUT'].includes(condition.path) &&
        typeof condition.greaterThan === 'number' && Number.isFinite(condition.greaterThan))) &&
    (v.param === undefined || typeof v.param === 'string' && ['PV', 'SP', 'OUT', 'MODE', 'STATE'].includes(v.param)) &&
    (v.entry === undefined || object(v.entry) &&
      (v.entry.method === 'NAMED_SET' || v.entry.method === 'PID_MODE' ||
        v.entry.method === 'NUMERIC' && limits(v.entry))) &&
    (v.fill === undefined || object(v.fill) && typeof v.fill.vertical === 'boolean' && limits(v.fill))
}
export function parseSavedPicture(text: string, name: string, modules: Record<string, AnyModule>, context?: PictureNamedContext): Picture {
  const data: unknown = JSON.parse(text)
  if (!object(data) || data.version !== 1 || !object(data.picture)) throw new Error('Unsupported saved picture format/version')
  const p = data.picture
  if (p.name !== name || typeof p.name !== 'string' || !Array.isArray(p.elements) || !p.elements.every(element) ||
      !['previousPicture', 'nextPicture'].every(k => p[k] === undefined || typeof p[k] === 'string')) {
    throw new Error('Saved picture name/schema is invalid')
  }
  if (new Set(p.elements.map(e => e.id)).size !== p.elements.length) throw new Error('Saved picture has duplicate element IDs')
  for (const el of p.elements) {
    const error = pictureElementError(el, modules, context)
    if (error) throw new Error(error)
  }
  return { name: p.name, elements: p.elements,
    previousPicture: typeof p.previousPicture === 'string' ? p.previousPicture : undefined,
    nextPicture: typeof p.nextPicture === 'string' ? p.nextPicture : undefined }
}
