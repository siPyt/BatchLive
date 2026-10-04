import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { usePictures } from '../engine/pictureStore'
import { useUi } from '../ui/uiStore'

export function ModuleDisplayControls({ tag }: { tag: string }): JSX.Element {
  const m = useStore(s => s.modules[tag])
  const assign = usePictures(s => s.assignModuleDisplays)
  const open = useUi(s => s.openModuleDisplay)
  const [primary, setPrimary] = useState(m?.primaryDisplay ?? '')
  const [detail, setDetail] = useState(m?.detailDisplay ?? '')
  useEffect(() => {
    setPrimary(m?.primaryDisplay ?? '')
    setDetail(m?.detailDisplay ?? '')
  }, [tag, m?.primaryDisplay, m?.detailDisplay])
  return <div className="exp-props-alarms">
    <div className="exp-props-subhead">Module Display Assignments</div>
    <label className="bld-f">Primary Control Display
      <input aria-label={`${tag} primary display`} value={primary} onChange={e => setPrimary(e.target.value)} />
    </label>
    <label className="bld-f">Detail Display
      <input aria-label={`${tag} detail display`} value={detail} onChange={e => setDetail(e.target.value)} />
    </label>
    <div className="traditional-channel-form">
      <button className="tbtn sm" onClick={() => assign(tag, primary, detail)}>Apply Display Assignments</button>
      <button className="tbtn sm" disabled={!m?.primaryDisplay} onClick={() => open(tag, 'primary')}>Open Primary Display</button>
      <button className="tbtn sm" disabled={!m?.detailDisplay} onClick={() => open(tag, 'detail')}>Open Detail Display</button>
    </div>
    <p>Use a created picture, Ovw_ref.grf or alarmList.grf. Blank removes a reference.
      Project metadata; not a controller download. Faceplate keeps its existing module-specific controls.</p>
  </div>
}
