import { useState } from 'react'
import { useFlowColors } from '../engine/flowColorStore'
import { usePictures, type PicElement } from '../engine/pictureStore'
import type { FlowCondition } from '../engine/pictureFlow'
import { useStore } from '../engine/store'
import { SimulatorDialog } from './SimulatorDialog'

export function FlowTablesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const tables = useFlowColors(state => state.tables)
  const apply = useFlowColors(state => state.applyTable)
  const save = useFlowColors(state => state.saveTables)
  const load = useFlowColors(state => state.loadTables)
  const [name, setName] = useState('flow_color')
  const [flowColor, setFlowColor] = useState(tables.flow_color?.flowColor ?? '#ffff00')
  const [noFlowColor, setNoFlowColor] = useState(tables.flow_color?.noFlowColor ?? '#008000')
  const [status, setStatus] = useState('')
  return <SimulatorDialog className="module-download-dialog" label="Shared Flow Color Tables" onClose={onClose}>
    <b>User / Shared Flow Color Tables</b>
    <p>Two colors for custom-picture flow and no-flow. All linked objects use the same table.
      Plant graphics are unaffected. Tables are saved separately from pictures.</p>
    <label className="bld-f">Existing table
      <select aria-label="Existing flow table" value={tables[name] ? name : ''} onChange={event => {
        const table = tables[event.target.value]
        if (table) { setName(table.name); setFlowColor(table.flowColor); setNoFlowColor(table.noFlowColor) }
      }}>
        <option value="">(new)</option>
        {Object.keys(tables).map(key => <option key={key}>{key}</option>)}
      </select>
    </label>
    <label className="bld-f">Table name
      <input aria-label="Flow table name" value={name} onChange={event => setName(event.target.value)} />
    </label>
    <label className="bld-f">Product flow
      <input aria-label="Product flow color" type="color" value={flowColor} onChange={event => setFlowColor(event.target.value)} />
    </label>
    <label className="bld-f">No flow
      <input aria-label="No flow color" type="color" value={noFlowColor} onChange={event => setNoFlowColor(event.target.value)} />
    </label>
    <div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => {
        if (apply({ name, flowColor, noFlowColor })) setStatus('Table applied to every linked object. Save Tables to persist.')
      }}>Apply Table</button>
      <button className="tbtn sm" onClick={() => { if (save()) setStatus('Tables saved to this browser profile.') }}>Save Tables</button>
      <button className="tbtn sm" onClick={() => {
        if (window.confirm('Replace shared tables with the saved tables from this browser profile?') && load()) {
          const table = useFlowColors.getState().tables[name]
          if (table) { setFlowColor(table.flowColor); setNoFlowColor(table.noFlowColor) }
          setStatus('Tables loaded.')
        }
      }}>Load Saved Tables</button>
      <button className="tbtn sm" onClick={onClose}>Close</button>
    </div>
    <p role="status">{status}</p>
  </SimulatorDialog>
}

export function FlowAnimationControls({ picture, element, part = 'body' }: {
  picture: string; element: PicElement; part?: 'body' | 'actuator'
}): JSX.Element {
  const tables = useFlowColors(state => state.tables)
  const modules = useStore(state => state.modules)
  const update = usePictures(state => state.updateElement)
  const animation = part === 'actuator' ? element.actuatorFlowAnimation : element.flowAnimation
  const [table, setTable] = useState(animation?.table ?? Object.keys(tables)[0] ?? 'flow_color')
  const [conditions, setConditions] = useState<FlowCondition[]>(animation?.conditions ?? [
    { tag: element.tag ?? '', path: modules[element.tag ?? '']?.type === 'PID' ? 'AO1/OUT' : 'STATE', greaterThan: 0 }
  ])
  const [enabled, setEnabled] = useState(!!animation)
  const [status, setStatus] = useState('')
  return <>
    <b>{part === 'actuator' ? 'Actuator Color Animation' : 'Shared Flow Color Animation'}</b>
    {element.type === 'valve' && <p>{part === 'actuator'
      ? 'Independent actuator color. AO1/OUT > 0 represents applied simulated output, not measured physical travel. Disable to inherit the body color.'
      : 'Valve body color; actuator inherits it unless its independent animation is enabled below.'}</p>}
    <label className="bld-f bld-f-row">
      <input aria-label={`Enable ${part} animation`} type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enable
    </label>
    {enabled && <>
      <label className="bld-f">Table
        <select aria-label="Animation flow table" value={table} onChange={event => setTable(event.target.value)}>
          {!tables[table] && <option value={table}>{table} (create or load first)</option>}
          {Object.keys(tables).map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      <p>Flow when ALL sources are greater than their thresholds. Uses confirmed states, not commands.
        Bad feedback displays neutral with a Bad indication.</p>
      {conditions.map((condition, index) => <fieldset key={index}>
        <legend>AND condition {index + 1}</legend>
        <label className="bld-f">Source module
          <select aria-label={`Flow source ${index + 1}`} value={condition.tag} onChange={event => {
            const tag = event.target.value
            setConditions(current => current.map((item, i) => i === index
              ? { ...item, tag, path: modules[tag]?.type === 'PID' ? 'AO1/OUT' :
                modules[tag]?.type === 'AI' || modules[tag]?.type === 'AO' ? 'PV' : 'STATE' } : item))
          }}>
            {!modules[condition.tag] && <option value={condition.tag}>(select a module)</option>}
            {Object.values(modules).filter(module => module.type !== 'FB')
              .map(module => <option key={module.tag}>{module.tag}</option>)}
          </select>
        </label>
        <label className="bld-f">Source path
          <select aria-label={`Flow path ${index + 1}`} value={condition.path} onChange={event => {
            const path = (['STATE', 'PV', 'PID1/OUT', 'AO1/OUT'] as const).find(value => value === event.target.value)
            if (path) setConditions(current => current.map((item, i) => i === index ? { ...item, path } : item))
          }}>
            {['STATE', 'PV', 'PID1/OUT', 'AO1/OUT'].map(path => <option key={path}>{path}</option>)}
          </select>
        </label>
        <label className="bld-f">Greater than
          <input aria-label={`Flow threshold ${index + 1}`} type="number" value={condition.greaterThan}
            onChange={event => setConditions(current => current.map((item, i) => i === index
              ? { ...item, greaterThan: Number(event.target.value) } : item))} />
        </label>
        <button className="tbtn sm" disabled={conditions.length === 1}
          onClick={() => setConditions(current => current.filter((_, i) => i !== index))}>Remove Condition</button>
      </fieldset>)}
      <button className="tbtn sm" disabled={conditions.length >= 8}
        onClick={() => setConditions(current => [...current, { tag: element.tag ?? '', path: 'STATE', greaterThan: 0 }])}>
        Add AND Condition
      </button>
    </>}
    <button className="tbtn sm" onClick={() => {
      const value = enabled ? { table, conditions } : undefined
      if (update(picture, element.id, part === 'actuator' ? { actuatorFlowAnimation: value } : { flowAnimation: value })) {
        setStatus('Flow animation applied. Save Picture to persist the link.')
      }
    }}>{part === 'actuator' ? 'Apply Actuator Animation' : 'Apply Flow Animation'}</button>
    <p role="status">{status}</p>
  </>
}
