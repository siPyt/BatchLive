import { controllerIsDown, type HardwareState } from './hardware'
import { isValidDeltaVTag } from './naming'
import type { TraditionalCard, TraditionalCardType } from './traditionalIo'

// ---------------------------------------------------------------------------
// DeltaV Serial Interface (DV-09 chapter 9): a two-port serial card speaking
// Modbus RTU or ASCII as master or slave. Each port has up to 16 devices and
// 16 datasets; a dataset maps up to 100 consecutive PLC coils/registers to
// DeltaV device signal tags (DSTs) that modules use as I/O. This is a virtual
// transport: port 1 and port 2 can be tied back to each other (the RS232
// tie-back workshop). No physical wiring, UART or vendor driver is simulated.
// ---------------------------------------------------------------------------

export type SerialPortId = 'P01' | 'P02'
export const SERIAL_PORT_IDS: SerialPortId[] = ['P01', 'P02']
export type SerialProtocol = 'RTU' | 'ASCII'
export type SerialMode = 'MASTER' | 'SLAVE'
export type SerialPortType = 'RS232' | 'RS422_485_FULL' | 'RS422_485_HALF'
export type SerialParity = 'NONE' | 'EVEN' | 'ODD'
export type SerialDataType = 'BOOLEAN' | 'DISCRETE' | 'INT16' | 'UINT16' | 'FLOAT32'
export type PlcTable = 'COILS' | 'INPUT_STATUS' | 'INPUT_REGISTERS' | 'HOLDING_REGISTERS'
export type DatasetDirection = 'INPUT' | 'OUTPUT'
export type OutputMode = 'COMPLETE_BLOCK' | 'SINGLE_VALUE'
export type SerialCapacity = 'DST' | 'SCADA'

export const SERIAL_LIMITS = {
  devicesPerPort: 16,
  datasetsPerPort: 16,
  valuesPerDataset: 100,
  dstCapacity: 500,
  scadaCapacity: 3200,
  maxAddress: 247
} as const

export const SERIAL_BAUD_RATES = [300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]

export const PLC_TABLE_DIGIT: Record<PlcTable, number> = {
  COILS: 0,
  INPUT_STATUS: 1,
  INPUT_REGISTERS: 3,
  HOLDING_REGISTERS: 4
}

export const SERIAL_DATA_TYPE_LABEL: Record<SerialDataType, string> = {
  BOOLEAN: 'Boolean w/status',
  DISCRETE: 'Discrete w/status',
  INT16: '16 bit int w/status',
  UINT16: '16 bit unsigned int w/status',
  FLOAT32: 'Floating point w/status'
}

export interface SerialDatasetConfig {
  name: string
  description: string
  direction: DatasetDirection
  outputMode: OutputMode
  outputReadback: boolean
  dataType: SerialDataType
  /** The dataset tag, e.g. FLOW-OUT; the module path is TAG/R<modbus address>. */
  tag: string
  plcTable: PlcTable
  plcBase: number
  plcOffset: number
  count: number
}

export interface SerialDeviceConfig {
  name: string
  address: number
  datasets: Record<string, SerialDatasetConfig>
}

export interface SerialPortConfig {
  description: string
  enabled: boolean
  protocol: SerialProtocol
  mode: SerialMode
  retryCount: number
  timeoutMs: number
  transmitDelayMs: number
  sendOutputsOnStartup: boolean
  portType: SerialPortType
  baud: number
  parity: SerialParity
  dataBits: 7 | 8
  stopBits: 1 | 2
  devices: Record<string, SerialDeviceConfig>
}

export interface SerialCardConfig {
  ports: Record<SerialPortId, SerialPortConfig>
  /** Port 1 is wired to port 2 with a tie-back cable. */
  tieback: boolean
  capacity: SerialCapacity
}

export type SerialDatasetStatus = 'GOOD' | 'BAD'

export interface SerialPortRuntime {
  carryMs: number
  cursor: number
  /** Time the current dataset transaction has been failing, per dataset key. */
  failMs: Record<string, number>
  status: Record<string, SerialDatasetStatus>
  /** Last values sent by an output dataset, per dataset key. */
  lastSent: Record<string, number[]>
  /** Messages that the card transmitted or retried; a simple diagnostic counter. */
  messages: number
  retries: number
}

