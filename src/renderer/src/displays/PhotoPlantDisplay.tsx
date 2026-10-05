import { useStore } from '../engine/store'
import { useSecurity } from '../engine/security'
import { useUi, type DisplayId } from '../ui/uiStore'
import type { AnyModule, PidModule } from '../engine/types'
import { PHOTO_TANKS, PHOTO_TAG_TYPES, STILL, type PhotoTankId, type PhotoPlantState } from '../engine/photoPlant'
import { appliedPidOutput } from '../engine/analogStrategy'
import { pidExecutionBad } from '../engine/pidModes'
import {
  ClassicPipe, ClassicPump, ClassicSanitaryValve, ClassicControlValve,
  ClassicHex, ClassicFlag, PALE_TEXT, PALE_GREEN, PALE_RED
} from '../components/ClassicGraphics'
import { OverviewReading, TankLevel, TankSummary, tankRoute } from './overviewParts'
type PhotoView = PhotoTankId | 'overview' | 'still'

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
    <p>The N3, N1 and N1BP WFI tank loops and the WFI still are not installed in this project.</p>
    <p>Adding them keeps all existing modules, exercises, graphics and live process state.</p>
    <button className="overview-navigation-button" onClick={add}>Add WFI tank loops and still</button>
    <button className="overview-navigation-button" onClick={() => navigate('plant-map')}>Original Spatial Plant Map</button>
  </div>

  return <div className={`display ${view === 'overview' ? 'plant-navigation-overview' : 'graphic-display photo-process-display'}`}>
    <h1 className={view === 'overview' ? undefined : 'graphic-display-title'}>{title}</h1>
    {missing.length > 0 && <div className="photo-model-note" role="alert">Incomplete model - required modules missing or wrong type:
      {' '}{missing.join(', ')}. Restore the modules before use; physical vessel state is not a valid instrument reading.</div>}
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
        onClick={() => sanitize(tank.id)}>Start sanitation</button>}
      {tank && <button className="overview-navigation-button" disabled={state.tanks[tank.id].sanitation === 'IDLE'}
        onClick={() => cancelSanitation(tank.id)}>Cancel/reset sanitation</button>}
      <button className="overview-navigation-button" onClick={() => navigate('wfi')}>Existing WFI Display</button>
      <button className="overview-navigation-button" onClick={() => navigate('plant-map')}>Original Spatial Plant Map</button>
    </nav>
  </div>
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

function ValvePercent({ x, y, module }: { x: number; y: number; module: AnyModule | undefined }): JSX.Element {
  const pid = module?.type === 'PID' ? module : undefined
  const bad = !pid || pid.pvBad || pidExecutionBad(pid)
  return <text x={x} y={y} textAnchor="middle" fill={PALE_TEXT} fontSize={9}>{bad && !pid ? 'n/c' : `${pid ? appliedPidOutput(pid).toFixed(0) : '--'} %`}</text>
}

