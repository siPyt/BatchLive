import { contextBridge } from 'electron'

// Minimal, safe API surface exposed to the renderer.
const api = {
  platform: process.platform,
  version: '1.0.0'
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('deltav', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when context isolation is off)
  window.deltav = api
}
