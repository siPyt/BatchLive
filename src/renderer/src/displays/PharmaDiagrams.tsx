import { useStore } from '../engine/store'
import type { ReactNode } from 'react'
import { Tank, Pump, GateValve, Pipe, Label, InstrumentTap, OffPageArrow } from '../components/Graphics'
import { ValueBox } from '../components/ValueBox'
import { durationString } from '../utils/format'
import type { PidModule, ValveModule, DiscreteInput, MotorModule, DiscreteOutput } from '../engine/types'

/** P&ID mimic diagrams for the GMP pharma areas, in the same visual language
 * as the reactor-train Plant Overview (Graphics.tsx symbols + ValueBox dynamos). */

/** Standalone (AreaDisplay) mode wraps content in its own bounded, scaled
 * mini-SVG. `embedded` mode (the master plant canvas) instead renders a bare
 * `<g>` positioned by the caller — no nested svg/viewBox, no bounding box —
 * so the diagram lives directly on the shared world coordinate plane. */
function Wrap({ height, children, embedded }: { height: number; children: ReactNode; embedded?: boolean }): JSX.Element {
  if (embedded) return <g>{children}</g>
  return (
    <div style={{ position: 'relative', margin: '0 auto 18px', maxWidth: 1040, height }}>
      <svg width="100%" height={height} viewBox={`0 0 1040 ${height}`} style={{ display: 'block' }}>
        {children}
      </svg>
    </div>
  )
}

/** A distillation-column-style vessel (VCD still): domed top, internal trays,
 * and a heat-jacket core that glows with the controller's heat output. */
function StillVessel({
  x,
  y,
  w,
  h,
  heatFrac,
  label
}: {
  x: number
  y: number
  w: number
  h: number
  heatFrac: number
  label: string
}): JSX.Element {
  const domeH = 18
  return (
    <g>
      <Label x={x + w / 2} y={y - 8} text={label} />
      <path
        d={`M ${x},${y + domeH}
            Q ${x},${y} ${x + w / 2},${y}
            Q ${x + w},${y} ${x + w},${y + domeH}
            L ${x + w},${y + h}
            Q ${x + w},${y + h + 10} ${x + w - 10},${y + h + 10}
            L ${x + 10},${y + h + 10}
            Q ${x},${y + h + 10} ${x},${y + h}
            Z`}
        fill="var(--dv-panel-2)"
        stroke="var(--dv-border-light)"
        strokeWidth={2}
      />
      {[0.3, 0.5, 0.7].map((f) => (
        <line
          key={f}
          x1={x + 6}
          x2={x + w - 6}
          y1={y + domeH + f * (h - domeH)}
          y2={y + domeH + f * (h - domeH)}
          stroke="var(--dv-border-light)"
          strokeWidth={1}
          opacity={0.6}
        />
      ))}
      <rect
        x={x + w / 2 - 6}
        y={y + domeH + 6}
        width={12}
        height={h - domeH - 14}
        rx={4}
        fill="var(--dv-energized)"
        opacity={0.2 + heatFrac * 0.6}
      />
    </g>
  )
}

