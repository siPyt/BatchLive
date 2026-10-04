import { create } from 'zustand'
import { useStore } from '../engine/store'
import { resolvePictureTarget, usePictures } from '../engine/pictureStore'

export type DisplayId =
  | 'overview'
  | 'feed'
  | 'reactor'
  | 'product'
  | 'alarms'
  | 'trend'
  | 'journal'
  | 'explorer'
  | 'studio'
  | 'batch'
  | 'sfc'
  | 'builder'
  | 'workshops'
  | 'users'
  | 'hardware'
  | 'wfi'
  | 'autoclave'
  | 'lyo'
  | 'cip'
  | 'tcu'

export interface OpenFaceplate {
  tag: string
  x: number
  y: number
}

interface UiState {
  display: DisplayId
  history: DisplayId[]
  histIndex: number
  pictureHistory: (string | null)[]
  builderPicture: string | null
  builderRun: boolean
  faceplates: OpenFaceplate[]
  pidDetailTag: string | null
  closePidDetail: () => void
  selectedTag: string | null
  studioTag: string | null
  sfcName: string | null
  /** FBD canvas node positions, keyed by module tag (Control Studio drag-and-drop layout). */
  studioLayout: Record<string, { x: number; y: number }>
  setStudioLayout: (tag: string, x: number, y: number) => void
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
  openSfc: (name: string) => boolean
  /** Close every open faceplate and return to Overview — used when switching projects. */
  resetToOverview: () => void
  /** Faceplate "Explorer" link: jump to DeltaV Explorer with this module selected. */
  focusExplorer: (tag: string) => void
  /** Faceplate "Trend" link: jump to the Historian Trend with this tag's pen isolated. */
  focusTrend: (tag: string) => void
  /** Faceplate "Alarms" link: jump to the Alarm List filtered to this tag. */
  focusAlarms: (tag: string) => void
  clearTrendFocus: () => void
  clearAlarmFocus: () => void
  openPicture: (name: string) => boolean
  openModuleDisplay: (tag: string, kind: 'primary' | 'detail') => boolean
}

let cascade = 0

export const useUi = create<UiState>((set, get) => ({
  display: 'overview',
  history: ['overview'],
  histIndex: 0,
  pictureHistory: [null],
  builderPicture: null,
  builderRun: false,
  faceplates: [],
  pidDetailTag: null,
  closePidDetail: () => set({ pidDetailTag: null }),
  selectedTag: null,
  studioTag: null,
  sfcName: null,
  studioLayout: {},
  setStudioLayout: (tag, x, y) => set((s) => ({ studioLayout: { ...s.studioLayout, [tag]: { x, y } } })),
  trendFocusTag: null,
  alarmFocusTag: null,

  navigate: (display) =>
    set((s) => {
      if (display === s.display) return {}
      const history = s.history.slice(0, s.histIndex + 1)
      history.push(display)
      const pictureHistory = s.pictureHistory.slice(0, s.histIndex + 1).concat(null)
      return { display, history, pictureHistory, histIndex: history.length - 1,
        ...(display === 'builder' ? { builderPicture: null, builderRun: false } : {}) }
    }),

  back: () =>
    set((s) => (s.histIndex > 0 ? { histIndex: s.histIndex - 1, display: s.history[s.histIndex - 1],
      builderPicture: s.pictureHistory[s.histIndex - 1] ?? null, builderRun: !!s.pictureHistory[s.histIndex - 1] } : {})),

  forward: () =>
    set((s) =>
      s.histIndex < s.history.length - 1
        ? { histIndex: s.histIndex + 1, display: s.history[s.histIndex + 1],
          builderPicture: s.pictureHistory[s.histIndex + 1] ?? null, builderRun: !!s.pictureHistory[s.histIndex + 1] }
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
      const pictureHistory = s.display === 'studio' ? s.pictureHistory : s.pictureHistory.slice(0, s.histIndex + 1).concat(null)
      return {
        studioTag: tag,
        selectedTag: tag,
        display: 'studio',
        history,
        pictureHistory,
        histIndex: history.length - 1
      }
    }),

  openSfc: name => {
    const key = name.trim().toUpperCase()
    if (!useStore.getState().sfcs[key]) {
      const message = `SFC not found: ${key || '(unassigned)'}`
      useStore.getState().logEvent('DIAGNOSTIC', key, message)
      window.alert(message)
      return false
    }
    set({ sfcName: key, selectedTag: key })
    get().navigate('sfc')
    return true
  },

  resetToOverview: () =>
    set({
      faceplates: [],
      pidDetailTag: null,
      selectedTag: null,
      studioTag: null,
      sfcName: null,
      display: 'overview',
      history: ['overview'],
      histIndex: 0,
      pictureHistory: [null], builderPicture: null, builderRun: false
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
  clearAlarmFocus: () => set({ alarmFocusTag: null }),

  openPicture: (name) => {
    const target = resolvePictureTarget(name, usePictures.getState().pictures)
    if (!target) {
      const message = `Picture not found: ${name || '(unassigned)'}`
      useStore.getState().logEvent('DIAGNOSTIC', name, message)
      window.alert(message)
      return false
    }
    if (target.kind === 'display') get().navigate(target.display)
    else set(s => {
      if (s.display === 'builder' && s.builderPicture === target.name && s.builderRun) return {}
      const history = s.history.slice(0, s.histIndex + 1).concat('builder')
      const pictureHistory = s.pictureHistory.slice(0, s.histIndex + 1).concat(target.name)
      return { display: 'builder', builderPicture: target.name, builderRun: true,
        history, pictureHistory, histIndex: history.length - 1 }
    })
    return true
  },

  openModuleDisplay: (tag, kind) => {
    const m = useStore.getState().modules[tag]
    const name = kind === 'primary' ? m?.primaryDisplay : m?.detailDisplay
    if (kind === 'detail' && m?.type === 'PID' && !name) {
      set({ pidDetailTag: tag })
      return true
    }
    if (!m || !name) {
      const message = !m ? `Module ${tag} does not exist` : `${tag} has no assigned ${kind} display`
      useStore.getState().logEvent('DIAGNOSTIC', tag, message)
      window.alert(message)
      return false
    }
    return get().openPicture(name)
  }
}))
