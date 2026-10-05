import type { AnyModule } from '../engine/types'
import { useStore } from '../engine/store'
import { pidExecutionBad } from '../engine/pidModes'
import { useUi, type DisplayId } from '../ui/uiStore'
import { DISPLAY_NAVIGATION } from '../ui/displayNavigation'
import { fmt, fmtQ } from '../utils/format'
import { ClassicTank, PALE_TEXT } from '../components/ClassicGraphics'

const PANELS = [
  { display: 'feed', title: 'Feed Tank and Supply', vessel: 'TK-101', level: 'LIC-101',
    readings: ['FIC-101', 'TI-101', 'LIC-101'], device: 'P-101' },
  { display: 'reactor', title: 'Reactor Train', vessel: 'TK-201', level: 'LIC-201',
    readings: ['TIC-201', 'SIC-201', 'PT-201'], device: 'P-201' },
  { display: 'wfi', title: 'WFI Tank and Loop', vessel: '3T-8120', level: 'LIC-401',
    readings: ['AT-402', 'AT-401', 'TIC-401'], device: 'P-401' }
] satisfies { display: DisplayId; title: string; vessel: string; level: string; readings: string[]; device: string }[]

const OTHER_AREAS: DisplayId[] = ['plant-map', 'photo-overview', 'product', 'autoclave', 'lyo', 'cip', 'tcu']

export function PlantNavigationOverview(): JSX.Element {
  const modules = useStore(s => s.modules)
  const process = useStore(s => s.process)
  const batch = useStore(s => s.batch)
  const navigate = useUi(s => s.navigate)

  return <div className="display plant-navigation-overview">
    <h1>Plant Overview Navigation</h1>
    <div className="overview-vessel-panels">
      {PANELS.map(panel => {
        const levelModule = modules[panel.level]
        const level = levelModule?.type === 'PID' ? levelModule : undefined
        const device = modules[panel.device]
        const levelValue = panel.display === 'feed' ? process.feedTankLevel
          : panel.display === 'reactor' ? process.reactorLevel : level?.pv
        const levelBad = !level || level.pvBad || pidExecutionBad(level)
        return <section className="overview-vessel-section" key={panel.display} aria-label={panel.title}>
          <div className="overview-vessel-panel">
            <h2>{panel.title}</h2>
            <svg viewBox="0 0 420 330" role="img" aria-label={`${panel.title} live summary`}>
              {level && levelValue !== undefined && !levelBad
                ? <ClassicTank x={143} y={38} w={134} h={180} level={levelValue} label="" />
                : <g><rect x={143} y={38} width={134} height={180} fill="#eceeef" stroke="#5b7384" />
                  <text x={210} y={120} textAnchor="middle" fill={PALE_TEXT} fontSize={12}>
                    {level ? 'Level quality BAD' : 'Not configured'}
                  </text></g>}
              <rect x={159} y={95} width={102} height={28} fill="#fff" />
              <text x={210} y={115} textAnchor="middle" fill={PALE_TEXT} fontSize={18} fontWeight={800}>{panel.vessel}</text>
              <OverviewReading tag={panel.readings[0]} module={modules[panel.readings[0]]} x={10} y={56} />
              <OverviewReading tag={panel.readings[1]} module={modules[panel.readings[1]]} x={10} y={155} />
              <OverviewReading tag={panel.readings[2]} module={modules[panel.readings[2]]} x={292} y={76} />
              {panel.readings[2] !== panel.level && <OverviewReading tag={panel.level} module={level} x={154} y={157} pvOnly />}
              {panel.display === 'wfi' && <OverviewReading tag="PIC-401" module={modules['PIC-401']} x={292} y={175} />}
              <rect x={16} y={264} width={388} height={46} fill="#eceeef" stroke="#6b7680" />
              <text x={30} y={282} fill={PALE_TEXT} fontSize={11} fontWeight={700}>
                {panel.device}: {device?.type === 'MOTOR'
                  ? device.fault ? 'FAULT' : device.running ? 'RUNNING' : 'STOPPED'
                  : 'Not configured'}
              </text>
              <text x={30} y={300} fill={PALE_TEXT} fontSize={10}>
                {panel.display === 'reactor' ? `Batch: ${batch.status}` : 'Select a reading to open its live faceplate'}
              </text>
            </svg>
          </div>
          <button className="overview-navigation-button" onClick={() => navigate(panel.display)}>
            Open {panel.title}
          </button>
        </section>
      })}
    </div>
    <nav className="overview-other-areas" aria-label="Other process areas">
      {OTHER_AREAS.map(id => <button className="overview-navigation-button" key={id} onClick={() => navigate(id)}>
        {DISPLAY_NAVIGATION.find(display => display.id === id)?.label}
      </button>)}
    </nav>
  </div>
}

export function OverviewReading({ tag, module, x, y, pvOnly = false }: {
  tag: string; module: AnyModule | undefined; x: number; y: number; pvOnly?: boolean
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
    <text x={x + 56} y={y - 5} textAnchor="middle" fill={PALE_TEXT} fontSize={9}>{tag}</text>
    <rect x={x} y={y} width={112} height={rows.length * 14 + 8} fill="#fff" stroke={pid ? '#2f5f96' : '#6b7680'} />
    {rows.map(([label, value], index) => <g key={label}>
      <text x={x + 4} y={y + 15 + index * 14} fill={PALE_TEXT} fontSize={9}>{label}</text>
      <text x={x + 108} y={y + 15 + index * 14} textAnchor="end" fill={PALE_TEXT} fontSize={9}>{value}</text>
    </g>)}
    {pid && <text x={x + 56} y={y + 61} textAnchor="middle" fill={PALE_TEXT} fontSize={9}>{pid.actualMode}</text>}
  </g>
}
