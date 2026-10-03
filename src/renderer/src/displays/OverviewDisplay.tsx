import { useRef } from 'react'
import { useStore } from '../engine/store'
import { InstrumentTap } from '../components/Graphics'
import {
  ClassicTank,
  ClassicPump,
  ClassicValve,
  ClassicControlValve,
  ClassicPipe,
  ClassicLabel,
  ClassicPermissiveFlag,
  ClassicFlag,
  ClassicAgitatorDrive,
  ClassicReadout,
  ClassicVessel,
  PALE_BORDER,
  PALE_BG
} from '../components/ClassicGraphics'
import { DeltaVCanvas, type DeltaVCanvasHandle } from '../components/DeltaVCanvas'
import { durationString } from '../utils/format'
import type { PidModule, MotorModule, ValveModule } from '../engine/types'
import { WfiDiagram, AutoclaveDiagram, LyoDiagram, CipDiagram, TcuDiagram } from './PharmaDiagrams'

/** World-space origins for each plant area on the one shared coordinate
 * plane — a DCS spatial canvas, not stacked HTML page sections. */
const AREAS = {
  REACTOR: { x: 0, y: 0, cx: 530, cy: 150, scale: 0.9 },
  WFI: { x: 0, y: 700, cx: 520, cy: 1000, scale: 0.85 },
  AUTOCLAVE: { x: 1150, y: 0, cx: 1670, cy: 120, scale: 1 },
  LYO: { x: 1150, y: 320, cx: 1670, cy: 435, scale: 1 },
  CIP: { x: 1150, y: 600, cx: 1670, cy: 740, scale: 0.9 },
  TCU: { x: 1150, y: 920, cx: 1670, cy: 1035, scale: 1 },
  OVERVIEW: { x: 0, y: 0, cx: 1100, cy: 600, scale: 0.34 }
} as const

