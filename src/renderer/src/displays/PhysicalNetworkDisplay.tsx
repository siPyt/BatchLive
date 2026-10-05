import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../engine/store'
import { controllerAoRecords, controllerDeployedAoRecords } from '../engine/moduleLifecycle'
import { controllerRegulatoryRecords } from '../engine/controllerRegulatoryTransfer'
import { controllerManagedRecords } from '../engine/controllerModuleTransfer'
import { useUi } from '../ui/uiStore'
import { TraditionalIoPanel } from './TraditionalIoPanel'
import { SerialIoPanel } from '../components/SerialIoPanel'
import {
  CHARM_TYPE_LABEL,
  controllerIsDown,
  isValidControllerTag,
  MAX_COLD_RESTART_MINUTES,
  MAX_CONTROLLER_DESCRIPTION_LENGTH,
  type CharmChannel,
  type Controller
} from '../engine/hardware'

// DeltaV Explorer "Physical Network" view: Controller -> I/O Carrier (CIOC)
// -> CHARM Baseplate -> CHARM (one field signal per CHARM, auto-characterized).

const ROLE_COLOR: Record<string, string> = {
  ACTIVE: 'var(--dv-run)',
  STANDBY: 'var(--mode-cas)',
  FAILED: 'var(--dv-critical)',
  'N/A': 'var(--dv-text-mute)'
}

