import { useState } from 'react'
import { useStore } from '../engine/store'
import {
  PLC_TABLE_LABEL,
  SERIAL_BAUD_RATES,
  SERIAL_DATA_TYPE_LABEL,
  SERIAL_LIMITS,
  SERIAL_PORT_IDS,
  datasetDstName,
  modbusAddress,
  serialDstCount,
  type PlcTable,
  type SerialCard,
  type SerialDataType,
  type SerialDatasetConfig,
  type SerialPortConfig,
  type SerialPortId
} from '../engine/serialIo'

const newDataset = (): SerialDatasetConfig => ({
  name: 'DS01',
  description: '',
  direction: 'OUTPUT',
  outputMode: 'COMPLETE_BLOCK',
  outputReadback: false,
  dataType: 'INT16',
  tag: '',
  plcTable: 'HOLDING_REGISTERS',
  plcBase: 0,
  plcOffset: 0,
  count: 1
})

/** DV09-086..093 Serial Interface: serial card, port properties, devices and datasets (Modbus master/slave). */
export function SerialIoPanel({ controllerTag }: { controllerTag: string }): JSX.Element {
  const hardware = useStore((s) => s.hardware)
  const addCard = useStore((s) => s.addSerialCard)
  const [slot, setSlot] = useState(5)
  const [message, setMessage] = useState<string | null>(null)
  const cards = Object.values(hardware.serialCards ?? {})
    .filter((card) => card.controllerTag === controllerTag)
    .sort((a, b) => a.slot - b.slot)
  return (
    <section className="serial-io" aria-label={`${controllerTag} serial interface`}>
      <div className="batch-panel-head">Serial Interface Cards</div>
      <p className="traditional-note">
        Two-port serial card speaking Modbus RTU or ASCII as master or slave: up to {SERIAL_LIMITS.devicesPerPort} devices and{' '}
        {SERIAL_LIMITS.datasetsPerPort} datasets per port, {SERIAL_LIMITS.valuesPerDataset} values per dataset, and{' '}
        {SERIAL_LIMITS.dstCapacity} DSTs (or {SERIAL_LIMITS.scadaCapacity} SCADA points). The ports exchange data over a
        virtual tie-back; no serial hardware, wiring or vendor driver is simulated. Configuration takes effect only after
        Download Serial Card.
      </p>
      <div className="traditional-toolbar">
        <label>
          Slot{' '}
          <input aria-label={`${controllerTag} new serial card slot`} type="number" min={1} max={8} value={slot} onChange={(e) => setSlot(Number(e.target.value))} />
        </label>
        <button className="tbtn sm" onClick={() => setMessage(addCard(controllerTag, slot, false))}>
          New Serial Card
        </button>
        <button className="tbtn sm" onClick={() => setMessage(addCard(controllerTag, slot, true))}>
          New Placeholder
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {cards.map((card) => (
        <SerialCardEditor key={card.id} card={card} />
      ))}
    </section>
  )
}