export interface SerialRuntime {
  ports: Record<SerialPortId, SerialPortRuntime>
  /** Register memory of each slave port: address -> "table:index" -> word/bit. */
  memory: Record<SerialPortId, Record<string, Record<string, number>>>
  started: boolean
}

export interface SerialCard {
  id: string
  controllerTag: string
  slot: number
  /** A placeholder was configured before the physical card was installed. */
  placeholder: boolean
  configured: SerialCardConfig
  deployed?: SerialCardConfig
  runtime: SerialRuntime
}

export function defaultSerialPort(mode: SerialMode = 'MASTER'): SerialPortConfig {
  return {
    description: '',
    enabled: false,
    protocol: 'RTU',
    mode,
    retryCount: 1,
    timeoutMs: 1000,
    transmitDelayMs: 0,
    sendOutputsOnStartup: true,
    portType: 'RS232',
    baud: 9600,
    parity: 'EVEN',
    dataBits: 8,
    stopBits: 1,
    devices: {}
  }
}

export function defaultSerialConfig(): SerialCardConfig {
  return { ports: { P01: defaultSerialPort('MASTER'), P02: defaultSerialPort('MASTER') }, tieback: false, capacity: 'DST' }
}

function emptyPortRuntime(): SerialPortRuntime {
  return { carryMs: 0, cursor: 0, failMs: {}, status: {}, lastSent: {}, messages: 0, retries: 0 }
}

export function emptySerialRuntime(): SerialRuntime {
  return { ports: { P01: emptyPortRuntime(), P02: emptyPortRuntime() }, memory: { P01: {}, P02: {} }, started: false }
}

export function makeSerialCard(controllerTag: string, slot: number, placeholder: boolean): SerialCard {
  return {
    id: `${controllerTag}/C${String(slot).padStart(2, '0')}`,
    controllerTag,
    slot,
    placeholder,
    configured: defaultSerialConfig(),
    runtime: emptySerialRuntime()
  }
}

export function cloneSerialConfig(config: SerialCardConfig): SerialCardConfig {
  return JSON.parse(JSON.stringify(config)) as SerialCardConfig
}

// --- addressing -------------------------------------------------------------

export function isBitTable(table: PlcTable): boolean {
  return table === 'COILS' || table === 'INPUT_STATUS'
}

/** Registers/bits one value of this type occupies on the wire. */
export function wordsPerValue(dataType: SerialDataType): number {
  return dataType === 'FLOAT32' ? 2 : 1
}

export function datasetSpan(dataset: Pick<SerialDatasetConfig, 'dataType' | 'count'>): number {
  return dataset.count * wordsPerValue(dataset.dataType)
}

/** The Modbus reference number of the first element: coil 00001, holding 40001, ... */
export function modbusAddress(dataset: Pick<SerialDatasetConfig, 'plcTable' | 'plcBase' | 'plcOffset'>, element = 0): number {
  return PLC_TABLE_DIGIT[dataset.plcTable] * 10000 + 1 + dataset.plcBase + dataset.plcOffset + element
}

/** The DST name of value `index` of a dataset, e.g. FLOW-IN/R40001. */
export function datasetDstName(dataset: SerialDatasetConfig, index: number): string {
  return `${dataset.tag}/R${modbusAddress(dataset, index * wordsPerValue(dataset.dataType))}`
}

export function datasetKey(portId: SerialPortId, device: string, dataset: string): string {
  return `${portId}/${device}/${dataset}`
}

export function datasetType(dataset: SerialDatasetConfig): TraditionalCardType {
  const bool = dataset.dataType === 'BOOLEAN'
  if (dataset.direction === 'INPUT') return bool ? 'DI' : 'AI'
  return bool ? 'DO' : 'AO'
}

// --- value encoding ---------------------------------------------------------