export function WfiDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  const time = useStore((s) => s.time)
  const tic401 = modules['TIC-401'] as PidModule
  const tic411 = modules['TIC-411'] as PidModule
  const xv411 = modules['XV-411'] as ValveModule
  const xv401 = modules['XV-401'] as ValveModule
  const xv422 = modules['XV-422'] as ValveModule
  const p401 = modules['P-401'] as MotorModule
  const p402 = modules['P-402'] as MotorModule
  const pcv401 = modules['PCV-401'] as ValveModule
  const proc = useStore((s) => s.modules['LIC-401'] as PidModule)
  if (!tic401 || !tic411 || !xv411 || !xv401 || !p401 || !p402 || !pcv401 || !xv422) return null

  // Sani Schedule panel: a recurring 24h sanitization cycle with a 10-minute
  // active window, computed from the plant clock — the same "Time Until Next
  // Sani / Time Since Last Sani / Sani Time Remaining" triad shown on the real
  // DeltaV WFI Storage Tank and Loop graphic.
  const SANI_INTERVAL_S = 24 * 3600
  const SANI_DURATION_S = 10 * 60
  const cyclePos = (time / 1000) % SANI_INTERVAL_S
  const inSani = cyclePos > SANI_INTERVAL_S - SANI_DURATION_S
  const untilNextS = inSani ? 0 : SANI_INTERVAL_S - SANI_DURATION_S - cyclePos
  const sinceLastS = inSani ? 0 : cyclePos
  const remainingS = inSani ? SANI_INTERVAL_S - cyclePos : 0

  return (
    <Wrap height={360} embedded={embedded}>
      <StillVessel x={50} y={50} w={80} h={130} heatFrac={tic401.out / 100} label="STILL 1" />
      <StillVessel x={170} y={50} w={80} h={130} heatFrac={tic411.out / 100} label="STILL 2" />
      <GateValve x={290} y={205} open={xv411.open} tag="XV-411" interlock={xv411.interlock} />

      {/* stills discharge into the WFI storage tank's side nozzle */}
      <Pipe d="M90,190 V205 H340" />
      <Pipe d="M210,190 V205 H272" />
      <Pipe d="M308,205 H340" />

      {/* top spray-ball recirculation return */}
      <Pipe d="M395,20 V70" />
      <circle cx={395} cy={62} r={4} fill="var(--dv-metal)" />
      <line x1={390} y1={66} x2={384} y2={72} stroke="var(--dv-pipe)" strokeWidth={1.5} />
      <line x1={400} y1={66} x2={406} y2={72} stroke="var(--dv-pipe)" strokeWidth={1.5} />

      <Tank x={340} y={70} w={110} h={150} level={proc?.pv ?? 0} label="TK-401 WFI STORAGE" />

      {/* bottom suction header -> dual sanitary pumps (P-401 primary / P-402 standby) */}
      <Pipe d="M395,220 V240 H680" />
      <Pipe d="M560,240 V278" />
      <Pipe d="M660,240 V278" />
      <Pump x={560} y={260} running={p401.running} tag="P-401" />
      <Pump x={660} y={260} running={p402.running} tag="P-402" />

      {/* discharge risers (check valves) merge into the distribution heat exchanger */}
      <Pipe d="M573,236 V200" />
      <Pipe d="M673,236 V200" />
      <circle cx={573} cy={218} r={6} fill="none" stroke="var(--dv-metal)" strokeWidth={1.5} />
      <line x1={570} y1={221} x2={576} y2={215} stroke="var(--dv-metal)" strokeWidth={1.3} />
      <circle cx={673} cy={218} r={6} fill="none" stroke="var(--dv-metal)" strokeWidth={1.5} />
      <line x1={670} y1={221} x2={676} y2={215} stroke="var(--dv-metal)" strokeWidth={1.3} />
      <Pipe d="M573,200 H780" />

      {/* HEX-401 distribution heat exchanger: shell + dished channel heads + tube lines */}
      <rect x={800} y={185} width={110} height={30} fill="var(--dv-panel-2)" stroke="var(--dv-border-light)" strokeWidth={1.5} />
      <path d="M 800,185 Q 790,200 800,215 Z" fill="var(--dv-panel-2)" stroke="var(--dv-border-light)" strokeWidth={1.5} />
      <path d="M 910,185 Q 920,200 910,215 Z" fill="var(--dv-panel-2)" stroke="var(--dv-border-light)" strokeWidth={1.5} />
      {[192, 200, 208].map((ty) => (
        <line key={ty} x1={804} x2={906} y1={ty} y2={ty} stroke="var(--dv-border-light)" strokeWidth={1.2} strokeDasharray="3,3" />
      ))}
      <Label x={855} y={178} text="HEX-401" anchor="middle" />
      <Pipe d="M780,200 H800" />
      <Pipe d="M910,200 H950" />

      {/* supply riser -> point-of-use drop (XV-401) -> return header -> PCV-401 -> spray ball */}
      <Pipe d="M950,200 V130" />
      <Pipe d="M950,130 H985" />
      <GateValve x={985} y={130} open={xv401.open} tag="XV-401" interlock={xv401.interlock} />
      <Label x={1000} y={135} text="POU" anchor="start" />
      <Pipe d="M950,130 V20" />
      <Pipe d="M950,20 H395" />
      <GateValve x={700} y={20} open={pcv401.open} tag="PCV-401" interlock={pcv401.interlock} />
      <Label x={945} y={250} text="POINT-OF-USE SUPPLY" anchor="end" />

      {/* sanitary OOS dump: branches off the return header, opens automatically on an OOS trip */}
      <Pipe d="M820,20 V29" width={3} />
      <GateValve x={820} y={40} open={xv422.open} tag="XV-422" interlock={xv422.interlock} />
      <Pipe d="M820,51 V60 H1010" width={3} />
      <OffPageArrow x={1010} y={60} angle={0} />
      <Label x={1005} y={50} text="TO DRAIN" anchor="end" />

      {/* Sani Schedule panel — clear whitespace above LIC-401, between the stills and the tank nozzle */}
      <g>
        <rect x={460} y={8} width={220} height={56} rx={3} fill="var(--dv-faceplate-header, #3a434c)" />
        <text x={570} y={20} fill="#ffffff" fontSize={9} fontWeight={800} textAnchor="middle" letterSpacing={0.4}>
          SANI SCHEDULE
        </text>
        <text x={468} y={32} fill="#cfd4da" fontSize={8}>
          Time Until Next Sani
        </text>
        <text x={672} y={32} fill="#ffffff" fontSize={8} fontWeight={700} textAnchor="end">
          {durationString(untilNextS)}
        </text>
        <text x={468} y={43} fill="#cfd4da" fontSize={8}>
          Time Since Last Sani
        </text>
        <text x={672} y={43} fill="#ffffff" fontSize={8} fontWeight={700} textAnchor="end">
          {durationString(sinceLastS)}
        </text>
        <text x={468} y={54} fill="#cfd4da" fontSize={8}>
          Sani Time Remaining
        </text>
        <text x={672} y={54} fill={inSani ? '#ffce45' : '#ffffff'} fontSize={8} fontWeight={700} textAnchor="end">
          {inSani ? durationString(remainingS) : '--:--:--'}
        </text>
      </g>

      <InstrumentTap tapX={650} tapY={200} toX={600} toY={225} />
      <InstrumentTap tapX={790} tapY={200} toX={800} toY={235} />
      <InstrumentTap tapX={830} tapY={20} toX={830} toY={45} />

      <ValueBox tag="TIC-401" x={45} y={195} />
      <ValueBox tag="TIC-411" x={165} y={195} />
      <ValueBox tag="FI-401" x={45} y={15} />
      <ValueBox tag="FI-411" x={165} y={15} />
      <ValueBox tag="LIC-401" x={460} y={70} />
      <ValueBox tag="PIC-401" x={565} y={225} />
      <ValueBox tag="AT-401" x={765} y={235} />
      <ValueBox tag="AT-402" x={885} y={235} />
      <ValueBox tag="TI-402" x={795} y={45} />
    </Wrap>
  )
}

