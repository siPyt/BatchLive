import { useState } from 'react'
import { useStore } from '../engine/store'
import { deviceDirty } from '../engine/deviceLifecycle'
import { traditionalChannels } from '../engine/traditionalIo'
import { SimulatorDialog } from './SimulatorDialog'
import { useUi } from '../ui/uiStore'
import { deviceEditorModules } from '../engine/deviceLifecycle'
import { descriptorRoles, type DeviceStateDescriptors } from '../engine/deviceDescriptors'

export function DeviceLifecycleRows({ tag }: { tag: string }): JSX.Element {
  const record = useStore(s => s.deviceLifecycle[tag])
  const runtime = useStore(s => s.modules[tag])
  const hardware = useStore(s => s.hardware)
  const modules = useStore(s => s.modules)
  const records = useStore(s => s.deviceLifecycle)
  const tags = Object.keys(deviceEditorModules(modules, records)).filter(t => t !== tag).sort()
  const openStudio = useUi(s => s.openStudio)
  const enable = useStore(s => s.enableDeviceLifecycle)
  const edit = useStore(s => s.editDeviceDraft)
  const save = useStore(s => s.saveDeviceConfiguration)
  const load = useStore(s => s.loadDeviceConfiguration)
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
    </div>{showDownload && <DeviceDownloadDialog tag={tag} onClose={() => setShowDownload(false)} />}</td><td>{record.online ? 'Online runtime' : 'Offline draft'}; {status}</td></tr>
    <tr><td>SAVED / DEPLOYED REVISION</td><td>{record.savedRevision} / {record.deployedRevision}</td><td>Local browser database / simulated controller</td></tr>
    {c.strategy && <tr><td>MTR-11_ILOCK OWNED STRATEGY</td><td><div className="traditional-channel-form">
      {Object.keys(c.strategy).map(name => <button key={name} className="tbtn sm" onClick={() => openStudio(`${tag}/${name}`)}>{name}</button>)}
    </div></td><td>Two-condition modeled template; offline edits saved/downloaded with owner. Online bypass/trap controls operate deployed blocks.</td></tr>}
    <tr><td>DEPLOYED CONTROLLER / SOURCES</td><td>{record.deployed?.controllerTag ?? '(not deployed)'}</td>
      <td>{runtime?.type === 'MOTOR' || runtime?.type === 'VALVE' ?
        `Interlock: ${runtime.interlockSource ?? 'manual'}; permissive: ${runtime.permissiveSource ?? 'manual'}; command: ${runtime.commandSource ?? 'operator'}` : ''}</td></tr>
    <tr><td>DEPLOYED INTERLOCK POLARITY</td><td>{record.deployed?.interlockInverted ? 'Healthy when source1; trips at0' : 'Trips when source1'}</td>
      <td>Bad always trips; manual interlock remains active-trip</td></tr>
    {!record.online && <>
      <DeviceDescriptorDraftRows key={`${tag}:${JSON.stringify(c.descriptors)}`} tag={tag} descriptors={c.descriptors} />
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
      <tr><td>DRAFT NATIVE INTERLOCK POLARITY</td><td><input type="checkbox" aria-label={`${tag} draft native interlock polarity`}
        checked={c.interlockInverted ?? false} onChange={e => edit(tag, { interlockInverted: e.target.checked })} /></td>
        <td>Selected: healthy at1, trips at0. Unselected: active-trip at1. Bad always trips.</td></tr>
      {(['interlockSource', 'permissiveSource', 'commandSource'] as const).map(source => <tr key={source}><td>DRAFT {source}</td><td>
        <select aria-label={`${tag} draft ${source}`} value={c[source] ?? ''} onChange={e => edit(tag, { [source]: e.target.value || undefined })}>
          <option value="">(manual/operator)</option>
          {c[source] && !tags.includes(c[source]) && <option>{c[source]}</option>}
          {tags.map(t => <option key={t}>{t}</option>)}
        </select></td><td>Saved connection; Download required</td></tr>)}
    </>}
  </>
}

function DeviceDescriptorDraftRows({ tag, descriptors }: { tag: string; descriptors?: DeviceStateDescriptors }): JSX.Element {
  const configured = useStore(s => s.namedSets.configured)
  const edit = useStore(s => s.editDeviceDraft)
  const [draft, setDraft] = useState<DeviceStateDescriptors>(descriptors ?? {
    namedSet: '', passiveCommand: 0, activeCommand: 1, passiveFeedback: 2, activeFeedback: 3
  })
  const definition = configured[draft.namedSet]
  return <>
    <tr><td>DRAFT DEVICE DESCRIPTORS</td><td><select aria-label={`${tag} descriptor Named Set`}
      value={draft.namedSet} onChange={e => setDraft({ ...draft, namedSet: e.target.value })}>
      <option value="">(default device labels)</option>
      {draft.namedSet && !definition && <option value={draft.namedSet}>{draft.namedSet} (missing)</option>}
      {Object.keys(configured).map(name => <option key={name}>{name}</option>)}
    </select></td><td>Four explicit command/feedback mappings; Apply, Save and Download required</td></tr>
    {draft.namedSet && descriptorRoles.map(role => <tr key={role}><td>DRAFT {role}</td><td>
      <select aria-label={`${tag} descriptor ${role}`} value={draft[role]}
        onChange={e => setDraft({ ...draft, [role]: Number(e.target.value) })}>
        {!definition?.entries.some(entry => entry.value === draft[role]) &&
          <option value={draft[role]}>{draft[role]} (missing entry)</option>}
        {definition?.entries.map(entry => <option key={entry.value} value={entry.value}>{entry.name} ({entry.value})</option>)}
      </select></td><td>Mapping only; SP_D/PV_D remain actual0/1</td></tr>)}
    <tr><td>APPLY DESCRIPTOR DRAFT</td><td><button className="tbtn sm"
      onClick={() => edit(tag, { descriptors: draft.namedSet ? draft : undefined })}>Apply Device Descriptors</button>
    </td><td>Unapplied selections do not change configuration or runtime</td></tr>
  </>
}

export function DeviceDownloadDialog({ tag, onClose }: { tag: string; onClose: () => void }): JSX.Element {
  const download = useStore(s => s.downloadDeviceConfiguration)
  return <SimulatorDialog className="module-download-dialog" label={`${tag} Device Download`} onClose={onClose}>
    <b>{tag} - Full Simulated Device Download</b>
    <p>Transfer only the saved device configuration, owned blocks and independent DI/DO bindings. Stop/close and confirm both channels passive first. Controller must be commissioned and both channels scanned Good. Failure or cancellation retains the last-good runtime.</p>
    <p>No partial download or physical controller communication. Deployed source connections execute on subsequent scans; a true command source can command this device active.</p>
    <div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => { if (download(tag)) onClose() }}>Confirm Device Download</button>
      <button className="tbtn sm" onClick={onClose}>Cancel Device Download</button>
    </div>
  </SimulatorDialog>
}
