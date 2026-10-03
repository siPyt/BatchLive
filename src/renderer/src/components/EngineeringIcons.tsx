import type { AnyModule } from '../engine/types'

type ModuleIconKind = 'control' | 'equipment' | 'cell' | 'area' | 'unassigned'

export function ModuleIcon({ kind, size = 20 }: { kind: ModuleIconKind; size?: number }): JSX.Element {
  const label = { control: 'Control Module', equipment: 'Equipment Module', cell: 'Process Cell', area: 'Area', unassigned: 'Unassigned modules' }[kind]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="engineering-icon" role="img" aria-label={label} data-icon-kind={kind}>
      <title>{label}</title>
      {kind === 'area' || kind === 'unassigned' ? (
        <path d="M2,6 H9 L11,9 H22 V21 H2 Z" fill={kind === 'area' ? '#e4c45b' : '#d5d8da'} stroke="#716c51" />
      ) : (
        <>
          {kind === 'equipment' && <rect x={1} y={1} width={22} height={22} fill="#eceeef" stroke="#64727a" />}
          {kind === 'cell' && <path d="M2,22 V13 H7 V22 M9,22 V8 H14 V22 M16,22 V4 H21 V22" fill="#c4ccd1" stroke="#64727a" />}
          <g strokeWidth={0.7}>
            <circle cx={12} cy={6.5} r={5} fill="#589c36" stroke="#356e24" />
            <circle cx={6.5} cy={14} r={5} fill="#a34932" stroke="#783721" />
            <circle cx={17.5} cy={14} r={5} fill="#34338c" stroke="#232369" />
          </g>
          {kind === 'equipment' && <text x={12} y={23} textAnchor="middle" fontSize={6} fontWeight={800} fill="#17222b">EM</text>}
        </>
      )}
    </svg>
  )
}

export function engineeringBlockType(module: AnyModule): string {
  return module.type === 'FB' ? module.fbType : module.type === 'MOTOR' || module.type === 'VALVE' ? 'DC' : module.type
}

export function FunctionBlockIcon({ type, size = 20, x, y }: { type: string; size?: number; x?: number; y?: number }): JSX.Element {
  const analog = ['AI', 'AO', 'MAI'].includes(type)
  const logic = ['CND', 'AND', 'OR', 'NOT', 'CMP', 'RS', 'SR', 'DI', 'DO', 'DC', 'FFMDI', 'FFMDO'].includes(type)
  const timer = ['CTR', 'DTE', 'OND', 'OFFD', 'RET', 'TP'].includes(type)
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" className="engineering-icon" role="img" aria-label={`${type} function block`} data-block-icon={type} style={x === undefined ? undefined : { pointerEvents: 'none' }}>
      <title>{`${type} function block`}</title>
      <rect x={1} y={1} width={22} height={22} fill={analog ? '#292e25' : logic || timer ? '#173b2b' : '#242486'} stroke="#969a9c" />
      {analog ? (
        <path d="M3,13 L5,13 L6,7 L8,18 L10,6 L12,17 L14,10 L16,14 L18,8 L20,13 H22" fill="none" stroke="#e4df66" strokeWidth={1.3} />
      ) : type === 'PID' ? (
        <text x={12} y={17} textAnchor="middle" fontFamily="Georgia, serif" fontSize={15} fill="#eee997">K/s</text>
      ) : type === 'SPLTR' ? (
        <path d="M3,12 H10 L19,5 M10,12 L19,19 M16,5 H20 V9 M16,19 H20 V15" fill="none" stroke="#eee997" strokeWidth={1.4} />
      ) : logic ? (
        <g fill="none" stroke="#e4df66" strokeWidth={1.2}>
          <path d="M3,6 H8 L16,18 H21 M3,18 H8 L16,6 H21" />
          <rect x={9} y={9} width={6} height={6} fill="#173b2b" />
        </g>
      ) : timer ? (
        <g fill="none" stroke="#e4df66" strokeWidth={1.2}>
          <circle cx={12} cy={12} r={7} /><path d="M12,6 V12 H17" />
        </g>
      ) : (
        <text x={12} y={16} textAnchor="middle" fontFamily="'Consolas', monospace" fontSize={type.length > 4 ? 6 : 9} fill="#eee997">{type}</text>
      )}
    </svg>
  )
}
