import { useStore } from '../engine/store'
import type { ReactNode } from 'react'
import { InstrumentTap } from '../components/Graphics'
import {
  ClassicBackground,
  ClassicPipe,
  ClassicLabel,
  ClassicTank,
  ClassicValve,
  ClassicPump,
  ClassicHex,
  ClassicFlag,
  ClassicReadout,
  ClassicStatusWord,
  ClassicPanel,
  ClassicVessel,
  PALE_BORDER,
  PALE_GREEN,
  PALE_RED
} from '../components/ClassicGraphics'
import { durationString } from '../utils/format'
import type { PidModule, ValveModule, DiscreteInput, MotorModule, DiscreteOutput, AnalogIndicator } from '../engine/types'

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
 * and a heat-jacket core that glows with the controller's heat output.
 * Styled pale/flat to match the classic DeltaV Operate WFI graphic. */
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
      <ClassicLabel x={x + w / 2} y={y - 8} text={label} />
      <path
        d={`M ${x},${y + domeH}
            Q ${x},${y} ${x + w / 2},${y}
            Q ${x + w},${y} ${x + w},${y + domeH}
            L ${x + w},${y + h}
            Q ${x + w},${y + h + 10} ${x + w - 10},${y + h + 10}
            L ${x + 10},${y + h + 10}
            Q ${x},${y + h + 10} ${x},${y + h}
            Z`}
        fill="#dfe6ec"
        stroke="#5b7384"
        strokeWidth={2}
      />
      {[0.3, 0.5, 0.7].map((f) => (
        <line
          key={f}
          x1={x + 6}
          x2={x + w - 6}
          y1={y + domeH + f * (h - domeH)}
          y2={y + domeH + f * (h - domeH)}
          stroke="#5b7384"
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
        fill="#c0392b"
        opacity={0.15 + heatFrac * 0.55}
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
  const ti402 = modules['TI-402'] as AnalogIndicator
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

  // Redundant loop-temperature-high switches (TAH011C-G on the real screen):
  // five lettered trip points, all watching the same return temperature.
  const tahTripped = (ti402?.pv ?? 0) > 85
  const tahTags = ['TAH-402B', 'TAH-402C', 'TAH-402D', 'TAH-402E', 'TAH-402F']

  return (
    <Wrap height={400} embedded={embedded}>
      <ClassicBackground w={1040} h={400} />
      {tahTags.map((t, i) => (
        <ClassicStatusWord key={t} x={560 + i * 95} y={12} tag={t} tripped={tahTripped} />
      ))}

      <StillVessel x={50} y={60} w={80} h={130} heatFrac={tic401.out / 100} label="STILL 1" />
      <StillVessel x={170} y={60} w={80} h={130} heatFrac={tic411.out / 100} label="STILL 2" />
      <ClassicValve x={290} y={215} open={xv411.open} tag="XV-411" />

      {/* stills discharge into the WFI storage tank's side nozzle */}
      <ClassicPipe d="M90,200 V215 H340" />
      <ClassicPipe d="M210,200 V215 H272" />
      <ClassicPipe d="M308,215 H340" />

      {/* top spray-ball recirculation return */}
      <ClassicPipe d="M395,35 V80" />
      <circle cx={395} cy={72} r={4} fill="#5b7384" />
      <line x1={390} y1={76} x2={384} y2={82} stroke="#5b7384" strokeWidth={1.5} />
      <line x1={400} y1={76} x2={406} y2={82} stroke="#5b7384" strokeWidth={1.5} />

      <ClassicTank x={340} y={80} w={110} h={150} level={proc?.pv ?? 0} label="TK-401 WFI STORAGE" />

      {/* bottom suction header -> dual sanitary pumps (P-401 primary / P-402 standby) */}
      <ClassicPipe d="M395,230 V250 H680" />
      <ClassicPipe d="M560,250 V278" />
      <ClassicPipe d="M660,250 V278" />
      <ClassicPump x={560} y={260} running={p401.running} tag="P-401" />
      <ClassicPump x={660} y={260} running={p402.running} tag="P-402" />

      {/* discharge risers merge into the distribution heat exchanger stages */}
      <ClassicPipe d="M560,244 V200" />
      <ClassicPipe d="M660,244 V200" />
      <ClassicPipe d="M560,200 H640" />
      <ClassicHex x={640} y={188} w={90} h={24} label="Trim Cooler" />
      <ClassicPipe d="M730,200 H780" />
      <ClassicHex x={780} y={188} w={90} h={24} label="Cooler" />
      <ClassicPipe d="M870,200 H920" />
      <ClassicHex x={920} y={188} w={90} h={24} label="Sani Htr" />

      {/* supply riser -> point-of-use drop (XV-401) -> return header -> PCV-401 -> spray ball */}
      <ClassicPipe d="M965,200 V130" />
      <ClassicPipe d="M965,130 H1000" />
      <ClassicValve x={1000} y={130} open={xv401.open} tag="XV-401" />
      <ClassicLabel x={1010} y={108} text="POU" anchor="start" />
      <ClassicPipe d="M965,130 V35" />
      <ClassicPipe d="M965,35 H395" />
      <ClassicValve x={700} y={35} open={pcv401.open} tag="PCV-401" />
      <ClassicLabel x={960} y={260} text="POINT-OF-USE SUPPLY" anchor="end" />

      {/* sanitary OOS dump: branches off the return header, opens automatically on an OOS trip */}
      <ClassicPipe d="M820,35 V44" />
      <ClassicValve x={820} y={55} open={xv422.open} tag="XV-422" />
      <ClassicPipe d="M820,66 V75 H980" />
      <ClassicFlag x={980} y={65} text="PW to Drain" />

      {/* Sani Schedule panel — plain bordered box with a button, matching the real site graphic's chrome */}
      <ClassicPanel
        x={460}
        y={30}
        w={220}
        h={78}
        title="N1-WFI-SANI"
        rows={[
          ['Time Until Next Sani', durationString(untilNextS)],
          ['Time Since Last Sani', durationString(sinceLastS)],
          ['Sani Time Remaining', inSani ? durationString(remainingS) : '--:--:--']
        ]}
        button="Sani Schedule"
      />

      <ClassicFlag x={30} y={30} w={60} text="Glycol Supply" pointRight={false} />
      <ClassicFlag x={30} y={300} w={60} text="Glycol Return" pointRight={false} />
      <ClassicFlag x={1000} y={300} w={60} text="Plant Steam" />
      <ClassicFlag x={1000} y={340} w={60} text="Plant Condensate" />

      <InstrumentTap tapX={610} tapY={200} toX={600} toY={240} />
      <InstrumentTap tapX={750} tapY={200} toX={760} toY={240} />
      <InstrumentTap tapX={830} tapY={35} toX={830} toY={60} />

      <ClassicReadout tag="TIC-401" x={40} y={205} />
      <ClassicReadout tag="TIC-411" x={160} y={205} />
      <ClassicReadout tag="FI-401" x={40} y={25} />
      <ClassicReadout tag="FI-411" x={160} y={25} />
      <ClassicReadout tag="LIC-401" x={340} y={238} />
      <ClassicReadout tag="PIC-401" x={560} y={254} />
      <ClassicReadout tag="AT-401" x={700} y={254} />
      <ClassicReadout tag="AT-402" x={810} y={254} />
      <ClassicReadout tag="TI-402" x={920} y={60} />
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
      <ClassicLabel x={offsetX + 90} y={20} text={`AUTOCLAVE ${n}`} />
      <rect x={offsetX} y={30} width={180} height={140} rx={8} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={2} />
      <rect x={offsetX + 160} y={40} width={14} height={120} rx={3} fill={doorClosed ? PALE_GREEN : PALE_RED} opacity={0.85} />
      <text x={offsetX + 90} y={105} fill="#3a4550" fontSize={10} textAnchor="middle">
        CHAMBER
      </text>
      <ClassicPipe d={`M${offsetX + 90},10 V30`} width={4} />
      <ClassicValve x={offsetX + 90} y={195} open={xv.open} tag={xv.tag} />
      <ClassicPipe d={`M${offsetX + 90},170 V185`} />
      <ClassicReadout tag={tic.tag} x={offsetX - 10} y={60} />
      <ClassicReadout tag={pic.tag} x={offsetX - 10} y={100} />
    </g>
  )
}

export function AutoclaveDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-501'] || !modules['TIC-511']) return null
  return (
    <Wrap height={240} embedded={embedded}>
      <ClassicBackground w={1040} h={240} />
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
      <ClassicLabel x={520} y={120} text="STEAM HEADER" anchor="middle" />
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
      <ClassicLabel x={offsetX + 90} y={20} text={`LYOPHILIZER ${n}`} />
      <rect x={offsetX} y={30} width={180} height={130} rx={8} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={2} />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={offsetX + 14}
          y={42 + i * 26}
          width={152}
          height={16}
          rx={2}
          fill="#7fa3bd"
          opacity={0.18 + (0.55 * Math.max(0, 50 - Math.abs(tic.pv - -40))) / 50}
        />
      ))}
      <ClassicPipe d={`M${offsetX + 90},10 V30`} width={4} />
      <ClassicLabel x={offsetX + 90} y={8} text="TO CONDENSER" anchor="middle" />
      <ClassicValve x={offsetX + 90} y={185} open={xv.open} tag={xv.tag} />
      <ClassicPipe d={`M${offsetX + 90},160 V175`} />
      <ClassicReadout tag={tic.tag} x={offsetX - 10} y={50} />
      <ClassicReadout tag={pic.tag} x={offsetX - 10} y={90} />
      <ClassicReadout tag={at.tag} x={offsetX - 10} y={130} />
    </g>
  )
}

