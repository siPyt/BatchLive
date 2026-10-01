import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm, fmt, isPid } from '../utils/format'

interface Props {
  tag: string
  x: number
  y: number
}

/** DeltaV-style numeric dynamo bound to a control module. */
export function ValueBox({ tag, x, y }: Props): JSX.Element | null {
  const m = useStore((s) => s.modules[tag])
  const alarms = useStore((s) => s.alarms)
  const openFaceplate = useUi((s) => s.openFaceplate)
  if (!m) return null

  const alm = moduleAlarm(tag, alarms)
  const almClass = alm ? ' alm-' + alm.priority.toLowerCase() : ''

  let value = 0
  let unit = ''
  let decimals = 1
  let mode: string | null = null
  let discreteText: string | null = null

  if (isPid(m)) {
    value = m.pv
    unit = m.unit
    decimals = m.decimals
    mode = m.mode
  } else if (m.type === 'AI') {
    value = m.pv
    unit = m.unit
    decimals = m.decimals
  } else if (m.type === 'DI' || m.type === 'DO') {
    discreteText = m.state ? m.activeDescriptor : m.inactiveDescriptor
  }

  return (
    <div
      className={'valbox' + almClass}
      style={{ left: x, top: y }}
      onClick={() => openFaceplate(tag)}
      title={m.description}
    >
      {mode && (
        <span className={'vb-mode mode-' + mode}>{mode}</span>
      )}
      <span className="vb-tag">{tag}</span>
      {discreteText !== null ? (
        <span className="vb-val" style={{ color: alm ? almColor(alm.priority) : '#9fb0c0', fontSize: 12 }}>
          {discreteText}
        </span>
      ) : (
        <span>
          <span className="vb-val" style={alm ? { color: almColor(alm.priority) } : undefined}>
            {fmt(value, decimals)}
          </span>
          <span className="vb-unit">{unit}</span>
        </span>
      )}
    </div>
  )
}

function almColor(p: string): string {
  if (p === 'CRITICAL') return '#ff6b70'
  if (p === 'WARNING') return '#ffd84d'
  return '#e79bef'
}
