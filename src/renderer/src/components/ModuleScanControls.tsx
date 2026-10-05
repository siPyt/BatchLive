import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { BASE_SCAN_SEC, SCAN_MULTIPLE_MAX, SCAN_MULTIPLE_MIN } from '../engine/moduleScheduling'

/** DV09-021: per-module scan multiple and manual execution order. */
export function ModuleScanControls({ tag }: { tag: string }): JSX.Element {
  const schedule = useStore(s => s.moduleScheduling[tag])
  const setSchedule = useStore(s => s.setModuleSchedule)
  const multiple = schedule?.multiple ?? 1
  const order = schedule?.order ?? null
  const [multipleText, setMultipleText] = useState(String(multiple))
  const [orderText, setOrderText] = useState(order === null ? '' : String(order))
  useEffect(() => {
    setMultipleText(String(multiple))
    setOrderText(order === null ? '' : String(order))
  }, [tag, multiple, order])
  return <div className="exp-props-alarms">
    <div className="exp-props-subhead">Module Scan and Execution Order</div>
    <label className="bld-f">Scan multiple ({SCAN_MULTIPLE_MIN}-{SCAN_MULTIPLE_MAX} x {BASE_SCAN_SEC} s)
      <input aria-label={`${tag} scan multiple`} value={multipleText} onChange={e => setMultipleText(e.target.value)} />
    </label>
    <label className="bld-f">Execution order (blank = automatic)
      <input aria-label={`${tag} execution order`} value={orderText} onChange={e => setOrderText(e.target.value)} />
    </label>
    <div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => setSchedule(tag, {
        multiple: Number(multipleText), order: orderText.trim() === '' ? null : Number(orderText) })}>Apply Scan Settings</button>
    </div>
    <p>{multiple === 1 ? 'Executes on every simulation step (default).' :
      `Executes once every ${multiple * BASE_SCAN_SEC} simulated seconds, integrating over the elapsed interval.`}
      {' '}Manually ordered modules run first, lowest number first; a consumer ordered ahead of its source reads the
      previous scan value. Only this module's algorithm is scheduled; I/O sampling and alarms still run each step.
      Project metadata; the single local loop is not a controller scan.</p>
  </div>
}
