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
    <Wrap height={260}>
      <Label x={90} y={28} text="STILL 1" />
      <rect x={60} y={38} width={60} height={120} rx={6} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      <rect x={66} y={44} width={10} height={108} rx={3} fill="var(--dv-steam)" opacity={0.25 + (tic401.out / 100) * 0.6} />

      <Label x={210} y={28} text="STILL 2" />
      <rect x={180} y={38} width={60} height={120} rx={6} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      <rect x={186} y={44} width={10} height={108} rx={3} fill="var(--dv-steam)" opacity={0.25 + (tic411.out / 100) * 0.6} />
      <GateValve x={240} y={100} open={xv411.open} tag="XV-411" interlock={xv411.interlock} />

      <Pipe d="M90,158 V200 H330" />
      <Pipe d="M210,158 V180 H258" />
      <Pipe d="M262,100 H330 V200" />

      <Tank x={330} y={38} w={110} h={150} level={proc?.pv ?? 0} label="TK-401 WFI STORAGE" />

      <Pipe d="M385,188 V220 H480" />
      <Pump x={500} y={220} running={p401.running} tag="P-401" r={18} />
      <Pump x={500} y={170} running={p402.running} tag="P-402" r={18} />
      <Pipe d="M480,220 H500" />
      <Pipe d="M480,170 H500" />
      <Pipe d="M385,170 H480" />
      <Pipe d="M518,220 H560 V195 H900" />
      <Pipe d="M518,170 H560" />

      <GateValve x={700} y={195} open={xv401.open} tag="XV-401" interlock={xv401.interlock} />
      <Label x={940} y={190} text="TO POINT-OF-USE" anchor="end" />
      <Pipe d="M900,195 H960" />

      <ValueBox tag="TIC-401" x={55} y={168} />
      <ValueBox tag="TIC-411" x={175} y={168} />
      <ValueBox tag="FI-401" x={55} y={10} />
      <ValueBox tag="FI-411" x={175} y={10} />
      <ValueBox tag="LIC-401" x={450} y={60} />
      <ValueBox tag="PIC-401" x={600} y={140} />
      <ValueBox tag="AT-401" x={760} y={140} />
      <ValueBox tag="TI-402" x={830} y={225} />
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
      <Pipe d={`M${offsetX + 40},130 V155`} />
      <Pump x={offsetX + 40} y={170} running={p.running} tag={p.tag} r={16} />
      <Pipe d={`M${offsetX + 40},186 V200 H${offsetX + 140}`} />
      <GateValve x={offsetX + 140} y={200} open={xvS.open} tag={xvS.tag} interlock={xvS.interlock} />
      <Label x={offsetX + 140} y={225} text="SUPPLY" anchor="middle" />
      <Pipe d={`M${offsetX},60 H${offsetX - 20} V200 H${offsetX + 20}`} />
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
    <Wrap height={260}>
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
      <rect x={offsetX} y={30} width={140} height={90} rx={6} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
      <rect x={offsetX + 10} y={40} width={30} height={20} rx={3} fill={hs.state ? 'var(--dv-critical)' : 'var(--dv-metal)'} opacity={0.75} />
      <text x={offsetX + 25} y={75} fill="var(--dv-text-mute)" fontSize={9} textAnchor="middle">
        HEATER
      </text>
      <Pump x={offsetX + 100} y={75} running={p.running} tag={p.tag} r={15} />
      <Pipe d={`M${offsetX + 70},120 V140 H${offsetX + 70}`} />
      <Label x={offsetX + 70} y={155} text={`TO ${serves}`} anchor="middle" />
      <ValueBox tag={tic.tag} x={offsetX - 10} y={135} />
      <ValueBox tag={fic.tag} x={offsetX + 70} y={135} />
    </g>
  )
}

export function TcuDiagram(): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-801'] || !modules['TIC-811'] || !modules['TIC-821']) return null
  return (
    <Wrap height={210}>
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
