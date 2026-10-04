import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { SimulatorDialog } from './SimulatorDialog'
import {
  changedNamedSets, cloneNamedSet, namedSetError, namedSetTargetKey,
  type NamedSetDefinition, type NamedSetEntry, type NamedSetTarget
} from '../engine/namedSets'

export function NamedSetControls({ selected, onSelect, createRequest, propertiesRequest, onRequestsHandled }: {
  selected: string | null; onSelect: (name: string) => void; createRequest: number
  propertiesRequest: { name: string; serial: number } | null
  onRequestsHandled: () => void
}): JSX.Element {
  const state = useStore(s => s.namedSets)
  const controllers = useStore(s => s.hardware.controllers)
  const [creating, setCreating] = useState(false)
  const [properties, setProperties] = useState<NamedSetDefinition | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [targetName, setTargetName] = useState('WORKSTATION')
  useEffect(() => {
    if (createRequest > 0) setCreating(true)
    if (propertiesRequest) setProperties(useStore.getState().namedSets.configured[propertiesRequest.name] ?? null)
    if (createRequest > 0 || propertiesRequest) onRequestsHandled()
  }, [createRequest, propertiesRequest, onRequestsHandled])
  const target: NamedSetTarget = targetName === 'WORKSTATION' ? { kind: 'workstation' } :
    { kind: 'controller', tag: targetName.slice('CONTROLLER:'.length) }
  const definition = selected ? state.configured[selected] : undefined
  const deployed = selected ? state.deployed[namedSetTargetKey(target)]?.[selected] : undefined
  const changes = changedNamedSets(state, target)
  return <div className="exp-props">
    <h3>Setup — Named Sets</h3>
    <p className="traditional-note">
      Custom Named Sets: names are case-sensitive. Visible and User Selectable are independent.
      Properties OK saves local configured setup; it does not transfer running setup.
      SFC Named Set parameters use these configured sets; controller/workstation setup transfers remain independent.
      DC SP_D binding and vendor default sets are not implemented.
    </p>
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={() => { setError(''); setCreating(true) }}>New Named Set...</button>
      <button className="tbtn sm" onClick={() => {
        if (window.confirm('Replace configured custom Named Sets with the saved browser configuration? Deployed setup remains unchanged.')) {
          useStore.getState().loadSavedNamedSets()
        }
      }}>Load Saved Named Sets</button>
    </div>
    <table className="studio-param-table"><thead><tr><th>Name (case-sensitive)</th><th>Entries</th><th>Properties</th></tr></thead>
      <tbody>{Object.values(state.configured).map(item => <tr key={item.name}
        onDoubleClick={() => { onSelect(item.name); setProperties(item) }}>
        <td><button className="fp-link-btn" onClick={() => onSelect(item.name)}>{item.name}</button></td>
        <td>{item.entries.length}</td>
        <td><button className="tbtn sm" onClick={() => { onSelect(item.name); setProperties(item) }}>Properties...</button></td>
      </tr>)}</tbody>
    </table>
    {definition && <>
      <h3>Configured Named Set: {definition.name}</h3>
      <table className="studio-param-table"><thead><tr><th>Value</th><th>Name</th><th>Visible</th><th>User Selectable</th></tr></thead>
        <tbody>{definition.entries.map(entry => <tr key={entry.value}>
          <td>{entry.value}</td><td>{entry.name}</td><td>{entry.visible ? 'Yes' : 'No'}</td><td>{entry.userSelectable ? 'Yes' : 'No'}</td>
        </tr>)}</tbody>
      </table>
    </>}
    <h3>Changed Setup Data — Named Set subset</h3>
    <label>Target<select aria-label="Named Set setup target" value={targetName} onChange={e => setTargetName(e.target.value)}>
      <option value="WORKSTATION">Local workstation (simulated)</option>
      {Object.keys(controllers).map(tag => <option value={`CONTROLLER:${tag}`} key={tag}>{tag} — controller</option>)}
    </select></label>
    <p>{changes.length ? `Changed: ${changes.join(', ')}` : 'No Named Set changes for this target.'}</p>
    {selected && <><h4>{selected} — deployed setup on {targetName}</h4>
      {deployed ? <table className="studio-param-table">
        <thead><tr><th>Value</th><th>Name</th><th>Visible</th><th>User Selectable</th></tr></thead>
        <tbody>{deployed.entries.map(entry => <tr key={entry.value}>
          <td>{entry.value}</td><td>{entry.name}</td><td>{entry.visible ? 'Yes' : 'No'}</td><td>{entry.userSelectable ? 'Yes' : 'No'}</td>
        </tr>)}</tbody>
      </table> : <p>Not transferred to this target.</p>}
    </>}
    <button className="tbtn sm" disabled={!changes.length} onClick={() => {
      if (window.confirm(`Download Changed Setup Data: ${changes.join(', ')} to ${targetName}? This transfers the Named Set subset only.`)) {
        useStore.getState().downloadChangedNamedSets(target)
      }
    }}>Download Changed Setup Data...</button>
    <p className="traditional-note">
      Controller and workstation copies are independent and session-local. Transfers require Can Download;
      controller targets must be available and commissioned. Other setup categories and native download-status
      dialogs are not implemented. Reloading configured sets does not recreate deployed copies.
    </p>
    {creating && <SimulatorDialog className="sfc-properties-dialog" label="New Named Set" onClose={() => setCreating(false)}>
      <h3>New Named Set</h3>
      <label>Name<input aria-label="Named Set name" value={name} onChange={e => setName(e.target.value)} /></label>
      <p>Case is preserved. Enter a supported 1–16-character name, then configure its entries in Properties.</p>
      {error && <p role="alert">{error}</p>}
      <div className="sfc-edit-row">
        <button className="tbtn sm" onClick={() => {
          if (useStore.getState().createNamedSet(name)) {
            const created = useStore.getState().namedSets.configured[name]
            onSelect(name); setName(''); setCreating(false); setError(''); setProperties(created)
          } else setError('Named Set was not created. See the reported validation, permission or storage error.')
        }}>OK</button>
        <button className="tbtn sm" onClick={() => setCreating(false)}>Cancel</button>
      </div>
    </SimulatorDialog>}
    {properties && <NamedSetProperties expected={properties} onClose={() => setProperties(null)} />}
  </div>
}

