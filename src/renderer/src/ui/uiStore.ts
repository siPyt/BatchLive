import { create } from 'zustand'

export type DisplayId =
  | 'overview'
  | 'feed'
  | 'reactor'
  | 'product'
  | 'alarms'
  | 'trend'
  | 'explorer'
  | 'studio'
  | 'batch'

export interface OpenFaceplate {
  tag: string
  x: number
  y: number
}

interface UiState {
  display: DisplayId
  faceplates: OpenFaceplate[]
  selectedTag: string | null
  studioTag: string | null
  navigate: (d: DisplayId) => void
  openFaceplate: (tag: string, x?: number, y?: number) => void
  closeFaceplate: (tag: string) => void
  moveFaceplate: (tag: string, x: number, y: number) => void
  select: (tag: string | null) => void
  openStudio: (tag: string) => void
}

let cascade = 0

export const useUi = create<UiState>((set, get) => ({
  display: 'overview',
  faceplates: [],
  selectedTag: null,
  studioTag: null,

  navigate: (display) => set({ display }),

  openFaceplate: (tag, x, y) => {
    const existing = get().faceplates.find((f) => f.tag === tag)
    if (existing) {
      set({ selectedTag: tag })
      return
    }
    const offset = (cascade++ % 6) * 26
    const px = x ?? 120 + offset
    const py = y ?? 110 + offset
    set((s) => ({
      faceplates: [...s.faceplates, { tag, x: px, y: py }],
      selectedTag: tag
    }))
  },

  closeFaceplate: (tag) =>
    set((s) => ({ faceplates: s.faceplates.filter((f) => f.tag !== tag) })),

  moveFaceplate: (tag, x, y) =>
    set((s) => ({
      faceplates: s.faceplates.map((f) => (f.tag === tag ? { ...f, x, y } : f))
    })),

  select: (selectedTag) => set({ selectedTag }),

  openStudio: (tag) => set({ studioTag: tag, selectedTag: tag, display: 'studio' })
}))
