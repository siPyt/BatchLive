import { useMemo } from 'react'
import { useStore } from '../engine/store'
import { dstTypes, dstUsage } from '../engine/dstUsage'

export function LicensingProperties(): JSX.Element {
  const modules = useStore(s => s.modules)
  const hardware = useStore(s => s.hardware)
  const report = useMemo(() => dstUsage(hardware, modules), [hardware, modules])
  return <div className="exp-props">
    <div className="exp-props-head"><b>ProfessionalPLUS - Licensing Properties</b>
      <span>Read-only simulated system DST usage</span></div>
    <p>Distinct physical signals with actual module bindings, not every created module or unused channel.
      Shared readers and internal function-block references do not allocate another DST.</p>
    {report.errors.length > 0 && <div role="alert"><b>Incomplete usage report - unresolved references</b>
      <ul>{report.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
    <table className="param-table" aria-label="System DST usage by type"><thead><tr>
      <th>Type</th><th>Referenced</th><th>Enabled / installed referenced</th><th>Configured signals</th><th>Unused</th>
    </tr></thead><tbody>{dstTypes.map(type => <tr key={type}>
      <td>{type}</td><td>{report.byType[type].referenced}</td><td>{report.byType[type].enabledReferenced}</td>
      <td>{report.byType[type].configured}</td><td>{report.byType[type].unused}</td>
    </tr>)}<tr><td>Total</td><td>{dstTypes.reduce((total, type) => total + report.byType[type].referenced, 0)}</td>
      <td>{dstTypes.reduce((total, type) => total + report.byType[type].enabledReferenced, 0)}</td>
      <td>{report.entries.length}</td><td>{dstTypes.reduce((total, type) => total + report.byType[type].unused, 0)}</td></tr></tbody></table>
    <p>Disabled/pulled signals remain allocated when referenced; availability and license usage are different.
      Counts follow current live/deployed bindings. Untransferred drafts do not change them.</p>
    <table className="param-table" aria-label="Referenced DST details"><thead><tr>
      <th>Signal / channel</th><th>Type</th><th>Controller</th><th>Enabled / installed</th><th>Module / port references</th>
    </tr></thead><tbody>{report.entries.filter(entry => entry.references.length > 0).map(entry => <tr key={entry.id}>
      <td>{entry.signal} / {entry.id}</td><td>{entry.type}</td><td>{entry.controller}</td>
      <td>{entry.enabled ? 'Yes' : 'No'}</td><td>{entry.references.join(', ')}</td>
    </tr>)}</tbody></table>
    <p>License capacity, substitution allocation, vendor license files and physical System ID keys are not modeled
      or enforced here. This is not a licensed-download approval. The course permits AO licenses to cover AI
      requirements; this report does not invent allocations or a substitution hierarchy.</p>
  </div>
}
