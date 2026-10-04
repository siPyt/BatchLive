import { useState } from 'react'
import { useStore } from '../engine/store'
import type { SfcConfiguration } from '../engine/sfcLifecycle'
import { cloneSfcBlocks } from '../engine/sfcBlocks'
import type { AlarmPriority } from '../engine/types'
import { SimulatorDialog } from './SimulatorDialog'

type Kind = 'block' | 'type' | 'alarm'
const TITLES: Record<Kind, string> = { block: 'Function Block', type: 'Alarm Type', alarm: 'SFC Alarm' }

export function SfcBlockAlarmControls({ name }: { name: string }): JSX.Element | null {
  const lifecycle = useStore(s => s.sfcLifecycle[name])
  const runtime = useStore(s => s.sfcs[name])
  const [editing, setEditing] = useState<{ kind: Kind; entry?: string; configuration: SfcConfiguration } | null>(null)
  if (!lifecycle || !runtime) return null
  const configuration = lifecycle.online ? lifecycle.deployed : lifecycle.draft
  const editable = !lifecycle.online && (runtime.status === 'READY' || runtime.status === 'COMPLETE')
  return <div className="traditional-note">
    <div className="sfc-edit-row"><b>{lifecycle.online ? 'Online' : 'Configured'} function blocks and custom alarms</b>
      {(['block', 'type', 'alarm'] as const).map(kind => <button key={kind} className="tbtn sm" disabled={!editable}
        onClick={() => setEditing({ kind, configuration: lifecycle.draft })}>Add {TITLES[kind]}...</button>)}
    </div>
    {Object.entries(configuration?.blocks ?? {}).map(([block, definition]) => <div className="sfc-edit-row" key={block}>
      <span>{block}: {definition.type}, action time {definition.op} {definition.seconds}s
        {lifecycle.online && ` — ${runtime.blockStates?.[block]?.active ? 'Active' : 'Inactive'}, OUT=${runtime.blockStates?.[block]?.out ?? 0}`}</span>
      <button className="tbtn sm" disabled={!editable}
        onClick={() => setEditing({ kind: 'block', entry: block, configuration: lifecycle.draft })}>Block Properties: {block}</button>
    </div>)}
    {Object.entries(configuration?.alarmTypes ?? {}).map(([type, definition]) => <div className="sfc-edit-row" key={type}>
      <span>{type}: {definition.description} ({definition.priority})</span>
      <button className="tbtn sm" disabled={!editable}
        onClick={() => setEditing({ kind: 'type', entry: type, configuration: lifecycle.draft })}>Alarm Type Properties: {type}</button>
    </div>)}
    {Object.entries(configuration?.alarms ?? {}).map(([alarm, definition]) => <div className="sfc-edit-row" key={alarm}>
      <span>{alarm}: {definition.type}, {definition.block}/OUT, {definition.enabled ? 'Enabled' : 'Disabled'}</span>
      <button className="tbtn sm" disabled={!editable}
        onClick={() => setEditing({ kind: 'alarm', entry: alarm, configuration: lifecycle.draft })}>Alarm Properties: {alarm}</button>
    </div>)}
    <p>ALARM action-time monitors and custom alarm types are local to this saved/deployed SFC.
      Add a Non-Boolean action referencing the block to execute it; use S to monitor across steps until R or completion.
      Global Alarm Type setup, arbitrary block palettes/wiring and other non-Boolean blocks remain unsupported.</p>
    {editing && <Properties name={name} {...editing} onClose={() => setEditing(null)} />}
  </div>
}

