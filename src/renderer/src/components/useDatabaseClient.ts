import { useEffect } from 'react'
import { useSystem } from '../engine/systemPreferences'

/** DV09-108/109: a database application is open while its window is; it stays open until closed in System Preferences. */
export function useDatabaseClient(name: string): void {
  const register = useSystem((s) => s.registerClient)
  useEffect(() => {
    register(name)
  }, [name, register])
}
