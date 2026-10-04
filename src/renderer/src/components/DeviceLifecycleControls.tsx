import { useState } from 'react'
import { useStore } from '../engine/store'
import { deviceDirty } from '../engine/deviceLifecycle'
import { traditionalChannels } from '../engine/traditionalIo'
import { SimulatorDialog } from './SimulatorDialog'

export function DeviceLifecycleRows({ tag }: { tag: string }): JSX.Element {
  const record = useStore(s => s.deviceLifecycle[tag])
  const runtime = useStore(s => s.modules[tag])
  const hardware = useStore(s => s.hardware)
  const modules = useStore(s => s.modules)
  const tags = Object.keys(modules).filter(t => t !== tag).sort()
  const enable = useStore(s => s.enableDeviceLifecycle)
  const edit = useStore(s => s.editDeviceDraft)
  const save = useStore(s => s.saveDeviceConfiguration)
  const load = useStore(s => s.loadDeviceConfiguration)
  const download = useStore(s => s.downloadDeviceConfiguration)
  const online = useStore(s => s.setDeviceOnline)
  const [showDownload, setShowDownload] = useState(false)
  if (!record) return <tr><td>SAVED DEVICE CONFIGURATION</td><td>
    <button className="tbtn sm" onClick={() => {
      if (window.confirm('Enable saved device lifecycle for this stopped/closed device? It will be inhibited until the first Save and Full Download. Other devices are unchanged.')) enable(tag)
    }}>Enable Saved Device Lifecycle</button>
  </td><td>Opt-in; currently live</td></tr>
  const c = record.draft
  const status = deviceDirty(record) ? 'Unsaved draft' : !record.deployed ? 'Saved; first download required' :
    record.savedRevision !== record.deployedRevision ? 'Saved; download required' : 'Downloaded'
  return <>
    <tr><td>DEVICE CONFIGURATION / RUNTIME</td><td><div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => online(tag, !record.online)}>{record.online ? 'Go Offline' : 'Go Online'}</button>
      <button className="tbtn sm" disabled={record.online} onClick={() => save(tag)}>Save Device</button>
      <button className="tbtn sm" disabled={record.online} onClick={() => {
        if (window.confirm('Replace this device draft with its persistent saved configuration? Runtime remains unchanged.')) load(tag)
      }}>Load Saved Device</button>
      <button className="tbtn sm" onClick={() => setShowDownload(true)}>Download Device</button>
    </div>{showDownload && <SimulatorDialog className="module-download-dialog" label={`${tag} Device Download`} onClose={() => setShowDownload(false)}>
      <b>{tag} - Full Simulated Device Download</b>
      <p>Transfer only the saved device configuration and its independent DI/DO bindings. Stop/close and confirm both channels passive first. Controller must be commissioned and both channels scanned Good. Failure or cancellation retains the last-good runtime.</p>
      <p>No partial download or physical controller communication. Deployed source connections execute on subsequent scans; a true command source can command this device active.</p>
      <div className="traditional-channel-form">
        <button className="tbtn sm" onClick={() => { if (download(tag)) setShowDownload(false) }}>Confirm Device Download</button>
        <button className="tbtn sm" onClick={() => setShowDownload(false)}>Cancel Device Download</button>
      </div>
    </SimulatorDialog>}</td><td>{record.online ? 'Online runtime' : 'Offline draft'}; {status}</td></tr>
    <tr><td>SAVED / DEPLOYED REVISION</td><td>{record.savedRevision} / {record.deployedRevision}</td><td>Local browser database / simulated controller</td></tr>
    <tr><td>DEPLOYED CONTROLLER / SOURCES</td><td>{record.deployed?.controllerTag ?? '(not deployed)'}</td>
      <td>{runtime?.type === 'MOTOR' || runtime?.type === 'VALVE' ?
        `Interlock: ${runtime.interlockSource ?? 'manual'}; permissive: ${runtime.permissiveSource ?? 'manual'}; command: ${runtime.commandSource ?? 'operator'}` : ''}</td></tr>
    {!record.online && <>
      <tr><td>DRAFT CONTROLLER</td><td><select aria-label={`${tag} device controller`} value={c.controllerTag}
        onChange={e => edit(tag, { controllerTag: e.target.value })}>
        <option value="">(unassigned)</option>
        {c.controllerTag && !hardware.controllers[c.controllerTag] && <option>{c.controllerTag}</option>}
        {Object.keys(hardware.controllers).map(t => <option key={t}>{t}</option>)}
      </select></td><td>Offline; runtime unchanged</td></tr>
      {(['inputDst', 'outputDst'] as const).map(port => <tr key={port}><td>DRAFT {port === 'inputDst' ? 'IO_IN_1' : 'IO_OUT_1'}</td><td>
        <select aria-label={`${tag} draft ${port}`} value={c[port]} onChange={e => edit(tag, { [port]: e.target.value })}>
          <option value="">(unassigned)</option>
          {c[port] && !traditionalChannels(hardware).some(item => item.channel.dst === c[port]) && <option>{c[port]}</option>}
          {traditionalChannels(hardware).filter(item => item.card.type === (port === 'inputDst' ? 'DI' : 'DO') && item.channel.dst).map(item =>
            <option key={item.channel.dst} value={item.channel.dst}>{item.channel.dst} ({item.card.id} CH{item.channel.channel})</option>)}
        </select></td><td>Draft only; Download applies binding</td></tr>)}
      {(['permissiveRequired', 'resetRequired'] as const).map(option => <tr key={option}><td>DRAFT {option === 'permissiveRequired' ? 'PERMISSIVE' : 'RESET REQUIRED'}</td><td>
        <input type="checkbox" aria-label={`${tag} draft ${option}`} checked={c[option]}
          onChange={e => edit(tag, { [option]: e.target.checked })} /></td><td>Configured option; not live</td></tr>)}
      <tr><td>DRAFT CONFIRM TIME (s)</td><td><input type="number" min={0} step={.1} aria-label={`${tag} draft confirm time`}
        value={c.confirmTimeSec} onChange={e => edit(tag, { confirmTimeSec: Number(e.target.value) })} /></td><td>External DI must confirm; timer cannot fabricate feedback</td></tr>
      {(['interlockSource', 'permissiveSource', 'commandSource'] as const).map(source => <tr key={source}><td>DRAFT {source}</td><td>
        <select aria-label={`${tag} draft ${source}`} value={c[source] ?? ''} onChange={e => edit(tag, { [source]: e.target.value || undefined })}>
          <option value="">(manual/operator)</option>
          {c[source] && !tags.includes(c[source]) && <option>{c[source]}</option>}
          {tags.map(t => <option key={t}>{t}</option>)}
        </select></td><td>Saved connection; Download required</td></tr>)}
    </>}
  </>
}
