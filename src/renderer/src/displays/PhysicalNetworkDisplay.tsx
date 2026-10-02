import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { CHARM_TYPE_LABEL, controllerIsDown, type CharmChannel } from '../engine/hardware'

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
  const failController = useStore((s) => s.failController)
  const restoreController = useStore((s) => s.restoreController)
  const pullCharm = useStore((s) => s.pullCharm)
  const reinsertCharm = useStore((s) => s.reinsertCharm)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const modules = useStore((s) => s.modules)

  return (
    <div className="display" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 14, gap: 16 }}>
      {Object.values(hardware.controllers).map((c) => {
        const down = controllerIsDown(c)
        return (
          <div key={c.tag} className="exp-props" style={{ padding: 0 }}>
            <div className="batch-toolbar" style={{ borderRadius: '4px 4px 0 0' }}>
              <span className="batch-title">{c.tag}</span>
              <span style={{ color: 'var(--dv-text-dim)', fontSize: 12 }}>{c.description}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--dv-text-dim)' }}>
                Scan {c.scanTimeMs.toFixed(0)} ms &nbsp;·&nbsp; CPU {c.cpuLoadPct.toFixed(0)}%
              </span>
              <button className="tbtn sm" disabled={down} onClick={() => failController(c.tag)}>
                Fail {c.redundant ? (c.primary === 'FAILED' ? 'Secondary' : 'Primary') : ''}
              </button>
              <button className="tbtn sm" disabled={!down && c.primary === 'ACTIVE' && c.secondary !== 'FAILED'} onClick={() => restoreController(c.tag)}>
                Restore
              </button>
            </div>
            <div className="fp-row" style={{ padding: '8px 14px' }}>
              <span className="fp-label">Primary</span>
              <span style={{ color: ROLE_COLOR[c.primary], fontWeight: 700 }}>{c.primary}</span>
              {c.redundant && (
                <>
                  <span className="fp-label" style={{ marginLeft: 16 }}>
                    Secondary
                  </span>
                  <span style={{ color: ROLE_COLOR[c.secondary], fontWeight: 700 }}>{c.secondary}</span>
                </>
              )}
              {down && <span style={{ color: 'var(--dv-critical)', fontWeight: 800, marginLeft: 16 }}>CONTROLLER DOWN — all bound I/O is BAD</span>}
            </div>

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
          </div>
        )
      })}
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
