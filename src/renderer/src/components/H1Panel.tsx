import { useState } from 'react'
import { useStore } from '../engine/store'
import * as act from '../engine/fieldbusActions'
import {
  FF_CATALOG,
  H1_LIMITS,
  H1_PORT_IDS,
  MACROCYCLE_BANDS_MS,
  CABLE_MAX_M,
  cableBudget,
  blockCounts,
  type CableSegment,
  type CableType,
  catalogEntry,
  linkCounts,
  macrocycleViewer,
  portMacrocycle,
  type FfDevice,
  type FfMode,
  type H1Card,
  type H1PortId
} from '../engine/fieldbus'
import { controllerIsDown } from '../engine/hardware'

type Result = string | null

/** DV09-096..127 FOUNDATION fieldbus H1: card, ports, macrocycles, devices, blocks, audit trail and compare. */
export function H1Panel({ controllerTag }: { controllerTag: string }): JSX.Element {
  const hardware = useStore((s) => s.hardware)
  const [slot, setSlot] = useState(6)
  const [redundant, setRedundant] = useState(false)
  const [message, setMessage] = useState<Result>(null)
  const cards = Object.values(hardware.h1Cards ?? {}).filter((c) => c.controllerTag === controllerTag).sort((a, b) => a.slot - b.slot)
  return (
    <section className="serial-io h1-io" aria-label={`${controllerTag} fieldbus H1`}>
      <div className="batch-panel-head">FOUNDATION fieldbus H1 Cards</div>
      <p className="traditional-note">
        Series 2 H1 interface (simplex, or a redundant pair starting in an odd slot) with two ports. Each port is a segment with a link active
        scheduler, up to {H1_LIMITS.publishers} publishers, {H1_LIMITS.subscribers} subscribers and {H1_LIMITS.totalVcrs} VCRs, and four
        simultaneous macrocycles; a card runs {H1_LIMITS.totalBlocks} blocks ({H1_LIMITS.deviceBlocks} in devices, {H1_LIMITS.cardBlocks} in the card).
        This is a virtual training model with generic devices: no FOUNDATION stack, device descriptions or electrical segment is simulated.
      </p>
      <div className="traditional-toolbar">
        <label>
          Slot <input aria-label={`${controllerTag} new H1 slot`} type="number" min={1} max={8} value={slot} onChange={(e) => setSlot(Number(e.target.value))} />
        </label>
        <label>
          <input aria-label={`${controllerTag} redundant H1`} type="checkbox" checked={redundant} onChange={(e) => setRedundant(e.target.checked)} /> Redundant
        </label>
        <button className="tbtn sm" onClick={() => setMessage(act.addH1Card(controllerTag, slot, redundant))}>
          New H1 Card
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      <CableBudget />
      {cards.map((card) => (
        <H1CardEditor key={card.id} card={card} controllerUp={!!hardware.controllers[card.controllerTag] && !controllerIsDown(hardware.controllers[card.controllerTag])} />
      ))}
    </section>
  )
}

function Led({ label, state }: { label: string; state: 'green' | 'red' | 'amber' | 'off' }): JSX.Element {
  return (
    <span className={`led led-${state}`} data-led={label} title={`${label}: ${state}`} style={{ marginRight: 10 }}>
      ● {label} {state}
    </span>
  )
}

function H1CardEditor({ card, controllerUp }: { card: H1Card; controllerUp: boolean }): JSX.Element {
  const [message, setMessage] = useState<Result>(null)
  const counts = blockCounts(card)
  const failed = card.cardFailed || !controllerUp
  return (
    <div className="traditional-card" data-h1-card={card.id}>
      <div className="exp-newmod-title">
        {card.id} — H1 {card.redundant ? `redundant pair (slots ${card.slot}/${card.partnerSlot})` : 'simplex'} Series {card.series} ·{' '}
        {card.downloaded ? 'downloaded' : 'not downloaded'}
      </div>
      <div>
        <Led label="Power" state={controllerUp ? 'green' : 'off'} />
        <Led label="Failure" state={failed ? 'red' : 'off'} />
        {H1_PORT_IDS.map((id) => {
          const rt = card.runtime[id]
          const port = card.ports[id]
          const state = !port.enabled || !card.downloaded ? 'off' : rt.lasAddress === null ? 'red' : rt.liveList.length ? 'green' : 'amber'
          return <Led key={id} label={id} state={state} />
        })}
        <span>
          Blocks: {counts.device}/{H1_LIMITS.deviceBlocks} device, {counts.card}/{H1_LIMITS.cardBlocks} card ({counts.total}/{H1_LIMITS.totalBlocks})
        </span>
      </div>
      <div className="traditional-toolbar">
        <button className="tbtn sm" onClick={() => setMessage(act.downloadH1Card(card.id))}>
          Download H1 Card
        </button>
        <button className="tbtn sm" onClick={() => setMessage(act.failH1Card(card.id, !card.cardFailed))}>
          {card.cardFailed ? 'Restore Card' : 'Fail Card'}
        </button>
        <button className="tbtn sm" onClick={() => setMessage(act.removeH1Card(card.id))}>
          Remove Card
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {H1_PORT_IDS.map((id) => (
        <H1PortEditor key={id} card={card} portId={id} />
      ))}
    </div>
  )
}

