import { useState } from 'react'
import { useStore } from '../engine/store'
import type { SfcConfiguration } from '../engine/sfcLifecycle'
import { SimulatorDialog } from './SimulatorDialog'

export function SfcParameterControls({ name }: { name: string }): JSX.Element | null {
  const lifecycle = useStore(s => s.sfcLifecycle[name])
  const runtime = useStore(s => s.sfcs[name])
  const [editing, setEditing] = useState<{ configuration: SfcConfiguration; parameter?: string } | null>(null)
  if (!lifecycle) return null
  const parameters = lifecycle.online ? runtime.parameters : lifecycle.draft.parameters
  const editable = !lifecycle.online && (runtime.status === 'READY' || runtime.status === 'COMPLETE')
  return <div className="traditional-note">
    <div className="sfc-edit-row"><b>{lifecycle.online ? 'Online' : 'Configured'} module parameters</b>
      <button className="tbtn sm" disabled={!editable} onClick={() => setEditing({ configuration: lifecycle.draft })}>Add Parameter...</button>
    </div>
    <div className="sfc-edit-row">{Object.entries(parameters ?? {}).map(([parameter, binding]) =>
      <span key={parameter}>{parameter}: Named Set {binding.namedSet}, value {binding.value}
        {' '}<button className="tbtn sm" disabled={!editable}
          onClick={() => setEditing({ configuration: lifecycle.draft, parameter })}>Parameter Properties: {parameter}</button></span>)}</div>
    {editing && <SfcParameterProperties name={name} configuration={editing.configuration} parameter={editing.parameter}
      onClose={() => setEditing(null)} />}
  </div>
}

function SfcParameterProperties({ name, configuration, parameter, onClose }: {
  name: string; configuration: SfcConfiguration; parameter?: string; onClose: () => void
}): JSX.Element {
  const sets = useStore(s => s.namedSets.configured)
  const existing = parameter ? configuration.parameters?.[parameter] : undefined
  const [parameterName, setParameterName] = useState(parameter ?? '')
  const [setName, setSetName] = useState(existing?.namedSet ?? Object.keys(sets)[0] ?? '')
  const [value, setValue] = useState(existing ? String(existing.value) : '')
  const [error, setError] = useState('')
  return <SimulatorDialog className="sfc-properties-dialog" label="Parameter Properties" onClose={onClose}>
    <h3>Parameter Properties — {name}</h3>
    <label>Name<input aria-label="SFC parameter name" disabled={!!parameter} value={parameterName}
      onChange={e => setParameterName(e.target.value)} placeholder="MESSAGE" /></label>
    <label>Type<select aria-label="SFC parameter type" disabled value="Named Set"><option>Named Set</option></select></label>
    <label>Named Set<select aria-label="SFC parameter Named Set" value={setName} onChange={e => { setSetName(e.target.value); setValue('') }}>
      <option value="">Select a Named Set</option>{Object.keys(sets).map(item => <option key={item}>{item}</option>)}
    </select></label>
    <label>Configured value<select aria-label="SFC parameter configured value" value={value} onChange={e => setValue(e.target.value)}>
      <option value="">Select a configured state</option>
      {sets[setName]?.entries.map(entry => <option key={entry.value} value={entry.value}>{entry.name} ({entry.value})</option>)}
    </select></label>
    <p>Configured defaults may include non-user-selectable prompts. Operator data entry cannot select those prompts.
      This parameter remains offline until Save and Download. Only Named Set parameters are supported here.</p>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={() => {
        if (!parameter && Object.hasOwn(configuration.parameters ?? {}, parameterName)) {
          const message = 'Parameter already exists; open its Properties'
          setError(message); useStore.getState().logEvent('DIAGNOSTIC', name, message); return
        }
        if (useStore.getState().configureSfcParameter(name, parameterName, {
          type: 'NAMED_SET', namedSet: setName, value: value.trim() ? Number(value) : NaN
        }, configuration)) onClose()
        else setError('Parameter was not applied; see the reported validation, staleness or permission error.')
      }}>OK</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button>
    </div>
  </SimulatorDialog>
}
