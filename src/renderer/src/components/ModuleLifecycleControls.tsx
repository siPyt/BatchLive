import { useState } from 'react'
import { SimulatorDialog } from './SimulatorDialog'
import { useStore } from '../engine/store'
import { lifecycleDirty, prepareAoTransfer, type AoConfiguration } from '../engine/moduleLifecycle'
import { DownloadStatusIndicator } from './DownloadStatusIndicator'
import { compareModuleDownload } from '../engine/downloadStatus'

export function ModuleLifecycleRows({ tag }: { tag: string }): JSX.Element {
  const record = useStore(s => s.moduleLifecycle[tag])
  const runtime = useStore(s => s.modules[tag])
  const hardware = useStore(s => s.hardware)
  const enable = useStore(s => s.enableModuleLifecycle)
  const online = useStore(s => s.setModuleOnline)
  const edit = useStore(s => s.editModuleDraft)
  const save = useStore(s => s.saveModuleConfiguration)
  const load = useStore(s => s.loadSavedModuleConfiguration)
  const upload = useStore(s => s.uploadModule)
  const restart = useStore(s => s.restartModule)
  const resend = useStore(s => s.resendLastGoodModuleDownload)
  const [showDownload, setShowDownload] = useState(false)
  if (!record) return <tr><td>SAVED CONFIGURATION</td><td>
    <button className="tbtn sm" onClick={() => {
      if (window.confirm('Enable the isolated saved AO lifecycle? Output will hold until the first Save and Full Download. Existing plant modules are unchanged.')) enable(tag)
    }}>Enable Saved Module Lifecycle</button>
  </td><td>Opt-in; currently live</td></tr>
  const c = record.draft
  const m = c.module
  const downloaded = runtime?.type === 'AO' && runtime.downloaded === true
  const comparison = compareModuleDownload(useStore.getState(), tag)
  const status = lifecycleDirty(record) ? 'Unsaved draft' : !downloaded ? 'Not downloaded - Full required' :
    comparison.status === 'NO_CONFIGURATION' ? 'Not downloaded - Full required' :
    comparison.status === 'UNKNOWN' ? 'Controller comparison unavailable' :
    comparison.status === 'DIFFERENT' ? 'Saved - download required' : 'Saved/deployed match'
  return <>
    <tr><td>MODULE DOWNLOAD STATUS</td><td colSpan={2}><DownloadStatusIndicator tag={tag} controls /></td></tr>
    <tr><td>CONFIGURATION / RUNTIME</td><td><div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => online(tag, !record.online)}>
        {record.online ? 'Go Offline' : 'Go Online'}
      </button>
      <button className="tbtn sm" disabled={record.online} onClick={() => save(tag)}>Save Module</button>
      <button className="tbtn sm" disabled={record.online} onClick={() => {
        if (window.confirm('Replace this draft with the saved configuration for this tag from this browser profile? Runtime remains unchanged.')) load(tag)
      }}>Load Saved Configuration</button>
      <button className="tbtn sm" onClick={() => setShowDownload(true)}>Download Module</button>
      <button className="tbtn sm" disabled={!record.lastGoodDownload || record.replayFullRequired} onClick={() => {
        if (window.confirm('Re-send this AO module\'s last successful transfer, including values preserved by its last Partial Download? Later saved/draft edits are not included. This changes the simulated runtime; it is not a whole-controller replay.')) resend(tag)
      }}>Re-send Last Good Module Download</button>
      <button className="tbtn sm" disabled={!downloaded} onClick={() => {
        if (window.confirm('Replace the offline draft with uploaded controller values? Unsaved draft edits will be discarded; Save is still required.')) upload(tag)
      }}>Upload to Draft</button>
      <button className="tbtn sm" disabled={!downloaded} onClick={() => {
        if (window.confirm('Simulate a cold restart using deployed defaults and the selected NVM restore flags?')) restart(tag)
      }}>Cold Restart Module</button>
    </div>{showDownload && <ModuleDownloadDialog tag={tag} onClose={() => setShowDownload(false)} />}</td>
    <td>{record.online ? 'Online runtime' : 'Offline draft'}; {status}</td></tr>
    <tr><td>SAVED / DOWNLOADED REVISION</td><td>{record.savedRevision} / {record.deployedRevision}</td>
      <td>Local browser database / simulated controller</td></tr>
    <tr><td>AO DOWNLOAD RESTART MEMORY</td><td>{record.restartMemoryRequired ? 'Update required after Partial Download' :
      record.restartDownload ? 'Transfer snapshot ready' : 'Not enabled; existing default restart'}</td>
      <td>Physical Network: Update AO Cold Restart Memory; separate from live parameter NVM</td></tr>
    {!record.online && <>
      <tr><td>ASSIGNED CONTROLLER</td><td><select aria-label={`${tag} assigned controller`}
        value={c.controllerTag} onChange={e => edit(tag, { controllerTag: e.target.value })}>
        <option value="">(unassigned)</option>
        {Object.keys(hardware.controllers).map(name => <option key={name}>{name}</option>)}
      </select></td><td>Offline; download required</td></tr>
      <tr><td>CONFIGURED MODE</td><td><select aria-label={`${tag} configured mode`} value={m.mode}
        onChange={e => {
          const mode = e.target.value
          if (mode === 'CAS' || mode === 'AUTO' || mode === 'MAN' || mode === 'OOS') edit(tag, { mode })
        }}><option>CAS</option><option>AUTO</option><option>MAN</option><option>OOS</option></select></td>
      <td>Does not change runtime</td></tr>
      <tr><td>CONFIGURED SP</td><td><input type="number" aria-label={`${tag} configured SP`}
        value={m.sp} min={m.spLow} max={m.spHigh} onChange={e => edit(tag, { sp: Number(e.target.value) })} /></td><td>{m.unit}</td></tr>
      <tr><td>CONFIGURED MANUAL OUTPUT</td><td><input type="number" aria-label={`${tag} configured OUT`}
        value={m.manualOutput} min={0} max={100} onChange={e => edit(tag, { manualOutput: Number(e.target.value) })} /></td><td>%</td></tr>
      {Object.entries(m.parameters).map(([name, p]) => <tr key={name}><td>{name} DEFAULT</td><td>
        <input type="number" aria-label={`${tag} configured ${name}`} value={p.value}
          onChange={e => edit(tag, { parameter: { name, value: Number(e.target.value) } })} />
      </td><td>Saved default, not live CV</td></tr>)}
      <tr><td>PARTIAL DOWNLOAD BEHAVIOR</td><td><select aria-label={`${tag} partial download behavior`}
        value={c.downloadBehavior} onChange={e => {
          const behavior = e.target.value
          if (behavior === 'CONFIGURED' || behavior === 'CRITICAL' || behavior === 'ALL') edit(tag, { downloadBehavior: behavior })
        }}>
        <option value="CONFIGURED">Use configured values</option>
        <option value="CRITICAL">Preserve critical block values</option>
        <option value="ALL">Preserve user-defined and critical block values</option>
      </select></td><td>Full always uses configured values</td></tr>
      <tr><td>MODULE RESTART RESTORE</td><td><label><input type="checkbox"
        aria-label={`${tag} restore module after restart`} checked={c.restoreModule}
        onChange={e => edit(tag, { restoreModule: e.target.checked })} /> Restore parameter values after restart</label></td><td>Both module and parameter flags required</td></tr>
      <tr><td>PARAMETER RESTART RESTORE</td><td><div className="traditional-channel-form">
        {['AO1/MODE', 'AO1/SP', 'AO1/OUT', ...Object.keys(m.parameters)].map(name => <label key={name}>
          <input type="checkbox" aria-label={`${tag} restore ${name}`} checked={c.restoreParameters.includes(name)}
            onChange={e => edit(tag, { restoreParameters: e.target.checked ?
              [...c.restoreParameters, name] : c.restoreParameters.filter(p => p !== name) })} /> {name}
        </label>)}
      </div></td><td>NVM from downloaded module</td></tr>
    </>}
  </>
}

