import type { AnyModule, PlantState } from './types'
import { makeModule } from './plant'
import { appliedPidOutput, createPidIo } from './analogStrategy'
import { pidExecutionBad, pidTargetAllowed } from './pidModes'

export type PhotoTankId = 'n3' | 'n1' | 'n1bp'
export type SanitationStage = 'IDLE' | 'HEATING' | 'SOAK' | 'COOLING' | 'ABORTED'
export interface PhotoTankState {
  liters: number
  temperature: number
  pressure: number
  conductivity: number
  toc: number
  flow: number
  sanitation: SanitationStage
  soakSeconds: number
}
export interface PhotoPlantState {
  tanks: Record<PhotoTankId, PhotoTankState>
  still: { feedLiters: number; distillateLiters: number; temperature: number; production: number; oilPressure: number }
  utilities: {
    steamPressure: number
    coolingAvailability: number
    legacyWfiLiters: number
    legacyConductivity: number
    legacyToc: number
    legacyTemperature: number
    cipFlow: Record<string, number>
  }
}
export const PHOTO_TANKS: { id: PhotoTankId; title: string; prefix: string }[] = [
  { id: 'n3', title: 'N3 WFI Tank and Loop', prefix: '3T-8130' },
  { id: 'n1', title: 'N1 WFI Tank and Loop', prefix: '3T-8120' },
  { id: 'n1bp', title: 'N1BP WFI Tank and Loop', prefix: '3T-8140' }
]
export const PHOTO_AREA = 'PHOTO_WFI'
export const STILL = '3WFI-8110'
export const TANK_CAPACITY = 7000
export const STILL_FEED_CAPACITY = 1000
export const STILL_DISTILLATE_CAPACITY = 500
export const STEAM_USERS = new Set(['TIC-201', 'TIC-401', 'TIC-411', 'TIC-501', 'TIC-511',
  'PIC-501', 'PIC-511', 'TIC-701', 'TIC-711', 'TIC-721'])
export const COOLING_USERS: Record<string, string> = {
  'TIC-601': 'P-811', 'TIC-611': 'P-821',
  'TIC-801': 'P-801', 'FIC-801': 'P-801',
  'TIC-811': 'P-811', 'FIC-811': 'P-811',
  'TIC-821': 'P-821', 'FIC-821': 'P-821'
}
export const CIP_SUPPLIES = [
  { flow: 'FIC-701', pump: 'P-701', valve: 'XV-701' },
  { flow: 'FIC-711', pump: 'P-711', valve: 'XV-711' },
  { flow: 'FIC-721', pump: 'P-721', valve: 'XV-721' }
]
export const UTILITY_TAGS = ['SB-STEAM', 'SB-COOLING', 'SB-STEAM-PRESS', 'SB-COOLING-AVAIL']
export const COUPLED_LEGACY_TAGS = new Set(['LIC-401', 'AT-401', 'AT-402', 'TI-402', ...CIP_SUPPLIES.map(supply => supply.flow)])