function NamedSetProperties({ expected, onClose }: { expected: NamedSetDefinition; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState(() => cloneNamedSet(expected))
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ index: number | null; entry: NamedSetEntry; renameOnly?: boolean } | null>(null)
  return <SimulatorDialog className="sfc-properties-dialog named-set-properties" label={`Named Set Properties: ${expected.name}`} onClose={onClose}>
    <h3>Named Set Properties: {expected.name}</h3>
    <p>Object type: Named Set</p>
    <label>Description<input aria-label="Named Set description" value={draft.description}
      onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
    <h4>Named states</h4>
    <table className="studio-param-table"><thead><tr><th>Name</th><th>Value</th><th>Visible</th><th>Referenced</th><th>User Selectable</th></tr></thead>
      <tbody>{draft.entries.map((entry, index) => <tr key={index}>
        <td><button className="fp-link-btn" aria-pressed={selected === index} onClick={() => setSelected(index)}
          onDoubleClick={() => { setSelected(index); setEditing({ index, entry }) }}>{entry.name}</button></td>
        <td>{entry.value}</td><td>{entry.visible ? 'Yes' : 'No'}</td><td>Not tracked</td><td>{entry.userSelectable ? 'Yes' : 'No'}</td>
      </tr>)}</tbody>
    </table>
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={() => setEditing({ index: null,
        entry: { name: '', value: 0, visible: true, userSelectable: true } })}>Add...</button>
      <button className="tbtn sm" disabled={selected === null} onClick={() => {
        if (selected !== null) setEditing({ index: selected, entry: draft.entries[selected] })
      }}>Modify...</button>
      <button className="tbtn sm" disabled={selected === null} onClick={() => {
        if (selected !== null) setEditing({ index: selected, entry: draft.entries[selected], renameOnly: true })
      }}>Rename...</button>
      <button className="tbtn sm" disabled={selected === null} onClick={() => {
        setDraft({ ...draft, entries: draft.entries.filter((_, i) => i !== selected) }); setSelected(null)
      }}>Delete</button>
    </div>
    <p>Names and numeric values must be unique. Invisible entries may remain User Selectable in the definition,
      but operator menus only include entries with both flags enabled. Values use safe integers in this simulator.</p>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={() => {
        const validation = namedSetError(draft)
        if (validation) {
          setError(validation); useStore.getState().logEvent('DIAGNOSTIC', expected.name, validation); return
        }
        if (useStore.getState().applyNamedSetProperties(expected, draft)) onClose()
        else setError('Properties were not saved. See the reported staleness, permission or storage error.')
      }}>OK</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button>
    </div>
    {editing && <NamedStateProperties entry={editing.entry} renameOnly={editing.renameOnly}
      onClose={() => setEditing(null)} onApply={entry => {
        const entries = editing.index === null ? [...draft.entries, entry] :
          draft.entries.map((item, index) => index === editing.index ? entry : item)
        const candidate = { ...draft, entries }
        const validation = namedSetError(candidate)
        if (validation) {
          useStore.getState().logEvent('DIAGNOSTIC', expected.name, validation)
          return validation
        }
        setDraft(candidate); setSelected(editing.index ?? entries.length - 1); setEditing(null)
        return null
      }} />}
  </SimulatorDialog>
}

function NamedStateProperties({ entry, renameOnly, onApply, onClose }: {
  entry: NamedSetEntry; renameOnly?: boolean
  onApply: (entry: NamedSetEntry) => string | null; onClose: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(() => ({ ...entry }))
  const [value, setValue] = useState(String(entry.value))
  const [error, setError] = useState('')
  return <SimulatorDialog className="sfc-properties-dialog" label="State Properties" onClose={onClose}>
    <h3>State Properties</h3>
    <label>Name<input aria-label="State name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label>Value<input aria-label="State value" type="number" step={1} disabled={renameOnly} value={value}
      onChange={e => setValue(e.target.value)} /></label>
    <p>Reference tracking is not yet implemented; SFC parameters are validated when configured/saved/downloaded.</p>
    <label><span><input type="checkbox" aria-label="Visible" disabled={renameOnly} checked={draft.visible}
      onChange={e => setDraft({ ...draft, visible: e.target.checked })} /> Visible</span></label>
    <label><span><input type="checkbox" aria-label="User selectable" disabled={renameOnly} checked={draft.userSelectable}
      onChange={e => setDraft({ ...draft, userSelectable: e.target.checked })} /> User selectable</span></label>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={() => {
        const validation = onApply({ ...draft, value: value.trim() ? Number(value) : NaN })
        if (validation) setError(validation)
      }}>OK</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button>
    </div>
  </SimulatorDialog>
}