export function LyoDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-601'] || !modules['TIC-611']) return null
  return (
    <Wrap height={230} embedded={embedded}>
      <ClassicBackground w={1040} h={230} />
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
      <ClassicLabel x={offsetX + 60} y={20} text={`CIP SKID ${n}`} />
      <ClassicTank x={offsetX} y={30} w={80} h={100} level={60} label="" />
      <ClassicPipe d={`M${offsetX + 40},130 V150`} />
      <ClassicPump x={offsetX + 40} y={170} running={p.running} tag={p.tag} />
      <ClassicPipe d={`M${offsetX + 40},190 V210 H${offsetX + 140}`} />
      <ClassicValve x={offsetX + 140} y={210} open={xvS.open} tag={xvS.tag} />
      <ClassicLabel x={offsetX + 140} y={235} text="SUPPLY" anchor="middle" />
      <ClassicPipe d={`M${offsetX},60 H${offsetX - 20} V210 H${offsetX + 20}`} />
      <ClassicValve x={offsetX - 20} y={130} open={xvR.open} tag={xvR.tag} />
      <ClassicLabel x={offsetX - 20} y={108} text="RETURN" anchor="middle" />
      <ClassicReadout tag={tic.tag} x={offsetX + 90} y={30} />
      <ClassicReadout tag={fic.tag} x={offsetX + 90} y={60} />
      <ClassicReadout tag={at.tag} x={offsetX - 95} y={30} />
    </g>
  )
}

