import { useMemo, useState } from 'react'
import { useStore } from '../engine/store'
import { dstTypes, dstUsage } from '../engine/dstUsage'
import { DST_TYPES, licenseReport, useLicensing, type LicenseReport } from '../engine/licensing'

export function LicensingProperties(): JSX.Element {
  const modules = useStore(s => s.modules)
  const hardware = useStore(s => s.hardware)
  const report = useMemo(() => dstUsage(hardware, modules), [hardware, modules])
  const files = useLicensing(s => s.files)
  const license = useMemo(() => licenseReport({ AI: report.byType.AI.referenced, AO: report.byType.AO.referenced,
    DI: report.byType.DI.referenced, DO: report.byType.DO.referenced }, files), [report, files])
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
    <LicenseManager report={license} />
    <p>The course permits AO licenses to cover AI requirements; that is the only substitution modeled here. Real license
      files, a physical System ID Key and drag-and-drop assignment of licenses to nodes are not reproduced, and this is
      not a vendor-licensed download approval.</p>
  </div>
}

function LicenseManager({ report }: { report: LicenseReport }): JSX.Element {
  const files = useLicensing(s => s.files)
  const keyPresent = useLicensing(s => s.keyPresent)
  const keyNumber = useLicensing(s => s.keyNumber)
  const loadFile = useLicensing(s => s.loadFile)
  const removeFile = useLicensing(s => s.removeFile)
  const setKeyPresent = useLicensing(s => s.setKeyPresent)
  const [fileNumber, setFileNumber] = useState(String(keyNumber))
  const [counts, setCounts] = useState<Record<string, string>>({ AI: '10', AO: '4', DI: '10', DO: '10' })
  const [message, setMessage] = useState<string | null>(null)
  return <section aria-label="License manager" style={{ marginTop: 10 }}>
    <b>System ID Key and license files</b>
    <div>System ID Key number {keyNumber} — {keyPresent ? 'installed' : 'REMOVED: configuration downloads are not permitted'}
      <button className="tbtn sm" style={{ marginLeft: 8 }}
        onClick={() => setMessage(setKeyPresent(!keyPresent))}>{keyPresent ? 'Remove key' : 'Insert key'}</button></div>
    <div role="status">{report.enforced ? 'Licensed: DST capacity is enforced for module, serial-card and H1-card downloads.' :
      'No license file loaded: this training system is unlicensed and DST capacity is not enforced.'}</div>
    <table className="param-table" aria-label="DST license capacity"><thead><tr>
      <th>Type</th><th>Used</th><th>Licensed</th><th>AO substituted</th><th>Shortfall</th></tr></thead>
    <tbody>{report.rows.map(row => <tr key={row.type} data-shortfall={report.enforced && row.shortfall > 0}>
      <td>{row.type}</td><td>{row.used}</td><td>{report.enforced ? row.licensed : '—'}</td>
      <td>{row.type === 'AI' ? row.substituted : '—'}</td><td>{report.enforced ? row.shortfall : '—'}</td></tr>)}</tbody></table>
    {report.enforced && <div>Spare AO licenses: {report.spareAo}</div>}
    <ul aria-label="Loaded license files">{files.map((file, index) => <li key={index}>
      File {file.fileNumber}: AI {file.capacity.AI}, AO {file.capacity.AO}, DI {file.capacity.DI}, DO {file.capacity.DO}
      <button className="tbtn sm" style={{ marginLeft: 8 }} onClick={() => setMessage(removeFile(index) ?? 'License file removed.')}>Remove</button>
    </li>)}</ul>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <label>File number <input aria-label="License file number" style={{ width: 70 }} value={fileNumber} onChange={e => setFileNumber(e.target.value)} /></label>
      {DST_TYPES.map(type => <label key={type}>{type}
        <input aria-label={`License ${type} count`} style={{ width: 56 }} value={counts[type]} onChange={e => setCounts({ ...counts, [type]: e.target.value })} /></label>)}
      <button className="tbtn sm" onClick={() => setMessage(loadFile(Number(fileNumber), {
        AI: Number(counts.AI), AO: Number(counts.AO), DI: Number(counts.DI), DO: Number(counts.DO) }) ?? 'License file loaded.')}>Load license file</button>
    </div>
    {message && <div role="alert">{message}</div>}
  </section>
}
