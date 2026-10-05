import { useState } from 'react'
import { useStore } from '../engine/store'
import { usePictures } from '../engine/pictureStore'
import { exportConfiguration, importConfiguration } from '../engine/projectTransfer'
import { EXPORT_KIND_LABEL, type ExportKind } from '../engine/projectExport'

function saveFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/** DV09-084 Export workshop: export the Physical Network, Control Strategies, Named Sets and pictures, and import them back. */
export function ExportImportPanel({ initialNamedSet }: { initialNamedSet?: string | null }): JSX.Element {
  const configuredSets = useStore((s) => s.namedSets.configured)
  const pictureMap = usePictures((s) => s.pictures)
  const namedSets = Object.keys(configuredSets)
  const pictures = Object.keys(pictureMap)
  const [selectedSets, setSelectedSets] = useState<string[]>(initialNamedSet ? [initialNamedSet] : [])
  const [selectedPictures, setSelectedPictures] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  function run(kind: ExportKind, names: string[] = []): void {
    const result = exportConfiguration(kind, names)
    if ('error' in result) {
      setFailed(true)
      setMessage(result.error)
      return
    }
    saveFile(result.text, result.fileName)
    setFailed(false)
    setMessage(`${EXPORT_KIND_LABEL[kind]} exported to ${result.fileName}`)
  }

  function toggle(list: string[], name: string, on: boolean): string[] {
    return on ? [...list, name] : list.filter((n) => n !== name)
  }

  return (
    <div className="export-import">
      <h3>Export / Import</h3>
      <p>
        Exports are saved as BatchLive packages (not native .fhx or .grf files) and are validated before import. Copy the
        file to removable media from the save dialog.
      </p>
      <h4>Export</h4>
      <div>
        <button className="tbtn sm" onClick={() => run('physical-network')}>
          Export Physical Network
        </button>{' '}
        <button className="tbtn sm" onClick={() => run('control-strategies')}>
          Export Control Strategies
        </button>
      </div>
      <h4>Named Sets</h4>
      {namedSets.length === 0 && <p>No Named Sets are configured.</p>}
      {namedSets.map((name) => (
        <label key={name} style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={selectedSets.includes(name)}
            onChange={(e) => setSelectedSets(toggle(selectedSets, name, e.target.checked))}
          />{' '}
          {name}
        </label>
      ))}
      <button className="tbtn sm" disabled={!selectedSets.length} onClick={() => run('named-sets', selectedSets)}>
        Export Named Sets
      </button>
      <h4>Operator pictures</h4>
      {pictures.length === 0 && <p>No pictures are available.</p>}
      {pictures.map((name) => (
        <label key={name} style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={selectedPictures.includes(name)}
            onChange={(e) => setSelectedPictures(toggle(selectedPictures, name, e.target.checked))}
          />{' '}
          {name}
        </label>
      ))}
      <button className="tbtn sm" disabled={!selectedPictures.length} onClick={() => run('pictures', selectedPictures)}>
        Export Pictures
      </button>
      <h4>Import</h4>
      <input
        type="file"
        accept=".json,application/json"
        aria-label="Import package"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const result = importConfiguration(await file.text())
          if ('error' in result) {
            setFailed(true)
            setMessage(result.error)
          } else {
            setFailed(false)
            setMessage(`${EXPORT_KIND_LABEL[result.kind]}: ${result.summary}`)
          }
          e.target.value = ''
        }}
      />
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </div>
  )
}