export function CipDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-701'] || !modules['TIC-711'] || !modules['TIC-721']) return null
  return (
    <Wrap height={280} embedded={embedded}>
      <ClassicBackground w={1040} h={280} />
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
      <ClassicLabel x={offsetX + 70} y={20} text={`TCU ${n}`} />
      <rect x={offsetX} y={30} width={140} height={70} rx={6} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={2} />
      <rect x={offsetX + 55} y={44} width={30} height={20} rx={3} fill={hs.state ? PALE_RED : '#8b97a0'} opacity={0.85} />
      <text x={offsetX + 70} y={78} fill="#3a4550" fontSize={9} textAnchor="middle">
        HEATER
      </text>
      <ClassicPipe d={`M${offsetX + 70},100 V110`} />
      <ClassicPump x={offsetX + 70} y={130} running={p.running} tag={p.tag} />
      <ClassicPipe d={`M${offsetX + 70},150 V170`} />
      <ClassicLabel x={offsetX + 70} y={185} text={`TO ${serves}`} anchor="middle" />
      <ClassicReadout tag={tic.tag} x={offsetX - 15} y={38} />
      <ClassicReadout tag={fic.tag} x={offsetX + 95} y={38} />
    </g>
  )
}

export function TcuDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  if (!modules['TIC-801'] || !modules['TIC-811'] || !modules['TIC-821']) return null
  return (
    <Wrap height={230} embedded={embedded}>
      <ClassicBackground w={1040} h={230} />
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