function StillPicture(): JSX.Element {
  const modules = useStore(s => s.modules)
  const user = useSecurity(s => s.currentUser)
  const state = useStore(s => s.photoPlant)
  const navigate = useUi(s => s.navigate)
  const openFaceplate = useUi(s => s.openFaceplate)
  const t = (suffix: string): string => `${STILL}-${suffix}`
  const motor = (suffix: string): boolean => { const m = modules[t(suffix)]; return m?.type === 'MOTOR' && m.running }
  const valve = (suffix: string): boolean => { const m = modules[t(suffix)]; return m?.type === 'VALVE' && m.open }
  const pid = (suffix: string): PidModule | undefined => { const m = modules[t(suffix)]; return m?.type === 'PID' ? m : undefined }
  const analog = (suffix: string): number | undefined => {
    const m = modules[t(suffix)]
    return m?.type === 'AI' && !m.pvBad ? m.pv : undefined
  }
  const bar = (module: AnyModule | undefined, x: number): JSX.Element => {
    const good = module?.type === 'PID' && !module.pvBad && !pidExecutionBad(module) ? module.pv
      : module?.type === 'AI' && !module.pvBad ? module.pv : undefined
    const level = Math.max(0, Math.min(100, good ?? 0))
    return <g>
      <rect x={x} y={125} width={7} height={130} fill="#fff" stroke="#44525c" />
      {good !== undefined && <rect x={x} y={125 + 130 * (1 - level / 100)} width={7} height={130 * level / 100} fill="#2f5f96" />}
    </g>
  }
  const oilPressure = analog('OIL-PRESS')
  const oilTemperature = analog('OIL-TEMP')
  const status = !state ? 'Unavailable'
    : state.still.production > 0 ? 'Producing'
      : state.still.temperature >= 95 ? 'Hot Standby'
        : state.still.temperature > 35 ? 'Heating' : 'Cold / Off'
  const nav = (label: string[], y: number, route?: DisplayId): JSX.Element =>
    <g role="button" tabIndex={route ? 0 : undefined} aria-disabled={route ? undefined : true}
      aria-label={route ? `Open ${label.join(' ')}` : `${label.join(' ')} is shown in the reference but is not modeled`}
      style={{ cursor: route ? 'pointer' : 'not-allowed' }} opacity={route ? 1 : 0.55}
      onClick={route ? () => navigate(route) : undefined}
      onKeyDown={route ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(route) } } : undefined}>
      <title>{route ? label.join(' ') : `${label.join(' ')} appears in the reference photograph but is not modeled`}</title>
      <rect x={873} y={y} width={92} height={42} fill="#f3f3f3" stroke="#222" strokeWidth={2} />
      {label.map((line, index) => <text key={line} x={919} y={y + 17 + index * 14} textAnchor="middle"
        fill={PALE_TEXT} fontSize={10} fontWeight={800}>{line}</text>)}
    </g>
  const indicator = (x: number, y: number, ok: boolean | undefined, text: string, tag: string): JSX.Element =>
    <g role="button" tabIndex={0} aria-label={`${text}: ${ok === undefined ? 'unavailable' : ok ? 'normal' : 'abnormal'}. Open faceplate`}
      style={{ cursor: 'pointer' }} onClick={() => openFaceplate(tag)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFaceplate(tag) } }}>
      <rect x={x} y={y} width={14} height={14} fill={ok === undefined ? '#9aa4ab' : ok ? PALE_GREEN : PALE_RED} stroke="#222" />
      <text x={x + 22} y={y + 11} fill={PALE_TEXT} fontSize={10}>{text}</text>
    </g>
  const comp = modules[t('COMP')]
  return <svg width="100%" height="100%" viewBox="0 0 1040 620" role="img" aria-label="WFI still coupled training process">
    <ClassicPipe d="M88,59 H179 V110" />
    <ClassicPipe d="M244,146 V184 H92" />
    <ClassicPipe d="M256,128 H387 V300 H470" />
    <ClassicPipe d="M556,121 H616" />
    <ClassicPipe d="M590,121 V74 H910" />
    <ClassicPipe d="M556,200 H908" />
    <ClassicPipe d="M556,236 H910" />
    <ClassicPipe d="M499,270 V606" />
    <ClassicPipe d="M499,426 H402" />
    <ClassicPipe d="M290,421 H179 V330 M179,380 H113 M179,330 H113" />
    <ClassicPipe d="M908,525 H321 V440 M625,525 V442" />
    <ClassicPipe d="M690,442 V585 H905" />
    <ClassicHex x={154} y={110} w={102} h={36} label="FEED" />
    <ClassicHex x={290} y={404} w={112} h={34} label="DSTLT" />
    <ClassicHex x={594} y={404} w={115} h={36} label="BLWDN" />
    <TankLevel tag={t('LIC100')} x={443} y={92} w={113} h={178} label="" />
    {bar(modules[t('LT200')], 451)}
    {bar(modules[t('LIC100')], 541)}
    <text transform="translate(448 190) rotate(-90)" fill={PALE_TEXT} fontSize={7}>Distillate Level</text>
    <text transform="translate(556 190) rotate(-90)" fill={PALE_TEXT} fontSize={7}>Feed Water Level</text>
    <rect x={198} y={28} width={140} height={22} fill="#f3f3f3" stroke="#6b7680" />
    <text x={268} y={43} textAnchor="middle" fill={PALE_TEXT} fontSize={11}>{status}</text>
    <ClassicFlag x={24} y={49} w={64} text="Plant Steam" />
    <ClassicFlag x={92} y={174} w={64} text="Condensate" pointRight={false} />
    <ClassicFlag x={113} y={320} w={55} text="Storage" pointRight={false} />
    <ClassicFlag x={113} y={370} w={55} text="Waste" pointRight={false} />
    <ClassicFlag x={971} y={64} w={60} text="Cooling Water" pointRight={false} />
    <ClassicFlag x={969} y={190} w={60} text="Plant Steam" pointRight={false} />
    <ClassicFlag x={970} y={226} w={60} text="Condensate" pointRight={false} />
    <ClassicFlag x={963} y={515} w={55} text="Feed Water" pointRight={false} />
    <ClassicFlag x={963} y={575} w={55} text="BLWDN" pointRight={false} />
    <ClassicControlValve x={142} y={59} position={pid('TIC102') ? appliedPidOutput(pid('TIC102')!) : 0}
      tag={t('TIC102')} label={t('TCV102')} labelPosition="above" />
    <ValvePercent x={142} y={84} module={pid('TIC102')} />
    <ClassicControlValve x={769} y={200} position={pid('PIC103') ? appliedPidOutput(pid('PIC103')!) : 0}
      tag={t('PIC103')} label={t('PCV103')} labelPosition="above" />
    <ValvePercent x={769} y={225} module={pid('PIC103')} />
    <ClassicControlValve x={235} y={421} position={pid('LIC200') ? appliedPidOutput(pid('LIC200')!) : 0}
      tag={t('LIC200')} label={t('LCV200')} labelPosition="above" />
    <ValvePercent x={235} y={446} module={pid('LIC200')} />
    <ClassicControlValve x={394} y={525} position={pid('TIC200') ? appliedPidOutput(pid('TIC200')!) : 0}
      tag={t('TIC200')} label={t('TCV200')} labelPosition="above" />
    <ValvePercent x={394} y={550} module={pid('TIC200')} />
    <ClassicControlValve x={729} y={525} position={pid('LIC100') ? appliedPidOutput(pid('LIC100')!) : 0}
      tag={t('LIC100')} label={t('LCV100')} labelPosition="above" />
    <ValvePercent x={729} y={550} module={pid('LIC100')} />
    <ClassicSanitaryValve x={830} y={525} open={valve('XV100')} tag={t('XV100')} labelPosition="above" />
    <ClassicSanitaryValve x={729} y={585} open={valve('FCV300')} tag={t('FCV300')} labelPosition="above" />
    <ClassicSanitaryValve x={786} y={74} open={valve('SV500')} tag={t('SV500')} labelPosition="above" />
    <ClassicSanitaryValve x={148} y={330} open={valve('XV201')} tag={t('XV201')} labelPosition="above" />
    <ClassicSanitaryValve x={148} y={380} open={valve('XV202')} tag={t('XV202')} labelPosition="below" />
    <ClassicSanitaryValve x={499} y={561} open={valve('XV200')} tag={t('XV200')} orientation="vertical" labelPosition="right" />
    <ClassicPump x={679} y={74} running={motor('LUBE')} tag={t('LUBE')} labelPosition="left" />
    <ClassicPump x={499} y={426} running={motor('DIST')} tag={t('DIST')} labelPosition="below" />
    <g data-equipment-tag={t('COMP')} data-state={motor('COMP') ? 'running' : 'stopped'} style={{ cursor: 'pointer' }}
      role="button" tabIndex={0} aria-label={`${t('COMP')}: ${motor('COMP') ? 'Running' : 'Off'}. Open faceplate`}
      onClick={() => openFaceplate(t('COMP'))}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFaceplate(t('COMP')) } }}>
      <title>{`${t('COMP')}: ${comp?.type === 'MOTOR' ? comp.description : 'not configured'}`}</title>
      <rect x={616} y={104} width={69} height={38} rx={16} fill={motor('COMP') ? PALE_GREEN : '#c6d2db'} stroke="#44525c" strokeWidth={1.5} />
      <text x={650} y={127} textAnchor="middle" fill={motor('COMP') ? '#fff' : PALE_TEXT} fontSize={11} fontWeight={700}>{motor('COMP') ? 'On' : 'Off'}</text>
      <text x={650} y={156} textAnchor="middle" fill={PALE_TEXT} fontSize={8}>{t('COMP')}</text>
    </g>
    <OverviewReading tag={t('TIC102')} label={t('TT102')} module={modules[t('TIC102')]} x={262} y={92} w={96} pvOnly />
    <OverviewReading tag={t('PT103')} module={modules[t('PT103')]} x={471} y={42} w={96} />
    <OverviewReading tag={t('LIC100')} label={t('LT100')} module={modules[t('LIC100')]} x={463} y={150} w={74} pvOnly />
    <OverviewReading tag={t('LT200')} module={modules[t('LT200')]} x={463} y={200} w={74} />
    <OverviewReading tag={t('IY100')} module={modules[t('IY100')]} x={697} y={104} w={96} />
    <OverviewReading tag={t('TT200')} module={modules[t('TT200')]} x={50} y={212} w={96} />
    <OverviewReading tag={t('AIT200')} module={modules[t('AIT200')]} x={50} y={258} w={96} />
    <OverviewReading tag={t('FT200')} module={modules[t('FT200')]} x={410} y={372} w={96} />

    <rect x={820} y={98} width={136} height={86} fill="#fff" stroke="#222" strokeWidth={2} />
    <text x={888} y={118} textAnchor="middle" fill={PALE_TEXT} fontSize={13} fontWeight={800}>Oil Pump</text>
    {indicator(828, 128, oilPressure === undefined ? undefined : oilPressure >= 15, 'Oil Pressure', t('OIL-PRESS'))}
    {indicator(828, 154, oilTemperature === undefined ? undefined : oilTemperature < 65, 'Oil Temperature', t('OIL-TEMP'))}
    {nav(['N1BP WFI Tank', 'and Loop'], 258, 'photo-n1bp')}
    {nav(['N1 WFI Tank', 'and Loop'], 308, 'photo-n1')}
    {nav(['N3 WFI Tank', 'and Loop'], 358, 'photo-n3')}
    {nav(['WFI STILL', 'COMMS'], 408)}
    <rect x={20} y={572} width={110} height={22} fill="#f3f3f3" stroke="#6b7680" />
    <text x={30} y={587} fill={PALE_TEXT} fontSize={10}>User: {user}</text>
  </svg>
}