export function ModuleDownloadDialog({ tag, onClose }: { tag: string; onClose: () => void }): JSX.Element {
  const record = useStore(s => s.moduleLifecycle[tag])
  const runtime = useStore(s => s.modules[tag])
  const download = useStore(s => s.downloadModule)
  const hardware = useStore(s => s.hardware)
  const verify = useStore(s => s.verifyAoDownload)
  const downloaded = runtime?.type === 'AO' && runtime.downloaded === true
  const [scope, setScope] = useState<'FULL' | 'PARTIAL'>(downloaded ? 'PARTIAL' : 'FULL')
  const [verified, setVerified] = useState<AoConfiguration | null>(null)
  const [result, setResult] = useState<'pending' | 'failed' | 'complete'>('pending')
  const [error, setError] = useState('')
  const stale = !!verified && record?.saved !== verified
  const preflight = prepareAoTransfer(record, runtime, hardware, scope)
  return <SimulatorDialog className="module-download-dialog" label={`${tag} Download`} onClose={onClose}>
    <b>{tag} - Simulated Module Download</b>
    <p>Validate saved configuration, then transfer atomically. Failed or cancelled downloads leave the last-good runtime unchanged.</p>
    <label>Scope <select aria-label={`${tag} download scope`} value={scope} onChange={e => {
      if (e.target.value === 'FULL' || e.target.value === 'PARTIAL') {
        setScope(e.target.value); setVerified(null); setResult('pending'); setError('')
      }
    }} disabled={result === 'complete'}><option value="FULL">Full - use configured values</option>
      <option value="PARTIAL" disabled={!downloaded}>Partial - use saved preservation policy</option>
    </select></label>
    <p>Partial policy: {record?.saved?.downloadBehavior ?? '(save required)'}. Only this module is transferred; no physical controller communication is performed.</p>
    <ol aria-label="AO download stages">
      <li>Event journal: verification/rejection/transfer results are recorded; no native disk log file.</li>
      <li>References and pre-download checks: {result === 'complete' ? 'Checked at transfer' :
        stale ? 'Saved configuration changed; verify again' : verified ? 'Verified; checked again on confirmation' : 'Pending verification'}.</li>
      <li>Upload/preservation policy: {scope === 'FULL' ? 'Configured defaults replace live values' :
        `Current live values preserved according to ${record?.saved?.downloadBehavior ?? 'unsaved'} policy at transfer`}.</li>
      <li>Fieldbus dependency checks: not applicable to this traditional AO scope.</li>
      <li>Atomic module transfer: {result === 'complete' ? 'Complete' : result === 'failed' ? 'Rejected; last-good runtime retained' : 'Not started'}.</li>
    </ol>
    {verified && result !== 'complete' && <p role="note">Caution: confirmation can change this module's running mode and output.
      Cancel aborts before transfer. This is not a whole-controller download.</p>}
    {(error || stale || 'error' in preflight) && result !== 'complete' && <p role="alert">
      {error || (stale ? 'Saved configuration changed; verify again before confirming.' :
        'error' in preflight ? preflight.error : '')}</p>}
    <div className="traditional-channel-form">
      {result === 'complete' ? <button className="tbtn sm" onClick={onClose}>Close Download Results</button> : <>
        <button className="tbtn sm" onClick={() => {
          setError(''); setResult('pending')
          if (verify(tag, scope) && record?.saved) setVerified(record.saved)
          else { setVerified(null); setError('Verification rejected. Correct the reported configuration or permission problem.') }
        }}>Verify Configuration</button>
        <button className="tbtn sm" disabled={!verified || stale || 'error' in preflight} onClick={() => {
          if (!verified) return
          if (download(tag, scope, verified)) { setResult('complete'); setError('') }
          else { setResult('failed'); setVerified(null); setError('Download rejected. Verify again after correcting the reported problem.') }
        }}>Confirm Download</button>
        <button className="tbtn sm" onClick={onClose}>Cancel Download</button>
      </>}
    </div>
  </SimulatorDialog>
}
