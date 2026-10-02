import { useStore } from '../engine/store'
import type { ReactNode } from 'react'
import { Tank, Pump, GateValve, Pipe, Label } from '../components/Graphics'
import { ValueBox } from '../components/ValueBox'
import type { PidModule, ValveModule, DiscreteInput, MotorModule, DiscreteOutput } from '../engine/types'

/** P&ID mimic diagrams for the GMP pharma areas, in the same visual language
 * as the reactor-train Plant Overview (Graphics.tsx symbols + ValueBox dynamos). */

function Wrap({ height, children }: { height: number; children: ReactNode }): JSX.Element {
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
        fill="#eef1f4"
        stroke="var(--dv-metal)"
        strokeWidth={2}
      />
      {[0.3, 0.5, 0.7].map((f) => (
        <line
          key={f}
          x1={x + 6}
          x2={x + w - 6}
          y1={y + domeH + f * (h - domeH)}
          y2={y + domeH + f * (h - domeH)}
          stroke="var(--dv-metal)"
          strokeWidth={1}
          opacity={0.45}
        />
      ))}
      <rect
        x={x + w / 2 - 6}
        y={y + domeH + 6}
        width={12}
        height={h - domeH - 14}
        rx={4}
        fill="var(--dv-steam)"
        opacity={0.2 + heatFrac * 0.6}
      />
    </g>
  )
}

export function WfiDiagram(): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  const tic401 = modules['TIC-401'] as PidModule
  const tic411 = modules['TIC-411'] as PidModule
  const xv411 = modules['XV-411'] as ValveModule
  const xv401 = modules['XV-401'] as ValveModule
  const p401 = modules['P-401'] as MotorModule
  const p402 = modules['P-402'] as MotorModule
  const proc = useStore((s) => s.modules['LIC-401'] as PidModule)
  if (!tic401 || !tic411 || !xv411 || !xv401 || !p401 || !p402) return null

  return (
    <Wrap height={300}>
      <StillVessel x={50} y={50} w={80} h={130} heatFrac={tic401.out / 100} label="STILL 1" />
      <StillVessel x={170} y={50} w={80} h={130} heatFrac={tic411.out / 100} label="STILL 2" />
      <GateValve x={290} y={150} open={xv411.open} tag="XV-411" interlock={xv411.interlock} />

      <Pipe d="M90,198 V240 H340" />
      <Pipe d="M210,198 V220 H272" />
      <Pipe d="M308,150 H340 V240" />

      <Tank x={340} y={50} w={110} h={150} level={proc?.pv ?? 0} label="TK-401 WFI STORAGE" />

      <Pipe d="M395,200 V260 H960" />
      <Pump x={560} y={260} running={p401.running} tag="P-401" r={20} />
      <Pump x={660} y={260} running={p402.running} tag="P-402" r={20} />
      <GateValve x={800} y={260} open={xv401.open} tag="XV-401" interlock={xv401.interlock} />
      <Label x={945} y={250} text="TO POINT-OF-USE" anchor="end" />

      <ValueBox tag="TIC-401" x={45} y={195} />
      <ValueBox tag="TIC-411" x={165} y={195} />
      <ValueBox tag="FI-401" x={45} y={15} />
      <ValueBox tag="FI-411" x={165} y={15} />
      <ValueBox tag="LIC-401" x={460} y={70} />
      <ValueBox tag="PIC-401" x={540} y={200} />
      <ValueBox tag="AT-401" x={700} y={200} />
      <ValueBox tag="TI-402" x={840} y={200} />
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

export function AutoclaveDiagram(): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-501'] || !modules['TIC-511']) return null
  return (
    <Wrap height={240}>
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

export function LyoDiagram(): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-601'] || !modules['TIC-611']) return null
  return (
    <Wrap height={230}>
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
      <Pump x={offsetX + 40} y={170} running={p.running} tag={p.tag} r={20} />
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

export function CipDiagram(): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-701'] || !modules['TIC-711'] || !modules['TIC-721']) return null
  return (
    <Wrap height={280}>
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
      <Pump x={offsetX + 70} y={130} running={p.running} tag={p.tag} r={20} />
      <Pipe d={`M${offsetX + 70},150 V170`} />
      <Label x={offsetX + 70} y={185} text={`TO ${serves}`} anchor="middle" />
      <ValueBox tag={tic.tag} x={offsetX - 15} y={38} />
      <ValueBox tag={fic.tag} x={offsetX + 95} y={38} />
    </g>
  )
}

export function TcuDiagram(): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-801'] || !modules['TIC-811'] || !modules['TIC-821']) return null
  return (
    <Wrap height={230}>
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