function ChamberUnit({
  n,
  tic,
  pic,
  xv,
  di,
  offsetX
}: {
  n: number
  tic: PidModule
  pic: PidModule
  xv: ValveModule
  di?: DiscreteInput
  offsetX: number
}): JSX.Element {
  const doorClosed = di ? di.state : true
  return (
    <g>
      <Label x={offsetX + 90} y={20} text={`AUTOCLAVE ${n}`} />
      <rect x={offsetX} y={30} width={180} height={140} rx={8} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      <rect
        x={offsetX + 160}
        y={40}
        width={14}
        height={120}
        rx={3}
        fill={doorClosed ? 'var(--dv-run)' : 'var(--dv-critical)'}
        opacity={0.8}
      />
      <text x={offsetX + 90} y={105} fill="var(--dv-text-mute)" fontSize={10} textAnchor="middle">
        CHAMBER
      </text>
      <Pipe d={`M${offsetX + 90},10 V30`} active={tic.out > 5} width={4} />
      <GateValve x={offsetX + 90} y={195} open={xv.open} tag={xv.tag} interlock={xv.interlock} />
      <Pipe d={`M${offsetX + 90},170 V185`} />
      <ValueBox tag={tic.tag} x={offsetX - 10} y={60} />
      <ValueBox tag={pic.tag} x={offsetX - 10} y={100} />
    </g>
  )
}

