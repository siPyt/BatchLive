import { useStore } from '../engine/store'
import type { ValveModule } from '../engine/types'
import { dcStateInfo, fmt } from '../utils/format'

export function ValveFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore((s) => s.modules[tag]) as ValveModule | undefined
  const openValve = useStore((s) => s.openValve)
  const closeValve = useStore((s) => s.closeValve)
  const toggleInterlock = useStore((s) => s.toggleInterlock)
  const injectFault = useStore((s) => s.injectFault)
  const resetDevice = useStore((s) => s.resetDevice)
  const setPermissive = useStore((s) => s.setPermissive)
  const setDeviceOptions = useStore((s) => s.setDeviceOptions)
  const binding = useStore((s) => s.hardware.deviceBindings?.[tag])
  const managed = useStore(s => !!s.deviceLifecycle[tag])
  if (!m) return null

  const { label: stateLabel, color: stateColor } = dcStateInfo(m.dcState)
  const transiting = m.dcState === 'GOING_ACTIVE' || m.dcState === 'GOING_PASSIVE'
  const openDisabled = m.downloaded === false || m.interlock || m.locked || (m.permissiveRequired && !m.permissiveOk && !m.open)

  return (
    <div className="fp-body">
      <div className="fp-row">
        <span className="fp-label">DC_STATE</span>
        <span className="fp-status-pill" style={{ background: stateColor, color: '#fff' }}>
          {stateLabel}
        </span>
      </div>
      {transiting && (
        <div className="fp-row">
          <span className="fp-label">Travel timer</span>
          <span style={{ color: 'var(--dv-text-dim)' }}>
            {fmt(m.travelTimer, 1)} / {fmt(m.confirmTimeSec, 1)} s
          </span>
        </div>
      )}

      <div className="fp-row">
        <button className={'fp-btn run' + (m.commandedOpen ? ' active' : '')} disabled={openDisabled} onClick={() => openValve(tag)}>
          OPEN
        </button>
        <button className={'fp-btn stop' + (!m.commandedOpen ? ' active' : '')} onClick={() => closeValve(tag)}>
          CLOSE
        </button>
      </div>

      <div className="fp-row">
        <span className="fp-label">Command (SP_D)</span>
        <span style={{ color: 'var(--dv-text-dim)' }}>{m.commandedOpen ? 'ACTIVE' : 'PASSIVE'}</span>
      </div>
      {binding && <>
        <div className="fp-row"><span className="fp-label">Resolved / applied output</span>
          <span>{Number(!!m.outputCommand)} / {Number(!!m.appliedCommand)} / {m.ioOutputBad ? 'Bad (held)' : 'Good'}</span></div>
        <div className="fp-row"><span className="fp-label">Feedback / quality</span>
          <span>{m.open ? 'Open' : 'Closed'} / {m.ioInputBad ? 'Bad (held)' : 'Good'}</span></div>
      </>}
      <div className="fp-row">
        <span className="fp-label">Interlock</span>
        <span style={{ color: m.interlock ? 'var(--dv-critical)' : 'var(--dv-text-dim)', fontWeight: 700 }}>
          {m.interlock ? 'TRIPPED' : 'CLEAR'}
        </span>
      </div>
      <div className="fp-row">
        <span className="fp-label">Permissive</span>
        <span style={{ color: m.permissiveOk ? 'var(--dv-text-dim)' : 'var(--dv-critical)', fontWeight: 700 }}>
          {m.permissiveRequired ? (m.permissiveOk ? 'OK' : 'NOT MET') : 'n/a'}
        </span>
      </div>

      <div className="fp-row" style={{ marginTop: 4 }}>
        <button className="fp-btn" onClick={() => toggleInterlock(tag)}>
          {m.interlock ? 'Clear Interlock' : 'Force Interlock'}
        </button>
        <button className="fp-btn" onClick={() => injectFault(tag)}>
          {m.fault ? 'Clear Fault' : 'Inject Fault'}
        </button>
      </div>
      {m.locked && (
        <div className="fp-row">
          <button
            className="fp-btn"
            style={{ borderColor: 'var(--dv-critical)', color: 'var(--dv-critical)' }}
            onClick={() => resetDevice(tag)}
          >
            RESET (RESET_D)
          </button>
        </div>
      )}

      <div className="fp-row" style={{ marginTop: 8, borderTop: '1px solid var(--dv-border)', paddingTop: 6 }}>
        <span className="fp-label">Device Options</span>
      </div>
      <div className="fp-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dv-text-dim)' }}>
          <input
            type="checkbox"
            disabled={managed}
            checked={m.permissiveRequired}
            onChange={(e) => setDeviceOptions(tag, { permissiveRequired: e.target.checked })}
          />
          Permissive
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dv-text-dim)' }}>
          <input
            type="checkbox"
            disabled={managed}
            checked={m.resetRequired}
            onChange={(e) => setDeviceOptions(tag, { resetRequired: e.target.checked })}
          />
          Reset Required
        </label>
      </div>
      {managed && <div className="fp-row">Deployed options; edit the offline draft in Control Studio and Save/Download.</div>}
      {m.permissiveRequired && (
        <div className="fp-row">
          <button className="fp-btn" onClick={() => setPermissive(tag, !m.permissiveOk)}>
            {m.permissiveOk ? 'Clear Permissive (PERMISSIVE_D)' : 'Set Permissive (PERMISSIVE_D)'}
          </button>
        </div>
      )}
    </div>
  )
}
