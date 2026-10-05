import { useStore } from '../engine/store'
import { pidExecutionBad } from '../engine/pidModes'
import { useUi, type DisplayId } from '../ui/uiStore'
import { DISPLAY_NAVIGATION } from '../ui/displayNavigation'
import { ClassicTank, PALE_TEXT } from '../components/ClassicGraphics'
import { PHOTO_TANKS } from '../engine/photoPlant'
import { OverviewReading, TankSummary, tankRoute } from './overviewParts'

const PANELS = [
  { display: 'feed', title: 'Feed Tank and Supply', vessel: 'TK-101', level: 'LIC-101',
    readings: ['FIC-101', 'TI-101', 'LIC-101'], device: 'P-101' },
  { display: 'reactor', title: 'Reactor Train', vessel: 'TK-201', level: 'LIC-201',
    readings: ['TIC-201', 'SIC-201', 'PT-201'], device: 'P-201' },
  { display: 'wfi', title: 'WFI Tank and Loop', vessel: '3T-8120', level: 'LIC-401',
    readings: ['AT-402', 'AT-401', 'TIC-401'], device: 'P-401' }
] satisfies { display: DisplayId; title: string; vessel: string; level: string; readings: string[]; device: string }[]

const OTHER_AREAS: DisplayId[] = ['plant-map', 'photo-overview', 'photo-still', 'product', 'autoclave', 'lyo', 'cip', 'tcu']
const ROOMS = [
  { title: 'Room 1040', tanks: ['3T-5370', '3T-5440', '3T-5460', '3T-8030'], wide: true },
  { title: 'Room 1040A', tanks: ['3T-5420'], wide: false },
  { title: 'Room 1042', tanks: ['3T-5110'], wide: false }
]
const REFERENCE_ONLY = ['NGS-808', 'Scrubber 3S-8050', 'CIP-804', 'WFI Pretr Skid', '3TCU-8010', '3TCU-8020',
  'Glycol 3T-8150', 'Process Waste', '3UF-8201', 'HCL Totes', 'PW Neutr.', '3SUR-3300', '3SUR-3200',
  'Buffer Prep', '3CIP-3200', '3T-3300', '3T-3350']

export function PlantNavigationOverview(): JSX.Element {
  const modules = useStore(s => s.modules)
  const process = useStore(s => s.process)
  const batch = useStore(s => s.batch)
  const photoPlant = useStore(s => s.photoPlant)
  const navigate = useUi(s => s.navigate)

  return <div className="display plant-navigation-overview">
    <h1>Plant Overview Navigation</h1>
    <section className="overview-section" aria-label="Process areas">
    <h2 className="overview-section-heading">Process Areas</h2>
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
    </section>
    <section className="overview-section" aria-label="WFI tank loops">
      <h2 className="overview-section-heading">WFI Tank Loops</h2>
      {photoPlant ? <div className="overview-vessel-panels">
        {PHOTO_TANKS.map(tank => <section className="overview-vessel-section" key={tank.id} aria-label={tank.title}>
          <div className="overview-vessel-panel overview-loop-panel">
            <h2>{tank.title}</h2>
            <TankSummary id={tank.id} state={photoPlant} />
          </div>
          <button className="overview-navigation-button" onClick={() => navigate(tankRoute(tank.id))}>Open {tank.title}</button>
        </section>)}
      </div> : <div className="overview-room">
        <p>The WFI tank loops and still are not installed in this project.</p>
        <button className="overview-navigation-button" onClick={() => navigate('photo-overview')}>Open installer</button>
      </div>}
    </section>
    <section className="overview-section" aria-label="Rooms and storage tanks">
      <h2 className="overview-section-heading">Rooms and Storage Tanks<small>Layout from the reference photograph; vessels are not modeled yet</small></h2>
      <div className="overview-rooms">
        {ROOMS.map(room => <div className={`overview-room${room.wide ? ' overview-room-wide' : ''}`} key={room.title}
          role="group" aria-label={`${room.title}, reference only`}>
          <h3>{room.title}</h3>
          <div className="overview-room-tanks">
            {room.tanks.map(tag => <svg key={tag} viewBox="0 0 220 190" role="img" aria-label={`${tag}: reference vessel, not modeled`}>
              <title>{`${tag} appears in the reference photograph but is not modeled`}</title>
              <g opacity={0.5}><ClassicTank x={30} y={10} w={160} h={150} level={0} label="" /></g>
              <rect x={65} y={70} width={90} height={26} fill="#fff" />
              <text x={110} y={89} textAnchor="middle" fill={PALE_TEXT} fontSize={15} fontWeight={800}>{tag}</text>
              <text x={110} y={182} textAnchor="middle" fill={PALE_TEXT} fontSize={10}>Not modeled</text>
            </svg>)}
          </div>
        </div>)}
      </div>
    </section>    <nav className="overview-other-areas" aria-label="Other process areas">
      {OTHER_AREAS.map(id => <button className="overview-navigation-button" key={id} onClick={() => navigate(id)}>
        {DISPLAY_NAVIGATION.find(display => display.id === id)?.label}
      </button>)}
    </nav>
    <nav className="overview-reference-only" aria-label="Photographed areas not yet modeled">
      {REFERENCE_ONLY.map(label => <button className="overview-navigation-button" key={label} aria-disabled="true"
        title={`${label} appears in the reference photograph but is not modeled yet`}
        onClick={event => event.preventDefault()}>{label}</button>)}
    </nav>
  </div>
}