import type { AnyModule, TrendPoint } from './types'
import type { PicElement, Picture } from './pictureStore'

// ---------------------------------------------------------------------------
// Operator-picture objects beyond basic datalinks (DV09-027/029/030/031/051/062): picture templates, text properties,
// datalink layout/error/refresh/history, discrete SP_D/PV_D signals and the isolated course dynamo library.
// Everything here is pure so it can be validated, saved and tested without the UI.
// ---------------------------------------------------------------------------

export const PICTURE_WIDTH = 1000
export const PICTURE_HEIGHT = 640
export const MIN_FONT_SIZE = 6
export const MAX_FONT_SIZE = 96
export const FONT_FAMILIES = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Times New Roman', 'Courier New', 'Consolas'] as const
export const TITLE_GROUP = 'TITLE'

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function pictureSize(picture: Pick<Picture, 'width' | 'height'>): { width: number; height: number } {
  return { width: picture.width ?? PICTURE_WIDTH, height: picture.height ?? PICTURE_HEIGHT }
}

// --- templates (DV09-027) --------------------------------------------------

export type PictureTemplateName = 'MAIN'

export const PICTURE_TEMPLATES: Record<PictureTemplateName, { label: string; background: string; width: number; height: number }> = {
  MAIN: { label: 'Main template', background: '#dfe5ec', width: PICTURE_WIDTH, height: PICTURE_HEIGHT }
}

/** The explicit default objects a new picture inherits from the main template: a grouped title block. */
export function templateElements(template: PictureTemplateName, pictureName: string): Omit<PicElement, 'id'>[] {
  if (template !== 'MAIN') return []
  return [
    { type: 'text', x: 24, y: 14, content: pictureName, fontSize: 22, bold: true, color: '#1d3b5c', fontFamily: 'Segoe UI', group: TITLE_GROUP },
    { type: 'text', x: 24, y: 46, content: 'Process picture', fontSize: 12, color: '#4a5d70', fontFamily: 'Segoe UI', group: TITLE_GROUP }
  ]
}

// --- text and object bounds (DV09-030) -------------------------------------

export function elementBox(el: PicElement): { width: number; height: number } {
  switch (el.type) {
    case 'text': {
      const size = el.fontSize ?? 14
      const lines = (el.content ?? '').split('\n')
      const longest = Math.max(1, ...lines.map(line => line.length))
      return { width: Math.ceil(longest * size * (el.bold ? 0.62 : 0.56)) + 4, height: Math.ceil(lines.length * size * 1.35) }
    }
    case 'button': return { width: 140, height: 30 }
    case 'dynamo': return el.dynamoSet ? dynamoSize(el.dynamoSet) : { width: 120, height: 44 }
    case 'rectangle': return { width: el.width ?? 64, height: el.height ?? 160 }
    case 'pipe': return { width: el.width ?? 120, height: el.height ?? 12 }
    case 'tank': return { width: 160, height: 220 }
    case 'pump':
    case 'valve': return { width: 160, height: 90 }
    default: return { width: 240, height: 26 }
  }
}

/** Text, buttons and course dynamos must stay inside the picture; other legacy objects are only checked for sign. */
export function pictureBoundsError(el: PicElement, picture: Pick<Picture, 'width' | 'height'>): string | null {
  if (el.type !== 'text' && el.type !== 'button' && !(el.type === 'dynamo' && el.dynamoSet)) return null
  const size = pictureSize(picture)
  const box = elementBox(el)
  if (el.x + box.width > size.width || el.y + box.height > size.height) {
    return `${el.type === 'text' ? 'Text' : 'Object'} must stay inside the ${size.width} x ${size.height} picture`
  }
  return null
}

