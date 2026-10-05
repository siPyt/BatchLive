import { useState } from 'react'
import { useStore } from '../engine/store'
import { useSecurity } from '../engine/security'
import {
  commissionPropertiesErrors, defaultCommissionProperties, type CommissionProperties
} from '../engine/commissioning'
import { MAX_CONTROLLER_DESCRIPTION_LENGTH } from '../engine/hardware'

const DRAG_TYPE = 'application/x-batchlive-controller'

interface Target { tag: string; placeholder: string | null }

/**
 * DV09-006: Explorer-style Physical Network hierarchy. Decommissioned controllers can be dragged onto the
 * Control Network or onto a placeholder, which opens the Commissioning Properties dialog; OK commissions the
 * controller and offers Auto-sense I/O.
 */
export function ControlNetworkPanel(): JSX.Element {
  const hardware = useStore((s) => s.hardware)
  const areas = useStore((s) => s.areas)
  const createPlaceholder = useStore((s) => s.createPlaceholder)
  const deletePlaceholder = useStore((s) => s.deletePlaceholder)
  const commission = useStore((s) => s.commissionControllerWithProperties)
  const autoSense = useStore((s) => s.autoSenseController)
  const canConfigure = useSecurity((s) => s.hasLock('CAN_CONFIGURE'))
  const [dragging, setDragging] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [props, setProps] = useState<CommissionProperties | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [sensePrompt, setSensePrompt] = useState<string | null>(null)

  const decommissioned = Object.values(hardware.controllers).filter((c) => !c.commissioned)
  const commissioned = Object.values(hardware.controllers).filter((c) => c.commissioned)
  const placeholders = Object.values(hardware.placeholders ?? {})
  const controller = target ? hardware.controllers[target.tag] : undefined
  const errors = props && controller ? commissionPropertiesErrors(props, {
    otherControllers: Object.keys(hardware.controllers).filter((t) => t !== controller.tag), areas, simplexOnly: !!controller.simplexOnly }) : []

  const open = (tag: string, placeholder: string | null): void => {
    const c = hardware.controllers[tag]
    if (!c || c.commissioned) return
    setMessage(null)
    setTarget({ tag, placeholder })
    setProps({ ...defaultCommissionProperties(c, hardware.controllerAreas?.[tag] ?? null), name: placeholder ?? c.tag })
  }
  const drop = (placeholder: string | null) => (e: React.DragEvent): void => {
    e.preventDefault()
    const tag = e.dataTransfer.getData(DRAG_TYPE) || dragging
    setHover(null)
    setDragging(null)
    if (tag) open(tag, placeholder)
  }
  const dropZone = (id: string, placeholder: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (dragging) { e.preventDefault(); setHover(id) } },
    onDragLeave: () => setHover((h) => (h === id ? null : h)),
    onDrop: drop(placeholder)
  })
  const zoneStyle = (id: string): React.CSSProperties => ({
    border: `1px dashed ${hover === id ? 'var(--dv-accent, #1aa7ec)' : 'var(--dv-border, #445)'}`, padding: 8, minHeight: 36,
    background: hover === id ? 'rgba(26,167,236,0.12)' : undefined })

  const accept = (): void => {
    if (!target || !props) return
    const result = commission(target.tag, props, target.placeholder)
    if (result) { setMessage(result); return }
    const finalName = target.placeholder ?? props.name.trim()
    setTarget(null)
    setProps(null)
    setSensePrompt(finalName)
    setMessage(`Controller ${finalName} commissioned.`)
  }

  const update = (patch: Partial<CommissionProperties>): void => setProps((p) => (p ? { ...p, ...patch } : p))

  return (
    <section className="control-network" aria-label="Control Network" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <div className="batch-panel-head">Decommissioned Nodes</div>
        {decommissioned.length === 0 && <div className="exp-empty sm">No decommissioned controllers.</div>}
        {decommissioned.map((c) => (
          <div key={c.tag} draggable data-decommissioned={c.tag} className="hardware-node" title="Drag onto the Control Network or a placeholder to commission"
            style={{ padding: '4px 8px', cursor: 'grab', display: 'flex', gap: 8, alignItems: 'center' }}
            onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, c.tag); e.dataTransfer.effectAllowed = 'move'; setDragging(c.tag) }}
            onDragEnd={() => { setDragging(null); setHover(null) }}>
            <span>⠿ {c.tag}</span>
            <span style={{ color: 'var(--dv-text-mute)' }}>{c.description}{c.simplexOnly ? ' (simplex)' : ''}</span>
            <button className="tbtn sm" disabled={c.powerDownAt !== null} onClick={() => open(c.tag, null)}>Commission…</button>
          </div>
        ))}
      </div>
      <div>
        <div className="batch-panel-head">Control Network</div>
        <div data-dropzone="network" style={zoneStyle('network')} {...dropZone('network', null)}>
          {commissioned.length === 0 ? <span className="exp-empty sm">Drop a decommissioned controller here to commission it.</span> :
            commissioned.map((c) => <div key={c.tag}>{c.tag} · {c.controlNetworkAddress}{hardware.controllerAreas?.[c.tag] ? ` · area ${hardware.controllerAreas[c.tag]}` : ''}</div>)}
        </div>
        <div style={{ marginTop: 6 }}><b>Placeholders</b></div>
        {placeholders.length === 0 && <div className="exp-empty sm">No placeholders.</div>}
        {placeholders.map((p) => (
          <div key={p.name} data-dropzone={`placeholder-${p.name}`} style={{ ...zoneStyle(`placeholder-${p.name}`), display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}
            {...dropZone(`placeholder-${p.name}`, p.name)}>
            <span>▭ {p.name}</span><span style={{ color: 'var(--dv-text-mute)' }}>{p.description}</span>
            <span style={{ flex: 1 }} />
            <button className="tbtn sm" disabled={!canConfigure} aria-label={`Delete placeholder ${p.name}`} onClick={() => setMessage(deletePlaceholder(p.name) ?? `Placeholder ${p.name} deleted.`)}>Delete</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <input aria-label="Placeholder name" placeholder="Placeholder name" maxLength={16} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input aria-label="Placeholder description" placeholder="Description" maxLength={MAX_CONTROLLER_DESCRIPTION_LENGTH} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          <button className="tbtn sm" disabled={!canConfigure} onClick={() => {
            const error = createPlaceholder(newName, newDescription)
            setMessage(error ?? `Placeholder ${newName.trim()} created.`)
            if (!error) { setNewName(''); setNewDescription('') }
          }}>Add Placeholder</button>
        </div>
      </div>
      {message && <div role="status" style={{ gridColumn: '1 / -1' }}>{message}</div>}
      {sensePrompt && (
        <div role="group" aria-label="Auto-sense I/O prompt" style={{ gridColumn: '1 / -1' }}>
          Auto-sense I/O cards for {sensePrompt}? Yes scans the I/O subsystem; No commissions without scanning (auto-sense can be run any time).
          <button className="tbtn sm" style={{ marginLeft: 8 }} onClick={() => {
            setMessage(autoSense(sensePrompt) ? `Auto-sense of ${sensePrompt} complete.` : `Auto-sense of ${sensePrompt} could not run.`)
            setSensePrompt(null)
          }}>Yes</button>
          <button className="tbtn sm" onClick={() => { setMessage(`${sensePrompt} commissioned without auto-sensing.`); setSensePrompt(null) }}>No</button>
        </div>
      )}
      {target && props && controller && (
        <div role="dialog" aria-label={`Commission ${controller.tag}`} className="commission-dialog"
          style={{ position: 'fixed', top: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 50, padding: 14, width: 460, maxHeight: '80vh', overflow: 'auto',
            background: 'var(--dv-panel, #1d2733)', border: '1px solid var(--dv-border, #445)', boxShadow: '0 6px 24px #000a' }}>
          <b>Commission {controller.tag}{target.placeholder ? ` onto placeholder ${target.placeholder}` : ''}</b>
          <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <label htmlFor="cd-name">Name</label>
            <input id="cd-name" maxLength={16} disabled={target.placeholder !== null} value={props.name} onChange={(e) => update({ name: e.target.value })} />
            <label htmlFor="cd-desc">Description</label>
            <input id="cd-desc" maxLength={MAX_CONTROLLER_DESCRIPTION_LENGTH} value={props.description} onChange={(e) => update({ description: e.target.value })} />
            <label htmlFor="cd-area">Associate alarms &amp; events with area</label>
            <select id="cd-area" value={props.area ?? ''} onChange={(e) => update({ area: e.target.value || null })}>
              <option value="">(none)</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <label style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={props.hardwareAlarms} onChange={(e) => update({ hardwareAlarms: e.target.checked })} /> Enable system hardware alarms</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={props.networkRedundant} onChange={(e) => update({ networkRedundant: e.target.checked })} /> Enable network redundancy for this node</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={props.timeSyncIntegrity} onChange={(e) => update({ timeSyncIntegrity: e.target.checked })} /> Show integrity error when not in time sync</label>
          <label style={{ display: 'block', opacity: controller.simplexOnly ? 0.5 : 1 }}>
            <input type="checkbox" disabled={!!controller.simplexOnly} checked={props.redundant && !controller.simplexOnly} onChange={(e) => update({ redundant: e.target.checked })} /> Node is redundant{controller.simplexOnly ? ' (simplex controller)' : ''}
          </label>
          {errors.length > 0 && <ul role="alert" style={{ color: 'var(--dv-critical)' }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {message && target && <div role="alert" style={{ color: 'var(--dv-critical)' }}>{message}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="tbtn sm" disabled={errors.length > 0} onClick={accept}>OK</button>
            <button className="tbtn sm" onClick={() => { setTarget(null); setProps(null); setMessage(null) }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
