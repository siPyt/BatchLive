import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { sfcDraftDirty, sfcNeedsDownload, type SfcConfiguration } from '../engine/sfcLifecycle'
import { SimulatorDialog } from './SimulatorDialog'
import { DownloadStatusIndicator } from './DownloadStatusIndicator'

export function SfcLifecycleControls({ name }: { name: string }): JSX.Element {
  const lifecycle = useStore(s => s.sfcLifecycle[name])
  const runtimeStatus = useStore(s => s.sfcs[name]?.status)
  const [properties, setProperties] = useState<SfcConfiguration | null>(null)
  const [download, setDownload] = useState<SfcConfiguration | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (lifecycle?.online) { setProperties(null); setDownload(null) }
  }, [lifecycle?.online])
  if (!lifecycle) return <div className="traditional-note">
    <button className="tbtn sm" onClick={() => useStore.getState().enableSfcLifecycle(name)}>Use Save/Download lifecycle</button>
    {' '}Existing sample charts remain session-local until enabled. Enabling requires Reset and disables
    execution until configuration is saved and downloaded.
  </div>
  const dirty = sfcDraftDirty(lifecycle)
  return <div className="traditional-note">
    <div className="sfc-edit-row">
      <strong>{lifecycle.online ? 'Online — deployed SFC' : 'Offline — configured SFC draft'}</strong>
      <span>{dirty ? 'Unsaved edits' : 'Saved'} · {sfcNeedsDownload(lifecycle) ? 'Download required' :
        lifecycle.deployed ? 'Saved/deployed match' : 'Not downloaded'}</span>
      <DownloadStatusIndicator tag={name} controls />
      <button className="tbtn sm" disabled={lifecycle.online} onClick={() => setProperties(lifecycle.draft)}>Module Properties...</button>
      <button className="tbtn sm" disabled={lifecycle.online} onClick={() => useStore.getState().saveSfc(name)}>Save</button>
      <button className="tbtn sm" disabled={lifecycle.online} onClick={() => {
        if (window.confirm('Replace the offline SFC draft with its saved browser configuration? The deployed SFC will not change.')) {
          useStore.getState().loadSavedSfc(name)
        }
      }}>Load Saved</button>
      <button className="tbtn sm" disabled={lifecycle.online || !lifecycle.saved || dirty} onClick={() => {
        setError(''); setDownload(lifecycle.saved ?? null)
      }}>Download...</button>
      <button className="tbtn sm" onClick={() => useStore.getState().setSfcOnline(name, !lifecycle.online)}>
        {lifecycle.online ? 'Go Offline' : 'Go Online'}
      </button>
    </div>
    <p>Configured controller: {lifecycle.draft.controllerTag || '(unassigned)'}.
      {' '}Deployed controller: {lifecycle.deployed?.controllerTag || '(not downloaded)'}.
      {' '}Deployed status: {lifecycle.deployed ? runtimeStatus : '(not downloaded)'}.
      {' '}Offline edits and Save do not execute or replace the deployed algorithm. Reset before editing,
      loading or downloading; Online commands operate the deployed version only.</p>
    <p>Configured description: {lifecycle.draft.description || '(none)'}.
      {' '}Equipment Module: {lifecycle.draft.equipmentModule || '(unassigned)'}.
      {' '}Deployed description: {lifecycle.deployed?.description || '(none)'}.
      {' '}Deployed Equipment Module: {lifecycle.deployed?.equipmentModule || '(unassigned)'}.</p>
    <p>This is the simulated SFC/browser-save subset, including return/selective routes and independent parallel legs with all-predecessor joins.
      Explorer New Control Module supports FBD/SFC algorithm selection; native dialog/template, graph palette/layout and nested/selective parallel legs,
      arbitrary parameter types and controller restart/nonvolatile restoration remain unsupported.
      Downloaded copies are session-local; loading a saved draft does not deploy it.</p>
    {properties && <SfcModuleProperties configuration={properties} onClose={() => setProperties(null)} />}
    {download && <SimulatorDialog className="module-download-dialog" label={`Download SFC ${name}`} onClose={() => setDownload(null)}>
      <h3>Download SFC {name}</h3>
      <p>Saved configuration: {download.steps.length} steps → {download.controllerTag || '(unassigned)'}.</p>
      <p>Confirmation replaces only this simulated SFC with its saved algorithm, clears step/action timers
        and leaves it READY. It does not start equipment or transfer other setup/module configurations.</p>
      {error && <p role="alert">{error}</p>}
      <div className="sfc-edit-row">
        <button className="tbtn sm" onClick={() => {
          if (useStore.getState().downloadSavedSfc(name, download)) setDownload(null)
          else setError('Download was rejected. See the reported target, permission or configuration error.')
        }}>Download</button>
        <button className="tbtn sm" onClick={() => setDownload(null)}>Cancel</button>
      </div>
    </SimulatorDialog>}
  </div>
}

function SfcModuleProperties({ configuration, onClose }: {
  configuration: SfcConfiguration; onClose: () => void
}): JSX.Element {
  const controllers = useStore(s => s.hardware.controllers)
  const equipment = useStore(s => s.equipment)
  const [target, setTarget] = useState(configuration.controllerTag)
  const [description, setDescription] = useState(configuration.description ?? '')
  const [equipmentModule, setEquipmentModule] = useState(configuration.equipmentModule ?? '')
  const [error, setError] = useState('')
  return <SimulatorDialog className="module-download-dialog" label={`Module Properties: ${configuration.name}`} onClose={onClose}>
    <h3>Module Properties: {configuration.name}</h3>
    <p>Algorithm Type: Sequential Function Chart</p><p>Area: {configuration.area}</p>
    <label className="bld-f">Description
      <input aria-label="SFC description" value={description} onChange={event => setDescription(event.target.value)} />
    </label>
    <label className="bld-f">Equipment Module
      <select aria-label="SFC Equipment Module" value={equipmentModule} onChange={event => setEquipmentModule(event.target.value)}>
        <option value="">(Unassigned)</option>
        {equipmentModule && (!equipment[equipmentModule] || equipment[equipmentModule].area !== configuration.area) &&
          <option value={equipmentModule}>{equipmentModule} (missing or wrong area)</option>}
        {Object.values(equipment).filter(item => item.area === configuration.area)
          .map(item => <option key={item.tag}>{item.tag}</option>)}
      </select>
    </label>
    <label>Controller<select aria-label="SFC configured controller" value={target} onChange={e => setTarget(e.target.value)}>
      <option value="">(unassigned)</option>
      {target && !controllers[target] && <option value={target}>{target} (missing)</option>}
      {Object.keys(controllers).map(tag => <option key={tag}>{tag}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={() => {
        if (useStore.getState().configureSfcProperties(configuration.name, {
          controllerTag: target, description, equipmentModule: equipmentModule || undefined
        }, configuration)) onClose()
        else setError('Module Properties were not applied. See the reported staleness, target, equipment or permission error.')
      }}>OK</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button>
    </div>
  </SimulatorDialog>
}