export function createPhotoPlant(): { state: PhotoPlantState; modules: Record<string, AnyModule> } {
  const modules: Record<string, AnyModule> = {}
  const loop = (tag: string, description: string, unit: string, max: number, pv: number, sp = pv): void => {
    const m = makeModule({ tag, description: `Sandbox: ${description}`, area: PHOTO_AREA, type: 'PID', unit, pvMax: max })
    if (m.type !== 'PID') throw new Error('Photo plant loop factory requires PID')
    Object.assign(m, { pv, sp, out: 0, _integral: 0, _prevPv: pv, gain: 2, reset: 30 })
    m.alarms = [{ type: 'PVBAD', label: 'PV BAD', priority: 'CRITICAL', enabled: true },
      { type: 'HI', label: 'HIGH', priority: 'WARNING', limit: max * 0.9, enabled: true },
      ...(unit === '%' ? [{ type: 'LO' as const, label: 'LOW LEVEL', priority: 'WARNING' as const, limit: 5, enabled: true }] : [])]
    m.io = createPidIo(m)
    modules[tag] = m
  }
  const indicator = (tag: string, description: string, unit: string, max: number, pv: number): void => {
    const m = makeModule({ tag, description: `Sandbox: ${description}`, area: PHOTO_AREA, type: 'AI', unit, pvMax: max })
    if (m.type !== 'AI') throw new Error('Photo plant indicator factory requires AI')
    m.pv = pv
    m.alarms = [{ type: 'PVBAD', label: 'PV BAD', priority: 'CRITICAL', enabled: true },
      { type: 'HI', label: 'HIGH', priority: 'WARNING',
        limit: tag.endsWith('AI015B') ? 1.3 : tag.endsWith('AI015A') ? 500 : max * 0.9, enabled: true }]
    modules[tag] = m
  }
  const device = (tag: string, description: string, type: 'MOTOR' | 'VALVE'): void => {
    modules[tag] = makeModule({ tag, description: `Sandbox: ${description}`, area: PHOTO_AREA, type })
  }
  const compare = (tag: string, source: string, op: '<' | '>=', limit: number): void => {
    const m = makeModule({ tag, description: 'Sandbox equipment protection', area: PHOTO_AREA, type: 'FB', fbType: 'CMP' })
    if (m.type !== 'FB') throw new Error('Photo plant interlock factory requires FB')
    Object.assign(m, { in1: { kind: 'ref', tag: source, value: 0 }, in2: { kind: 'const', value: limit }, cmpOp: op })
    modules[tag] = m
  }
  for (const tank of PHOTO_TANKS) {
    const p = tank.prefix
    loop(`${p}-LIC005`, `${tank.title} filling level`, '%', 100, 60, 65)
    loop(`${p}-TIC011`, `${tank.title} heating`, 'degC', 150, 25, 25)
    loop(`${p}-PIC016`, `${tank.title} recirculation pressure`, 'psig', 60, 0, 25)
    indicator(`${p}-AI015A`, `${tank.title} TOC`, 'ppb', 1000, 20)
    indicator(`${p}-AI015B`, `${tank.title} conductivity`, 'uS/cm', 5, 0.3)
    indicator(`${p}-FI003`, `${tank.title} recirculation flow`, 'GPM', 100, 0)
    device(`${p}-XC002`, `${tank.title} recirculation pump`, 'MOTOR')
    device(`${p}-YV007`, `${tank.title} fill isolation`, 'VALVE')
    device(`${p}-YV014`, `${tank.title} distribution isolation`, 'VALVE')
    device(`${p}-YV009`, `${tank.title} drain isolation`, 'VALVE')
    compare(`${p}-LOW-LEVEL`, `${p}-LIC005`, '<', 1.5)
    const pump = modules[`${p}-XC002`]
    if (pump.type === 'MOTOR') pump.interlockSource = `${p}-LOW-LEVEL`
  }
  loop(`${STILL}-LIC100`, 'Still feed level', '%', 100, 60, 60)
  loop(`${STILL}-TIC102`, 'Still steam heating', 'degC', 150, 25, 102)
  indicator(`${STILL}-LT200`, 'Still distillate level', '%', 100, 10)
  indicator(`${STILL}-FT200`, 'Still distillate production', 'GPM', 20, 0)
  indicator(`${STILL}-PT103`, 'Still vapor pressure', 'psig', 15, 0)
  indicator(`${STILL}-OIL-PRESS`, 'Still compressor oil pressure', 'psig', 60, 0)
  indicator(`${STILL}-AIT200`, 'Still distillate conductivity', 'uS/cm', 5, 0.3)
  device(`${STILL}-LUBE`, 'Still oil pump', 'MOTOR')
  device(`${STILL}-COMP`, 'Still compressor (oil pressure permissive)', 'MOTOR')
  device(`${STILL}-DIST`, 'Still distillate delivery pump', 'MOTOR')
  device(`${STILL}-XV100`, 'Still feed isolation', 'VALVE')
  device(`${STILL}-XV201`, 'Still delivery isolation', 'VALVE')
  const compressor = modules[`${STILL}-COMP`]
  compare(`${STILL}-OIL-READY`, `${STILL}-OIL-PRESS`, '>=', 15)
  compare(`${STILL}-OIL-LOW`, `${STILL}-OIL-PRESS`, '<', 10)
  compare(`${STILL}-DIST-LOW`, `${STILL}-LT200`, '<', 1)
  if (compressor.type === 'MOTOR') {
    compressor.permissiveRequired = true
    compressor.permissiveOk = false
    compressor.permissiveSource = `${STILL}-OIL-READY`
    compressor.interlockSource = `${STILL}-OIL-LOW`
  }
  const deliveryPump = modules[`${STILL}-DIST`]
  if (deliveryPump.type === 'MOTOR') deliveryPump.interlockSource = `${STILL}-DIST-LOW`
  device('SB-STEAM', 'Shared plant steam supply', 'MOTOR')
  device('SB-COOLING', 'Shared plant cooling supply', 'MOTOR')
  for (const tag of ['SB-STEAM', 'SB-COOLING']) {
    const module = modules[tag]
    if (module.type === 'MOTOR') { module.commanded = true; module.running = true }
  }
  indicator('SB-STEAM-PRESS', 'Shared steam header pressure', 'bar', 6, 4)
  indicator('SB-COOLING-AVAIL', 'Shared cooling availability', '%', 100, 100)
  for (const tag of ['SB-STEAM-PRESS', 'SB-COOLING-AVAIL']) {
    const module = modules[tag]
    if (module.type === 'AI') module.alarms = [
      { type: 'PVBAD', label: 'PV BAD', priority: 'CRITICAL', enabled: true },
      { type: 'LO', label: 'LOW UTILITY', priority: 'WARNING', limit: tag === 'SB-STEAM-PRESS' ? 1 : 25, enabled: true }
    ]
  }
  return {
    modules,
    state: {
      tanks: {
        n3: initialTank(), n1: initialTank(), n1bp: initialTank()
      },
      still: { feedLiters: 600, distillateLiters: 50, temperature: 25, production: 0, oilPressure: 0 },
      utilities: { steamPressure: 4, coolingAvailability: 1, legacyWfiLiters: 4200,
        legacyConductivity: 0.9, legacyToc: 80, legacyTemperature: 78, cipFlow: {} }
    }
  }
}