export function encodeValue(dataType: SerialDataType, value: number): number[] {
  if (dataType === 'BOOLEAN') return [value !== 0 ? 1 : 0]
  if (dataType === 'FLOAT32') {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value)
    return [view.getUint16(0), view.getUint16(2)]
  }
  if (dataType === 'DISCRETE') return [Math.max(0, Math.min(255, Math.round(value)))]
  if (dataType === 'UINT16') return [Math.max(0, Math.min(65535, Math.round(value)))]
  const signed = Math.max(-32768, Math.min(32767, Math.round(value)))
  return [signed < 0 ? signed + 65536 : signed]
}

export function decodeValue(dataType: SerialDataType, words: number[]): number {
  if (dataType === 'BOOLEAN') return words[0] ? 1 : 0
  if (dataType === 'FLOAT32') {
    const view = new DataView(new ArrayBuffer(4))
    view.setUint16(0, words[0] ?? 0)
    view.setUint16(2, words[1] ?? 0)
    return view.getFloat32(0)
  }
  const word = words[0] ?? 0
  if (dataType === 'INT16') return word > 32767 ? word - 65536 : word
  return word
}

// --- validation -------------------------------------------------------------

function allDatasets(config: SerialCardConfig): { port: SerialPortId; device: SerialDeviceConfig; dataset: SerialDatasetConfig }[] {
  return SERIAL_PORT_IDS.flatMap((port) =>
    Object.values(config.ports[port].devices).flatMap((device) =>
      Object.values(device.datasets).map((dataset) => ({ port, device, dataset }))
    )
  )
}

export function serialDstCount(config: SerialCardConfig): number {
  return allDatasets(config).reduce((sum, item) => sum + item.dataset.count, 0)
}

export function serialPortError(port: SerialPortConfig, portId: SerialPortId): string | null {
  if (!['RTU', 'ASCII'].includes(port.protocol)) return `${portId}: protocol must be RTU or ASCII`
  if (!['MASTER', 'SLAVE'].includes(port.mode)) return `${portId}: mode must be Master or Slave`
  if (!Number.isInteger(port.retryCount) || port.retryCount < 0 || port.retryCount > 10) return `${portId}: retry count must be a whole number from 0 to 10`
  if (!Number.isInteger(port.timeoutMs) || port.timeoutMs < 100 || port.timeoutMs > 60000) return `${portId}: message time out must be 100 to 60000 ms`
  if (!Number.isInteger(port.transmitDelayMs) || port.transmitDelayMs < 0 || port.transmitDelayMs > 10000) return `${portId}: transmit delay must be 0 to 10000 ms`
  if (!['RS232', 'RS422_485_FULL', 'RS422_485_HALF'].includes(port.portType)) return `${portId}: unknown port type`
  if (!SERIAL_BAUD_RATES.includes(port.baud)) return `${portId}: baud rate must be one of ${SERIAL_BAUD_RATES.join(', ')}`
  if (!['NONE', 'EVEN', 'ODD'].includes(port.parity)) return `${portId}: parity must be none, even or odd`
  if (port.dataBits !== 7 && port.dataBits !== 8) return `${portId}: data bits must be 7 or 8`
  if (port.stopBits !== 1 && port.stopBits !== 2) return `${portId}: stop bits must be 1 or 2`
  if (port.protocol === 'RTU' && port.dataBits !== 8) return `${portId}: Modbus RTU requires 8 data bits`
  if (port.portType === 'RS232' && Object.keys(port.devices).length > 1) return `${portId}: an RS232 port connects to a single serial device`
  if (Object.keys(port.devices).length > SERIAL_LIMITS.devicesPerPort) return `${portId}: at most ${SERIAL_LIMITS.devicesPerPort} devices per port`
  return null
}