export function AutoclaveDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-501'] || !modules['TIC-511']) return null
  return (
    <Wrap height={240} embedded={embedded}>
      <ChamberUnit
        n={1}
        tic={modules['TIC-501'] as PidModule}
        pic={modules['PIC-501'] as PidModule}
        xv={modules['XV-501'] as ValveModule}
        di={modules['DI-501'] as DiscreteInput}
        offsetX={120}
      />
      <ChamberUnit
        n={2}
        tic={modules['TIC-511'] as PidModule}
        pic={modules['PIC-511'] as PidModule}
        xv={modules['XV-511'] as ValveModule}
        di={modules['DI-511'] as DiscreteInput}
        offsetX={560}
      />
      <Label x={520} y={120} text="STEAM HEADER" anchor="middle" />
    </Wrap>
  )
}

function LyoUnit({
  n,
  tic,
  pic,
  at,
  xv,
  offsetX
}: {
  n: number
  tic: PidModule
  pic: PidModule
  at: PidModule
  xv: ValveModule
  offsetX: number
}): JSX.Element {
  return (
    <g>
      <Label x={offsetX + 90} y={20} text={`LYOPHILIZER ${n}`} />
      <rect x={offsetX} y={30} width={180} height={130} rx={8} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={offsetX + 14}
          y={42 + i * 26}
          width={152}
          height={16}
          rx={2}
          fill="var(--dv-liquid)"
          opacity={0.18 + (0.55 * Math.max(0, 50 - Math.abs(tic.pv - -40))) / 50}
        />
      ))}
      <Pipe d={`M${offsetX + 90},10 V30`} active={pic.out > 5} width={4} />
      <Label x={offsetX + 90} y={8} text="TO CONDENSER" anchor="middle" />
      <GateValve x={offsetX + 90} y={185} open={xv.open} tag={xv.tag} interlock={xv.interlock} />
      <Pipe d={`M${offsetX + 90},160 V175`} />
      <ValueBox tag={tic.tag} x={offsetX - 10} y={50} />
      <ValueBox tag={pic.tag} x={offsetX - 10} y={90} />
      <ValueBox tag={at.tag} x={offsetX - 10} y={130} />
    </g>
  )
}

export function LyoDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-601'] || !modules['TIC-611']) return null
  return (
    <Wrap height={230} embedded={embedded}>
      <LyoUnit
        n={1}
        tic={modules['TIC-601'] as PidModule}
        pic={modules['PIC-601'] as PidModule}
        at={modules['AT-601'] as PidModule}
        xv={modules['XV-601'] as ValveModule}
        offsetX={120}
      />
      <LyoUnit
        n={2}
        tic={modules['TIC-611'] as PidModule}
        pic={modules['PIC-611'] as PidModule}
        at={modules['AT-611'] as PidModule}
        xv={modules['XV-611'] as ValveModule}
        offsetX={560}
      />
    </Wrap>
  )
}

function CipUnit({
  n,
  tic,
  fic,
  at,
  p,
  xvS,
  xvR,
  offsetX
}: {
  n: number
  tic: PidModule
  fic: PidModule
  at: PidModule
  p: MotorModule
  xvS: ValveModule
  xvR: ValveModule
  offsetX: number
}): JSX.Element {
  return (
    <g>
      <Label x={offsetX + 60} y={20} text={`CIP SKID ${n}`} />
      <Tank x={offsetX} y={30} w={80} h={100} level={60} label="" liquidColor="var(--dv-liquid)" />
      <Pipe d={`M${offsetX + 40},130 V150`} />
      <Pump x={offsetX + 40} y={170} running={p.running} tag={p.tag} />
      <Pipe d={`M${offsetX + 40},190 V210 H${offsetX + 140}`} />
      <GateValve x={offsetX + 140} y={210} open={xvS.open} tag={xvS.tag} interlock={xvS.interlock} />
      <Label x={offsetX + 140} y={235} text="SUPPLY" anchor="middle" />
      <Pipe d={`M${offsetX},60 H${offsetX - 20} V210 H${offsetX + 20}`} />
      <GateValve x={offsetX - 20} y={130} open={xvR.open} tag={xvR.tag} interlock={xvR.interlock} />
      <Label x={offsetX - 20} y={108} text="RETURN" anchor="middle" />
      <ValueBox tag={tic.tag} x={offsetX + 90} y={30} />
      <ValueBox tag={fic.tag} x={offsetX + 90} y={60} />
      <ValueBox tag={at.tag} x={offsetX - 95} y={30} />
    </g>
  )
}