export function OverviewDisplay(): JSX.Element {
  const modules = useStore((s) => s.modules)
  const proc = useStore((s) => s.process)
  const batch = useStore((s) => s.batch)
  const canvasRef = useRef<DeltaVCanvasHandle>(null)

  const fic = modules['FIC-101'] as PidModule
  const pic = modules['PIC-301'] as PidModule
  const p101 = modules['P-101'] as MotorModule
  const p201 = modules['P-201'] as MotorModule
  const xv101 = modules['XV-101'] as ValveModule
  const xv201 = modules['XV-201'] as ValveModule
  const psv201 = modules['PSV-201'] as ValveModule
  const sic201 = modules['SIC-201'] as PidModule

  const jump = (area: keyof typeof AREAS): void => {
    const a = AREAS[area]
    canvasRef.current?.jumpTo(a.cx, a.cy, a.scale)
  }

  return (
    <div className="display" style={{ overflow: 'hidden', padding: 0 }}>
      <div className="dv-area-jumpbar">
        <span className="dv-area-jumpbar-title">PLANT OVERVIEW</span>
        {(['OVERVIEW', 'REACTOR', 'WFI', 'AUTOCLAVE', 'LYO', 'CIP', 'TCU'] as const).map((a) => (
          <button key={a} className="tbtn sm" onClick={() => jump(a)}>
            {a}
          </button>
        ))}
      </div>

      {/* The entire plant lives on one continuous world-space coordinate
       * plane inside a single DeltaVCanvas — every area is just a <g>
       * translated to its own X/Y origin, not a separate HTML page section. */}
      <DeltaVCanvas ref={canvasRef} initialX={AREAS.REACTOR.x + 40} initialY={AREAS.REACTOR.y + 173} initialScale={0.9}>
        {/* ================= REACTOR TRAIN ================= */}
        <g transform={`translate(${AREAS.REACTOR.x}, ${AREAS.REACTOR.y})`}>
          {/* pale area card so the reactor matches the pharma areas' background */}
          <rect x={-30} y={-190} width={1150} height={710} fill={PALE_BG} />
          {/* ---------------- Piping ---------------- */}
          {/* Feed supply -> FIC-101 -> XV-101 -> top inlet nozzle of TK-101 */}
          <ClassicPipe d="M40,70 H110" />
          <ClassicPipe d="M110,70 H180" />
          <ClassicPipe d="M180,70 H260" />
          <ClassicPipe d="M260,70 V120" />
          {/* vessel bottom nozzles -> pump hubs -> tangential outlets */}
          <ClassicPipe d="M250,300 V360 H339" />
          <ClassicPipe d="M360,345 V300 H500 V250" />
          <ClassicPipe d="M530,430 V470 H649" />
          <ClassicPipe d="M670,455 H880 V250" />
          {/* header overhead product outlet (starts at the vessel's own wall, not through its body) */}
          <ClassicPipe d="M880,150 H1010" />
          {/* steam header (full module span, off-sheet both ends) -> XV-201 -> jacket top utility connection */}
          <ClassicPipe d="M40,40 H1010" width={3} />
          <ClassicPipe d="M462,40 V258" width={4} />
          {/* jacket bottom drain -> off-sheet condensate return */}
          <ClassicPipe d="M480,438 V480 H390" width={3} />
          {/* reactor headspace roof nozzle -> PSV-201 -> relief vent off-sheet */}
          <ClassicPipe d="M530,250 V196" width={3} />
          {/* reactor headspace relief vent -> off-sheet, offset clear of the batch header card */}
          <ClassicPipe d="M530,170 V140" width={3} />

          <ClassicFlag x={1010} y={30} w={60} text="To Unit 300" />
          <ClassicFlag x={390} y={470} w={60} text="To Cond Return" pointRight={false} />

          {/* ---------------- Equipment ---------------- */}
          <ClassicTank x={200} y={120} w={100} h={180} level={proc.feedTankLevel} label="TK-101 FEED" />
          <ClassicTank x={470} y={250} w={120} h={180} level={proc.reactorLevel} label="TK-201 REACTOR" />
          {/* reactor jacket: neutral structural shell wrapping both sides + bottom head (never an alarm color) */}
          <path
            d="M462,258 V430 Q462,438 470,438 H590 Q598,438 598,430 V258"
            fill="none"
            stroke={PALE_BORDER}
            strokeWidth={2}
            strokeDasharray="3,2"
          />
          <ClassicLabel x={455} y={255} text="JACKET" anchor="end" />
          {/* headspace safety relief valve, centered on the roof nozzle */}
          <ClassicValve x={530} y={185} open={psv201.open} tag="PSV-201" orientation="vertical" />
          <ClassicFlag x={530} y={115} w={60} text="To Flare" pointRight={false} />
          {/* agitator drive mounted on the vessel roof, clear of the centerline relief nozzle */}
          <ClassicAgitatorDrive x={560} y={250} running={sic201.pv > 1} tag="SIC-201" />
          {/* dashed ISA-5.1 signal leaders: dynamo edge -> dogleg clear of the relief valve -> motor housing center */}
          <path d="M412,-91 H560 V239" stroke="#555555" strokeDasharray="4,3" strokeWidth={1.2} fill="none" />
          <path d="M412,-37 H560 V239" stroke="#555555" strokeDasharray="4,3" strokeWidth={1.2} fill="none" />
          {/* batch header card: top-center in the clear gray space above everything else (pipes, dynamos, agitator) */}
          <BatchStatusCard x={420} y={-170} w={220} batch={batch} />

          {/* product header vessel */}
          <ClassicVessel x={820} y={120} w={60} h={160} />
          <ClassicLabel x={850} y={112} text="HDR-301" />

          <ClassicControlValve x={110} y={70} position={fic.out} tag="FIC-101" />
          <ClassicValve x={180} y={70} open={xv101.open} tag="XV-101" />
          <ClassicPump x={350} y={360} running={p101.running} tag="P-101" />
          <ClassicPermissiveFlag x={400} y={360} ok={p101.permissiveOk} />
          <ClassicPump x={660} y={470} running={p201.running} tag="P-201" />
          <ClassicPermissiveFlag x={715} y={470} ok={p201.permissiveOk} />
          <ClassicValve x={462} y={40} open={xv201.open} tag="XV-201" />
          <ClassicControlValve x={880} y={366} position={pic.out} tag="PIC-301" />

          {/* ---------------- Instrument taps / signal leaders ---------------- */}
          <InstrumentTap tapX={75} tapY={70} toX={75} toY={-34} />
          <InstrumentTap tapX={220} tapY={70} toX={220} toY={-34} />
          <InstrumentTap tapX={300} tapY={160} toX={330} toY={160} />
          <InstrumentTap tapX={300} tapY={210} toX={330} toY={210} />
          <InstrumentTap tapX={900} tapY={150} toX={905} toY={178} />
          <InstrumentTap tapX={590} tapY={370} toX={600} toY={385} />

          <ClassicLabel x={20} y={64} text="FEED" anchor="start" />
          <ClassicLabel x={55} y={64} text={'2"-PR-316L'} anchor="start" />
          <ClassicLabel x={450} y={32} text={'1"-STM-50#'} anchor="start" />
          <ClassicLabel x={1000} y={145} text="PRODUCT" anchor="middle" />

          {/* ---------------- Dynamo value boxes ---------------- */}
          {/* FIC-101 / TI-101: lifted into the whitespace above the steam header so the pipe stays unbroken */}
          <ClassicReadout tag="FIC-101" x={20} y={-70} />
          <ClassicReadout tag="LIC-101" x={335} y={195} />
          <ClassicReadout tag="TI-101" x={150} y={-70} />
          <ClassicReadout tag="LIC-201" x={600} y={250} />
          <ClassicReadout tag="TIC-201" x={600} y={310} />
          <ClassicReadout tag="AT-301" x={905} y={178} />
          <ClassicReadout tag="PIC-301" x={940} y={361} />
          <ClassicReadout tag="LSH-101" x={335} y={140} />
          <ClassicReadout tag="PT-201" x={600} y={370} />
          {/* agitator instruments: stacked in clear whitespace left of the batch card, wired to the motor with dashed leaders */}
          <text x={300} y={-120} fill="#727b85" fontSize={10} fontWeight={700} letterSpacing={0.5}>
            AGITATOR DRIVE
          </text>
          <ClassicReadout tag="SIC-201" x={300} y={-114} />
          <ClassicReadout tag="II-201" x={300} y={-60} />
        </g>

        {/* ================= OTHER PLANT AREAS — same world, different X/Y origin ================= */}
        <AreaLabel x={AREAS.WFI.x} y={AREAS.WFI.y} text="WFI GENERATION & DISTRIBUTION" />
        <g transform={`translate(${AREAS.WFI.x}, ${AREAS.WFI.y})`}>
          <WfiDiagram embedded />
        </g>

        <AreaLabel x={AREAS.AUTOCLAVE.x} y={AREAS.AUTOCLAVE.y} text="STERILIZATION (AUTOCLAVES)" />
        <g transform={`translate(${AREAS.AUTOCLAVE.x}, ${AREAS.AUTOCLAVE.y})`}>
          <AutoclaveDiagram embedded />
        </g>

        <AreaLabel x={AREAS.LYO.x} y={AREAS.LYO.y} text="LYOPHILIZATION" />
        <g transform={`translate(${AREAS.LYO.x}, ${AREAS.LYO.y})`}>
          <LyoDiagram embedded />
        </g>

        <AreaLabel x={AREAS.CIP.x} y={AREAS.CIP.y} text="CLEAN-IN-PLACE (CIP) SKIDS" />
        <g transform={`translate(${AREAS.CIP.x}, ${AREAS.CIP.y})`}>
          <CipDiagram embedded />
        </g>

        <AreaLabel x={AREAS.TCU.x} y={AREAS.TCU.y} text="TEMPERATURE CONTROL UNITS (TCUs)" />
        <g transform={`translate(${AREAS.TCU.x}, ${AREAS.TCU.y})`}>
          <TcuDiagram embedded />
        </g>
      </DeltaVCanvas>
    </div>
  )
}

