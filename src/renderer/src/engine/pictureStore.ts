import { create } from 'zustand'
import { requireUnlockedKey, useSecurity } from './security'
import { useStore } from './store'
import { parseSavedPicture, pictureElementError, pictureLimits, pictureModeSignal, pictureSignal,
  type PictureDynamicPatch } from './pictureDynamics'
import { pictureNamedSignal } from './pictureNamedSets'
import { useFlowColors } from './flowColorStore'
import type { FlowAnimation } from './pictureFlow'
import { PICTURE_TEMPLATES, pictureDiscreteSignal, staticElementError, templateElements,
  type DatalinkErrorText, type DatalinkLayout, type DynamoSetName, type PictureTemplateName } from './pictureObjects'

// Operator-display builder model (DV-09 "Creating a New Picture / Datalink / Dynamo / Text").

export type PicParam = 'PV' | 'SP' | 'OUT' | 'MODE' | 'STATE'

export interface PicElement {
  id: string
  type: 'text' | 'datalink' | 'dynamo' | 'rectangle' | 'tank' | 'pipe' | 'pump' | 'valve' | 'button'
  x: number
  y: number
  // text
  content?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontFamily?: string
  color?: string
  /** Objects created together by a picture template share a group (the main template's TITLE block). */
  group?: string
  // datalink / dynamo
  tag?: string
  param?: PicParam
  label?: boolean
  path?: string
  flashWhenNotNormal?: boolean
  /** DV09-046: hide this ALARMS[1].A_LAALM datalink when Normal; show it with
   * distinct Active/RTN text otherwise (highestRankedAlarmState). */
  alarmVisibility?: boolean
  entry?: ({ method: 'NUMERIC'; fetchLimits: boolean; low: number; high: number } |
    { method: 'NAMED_SET' } | { method: 'PID_MODE' } | { method: 'RAMP'; rate: number } |
    { method: 'DISCRETE'; labels?: [string, string] }) & {
    /** In-place entry asks the operator to confirm the change before it is written. */
    confirm?: boolean }
  /** DV09-029 numeric field layout, error table, refresh rate and history offset. */
  layout?: DatalinkLayout
  errorText?: DatalinkErrorText
  refreshSeconds?: number
  historySeconds?: number
  /** DV09-031/051/062 isolated course dynamo library (Valve17, PumpsAnim, PipesAnim, ValveHorizontalControlD1). */
  dynamoSet?: DynamoSetName
  dynamoColors?: { inactive: string; active: string }
  showActiveAlarm?: boolean
  /** Navigation button target: a picture name, Ovw_ref.grf (Overview) or alarmList.grf. */
  target?: string
  fill?: { vertical: boolean; fetchLimits: boolean; low: number; high: number }
  width?: number
  height?: number
  backgroundColor?: string
  flowAnimation?: FlowAnimation
  actuatorFlowAnimation?: FlowAnimation
}

export interface Picture {
  name: string
  elements: PicElement[]
  /** DV09-027 picture template, background color and size (default 1000 x 640). */
  template?: PictureTemplateName
  background?: string
  width?: number
  height?: number
  previousPicture?: string
  nextPicture?: string
}

export type PictureTarget = { kind: 'display'; display: 'overview' | 'alarms' } | { kind: 'picture'; name: string }

export function resolvePictureTarget(name: string, pictures: Record<string, Picture>): PictureTarget | null {
  const full = name.trim().toUpperCase()
  const key = full.replace(/\.GRF$/, '')
  if (key === 'OVW_REF') return { kind: 'display', display: 'overview' }
  if (key === 'ALARMLIST') return { kind: 'display', display: 'alarms' }
  const picture = pictures[full] ?? pictures[key]
  return picture ? { kind: 'picture', name: picture.name } : null
}