export function serialDatasetError(
  config: SerialCardConfig,
  portId: SerialPortId,
  deviceName: string,
  dataset: SerialDatasetConfig,
  existingName?: string,
  otherCards: SerialCardConfig[] = []
): string | null {
  const port = config.ports[portId]
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(dataset.name)) return 'Dataset name must be 1-16 characters starting with a letter'
  if (!isValidDeltaVTag(dataset.tag) || dataset.tag !== dataset.tag.toUpperCase()) {
    return 'Dataset tag must use the 1-16 character DeltaV tag syntax in upper case, for example FLOW-OUT'
  }
  if (!['INPUT', 'OUTPUT'].includes(dataset.direction)) return 'Data direction must be input or output'
  if (!['COMPLETE_BLOCK', 'SINGLE_VALUE'].includes(dataset.outputMode)) return 'Output mode must be complete block or single value'
  if (!(dataset.dataType in SERIAL_DATA_TYPE_LABEL)) return 'Unsupported DeltaV data type'
  if (!(dataset.plcTable in PLC_TABLE_DIGIT)) return 'Unsupported PLC data type'
  if (!Number.isInteger(dataset.count) || dataset.count < 1 || dataset.count > SERIAL_LIMITS.valuesPerDataset) {
    return `Number of values must be a whole number from 1 to ${SERIAL_LIMITS.valuesPerDataset}`
  }
  for (const [label, value] of [['PLC base register address', dataset.plcBase], ['PLC register offset', dataset.plcOffset]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 9998) return `${label} must be a whole number from 0 to 9998`
  }
  if (dataset.plcBase + dataset.plcOffset + datasetSpan(dataset) > 9999) return 'The dataset runs past the end of the PLC data table (9999 elements)'
  const bits = isBitTable(dataset.plcTable)
  if ((dataset.dataType === 'BOOLEAN') !== bits) {
    return bits
      ? `${PLC_TABLE_LABEL[dataset.plcTable]} hold single bits and need the Boolean data type`
      : `${PLC_TABLE_LABEL[dataset.plcTable]} need an integer, discrete or floating point data type`
  }
  const readOnlyTable = dataset.plcTable === 'INPUT_STATUS' || dataset.plcTable === 'INPUT_REGISTERS'
  if (dataset.direction === 'OUTPUT' && port.mode === 'MASTER' && readOnlyTable) {
    return `A master cannot write ${PLC_TABLE_LABEL[dataset.plcTable]}; they are read-only in the PLC`
  }
  if (dataset.direction === 'INPUT' && port.mode === 'SLAVE' && readOnlyTable) {
    return `A slave receives only coils and holding registers from the master, not ${PLC_TABLE_LABEL[dataset.plcTable]}`
  }
  const device = port.devices[deviceName]
  if (!device) return `Device ${deviceName} does not exist`
  if (device.datasets && Object.keys(device.datasets).some((name) => name === dataset.name && name !== existingName)) {
    return `Dataset ${dataset.name} already exists on ${deviceName}`
  }
  const portCount = Object.values(port.devices).reduce((sum, d) => sum + Object.keys(d.datasets).length, 0)
  const adding = existingName === undefined ? 1 : 0
  if (portCount + adding > SERIAL_LIMITS.datasetsPerPort) return `At most ${SERIAL_LIMITS.datasetsPerPort} datasets per port`
  const everyone = [config, ...otherCards]
  for (const card of everyone) {
    for (const item of allDatasets(card)) {
      const same = card === config && item.port === portId && item.device.name === deviceName && item.dataset.name === (existingName ?? dataset.name)
      if (!same && item.dataset.tag === dataset.tag) return `Dataset tag ${dataset.tag} is already used`
    }
  }
  const low = dataset.plcBase + dataset.plcOffset
  const high = low + datasetSpan(dataset)
  for (const other of Object.values(device.datasets)) {
    if (other.name === (existingName ?? dataset.name) || other.plcTable !== dataset.plcTable) continue
    if (dataset.direction !== 'OUTPUT' && other.direction !== 'OUTPUT') continue
    const otherLow = other.plcBase + other.plcOffset
    if (low < otherLow + datasetSpan(other) && otherLow < high) {
      return `Dataset ${dataset.name} overlaps ${other.name} in ${PLC_TABLE_LABEL[dataset.plcTable]} (${modbusAddress(dataset)}-${modbusAddress(dataset, datasetSpan(dataset) - 1)})`
    }
  }
  const projected = serialDstCount(config) - (existingName ? (device.datasets[existingName]?.count ?? 0) : 0) + dataset.count
  const capacity = config.capacity === 'SCADA' ? SERIAL_LIMITS.scadaCapacity : SERIAL_LIMITS.dstCapacity
  if (projected > capacity) return `The card is limited to ${capacity} ${config.capacity === 'SCADA' ? 'SCADA points' : 'DSTs'}`
  return null
}

