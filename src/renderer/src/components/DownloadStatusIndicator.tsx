import { useStore } from '../engine/store'
import { moduleDownloadStatus, type DownloadStatus } from '../engine/downloadStatus'

const labels: Record<DownloadStatus, string> = {
  UNSUPPORTED: 'Not modeled', NO_CONFIGURATION: 'No configuration',
  UNKNOWN: 'Status unknown', DIFFERENT: 'Download required', MATCH: 'Up to date'
}

export function DownloadStatusIndicator({ tag, controls = false }: {
  tag: string; controls?: boolean
}): JSX.Element {
  const hardware = useStore(state => state.hardware)
  const moduleLifecycle = useStore(state => state.moduleLifecycle)
  const pidLifecycle = useStore(state => state.pidLifecycle)
  const deviceLifecycle = useStore(state => state.deviceLifecycle)
  const sfcLifecycle = useStore(state => state.sfcLifecycle)
  const downloadStatusChecks = useStore(state => state.downloadStatusChecks)
  const result = moduleDownloadStatus({
    hardware, moduleLifecycle, pidLifecycle, deviceLifecycle, sfcLifecycle, downloadStatusChecks
  }, tag)
  if (result.status === 'UNSUPPORTED') return <></>
  return <span className="download-status-group" data-download-status-tag={tag} data-download-status={result.status}>
    <span className={`download-status ${result.status.toLowerCase()}`} title={`${result.message}. Managed module scope only.`}
      aria-label={`${tag}: ${labels[result.status]}`}>
      {['NO_CONFIGURATION', 'UNKNOWN', 'DIFFERENT'].includes(result.status) &&
        <span className="download-status-triangle" aria-hidden="true">{result.status === 'UNKNOWN' ? '?' : ''}</span>}
      {labels[result.status]}
    </span>
    {controls &&
      <button className="tbtn sm" onClick={event => {
        event.stopPropagation()
        useStore.getState().updateModuleDownloadStatus(tag)
      }}>
        Update Download Status
      </button>}
  </span>
}