interface PictureState {
  pictures: Record<string, Picture>
  createPicture: (name: string) => void
  deletePicture: (name: string) => void
  createPictureFromTemplate: (name: string, template: PictureTemplateName) => boolean
  setPictureBackground: (pic: string, color: string) => boolean
  removeElementGroup: (pic: string, group: string) => number
  addElement: (pic: string, el: Omit<PicElement, 'id'>) => string | null
  updateElement: (pic: string, id: string, patch: Partial<PicElement>) => boolean
  removeElement: (pic: string, id: string) => void
  setPictureLinks: (pic: string, previous: string, next: string) => boolean
  configureDynamics: (pic: string, id: string, patch: PictureDynamicPatch) => boolean
  writeNumericValue: (pic: string, id: string, value: number, confirmed?: boolean) => boolean
  writeNamedValue: (pic: string, id: string, value: number, expected?: PicElement, confirmed?: boolean) => boolean
  writeModeValue: (pic: string, id: string, value: string, expected?: PicElement, confirmed?: boolean) => boolean
  rampOutput: (pic: string, id: string, direction: 1 | -1, seconds: number, expected?: PicElement, confirmed?: boolean) => boolean
  writeDiscreteValue: (pic: string, id: string, on: boolean, expected?: PicElement, confirmed?: boolean) => boolean
  savePicture: (pic: string) => boolean
  loadPicture: (pic: string) => boolean
  assignModuleDisplays: (tag: string, primary: string, detail: string) => boolean
}

export const pictureStorageKey = (name: string): string => `batchlive.picture.v1.${name}`
function rejectPicture(pic: string, message: string): false {
  useStore.getState().logEvent('DIAGNOSTIC', pic, message)
  window.alert(message)
  return false
}
function confirmationError(el: PicElement, confirmed: boolean | undefined): string | null {
  return el.entry?.confirm && confirmed !== true ? 'This data entry requires confirmation before it is written' : null
}

function dynamicElement(el: Pick<PicElement, 'type' | 'path' | 'entry' | 'fill' | 'flowAnimation' | 'actuatorFlowAnimation' | 'dynamoSet' | 'dynamoColors' | 'showActiveAlarm' | 'layout' | 'errorText' | 'refreshSeconds' | 'historySeconds'>): boolean {
  return el.type === 'rectangle' || el.dynamoSet !== undefined || el.dynamoColors !== undefined || el.showActiveAlarm !== undefined ||
    el.layout !== undefined || el.errorText !== undefined || el.refreshSeconds !== undefined || el.historySeconds !== undefined || el.type === 'tank' || el.path !== undefined ||
    el.entry !== undefined || el.fill !== undefined || el.flowAnimation !== undefined || el.actuatorFlowAnimation !== undefined ||
    el.type === 'pipe' || el.type === 'pump' || el.type === 'valve'
}

function missingFlowTable(element: Pick<PicElement, 'flowAnimation' | 'actuatorFlowAnimation'>): string | null {
  const missing = [element.flowAnimation, element.actuatorFlowAnimation].find(animation =>
    animation && !Object.hasOwn(useFlowColors.getState().tables, animation.table))
  return missing ? `Shared flow table ${missing.table} does not exist; create or load it first` : null
}

let seq = 0
const uid = (): string => `E${Date.now().toString(36)}${seq++}`

