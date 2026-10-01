import { create } from 'zustand'

// Workshop step-completion progress, persisted locally so it survives reloads.
const KEY = 'batchlive.workshop.progress'

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}
function save(d: Record<string, boolean>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* ignore quota/availability errors */
  }
}

interface ProgressState {
  done: Record<string, boolean>
  toggle: (id: string) => void
  reset: (ids: string[]) => void
}

export const useProgress = create<ProgressState>((set) => ({
  done: load(),
  toggle: (id) =>
    set((s) => {
      const done = { ...s.done, [id]: !s.done[id] }
      save(done)
      return { done }
    }),
  reset: (ids) =>
    set((s) => {
      const done = { ...s.done }
      ids.forEach((i) => delete done[i])
      save(done)
      return { done }
    })
}))
