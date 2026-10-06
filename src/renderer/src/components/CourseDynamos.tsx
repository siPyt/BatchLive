import { DYNAMO_SETS, dynamoState } from '../engine/pictureObjects'
import { highestRankedAlarmState } from '../engine/pictureDynamics'
import type { PicElement } from '../engine/pictureStore'
import type { ActiveAlarm, AnyModule } from '../engine/types'

/**
 * Isolated course dynamo library (DV09-031/051/062): Valve17, PumpsAnim, PipesAnim and ValveHorizontalControlD1.
 * These are opt-in objects for custom pictures; they never replace the approved plant mechanical symbols.
 * Default animation follows the course example: white when stopped/closed, yellow when running/open/flowing.
 */
export function CourseDynamo({ element, modules, alarms, onMouseDown, onClick, selected }: {
  element: PicElement
  modules: Record<string, AnyModule>
  alarms: ActiveAlarm[]
  onMouseDown?: (event: React.MouseEvent) => void
  onClick?: (event: React.MouseEvent) => void
  selected?: boolean
}): JSX.Element | null {
  if (!element.dynamoSet) return null
  const info = DYNAMO_SETS[element.dynamoSet]
  const state = dynamoState(element, modules)
  const live = 'error' in state ? null : state
  const error = 'error' in state ? state.error : undefined
  const alarmState = element.showActiveAlarm ? highestRankedAlarmState(element.tag ?? '', alarms) : 'NORMAL'
  const alarming = alarmState !== 'NORMAL'
  const color = live ? live.color : '#d8d8d8'
  const active = !!live && live.active && !live.bad
  const outline = alarming ? '#cc0000' : '#4a4a4a'
  const w = info.width
  const h = info.height
  const label = `${info.label} ${element.tag ?? ''}${error ? `: ${error}` : live?.bad ? ': Bad feedback' : ''}${alarming ? ` — alarm ${alarmState}` : ''}`
  let body: JSX.Element
  switch (element.dynamoSet) {
    case 'PUMPS_ANIM':
      body = <g>
        <circle cx={w / 2} cy={h / 2} r={h / 2 - 4} fill={color} stroke={outline} strokeWidth={alarming ? 3 : 1.5} />
        <g className={active ? 'cd-spin' : undefined} style={{ transformOrigin: `${w / 2}px ${h / 2}px` }}>
          {[0, 120, 240].map(angle => <path key={angle} d={`M ${w / 2} ${h / 2} L ${w / 2} ${h / 2 - h / 2 + 10}`} stroke="#333" strokeWidth={4} strokeLinecap="round"
            transform={`rotate(${angle} ${w / 2} ${h / 2})`} />)}
          <circle cx={w / 2} cy={h / 2} r={4} fill="#333" />
        </g>
      </g>
      break
    case 'VALVE17':
      body = <g>
        <rect x={w / 2 - 10} y={2} width={20} height={14} fill="#e8e8e8" stroke={outline} strokeWidth={alarming ? 3 : 1.5} />
        <line x1={w / 2} y1={16} x2={w / 2} y2={26} stroke={outline} strokeWidth={2} />
        <path d={`M 4 ${h - 4} L 4 26 L ${w / 2} ${(26 + h - 4) / 2} L ${w - 4} 26 L ${w - 4} ${h - 4} L ${w / 2} ${(26 + h - 4) / 2} Z`}
          fill={color} stroke={outline} strokeWidth={alarming ? 3 : 1.5} />
      </g>
      break
    case 'PIPES_ANIM':
      body = <g>
        <rect x={0} y={2} width={w} height={h - 4} fill={color} stroke={outline} strokeWidth={alarming ? 3 : 1.5} />
        {active && <line className="cd-flow" x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#333" strokeWidth={3} strokeDasharray="8 8" />}
      </g>
      break
    default: {
      const position = live?.position !== undefined ? Math.max(0, Math.min(100, live.position)) : 0
      body = <g>
        <path d={`M 14 28 A 20 20 0 0 1 ${w - 14} 28 Z`} fill="#e8e8e8" stroke={outline} strokeWidth={alarming ? 3 : 1.5} />
        <line x1={w / 2} y1={28} x2={w / 2} y2={36} stroke={outline} strokeWidth={2} />
        <path d={`M 4 ${h - 8} L 4 36 L ${w / 2} ${(36 + h - 8) / 2} L ${w - 4} 36 L ${w - 4} ${h - 8} L ${w / 2} ${(36 + h - 8) / 2} Z`}
          fill={color} stroke={outline} strokeWidth={alarming ? 3 : 1.5} />
        <rect x={4} y={h - 6} width={w - 8} height={5} fill="#ffffff" stroke="#777" strokeWidth={1} />
        <rect x={4} y={h - 6} width={((w - 8) * position) / 100} height={5} fill="#3a6ea5" />
      </g>
    }
  }
  return <svg className={'bld-el course-dynamo' + (selected ? ' sel' : '')} width={w} height={h + 12} style={{ left: element.x, top: element.y, overflow: 'visible' }}
    onMouseDown={onMouseDown} onClick={onClick}
    aria-label={label} data-dynamo-set={element.dynamoSet} data-dynamo-color={color}
    data-dynamo-active={active} data-dynamo-alarm={alarming ? alarmState : undefined}>
    <title>{label}</title>
    {body}
    {alarming && <text x={w / 2} y={h + 10} textAnchor="middle" fontSize={9} fontWeight={700} fill="#cc0000">ALARM</text>}
  </svg>
}
