import { useState } from 'react'
import { useStore } from '../engine/store'
import { changedPidTuningParameters, pidLifecycleDirty } from '../engine/pidLifecycle'
import { traditionalChannels } from '../engine/traditionalIo'
import { PidTransferDialog } from './PidTransferDialog'
import { DownloadStatusIndicator } from './DownloadStatusIndicator'
import { compareModuleDownload } from '../engine/downloadStatus'

export function PidLifecycleRows({ tag }: { tag: string }): JSX.Element {
  const [showUpload, setShowUpload] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const record = useStore(state => state.pidLifecycle[tag])
  const runtime = useStore(state => state.modules[tag])
  const hardware = useStore(state => state.hardware)
  const enable = useStore(state => state.enablePidLifecycle)
  const edit = useStore(state => state.editPidLifecycle)
  const save = useStore(state => state.savePidConfiguration)
  const load = useStore(state => state.loadSavedPidConfiguration)
  const download = useStore(state => state.downloadPidModule)
  const online = useStore(state => state.setPidLifecycleOnline)
  if (!record) return <tr><td>SAVED CONFIGURATION</td><td>
    <button className="tbtn sm" onClick={() => {
      if (window.confirm('Enable the isolated PID_LOOP Save/Download lifecycle? The loop will hold OOS until a Full Download and Go Online.')) enable(tag)
    }}>Enable Saved PID_LOOP Lifecycle</button>
  </td><td>Opt-in; currently live</td></tr>

  const draft = record.draft
  const dirty = pidLifecycleDirty(record)
  const controller = draft.controllerTag ? hardware.controllers[draft.controllerTag] : undefined
  const downloaded = runtime?.type === 'PID' && runtime.downloaded === true
  const changed = changedPidTuningParameters(record.saved, runtime?.type === 'PID' ? runtime : undefined)
  const comparison = compareModuleDownload(useStore.getState(), tag)
  const status = dirty ? 'Unsaved draft' : !downloaded ? 'Not downloaded - Full required' :
    comparison.status === 'UNKNOWN' ? 'Controller comparison unavailable' :
    comparison.status === 'DIFFERENT' ? 'Saved - download required' : 'Saved/deployed match'
  const channels = traditionalChannels(hardware)
  const aiChoices = channels.filter(({ card, channel }) => card.type === 'AI' && channel.dst)
  const aoChoices = channels.filter(({ card, channel }) => card.type === 'AO' && channel.dst)
  return <>
    <tr><td>MODULE DOWNLOAD STATUS</td><td colSpan={2}><DownloadStatusIndicator tag={tag} controls /></td></tr>
    <tr><td>CONFIGURATION / RUNTIME</td><td><div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => online(tag, !record.online)}>
        {record.online ? 'Go Offline' : 'Go Online'}
      </button>
      <button className="tbtn sm" disabled={record.online} onClick={() => save(tag)}>Save Module</button>
      <button className="tbtn sm" disabled={record.online} onClick={() => {
        if (window.confirm('Replace the offline PID_LOOP draft with the saved configuration from this browser profile? Runtime remains unchanged.')) load(tag)
      }}>Load Saved Configuration</button>
      <button className="tbtn sm" disabled={!record.online || !downloaded} onClick={() => setShowUpload(true)}>
        Upload Online Values
      </button>
      <button className="tbtn sm" disabled={record.online || dirty} onClick={() => {
        if (changed.length) setShowDownload(true)
        else if (window.confirm('Full-download this saved PID_LOOP to its assigned simulated controller?')) download(tag)
      }}>Full Download</button>
    </div>
      {showUpload && <PidTransferDialog tag={tag} mode="UPLOAD" onClose={() => setShowUpload(false)} />}
      {showDownload && <PidTransferDialog tag={tag} mode="DOWNLOAD" onClose={() => setShowDownload(false)} />}
    </td><td>{record.online ? 'Online runtime' : 'Offline draft'}; {status}</td></tr>
    <tr><td>SAVED / DOWNLOADED REVISION</td><td>{record.savedRevision} / {record.deployedRevision}</td>
      <td>Local browser database / simulated controller</td></tr>
    {!record.online && <>
      <tr><td>ASSIGNED CONTROLLER</td><td><select aria-label={`${tag} PID_LOOP assigned controller`}
        value={draft.controllerTag} onChange={event => edit(tag, { controllerTag: event.target.value })}>
        <option value="">(unassigned)</option>
        {Object.keys(hardware.controllers).sort().map(name => <option key={name} value={name}>{name}</option>)}
      </select></td><td>{controller?.commissioned ? 'Configured' : 'Commission a controller before download'}</td></tr>
      <tr><td>AI1.IO_IN</td><td><select aria-label={`${tag} PID_LOOP input DST`}
        value={draft.inputDst} onChange={event => edit(tag, { inputDst: event.target.value })}>
        <option value="">(none)</option>
        {draft.inputDst && !aiChoices.some(item => item.channel.dst === draft.inputDst) &&
          <option value={draft.inputDst}>Missing DST: {draft.inputDst}</option>}
        {aiChoices.map(({ card, channel }) => <option key={channel.dst} value={channel.dst}>
          {channel.dst} ({card.id} CH{channel.channel})
        </option>)}
      </select></td><td>Measured flow</td></tr>
      <tr><td>AO1.IO_OUT</td><td><select aria-label={`${tag} PID_LOOP output DST`}
        value={draft.outputDst} onChange={event => edit(tag, { outputDst: event.target.value })}>
        <option value="">(none)</option>
        {draft.outputDst && !aoChoices.some(item => item.channel.dst === draft.outputDst) &&
          <option value={draft.outputDst}>Missing DST: {draft.outputDst}</option>}
        {aoChoices.map(({ card, channel }) => <option key={channel.dst} value={channel.dst}>
          {channel.dst} ({card.id} CH{channel.channel})
        </option>)}
      </select></td><td>Increase-to-open percent</td></tr>
    </>}
  </>
}
