import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { SimulatorDialog } from './SimulatorDialog'
import {
  changedCustomAlarmTypeNames, customAlarmTypeDefError, customAlarmTypeNameError, substituteAlarmMessage,
  type CustomAlarmTypeDef
} from '../engine/customAlarmTypes'
import type { AlarmPriority } from '../engine/types'

/** DV09-041 Setup UI: a project-wide registry of custom alarm types (up to
 * 255), each with a priority and a %P1/%P2 message template, independent of
 * a module's own fixed HI/LO/etc. AlarmLimit set. Mirrors the existing
 * Named Set configured/deployed + Download Changed Setup Data pattern. */
export function CustomAlarmTypeControls({ selected, onSelect, createRequest, onRequestsHandled }: {
  selected: string | null; onSelect: (name: string) => void
  createRequest: number; onRequestsHandled: () => void
}): JSX.Element {
  const state = useStore((s) => s.customAlarmTypes)
  const modules = useStore((s) => s.modules)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<{ name: string; def: CustomAlarmTypeDef } | null>(null)
  const [previewTag, setPreviewTag] = useState('')
  useEffect(() => {
    if (createRequest > 0) { setCreating(true); onRequestsHandled() }
  }, [createRequest, onRequestsHandled])

  const changes = changedCustomAlarmTypeNames(state)
  const definition = selected ? state.configured[selected] : undefined
  const deployed = selected ? state.deployed[selected] : undefined
  const moduleTags = Object.keys(modules)

  return (
    <div className="exp-props">
      <h3>Setup — Alarm Types</h3>
      <p className="traditional-note">
        Custom alarm types (DV09-041): up to 255 named types, each with a priority and a message template.
        %P1/%P2 in the template capture the live value of a configured parameter path at substitution time;
        an unresolved path substitutes "?", never a fabricated number. Changes require Download Changed Setup
        Data before they take effect, same as Named Sets.
      </p>
      <div className="sfc-edit-row">
        <button className="tbtn sm" onClick={() => { setEditing(null); setCreating(true) }}>New Alarm Type...</button>
      </div>
      <table className="studio-param-table">
        <thead><tr><th>Name</th><th>Priority</th><th>Message Template</th><th>%P1</th><th>%P2</th><th>Edit</th><th>Delete</th></tr></thead>
        <tbody>
          {Object.entries(state.configured).map(([name, def]) => (
            <tr key={name} className={selected === name ? 'sel' : undefined}>
              <td><button className="fp-link-btn" onClick={() => onSelect(name)}>{name}</button></td>
              <td>{def.priority}</td>
              <td>{def.messageTemplate}</td>
              <td>{def.p1Path ?? '—'}</td>
              <td>{def.p2Path ?? '—'}</td>
              <td><button className="tbtn sm" onClick={() => { onSelect(name); setEditing({ name, def }) }}>Edit...</button></td>
              <td>
                <button className="tbtn sm" onClick={() => {
                  if (window.confirm(`Delete custom alarm type ${name}?`)) useStore.getState().deleteCustomAlarmType(name)
                }}>Delete</button>
              </td>
            </tr>
          ))}
          {Object.keys(state.configured).length === 0 && (
            <tr><td colSpan={7} className="exp-empty sm">No custom alarm types configured</td></tr>
          )}
        </tbody>
      </table>

      <h3>Changed Setup Data — Alarm Types</h3>
      <p>{changes.length ? `Changed: ${changes.join(', ')}` : 'No alarm type setup changes.'}</p>
      <button className="tbtn sm" disabled={!changes.length} onClick={() => {
        if (window.confirm(`Download Changed Setup Data: ${changes.join(', ')}? This transfers the alarm type subset only.`)) {
          useStore.getState().downloadCustomAlarmTypeSetup()
        }
      }}>Download Changed Setup Data...</button>

      {definition && (
        <>
          <h3>{selected} — captured message preview</h3>
          <label>Preview on module
            <select aria-label="Alarm type message preview module" value={previewTag} onChange={(e) => setPreviewTag(e.target.value)}>
              <option value="">(choose a module)</option>
              {moduleTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
          {deployed ? (
            <p>Deployed message: {previewTag ? substituteAlarmMessage(previewTag, deployed, modules) : '(choose a module above)'}</p>
          ) : (
            <p>Not yet transferred to deployed setup (Download Changed Setup Data required).</p>
          )}
        </>
      )}

      {(creating || editing) && (
        <CustomAlarmTypeProperties
          initialName={editing?.name ?? ''}
          initialDef={editing?.def ?? { priority: 'WARNING', messageTemplate: '', p1Path: '', p2Path: '' }}
          renameDisabled={!!editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={(name) => { onSelect(name); setCreating(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function CustomAlarmTypeProperties({ initialName, initialDef, renameDisabled, onClose, onSaved }: {
  initialName: string; initialDef: CustomAlarmTypeDef; renameDisabled: boolean
  onClose: () => void; onSaved: (name: string) => void
}): JSX.Element {
  const [name, setName] = useState(initialName)
  const [def, setDef] = useState<CustomAlarmTypeDef>({ ...initialDef })
  const [error, setError] = useState('')
  return (
    <SimulatorDialog className="sfc-properties-dialog" label="Alarm Type Properties" onClose={onClose}>
      <h3>Alarm Type Properties</h3>
      <label>Name
        <input aria-label="Custom alarm type name" value={name} disabled={renameDisabled}
          onChange={(e) => setName(e.target.value.toUpperCase())} />
      </label>
      <label>Priority
        <select aria-label="Custom alarm type priority" value={def.priority}
          onChange={(e) => setDef({ ...def, priority: e.target.value as AlarmPriority })}>
          <option value="CRITICAL">CRITICAL</option>
          <option value="WARNING">WARNING</option>
          <option value="ADVISORY">ADVISORY</option>
        </select>
      </label>
      <label>Message Template
        <input aria-label="Custom alarm type message template" value={def.messageTemplate}
          onChange={(e) => setDef({ ...def, messageTemplate: e.target.value })} />
      </label>
      <label>%P1 parameter path
        <input aria-label="Custom alarm type P1 path" value={def.p1Path ?? ''}
          onChange={(e) => setDef({ ...def, p1Path: e.target.value })} />
      </label>
      <label>%P2 parameter path
        <input aria-label="Custom alarm type P2 path" value={def.p2Path ?? ''}
          onChange={(e) => setDef({ ...def, p2Path: e.target.value })} />
      </label>
      <p>Use %P1/%P2 in the message template to capture the live value at the configured path (e.g. PID1/OUT).</p>
      {error && <p role="alert">{error}</p>}
      <div className="sfc-edit-row">
        <button className="tbtn sm" onClick={() => {
          const validation = customAlarmTypeNameError(name) ?? customAlarmTypeDefError(def)
          if (validation) { setError(validation); return }
          if (useStore.getState().defineCustomAlarmType(name, def)) onSaved(name)
          else setError('Alarm type was not saved. See the reported validation, permission or capacity error.')
        }}>OK</button>
        <button className="tbtn sm" onClick={onClose}>Cancel</button>
      </div>
    </SimulatorDialog>
  )
}
