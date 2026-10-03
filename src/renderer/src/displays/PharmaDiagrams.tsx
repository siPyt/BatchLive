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
  ClassicTitle,
  ClassicSanitaryValve,
  ClassicHandValve,
  ClassicBlackValve,
  ClassicPidBox,
  ClassicNamedValue,
  ClassicNavButton,
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

export function WfiDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  const time = useStore((s) => s.time)
  const tic401 = modules['TIC-401'] as PidModule
  const tic411 = modules['TIC-411'] as PidModule
  const pic401 = modules['PIC-401'] as PidModule
  const xv411 = modules['XV-411'] as ValveModule
  const xv401 = modules['XV-401'] as ValveModule
  const xv422 = modules['XV-422'] as ValveModule
  const pcv401 = modules['PCV-401'] as ValveModule
  const p401 = modules['P-401'] as MotorModule
  const p402 = modules['P-402'] as MotorModule
  const at401 = modules['AT-401'] as AnalogIndicator
  const at402 = modules['AT-402'] as AnalogIndicator
  const ti402 = modules['TI-402'] as AnalogIndicator
  const proc = modules['LIC-401'] as PidModule
  if (!tic401 || !tic411 || !pic401 || !p401 || !p402 || !proc) return null

  // Live display strings for the many 3T-8120 indicator tags.
  const liters = (((proc?.pv ?? 0) / 100) * 7000).toFixed(1)
  const condVal = `${(at401?.pv ?? 0.34).toFixed(2)} µS/cm`
  const tocVal = `${Math.round(at402?.pv ?? 14)} ppb`
  const returnTemp = `${(ti402?.pv ?? 20.2).toFixed(1)} °C`

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

  // Loop temperature-high switches (TAH011C-G on the real screen): five
  // lettered trip points all watching the same loop return temperature.
  const tahTripped = (ti402?.pv ?? 0) > 85
  const tahTags = ['3T-8120-TAH011C', '3T-8120-TAH011D', '3T-8120-TAH011E', '3T-8120-TAH011F', '3T-8120-TAH011G']

  // Right-edge off-page utility connectors, in the reference screen's order.
  const rightFlags: [number, string][] = [
    [72, 'WFI Hot (Waste)'],
    [98, 'Glycol Return'],
    [150, 'Glycol Supply'],
    [176, 'Plant Steam'],
    [202, 'WFI Cold to Users'],
    [228, 'Glycol Return'],
    [306, 'Glycol Supply'],
    [335, 'WFI Cold from Users'],
    [361, 'Plant Steam'],
    [402, 'Plant Condensate']
  ]

  return (
    <Wrap height={500} embedded={embedded}>
      <ClassicBackground w={1040} h={500} />
      <ClassicTitle x={520} y={24} text="3T-8120 WFI Storage Tank and Loop" />

      {/* loop temperature-high switch row */}
      {tahTags.map((t, i) => (
        <ClassicStatusWord key={t} x={560 + i * 90} y={46} tag={t} tripped={tahTripped} />
      ))}

      {/* ===== process piping skeleton ===== */}
      {/* tank side nozzle -> recirc header -> coolers */}
      <ClassicPipe d="M270,235 H700 V192" />
      {/* trim cooler -> cooler */}
      <ClassicPipe d="M775,171 H815 V250" />
      {/* cooler -> sani heater */}
      <ClassicPipe d="M790,292 H775 V351 H775" />
      <ClassicPipe d="M790,292 V320 H707 V330" />
      {/* sani heater -> users (right) */}
      <ClassicPipe d="M775,351 H905" />
      {/* tank bottom suction header -> pumps */}
      <ClassicPipe d="M195,383 V405 H575 V326" />
      <ClassicPipe d="M195,405 H545 V399" />
      <ClassicPipe d="M545,431 V450" />
      {/* tank top recirc return (spray ball) */}
      <ClassicPipe d="M195,203 V150 H470" />
      <circle cx={195} cy={205} r={4} fill={PALE_BORDER} />

      {/* ===== storage tank ===== */}
      <ClassicTank x={120} y={215} w={150} h={150} level={proc?.pv ?? 0} label="" below="Not In Use" />
      <ClassicNamedValue x={300} y={250} tag="3T-8120-LI005" value={`${liters} liter`} bindTag="LIC-401" />
      <ClassicNamedValue x={300} y={275} tag="3T-8120-TIC001" value="82.0 °C" bindTag="TIC-401" />

      {/* ===== inlet (hot WFI from still) ===== */}
      <ClassicFlag x={150} y={58} w={82} text="Hot WFI from Still" pointRight={false} />
      <ClassicNamedValue x={40} y={96} tag="3T-8120-TI004" value="101.7 °C" />
      <ClassicHandValve x={205} y={100} tag="XV-411" label="3WFI-8110-YV007" />
      <ClassicSanitaryValve x={320} y={100} open={xv411?.open ?? true} tag="XV-411" label="3T-8120-YV006" />
      <ClassicNamedValue x={40} y={150} tag="3T-8120-PI047" value="-0.1 psi" />
      <ClassicHandValve x={205} y={152} label="3T-8120-YV006" />
      <ClassicNamedValue x={40} y={190} tag="3T-8120-ZSA007" value="Normal" w={80} />

      {/* ===== heat exchangers ===== */}
      <ClassicHex x={640} y={150} w={135} h={42} label={'WFI Recirc\nTrim Cooler'} />
      <ClassicHex x={790} y={250} w={135} h={42} label={'WFI Recirc\nCooler'} />
      <ClassicHex x={640} y={330} w={135} h={42} label={'WFI Recirc\nSani Htr'} />

      {/* ===== inline control & isolation valves ===== */}
      <ClassicBlackValve x={760} y={130} label="3T-8120-TIC001" />
      <ClassicBlackValve x={815} y={228} label="3T-8120-TIC011" />
      <ClassicBlackValve x={640} y={308} label="3T-8120-TIC011" />
      <ClassicSanitaryValve x={560} y={200} open={xv401?.open ?? false} tag="XV-401" label="3T-8120-YV001A" />
      <ClassicSanitaryValve x={905} y={355} open={pcv401?.open ?? true} tag="PCV-401" label="3T-8120-YV011A" />
      <ClassicSanitaryValve x={700} y={378} open={xv422?.open ?? false} tag="XV-422" label="3T-8120-YV014" />
      <ClassicHandValve x={310} y={335} label="3T-8120-YV009" />

      {/* ===== recirculation pumps ===== */}
      <ClassicPump x={575} y={310} running={p401?.running ?? false} tag="P-401" />
      <ClassicPump x={545} y={415} running={p402?.running ?? false} tag="P-402" />

      {/* ===== indicator value boxes ===== */}
      <ClassicNamedValue x={390} y={278} tag="3T-8120-FI003" value="49.4 GPM" />
      <ClassicNamedValue x={640} y={255} tag="3T-8120-ZSA017" value="Normal" w={80} />
      <ClassicNamedValue x={810} y={300} tag="3T-8120-TI013" value={returnTemp} bindTag="TI-402" />
      <ClassicNamedValue x={810} y={326} tag="3T-8120-FI012" value="35.8 GPM" />

      {/* ===== live PID faceplate dynamos ===== */}
      <ClassicPidBox tag="TIC-401" label="3T-8120-TIC001" x={470} y={108} />
      <ClassicPidBox tag="PIC-401" label="3T-8120-PIC016" x={410} y={352} />
      <ClassicPidBox tag="TIC-411" label="3T-8120-TIC011" x={905} y={252} />

      {/* ===== analytics (TOC + conductivity) ===== */}
      <ClassicNamedValue x={10} y={230} tag="3T-8120-AI015A" value={tocVal} bindTag="AT-402" />
      <ClassicNamedValue x={10} y={270} tag="3T-8120-AI015B" value={condVal} bindTag="AT-401" />
      <ClassicNamedValue x={575} y={438} tag="3T-8120-XA015" value="Normal" w={80} />

      {/* ===== WFI level control + product-water drain ===== */}
      <ClassicNamedValue x={688} y={420} tag="WFI-LVL-CTRL" value="Not Filling" w={92} />
      <ClassicPipe d="M734,438 V462" />
      <polygon points="729,458 739,458 734,468" fill={PALE_BORDER} />
      <ClassicLabel x={734} y={482} text="PW" />

      {/* ===== Sani Schedule panel ===== */}
      <ClassicPanel
        x={800}
        y={392}
        w={150}
        h={70}
        title="N1-WFI-SANI"
        rows={[
          ['Time Until Next Sani', durationString(untilNextS)],
          ['Time Since Last Sani', durationString(sinceLastS)],
          ['Sani Time Remaining', inSani ? durationString(remainingS) : '--:--:--']
        ]}
        button="Sani Schedule"
      />

      {/* ===== off-page utility connectors ===== */}
      {rightFlags.map(([fy, ft], i) => (
        <ClassicFlag key={i} x={962} y={fy} w={68} text={ft} />
      ))}
      <ClassicFlag x={150} y={410} w={82} text="Plant Condensate" pointRight={false} />

      {/* ===== bottom navigation ===== */}
      <ClassicNavButton x={120} y={462} w={104} text={'N1BP WFI Tank\nand Loop'} />
      <ClassicNavButton x={232} y={462} w={92} text="WFI STILL" />
      <ClassicNavButton x={332} y={462} w={104} text={'WFI STILL\nComms'} />
      <ClassicNavButton x={444} y={462} w={104} text={'N3 WFI Tank\nand Loop'} />
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
      <ClassicPipe d={`M${offsetX + 170},10 V30`} width={4} />
      <ClassicValve x={offsetX + 90} y={195} open={xv.open} tag={xv.tag} />
      <ClassicPipe d={`M${offsetX + 90},170 V185`} />
      <ClassicReadout tag={tic.tag} x={offsetX + 190} y={60} />
      <ClassicReadout tag={pic.tag} x={offsetX + 190} y={110} />
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
      <ClassicPipe d={`M${offsetX + 170},10 V30`} width={4} />
      <ClassicLabel x={offsetX + 90} y={8} text="TO CONDENSER" anchor="middle" />
      <ClassicValve x={offsetX + 90} y={185} open={xv.open} tag={xv.tag} />
      <ClassicPipe d={`M${offsetX + 90},160 V175`} />
      <ClassicReadout tag={tic.tag} x={offsetX + 190} y={40} />
      <ClassicReadout tag={pic.tag} x={offsetX + 190} y={90} />
      <ClassicReadout tag={at.tag} x={offsetX + 190} y={140} />
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
      <ClassicReadout tag={fic.tag} x={offsetX + 90} y={80} />
      <ClassicReadout tag={at.tag} x={offsetX + 90} y={130} />
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
      <ClassicReadout tag={tic.tag} x={offsetX - 100} y={38} />
      <ClassicReadout tag={fic.tag} x={offsetX + 150} y={38} />
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