export const PLC_TABLE_LABEL: Record<PlcTable, string> = {
  COILS: 'coils',
  INPUT_STATUS: 'input status',
  INPUT_REGISTERS: 'input registers',
  HOLDING_REGISTERS: 'holding registers'
}

export function serialDeviceError(config: SerialCardConfig, portId: SerialPortId, name: string, address: number): string | null {
  const port = config.ports[portId]
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(name)) return 'Device name must be 1-16 characters starting with a letter'
  if (!Number.isInteger(address) || address < 1 || address > SERIAL_LIMITS.maxAddress) return `Device address must be a whole number from 1 to ${SERIAL_LIMITS.maxAddress}`
  if (port.devices[name]) return `Device ${name} already exists`
  if (Object.values(port.devices).some((d) => d.address === address)) return `Address ${address} is already used on ${portId}`
  if (Object.keys(port.devices).length >= SERIAL_LIMITS.devicesPerPort) return `At most ${SERIAL_LIMITS.devicesPerPort} devices per port`
  if (port.portType === 'RS232' && Object.keys(port.devices).length >= 1) return 'An RS232 port connects to a single serial device; change the port type to RS422/485 for more'
  return null
}

// --- derived DSTs -----------------------------------------------------------

/** Dataset DSTs are exposed to modules as device signal tags through hidden traditional cards. */
export function syncSerialDatasetCards(hw: HardwareState): HardwareState {
  const cards = Object.fromEntries(
    Object.entries(hw.traditionalCards ?? {}).filter(([, card]) => !card.serial)
  ) as Record<string, TraditionalCard>
  const previous = new Map<string, number>()
  for (const card of Object.values(hw.traditionalCards ?? {})) {
    if (card.serial) for (const channel of card.channels) previous.set(channel.dst, channel.value)
  }
  for (const serialCard of Object.values(hw.serialCards ?? {})) {
    const config = serialCard.deployed
    if (!config) continue
    for (const portId of SERIAL_PORT_IDS) {
      const port = config.ports[portId]
      for (const device of Object.values(port.devices)) {
        for (const dataset of Object.values(device.datasets)) {
          const id = `${serialCard.id}/${portId}/${device.name}/${dataset.name}`
          cards[id] = {
            id,
            controllerTag: serialCard.controllerTag,
            slot: serialCard.slot,
            type: datasetType(dataset),
            serial: { cardId: serialCard.id, port: portId, device: device.name, dataset: dataset.name },
            channels: Array.from({ length: dataset.count }, (_, index) => {
              const dst = datasetDstName(dataset, index)
              return { channel: index + 1, dst, enabled: port.enabled, value: previous.get(dst) ?? 0, bad: true }
            })
          }
        }
      }
    }
  }
  return { ...hw, traditionalCards: cards }
}

export function serialDatasetStatus(hw: HardwareState, card: TraditionalCard): SerialDatasetStatus {
  if (!card.serial) return 'GOOD'
  const serialCard = hw.serialCards?.[card.serial.cardId]
  const controller = serialCard ? hw.controllers[serialCard.controllerTag] : undefined
  if (!serialCard || !serialCard.deployed || !controller || controllerIsDown(controller)) return 'BAD'
  const port = serialCard.deployed.ports[card.serial.port]
  if (!port.enabled) return 'BAD'
  return serialCard.runtime.ports[card.serial.port].status[datasetKey(card.serial.port, card.serial.device, card.serial.dataset)] ?? 'BAD'
}

// --- virtual transport ------------------------------------------------------

function commMismatch(a: SerialPortConfig, b: SerialPortConfig): string | null {
  for (const field of ['protocol', 'portType', 'baud', 'parity', 'dataBits', 'stopBits'] as const) {
    if (a[field] !== b[field]) return `${field} differs between the tied-back ports`
  }
  return null
}

