import { useState } from 'react'
import { changedPidTuningParameters, pidLifecycleDirty, type PidTuningParameter } from '../engine/pidLifecycle'
import { useStore } from '../engine/store'
import { SimulatorDialog } from './SimulatorDialog'

const PARAMETER_LABELS: Record<PidTuningParameter, string> = {
  gain: 'GAIN',
  reset: 'RESET (s/rpt)',
  rate: 'RATE (s)'
}

export function PidTransferDialog({ tag, mode, onClose }: {
  tag: string
  mode: 'UPLOAD' | 'DOWNLOAD'
  onClose: () => void
}): JSX.Element {
  const record = useStore(state => state.pidLifecycle[tag])
  const runtime = useStore(state => state.modules[tag])
  const upload = useStore(state => state.uploadPidParameters)
  const download = useStore(state => state.downloadPidModule)
  const [selected, setSelected] = useState<PidTuningParameter[]>([])
  const livePid = runtime?.type === 'PID' ? runtime : undefined
  const changed = changedPidTuningParameters(record?.saved, livePid)
  const canTransfer = mode === 'UPLOAD'
    ? Boolean(record?.online && livePid?.downloaded)
    : Boolean(record && !record.online && !pidLifecycleDirty(record) && record.saved)
  const action = mode === 'UPLOAD' ? 'Upload Selected' :
    selected.length ? 'Upload Selected and Download' : 'Download Only'

  function confirmTransfer(): void {
    const succeeded = mode === 'UPLOAD'
      ? upload(tag, selected)
      : download(tag, selected)
    if (succeeded) onClose()
  }

  return <SimulatorDialog className="module-download-dialog" label={`${tag} PID_LOOP ${mode}`} onClose={onClose}>
    <b>{tag} - {mode === 'UPLOAD' ? 'Upload Tuning Parameters' : 'Download with Optional Upload'}</b>
    <p>{mode === 'UPLOAD'
      ? 'Select online tuning values to write into the saved configuration. Unselected values and the running controller remain unchanged.'
      : 'Online tuning values differ from the configured defaults. Select values to upload before this simulated Full Download; selecting none keeps the configured defaults.'}</p>
    {changed.length ? <div className="traditional-channel-form">
      {changed.map(parameter => <label key={parameter}>
        <input type="checkbox" aria-label={`Upload ${tag} ${PARAMETER_LABELS[parameter]}`}
          checked={selected.includes(parameter)}
          onChange={event => setSelected(current => event.target.checked
            ? [...current, parameter] : current.filter(item => item !== parameter))} />
        {PARAMETER_LABELS[parameter]}: configured {record?.saved?.module[parameter]} / online {livePid?.[parameter]}
      </label>)}
    </div> : <p>No online tuning values differ from the configured defaults.</p>}
    {!canTransfer && <p role="alert">{mode === 'UPLOAD'
      ? 'Upload requires a clean, downloaded PID_LOOP that is Online.'
      : 'Go Offline and Save the PID_LOOP configuration before downloading.'}</p>}
    <div className="traditional-channel-form">
      <button className="tbtn sm" disabled={!canTransfer} onClick={confirmTransfer}>{action}</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button>
    </div>
  </SimulatorDialog>
}
