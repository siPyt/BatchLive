import { create } from 'zustand'
import { requireUnlockedKey } from './security'
import { useStore } from './store'
import { flowTableError, parseFlowTables, type FlowColorTable } from './pictureFlow'

export const flowTablesStorageKey = 'batchlive.flow-color-tables.v1'

interface FlowColorState {
  tables: Record<string, FlowColorTable>
  applyTable: (table: FlowColorTable) => boolean
  saveTables: () => boolean
  loadTables: () => boolean
}

function reject(message: string): false {
  useStore.getState().logEvent('DIAGNOSTIC', 'PICTURE_FLOW', message)
  window.alert(message)
  return false
}

export const useFlowColors = create<FlowColorState>((set, get) => ({
  tables: {},
  applyTable: table => {
    if (!requireUnlockedKey('CAN_CONFIGURE', 'Configure shared flow color table')) return false
    const error = flowTableError(table)
    if (error) return reject(error)
    set(state => ({ tables: { ...state.tables, [table.name]: { ...table } } }))
    useStore.getState().logEvent('CONFIGURE', table.name, 'Shared picture flow colors applied to all linked custom-picture objects')
    return true
  },
  saveTables: () => {
    if (!requireUnlockedKey('CAN_CONFIGURE', 'Save shared flow color tables')) return false
    try {
      const text = JSON.stringify({ version: 1, tables: Object.values(get().tables) })
      parseFlowTables(text)
      window.localStorage.setItem(flowTablesStorageKey, text)
    } catch (error) {
      return reject(`Flow table Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    useStore.getState().logEvent('CONFIGURE', 'PICTURE_FLOW', 'Shared flow tables saved to this browser profile')
    return true
  },
  loadTables: () => {
    if (!requireUnlockedKey('CAN_CONFIGURE', 'Load shared flow color tables')) return false
    let tables: Record<string, FlowColorTable>
    try {
      const text = window.localStorage.getItem(flowTablesStorageKey)
      if (text === null) return reject('No saved shared flow tables exist in this browser profile')
      tables = parseFlowTables(text)
    } catch (error) {
      return reject(`Flow table Load failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    set({ tables })
    useStore.getState().logEvent('CONFIGURE', 'PICTURE_FLOW', 'Shared flow tables loaded; linked custom-picture colors updated')
    return true
  }
}))
