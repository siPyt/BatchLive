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
  ClassicControlValve,
  ClassicPidBox,
  ClassicNamedValue,
  ClassicNavButton,
  PALE_BORDER,
  PALE_GREEN,
  PALE_RED
} from '../components/ClassicGraphics'
import { durationString } from '../utils/format'
import { appliedPidOutput } from '../engine/analogStrategy'
import type { PidModule, ValveModule, DiscreteInput, MotorModule, DiscreteOutput, AnalogIndicator } from '../engine/types'

/** P&ID mimic diagrams for the GMP pharma areas, in the same visual language
 * as the reactor-train Plant Overview (Graphics.tsx symbols + ValueBox dynamos). */

/** Standalone mode fits the picture to the available operator working area.
 * `embedded` mode (the master plant canvas) instead renders a bare
 * `<g>` positioned by the caller — no nested svg/viewBox, no bounding box —
 * so the diagram lives directly on the shared world coordinate plane. */
function Wrap({ height, children, embedded }: { height: number; children: ReactNode; embedded?: boolean }): JSX.Element {
  if (embedded) return <g>{children}</g>
  return (
    <div className="plant-diagram">
      <svg width="100%" height="100%" viewBox={`0 0 1040 ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
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
  if (!tic401 || !tic411 || !pic401 || !p401 || !p402 || !proc || !xv411 || !xv401 || !xv422 || !pcv401) return null

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
    [58, 'WFI Hot (Waste)'],
    [102, 'Glycol Return'],
    [176, 'Glycol Supply'],
    [190, 'Plant Steam'],
    [216, 'WFI Cold to Users'],
    [242, 'Glycol Return'],
    [298, 'Glycol Supply'],
    [372, 'WFI Cold from Users'],
    [412, 'Plant Steam'],
    [471, 'Plant Condensate']
  ]

  return (
    <Wrap height={600} embedded={embedded}>
      <ClassicBackground w={1040} h={600} />
      <ClassicTitle x={520} y={24} text="3T-8120 WFI Storage Tank and Loop" />

      {/* loop temperature-high switch row */}
      {tahTags.map((t, i) => (
        <ClassicStatusWord key={t} x={400 + i * 110} y={46} tag={t} tripped={tahTripped} />
      ))}

      {/* ===== process piping skeleton ===== */}
      <ClassicPipe d="M95,33 H115 V174" width={1.3} />
      <ClassicPipe d="M115,85 H275 V68 H930" width={1.3} />
      <ClassicPipe d="M190,174 V132 H480 V140" width={1.3} />
      <ClassicPipe d="M530,140 V112 H930" width={1.3} />
      <ClassicPipe d="M530,174 V186 H930" width={1.3} />
      <ClassicPipe d="M183,200 H930" width={1.3} />
      <ClassicPipe d="M550,157 H580 V226 H930" width={1.3} />
      <ClassicPipe d="M580,226 V277 H600" width={1.3} />
      <ClassicPipe d="M640,260 V252 H930" width={1.3} />
      <ClassicPipe d="M640,294 V308 H930" width={1.3} />
      <ClassicPipe d="M125,294 V350 H379" width={1.3} />
      <ClassicPipe d="M400,335 V157 H440" width={1.3} />
      <ClassicPipe d="M125,330 H170 V488 H345" width={1.3} />
      <ClassicPipe d="M371,481 H500 V449 H550" width={1.3} />
      <ClassicPipe d="M170,400 H230 V382 H930" width={1.3} />
      <ClassicPipe d="M461,382 V530" width={1.3} />
      <ClassicPipe d="M550,382 V432" width={1.3} />
      <ClassicPipe d="M660,449 H680 V422 H930" width={1.3} />
      <ClassicPipe d="M630,466 V481 H930" width={1.3} />
      <ClassicPipe d="M115,294 V481 H95" width={1.3} />

      {/* ===== storage tank ===== */}
      <ClassicTank x={55} y={174} w={128} h={120} level={proc.pv} label="" below="Not In Use" belowX={55} />
      <ClassicNamedValue x={205} y={242} tag="3T-8120-LI005" value={`${liters} liter`} bindTag="LIC-401" />
      <ClassicNamedValue x={205} y={278} tag="3T-8120-TIC001" value={`${tic401.pv.toFixed(1)} °C`} bindTag="TIC-401" />

      {/* ===== inlet (hot WFI from still) ===== */}
      <ClassicFlag x={95} y={23} w={82} text="Hot WFI from Still" pointRight={false} />
      <ClassicNamedValue x={10} y={63} tag="3T-8120-TI004" value="101.7 °C" w={78} />
      <ClassicSanitaryValve x={115} y={53} open={xv411.open} tag="XV-411" label="3WFI-8110-YV007" orientation="vertical" labelPosition="right" />
      <ClassicSanitaryValve x={245} y={85} open={xv411.open} tag="XV-411" label="3T-8120-YV006" labelPosition="above" />
      <ClassicNamedValue x={10} y={122} tag="3T-8120-PI047" value="-0.1 psi" w={78} />
      <ClassicSanitaryValve x={115} y={125} open={false} label="3T-8120-YV006" orientation="vertical" labelPosition="right" />
      <ClassicNamedValue x={10} y={155} tag="3T-8120-ZSA007" value="Normal" w={78} />

      {/* ===== heat exchangers ===== */}
      <ClassicHex x={440} y={140} w={110} h={34} label={'WFI Recirc\nTrim Cooler'} />
      <ClassicHex x={600} y={260} w={110} h={34} label={'WFI Recirc\nCooler'} />
      <ClassicHex x={550} y={432} w={110} h={34} label={'WFI Recirc\nSani Htr'} />

      {/* ===== inline control & isolation valves ===== */}
      <ClassicControlValve x={612} y={112} position={appliedPidOutput(tic401)} tag="TIC-401" label="3T-8120-TIC001" />
      <ClassicControlValve x={760} y={252} position={appliedPidOutput(tic411)} tag="TIC-411" label="3T-8120-TIC011" />
      <ClassicControlValve x={725} y={422} position={appliedPidOutput(tic411)} tag="TIC-411" label="3T-8120-TIC011" labelPosition="above" />
      <ClassicControlValve x={273} y={200} position={appliedPidOutput(tic401)} tag="TIC-401" label="3T-8120-TIC001" />
      <ClassicControlValve x={320} y={382} position={appliedPidOutput(pic401)} tag="PIC-401" label="3T-8120-PIC016" />
      <ClassicSanitaryValve x={337} y={200} open={xv401.open} tag="XV-401" label="3T-8120-YV001A" labelPosition="above" />
      <ClassicSanitaryValve x={830} y={422} open={pcv401.open} tag="PCV-401" label="3T-8120-YV011A" labelPosition="above" />
      <ClassicSanitaryValve x={461} y={402} open={xv422.open} tag="XV-422" label="3T-8120-YV014" orientation="vertical" labelPosition="right" />
      <ClassicHandValve x={170} y={370} label="3T-8120-YV009" orientation="vertical" labelPosition="right" />

      {/* ===== recirculation pumps ===== */}
      <ClassicPump x={390} y={350} running={p401.running} tag="P-401" label="3T-8120-XC002" labelPosition="right" />
      <ClassicPump x={356} y={488} running={p402.running} tag="P-402" label="3T-8120-XC010" labelPosition="left" discharge="right" />

      {/* ===== indicator value boxes ===== */}
      <ClassicNamedValue x={410} y={285} tag="3T-8120-FI003" value="49.4 GPM" />
      <ClassicNamedValue x={455} y={221} tag="3T-8120-ZSA017" value="Normal" w={80} />
      <ClassicNamedValue x={455} y={254} tag="3T-8120-TIC011" value={`${tic411.pv.toFixed(1)} °C`} bindTag="TIC-411" />
      <ClassicNamedValue x={560} y={359} tag="3T-8120-TI013" value={returnTemp} bindTag="TI-402" />
      <ClassicNamedValue x={665} y={359} tag="3T-8120-FI012" value="35.8 GPM" />

      {/* ===== live PID faceplate dynamos ===== */}
      <ClassicPidBox tag="TIC-401" label="3T-8120-TIC001" x={295} y={75} />
      <ClassicPidBox tag="PIC-401" label="3T-8120-PIC016" x={220} y={415} />
      <ClassicPidBox tag="TIC-411" label="3T-8120-TIC011" x={785} y={326} />

      {/* ===== analytics (TOC + conductivity) ===== */}
      <ClassicNamedValue x={360} y={432} tag="3T-8120-AI015A" value={tocVal} bindTag="AT-402" w={80} />
      <ClassicNamedValue x={360} y={463} tag="3T-8120-AI015B" value={condVal} bindTag="AT-401" w={80} />
      <ClassicNamedValue x={490} y={495} tag="3T-8120-XA015" value="Normal" w={80} />

      {/* ===== WFI level control + product-water drain ===== */}
      <ClassicNamedValue x={590} y={503} tag="WFI-LVL-CTRL" value="Not Filling" w={92} />
      <polygon points="456,526 466,526 461,536" fill={PALE_BORDER} />
      <ClassicLabel x={461} y={550} text="PW" />

      {/* ===== Sani Schedule panel ===== */}
      <ClassicPanel
        x={720}
        y={495}
        w={190}
        h={85}
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
        <ClassicFlag key={i} x={930} y={fy + 3} w={90} h={14} text={ft} />
      ))}
      <ClassicFlag x={95} y={471} w={82} text="Plant Condensate" pointRight={false} />

      {/* ===== bottom navigation ===== */}
      <ClassicNavButton x={55} y={525} w={104} text={'N1BP WFI Tank\nand Loop'} />
      <ClassicNavButton x={167} y={525} w={92} text="WFI STILL" />
      <ClassicNavButton x={267} y={525} w={104} text={'WFI STILL\nComms'} />
      <ClassicNavButton x={575} y={525} w={104} text={'N3 WFI Tank\nand Loop'} />
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
      <ClassicPipe d={`M${offsetX + 40},130 V144 H${offsetX + 20} V170 H${offsetX + 29}`} />
      <ClassicPump x={offsetX + 40} y={170} running={p.running} tag={p.tag} discharge="right" />
      <ClassicPipe d={`M${offsetX + 55},163 H${offsetX + 70} V210 H${offsetX + 140}`} />
      <ClassicValve x={offsetX + 140} y={210} open={xvS.open} tag={xvS.tag} />
      <ClassicLabel x={offsetX + 140} y={252} text="SUPPLY" anchor="middle" />
      <ClassicPipe d={`M${offsetX},60 H${offsetX - 20} V210 H${offsetX + 20}`} />
      <ClassicValve x={offsetX - 20} y={130} open={xvR.open} tag={xvR.tag} orientation="vertical" />
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
      <ClassicPipe d={`M${offsetX + 70},100 V110 H${offsetX + 50} V130 H${offsetX + 59}`} />
      <ClassicPump x={offsetX + 70} y={130} running={p.running} tag={p.tag} discharge="right" />
      <ClassicPipe d={`M${offsetX + 85},123 H${offsetX + 100} V170 H${offsetX + 70}`} />
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
