import type { AnyModule } from '../engine/types'
import { useStore } from '../engine/store'
import { pidExecutionBad } from '../engine/pidModes'
import { useUi, type DisplayId } from '../ui/uiStore'
import { DISPLAY_NAVIGATION } from '../ui/displayNavigation'
import { fmt, fmtQ } from '../utils/format'
import { PALE_TEXT } from '../components/ClassicGraphics'

interface UnitPanel {
  title: string
  vessel?: string
  display: DisplayId
  level?: string
  readings: string[]
  devices: string[]
  sandbox?: boolean
}

interface UnitSection { title: string; note?: string; units: UnitPanel[] }

const lyo = (n: 1 | 2): UnitPanel => {
  const id = n === 1 ? ['601', '601', '601'] : ['611', '611', '611']
  return { title: `Lyophilizer ${n}`, vessel: `LYO-${n}`, display: 'lyo',
    readings: [`TIC-${id[0]}`, `PIC-${id[1]}`, `AT-${id[2]}`], devices: [`XV-${id[0]}`] }
}
const autoclave = (n: 1 | 2): UnitPanel => {
  const id = n === 1 ? '501' : '511'
  return { title: `Autoclave ${n}`, vessel: `AC-${n}`, display: 'autoclave',
    readings: [`TIC-${id}`, `PIC-${id}`], devices: [`XV-${id}`] }
}
const cip = (n: 1 | 2 | 3): UnitPanel => {
  const id = `${700 + (n - 1) * 10 + 1}`
  return { title: `CIP Skid ${n}`, vessel: `CIP-${n}`, display: 'cip',
    readings: [`TIC-${id}`, `FIC-${id}`, `AT-${id}`], devices: [`P-${id}`, `XV-${id}`, `XV-${700 + (n - 1) * 10 + 2}`] }
}
const tcu = (n: 1 | 2 | 3): UnitPanel => {
  const id = `${800 + (n - 1) * 10 + 1}`
  return { title: `TCU ${n}`, vessel: `TCU-${n}`, display: 'tcu',
    readings: [`TIC-${id}`, `FIC-${id}`], devices: [`P-${id}`, `HS-${id}`] }
}

const SECTIONS: UnitSection[] = [
  { title: 'Feed, Reactor and Product', units: [
    { title: 'Feed Tank and Supply', vessel: 'TK-101', display: 'feed', level: 'LIC-101',
      readings: ['FIC-101', 'TI-101'], devices: ['P-101', 'XV-101'] },
    { title: 'Reactor Train', vessel: 'TK-201', display: 'reactor', level: 'LIC-201',
      readings: ['TIC-201', 'SIC-201', 'PT-201'], devices: ['P-201', 'XV-201'] },
    { title: 'Product / Header', vessel: 'HDR-301', display: 'product',
      readings: ['PIC-301', 'AT-301'], devices: ['PSV-201'] }
  ] },
  { title: 'WFI Generation and Storage', units: [
    { title: 'WFI Tank and Loop', vessel: '3T-8120', display: 'wfi', level: 'LIC-401',
      readings: ['AT-402', 'AT-401', 'TIC-401', 'PIC-401', 'TI-402'], devices: ['P-401', 'P-402', 'PCV-401'] },
    { title: 'WFI Stills 1 and 2', vessel: 'TIC-401 / TIC-411', display: 'wfi',
      readings: ['TIC-401', 'FI-401', 'TIC-411', 'FI-411'], devices: ['XV-411'] }
  ] },
  { title: 'Photographed WFI Training Units', note: 'Sandbox training models, not site control logic', units: [
    { title: 'N3 WFI Tank and Loop', vessel: '3T-8130', display: 'photo-n3', level: '3T-8130-LIC005', sandbox: true,
      readings: ['3T-8130-TIC011', '3T-8130-PIC016', '3T-8130-AI015A', '3T-8130-AI015B'], devices: ['3T-8130-XC002', '3T-8130-YV007'] },
    { title: 'N1 WFI Tank and Loop', vessel: '3T-8120', display: 'photo-n1', level: '3T-8120-LIC005', sandbox: true,
      readings: ['3T-8120-TIC011', '3T-8120-PIC016', '3T-8120-AI015A', '3T-8120-AI015B'], devices: ['3T-8120-XC002', '3T-8120-YV007'] },
    { title: 'N1BP WFI Tank and Loop', vessel: '3T-8140', display: 'photo-n1bp', level: '3T-8140-LIC005', sandbox: true,
      readings: ['3T-8140-TIC011', '3T-8140-PIC016', '3T-8140-AI015A', '3T-8140-AI015B'], devices: ['3T-8140-XC002', '3T-8140-YV007'] },
    { title: 'WFI Still', vessel: '3WFI-8110', display: 'photo-still', level: '3WFI-8110-LIC100', sandbox: true,
      readings: ['3WFI-8110-TIC102', '3WFI-8110-LT200', '3WFI-8110-FT200', '3WFI-8110-OIL-PRESS'],
      devices: ['3WFI-8110-LUBE', '3WFI-8110-COMP', '3WFI-8110-DIST'] }
  ] },
  { title: 'Sterilization and Lyophilization', units: [autoclave(1), autoclave(2), lyo(1), lyo(2)] },
  { title: 'Clean-In-Place Skids', units: [cip(1), cip(2), cip(3)] },
  { title: 'Temperature Control Units', units: [tcu(1), tcu(2), tcu(3)] }
]

