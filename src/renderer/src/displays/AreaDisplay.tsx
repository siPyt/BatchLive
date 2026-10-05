import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm, fmt, isPid } from '../utils/format'
import type { AnyModule } from '../engine/types'
import { WfiDiagram, AutoclaveDiagram, LyoDiagram, CipDiagram, TcuDiagram } from './PharmaDiagrams'
import { OverviewDisplay } from './OverviewDisplay'

const AREA_TITLE: Record<string, string> = {
  FEED: 'FEED SYSTEM',
  REACTOR: 'REACTOR',
  PRODUCT: 'PRODUCT / HEADER',
  WFI: 'WFI GENERATION & DISTRIBUTION',
  AUTOCLAVE: 'STERILIZATION (AUTOCLAVES)',
  LYO: 'LYOPHILIZATION',
  CIP: 'CLEAN-IN-PLACE (CIP) SKIDS',
  TCU: 'TEMPERATURE CONTROL UNITS (TCUs)'
}

const AREA_DIAGRAM: Partial<Record<string, () => JSX.Element | null>> = {
  WFI: WfiDiagram,
  AUTOCLAVE: AutoclaveDiagram,
  LYO: LyoDiagram,
  CIP: CipDiagram,
  TCU: TcuDiagram
}

export function AreaDisplay({ area }: { area: string }): JSX.Element {
  const modules = useStore((s) => s.modules)
  const list = Object.values(modules).filter((m) => m.area === area)
  const Diagram = AREA_DIAGRAM[area]

  if (area === 'FEED' || area === 'REACTOR' || area === 'PRODUCT') {
    return <div className="display process-detail">
      <OverviewDisplay focusArea={area} />
      <ModuleDirectory modules={list} />
    </div>
  }

  return (
    <div className="display graphic-display">
      {area !== 'WFI' && <h1 className="graphic-display-title">{AREA_TITLE[area] ?? area}</h1>}
      {Diagram && <Diagram />}
      {!list.length && <div className="graphic-empty" role="status">No modules configured in this area. Use DeltaV Explorer to create modules.</div>}
      <ModuleDirectory modules={list} />
    </div>
  )
}

function ModuleDirectory({ modules }: { modules: AnyModule[] }): JSX.Element {
  return <details className="plant-directory">
    <summary>Module directory ({modules.length})</summary>
    <div className="plant-directory-grid">{modules.map(m => <ModuleCard key={m.tag} module={m} />)}</div>
  </details>
}

function ModuleCard({ module: m }: { module: AnyModule }): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const alm = moduleAlarm(m.tag, alarms)
  const border = alm
    ? alm.priority === 'CRITICAL'
      ? 'var(--dv-critical)'
      : alm.priority === 'WARNING'
        ? 'var(--dv-warning)'
        : 'var(--dv-advisory)'
    : 'var(--dv-border)'

  return (
    <div
      onClick={() => openFaceplate(m.tag)}
      style={{
        background: 'var(--dv-panel)',
        border: `1px solid ${border}`,
        borderRadius: 5,
        padding: 12,
        cursor: 'pointer',
        minHeight: 120,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b style={{ fontSize: 15, color: 'var(--dv-text)' }}>{m.tag}</b>
        {isPid(m) && <span className={'fp-status-pill'} style={{ background: 'transparent', color: modeTextColor(m.mode) }}>{m.mode}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--dv-text-mute)', textTransform: 'uppercase' }}>
        {m.description}
      </div>
      <CardBody module={m} />
      {alm && (
        <div style={{ marginTop: 'auto', fontSize: 11, color: border, fontWeight: 700 }}>
          ● {alm.label} ALARM
        </div>
      )}
    </div>
  )
}

function CardBody({ module: m }: { module: AnyModule }): JSX.Element {
  if (m.type === 'AO') return <div style={{ marginTop: 4 }}>
    <Stat label={`OUT / ${m.actualMode}`} value={m.bad ? '????' : fmt(m.out, 1)}
      unit="%" color={m.bad ? 'var(--dv-critical)' : 'var(--dv-out)'} />
    <Stat label="SP" value={fmt(m.sp, m.decimals)} unit={m.unit} color="var(--dv-sp)" />
  </div>
  if (m.type === 'PID') {
    return (
      <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
        <Stat label="PV" value={`${fmt(m.pv, m.decimals)}`} unit={m.unit} color="var(--dv-pv)" />
        <Stat label="SP" value={`${fmt(m.sp, m.decimals)}`} unit={m.unit} color="var(--dv-sp)" />
        <Stat label="OUT" value={`${fmt(m.out, 1)}`} unit="%" color="var(--dv-out)" />
      </div>
    )
  }
  if (m.type === 'AI') {
    return (
      <div style={{ marginTop: 4 }}>
        <Stat label="PV" value={`${fmt(m.pv, m.decimals)}`} unit={m.unit} color="var(--dv-pv)" big />
      </div>
    )
  }
  if (m.type === 'MOTOR') {
    const s = m.fault ? 'FAULT' : m.running ? 'RUNNING' : 'STOPPED'
    const c = m.fault ? '#c0202a' : m.running ? '#1f8a4c' : 'var(--dv-text-mute)'
    return (
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: c }}>{s}</div>
    )
  }
  if (m.type === 'VALVE') {
    const s = m.fault ? 'FAULT' : m.open ? 'OPEN' : 'CLOSED'
    const c = m.fault ? '#c0202a' : m.open ? '#1f8a4c' : 'var(--dv-text-mute)'
    return <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: c }}>{s}</div>
  }
  if (m.type === 'FB') {
    return (
      <div style={{ marginTop: 4 }}>
        <Stat label={m.fbType} value={`${fmt(m.out, 3)}`} unit="" color="var(--dv-pv)" big />
      </div>
    )
  }
  // DI / DO
  const state = m.state ? m.activeDescriptor : m.inactiveDescriptor
  return (
    <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: m.state ? '#1f8a4c' : 'var(--dv-text-mute)' }}>
      {state}
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  color,
  big
}: {
  label: string
  value: string
  unit: string
  color: string
  big?: boolean
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 9, color: 'var(--dv-text-mute)' }}>{label}</span>
      <span style={{ fontSize: big ? 22 : 15, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        <span style={{ fontSize: 9, color: 'var(--dv-text-dim)', marginLeft: 2 }}>{unit}</span>
      </span>
    </div>
  )
}

function modeTextColor(mode: string): string {
  if (mode === 'MAN') return 'var(--mode-man)'
  if (mode === 'AUTO') return 'var(--mode-auto)'
  return 'var(--mode-cas)'
}
