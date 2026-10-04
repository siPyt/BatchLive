import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { SimulatorDialog } from '../components/SimulatorDialog'
import { PidTuningControls } from './PidFaceplate'

export function PidDetailDialog({ tag, onClose }: { tag: string; onClose: () => void }): JSX.Element {
  const module = useStore(state => state.modules[tag])
  const focusTrend = useUi(state => state.focusTrend)
  return <SimulatorDialog label={`${tag} PID Detail`} className="module-download-dialog" onClose={onClose}>
    <b>{tag} - PID Detail (simulated)</b>
    {module?.type === 'PID' ? <>
      <p>{module.description}</p>
      <p>PV {module.pv.toFixed(module.decimals)} / SP {module.sp.toFixed(module.decimals)} {module.unit};
        OUT {module.out.toFixed(1)}%; target {module.mode} / actual {module.actualMode}</p>
      <p>Tuning edits change online runtime only. Upload selected parameters to persist configured defaults.</p>
      <PidTuningControls tag={tag} />
      <button className="tbtn sm" onClick={() => { onClose(); focusTrend(tag) }}>Real-Time Trend</button>
    </> : <p role="alert">PID module no longer exists.</p>}
    <button className="tbtn sm" onClick={onClose}>Close Detail</button>
  </SimulatorDialog>
}