function initialTank(): PhotoTankState {
  return { liters: 4200, temperature: 25, pressure: 0, conductivity: 0.3, toc: 20,
    flow: 0, sanitation: 'IDLE', soakSeconds: 0 }
}

export const PHOTO_TAG_TYPES = Object.fromEntries(Object.entries(createPhotoPlant().modules).map(([tag, module]) => [tag, module.type]))
export const PHOTO_TAGS = new Set(Object.keys(PHOTO_TAG_TYPES))
const active = (modules: Record<string, AnyModule>, tag: string): boolean => {
  const m = modules[tag]
  if (!m || (m.type !== 'MOTOR' && m.type !== 'VALVE') || m.downloaded === false ||
      m.fault || m.interlock || m.locked || m.ioInputBad || m.ioOutputBad) return false
  return m.type === 'MOTOR' ? m.running : m.open
}
const output = (modules: Record<string, AnyModule>, tag: string): number => {
  const m = modules[tag]
  return m?.type === 'PID' ? appliedPidOutput(m) / 100 : 0
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export function stepPhotoPlant(previous: PhotoPlantState, modules: Record<string, AnyModule>, dt: number): PhotoPlantState {
  const state: PhotoPlantState = { still: { ...previous.still },
    utilities: { ...previous.utilities, cipFlow: { ...previous.utilities.cipFlow } },
    tanks: { n3: { ...previous.tanks.n3 }, n1: { ...previous.tanks.n1 }, n1bp: { ...previous.tanks.n1bp } } }
  const steps = Math.max(1, Math.ceil(dt / 0.25))
  const h = dt / steps
  for (let scan = 0; scan < steps; scan++) {
    const utilities = state.utilities
    const steamLoad = [...STEAM_USERS].filter(tag => !tag.startsWith('PIC')).reduce((sum, tag) => sum + output(modules, tag), 0) +
      output(modules, `${STILL}-TIC102`) + PHOTO_TANKS.reduce((sum, tank) =>
        sum + (active(modules, `${tank.prefix}-XC002`) ? output(modules, `${tank.prefix}-TIC011`) : 0), 0)
    const steamTarget = active(modules, 'SB-STEAM') ? Math.max(0, 4 - steamLoad * 0.15) : 0
    utilities.steamPressure += (steamTarget - utilities.steamPressure) * Math.min(h / 5, 1)
    utilities.coolingAvailability += ((active(modules, 'SB-COOLING') ? 1 : 0) - utilities.coolingAvailability) * Math.min(h / 3, 1)
    const steamFactor = clamp(utilities.steamPressure / 4, 0, 1)
    const still = state.still
    still.oilPressure += ((active(modules, `${STILL}-LUBE`) ? 30 : 0) - still.oilPressure) * Math.min(h / 2, 1)
    const feed = active(modules, `${STILL}-XV100`) ? output(modules, `${STILL}-LIC100`) * 2 : 0
    const heat = still.feedLiters > 20 ? output(modules, `${STILL}-TIC102`) * 1.8 * steamFactor : 0
    still.temperature = clamp(still.temperature + (heat - 0.008 * (still.temperature - 25)) * h, 15, 130)
    const production = active(modules, `${STILL}-COMP`) && still.oilPressure >= 10 && still.feedLiters > 20
      ? clamp((still.temperature - 95) / 7, 0, 1) * 0.8 : 0
    const distilled = Math.min(production * h, still.feedLiters, STILL_DISTILLATE_CAPACITY - still.distillateLiters)
    still.production = h > 0 ? distilled / h : 0
    still.feedLiters = clamp(still.feedLiters + feed * h - distilled, 0, STILL_FEED_CAPACITY)
    still.distillateLiters += distilled
    const fillRequests = PHOTO_TANKS.map(tank => active(modules, `${tank.prefix}-YV007`)
      ? Math.min(output(modules, `${tank.prefix}-LIC005`) * 1.2 * h, TANK_CAPACITY - state.tanks[tank.id].liters) : 0)
    const requested = fillRequests.reduce((sum, liters) => sum + liters, 0)
    const delivery = active(modules, `${STILL}-DIST`) && active(modules, `${STILL}-XV201`)
      ? Math.min(requested, 2 * h, still.distillateLiters) : 0
    still.distillateLiters -= delivery
    PHOTO_TANKS.forEach((config, index) => {
      const tank = state.tanks[config.id]
      const temperatureLoop = modules[`${config.prefix}-TIC011`]
      if (tank.sanitation !== 'IDLE' && tank.sanitation !== 'ABORTED' &&
          (temperatureLoop?.type !== 'PID' || temperatureLoop.mode !== 'AUTO' ||
           temperatureLoop.actualMode === 'LO' || temperatureLoop.pvBad || pidExecutionBad(temperatureLoop) ||
           temperatureLoop.downloaded === false || !pidTargetAllowed(temperatureLoop, 'AUTO'))) {
        tank.sanitation = 'ABORTED'
        tank.soakSeconds = 0
      }
      const circulating = active(modules, `${config.prefix}-XC002`)
      const filled = requested > 0 ? delivery * fillRequests[index] / requested : 0
      const demand = circulating && active(modules, `${config.prefix}-YV014`)
        ? Math.min(0.35 * h, tank.liters + filled,
          config.id === 'n1' && modules['LIC-401']?.type === 'PID' ? TANK_CAPACITY - utilities.legacyWfiLiters : Infinity) : 0
      if (config.id === 'n1' && modules['LIC-401']?.type === 'PID' && demand > 0) {
        const received = utilities.legacyWfiLiters + demand
        utilities.legacyConductivity = (utilities.legacyConductivity * utilities.legacyWfiLiters + tank.conductivity * demand) / received
        utilities.legacyToc = (utilities.legacyToc * utilities.legacyWfiLiters + tank.toc * demand) / received
        utilities.legacyTemperature = (utilities.legacyTemperature * utilities.legacyWfiLiters + tank.temperature * demand) / received
        utilities.legacyWfiLiters = received
      }
      const drain = active(modules, `${config.prefix}-YV009`) ? 1.5 * h : 0
      if (filled > 0) tank.temperature = (tank.temperature * tank.liters + still.temperature * filled) / (tank.liters + filled)
      tank.liters = clamp(tank.liters + filled - demand - drain, 0, TANK_CAPACITY)
      const heating = circulating && tank.liters > 100 ? output(modules, `${config.prefix}-TIC011`) * 1.2 * steamFactor : 0
      const cooling = 0.004 + (circulating ? 0.011 * utilities.coolingAvailability : 0)
      tank.temperature = clamp(tank.temperature + (heating - cooling * (tank.temperature - 25)) * h, 15, 130)
      const pressureTarget = circulating ? output(modules, `${config.prefix}-PIC016`) * 50 : 0
      tank.pressure += (pressureTarget - tank.pressure) * Math.min(h / 3, 1)
      tank.flow = circulating ? tank.pressure * 2 : 0
      if (tank.sanitation === 'HEATING' && tank.temperature >= 80 && circulating) tank.sanitation = 'SOAK'
      if (tank.sanitation === 'SOAK') {
        if (tank.temperature >= 80 && circulating) tank.soakSeconds += h
        else { tank.soakSeconds = 0; tank.sanitation = 'HEATING' }
        if (tank.soakSeconds >= 600) {
          tank.sanitation = 'COOLING'
          const loop = modules[`${config.prefix}-TIC011`]
          if (loop?.type === 'PID' && loop.mode === 'AUTO' && loop.downloaded !== false &&
              !loop.pvBad && !pidExecutionBad(loop) && loop.actualMode !== 'LO') loop.sp = 25
          else tank.sanitation = 'ABORTED'
        }
      }
      if (tank.sanitation === 'COOLING' && tank.temperature <= 30) tank.sanitation = 'IDLE'
      tank.conductivity = clamp(tank.conductivity + (circulating && tank.temperature >= 80 ? -0.0005 : 0.00001) * h, 0.15, 5)
      tank.toc = clamp(tank.toc + (circulating && tank.temperature >= 80 ? -0.04 : 0.001) * h, 5, 1000)
    })
    const wfiAvailable = utilities.legacyWfiLiters > 0 &&
      (active(modules, 'P-401') || active(modules, 'P-402')) && active(modules, 'PCV-401')
    const requests = CIP_SUPPLIES.map(supply => wfiAvailable && active(modules, supply.pump) && active(modules, supply.valve)
      ? output(modules, supply.flow) * 40 / 3.6 : 0)
    const totalRequested = requests.reduce((sum, value) => sum + value, 0)
    const diverted = active(modules, 'XV-422') ? Math.min(utilities.legacyWfiLiters, h) : 0
    const fraction = totalRequested * h > 0 ? Math.min(1, (utilities.legacyWfiLiters - diverted) / (totalRequested * h)) : 0
    CIP_SUPPLIES.forEach((supply, index) => { utilities.cipFlow[supply.flow] = requests[index] * fraction * 3.6 })
    utilities.legacyWfiLiters = Math.max(0, utilities.legacyWfiLiters - totalRequested * fraction * h - diverted)
  }
  return state
}

export function photoMeasurements(state: PhotoPlantState): Record<string, number> {
  const result: Record<string, number> = {
    [`${STILL}-LIC100`]: state.still.feedLiters / STILL_FEED_CAPACITY * 100,
    [`${STILL}-TIC102`]: state.still.temperature,
    [`${STILL}-LT200`]: state.still.distillateLiters / STILL_DISTILLATE_CAPACITY * 100,
    [`${STILL}-FT200`]: state.still.production * 60 / 3.78541,
    [`${STILL}-PT103`]: Math.max(0, state.still.temperature - 95) * 0.2,
    [`${STILL}-OIL-PRESS`]: state.still.oilPressure,
    [`${STILL}-AIT200`]: 0.3
  }
  Object.assign(result, {
    'SB-STEAM-PRESS': state.utilities.steamPressure,
    'SB-COOLING-AVAIL': state.utilities.coolingAvailability * 100,
    'LIC-401': state.utilities.legacyWfiLiters / TANK_CAPACITY * 100,
    'AT-401': state.utilities.legacyConductivity,
    'AT-402': state.utilities.legacyToc,
    'TI-402': state.utilities.legacyTemperature,
    ...state.utilities.cipFlow
  })
  for (const config of PHOTO_TANKS) {
    const tank = state.tanks[config.id]
    Object.assign(result, {
      [`${config.prefix}-LIC005`]: tank.liters / TANK_CAPACITY * 100,
      [`${config.prefix}-TIC011`]: tank.temperature,
      [`${config.prefix}-PIC016`]: tank.pressure,
      [`${config.prefix}-AI015A`]: tank.toc,
      [`${config.prefix}-AI015B`]: tank.conductivity,
      [`${config.prefix}-FI003`]: tank.flow
    })
  }
  return result
}

/** Additive install: existing modules/process/exercises are retained; returns tags that would collide instead. */
export function installPhotoPlant(plant: PlantState):
  { plant: PlantState; conflicts: string[] } {
  const addon = createPhotoPlant()
  const conflicts = Object.keys(addon.modules).filter(tag => plant.modules[tag])
  if (conflicts.length) return { plant, conflicts }
  const utilities = addon.state.utilities
  const legacyLevel = plant.modules['LIC-401']
  if (legacyLevel?.type === 'PID') utilities.legacyWfiLiters = clamp(legacyLevel.pv, 0, 100) * TANK_CAPACITY / 100
  const conductivity = plant.modules['AT-401']
  const toc = plant.modules['AT-402']
  const temperature = plant.modules['TI-402']
  if (conductivity?.type === 'AI') utilities.legacyConductivity = conductivity.pv
  if (toc?.type === 'AI') utilities.legacyToc = toc.pv
  if (temperature?.type === 'AI') utilities.legacyTemperature = temperature.pv
  return { conflicts, plant: { ...plant, modules: { ...plant.modules, ...addon.modules }, photoPlant: addon.state,
    areas: plant.areas.includes(PHOTO_AREA) ? plant.areas : [...plant.areas, PHOTO_AREA] } }
}

export function startPhotoSanitation(state: PhotoPlantState, id: PhotoTankId): PhotoPlantState {
  return { ...state, tanks: { ...state.tanks, [id]: { ...state.tanks[id], sanitation: 'HEATING', soakSeconds: 0 } } }
}