function SerialCardEditor({ card }: { card: SerialCard }): JSX.Element {
  const configureCard = useStore((s) => s.configureSerialCard)
  const download = useStore((s) => s.downloadSerialCard)
  const remove = useStore((s) => s.removeSerialCard)
  const [message, setMessage] = useState<string | null>(null)
  const config = card.configured
  const capacity = config.capacity === 'SCADA' ? SERIAL_LIMITS.scadaCapacity : SERIAL_LIMITS.dstCapacity
  const dirty = JSON.stringify(card.deployed ?? null) !== JSON.stringify(config)
  return (
    <div className="traditional-card" data-serial-card={card.id}>
      <div className="exp-newmod-title">
        {card.id} — Serial Card{card.placeholder ? ' (placeholder)' : ''} ·{' '}
        {card.deployed ? (dirty ? 'download required' : 'downloaded') : 'not downloaded'}
      </div>
      <div className="traditional-toolbar">
        <label>
          <input
            type="checkbox"
            checked={config.tieback}
            aria-label={`${card.id} wire port 1 to port 2`}
            onChange={(e) => setMessage(configureCard(card.id, { tieback: e.target.checked }))}
          />{' '}
          Wire Port 1 to Port 2 (RS232 tie-back)
        </label>
        <label>
          Capacity{' '}
          <select
            aria-label={`${card.id} capacity`}
            value={config.capacity}
            onChange={(e) => setMessage(configureCard(card.id, { capacity: e.target.value as 'DST' | 'SCADA' }))}
          >
            <option value="DST">500 DSTs</option>
            <option value="SCADA">3200 SCADA points</option>
          </select>
        </label>
        <span>
          {serialDstCount(config)} / {capacity} values
        </span>
        <button className="tbtn sm" onClick={() => setMessage(download(card.id))}>
          Download Serial Card
        </button>
        <button className="tbtn sm" onClick={() => setMessage(remove(card.id))}>
          Remove Card
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {SERIAL_PORT_IDS.map((portId) => (
        <SerialPortEditor key={portId} card={card} portId={portId} />
      ))}
    </div>
  )
}

