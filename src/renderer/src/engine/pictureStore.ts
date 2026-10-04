import { create } from 'zustand'
import { requireUnlockedKey, useSecurity } from './security'
import { useStore } from './store'
import { parseSavedPicture, pictureElementError, pictureLimits, pictureModeSignal, pictureSignal,
  type PictureDynamicPatch } from './pictureDynamics'
import { pictureNamedSignal } from './pictureNamedSets'
import { useFlowColors } from './flowColorStore'
import type { FlowAnimation } from './pictureFlow'

// Operator-display builder model (DV-09 "Creating a New Picture / Datalink / Dynamo / Text").

export type PicParam = 'PV' | 'SP' | 'OUT' | 'MODE' | 'STATE'

export interface PicElement {
  id: string
  type: 'text' | 'datalink' | 'dynamo' | 'rectangle' | 'tank' | 'pipe' | 'pump' | 'valve'
  x: number
  y: number
  // text
  content?: string
  fontSize?: number
  bold?: boolean
  color?: string
  // datalink / dynamo
  tag?: string
  param?: PicParam
  label?: boolean
  path?: string
  flashWhenNotNormal?: boolean
  entry?: { method: 'NUMERIC'; fetchLimits: boolean; low: number; high: number } |
    { method: 'NAMED_SET' } | { method: 'PID_MODE' }
  fill?: { vertical: boolean; fetchLimits: boolean; low: number; high: number }
  width?: number
  height?: number
  backgroundColor?: string
  flowAnimation?: FlowAnimation
}

export interface Picture {
  name: string
  elements: PicElement[]
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
  addElement: (pic: string, el: Omit<PicElement, 'id'>) => string | null
  updateElement: (pic: string, id: string, patch: Partial<PicElement>) => boolean
  removeElement: (pic: string, id: string) => void
  setPictureLinks: (pic: string, previous: string, next: string) => boolean
  configureDynamics: (pic: string, id: string, patch: PictureDynamicPatch) => boolean
  writeNumericValue: (pic: string, id: string, value: number) => boolean
  writeNamedValue: (pic: string, id: string, value: number, expected?: PicElement) => boolean
  writeModeValue: (pic: string, id: string, value: string, expected?: PicElement) => boolean
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
function dynamicElement(el: Pick<PicElement, 'type' | 'path' | 'entry' | 'fill' | 'flowAnimation'>): boolean {
  return el.type === 'rectangle' || el.type === 'tank' || el.path !== undefined ||
    el.entry !== undefined || el.fill !== undefined || el.flowAnimation !== undefined ||
    el.type === 'pipe' || el.type === 'pump' || el.type === 'valve'
}

function missingFlowTable(element: Pick<PicElement, 'flowAnimation'>): string | null {
  return element.flowAnimation && !Object.hasOwn(useFlowColors.getState().tables, element.flowAnimation.table)
    ? `Shared flow table ${element.flowAnimation.table} does not exist; create or load it first` : null
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

  writeNumericValue: (pic, id, value) => {
    if (!useSecurity.getState().requireLock('CONTROL', `Picture numeric entry ${pic}`)) return false
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (element?.entry?.method !== 'NUMERIC' || element.type !== 'datalink') return rejectPicture(pic, 'Datalink has no numeric entry configuration')
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

  writeNamedValue: (pic, id, value, expected) => {
    const element = get().pictures[pic]?.elements.find(e => e.id === id)
    if (!element || element.entry?.method !== 'NAMED_SET') return rejectPicture(pic, 'Datalink has no Named Set data entry configuration')
    if (expected && element !== expected) return rejectPicture(pic, 'Datalink changed while entry was open; reopen data entry')
    const source = pictureNamedSignal(element, useStore.getState())
    if ('error' in source) return rejectPicture(pic, source.error)
    return useStore.getState().writeSfcNamedValue(element.tag ?? '', source.parameter, value)
  },

  writeModeValue: (pic, id, value, expected) => {
    const element = get().pictures[pic]?.elements.find(item => item.id === id)
    if (!element || element.entry?.method !== 'PID_MODE') {
      return rejectPicture(pic, 'Datalink has no Multiple-Item Select mode entry')
    }
    if (expected && element !== expected) return rejectPicture(pic, 'Datalink changed while entry was open; reopen data entry')
    const source = pictureModeSignal(element, useStore.getState().modules)
    if ('error' in source) return rejectPicture(pic, source.error)
    const target = source.choices?.find(choice => choice === value)
    if (!target) return rejectPicture(pic, `Mode ${value} is not an allowed target choice`)
    return useStore.getState().setMode(element.tag ?? '', target)
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