export function CipDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-701'] || !modules['TIC-711'] || !modules['TIC-721']) return null
  return (
    <Wrap height={280} embedded={embedded}>
      <CipUnit
        n={1}
        tic={modules['TIC-701'] as PidModule}
        fic={modules['FIC-701'] as PidModule}
        at={modules['AT-701'] as PidModule}
        p={modules['P-701'] as MotorModule}
        xvS={modules['XV-701'] as ValveModule}
        xvR={modules['XV-702'] as ValveModule}
        offsetX={130}
      />
      <CipUnit
        n={2}
        tic={modules['TIC-711'] as PidModule}
        fic={modules['FIC-711'] as PidModule}
        at={modules['AT-711'] as PidModule}
        p={modules['P-711'] as MotorModule}
        xvS={modules['XV-711'] as ValveModule}
        xvR={modules['XV-712'] as ValveModule}
        offsetX={480}
      />
      <CipUnit
        n={3}
        tic={modules['TIC-721'] as PidModule}
        fic={modules['FIC-721'] as PidModule}
        at={modules['AT-721'] as PidModule}
        p={modules['P-721'] as MotorModule}
        xvS={modules['XV-721'] as ValveModule}
        xvR={modules['XV-722'] as ValveModule}
        offsetX={830}
      />
    </Wrap>
  )
}

function TcuUnit({
  n,
  tic,
  fic,
  p,
  hs,
  serves,
  offsetX
}: {
  n: number
  tic: PidModule
  fic: PidModule
  p: MotorModule
  hs: DiscreteOutput
  serves: string
  offsetX: number
}): JSX.Element {
  return (
    <g>
      <Label x={offsetX + 70} y={20} text={`TCU ${n}`} />
      <rect x={offsetX} y={30} width={140} height={70} rx={6} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      <rect x={offsetX + 55} y={44} width={30} height={20} rx={3} fill={hs.state ? 'var(--dv-critical)' : 'var(--dv-metal)'} opacity={0.75} />
      <text x={offsetX + 70} y={78} fill="var(--dv-text-mute)" fontSize={9} textAnchor="middle">
        HEATER
      </text>
      <Pipe d={`M${offsetX + 70},100 V110`} />
      <Pump x={offsetX + 70} y={130} running={p.running} tag={p.tag} />
      <Pipe d={`M${offsetX + 70},150 V170`} />
      <Label x={offsetX + 70} y={185} text={`TO ${serves}`} anchor="middle" />
      <ValueBox tag={tic.tag} x={offsetX - 15} y={38} />
      <ValueBox tag={fic.tag} x={offsetX + 95} y={38} />
    </g>
  )
}

export function TcuDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-801'] || !modules['TIC-811'] || !modules['TIC-821']) return null
  return (
    <Wrap height={230} embedded={embedded}>
      <TcuUnit
        n={1}
        tic={modules['TIC-801'] as PidModule}
        fic={modules['FIC-801'] as PidModule}
        p={modules['P-801'] as MotorModule}
        hs={modules['HS-801'] as DiscreteOutput}
        serves="REACTOR JACKET"
        offsetX={100}
      />
      <TcuUnit
        n={2}
        tic={modules['TIC-811'] as PidModule}
        fic={modules['FIC-811'] as PidModule}
        p={modules['P-811'] as MotorModule}
        hs={modules['HS-811'] as DiscreteOutput}
        serves="LYO-1 SHELVES"
        offsetX={450}
      />
      <TcuUnit
        n={3}
        tic={modules['TIC-821'] as PidModule}
        fic={modules['FIC-821'] as PidModule}
        p={modules['P-821'] as MotorModule}
        hs={modules['HS-821'] as DiscreteOutput}
        serves="LYO-2 SHELVES"
        offsetX={780}
      />
    </Wrap>
  )
}