function SerialPortEditor({ card, portId }: { card: SerialCard; portId: SerialPortId }): JSX.Element {
  const configurePort = useStore((s) => s.configureSerialPort)
  const addDevice = useStore((s) => s.addSerialDevice)
  const removeDevice = useStore((s) => s.removeSerialDevice)
  const port = card.configured.ports[portId]
  const [draft, setDraft] = useState<Omit<SerialPortConfig, 'devices'>>(() => {
    const { devices: _devices, ...rest } = port
    return rest
  })
  const [error, setError] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState('DEV01')
  const [deviceAddress, setDeviceAddress] = useState(1)
  const label = `${card.id} ${portId}`
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]): void => setDraft({ ...draft, [key]: value })
  return (
    <details className="traditional-channel" open={port.enabled}>
      <summary>
        <span>
          {portId} — {port.mode === 'MASTER' ? 'Master' : 'Slave'}
        </span>
        <span>
          {port.enabled ? 'Enabled' : 'Disabled'} · {port.protocol} · {port.baud} baud · {Object.keys(port.devices).length} device(s)
        </span>
      </summary>
      <div className="traditional-channel-form">
        <label>
          Description <input aria-label={`${label} description`} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label>
          <input aria-label={`${label} enabled`} type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled
        </label>
        <fieldset>
          <legend>Advanced</legend>
          <label>
            Protocol type{' '}
            <select aria-label={`${label} protocol`} value={draft.protocol} onChange={(e) => set('protocol', e.target.value as 'RTU' | 'ASCII')}>
              <option>RTU</option>
              <option>ASCII</option>
            </select>
          </label>
          <label>
            Mode{' '}
            <select aria-label={`${label} mode`} value={draft.mode} onChange={(e) => set('mode', e.target.value as 'MASTER' | 'SLAVE')}>
              <option value="MASTER">Master</option>
              <option value="SLAVE">Slave</option>
            </select>
          </label>
          <label>
            Retry count <input aria-label={`${label} retry count`} type="number" value={draft.retryCount} onChange={(e) => set('retryCount', Number(e.target.value))} />
          </label>
          <label>
            Message time out (ms) <input aria-label={`${label} time out`} type="number" value={draft.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
          </label>
          <label>
            Transmit delay (ms) <input aria-label={`${label} transmit delay`} type="number" value={draft.transmitDelayMs} onChange={(e) => set('transmitDelayMs', Number(e.target.value))} />
          </label>
          <label>
            <input aria-label={`${label} send outputs on startup`} type="checkbox" checked={draft.sendOutputsOnStartup} onChange={(e) => set('sendOutputsOnStartup', e.target.checked)} /> Send outputs on startup
          </label>
        </fieldset>
        <fieldset>
          <legend>Communications</legend>
          <label>
            Port type{' '}
            <select aria-label={`${label} port type`} value={draft.portType} onChange={(e) => set('portType', e.target.value as SerialPortConfig['portType'])}>
              <option value="RS232">RS232</option>
              <option value="RS422_485_FULL">RS422/485 full duplex</option>
              <option value="RS422_485_HALF">RS422/485 half duplex</option>
            </select>
          </label>
          <label>
            Baud rate{' '}
            <select aria-label={`${label} baud rate`} value={draft.baud} onChange={(e) => set('baud', Number(e.target.value))}>
              {SERIAL_BAUD_RATES.map((rate) => (
                <option key={rate}>{rate}</option>
              ))}
            </select>
          </label>
          <label>
            Parity{' '}
            <select aria-label={`${label} parity`} value={draft.parity} onChange={(e) => set('parity', e.target.value as SerialPortConfig['parity'])}>
              <option value="NONE">None</option>
              <option value="EVEN">Even</option>
              <option value="ODD">Odd</option>
            </select>
          </label>
          <label>
            Data bits{' '}
            <select aria-label={`${label} data bits`} value={draft.dataBits} onChange={(e) => set('dataBits', Number(e.target.value) as 7 | 8)}>
              <option>7</option>
              <option>8</option>
            </select>
          </label>
          <label>
            Stop bits{' '}
            <select aria-label={`${label} stop bits`} value={draft.stopBits} onChange={(e) => set('stopBits', Number(e.target.value) as 1 | 2)}>
              <option>1</option>
              <option>2</option>
            </select>
          </label>
        </fieldset>
        <button className="tbtn sm" onClick={() => setError(configurePort(card.id, portId, draft))}>
          Apply Port Properties
        </button>
        {error && <p role="alert">{error}</p>}
        <div className="exp-newmod-title">Serial devices</div>
        {Object.values(port.devices).map((device) => (
          <div key={device.name}>
            <b>{device.name}</b> — address {device.address}{' '}
            <button className="tbtn sm" onClick={() => setError(removeDevice(card.id, portId, device.name))}>
              Remove Device
            </button>
            <DatasetList card={card} portId={portId} deviceName={device.name} />
          </div>
        ))}
        <div className="traditional-toolbar">
          <label>
            Name <input aria-label={`${label} new device name`} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </label>
          <label>
            Address <input aria-label={`${label} new device address`} type="number" value={deviceAddress} onChange={(e) => setDeviceAddress(Number(e.target.value))} />
          </label>
          <button className="tbtn sm" onClick={() => setError(addDevice(card.id, portId, deviceName.trim(), deviceAddress))}>
            New Serial Device
          </button>
        </div>
      </div>
    </details>
  )
}