const UTILITY_TAGS = ['SB-STEAM', 'SB-COOLING', 'SB-STEAM-PRESS', 'SB-COOLING-AVAIL']
const OTHER_AREAS: DisplayId[] = ['plant-map', 'photo-overview', 'product', 'autoclave', 'lyo', 'cip', 'tcu']
const REFERENCE_ONLY = ['PW Neutr.', '3SUR-3300', '3SUR-3200', 'Buffer Prep', '3CIP-3200', '3T-3300', '3T-3350']

export function PlantNavigationOverview(): JSX.Element {
  const modules = useStore(s => s.modules)
  const batch = useStore(s => s.batch)
  const photoInstalled = useStore(s => !!s.photoPlant)
  const navigate = useUi(s => s.navigate)

  return <div className="display plant-navigation-overview">
    <h1>Plant Overview Navigation</h1>
    <div className="overview-sections">
      {SECTIONS.map(section => {
        const photo = section.units.some(unit => unit.sandbox)
        return <section className="overview-section" key={section.title} aria-label={section.title}>
          <h2>{section.title}{section.note && <small>{section.note}</small>}</h2>
          {photo && !photoInstalled
            ? <div className="overview-unit-panel overview-photo-missing">
              <p>The photographed WFI training units are not installed in this project.</p>
              <button className="overview-navigation-button" onClick={() => navigate('photo-overview')}>Open installer</button>
            </div>
            : <div className="overview-unit-grid">
              {section.units.map(unit => <UnitSummary key={`${unit.title}-${unit.vessel}`} unit={unit} modules={modules}
                batchStatus={unit.display === 'reactor' ? batch.status : undefined} />)}
            </div>}
        </section>
      })}
      {photoInstalled && <section className="overview-section" aria-label="Shared utilities">
        <h2>Shared Utilities<small>Sandbox supply model</small></h2>
        <div className="overview-unit-grid">
          <div className="overview-unit-panel">
            <h3>Steam and Cooling</h3>
            <div className="overview-unit-readings">{UTILITY_TAGS.map(tag => <UnitValue key={tag} tag={tag} module={modules[tag]} />)}</div>
          </div>
        </div>
      </section>}
    </div>
    <nav className="overview-other-areas" aria-label="Other process areas">
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

function UnitSummary({ unit, modules, batchStatus }: {
  unit: UnitPanel; modules: Record<string, AnyModule>; batchStatus?: string
}): JSX.Element {
  const openDisplay = useUi(s => s.navigate)
  const level = unit.level ? modules[unit.level] : undefined
  const levelPid = level?.type === 'PID' ? level : undefined
  const levelBad = !!levelPid && (levelPid.pvBad || pidExecutionBad(levelPid))
  return <article className="overview-unit-panel" aria-label={unit.title}>
    <h3>{unit.title}</h3>
    {unit.vessel && <div className="overview-unit-vessel">{unit.vessel}</div>}
    {unit.level && <div className="overview-level" role="img"
      aria-label={levelPid ? levelBad ? `${unit.level} level quality bad` : `${unit.level} level ${levelPid.pv.toFixed(0)} percent` : `${unit.level} not configured`}>
      {levelPid && !levelBad
        ? <div className="overview-level-fill" style={{ width: `${Math.max(0, Math.min(100, levelPid.pv))}%` }} />
        : <span>{levelPid ? 'Level quality BAD' : 'Level not configured'}</span>}
    </div>}
    <div className="overview-unit-readings">
      {unit.level && <UnitValue tag={unit.level} module={level} />}
      {unit.readings.map(tag => <UnitValue key={tag} tag={tag} module={modules[tag]} />)}
    </div>
    <div className="overview-unit-devices">
      {unit.devices.map(tag => <UnitValue key={tag} tag={tag} module={modules[tag]} compact />)}
    </div>
    {batchStatus && <div className="overview-unit-note">Batch: {batchStatus}</div>}
    {unit.sandbox && <div className="overview-unit-note">Sandbox training model</div>}
    <button className="overview-navigation-button" onClick={() => openDisplay(unit.display)}>Open {unit.title}</button>
  </article>
}

function UnitValue({ tag, module, compact = false }: { tag: string; module: AnyModule | undefined; compact?: boolean }): JSX.Element {
  const openFaceplate = useUi(s => s.openFaceplate)
  if (!module) return <span className="overview-value overview-value-missing">{tag}: not configured</span>
  let text: string
  if (module.type === 'PID') {
    const bad = module.pvBad || pidExecutionBad(module)
    text = `${fmtQ(module.pv, module.decimals ?? 1, bad)} ${module.unit} (SP ${fmt(module.sp, module.decimals ?? 1)}, ${module.actualMode})`
  } else if (module.type === 'AI') {
    text = `${fmtQ(module.pv, module.decimals ?? 1, module.pvBad)} ${module.unit}`
  } else if (module.type === 'MOTOR') {
    text = module.fault || module.ioInputBad ? 'FAULT' : module.running ? 'RUNNING' : 'STOPPED'
  } else if (module.type === 'VALVE') {
    text = module.fault || module.ioInputBad ? 'FAULT' : module.open ? 'OPEN' : 'CLOSED'
  } else if (module.type === 'DO' || module.type === 'DI') {
    text = module.state ? 'ON' : 'OFF'
  } else {
    text = module.type
  }
  return <button className={`overview-value${compact ? ' overview-value-device' : ''}`} onClick={() => openFaceplate(tag)}
    aria-label={`${tag}: ${text}. Open faceplate`} title={module.description}>
    <span>{tag}</span><b>{text}</b>
  </button>
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
