import type { MotorModule } from '../engine/types'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'

export function MotorInterlockRows({ module: m }: { module: MotorModule }): JSX.Element | null {
  const online = useStore(s => !!s.deviceLifecycle[m.tag]?.online)
  const safety = useStore(s => s.setFbSafety)
  const openStudio = useUi(s => s.openStudio)
  const blocks = m.ownedBlocks
  if (!blocks) return null
  const trap = blocks.BFI1
  const first = trap.firstOut ?? 0
  const causes = ['CND1', 'CND2'].filter((_, index) => (first & (1 << index)) !== 0)
  return <>
    <div className="fp-row"><span className="fp-label">First-out cause</span>
      <span>{first}: {causes.length ? causes.map(name => blocks[name].description).join('; ') : 'No trapped cause'}</span>
      <span>{trap.firstOutBad ? 'Bad captured status' : 'Captured history; not current trip'}</span>
    </div>
    <div className="fp-row"><button className="fp-btn" aria-label={`${m.tag} reset first-out history`} disabled={!online || !m.downloaded}
      onClick={() => safety(trap.tag, 'RESET_IN', true)}>Reset first-out history (not motor lock)</button></div>
    <div className="fp-row"><span className="fp-label">BYPASSED</span>
      <span>{blocks.OR1.bad ? 'Bad' : blocks.OR1.out ? 'YES - condition bypass active' : 'No'}</span></div>
    {['CND1', 'CND2'].map(name => {
      const b = blocks[name]
      return <div className="fp-row" key={name}>
        <button className="fp-btn" onClick={() => openStudio(b.tag)}>{name}: {b.description}</button>
        <span>{b.bad ? 'Bad - fail-safe trip' : b.out ? 'Trip active' : 'Clear'}{b.bypass ? ' / BYPASSED' : ''}</span>
        <button className="fp-btn" aria-label={`${m.tag} ${name} bypass`} disabled={!online || !m.downloaded}
          onClick={() => safety(b.tag, 'BYPASS', !b.bypass)}>{b.bypass ? 'Remove bypass' : 'Bypass condition'}</button>
      </div>
    })}
  </>
}
