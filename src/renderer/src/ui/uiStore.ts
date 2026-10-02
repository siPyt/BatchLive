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
  | 'sfc'
  | 'builder'
  | 'workshops'
  | 'users'
  | 'hardware'

export interface OpenFaceplate {
  tag: string
  x: number
  y: number
}

interface UiState {
  display: DisplayId
  history: DisplayId[]
  histIndex: number
  faceplates: OpenFaceplate[]
  selectedTag: string | null
  studioTag: string | null
  /** Pen to isolate when the Trend display next mounts/updates; consumed then cleared. */
  trendFocusTag: string | null
  /** Module tag to filter the Alarm List to; consumed then cleared. */
  alarmFocusTag: string | null
  navigate: (d: DisplayId) => void
  back: () => void
  forward: () => void
  openFaceplate: (tag: string, x?: number, y?: number) => void
  closeFaceplate: (tag: string) => void
  moveFaceplate: (tag: string, x: number, y: number) => void
  select: (tag: string | null) => void
  openStudio: (tag: string) => void
  /** Faceplate "Explorer" link: jump to DeltaV Explorer with this module selected. */
  focusExplorer: (tag: string) => void
  /** Faceplate "Trend" link: jump to the Historian Trend with this tag's pen isolated. */
  focusTrend: (tag: string) => void
  /** Faceplate "Alarms" link: jump to the Alarm List filtered to this tag. */
  focusAlarms: (tag: string) => void
  clearTrendFocus: () => void
  clearAlarmFocus: () => void
}

let cascade = 0

export const useUi = create<UiState>((set, get) => ({
  display: 'overview',
  history: ['overview'],
  histIndex: 0,
  faceplates: [],
  selectedTag: null,
  studioTag: null,
  trendFocusTag: null,
  alarmFocusTag: null,

  navigate: (display) =>
    set((s) => {
      if (display === s.display) return {}
      const history = s.history.slice(0, s.histIndex + 1)
      history.push(display)
      return { display, history, histIndex: history.length - 1 }
    }),

  back: () =>
    set((s) => (s.histIndex > 0 ? { histIndex: s.histIndex - 1, display: s.history[s.histIndex - 1] } : {})),

  forward: () =>
    set((s) =>
      s.histIndex < s.history.length - 1
        ? { histIndex: s.histIndex + 1, display: s.history[s.histIndex + 1] }
        : {}
    ),

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

  openStudio: (tag) =>
    set((s) => {
      const history = s.display === 'studio' ? s.history : s.history.slice(0, s.histIndex + 1).concat('studio')
      return {
        studioTag: tag,
        selectedTag: tag,
        display: 'studio',
        history,
        histIndex: history.length - 1
      }
    }),

  focusExplorer: (tag) => {
    set({ selectedTag: tag })
    get().navigate('explorer')
  },

  focusTrend: (tag) => {
    set({ trendFocusTag: tag })
    get().navigate('trend')
  },

  focusAlarms: (tag) => {
    set({ alarmFocusTag: tag })
    get().navigate('alarms')
  },

  clearTrendFocus: () => set({ trendFocusTag: null }),
  clearAlarmFocus: () => set({ alarmFocusTag: null })
}))
