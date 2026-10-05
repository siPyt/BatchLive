import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { SimulatorDialog } from './SimulatorDialog'
import { conditionDelayAlarmDefError, conditionDelayAlarmMessage, type ConditionDelayAlarmDef } from '../engine/conditionDelayAlarms'

/** DV09-047 Setup UI: a named two-condition conjunction + strict elapsed-
 * delay custom advisory, bound to a deployed custom alarm type (Pass59). */
export function ConditionDelayAlarmControls({ selected, onSelect, createRequest, onRequestsHandled }: {
  selected: string | null; onSelect: (name: string) => void
  createRequest: number; onRequestsHandled: () => void
}): JSX.Element {
  const defs = useStore((s) => s.conditionDelayAlarms)
  const runtime = useStore((s) => s.conditionDelayAlarmRuntime)
  const customAlarmTypes = useStore((s) => s.customAlarmTypes.deployed)
  const modules = useStore((s) => s.modules)
  const alarms = useStore((s) => s.alarms)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<{ name: string; def: ConditionDelayAlarmDef } | null>(null)
  useEffect(() => {
    if (createRequest > 0) { setCreating(true); onRequestsHandled() }
  }, [createRequest, onRequestsHandled])

  const typeNames = Object.keys(customAlarmTypes)
  const definition = selected ? defs[selected] : undefined
  const live = selected ? alarms.find((a) => a.id === `CONDALM.${selected}`) : undefined
  const elapsed = selected ? runtime[selected]?.elapsed : undefined

  return (
    <div className="exp-props">
      <h3>Setup — Condition Alarms</h3>
      <p className="traditional-note">
        DV09-047: a named conjunction of two conditions (e.g. a level exceeding a limit AND a valve
        remaining closed) that must both hold true for a strict elapsed delay before the alarm
        activates; it resets to zero the instant either condition clears and can reactivate on a
        later qualifying period. Bound to a deployed custom alarm type for its word/priority/message.
      </p>
      <div className="sfc-edit-row">
        <button className="tbtn sm" disabled={typeNames.length === 0}
          title={typeNames.length === 0 ? 'Define and deploy a custom alarm type first' : undefined}
          onClick={() => { setEditing(null); setCreating(true) }}>New Condition Alarm...</button>
      </div>
      <table className="studio-param-table">
        <thead><tr><th>Name</th><th>Type</th><th>Condition A</th><th>Condition B</th><th>Delay (s)</th><th>Elapsed</th><th>State</th><th>Edit</th><th>Delete</th></tr></thead>
        <tbody>
          {Object.entries(defs).map(([name, def]) => {
            const row = alarms.find((a) => a.id === `CONDALM.${name}`)
            return (
              <tr key={name} className={selected === name ? 'sel' : undefined}>
                <td><button className="fp-link-btn" onClick={() => onSelect(name)}>{name}</button></td>
                <td>{def.customType}</td>
                <td>{def.conditionA}</td>
                <td>{def.conditionB}</td>
                <td>{def.delaySeconds}</td>
                <td>{(runtime[name]?.elapsed ?? 0).toFixed(1)}</td>
                <td>{row?.active ? 'ACTIVE' : 'Normal'}</td>
                <td><button className="tbtn sm" onClick={() => { onSelect(name); setEditing({ name, def }) }}>Edit...</button></td>
                <td><button className="tbtn sm" onClick={() => {
                  if (window.confirm(`Delete condition alarm ${name}?`)) useStore.getState().deleteConditionDelayAlarm(name)
                }}>Delete</button></td>
              </tr>
            )
          })}
          {Object.keys(defs).length === 0 && <tr><td colSpan={9} className="exp-empty sm">No condition alarms configured</td></tr>}
        </tbody>
      </table>
      {definition && (
        <>
          <h3>{selected} — captured message preview</h3>
          <p>{live ? conditionDelayAlarmMessage(definition, customAlarmTypes, modules) ?? '(custom type not deployed)' : '(not active)'}</p>
          <p>Elapsed conjunction time: {(elapsed ?? 0).toFixed(1)}s of {definition.delaySeconds}s required</p>
        </>
      )}
      {(creating || editing) && (
        <ConditionDelayAlarmProperties
          initialName={editing?.name ?? ''}
          initialDef={editing?.def ?? { hostTag: '', customType: typeNames[0] ?? '', conditionA: '', conditionB: '', delaySeconds: 20 }}
          renameDisabled={!!editing}
          typeNames={typeNames}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={(name) => { onSelect(name); setCreating(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function ConditionDelayAlarmProperties({ initialName, initialDef, renameDisabled, typeNames, onClose, onSaved }: {
  initialName: string; initialDef: ConditionDelayAlarmDef; renameDisabled: boolean; typeNames: string[]
  onClose: () => void; onSaved: (name: string) => void
}): JSX.Element {
  const [name, setName] = useState(initialName)
  const [def, setDef] = useState<ConditionDelayAlarmDef>({ ...initialDef })
  const [delayText, setDelayText] = useState(String(initialDef.delaySeconds))
  const [error, setError] = useState('')
  return (
    <SimulatorDialog className="sfc-properties-dialog" label="Condition Alarm Properties" onClose={onClose}>
      <h3>Condition Alarm Properties</h3>
      <label>Name
        <input aria-label="Condition alarm name" value={name} disabled={renameDisabled}
          onChange={(e) => setName(e.target.value.toUpperCase())} />
      </label>
      <label>Host module tag
        <input aria-label="Condition alarm host module tag" value={def.hostTag}
          onChange={(e) => setDef({ ...def, hostTag: e.target.value.toUpperCase() })} />
      </label>
      <label>Custom alarm type (deployed)
        <select aria-label="Condition alarm custom type" value={def.customType}
          onChange={(e) => setDef({ ...def, customType: e.target.value })}>
          {typeNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label>Condition A (e.g. &apos;//LI-101/AI1/PV&apos; &gt; 900)
        <input aria-label="Condition A expression" value={def.conditionA}
          onChange={(e) => setDef({ ...def, conditionA: e.target.value })} />
      </label>
      <label>Condition B (e.g. &apos;//XVSTAT-101/DI1/PV_D&apos; = 0)
        <input aria-label="Condition B expression" value={def.conditionB}
          onChange={(e) => setDef({ ...def, conditionB: e.target.value })} />
      </label>
      <label>Delay (seconds, strict)
        <input aria-label="Condition alarm delay seconds" type="number" step="any" min={0}
          value={delayText} onChange={(e) => setDelayText(e.target.value)} />
      </label>
      <p>Both conditions must hold true continuously for longer than the configured delay; the timer
        resets to zero the instant either condition clears.</p>
      {error && <p role="alert">{error}</p>}
      <div className="sfc-edit-row">
        <button className="tbtn sm" onClick={() => {
          const candidate = { ...def, delaySeconds: delayText.trim() ? Number(delayText) : NaN }
          const validation = conditionDelayAlarmDefError(candidate, useStore.getState().modules, useStore.getState().customAlarmTypes.deployed)
          if (validation) { setError(validation); return }
          if (useStore.getState().defineConditionDelayAlarm(name, candidate)) onSaved(name)
          else setError('Condition alarm was not saved. See the reported validation/permission error.')
        }}>OK</button>
        <button className="tbtn sm" onClick={onClose}>Cancel</button>
      </div>
    </SimulatorDialog>
  )
}
