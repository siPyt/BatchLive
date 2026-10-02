import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { compareAlarmRank } from '../utils/format'

export function AlarmBanner(): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  const ackAll = useStore((s) => s.ackAll)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const hornSilenced = useStore((s) => s.hornSilenced)
  const silenceHorn = useStore((s) => s.silenceHorn)
  const navigate = useUi((s) => s.navigate)
  const openFaceplate = useUi((s) => s.openFaceplate)

  const shelvedCount = alarms.filter((a) => a.shelvedUntil !== undefined).length
  const visible = alarms.filter((a) => a.shelvedUntil === undefined)
  const active = visible.filter((a) => a.active)
  const counts = {
    critical: active.filter((a) => a.priority === 'CRITICAL').length,
    warning: active.filter((a) => a.priority === 'WARNING').length,
    advisory: active.filter((a) => a.priority === 'ADVISORY').length
  }
  const unackCount = visible.filter((a) => !a.acknowledged).length

  const tiles = [...visible].sort(compareAlarmRank).slice(0, 6)

  return (
    <div className="alarm-banner">
      <div className="alarm-banner-counts">
        <div className={'alarm-count ' + (counts.critical ? 'critical' : 'dim')}>
          <span className="n">{counts.critical}</span>
          <span className="lbl">Crit</span>
        </div>
        <div className={'alarm-count ' + (counts.warning ? 'warning' : 'dim')}>
          <span className="n">{counts.warning}</span>
          <span className="lbl">Warn</span>
        </div>
        <div className={'alarm-count ' + (counts.advisory ? 'advisory' : 'dim')}>
          <span className="n">{counts.advisory}</span>
          <span className="lbl">Adv</span>
        </div>
      </div>

      <div className="alarm-banner-tiles">
        {tiles.length === 0 && (
          <div style={{ color: 'var(--dv-text-mute)', paddingLeft: 10, fontSize: 13 }}>
            No active alarms
          </div>
        )}
        {tiles.map((a) => (
          <div
            key={a.id}
            className={
              'alarm-tile ' + a.priority.toLowerCase() + (a.acknowledged ? '' : ' unack')
            }
            title="Click to open faceplate · double-click to acknowledge"
            onClick={() => openFaceplate(a.moduleTag)}
            onDoubleClick={() => ackAlarm(a.id)}
          >
            <span className="tag">{a.moduleTag}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.moduleDesc}
            </span>
            <span className="atype">
              {a.label}
              {!a.active ? ' (RTN)' : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="alarm-banner-actions">
        <button className="tbtn sm" onClick={() => navigate('alarms')}>
          List{shelvedCount > 0 ? ` (${shelvedCount} shelved)` : ''}
        </button>
        <button
          className={'tbtn sm' + (hornSilenced ? ' active' : '')}
          onClick={silenceHorn}
          disabled={hornSilenced}
          title="Silence Horn (F8) — mutes audible tone without acknowledging"
        >
          🔇 Silence
        </button>
        <button className="tbtn sm" onClick={ackAll} disabled={unackCount === 0}>
          Ack Page ({unackCount})
        </button>
      </div>
    </div>
  )
}
