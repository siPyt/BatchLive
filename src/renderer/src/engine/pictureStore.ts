import { create } from 'zustand'

// Operator-display builder model (DV-09 "Creating a New Picture / Datalink / Dynamo / Text").

export type PicParam = 'PV' | 'SP' | 'OUT' | 'MODE' | 'STATE'

export interface PicElement {
  id: string
  type: 'text' | 'datalink' | 'dynamo'
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
}

export interface Picture {
  name: string
  elements: PicElement[]
}

interface PictureState {
  pictures: Record<string, Picture>
  createPicture: (name: string) => void
  deletePicture: (name: string) => void
  addElement: (pic: string, el: Omit<PicElement, 'id'>) => string
  updateElement: (pic: string, id: string, patch: Partial<PicElement>) => void
  removeElement: (pic: string, id: string) => void
}

let seq = 0
const uid = (): string => `E${Date.now().toString(36)}${seq++}`

export const usePictures = create<PictureState>((set) => ({
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
      const pictures = { ...s.pictures }
      delete pictures[name]
      return { pictures }
    }),

  addElement: (pic, el) => {
    const id = uid()
    set((s) => {
      const p = s.pictures[pic]
      if (!p) return {}
      return { pictures: { ...s.pictures, [pic]: { ...p, elements: [...p.elements, { ...el, id }] } } }
    })
    return id
  },

  updateElement: (pic, id, patch) =>
    set((s) => {
      const p = s.pictures[pic]
      if (!p) return {}
      return {
        pictures: {
          ...s.pictures,
          [pic]: { ...p, elements: p.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
        }
      }
    }),

  removeElement: (pic, id) =>
    set((s) => {
      const p = s.pictures[pic]
      if (!p) return {}
      return { pictures: { ...s.pictures, [pic]: { ...p, elements: p.elements.filter((e) => e.id !== id) } } }
    })
}))