function DatasetList({ card, portId, deviceName }: { card: SerialCard; portId: SerialPortId; deviceName: string }): JSX.Element {
  const saveDataset = useStore((s) => s.saveSerialDataset)
  const removeDataset = useStore((s) => s.removeSerialDataset)
  const device = card.configured.ports[portId].devices[deviceName]
  const [draft, setDraft] = useState<SerialDatasetConfig>(newDataset)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof SerialDatasetConfig>(key: K, value: SerialDatasetConfig[K]): void => setDraft({ ...draft, [key]: value })
  const label = `${card.id} ${portId} ${deviceName}`
  const status = card.runtime.ports[portId].status
  return (
    <div className="serial-datasets">
      <table className="exp-table">
        <thead>
          <tr>
            <th>Dataset</th>
            <th>Tag</th>
            <th>Direction</th>
            <th>Type</th>
            <th>PLC data</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Object.values(device.datasets).map((ds) => (
            <tr key={ds.name} data-dataset={ds.name}>
              <td>{ds.name}</td>
              <td>
                {ds.tag} ({datasetDstName(ds, 0)}
                {ds.count > 1 ? ` … ${datasetDstName(ds, ds.count - 1)}` : ''})
              </td>
              <td>{ds.direction === 'OUTPUT' ? 'Output' : 'Input'}</td>
              <td>{SERIAL_DATA_TYPE_LABEL[ds.dataType]}</td>
              <td>
                {PLC_TABLE_LABEL[ds.plcTable]} {modbusAddress(ds)} × {ds.count}
              </td>
              <td>{card.deployed ? (status[`${portId}/${deviceName}/${ds.name}`] ?? 'BAD') : 'not downloaded'}</td>
              <td>
                <button
                  className="tbtn sm"
                  onClick={() => {
                    setDraft({ ...ds })
                    setEditing(ds.name)
                  }}
                >
                  Edit
                </button>
                <button className="tbtn sm" onClick={() => setError(removeDataset(card.id, portId, deviceName, ds.name))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="traditional-channel-form">
        <b>{editing ? `Dataset ${editing}` : 'New Dataset'}</b>
        <label>
          Name <input aria-label={`${label} dataset name`} value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Description <input aria-label={`${label} dataset description`} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label>
          Data direction{' '}
          <select aria-label={`${label} data direction`} value={draft.direction} onChange={(e) => set('direction', e.target.value as 'INPUT' | 'OUTPUT')}>
            <option value="INPUT">Input</option>
            <option value="OUTPUT">Output</option>
          </select>
        </label>
        <label>
          Output mode{' '}
          <select aria-label={`${label} output mode`} value={draft.outputMode} onChange={(e) => set('outputMode', e.target.value as 'COMPLETE_BLOCK' | 'SINGLE_VALUE')}>
            <option value="COMPLETE_BLOCK">Complete block</option>
            <option value="SINGLE_VALUE">Single value</option>
          </select>
        </label>
        <label>
          <input aria-label={`${label} output read back`} type="checkbox" checked={draft.outputReadback} onChange={(e) => set('outputReadback', e.target.checked)} /> Output read back
        </label>
        <label>
          DeltaV data type{' '}
          <select aria-label={`${label} data type`} value={draft.dataType} onChange={(e) => set('dataType', e.target.value as SerialDataType)}>
            {(Object.keys(SERIAL_DATA_TYPE_LABEL) as SerialDataType[]).map((type) => (
              <option key={type} value={type}>
                {SERIAL_DATA_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dataset tag <input aria-label={`${label} dataset tag`} value={draft.tag} onChange={(e) => set('tag', e.target.value.toUpperCase())} />
        </label>
        <label>
          PLC data type{' '}
          <select aria-label={`${label} PLC data type`} value={draft.plcTable} onChange={(e) => set('plcTable', e.target.value as PlcTable)}>
            {(Object.keys(PLC_TABLE_LABEL) as PlcTable[]).map((table) => (
              <option key={table} value={table}>
                {PLC_TABLE_LABEL[table]}
              </option>
            ))}
          </select>
        </label>
        <label>
          PLC base register address <input aria-label={`${label} PLC base`} type="number" value={draft.plcBase} onChange={(e) => set('plcBase', Number(e.target.value))} />
        </label>
        <label>
          PLC register offset <input aria-label={`${label} PLC offset`} type="number" value={draft.plcOffset} onChange={(e) => set('plcOffset', Number(e.target.value))} />
        </label>
        <label>
          Number of values <input aria-label={`${label} number of values`} type="number" value={draft.count} onChange={(e) => set('count', Number(e.target.value))} />
        </label>
        <button
          className="tbtn sm"
          onClick={() => {
            const failure = saveDataset(card.id, portId, deviceName, draft, editing)
            setError(failure)
            if (!failure) {
              setDraft(newDataset())
              setEditing(undefined)
            }
          }}
        >
          {editing ? 'Save Dataset' : 'Create Dataset'}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  )
}