/** Milliseconds one request/response transaction occupies the line at this baud rate. */
export function transactionMs(port: SerialPortConfig, words: number): number {
  const bitsPerChar = 1 + port.dataBits + (port.parity === 'NONE' ? 0 : 1) + port.stopBits
  const chars = (port.protocol === 'RTU' ? 8 : 17) + words * (port.protocol === 'RTU' ? 2 : 4) + 5
  return Math.max(1, Math.ceil((chars * bitsPerChar * 1000) / port.baud)) + port.transmitDelayMs
}

function memoryFor(runtime: SerialRuntime, port: SerialPortId, address: number): Record<string, number> {
  const key = String(address)
  runtime.memory[port][key] ??= {}
  return runtime.memory[port][key]
}

function channelsOf(hw: HardwareState, cardId: string, port: SerialPortId, device: string, dataset: string): TraditionalCard | undefined {
  return hw.traditionalCards?.[`${cardId}/${port}/${device}/${dataset}`]
}

function readWords(memory: Record<string, number>, dataset: SerialDatasetConfig, valueIndex: number): number[] {
  const first = dataset.plcBase + dataset.plcOffset + valueIndex * wordsPerValue(dataset.dataType)
  return Array.from({ length: wordsPerValue(dataset.dataType) }, (_, i) => memory[`${dataset.plcTable}:${first + i}`] ?? 0)
}

function writeWords(memory: Record<string, number>, dataset: SerialDatasetConfig, valueIndex: number, words: number[]): void {
  const first = dataset.plcBase + dataset.plcOffset + valueIndex * wordsPerValue(dataset.dataType)
  words.forEach((word, i) => { memory[`${dataset.plcTable}:${first + i}`] = word })
}

/**
 * Advance every deployed serial card by `dt` seconds. The master port runs one
 * transaction at a time (a dataset read or write); a transaction that cannot
 * complete (no tie-back, no slave device at that address, mismatched
 * communication settings, disabled slave port) keeps failing for
 * (retry count + 1) x message time out before its dataset goes Bad.
 * Mutates the card runtime copies it returns and the cloned dataset cards.
 */
export function stepSerialCards(hw: HardwareState, dt: number): Record<string, SerialCard> | undefined {
  if (!hw.serialCards) return undefined
  const out: Record<string, SerialCard> = {}
  for (const [id, card] of Object.entries(hw.serialCards)) {
    out[id] = card.deployed ? stepCard(hw, card, dt) : card
  }
  return out
}