export function PhysicalNetworkDisplay(): JSX.Element {
  const hardware = useStore((s) => s.hardware)
  const createController = useStore((s) => s.createController)
  const failController = useStore((s) => s.failController)
  const restoreController = useStore((s) => s.restoreController)
  const openPowerLoss = useStore((s) => s.simulateControllerPowerLoss)
  const restorePower = useStore((s) => s.restoreControllerPower)
  const modules = useStore((s) => s.modules)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [createError, setCreateError] = useState('')
  const pullCharm = useStore((s) => s.pullCharm)
  const reinsertCharm = useStore((s) => s.reinsertCharm)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const tagExists = Object.keys(hardware.controllers).some((tag) => tag.toLowerCase() === newTag.trim().toLowerCase())
  const canCreate =
    isValidControllerTag(newTag.trim()) && newDescription.trim().length <= MAX_CONTROLLER_DESCRIPTION_LENGTH && !tagExists

  const submitController = (): void => {
    if (!canCreate) return
    if (!createController(newTag, newDescription)) {
      setCreateError('Controller could not be created. Verify your System Admin key and the controller details.')
      return
    }
    setNewTag('')
    setNewDescription('')
    setCreateError('')
    setCreateOpen(false)
  }

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 14, gap: 16 }}>
      <div className="hardware-lifecycle-toolbar">
        <div>
          <strong>Controller Lifecycle</strong>
          <span>Identify · commission · auto-sense I/O · cold restart</span>
        </div>
        <button className="tbtn sm" onClick={() => setCreateOpen((open) => !open)}>
          {createOpen ? 'Cancel' : '＋ Add Decommissioned Controller'}
        </button>
      </div>
      {createOpen && (
        <div className="hardware-create exp-newmod">
          <div className="exp-newmod-title">Add Decommissioned Controller</div>
          <label>
            Controller name
            <input value={newTag} maxLength={16} onChange={(e) => setNewTag(e.target.value)} placeholder="e.g. CTLR-02" />
          </label>
          <label>
            Description
            <input
              value={newDescription}
              maxLength={MAX_CONTROLLER_DESCRIPTION_LENGTH}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Optional controller description"
            />
          </label>
          {tagExists && <div className="exp-newmod-err">A controller with that name already exists.</div>}
          {newTag.trim() && !isValidControllerTag(newTag.trim()) && (
            <div className="exp-newmod-err">Use up to 16 letters, digits, $, - or _, with at least one letter.</div>
          )}
          {createError && <div className="exp-newmod-err">{createError}</div>}
          <div className="exp-newmod-actions">
            <button className="tbtn sm" disabled={!canCreate} onClick={submitController}>Create</button>
          </div>
        </div>
      )}
      {Object.values(hardware.controllers).map((c) => {
        const down = controllerIsDown(c)
        return (
          <ControllerPanel
            key={c.tag}
            controller={c}
            down={down}
            failController={failController}
            restoreController={restoreController}
            openPowerLoss={openPowerLoss}
            restorePower={restorePower}
          >
            <TraditionalIoPanel controllerTag={c.tag} />
            <SerialIoPanel controllerTag={c.tag} />
            {c.carrierIds.map((carrierId) => {
              const carrier = hardware.carriers[carrierId]
              if (!carrier) return null
              return (
                <div key={carrierId} style={{ padding: '0 14px 14px' }}>
                  <div className="batch-panel-head" style={{ marginTop: 6 }}>
                    I/O Carrier (CIOC) — {carrier.id}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {carrier.baseplateIds.map((bpId) => {
                      const bp = hardware.baseplates[bpId]
                      if (!bp) return null
                      return (
                        <div key={bpId} className="exp-newmod" style={{ width: 300 }}>
                          <div className="exp-newmod-title">CHARM Baseplate {bp.id}</div>
                          <table className="exp-props-table">
                            <tbody>
                              {bp.channels.map((ch) => (
                                <CharmRow
                                  key={ch.slot}
                                  ch={ch}
                                  down={down}
                                  onOpenFaceplate={ch.boundTag ? () => openFaceplate(ch.boundTag!) : undefined}
                                  boundDesc={ch.boundTag ? modules[ch.boundTag]?.description : undefined}
                                  onPull={() => pullCharm(bp.id, ch.slot)}
                                  onReinsert={() => reinsertCharm(bp.id, ch.slot)}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </ControllerPanel>
        )
      })}
    </div>
  )
}

function ControllerPanel({
  controller: c,
  down,
  failController,
  restoreController,
  openPowerLoss,
  restorePower,
  children
}: {
  controller: Controller
  down: boolean
  failController: (tag: string) => boolean
  restoreController: (tag: string) => boolean
  openPowerLoss: (tag: string) => boolean
  restorePower: (tag: string) => boolean
  children: ReactNode
}): JSX.Element {
  const setControllerConfiguration = useStore((s) => s.setControllerConfiguration)
  const commissionController = useStore((s) => s.commissionController)
  const decommissionController = useStore((s) => s.decommissionController)
  const identifyController = useStore((s) => s.identifyController)
  const autoSenseController = useStore((s) => s.autoSenseController)
  const [settings, setSettings] = useState({
    redundant: c.redundant,
    networkRedundant: c.networkRedundant,
    coldRestartMinutes: c.coldRestartMinutes
  })
  const [error, setError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [commissioningScan, setCommissioningScan] = useState(false)

  useEffect(() => {
    setSettings({
      redundant: c.redundant,
      networkRedundant: c.networkRedundant,
      coldRestartMinutes: c.coldRestartMinutes
    })
  }, [c.tag, c.redundant, c.networkRedundant, c.coldRestartMinutes])

  useEffect(() => {
    if (!c.commissioned) setCommissioningScan(false)
  }, [c.commissioned])

  const applySettings = (): void => {
    if (!Number.isInteger(settings.coldRestartMinutes) || settings.coldRestartMinutes < 0 || settings.coldRestartMinutes > MAX_COLD_RESTART_MINUTES) {
      setError(`Cold Restart must be an integer from 0 to ${MAX_COLD_RESTART_MINUTES} minutes (0 disables automatic restart).`)
      return
    }
    if (!setControllerConfiguration(c.tag, settings)) {
      setError('Controller properties were not changed. Check controller state and your Can Configure key.')
      return
    }
    setError('')
    setActionMessage('Controller properties applied.')
  }

  const commission = (): void => {
    if (!setControllerConfiguration(c.tag, settings)) {
      setError('Set valid controller properties before commissioning; Can Configure is required.')
      return
    }
    if (!commissionController(c.tag)) {
      setError('Commissioning failed. The controller may already be commissioned or your Can Download key is missing.')
      return
    }
    setError('')
    setActionMessage('Controller commissioned on the control network.')
    setCommissioningScan(true)
  }

  const identify = (): void => {
    if (!identifyController(c.tag, !c.identified)) {
      setError('Identify could not be changed. Verify controller state and the Diagnostic key.')
      return
    }
    setError('')
    setActionMessage(c.identified ? 'Identify flashing stopped.' : 'Identify flashing started.')
  }

  const failLeg = (): void => {
    if (!failController(c.tag)) {
      setError('Controller failure could not be simulated. Verify controller state and the Diagnostic key.')
      return
    }
    setError('')
    setActionMessage('Controller leg failure simulated.')
  }

  const decommission = (): void => {
    if (!decommissionController(c.tag)) {
      setError('Controller could not be decommissioned. Verify controller state and your Can Configure key.')
      return
    }
    setError('')
    setActionMessage('Controller decommissioned; bound I/O is now unavailable.')
  }

  const autoSense = (): void => {
    if (!autoSenseController(c.tag)) {
      setError('I/O auto-sense requires an available commissioned controller and the Diagnostic key.')
      return
    }
    setError('')
    setActionMessage('I/O auto-sense completed; review the detected-channel summary below.')
    setCommissioningScan(false)
  }

  const powerLoss = (): void => {
    if (!openPowerLoss(c.tag)) {
      setError('Power loss could not be simulated; verify controller state and the Diagnostic key.')
      return
    }
    setError('')
    setActionMessage('Controller power is off. Restore it to test the configured cold-restart window.')
  }

  const restorePowerNow = (): void => {
    if (!restorePower(c.tag)) {
      setError('Controller power could not be restored; verify the Diagnostic key.')
      return
    }
    setError('')
    setActionMessage('Power restored. Check the controller status and Event Journal for the cold-restart result.')
  }

  const restoreFault = (): void => {
    if (!restoreController(c.tag)) {
      setError('Controller fault could not be restored. Verify controller state and the Diagnostic key.')
      return
    }
    setError('')
    setActionMessage('Controller fault restore requested.')
  }

  const downMessage = c.powerDownAt !== null
    ? 'POWER OFF — all bound I/O is BAD'
    : !c.commissioned
      ? 'DECOMMISSIONED — all bound I/O is BAD'
      : down
        ? 'CONTROLLER DOWN — all bound I/O is BAD'
        : ''

  return (
    <div className="exp-props hardware-controller" style={{ padding: 0 }}>
      <div className="batch-toolbar hardware-controller-head">
        <span className="batch-title">{c.tag}</span>
        <span className="hardware-controller-description" title={c.description}>{c.description}</span>
        <span className={`hardware-controller-state ${c.commissioned ? 'online' : 'offline'}`}>
          {c.commissioned ? 'COMMISSIONED' : 'DECOMMISSIONED'}
        </span>
        <span className="hardware-controller-load">
          Scan {c.scanTimeMs.toFixed(0)} ms · CPU {c.cpuLoadPct.toFixed(0)}%
        </span>
        <button className="tbtn sm" disabled={c.powerDownAt !== null} onClick={identify}>
          {c.identified ? 'Stop Identify' : 'Identify'}
        </button>
        {c.commissioned ? (
          <button className="tbtn sm" disabled={down || c.powerDownAt !== null} onClick={decommission}>
            Decommission
          </button>
        ) : (
          <button className="tbtn sm" disabled={c.powerDownAt !== null} onClick={commission}>
            Commission
          </button>
        )}
        <button className="tbtn sm" disabled={!c.commissioned || down} onClick={autoSense}>Auto-sense I/O</button>
        <button className="tbtn sm" disabled={!c.commissioned || down} onClick={() => {
          const records = controllerAoRecords(useStore.getState().moduleLifecycle, c.tag)
          const reviewed = Object.fromEntries(records.map(([tag, record]) => [tag, record.saved]))
          if (window.confirm(`Full Download all configured managed AOs assigned to ${c.tag}: ${records.map(([tag]) => tag).join(', ') || '(none)'}. Every module is validated before any runtime changes. Running modes and outputs use saved defaults. Cancel aborts all transfers. PID/device/SFC, cards and Setup are excluded; this is not native controller Total Download.`)) {
            useStore.getState().downloadControllerAos(c.tag, reviewed)
          }
        }}>Full Download Managed AOs</button>
        <button className="tbtn sm" disabled={!c.commissioned || down} onClick={() => {
          const records = controllerRegulatoryRecords(useStore.getState(), c.tag)
          const reviewed = Object.fromEntries(records.map(({ tag, record }) => [tag, record.saved]))
          if (window.confirm(`Full Download managed regulatory modules on ${c.tag}: ${records.map(({ tag, kind }) => `${tag} (${kind})`).join(', ') || '(none)'}. All members must be saved and PID_LOOP Offline. AO running outputs use saved defaults; PID_LOOP remains held OOS until Go Online. Any failure or Cancel aborts every transfer. Live tuning is not uploaded. Devices/SFC, cards and Setup are excluded; this is not native Total Download.`)) {
            useStore.getState().downloadControllerRegulatory(c.tag, reviewed)
          }
        }}>Full Download Managed AO/PID</button>
        <button className="tbtn sm" disabled={!c.commissioned || down} onClick={() => {
          const records = controllerManagedRecords(useStore.getState(), c.tag)
          const reviewed = Object.fromEntries(records.map(({ tag, saved }) => [tag, saved]))
          if (window.confirm(`Full Download managed modules on ${c.tag}: ${records.map(({ tag, kind }) => `${tag} (${kind})`).join(', ') || '(none)'}. All drafts must be saved. PID/SFC must be Offline; devices stopped/closed with passive Good channels. AO uses saved defaults, PID stays OOS until Online, devices await confirmation and SFC stays READY without executing actions. Cancel or any member failure aborts the entire batch. Cards/Setup/unmanaged algorithms are excluded; this is not native Total Download.`)) {
            useStore.getState().downloadControllerManagedModules(c.tag, reviewed)
          }
        }}>Full Download Managed Modules</button>
        <button className="tbtn sm" disabled={!c.commissioned || down} onClick={() => {
          const records = controllerDeployedAoRecords(useStore.getState().moduleLifecycle, c.tag)
          const reviewed = Object.fromEntries(records.map(([tag, record]) => [tag, record.lastGoodDownload]))
          if (window.confirm(`Re-send last-good transfers for deployed managed AOs on ${c.tag}: ${records.map(([tag]) => tag).join(', ') || '(none)'}. Later saved/draft edits are excluded. This changes running modes/outputs atomically. Cancel aborts all replay. Recommissioning requires fresh Full. Other algorithms/cards/Setup and native controller scripts are excluded.`)) {
            useStore.getState().resendControllerAoDownloads(c.tag, reviewed)
          }
        }}>Re-send Last Good Managed AOs</button>
        <button className="tbtn sm" disabled={!c.commissioned || down} onClick={() => {
          if (window.confirm('Capture last-good downloads for managed AO modules on this controller into separate simulated restart memory? Running configuration and saved database stay unchanged. This opts those modules into transfer-snapshot restart; Partial downloads then require another memory update. Other module types and native controller scripts are not included.')) {
            useStore.getState().updateControllerAoRestartMemory(c.tag)
          }
        }}>Update AO Cold Restart Memory</button>
        <button className="tbtn sm" disabled={!c.commissioned || down || c.powerDownAt !== null} onClick={powerLoss}>Power Loss</button>
        {c.powerDownAt !== null ? (
          <button className="tbtn sm" onClick={restorePowerNow}>Restore Power</button>
        ) : (
          <button className="tbtn sm" disabled={!c.commissioned || !down} onClick={restoreFault}>Restore Fault</button>
        )}
        {c.commissioned && !down && c.powerDownAt === null && (
          <button className="tbtn sm" onClick={failLeg}>
            Fail {c.redundant && c.primary === 'FAILED' ? 'Secondary' : 'Primary'}
          </button>
        )}
      </div>
      <div className="fp-row hardware-controller-status">
        <span className="fp-label">Primary</span>
        <span style={{ color: ROLE_COLOR[c.primary], fontWeight: 700 }}>{c.primary}</span>
        {c.redundant && (
          <>
            <span className="fp-label">Secondary</span>
            <span style={{ color: ROLE_COLOR[c.secondary], fontWeight: 700 }}>{c.secondary}</span>
          </>
        )}
        <span className="hardware-network-address">
          Control network address: {c.controlNetworkAddress ?? 'not assigned'} (simulated)
        </span>
        {c.networkRedundant && <span className="hardware-network-badge">Network redundant</span>}
        {c.identified && <span className="hardware-identify-indicator">IDENTIFY FLASHING</span>}
        {downMessage && <strong className="hardware-controller-down">{downMessage}</strong>}
      </div>
      <div className="hardware-controller-settings">
        <label className="hardware-setting-check">
          Redundant controller
          <input
            type="checkbox"
            checked={settings.redundant}
            onChange={(e) => setSettings((current) => ({ ...current, redundant: e.target.checked }))}
          />
        </label>
        <label className="hardware-setting-check">
          Redundant control network
          <input
            type="checkbox"
            checked={settings.networkRedundant}
            onChange={(e) => setSettings((current) => ({ ...current, networkRedundant: e.target.checked }))}
          />
        </label>
        <label>
          Cold Restart (minutes; 0 disables)
          <input
            type="number"
            min={0}
            max={MAX_COLD_RESTART_MINUTES}
            step={1}
            value={Number.isNaN(settings.coldRestartMinutes) ? '' : settings.coldRestartMinutes}
            onChange={(e) =>
              setSettings((current) => ({ ...current, coldRestartMinutes: e.target.value.trim() ? Number(e.target.value) : Number.NaN }))
            }
          />
        </label>
        <button className="tbtn sm" disabled={down && c.commissioned} onClick={applySettings}>Apply Properties</button>
        {c.lastAutoSense ? (
          <span className="hardware-autosense-result">
            Last scan {new Date(c.lastAutoSense.scannedAt).toLocaleTimeString()} · {c.lastAutoSense.carriersScanned} carriers ·{' '}
            {c.lastAutoSense.baseplatesScanned} baseplates · {c.lastAutoSense.channelsDetected} channels detected ·{' '}
            {c.lastAutoSense.channelsBound} bound · {c.lastAutoSense.unresolvedBindings.length} unresolved
          </span>
        ) : (
          <span className="hardware-autosense-result">I/O has not been auto-sensed.</span>
        )}
        {(error || actionMessage) && (
          <span className={error ? 'hardware-action-message error' : 'hardware-action-message'} role={error ? 'alert' : 'status'}>
            {error || actionMessage}
          </span>
        )}
      </div>
      {commissioningScan && (
        <div className="hardware-controller-settings" role="group" aria-label="Commissioning I/O auto-sense">
          <span>Auto-sense I/O now? Commissioning is complete; No skips the scan.</span>
          <button className="tbtn sm" onClick={autoSense}>Yes — Auto-sense I/O</button>
          <button className="tbtn sm" onClick={() => {
            setCommissioningScan(false)
            setError('')
            setActionMessage('Controller commissioned without auto-sensing. Auto-sense I/O remains available later.')
          }}>No — Skip auto-sense</button>
        </div>
      )}
      {c.lastAutoSense?.unresolvedBindings.length ? (
        <div className="hardware-unresolved">
          Unresolved I/O references: {c.lastAutoSense.unresolvedBindings.join(', ')}
        </div>
      ) : null}
      {children}
    </div>
  )
}

function CharmRow({
  ch,
  down,
  onOpenFaceplate,
  boundDesc,
  onPull,
  onReinsert
}: {
  ch: CharmChannel
  down: boolean
  onOpenFaceplate?: () => void
  boundDesc?: string
  onPull: () => void
  onReinsert: () => void
}): JSX.Element {
  const empty = !ch.type
  const bad = !empty && (ch.pulled || down)
  const statusLabel = empty ? 'EMPTY' : bad ? 'BAD' : 'GOOD'
  const statusColor = empty ? 'var(--dv-text-mute)' : bad ? 'var(--dv-critical)' : 'var(--dv-run)'
  return (
    <tr>
      <td className="k" style={{ width: 22 }}>
        {ch.slot}
      </td>
      <td className="v" style={{ fontSize: 11 }}>
        {empty ? (
          <span style={{ color: 'var(--dv-text-mute)' }}>— spare —</span>
        ) : (
          <>
            <div style={{ fontWeight: 700 }}>{CHARM_TYPE_LABEL[ch.type!]}</div>
            <div
              style={{ color: onOpenFaceplate ? 'var(--dv-accent-2)' : 'var(--dv-text-dim)', cursor: onOpenFaceplate ? 'pointer' : 'default' }}
              onClick={onOpenFaceplate}
              title={onOpenFaceplate ? 'Open faceplate' : undefined}
            >
              {ch.boundTag}/{ch.boundField} {boundDesc ? `— ${boundDesc}` : ''}
            </div>
          </>
        )}
      </td>
      <td style={{ width: 54, textAlign: 'right' }}>
        {!empty && (
          <>
            <div style={{ color: statusColor, fontWeight: 800, fontSize: 10 }}>{statusLabel}</div>
            <button className="sfc-x" style={{ fontSize: 10 }} disabled={down} onClick={ch.pulled ? onReinsert : onPull} title={ch.pulled ? 'Reinsert CHARM' : 'Pull CHARM'}>
              {ch.pulled ? '⇤' : '⇥'}
            </button>
          </>
        )}
      </td>
    </tr>
  )
}