function AreaLabel({ x, y, text }: { x: number; y: number; text: string }): JSX.Element {
  return (
    <text x={x} y={y - 8} fill="var(--dv-text-dim)" fontSize={14} fontWeight={700} letterSpacing={0.5}>
      {text}
    </text>
  )
}

/** S88 batch/phase execution header card — native SVG, floating in the clear
 * space above the vessel roof (never touching the tank or any dynamo).
 * Reads real store data (batch id, recipe, active phase/step, elapsed time). */
function BatchStatusCard({ x, y, w, batch }: { x: number; y: number; w: number; batch: ReturnType<typeof useStore.getState>['batch'] }): JSX.Element {
  const line2 = batch.phase ? `${batch.phase.name} (${batch.phase.state}) · ${durationString(batch.phase.elapsed)}` : 'No active phase'
  return (
    <g>
      <rect x={x} y={y} width={w} height={32} rx={3} fill="#eceeef" stroke="#6b7680" strokeWidth={1} />
      <text x={x + w / 2} y={y + 12} fill="#17222b" fontSize={9} fontWeight={800} textAnchor="middle" letterSpacing={0.4}>
        BATCH {batch.id} · {batch.status} · {batch.recipe}
      </text>
      <text x={x + w / 2} y={y + 24} fill="#3a4550" fontSize={8} textAnchor="middle">
        {line2}
      </text>
    </g>
  )
}