export function textPropertiesError(el: PicElement): string | null {
  if (el.type !== 'text') {
    return el.fontFamily !== undefined || el.italic !== undefined || el.underline !== undefined ?
      'Font family and style apply to text only' : null
  }
  if (el.fontSize !== undefined && (!Number.isFinite(el.fontSize) || el.fontSize < MIN_FONT_SIZE || el.fontSize > MAX_FONT_SIZE)) {
    return `Font size must be ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}`
  }
  if (el.fontFamily !== undefined && !(FONT_FAMILIES as readonly string[]).includes(el.fontFamily)) {
    return `Font family must be one of ${FONT_FAMILIES.join(', ')}`
  }
  if (typeof el.content !== 'string' && el.content !== undefined) return 'Text content must be a string'
  if ([el.color, el.backgroundColor].some(color => color !== undefined && !HEX_COLOR.test(color))) return 'Colors require six-digit hex values'
  return null
}

/** Validation every element passes, dynamic or not: text properties, buttons, bounds. */
export function staticElementError(el: PicElement, picture: Pick<Picture, 'width' | 'height'>): string | null {
  return textPropertiesError(el) ?? buttonError(el) ?? pictureBoundsError(el, picture)
}

// --- datalink layout, error table, refresh and history (DV09-029) -----------

export interface DatalinkLayout { width: number; decimals: number }
export interface DatalinkErrorText { bad?: string; error?: string }

export function layoutError(layout: DatalinkLayout): string | null {
  if (!Number.isInteger(layout.width) || layout.width < 3 || layout.width > 24) return 'Numeric field width must be a whole number from 3 to 24'
  if (!Number.isInteger(layout.decimals) || layout.decimals < 0 || layout.decimals > 6) return 'Decimal places must be a whole number from 0 to 6'
  return null
}

/** Right-aligned fixed-width numeric field; a value that cannot fit shows asterisks, as DeltaV numeric fields do. */
export function formatLayout(value: number, layout: DatalinkLayout): string {
  const text = value.toFixed(layout.decimals)
  return text.length > layout.width ? '*'.repeat(layout.width) : text.padStart(layout.width, ' ')
}

export function errorTextError(table: DatalinkErrorText): string | null {
  for (const key of ['bad', 'error'] as const) {
    const text = table[key]
    if (text !== undefined && (typeof text !== 'string' || text.length === 0 || text.length > 24)) {
      return 'Error table text must be 1 to 24 characters'
    }
  }
  return null
}

export function refreshError(seconds: number): string | null {
  return Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 60 ? null : 'Refresh interval must be 0.1 to 60 seconds'
}

/** Value of a tag `seconds` before the newest trend sample, or undefined when the buffer does not reach back that far. */
export function historicalValue(trend: TrendPoint[], tag: string, seconds: number): number | undefined {
  const last = trend[trend.length - 1]
  if (!last || !(seconds > 0)) return undefined
  const target = last.t - seconds * 1000
  for (let i = trend.length - 1; i >= 0; i--) {
    if (trend[i].t <= target) {
      const value = trend[i].values[tag]
      return Number.isFinite(value) ? value : undefined
    }
  }
  return undefined
}

export function historyError(seconds: number): string | null {
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? null : 'History offset must be more than 0 and at most 3600 seconds'
}

/** Holds a displayed sample until the refresh interval has elapsed (DeltaV datalink Refresh Rate). */
export function refreshedSample<T>(held: { at: number; value: T } | undefined, now: number, seconds: number | undefined,
  current: T): { at: number; value: T } {
  if (!held || seconds === undefined || now - held.at >= seconds * 1000) return { at: now, value: current }
  return held
}

// --- discrete SP_D / PV_D (DV09-029/051) -----------------------------------

export interface DiscretePath { block: 'DC1' | 'DI1' | 'DO1'; role: 'command' | 'feedback' }

export function pictureDiscretePath(path: string | undefined): DiscretePath | null {
  const match = (path ?? '').trim().toUpperCase().match(/^(DC1|DI1|DO1)\/(SP_D|PV_D)(?:\.CV)?$/)
  return match ? { block: match[1] as DiscretePath['block'], role: match[2] === 'SP_D' ? 'command' : 'feedback' } : null
}

