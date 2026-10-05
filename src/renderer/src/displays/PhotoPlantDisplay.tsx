import { useStore } from '../engine/store'
import { useUi, type DisplayId } from '../ui/uiStore'
import { PHOTO_TANKS, PHOTO_TAG_TYPES, STILL, type PhotoTankId, type PhotoPlantState } from '../engine/photoPlant'
import { appliedPidOutput } from '../engine/analogStrategy'
import { pidExecutionBad } from '../engine/pidModes'
import {
  ClassicTank, ClassicPipe, ClassicPump, ClassicSanitaryValve, ClassicControlValve,
  ClassicHex, ClassicFlag, PALE_TEXT
} from '../components/ClassicGraphics'
import { OverviewReading } from './PlantNavigationOverview'

type PhotoView = PhotoTankId | 'overview' | 'still'
const tankRoute = (id: PhotoTankId): DisplayId => id === 'n3' ? 'photo-n3' : id === 'n1' ? 'photo-n1' : 'photo-n1bp'

export function PhotoPlantDisplay({ view }: { view: PhotoView }): JSX.Element {
  const state = useStore(s => s.photoPlant)
  const add = useStore(s => s.addPhotoPlant)
  const sanitize = useStore(s => s.startPhotoTankSanitation)
  const cancelSanitation = useStore(s => s.cancelPhotoTankSanitation)
  const modules = useStore(s => s.modules)
  const navigate = useUi(s => s.navigate)
  const openFaceplate = useUi(s => s.openFaceplate)
  const missing = Object.entries(PHOTO_TAG_TYPES).filter(([tag, type]) => modules[tag]?.type !== type).map(([tag]) => tag)
  const tank = PHOTO_TANKS.find(config => config.id === view)
  const title = view === 'overview' ? 'Photographed WFI Overview Navigation'
    : view === 'still' ? `${STILL} WFI Still` : tank?.title

  if (!state) return <div className="display photo-plant-install">
    <h1>{title}</h1>
    <p>Add three independent WFI tanks and a coupled still alongside the existing plant.</p>
    <p>Existing modules, course exercises, graphics and live process state are not replaced.</p>
    <p>Installation enables shared steam/cooling effects on the existing reactor and pharma units.
      N1 supplies the existing WFI storage receiver, which feeds all three CIP skids.</p>
    <p><b>Training approximation:</b> capacities, rates, startup permissives and sanitation timing are sandbox assumptions,
      not the photographed site's validated engineering or GMP procedures.</p>
    <button className="overview-navigation-button" onClick={add}>Add photographed WFI training units</button>
    <button className="overview-navigation-button" onClick={() => navigate('plant-map')}>Original Spatial Plant Map</button>
  </div>

  return <div className={`display ${view === 'overview' ? 'plant-navigation-overview' : 'graphic-display photo-process-display'}`}>
    <h1 className={view === 'overview' ? undefined : 'graphic-display-title'}>{title}</h1>
    <div className="photo-model-note">Sandbox training model - not site control logic or a validated GMP process.
      Shared utilities and N1-to-existing-WFI/CIP supply are connected; other photographed areas are not yet built.</div>
    {missing.length > 0 && <div className="photo-model-note" role="alert">Incomplete model - required modules missing or wrong type:
      {' '}{missing.join(', ')}. Restore the modules before training; physical vessel state is not a valid instrument reading.</div>}
    <div className="photo-utility-summary" aria-label="Shared plant utilities">
      {['SB-STEAM', 'SB-COOLING', 'SB-STEAM-PRESS', 'SB-COOLING-AVAIL'].map(tag => {
        const module = modules[tag]
        const value = module?.type === 'AI' ? module.pvBad ? 'BAD PV' : `${module.pv.toFixed(1)} ${module.unit}`
          : module?.type === 'MOTOR' ? module.fault || module.interlock ? 'FAULT/TRIP' : module.running ? 'RUNNING' : 'STOPPED'
          : 'Not configured'
        return <button key={tag} disabled={!module} onClick={() => openFaceplate(tag)}>{tag}: {value}</button>
      })}
    </div>
    {view === 'overview' ? <div className="overview-vessel-panels">
      {PHOTO_TANKS.map(config => <section className="overview-vessel-section" key={config.id} aria-label={config.title}>
        <div className="overview-vessel-panel">
          <h2>{config.title}</h2>
          <TankSummary id={config.id} state={state} />
        </div>
        <button className="overview-navigation-button" onClick={() => navigate(tankRoute(config.id))}>{config.title}</button>
      </section>)}
    </div> : <div className="plant-diagram">
      {view === 'still' ? <StillPicture /> : tank && <TankPicture id={tank.id} state={state} />}
    </div>}
    <nav className="photo-plant-navigation" aria-label="Photographed plant navigation">
      <button className="overview-navigation-button" onClick={() => navigate('photo-overview')}>WFI Overview</button>
      <button className="overview-navigation-button" onClick={() => navigate('photo-still')}>WFI Still</button>
      {view !== 'overview' && PHOTO_TANKS.map(config =>
        <button className="overview-navigation-button" key={config.id} onClick={() => navigate(tankRoute(config.id))}>{config.title}</button>)}
      {tank && <button className="overview-navigation-button" disabled={state.tanks[tank.id].sanitation !== 'IDLE'}
        onClick={() => sanitize(tank.id)}>Start sanitation (training)</button>}
      {tank && <button className="overview-navigation-button" disabled={state.tanks[tank.id].sanitation === 'IDLE'}
        onClick={() => cancelSanitation(tank.id)}>Cancel/reset sanitation</button>}
      <button className="overview-navigation-button" onClick={() => navigate('wfi')}>Existing WFI Display</button>
      <button className="overview-navigation-button" onClick={() => navigate('plant-map')}>Original Spatial Plant Map</button>
    </nav>
  </div>
}

