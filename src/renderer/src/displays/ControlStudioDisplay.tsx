import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { fmt, modeColor } from '../utils/format'
import type { AnyModule, PidModule, ControlMode } from '../engine/types'
import type { ReactNode } from 'react'

// Control Studio-style ONLINE function-block diagram for a single module.

const PID_MODES: ControlMode[] = ['MAN', 'AUTO', 'CAS']

export function ControlStudioDisplay(): JSX.Element {
  const studioTag = useUi((s) => s.studioTag)
  const m = useStore((s) => (studioTag ? s.modules[studioTag] : undefined))
  const openFaceplate = useUi((s) => s.openFaceplate)

  if (!m) {
    return (
      <div className="display studio">
        <div className="exp-empty">Open a module from DeltaV Explorer or a graphic to view it online.</div>
      </div>
    )
  }

  return (
    <div className="display studio">
      <StudioRibbon tag={m.tag} onFaceplate={() => openFaceplate(m.tag)} />
      <div className="studio-canvas">
        <Diagram module={m} />
      </div>
    </div>
  )
}

const RIBBON_TABS = ['File', 'Home', 'Diagram', 'View', 'Settings']

function StudioRibbon({ tag, onFaceplate }: { tag: string; onFaceplate: () => void }): JSX.Element {
  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        {RIBBON_TABS.map((t) => (
          <span key={t} className={'ribbon-tab' + (t === 'File' ? ' file' : t === 'View' ? ' active' : '')}>
            {t}
          </span>
        ))}
        <span className="ribbon-title">[REACTOR_CELL/{tag}] — Control Studio · ONLINE</span>
      </div>
      <div className="ribbon-body">
        <RibbonGroup label="Diagram">
          <RibbonBtn ic="▣" label="Show as FBD" active />
          <RibbonBtn ic="⊟" label="Show as SFC" />
          <RibbonBtn ic="✓" label="Verify" />
        </RibbonGroup>
        <RibbonGroup label="Windows">
          <RibbonBtn ic="☰" label="Parameters" active />
          <RibbonBtn ic="🔔" label="Alarm View" />
          <RibbonBtn ic="▭" label="Status Bar" active />
        </RibbonGroup>
        <RibbonGroup label="Zoom">
          <RibbonBtn ic="🔍" label="Zoom In" />
          <RibbonBtn ic="⊖" label="Zoom Out" />
        </RibbonGroup>
        <RibbonGroup label="Module">
          <RibbonBtn ic="▦" label="Faceplate" onClick={onFaceplate} />
          <RibbonBtn ic="●" label="Online" active />
        </RibbonGroup>
      </div>
    </div>
  )
}

function RibbonGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-btns">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  )
}

function RibbonBtn({
  ic,
  label,
  active,
  onClick
}: {
  ic: string
  label: string
  active?: boolean
  onClick?: () => void
}): JSX.Element {
  return (
    <button className={'ribbon-btn' + (active ? ' active' : '')} onClick={onClick}>
      <span className="ic">{ic}</span>
      {label}
    </button>
  )
}

function Diagram({ module: m }: { module: AnyModule }): JSX.Element {
  if (m.type === 'PID') return <PidDiagram m={m} />
  if (m.type === 'AI') {
    return (
      <div className="fb-row">
        <Block type="AI" tag={m.tag} ports={[['OUT', `${fmt(m.pv, m.decimals)} ${m.unit}`]]} />
      </div>
    )
  }
  if (m.type === 'MOTOR') {
    return (
      <div className="fb-row">
        <Block
          type="DC"
          tag={m.tag}
          ports={[
            ['SP_D', m.commanded ? 'START' : 'STOP'],
            ['PV_D', m.running ? 'RUNNING' : 'STOPPED'],
            ['INTERLOCK', m.interlock ? 'ACTIVE' : 'clear'],
            ['FAULT', m.fault ? 'YES' : 'no']
          ]}
        />
      </div>
    )
  }
  if (m.type === 'VALVE') {
    return (
      <div className="fb-row">
        <Block
          type="DC"
          tag={m.tag}
          ports={[
            ['SP_D', m.commandedOpen ? 'OPEN' : 'CLOSE'],
            ['PV_D', m.open ? 'OPEN' : 'CLOSED'],
            ['INTERLOCK', m.interlock ? 'ACTIVE' : 'clear'],
            ['FAULT', m.fault ? 'YES' : 'no']
          ]}
        />
      </div>
    )
  }
  // DI / DO
  return (
    <div className="fb-row">
      <Block
        type={m.type}
        tag={m.tag}
        ports={[['OUT_D', m.state ? m.activeDescriptor : m.inactiveDescriptor]]}
      />
    </div>
  )
}

function PidDiagram({ m }: { m: PidModule }): JSX.Element {
  const setMode = useStore((s) => s.setMode)
  const cascaded = !!m.casSource

  return (
    <div className="fb-row">
      {cascaded && (
        <>
          <Block type="PID" tag={m.casSource as string} ports={[['OUT', '→ remote SP']]} subdued />
          <Wire label="CAS_IN" />
        </>
      )}
      <Block type="AI" tag={`${m.tag}/PV`} ports={[['OUT', `${fmt(m.pv, m.decimals)} ${m.unit}`]]} />
      <Wire label="IN" />
      <div className="fb-block pid">
        <div className="fb-head">
          <span className="fb-type">PID</span>
          <b>{m.tag}</b>
          <span className="fb-mode" style={{ color: modeColor(m.mode) }}>
            {m.mode}
          </span>
        </div>
        <div className="fb-ports">
          <Port name="PV" value={`${fmt(m.pv, m.decimals)} ${m.unit}`} />
          <Port name="SP" value={`${fmt(m.sp, m.decimals)} ${m.unit}`} />
          <Port name="OUT" value={`${fmt(m.out, 1)} %`} />
          <Port name="GAIN" value={`${m.gain}`} />
          <Port name="RESET" value={`${m.reset} s`} />
          <Port name="RATE" value={`${m.rate} s`} />
        </div>
        <div className="fb-modebar">
          {PID_MODES.map((mode) => (
            <button
              key={mode}
              className={'fb-modebtn' + (m.mode === mode ? ' active' : '')}
              disabled={mode === 'CAS' && !m.casSource}
              onClick={() => setMode(m.tag, mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <Wire label="OUT %" />
      <Block type="AO" tag={`${m.tag}/OUT`} ports={[['OUT', `${fmt(m.out, 1)} %`]]} />
    </div>
  )
}

function Block({
  type,
  tag,
  ports,
  subdued
}: {
  type: string
  tag: string
  ports: [string, string][]
  subdued?: boolean
}): JSX.Element {
  return (
    <div className={'fb-block' + (subdued ? ' subdued' : '')}>
      <div className="fb-head">
        <span className="fb-type">{type}</span>
        <b>{tag}</b>
      </div>
      <div className="fb-ports">
        {ports.map(([n, v]) => (
          <Port key={n} name={n} value={v} />
        ))}
      </div>
    </div>
  )
}

function Port({ name, value }: { name: string; value: string }): JSX.Element {
  return (
    <div className="fb-port">
      <span className="fb-port-name">{name}</span>
      <span className="fb-port-val">{value}</span>
    </div>
  )
}

function Wire({ label }: { label: string }): JSX.Element {
  return (
    <div className="fb-wire">
      <span className="fb-wire-lbl">{label}</span>
      <span className="fb-wire-arrow">→</span>
    </div>
  )
}