export interface PictureDiscreteSignal {
  on: boolean
  text: string
  role: 'command' | 'feedback'
  writable: boolean
  bad: boolean
  labels: [string, string]
}
export type PictureDiscreteResult = PictureDiscreteSignal | { error: string }

export function pictureDiscreteSignal(el: Pick<PicElement, 'tag' | 'path' | 'entry'>, modules: Record<string, AnyModule>): PictureDiscreteResult {
  const m = el.tag ? modules[el.tag] : undefined
  const path = pictureDiscretePath(el.path)
  if (!m) return { error: `Module ${el.tag || '(unassigned)'} does not exist` }
  if (!path) return { error: `Unsupported discrete source ${el.tag}/${el.path ?? ''}` }
  const custom = el.entry?.method === 'DISCRETE' && el.entry.labels ? el.entry.labels : undefined
  let on: boolean
  let bad = false
  let labels: [string, string]
  if (m.type === 'MOTOR' && path.block === 'DC1') {
    on = path.role === 'command' ? m.commanded : m.running
    bad = path.role === 'feedback' && !!(m.ioInputBad || m.ioOutputBad)
    labels = path.role === 'command' ? ['STOP', 'START'] : ['STOPPED', 'RUNNING']
  } else if (m.type === 'VALVE' && path.block === 'DC1') {
    on = path.role === 'command' ? m.commandedOpen : m.open
    bad = path.role === 'feedback' && !!(m.ioInputBad || m.ioOutputBad)
    labels = path.role === 'command' ? ['CLOSE', 'OPEN'] : ['CLOSED', 'OPEN']
  } else if (m.type === 'DO' && path.block === 'DO1') {
    on = path.role === 'command' ? m.commanded : m.state
    bad = path.role === 'feedback' && !!m.ioBad
    labels = [m.inactiveDescriptor, m.activeDescriptor]
  } else if (m.type === 'DI' && path.block === 'DI1' && path.role === 'feedback') {
    on = m.state
    bad = !!m.ioBad || m.mode === 'OOS'
    labels = [m.inactiveDescriptor, m.activeDescriptor]
  } else {
    return { error: `${m.tag} has no ${path.block}/${path.role === 'command' ? 'SP_D' : 'PV_D'}` }
  }
  const shown: [string, string] = path.role === 'command' && custom ? custom : labels
  return { on, text: shown[on ? 1 : 0], role: path.role, writable: path.role === 'command', bad, labels: shown }
}

export function discreteEntryError(el: PicElement, modules: Record<string, AnyModule>): string | null {
  const signal = pictureDiscreteSignal(el, modules)
  if ('error' in signal) return signal.error
  if (el.entry?.method === 'DISCRETE') {
    if (!signal.writable) return 'Discrete entry requires an SP_D command path; PV_D is feedback and read-only'
    const labels = el.entry.labels
    if (labels && (labels.length !== 2 || labels.some(label => typeof label !== 'string' || label.length === 0 || label.length > 20))) {
      return 'Multiple-item labels are two names of 1 to 20 characters'
    }
  }
  return null
}

// --- course dynamo library (DV09-031/051/062) ------------------------------
// Isolated, opt-in custom-picture objects. They never replace the approved plant mechanical symbols.

export type DynamoSetName = 'VALVE17' | 'PUMPS_ANIM' | 'PIPES_ANIM' | 'VALVE_HORIZONTAL_CONTROL_D1'

export interface DynamoSetInfo {
  label: string
  width: number
  height: number
  modules: AnyModule['type'][]
  /** Default [inactive, active] colors; the course's pump example uses white when stopped and yellow when running. */
  defaults: [string, string]
  hint: string
}