export const usePictures = create<PictureState>((set, get) => ({
  pictures: {
    TANK101: {
      name: 'TANK101',
      elements: [
        { id: uid(), type: 'text', x: 24, y: 20, content: 'TANK 101 — FEED SYSTEM', fontSize: 16, bold: true },
        { id: uid(), type: 'datalink', x: 24, y: 70, tag: 'LIC-101', param: 'PV', label: true },
        { id: uid(), type: 'datalink', x: 24, y: 100, tag: 'FIC-101', param: 'PV', label: true },
        { id: uid(), type: 'dynamo', x: 24, y: 140, tag: 'P-101' }
      ]
    }
  },

  createPicture: (name) =>
    set((s) => {
      const key = name.trim().toUpperCase()
      if (!key || s.pictures[key]) return {}
      return { pictures: { ...s.pictures, [key]: { name: key, elements: [] } } }
    }),

  createPictureFromTemplate: (name, template) => {
    const key = name.trim().toUpperCase()
    const info = PICTURE_TEMPLATES[template]
    if (!key) return rejectPicture(name, 'Picture name is required')
    if (!info) return rejectPicture(key, 'Unknown picture template')
    if (get().pictures[key]) return rejectPicture(key, 'A picture with this name already exists')
    const elements = templateElements(template, key).map(el => ({ ...el, id: uid() }))
    set(s => ({ pictures: { ...s.pictures, [key]: { name: key, template, background: info.background,
      width: info.width, height: info.height, elements } } }))
    useStore.getState().logEvent('CONFIGURE', key, `Picture created from the ${info.label}`)
    return true
  },

  setPictureBackground: (pic, color) => {
    if (!requireUnlockedKey('CAN_CONFIGURE', `Change picture background ${pic}`)) return false
    if (!get().pictures[pic]) return rejectPicture(pic, 'Picture does not exist')
    if (!/^#[0-9a-f]{6}$/i.test(color)) return rejectPicture(pic, 'Background requires a six-digit hex color')
    set(s => ({ pictures: { ...s.pictures, [pic]: { ...s.pictures[pic], background: color } } }))
    useStore.getState().logEvent('CONFIGURE', pic, `Picture background set to ${color}`)
    return true
  },

  removeElementGroup: (pic, group) => {
    if (!requireUnlockedKey('CAN_CONFIGURE', `Remove picture objects ${pic}`)) return 0
    const picture = get().pictures[pic]
    if (!picture) { rejectPicture(pic, 'Picture does not exist'); return 0 }
    const doomed = picture.elements.filter(element => element.group === group)
    if (!doomed.length) return 0
    set(s => ({ pictures: { ...s.pictures, [pic]: { ...picture, elements: picture.elements.filter(element => element.group !== group) } } }))
    useStore.getState().logEvent('CONFIGURE', pic, `Removed ${doomed.length} ${group} object(s)`)
    return doomed.length
  },

  deletePicture: (name) =>
    set((s) => {
      if (!s.pictures[name]) return {}
      if (s.pictures[name].elements.some(dynamicElement) &&
          !requireUnlockedKey('CAN_CONFIGURE', `Delete dynamic picture ${name}`)) return {}
      const pictures = { ...s.pictures }
      delete pictures[name]
      return { pictures }
    }),

  addElement: (pic, el) => {
    if (!get().pictures[pic]) { rejectPicture(pic, 'Picture does not exist'); return null }
    const staticError = staticElementError({ ...el, id: '' }, get().pictures[pic])
    if (staticError) { rejectPicture(pic, staticError); return null }
    if (dynamicElement(el)) {
      if (!requireUnlockedKey('CAN_CONFIGURE', `Create dynamic picture element ${pic}`)) return null
      const error = missingFlowTable(el) ?? pictureElementError({ ...el, id: '' }, useStore.getState().modules, useStore.getState())
      if (error) { rejectPicture(pic, error); return null }
    }
    const id = uid()
    set((s) => {
      const p = s.pictures[pic]
      if (!p) return {}
      return { pictures: { ...s.pictures, [pic]: { ...p, elements: [...p.elements, { ...el, id }] } } }
    })
    return id
  },

  updateElement: (pic, id, patch) => {
    const p = get().pictures[pic]
    const element = p?.elements.find(e => e.id === id)
    if (!element) return rejectPicture(pic, 'Picture element does not exist')
    const candidate = { ...element, ...patch }
    const staticError = staticElementError(candidate, p)
    if (staticError) return rejectPicture(pic, staticError)
    if (dynamicElement(element) || dynamicElement(candidate)) {
      if (!requireUnlockedKey('CAN_CONFIGURE', `Edit dynamic picture element ${pic}`)) return false
      const error = missingFlowTable(candidate) ?? pictureElementError(candidate, useStore.getState().modules, useStore.getState())
      if (error) return rejectPicture(pic, error)
    }
    set(s => ({ pictures: { ...s.pictures, [pic]: {
      ...p, elements: p.elements.map(e => e.id === id ? candidate : e)
    } } }))
    return true
  },

  removeElement: (pic, id) => {
    const el = get().pictures[pic]?.elements.find(e => e.id === id)
    if (el && dynamicElement(el) &&
        !requireUnlockedKey('CAN_CONFIGURE', `Remove dynamic picture element ${pic}`)) return
    set((s) => {
      const p = s.pictures[pic]
      if (!p) return {}
      return { pictures: { ...s.pictures, [pic]: { ...p, elements: p.elements.filter((e) => e.id !== id) } } }
    })
  },

  configureDynamics: (pic, id, patch) => {
    if (!requireUnlockedKey('CAN_CONFIGURE', `Configure picture dynamics ${pic}`)) return false
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (!element) return rejectPicture(pic, 'Picture element does not exist')
    const candidate = { ...element, ...patch }
    const error = missingFlowTable(candidate) ?? pictureElementError(candidate, useStore.getState().modules, useStore.getState())
    if (error) return rejectPicture(pic, error)
    if (!get().updateElement(pic, id, patch)) return false
    useStore.getState().logEvent('CONFIGURE', pic, `Dynamics configured for ${id}`)
    return true
  },

  writeNumericValue: (pic, id, value, confirmed) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Picture numeric entry ${pic}`)) return false
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (element?.entry?.method !== 'NUMERIC' || element.type !== 'datalink') return rejectPicture(pic, 'Datalink has no numeric entry configuration')
    const unconfirmed = confirmationError(element, confirmed)
    if (unconfirmed) return rejectPicture(pic, unconfirmed)
    const source = pictureSignal(element, useStore.getState().modules)
    if ('error' in source) return rejectPicture(pic, source.error)
    if (!source.parameter || !element.tag) return rejectPicture(pic, 'This source is read-only')
    const limits = pictureLimits(element.entry, source)
    if ('error' in limits) return rejectPicture(pic, limits.error)
    if (!Number.isFinite(value) || value < limits.low || value > limits.high) {
      return rejectPicture(pic, `Numeric entry requires a finite value from ${limits.low} to ${limits.high}`)
    }
    if (source.parameter === 'PID1/SP') return useStore.getState().setSetpoint(element.tag, value)
    return useStore.getState().setAoParameter(element.tag, source.parameter, value)
  },

  writeNamedValue: (pic, id, value, expected, confirmed) => {
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (!element || element.entry?.method !== 'NAMED_SET') return rejectPicture(pic, 'Datalink has no Named Set data entry configuration')
    const unconfirmed = confirmationError(element, confirmed)
    if (unconfirmed) return rejectPicture(pic, unconfirmed)
    if (expected && element !== expected) return rejectPicture(pic, 'Datalink changed while entry was open; reopen data entry')
    const source = pictureNamedSignal(element, useStore.getState())
    if ('error' in source) return rejectPicture(pic, source.error)
    return useStore.getState().writeSfcNamedValue(element.tag ?? '', source.parameter, value)
  },

  writeModeValue: (pic, id, value, expected, confirmed) => {
    const element = get().pictures[pic]?.elements.find(item => item.id === id)
    if (!element || element.entry?.method !== 'PID_MODE') {
      return rejectPicture(pic, 'Datalink has no Multiple-Item Select mode entry')
    }
    const unconfirmed = confirmationError(element, confirmed)
    if (unconfirmed) return rejectPicture(pic, unconfirmed)
    if (expected && element !== expected) return rejectPicture(pic, 'Datalink changed while entry was open; reopen data entry')
    const source = pictureModeSignal(element, useStore.getState().modules)
    if ('error' in source) return rejectPicture(pic, source.error)
    const target = source.choices?.find(choice => choice === value)
    if (!target) return rejectPicture(pic, `Mode ${value} is not an allowed target choice`)
    return useStore.getState().setMode(element.tag ?? '', target)
  },

  rampOutput: (pic, id, direction, seconds, expected, confirmed) => {
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (!element || element.entry?.method !== 'RAMP' || element.type !== 'datalink' || !element.tag) {
      return rejectPicture(pic, 'Datalink has no OUT ramp entry configuration')
    }
    const unconfirmed = confirmationError(element, confirmed)
    if (unconfirmed) return rejectPicture(pic, unconfirmed)
    if (expected && element !== expected) return rejectPicture(pic, 'Datalink changed while entry was open; reopen data entry')
    if (![1, -1].includes(direction) || !Number.isFinite(seconds) || seconds <= 0) {
      return rejectPicture(pic, 'OUT ramp requires a Raise/Lower direction and a positive held duration')
    }
    const module = useStore.getState().modules[element.tag]
    if (module?.type !== 'PID') return rejectPicture(pic, 'OUT ramp entry requires a PID module')
    const next = module.out + direction * element.entry.rate * seconds
    return useStore.getState().setOutput(element.tag, Math.max(0, Math.min(100, next)))
  },

  writeDiscreteValue: (pic, id, on, expected, confirmed) => {
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (!element || element.entry?.method !== 'DISCRETE' || element.type !== 'datalink' || !element.tag) {
      return rejectPicture(pic, 'Datalink has no discrete SP_D entry configuration')
    }
    if (expected && element !== expected) return rejectPicture(pic, 'Datalink changed while entry was open; reopen data entry')
    const unconfirmed = confirmationError(element, confirmed)
    if (unconfirmed) return rejectPicture(pic, unconfirmed)
    const before = pictureDiscreteSignal(element, useStore.getState().modules)
    if ('error' in before) return rejectPicture(pic, before.error)
    if (!before.writable) return rejectPicture(pic, 'PV_D is feedback and cannot be written')
    const tag = element.tag
    const module = useStore.getState().modules[tag]
    const store = useStore.getState()
    if (module.type === 'MOTOR') { if (on) store.startMotor(tag); else store.stopMotor(tag) }
    else if (module.type === 'VALVE') { if (on) store.openValve(tag); else store.closeValve(tag) }
    else if (module.type === 'DO' && module.commanded !== on) store.toggleDO(tag)
    const after = pictureDiscreteSignal(element, useStore.getState().modules)
    return !('error' in after) && after.on === on
  },

  savePicture: (pic) => {
    if (!requireUnlockedKey('CAN_CONFIGURE', `Save picture ${pic}`)) return false
    const picture = get().pictures[pic]
    if (!picture) return rejectPicture(pic, 'Picture does not exist')
    try {
      const text = JSON.stringify({ version: 1, picture })
      parseSavedPicture(text, pic, useStore.getState().modules, useStore.getState())
      for (const element of picture.elements) {
        const error = missingFlowTable(element)
        if (error) throw new Error(error)
      }
      window.localStorage.setItem(pictureStorageKey(pic), text)
    } catch (error) {
      return rejectPicture(pic, `Picture Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    useStore.getState().logEvent('CONFIGURE', pic, 'Picture saved to local browser database; not a native .grf file')
    return true
  },

  loadPicture: (pic) => {
    if (!requireUnlockedKey('CAN_CONFIGURE', `Load picture ${pic}`)) return false
    let picture: Picture
    try {
      const text = window.localStorage.getItem(pictureStorageKey(pic))
      if (text === null) return rejectPicture(pic, 'No saved picture exists in this browser profile')
      picture = parseSavedPicture(text, pic, useStore.getState().modules, useStore.getState())
      for (const element of picture.elements) {
        const error = missingFlowTable(element)
        if (error) throw new Error(error)
      }
    } catch (error) {
      return rejectPicture(pic, `Picture Load failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    set(s => ({ pictures: { ...s.pictures, [pic]: picture } }))
    useStore.getState().logEvent('CONFIGURE', pic, 'Picture loaded from local browser database')
    return true
  },

  assignModuleDisplays: (tag, primary, detail) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Assign module displays ${tag}`)) return false
    const module = useStore.getState().modules[tag]
    const values = [primary.trim(), detail.trim()]
    if (!module) return rejectPicture(tag, 'Module does not exist')
    for (const name of values) {
      if (name && !resolvePictureTarget(name, get().pictures)) return rejectPicture(tag, `Picture not found: ${name}`)
    }
    useStore.setState(s => ({ modules: { ...s.modules, [tag]: { ...module,
      primaryDisplay: values[0] || undefined, detailDisplay: values[1] || undefined } }, rev: s.rev + 1 }))
    useStore.getState().logEvent('CONFIGURE', tag,
      `Module displays: Primary=${values[0] || '(none)'}, Detail=${values[1] || '(none)'}; project metadata, not a controller transfer`)
    return true
  },

  setPictureLinks: (pic, previous, next) => {
    if (!useSecurity.getState().requireLock('CAN_CONFIGURE', `Configure picture navigation ${pic}`)) return false
    const pictures = get().pictures
    const links = [previous.trim(), next.trim()]
    const missing = links.filter(name => name && !resolvePictureTarget(name, pictures))
    const error = !pictures[pic] ? `Picture ${pic} does not exist` :
      missing.length ? `Navigation picture not found: ${missing.join(', ')}` : null
    if (error) {
      useStore.getState().logEvent('DIAGNOSTIC', pic, `Picture navigation rejected: ${error}`)
      window.alert(error)
      return false
    }
    set(s => ({ pictures: { ...s.pictures, [pic]: {
      ...s.pictures[pic], previousPicture: links[0], nextPicture: links[1]
    } } }))
    useStore.getState().logEvent('CONFIGURE', pic, `Picture navigation: Previous=${links[0] || '(none)'}, Next=${links[1] || '(none)'}`)
    return true
  }
}))
