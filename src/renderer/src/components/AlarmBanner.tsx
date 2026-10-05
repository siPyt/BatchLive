import { useState } from 'react'
import { useStore } from '../engine/store'
import { isSfcAlarm } from '../engine/sfcBlocks'
import { useSecurity } from '../engine/security'
import { useUi } from '../ui/uiStore'
import { alarmEligible, compareAlarmRank } from '../utils/format'

export function AlarmBanner(): JSX.Element {
  const [areaPickerOpen, setAreaPickerOpen] = useState(false)
  const alarms = useStore((s) => s.alarms)
  const modules = useStore((s) => s.modules)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const hornSilenced = useStore((s) => s.hornSilenced)
  const silenceHorn = useStore((s) => s.silenceHorn)
  const navigate = useUi((s) => s.navigate)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const openSfc = useUi(s => s.openSfc)
  const subscribedAreas = useUi((s) => s.subscribedAreas)
  const setSubscribedAreas = useUi((s) => s.setSubscribedAreas)
  const hasAreaKey = useSecurity((s) => s.hasAreaKey)

  const shelvedCount = alarms.filter((a) => a.shelvedUntil !== undefined).length
  // DV09-044: counts, tiles, horn and "Ack Page" must all use the same
  // eligible set — subscribed-area AND area-write-key eligible.
  const eligible = alarms.filter((a) =>
    alarmEligible(a, modules[a.moduleTag]?.area, subscribedAreas, hasAreaKey)
  )
  const visible = eligible.filter((a) => a.shelvedUntil === undefined)
  const active = visible.filter((a) => a.active)
  const counts = {
    critical: active.filter((a) => a.priority === 'CRITICAL').length,
    warning: active.filter((a) => a.priority === 'WARNING').length,
    advisory: active.filter((a) => a.priority === 'ADVISORY').length
  }
  const unackCount = visible.filter((a) => !a.acknowledged).length
  const ackPage = (): void => {
    visible.filter((a) => !a.acknowledged).forEach((a) => ackAlarm(a.id))
  }

  const allAreas = Array.from(new Set(Object.values(modules).map((m) => m.area))).sort()

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
          <div className="alarm-banner-empty">
            No active alarms
          </div>
        )}
        {tiles.map((a) => (
          <div
            key={a.id}
            className={
              'alarm-tile ' + a.priority.toLowerCase() + (a.acknowledged ? '' : ' unack')
            }
            title={`${a.moduleTag}: ${a.moduleDesc} · ${a.label}${!a.active ? ' (RTN)' : ''} — Click to open ${isSfcAlarm(a) ? 'SFC' : 'faceplate'} · double-click to acknowledge`}
            onClick={() => isSfcAlarm(a) ? openSfc(a.moduleTag) : openFaceplate(a.moduleTag)}
            onDoubleClick={() => ackAlarm(a.id)}
          >
            <svg className="alarm-tile-symbol" viewBox="0 0 16 16" aria-hidden="true">
              {a.priority === 'CRITICAL'
                ? <><circle cx="8" cy="8" r="6" fill="#c0392b" /><path d="m5 5 6 6m0-6-6 6" stroke="#fff" strokeWidth="2" /></>
                : <><path d={a.priority === 'WARNING' ? 'M8 1 15 14H1Z' : 'M1 2H15L8 15Z'}
                  fill={a.priority === 'WARNING' ? '#d7bd30' : '#6f3198'} stroke="#6b7680" />
                  <path d="M8 5v4m0 2v1" stroke={a.priority === 'WARNING' ? '#17222b' : '#fff'} strokeWidth="2" /></>}
            </svg>
            <span className="tag">{a.moduleTag}</span>
            <span className="description">
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
        <div style={{ position: 'relative' }}>
          <button
            className={'tbtn sm' + (subscribedAreas !== null ? ' active' : '') + (areaPickerOpen ? ' active' : '')}
            title="DV09-044: subscribe this workstation to specific areas (default: all areas)"
            onClick={() => setAreaPickerOpen((v) => !v)}
          >
            Areas{subscribedAreas !== null ? ` (${subscribedAreas.length})` : ''} ▾
          </button>
          {areaPickerOpen && (
            <div className="alm-colpicker">
              <div className="alm-colpicker-row">
                <label>
                  <input
                    type="checkbox"
                    checked={subscribedAreas === null}
                    onChange={() => setSubscribedAreas(subscribedAreas === null ? [] : null)}
                  />
                  All areas (unrestricted)
                </label>
              </div>
              {allAreas.map((area) => (
                <div key={area} className="alm-colpicker-row">
                  <label>
                    <input
                      type="checkbox"
                      disabled={subscribedAreas === null}
                      checked={subscribedAreas !== null && subscribedAreas.includes(area)}
                      onChange={() =>
                        setSubscribedAreas(
                          subscribedAreas === null
                            ? [area]
                            : subscribedAreas.includes(area)
                              ? subscribedAreas.filter((a) => a !== area)
                              : [...subscribedAreas, area]
                        )
                      }
                    />
                    {area}
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="tbtn sm" onClick={ackPage} disabled={unackCount === 0}>
          Ack Page ({unackCount})
        </button>
      </div>
    </div>
  )
}
