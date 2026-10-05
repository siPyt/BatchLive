import type { AnyModule } from '../engine/types'
import { useStore } from '../engine/store'
import { pidExecutionBad } from '../engine/pidModes'
import { useUi, type DisplayId } from '../ui/uiStore'
import { fmt, fmtQ } from '../utils/format'
import { ClassicTank, PALE_TEXT } from '../components/ClassicGraphics'
import { PHOTO_TANKS, STILL, type PhotoTankId, type PhotoPlantState } from '../engine/photoPlant'

export const tankRoute = (id: PhotoTankId): DisplayId => id === 'n3' ? 'photo-n3' : id === 'n1' ? 'photo-n1' : 'photo-n1bp'

export function OverviewReading({ tag, module, x, y, pvOnly = false, w = 112, label = tag }: {
  tag: string; module: AnyModule | undefined; x: number; y: number; pvOnly?: boolean; w?: number; label?: string
}): JSX.Element {
  const openFaceplate = useUi(s => s.openFaceplate)
  const analog = module?.type === 'PID' || module?.type === 'AI' ? module : undefined
  const bad = analog?.type === 'PID' ? analog.pvBad || pidExecutionBad(analog) : analog?.pvBad
  const pid = !pvOnly && analog?.type === 'PID' ? analog : undefined
  const rows = analog ? [
    ['PV', `${fmtQ(analog.pv, analog.decimals, !!bad)} ${analog.unit}`],
    ...(pid ? [['SP', `${fmt(pid.sp, pid.decimals)} ${pid.unit}`],
      ['OUT', `${fmtQ(pid.out, 1, pidExecutionBad(pid))} %`]] : [])
  ] : [['', 'Not configured']]
  return <g className={analog ? 'overview-live-reading' : undefined}
    role={analog ? 'button' : undefined} tabIndex={analog ? 0 : undefined}
    aria-label={`${tag}: ${rows.map(row => row.join(' ')).join(', ')}${analog ? '. Open faceplate' : ''}`}
    onClick={analog ? () => openFaceplate(tag) : undefined}
    onKeyDown={analog ? event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFaceplate(tag) }
    } : undefined}>
    <title>{analog ? `${tag}: ${analog.description}. Open faceplate` : `${tag}: not configured`}</title>
    <text x={x + w / 2} y={y - 5} textAnchor="middle" fill={PALE_TEXT} fontSize={9}>{label}</text>
    <rect x={x} y={y} width={w} height={rows.length * 14 + 8} fill="#fff" stroke={pid ? '#2f5f96' : '#6b7680'} />
    {rows.map(([name, value], index) => <g key={name}>
      <text x={x + 4} y={y + 15 + index * 14} fill={PALE_TEXT} fontSize={9}>{name}</text>
      <text x={x + w - 4} y={y + 15 + index * 14} textAnchor="end" fill={PALE_TEXT} fontSize={9}>{value}</text>
    </g>)}
    {pid && <text x={x + w / 2} y={y + 61} textAnchor="middle" fill={PALE_TEXT} fontSize={9}>{pid.actualMode}</text>}
  </g>
}

export function TankLevel({ tag, x, y, w, h, label }: {
  tag: string; x: number; y: number; w: number; h: number; label: string
}): JSX.Element {
  const module = useStore(s => s.modules[tag])
  if (module?.type === 'PID' && !module.pvBad && !pidExecutionBad(module))
    return <ClassicTank x={x} y={y} w={w} h={h} label={label} level={module.pv} />
  return <g><rect x={x} y={y} width={w} height={h} fill="#eceeef" stroke="#5b7384" />
    <text x={x + w / 2} y={y + h / 2 + 45} textAnchor="middle" fill={PALE_TEXT} fontSize={11}>
      {module?.type === 'PID' ? 'Level quality BAD' : 'Not configured'}
    </text></g>
}