function Properties({ name, kind, entry, configuration, onClose }: {
  name: string; kind: Kind; entry?: string; configuration: SfcConfiguration; onClose: () => void
}): JSX.Element {
  const block = entry ? configuration.blocks?.[entry] : undefined
  const type = entry ? configuration.alarmTypes?.[entry] : undefined
  const alarm = entry ? configuration.alarms?.[entry] : undefined
  const [entryName, setEntryName] = useState(entry ?? '')
  const [op, setOp] = useState<'>' | '>='>(block?.op ?? '>')
  const [seconds, setSeconds] = useState(String(block?.seconds ?? 30))
  const [description, setDescription] = useState(type?.description ?? 'Sequence time exceeded')
  const [priority, setPriority] = useState<AlarmPriority>(type?.priority ?? 'WARNING')
  const [alarmType, setAlarmType] = useState(alarm?.type ?? '')
  const [alarmBlock, setAlarmBlock] = useState(alarm?.block ?? '')
  const [enabled, setEnabled] = useState(alarm?.enabled ?? true)
  const [error, setError] = useState('')
  const apply = (): void => {
    const map = kind === 'block' ? configuration.blocks : kind === 'type' ? configuration.alarmTypes : configuration.alarms
    if (!entry && Object.hasOwn(map ?? {}, entryName)) {
      const message = `${TITLES[kind]} already exists; open its Properties`
      setError(message); useStore.getState().logEvent('DIAGNOSTIC', name, message); return
    }
    const next = cloneSfcBlocks(configuration)
    if (kind === 'block') next.blocks = { ...next.blocks, [entryName]: {
      type: 'ALARM', source: 'ACTION_TIME', op, seconds: seconds.trim() ? Number(seconds) : NaN
    } }
    else if (kind === 'type') next.alarmTypes = { ...next.alarmTypes, [entryName]: { description, priority } }
    else next.alarms = { ...next.alarms, [entryName]: { type: alarmType, block: alarmBlock, enabled } }
    if (useStore.getState().configureSfcBlocks(name, next, configuration)) onClose()
    else setError('Properties were not applied; see the reported validation, permission or staleness error.')
  }
  return <SimulatorDialog className="sfc-properties-dialog" label={`${TITLES[kind]} Properties`} onClose={onClose}>
    <h3>{TITLES[kind]} Properties — {name}</h3>
    <label>Name<input aria-label={`${TITLES[kind]} name`} disabled={!!entry} value={entryName}
      onChange={e => setEntryName(e.target.value)} /></label>
    {kind === 'block' && <>
      <p>Type: ALARM. Source: elapsed time of the owning qualified action, in seconds.
        The ALARM block uses the shared function-block execution engine, not a precomputed alarm badge.</p>
      <label>Comparison<select aria-label="Block time comparison" value={op}
        onChange={e => setOp(e.target.value === '>=' ? '>=' : '>')}>
        <option value=">">&gt;</option><option value=">=">&gt;=</option>
      </select></label>
      <label>Threshold seconds<input aria-label="Block time threshold" type="number" min={0} step="any" value={seconds}
        onChange={e => setSeconds(e.target.value)} /></label>
    </>}
    {kind === 'type' && <>
      <label>Description<input aria-label="Alarm Type description" value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label>Priority<select aria-label="Alarm Type priority" value={priority} onChange={e => setPriority(e.target.value as AlarmPriority)}>
        <option>CRITICAL</option><option>WARNING</option><option>ADVISORY</option>
      </select></label>
    </>}
    {kind === 'alarm' && <>
      <label>Alarm Type<select aria-label="SFC Alarm type" value={alarmType} onChange={e => setAlarmType(e.target.value)}>
        <option value="">Select a custom type</option>
        {Object.keys(configuration.alarmTypes ?? {}).map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label>Function Block<select aria-label="SFC Alarm block" value={alarmBlock} onChange={e => setAlarmBlock(e.target.value)}>
        <option value="">Select an ALARM block</option>
        {Object.keys(configuration.blocks ?? {}).map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label><input aria-label="SFC Alarm enabled" type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enabled</label>
    </>}
    <p>OK edits only the offline draft. Save and confirmed Download are required before the deployed algorithm changes.</p>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row"><button className="tbtn sm" onClick={apply}>OK</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button></div>
  </SimulatorDialog>
}