function TankLevel({ tag, x, y, w, h, label }: {
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

function TankSummary({ id, state }: { id: PhotoTankId; state: PhotoPlantState }): JSX.Element {
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

function TankPicture({ id, state }: { id: PhotoTankId; state: PhotoPlantState }): JSX.Element {
  const modules = useStore(s => s.modules)
  const config = PHOTO_TANKS.find(tank => tank.id === id)!
  const p = config.prefix
  const tank = state.tanks[id]
  const valve = (suffix: string): boolean => { const m = modules[`${p}-${suffix}`]; return m?.type === 'VALVE' && m.open }
  const pump = modules[`${p}-XC002`]
  const heater = modules[`${p}-TIC011`]
  return <svg width="100%" height="100%" viewBox="0 0 1040 600" role="img" aria-label={`${config.title} coupled process picture`}>
    <ClassicPipe d="M120,80 H220 V170" />
    <ClassicPipe d="M230,350 V430 H480 V230 H630 V140 H920" />
    <ClassicPipe d="M630,190 V250 H840 V430 H480" />
    <ClassicPipe d="M840,300 H920" />
    <ClassicPipe d="M230,400 H110 V500" />
    <TankLevel tag={`${p}-LIC005`} x={150} y={170} w={160} h={180} label={p} />
    <ClassicHex x={630} y={140} w={140} h={50} label={'WFI Recirc\nTrim Cooler'} />
    <ClassicHex x={630} y={310} w={140} h={50} label={'WFI Recirc\nSani Heater'} />
    <ClassicPipe d="M700,250 V310 M700,360 V430 M770,335 H920" />
    <ClassicSanitaryValve x={220} y={80} open={valve('YV007')} tag={`${p}-YV007`} labelPosition="above" />
    <ClassicPump x={480} y={430} running={pump?.type === 'MOTOR' && pump.running} tag={`${p}-XC002`} labelPosition="right" />
    <ClassicSanitaryValve x={840} y={300} open={valve('YV014')} tag={`${p}-YV014`} labelPosition="above" />
    <ClassicSanitaryValve x={110} y={440} open={valve('YV009')} tag={`${p}-YV009`} orientation="vertical" labelPosition="right" />
    <ClassicControlValve x={840} y={335} position={heater?.type === 'PID' ? appliedPidOutput(heater) : 0} tag={`${p}-TIC011`} labelPosition="above" />
    <ClassicFlag x={120} y={66} w={104} text="Hot WFI from Still" pointRight={false} />
    <ClassicFlag x={920} y={286} w={90} text="WFI to Users" />
    <ClassicFlag x={920} y={321} w={90} text="Plant Steam" />
    <ClassicFlag x={110} y={500} w={100} text="Waste" pointRight={false} />
    <OverviewReading tag={`${p}-LIC005`} module={modules[`${p}-LIC005`]} x={330} y={195} />
    <OverviewReading tag={`${p}-TIC011`} module={heater} x={450} y={95} />
    <OverviewReading tag={`${p}-PIC016`} module={modules[`${p}-PIC016`]} x={450} y={305} />
    <OverviewReading tag={`${p}-FI003`} module={modules[`${p}-FI003`]} x={615} y={425} />
    <OverviewReading tag={`${p}-AI015A`} module={modules[`${p}-AI015A`]} x={245} y={495} />
    <OverviewReading tag={`${p}-AI015B`} module={modules[`${p}-AI015B`]} x={385} y={495} />
    <text x={690} y={530} fill={PALE_TEXT} fontSize={14}>Sanitation: {tank.sanitation}</text>
    <text x={690} y={553} fill={PALE_TEXT} fontSize={12}>Continuous hot soak: {tank.soakSeconds.toFixed(0)} / 600 s</text>
  </svg>
}

function StillPicture(): JSX.Element {
  const modules = useStore(s => s.modules)
  const motor = (suffix: string): boolean => { const m = modules[`${STILL}-${suffix}`]; return m?.type === 'MOTOR' && m.running }
  const valve = (suffix: string): boolean => { const m = modules[`${STILL}-${suffix}`]; return m?.type === 'VALVE' && m.open }
  const heat = modules[`${STILL}-TIC102`]
  return <svg width="100%" height="100%" viewBox="0 0 1040 600" role="img" aria-label="WFI still coupled training process">
    <ClassicPipe d="M100,130 H240 V195 H455 M535,140 H730 M455,360 V450 H320 V490 H160 M535,360 V490 H900 M730,140 V80 H900" />
    <ClassicPipe d="M535,220 H900 M455,360 H220 V250 H100" />
    <ClassicHex x={160} y={105} w={130} h={50} label="FEED" />
    <ClassicHex x={230} y={420} w={130} h={50} label="DISTILLATE" />
    <ClassicHex x={700} y={420} w={130} h={50} label="BLOWDOWN" />
    <TankLevel tag={`${STILL}-LIC100`} x={430} y={140} w={150} h={220} label="WFI STILL" />
    <ClassicPump x={730} y={140} running={motor('COMP')} tag={`${STILL}-COMP`} labelPosition="right" />
    <ClassicPump x={730} y={80} running={motor('LUBE')} tag={`${STILL}-LUBE`} labelPosition="left" />
    <ClassicPump x={320} y={490} running={motor('DIST')} tag={`${STILL}-DIST`} labelPosition="right" discharge="right" />
    <ClassicSanitaryValve x={610} y={490} open={valve('XV100')} tag={`${STILL}-XV100`} labelPosition="above" />
    <ClassicSanitaryValve x={160} y={490} open={valve('XV201')} tag={`${STILL}-XV201`} labelPosition="above" />
    <ClassicControlValve x={820} y={220} position={heat?.type === 'PID' ? appliedPidOutput(heat) : 0} tag={`${STILL}-TIC102`} labelPosition="above" />
    <ClassicFlag x={100} y={115} w={80} text="Plant Steam" pointRight={false} />
    <ClassicFlag x={900} y={476} w={100} text="Feed Water" />
    <ClassicFlag x={100} y={235} w={80} text="To WFI Tanks" pointRight={false} />
    <ClassicFlag x={900} y={206} w={100} text="Heating Steam" />
    <OverviewReading tag={`${STILL}-TIC102`} module={heat} x={140} y={195} />
    <OverviewReading tag={`${STILL}-LIC100`} module={modules[`${STILL}-LIC100`]} x={445} y={180} pvOnly />
    <OverviewReading tag={`${STILL}-LT200`} module={modules[`${STILL}-LT200`]} x={445} y={285} />
    <OverviewReading tag={`${STILL}-FT200`} module={modules[`${STILL}-FT200`]} x={340} y={390} />
    <OverviewReading tag={`${STILL}-PT103`} module={modules[`${STILL}-PT103`]} x={445} y={65} />
    <OverviewReading tag={`${STILL}-OIL-PRESS`} module={modules[`${STILL}-OIL-PRESS`]} x={825} y={125} />
    <OverviewReading tag={`${STILL}-AIT200`} module={modules[`${STILL}-AIT200`]} x={145} y={335} />
    <text x={500} y={560} fill={PALE_TEXT} fontSize={12} textAnchor="middle">
      Startup: oil pump; once oil pressure is ready, reset/start compressor. Open feed/delivery and start distillate pump.
    </text>
  </svg>
}