export function TankSummary({ id, state }: { id: PhotoTankId; state: PhotoPlantState }): JSX.Element {
  const modules = useStore(s => s.modules)
  const navigate = useUi(s => s.navigate)
  const config = PHOTO_TANKS.find(tank => tank.id === id)!
  const p = config.prefix
  const tank = state.tanks[id]
  const motor = (tag: string): boolean => { const m = modules[tag]; return m?.type === 'MOTOR' && m.running && !m.fault }
  const valve = (tag: string): boolean => { const m = modules[tag]; return m?.type === 'VALVE' && m.open }
  const inUse = motor(`${p}-XC002`) && valve(`${p}-YV014`)
  const filling = valve(`${p}-YV007`) && motor(`${STILL}-DIST`) && valve(`${STILL}-XV201`) && state.still.distillateLiters > 0
  const remaining = tank.sanitation === 'SOAK' ? Math.max(0, 600 - tank.soakSeconds) : undefined
  const clock = remaining === undefined ? '--:--'
    : `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${Math.floor(remaining % 60).toString().padStart(2, '0')}`
  const sanitationActive = tank.sanitation !== 'IDLE'
  return <svg viewBox="0 0 420 400" role="img" aria-label={`${config.title} live summary`}>
    <TankLevel tag={`${p}-LIC005`} x={143} y={38} w={134} h={180} label="" />
    <rect x={163} y={52} width={94} height={26} fill="#fff" stroke="#2b3137" />
    <text x={210} y={70} textAnchor="middle" fill={PALE_TEXT} fontSize={13}>{inUse ? 'In Use' : 'Not In Use'}</text>
    <rect x={159} y={95} width={102} height={28} fill="#fff" />
    <text x={210} y={115} textAnchor="middle" fill={PALE_TEXT} fontSize={18} fontWeight={800}>{p}</text>
    <OverviewReading tag={`${p}-AI015A`} module={modules[`${p}-AI015A`]} x={10} y={56} />
    <OverviewReading tag={`${p}-AI015B`} module={modules[`${p}-AI015B`]} x={10} y={155} />
    <OverviewReading tag={`${p}-TIC011`} module={modules[`${p}-TIC011`]} x={292} y={56} />
    <OverviewReading tag={`${p}-PIC016`} module={modules[`${p}-PIC016`]} x={292} y={155} />
    <OverviewReading tag={`${p}-LIC005`} module={modules[`${p}-LIC005`]} x={154} y={157} pvOnly />
    <text x={210} y={238} textAnchor="middle" fill={PALE_TEXT} fontSize={10}>{tank.liters.toFixed(0)} liter (model)</text>
    <rect x={14} y={282} width={112} height={56} fill="#fff" stroke="#6b7680" />
    <text x={70} y={304} textAnchor="middle" fill={PALE_TEXT} fontSize={11} fontWeight={700}>WFI-LVL-CTRL</text>
    <text x={70} y={324} textAnchor="middle" fill={PALE_TEXT} fontSize={11}>{filling ? 'Filling' : 'Not Filling'}</text>
    <g aria-label={`${id.toUpperCase()}-WFI-SANI sandbox sanitation`}>
      <rect x={140} y={262} width={266} height={118} fill="#fff" stroke={sanitationActive ? '#8a6d00' : '#6b7680'}
        strokeWidth={sanitationActive ? 2 : 1} />
      <text x={273} y={280} textAnchor="middle" fill={PALE_TEXT} fontSize={11} fontWeight={700}>{id.toUpperCase()}-WFI-SANI (training)</text>
      <text x={150} y={299} fill={PALE_TEXT} fontSize={10}>Cycle Stage: {tank.sanitation}</text>
      <text x={150} y={315} fill={PALE_TEXT} fontSize={10}>Hot Soak: {tank.soakSeconds.toFixed(0)} / 600 s</text>
      <text x={150} y={331} fill={PALE_TEXT} fontSize={10}>Sani Time Remaining: {clock}</text>
      <g role="button" tabIndex={0} aria-label={`Open ${config.title} sanitation controls`} style={{ cursor: 'pointer' }}
        onClick={() => navigate(tankRoute(id))}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(tankRoute(id)) } }}>
        <rect x={185} y={344} width={176} height={26} fill="#eceeef" stroke="#2b3137" />
        <text x={273} y={362} textAnchor="middle" fill={PALE_TEXT} fontSize={11} fontWeight={700}>Sani Control</text>
      </g>
    </g>
  </svg>
}