function stepCard(hw: HardwareState, source: SerialCard, dt: number): SerialCard {
  const card: SerialCard = { ...source, runtime: JSON.parse(JSON.stringify(source.runtime)) as SerialRuntime }
  const config = source.deployed as SerialCardConfig
  const controller = hw.controllers[source.controllerTag]
  const down = !controller || controllerIsDown(controller) || !controller.commissioned
  const p1 = config.ports.P01
  const p2 = config.ports.P02
  const tied = config.tieback
  const mismatch = tied ? commMismatch(p1, p2) : 'ports are not wired together'
  const roleOk = p1.mode !== p2.mode

  // Slave ports exchange their register memory with their own DeltaV datasets every scan.
  for (const portId of SERIAL_PORT_IDS) {
    const port = config.ports[portId]
    const runtime = card.runtime.ports[portId]
    if (port.mode !== 'SLAVE') continue
    const master = portId === 'P01' ? p2 : p1
    const linked = !down && port.enabled && master.enabled && master.mode === 'MASTER' && tied && !mismatch && roleOk
    for (const device of Object.values(port.devices)) {
      const memory = memoryFor(card.runtime, portId, device.address)
      for (const dataset of Object.values(device.datasets)) {
        const key = datasetKey(portId, device.name, dataset.name)
        const dst = channelsOf(hw, source.id, portId, device.name, dataset.name)
        runtime.status[key] = linked ? 'GOOD' : 'BAD'
        if (!dst) continue
        for (let index = 0; index < dataset.count; index++) {
          const channel = dst.channels[index]
          if (!channel) continue
          if (dataset.direction === 'OUTPUT') {
            if (!channel.bad) writeWords(memory, dataset, index, encodeValue(dataset.dataType, channel.value))
          } else if (linked) {
            channel.value = decodeValue(dataset.dataType, readWords(memory, dataset, index))
          }
        }
      }
    }
  }

  // The master walks its datasets one transaction at a time.
  const masterId: SerialPortId | undefined = p1.mode === 'MASTER' ? 'P01' : p2.mode === 'MASTER' ? 'P02' : undefined
  for (const portId of SERIAL_PORT_IDS) {
    const port = config.ports[portId]
    if (port.mode !== 'MASTER') continue
    const runtime = card.runtime.ports[portId]
    const queue = Object.values(port.devices).flatMap((device) =>
      Object.values(device.datasets).map((dataset) => ({ device, dataset, key: datasetKey(portId, device.name, dataset.name) }))
    )
    if (!port.enabled || down || !queue.length) {
      for (const item of queue) runtime.status[item.key] = 'BAD'
      continue
    }
    const slaveId: SerialPortId = portId === 'P01' ? 'P02' : 'P01'
    const slave = config.ports[slaveId]
    if (!card.runtime.started) {
      for (const item of queue) {
        if (item.dataset.direction !== 'OUTPUT') continue
        const channels = channelsOf(hw, source.id, portId, item.device.name, item.dataset.name)?.channels ?? []
        runtime.lastSent[item.key] = port.sendOutputsOnStartup ? [] : channels.map((c) => c.value)
      }
    }
    let budget = runtime.carryMs + dt * 1000
    for (let guard = 0; guard < 64 && budget > 0; guard++) {
      const item = queue[runtime.cursor % queue.length]
      const dst = channelsOf(hw, source.id, portId, item.device.name, item.dataset.name)
      const slaveDevice = Object.values(slave.devices).find((d) => d.address === item.device.address)
      const reachable = tied && !mismatch && roleOk && masterId === portId && slave.enabled && slave.mode === 'SLAVE' && !!slaveDevice
      const words = datasetSpan(item.dataset)
      if (!reachable || !dst) {
        const limit = (port.retryCount + 1) * port.timeoutMs
        const spent = runtime.failMs[item.key] ?? 0
        const take = Math.min(budget, limit - spent)
        runtime.failMs[item.key] = spent + take
        budget -= take
        runtime.retries = Math.floor(runtime.failMs[item.key] / port.timeoutMs)
        if (runtime.failMs[item.key] >= limit) {
          runtime.status[item.key] = 'BAD'
          runtime.failMs[item.key] = 0
          runtime.cursor++
          runtime.messages += port.retryCount + 1
        } else break
        continue
      }
      const cost = transactionMs(port, words)
      if (budget < cost) break
      budget -= cost
      runtime.messages++
      runtime.failMs[item.key] = 0
      const memory = memoryFor(card.runtime, slaveId, item.device.address)
      if (item.dataset.direction === 'OUTPUT') {
        const last = runtime.lastSent[item.key] ?? []
        const changed = dst.channels.map((channel, index) => last[index] === undefined || last[index] !== channel.value)
        if (changed.some(Boolean)) {
          if (item.dataset.outputMode === 'COMPLETE_BLOCK') {
            dst.channels.forEach((channel, index) => writeWords(memory, item.dataset, index, encodeValue(item.dataset.dataType, channel.value)))
          } else {
            dst.channels.forEach((channel, index) => {
              if (changed[index]) writeWords(memory, item.dataset, index, encodeValue(item.dataset.dataType, channel.value))
            })
          }
          runtime.lastSent[item.key] = dst.channels.map((channel) => channel.value)
        } else if (item.dataset.outputReadback) {
          dst.channels.forEach((channel, index) => {
            const value = decodeValue(item.dataset.dataType, readWords(memory, item.dataset, index))
            if (value !== channel.value) {
              channel.value = value
              runtime.lastSent[item.key][index] = value
            }
          })
        }
      } else {
        dst.channels.forEach((channel, index) => {
          channel.value = decodeValue(item.dataset.dataType, readWords(memory, item.dataset, index))
        })
      }
      runtime.status[item.key] = 'GOOD'
      runtime.cursor++
    }
    runtime.carryMs = Math.min(budget, 60000)
  }
  card.runtime.started = true
  return card
}
