import { useMemo, useState } from 'react'
import { useStore } from '../engine/store'
import { HIERARCHY_LEVELS, batchHierarchyError, equipmentPath, describePath } from '../engine/hierarchy'
import { BATCH_UNIT } from '../engine/batch'

/** DV09-013: manage Process Cells and Units and place equipment modules in the Area > Cell > Unit > Equipment > Control hierarchy. */
export function HierarchyPanel(): JSX.Element {
  const areas = useStore((s) => s.areas)
  const processCells = useStore((s) => s.processCells)
  const units = useStore((s) => s.units)
  const equipment = useStore((s) => s.equipment)
  const state = useMemo(() => ({ areas, processCells, units, equipment }), [areas, processCells, units, equipment])
  const createCell = useStore((s) => s.createProcessCell)
  const deleteCell = useStore((s) => s.deleteProcessCell)
  const createUnit = useStore((s) => s.createUnit)
  const deleteUnit = useStore((s) => s.deleteUnit)
  const assign = useStore((s) => s.assignEquipmentUnit)
  const [cellName, setCellName] = useState('')
  const [cellArea, setCellArea] = useState(areas[0] ?? '')
  const [unitName, setUnitName] = useState('')
  const [unitCell, setUnitCell] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const cells = Object.values(processCells)
  const batchError = batchHierarchyError(BATCH_UNIT, state)
  return (
    <div className="exp-props" aria-label="Equipment hierarchy">
      <div className="exp-props-head"><b>Equipment Hierarchy</b><span>{HIERARCHY_LEVELS.join(' > ')}</span></div>
      <p>Areas hold control modules and define user privilege and workstation alarm boundaries. A Process Cell organizes units
        in an area; a Unit is key to the batch hierarchy; an Equipment Module groups control modules.</p>
      <div role="status">{batchError ? `Batch: ${batchError}` : `Batch unit ${BATCH_UNIT} has a complete Area > Process Cell > Unit hierarchy.`}</div>
      <div className="traditional-channel-form">
        <label className="bld-f">Process Cell name <input aria-label="Process cell name" value={cellName} maxLength={16} onChange={(e) => setCellName(e.target.value)} /></label>
        <label className="bld-f">Area
          <select aria-label="Process cell area" value={cellArea} onChange={(e) => setCellArea(e.target.value)}>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button className="tbtn sm" onClick={() => {
          const error = createCell(cellName, cellArea, '')
          setMessage(error ?? `Process Cell ${cellName.trim().toUpperCase()} created.`)
          if (!error) setCellName('')
        }}>New Process Cell</button>
      </div>
      <div className="traditional-channel-form">
        <label className="bld-f">Unit name <input aria-label="Unit name" value={unitName} maxLength={16} onChange={(e) => setUnitName(e.target.value)} /></label>
        <label className="bld-f">Process Cell
          <select aria-label="Unit process cell" value={unitCell} onChange={(e) => setUnitCell(e.target.value)}>
            <option value="">(choose)</option>
            {cells.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.area})</option>)}
          </select>
        </label>
        <button className="tbtn sm" onClick={() => {
          const error = createUnit(unitName, unitCell, '')
          setMessage(error ?? `Unit ${unitName.trim().toUpperCase()} created.`)
          if (!error) setUnitName('')
        }}>New Unit</button>
      </div>
      {message && <div role="alert">{message}</div>}
      <table className="param-table" aria-label="Hierarchy">
        <thead><tr><th>Process Cell</th><th>Area</th><th>Units</th><th /></tr></thead>
        <tbody>
          {cells.map((cell) => (
            <tr key={cell.name}>
              <td>{cell.name}</td><td>{cell.area}</td>
              <td>{Object.values(units).filter((u) => u.cell === cell.name).map((u) => (
                <span key={u.name} style={{ marginRight: 8 }}>{u.name}
                  <button className="tbtn sm" aria-label={`Delete unit ${u.name}`} onClick={() => setMessage(deleteUnit(u.name) ?? `Unit ${u.name} deleted.`)}>×</button></span>
              ))}</td>
              <td><button className="tbtn sm" aria-label={`Delete process cell ${cell.name}`} onClick={() => setMessage(deleteCell(cell.name) ?? `Process Cell ${cell.name} deleted.`)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="param-table" aria-label="Equipment module placement">
        <thead><tr><th>Equipment Module</th><th>Path</th><th>Unit</th></tr></thead>
        <tbody>
          {Object.values(equipment).map((em) => {
            const path = equipmentPath(em.tag, state)
            const choices = Object.values(units).filter((u) => processCells[u.cell]?.area === em.area)
            return (
              <tr key={em.tag}>
                <td>{em.tag}</td>
                <td>{path ? describePath(path) : em.area}{path && !path.complete ? ' (no unit)' : ''}</td>
                <td>
                  <select aria-label={`${em.tag} unit`} value={em.unit ?? ''} onChange={(e) => setMessage(assign(em.tag, e.target.value || null))}>
                    <option value="">(none — directly under the area)</option>
                    {choices.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p>Unit behavior modeled: DeltaV Batch refuses to start without a full Area &gt; Process Cell &gt; Unit hierarchy for its unit.</p>
    </div>
  )
}
