import { useState } from 'react'
import {
  BANNER_SHOWS_LABEL, PRIORITY_CLASSES, SILENT_WAVE, useAlarmPriorities, type BannerShows, type PriorityClass, type PriorityConfig
} from '../engine/alarmPriorities'

/** DV09-038: Explorer Setup > Alarm Preferences > Alarm Priorities. */
export function AlarmPrioritiesPanel(): JSX.Element {
  const priorities = useAlarmPriorities((s) => s.priorities)
  const setPriority = useAlarmPriorities((s) => s.setPriority)
  const reset = useAlarmPriorities((s) => s.reset)
  const [message, setMessage] = useState<string | null>(null)
  const apply = (cls: PriorityClass, patch: Partial<PriorityConfig>): void => setMessage(setPriority(cls, patch))
  return (
    <div className="exp-props" aria-label="Alarm priorities">
      <div className="exp-props-head"><b>Alarm Priorities</b><span>System Configuration &gt; Setup &gt; Alarm Preferences</span></div>
      <p>Numeric priority values run from 4 (lowest) to 15 (highest); level 3 is log-only. A module alarm whose explicit rank is 3 is an
        event record: it is journaled but never appears in the banner, list or horn. Each priority decides whether its alarms are
        acknowledged automatically, how the banner collapses them and which sound they use.</p>
      <table className="param-table" aria-label="Alarm priority classes">
        <thead><tr><th>Priority</th><th>Value</th><th>Auto acknowledge new alarms</th><th>Auto acknowledge when inactive</th>
          <th>Alarm Banner shows</th><th>Wave file</th></tr></thead>
        <tbody>
          {PRIORITY_CLASSES.map((cls) => {
            const c = priorities[cls]
            return (
              <tr key={cls}>
                <td><b>{cls === 'LOG' ? 'LOG (log only)' : cls}</b></td>
                <td>{cls === 'LOG' ? c.value : (
                  <input aria-label={`${cls} value`} type="number" min={4} max={15} style={{ width: 56 }} value={c.value}
                    onChange={(e) => apply(cls, { value: Number(e.target.value) })} />)}</td>
                <td><input aria-label={`${cls} auto acknowledge new`} type="checkbox" checked={c.autoAckNew} onChange={(e) => apply(cls, { autoAckNew: e.target.checked })} /></td>
                <td><input aria-label={`${cls} auto acknowledge inactive`} type="checkbox" checked={c.autoAckInactive} onChange={(e) => apply(cls, { autoAckInactive: e.target.checked })} /></td>
                <td>
                  <select aria-label={`${cls} banner shows`} value={c.bannerShows} onChange={(e) => apply(cls, { bannerShows: e.target.value as BannerShows })}>
                    {(Object.keys(BANNER_SHOWS_LABEL) as BannerShows[]).map((k) => <option key={k} value={k}>{BANNER_SHOWS_LABEL[k]}</option>)}
                  </select>
                </td>
                <td>
                  <input aria-label={`${cls} wave file`} style={{ width: 130 }} defaultValue={c.waveFile} key={c.waveFile}
                    onBlur={(e) => { if (e.target.value !== c.waveFile) apply(cls, { waveFile: e.target.value.trim() }) }} />
                  <button className="tbtn sm" onClick={() => apply(cls, { waveFile: SILENT_WAVE })}>Silence</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {message && <div role="alert">{message}</div>}
      <button className="tbtn sm" onClick={() => { reset(); setMessage(null) }}>Restore defaults</button>
      <p>Wave files name the sound only: the browser plays a synthesized tone per priority and does not load .wav files;
        "{SILENT_WAVE}" silences a priority. Captured parameters and controller-side time stamps are not modeled.</p>
    </div>
  )
}