export const DYNAMO_SETS: Record<DynamoSetName, DynamoSetInfo> = {
  VALVE17: { label: 'Valve17', width: 72, height: 56, modules: ['VALVE', 'PID'], defaults: ['#ffffff', '#ffe000'], hint: 'On/off valve; follows open feedback (VALVE) or applied output (PID)' },
  PUMPS_ANIM: { label: 'PumpsAnim', width: 72, height: 72, modules: ['MOTOR'], defaults: ['#ffffff', '#ffe000'], hint: 'Pump; impeller turns while the motor feedback is running' },
  PIPES_ANIM: { label: 'PipesAnim', width: 160, height: 16, modules: ['MOTOR', 'VALVE'], defaults: ['#ffffff', '#ffe000'], hint: 'Pipe segment; flow marks move while the motor runs or the valve is open' },
  VALVE_HORIZONTAL_CONTROL_D1: { label: 'ValveHorizontalControlD1', width: 96, height: 64, modules: ['PID', 'AO'], defaults: ['#ffffff', '#ffe000'], hint: 'Horizontal control valve; position bar shows applied OUT' }
}

export function dynamoSize(set: DynamoSetName): { width: number; height: number } {
  const info = DYNAMO_SETS[set]
  return info ? { width: info.width, height: info.height } : { width: 120, height: 44 }
}

export interface DynamoState {
  /** True when the equipment is running/open/flowing according to its feedback. */
  active: boolean
  /** 0-100 position for control valves. */
  position?: number
  bad: boolean
  color: string
}

export function dynamoState(el: PicElement, modules: Record<string, AnyModule>): DynamoState | { error: string } {
  if (!el.dynamoSet || !DYNAMO_SETS[el.dynamoSet]) return { error: 'Unknown dynamo set' }
  const info = DYNAMO_SETS[el.dynamoSet]
  const m = el.tag ? modules[el.tag] : undefined
  if (!m) return { error: `Module ${el.tag || '(unassigned)'} does not exist` }
  if (!info.modules.includes(m.type)) return { error: `${info.label} requires a ${info.modules.join(' or ')} module` }
  const colors = el.dynamoColors ?? { inactive: info.defaults[0], active: info.defaults[1] }
  let active = false
  let position: number | undefined
  let bad = false
  if (m.type === 'MOTOR') { active = m.running; bad = !!(m.ioInputBad || m.ioOutputBad) }
  else if (m.type === 'VALVE') { active = m.open; bad = !!(m.ioInputBad || m.ioOutputBad) }
  else if (m.type === 'PID') { position = m.out; active = m.out > 0; bad = !Number.isFinite(m.out) }
  else if (m.type === 'AO') { position = m.out; active = m.out > 0; bad = m.bad }
  return { active, position, bad, color: bad ? '#b8b8b8' : active ? colors.active : colors.inactive }
}

export function dynamoError(el: PicElement, modules: Record<string, AnyModule>): string | null {
  if (el.dynamoSet === undefined) {
    return el.dynamoColors !== undefined || el.showActiveAlarm !== undefined ? 'Dynamo colors and alarm visibility require a course dynamo set' : null
  }
  if (el.type !== 'dynamo') return 'Course dynamo sets require a dynamo object'
  const state = dynamoState(el, modules)
  if ('error' in state) return state.error
  if (el.dynamoColors && (!HEX_COLOR.test(el.dynamoColors.active) || !HEX_COLOR.test(el.dynamoColors.inactive))) {
    return 'Dynamo colors require six-digit hex values'
  }
  return null
}

// --- navigation button (DV09-031 reverse link) ------------------------------

export function buttonError(el: PicElement): string | null {
  if (el.type !== 'button') return el.target !== undefined ? 'Navigation targets require a button object' : null
  if (typeof el.target !== 'string' || !el.target.trim() || el.target.length > 40) return 'A button needs a target picture name (1 to 40 characters)'
  if (typeof el.content !== 'string' || !el.content.trim()) return 'A button needs a caption'
  return null
}
