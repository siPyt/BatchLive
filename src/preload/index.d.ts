export interface DeltaVApi {
  platform: string
  version: string
}

declare global {
  interface Window {
    deltav: DeltaVApi
  }
}

export {}