function H1PortEditor({ card, portId }: { card: H1Card; portId: H1PortId }): JSX.Element {
  const port = card.ports[portId]
  const rt = card.runtime[portId]
  const [message, setMessage] = useState<Result>(null)
  const [description, setDescription] = useState(port.description)
  const [tag, setTag] = useState('PT-101')
  const [address, setAddress] = useState(20)
  const [catalogId, setCatalogId] = useState(FF_CATALOG[0].id)
  const [revision, setRevision] = useState(2)
  const [ddRevision, setDdRevision] = useState(2)
  const macro = portMacrocycle(port)
  const viewer = macrocycleViewer(port)
  const vcr = linkCounts(port)
  const inventory = act.ffInventory(card, portId)
  const label = `${card.id} ${portId}`
  return (
    <details className="traditional-channel" open={port.enabled}>
      <summary>
        <span>{portId} segment</span>
        <span>
          {port.enabled ? 'Enabled' : 'Disabled'} · LAS {rt.lasAddress ?? 'none'} · live {rt.liveList.length} · cycles {rt.cycle}
        </span>
      </summary>
      <div className="traditional-channel-form">
        <label>
          <input aria-label={`${label} enabled`} type="checkbox" checked={port.enabled} onChange={(e) => setMessage(act.configureH1Port(card.id, portId, { enabled: e.target.checked }))} /> Enabled
        </label>
        <label>
          Description <input aria-label={`${label} description`} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => setMessage(act.configureH1Port(card.id, portId, { description }))} />
        </label>
        <label>
          Requested macrocycle{' '}
          <select aria-label={`${label} macrocycle`} value={port.requestedMacrocycleMs} onChange={(e) => setMessage(act.configureH1Port(card.id, portId, { requestedMacrocycleMs: Number(e.target.value) }))}>
            {MACROCYCLE_BANDS_MS.map((band) => (
              <option key={band} value={band}>{band / 1000} s</option>
            ))}
          </select>
        </label>
        <label>
          Minimum CD spacing (ms) <input aria-label={`${label} CD spacing`} type="number" value={port.minCdSpacingMs} onChange={(e) => setMessage(act.configureH1Port(card.id, portId, { minCdSpacingMs: Number(e.target.value) }))} />
        </label>
        <p data-macrocycle>
          Macrocycle: requested {macro.requestedMs / 1000} s · calculated {macro.calculatedMs / 1000} s · actual {macro.actualMs / 1000} s · VCRs {vcr.publishers} publishers /{' '}
          {vcr.subscribers} subscribers / {vcr.total} total (max {H1_LIMITS.publishers}/{H1_LIMITS.subscribers}/{H1_LIMITS.totalVcrs}) · unscheduled queued {rt.unscheduledQueued}
        </p>
        <table className="exp-table">
          <thead>
            <tr><th>Macrocycle viewer</th><th>Calculated</th><th>Actual</th><th>Blocks</th></tr>
          </thead>
          <tbody>
            {viewer.rows.map((row) => (
              <tr key={row.bandMs}><td>{row.bandMs / 1000} s</td><td>{row.calculatedMs / 1000} s</td><td>{row.actualMs / 1000} s</td><td>{row.blocks.join(', ')}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="exp-newmod-title">Device port rescan (live inventory)</div>
        <table className="exp-table" data-inventory>
          <thead>
            <tr><th>Address</th><th>Device ID</th><th>Tag</th><th>State</th><th>Integrity</th><th>Model</th><th>Rev / DD</th><th /></tr>
          </thead>
          <tbody>
            {inventory.map((row) => (
              <tr key={`${row.address}-${row.deviceId}-${row.tag}`}>
                <td>{row.address}</td><td>{row.deviceId}</td><td>{row.tag}</td><td>{row.state}</td><td>{row.integrity}</td><td>{row.model}</td><td>{row.revision} / {row.ddRevision}</td>
                <td>
                  {row.deviceId && card.field[row.deviceId] && (
                    <>
                      <button className="tbtn sm" onClick={() => setMessage(act.setFieldDevice(card.id, row.deviceId, { communicating: !card.field[row.deviceId].communicating }))}>
                        {card.field[row.deviceId].communicating ? 'Disconnect' : 'Reconnect'}
                      </button>
                      <button className="tbtn sm" onClick={() => { const r = act.detachFieldDevice(card.id, row.deviceId); setMessage(r) }}>Remove from segment</button>
                      {Object.values(port.devices).filter((d) => d.state !== 'COMMISSIONED' && d.catalogId === card.field[row.deviceId].catalogId).map((d) => (
                        <button key={d.tag} className="tbtn sm" onClick={() => setMessage(act.commissionFfDevice(card.id, d.tag, row.deviceId, 'Commissioned from the segment inventory'))}>
                          Commission as {d.tag}
                        </button>
                      ))}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="traditional-toolbar">
          <label>Tag <input aria-label={`${label} new device tag`} value={tag} onChange={(e) => setTag(e.target.value)} /></label>
          <label>Address <input aria-label={`${label} new device address`} type="number" value={address} onChange={(e) => setAddress(Number(e.target.value))} /></label>
          <label>
            Type{' '}
            <select aria-label={`${label} new device type`} value={catalogId} onChange={(e) => { setCatalogId(e.target.value); setRevision(catalogEntry(e.target.value)?.revisions[0] ?? 1); setDdRevision(catalogEntry(e.target.value)?.ddRevisions[0] ?? 1) }}>
              {FF_CATALOG.map((entry) => <option key={entry.id} value={entry.id}>{entry.model}</option>)}
            </select>
          </label>
          <label>Revision <input aria-label={`${label} new device revision`} type="number" value={revision} onChange={(e) => setRevision(Number(e.target.value))} /></label>
          <label>DD <input aria-label={`${label} new device DD`} type="number" value={ddRevision} onChange={(e) => setDdRevision(Number(e.target.value))} /></label>
          <button className="tbtn sm" onClick={() => setMessage(act.addFfDevice(card.id, portId, tag.trim(), address, catalogId, revision, ddRevision))}>New Device Placeholder</button>
          <button className="tbtn sm" onClick={() => { const r = act.attachFieldDevice(card.id, { port: portId, catalogId, address, revision, ddRevision }); setMessage('error' in r ? r.error : null) }}>
            Attach Virtual Device
          </button>
        </div>
        {message && <p role="alert">{message}</p>}
        {Object.values(port.devices).map((device) => <FfDeviceEditor key={device.tag} card={card} device={device} />)}
      </div>
    </details>
  )
}

function FfDeviceEditor({ card, device }: { card: H1Card; device: FfDevice }): JSX.Element {
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<Result>(null)
  const [low, setLow] = useState(0)
  const [high, setHigh] = useState(100)
  const entry = catalogEntry(device.catalogId)
  return (
    <details className="traditional-channel" data-ff-device={device.tag}>
      <summary>
        <span>{device.tag} — {entry?.model}</span>
        <span>{device.state} · address {device.address} · rev {device.deviceRevision}</span>
      </summary>
      <div className="traditional-channel-form">
        <label>Reason for change <input aria-label={`${device.tag} reason`} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label>
          Resource block{' '}
          <select aria-label={`${device.tag} resource mode`} value={device.resource.mode} onChange={(e) => setMessage(act.setFfMode(card.id, device.tag, 'RESOURCE', e.target.value as FfMode, reason))}>
            <option>AUTO</option><option>OOS</option>
          </select>
        </label>
        <label>
          <input type="checkbox" aria-label={`${device.tag} write lock`} checked={device.resource.writeLock} onChange={(e) => setMessage(act.setFfWriteLock(card.id, device.tag, e.target.checked, reason))} /> Write lock
        </label>
        {device.transducers.map((t) => (
          <div key={t.tag}>
            Transducer {t.tag}{' '}
            <select aria-label={`${device.tag} ${t.tag} mode`} value={t.mode} onChange={(e) => setMessage(act.setFfMode(card.id, device.tag, t.tag, e.target.value as FfMode, reason))}>
              <option>AUTO</option><option>OOS</option>
            </select>{' '}
            trim {t.calibration.low}..{t.calibration.high}{' '}
            <input aria-label={`${device.tag} trim low`} type="number" value={low} onChange={(e) => setLow(Number(e.target.value))} />
            <input aria-label={`${device.tag} trim high`} type="number" value={high} onChange={(e) => setHigh(Number(e.target.value))} />
            <button className="tbtn sm" onClick={() => setMessage(act.calibrateFfTransducer(card.id, device.tag, t.tag, low, high, reason))}>Calibrate (virtual)</button>
          </div>
        ))}
        {device.blocks.map((b) => (
          <div key={b.tag}>
            {b.type} block {b.tag} · {b.executesIn === 'CARD' ? 'in card' : 'in device'} · {b.rateMs / 1000} s{' '}
            <select aria-label={`${device.tag} ${b.tag} mode`} value={b.mode} onChange={(e) => setMessage(act.setFfMode(card.id, device.tag, b.tag, e.target.value as FfMode, reason))}>
              <option>AUTO</option><option>MAN</option><option>OOS</option>
            </select>
          </div>
        ))}
        {device.state === 'COMMISSIONED' && (
          <button className="tbtn sm" onClick={() => setMessage(act.decommissionFfDevice(card.id, device.tag, reason))}>Decommission</button>
        )}
        <button className="tbtn sm" onClick={() => setMessage(act.removeFfDevice(card.id, device.tag))}>Remove Device</button>
        {message && <p role="alert">{message}</p>}
        <table className="exp-table" data-audit-trail={device.tag}>
          <thead><tr><th>#</th><th>Time</th><th>User</th><th>Type</th><th>Block</th><th>Parameter</th><th>Old</th><th>New</th><th>Reason</th><th>Method</th></tr></thead>
          <tbody>
            {device.history.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td><td>{new Date(h.time).toLocaleString()}</td><td>{h.user}</td><td>{h.type}</td><td>{h.block}</td><td>{h.parameter}</td>
                <td>{h.oldValue}</td><td>{h.newValue}</td><td>{h.reason}</td><td>{h.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** DV09-103 training-only segment cable budget: trunk plus every spur against the A/B/C/D maximum lengths. */
function CableBudget(): JSX.Element {
  const [segments, setSegments] = useState<CableSegment[]>([{ type: 'A', length: 0 }])
  const [unit, setUnit] = useState<'m' | 'ft'>('m')
  const result = cableBudget(segments, unit)
  return (
    <details className="traditional-channel" data-cable-budget>
      <summary>
        <span>Segment cable budget (training calculator)</span>
        <span>{result.error ?? `${result.ratio.toFixed(2)} of budget — ${result.acceptable ? 'acceptable' : 'NOT acceptable'}`}</span>
      </summary>
      <div className="traditional-channel-form">
        <p>
          Sum of (length / maximum length) over the trunk and every spur must not exceed 1. Maximums: A {CABLE_MAX_M.A} m, B {CABLE_MAX_M.B} m, C {CABLE_MAX_M.C} m, D {CABLE_MAX_M.D} m.
          This is a lesson aid; it does not certify an installation.
        </p>
        <label>
          Unit{' '}
          <select aria-label="Cable length unit" value={unit} onChange={(e) => setUnit(e.target.value as 'm' | 'ft')}>
            <option value="m">meters</option>
            <option value="ft">feet</option>
          </select>
        </label>
        {segments.map((segment, index) => (
          <div key={index}>
            <select aria-label={`Cable ${index + 1} type`} value={segment.type} onChange={(e) => setSegments(segments.map((s, i) => (i === index ? { ...s, type: e.target.value as CableType } : s)))}>
              {(['A', 'B', 'C', 'D'] as const).map((type) => <option key={type}>{type}</option>)}
            </select>
            <input aria-label={`Cable ${index + 1} length`} type="number" value={segment.length} onChange={(e) => setSegments(segments.map((s, i) => (i === index ? { ...s, length: Number(e.target.value) } : s)))} />
            <button className="tbtn sm" onClick={() => setSegments(segments.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button className="tbtn sm" onClick={() => setSegments([...segments, { type: 'A', length: 0 }])}>Add trunk/spur</button>
      </div>
    </details>
  )
}