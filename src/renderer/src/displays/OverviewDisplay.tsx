import { useRef } from 'react'
import { useStore } from '../engine/store'
import {
  Tank,
  Pump,
  GateValve,
  ControlValve,
  Pipe,
  Chevron,
  Label,
  InstrumentTap,
  PermissiveFlag,
  OffPageArrow,
  AgitatorDrive
} from '../components/Graphics'
import { DeltaVCanvas, type DeltaVCanvasHandle } from '../components/DeltaVCanvas'
import { ValueBox } from '../components/ValueBox'
import { durationString } from '../utils/format'
import type { PidModule, MotorModule, ValveModule } from '../engine/types'
import { WfiDiagram, AutoclaveDiagram, LyoDiagram, CipDiagram, TcuDiagram } from './PharmaDiagrams'

/** World-space origins for each plant area on the one shared coordinate
 * plane — a DCS spatial canvas, not stacked HTML page sections. */
const AREAS = {
  REACTOR: { x: 0, y: 0, cx: 530, cy: 150, scale: 0.9 },
  WFI: { x: 0, y: 700, cx: 520, cy: 880, scale: 0.85 },
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

  const feedActive = p101.running && xv101.open
  const prodActive = p201.running

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
          {/* ---------------- Piping ---------------- */}
          {/* Feed supply -> FIC-101 -> XV-101 -> top inlet nozzle of TK-101 */}
          <Pipe d="M40,70 H110" active={feedActive} />
          <Pipe d="M110,70 H180" active={feedActive} />
          <Pipe d="M180,70 H260" active={feedActive} />
          <Pipe d="M260,70 V120" active={feedActive} />
          {/* feed tank bottom nozzle -> P-101 suction (enters bottom, never the side) -> discharge spout -> reactor top roof nozzle */}
          <Pipe d="M250,300 V378 H350" active={feedActive} />
          <Pipe d="M337,336 V300 H500 V250" active={feedActive} />
          {/* reactor bottom nozzle -> P-201 suction (enters bottom) -> discharge spout -> header side nozzle */}
          <Pipe d="M530,430 V488 H660" active={prodActive} />
          <Pipe d="M647,446 H880 V250" active={prodActive} />
          {/* header overhead product outlet (starts at the vessel's own wall, not through its body) */}
          <Pipe d="M880,150 H1010" active={prodActive} />
          {/* steam header (full module span, off-sheet both ends) -> XV-201 -> jacket top utility connection */}
          <Pipe d="M40,40 H1010" active width={3} />
          <Pipe d="M462,40 V258" active width={4} />
          {/* jacket bottom drain -> off-sheet condensate return */}
          <Pipe d="M480,438 V480 H390" width={3} />
          {/* reactor headspace roof nozzle -> PSV-201 -> relief vent off-sheet */}
          <Pipe d="M530,250 V196" width={3} />
          {/* reactor headspace relief vent -> off-sheet, offset clear of the batch header card */}
          <Pipe d="M530,170 V140" width={3} />

          <OffPageArrow x={1010} y={40} angle={0} />
          <Label x={1005} y={27} text="TO UNIT 300" anchor="end" />
          <OffPageArrow x={390} y={480} angle={180} />
          <Label x={385} y={470} text="TO COND RETURN" anchor="end" />

          {feedActive && (
            <>
              <Chevron x={65} y={70} angle={0} />
              <Chevron x={260} y={95} angle={90} />
              <Chevron x={350} y={368} angle={90} />
              <Chevron x={420} y={300} angle={0} />
            </>
          )}
          {prodActive && (
            <>
              <Chevron x={660} y={478} angle={90} />
              <Chevron x={760} y={446} angle={0} />
              <Chevron x={880} y={360} angle={-90} />
            </>
          )}

          {/* ---------------- Equipment ---------------- */}
          <Tank x={200} y={120} w={100} h={180} level={proc.feedTankLevel} label="TK-101 FEED" />
          <Tank x={470} y={250} w={120} h={180} level={proc.reactorLevel} label="TK-201 REACTOR" />
          {/* reactor jacket: neutral structural shell wrapping both sides + bottom head (never an alarm color) */}
          <path
            d="M462,258 V430 Q462,438 470,438 H590 Q598,438 598,430 V258"
            fill="none"
            stroke="var(--dv-jacket-line)"
            strokeWidth={2}
            strokeDasharray="3,2"
          />
          <Label x={455} y={255} text="JACKET" anchor="end" />
          {/* headspace safety relief valve, centered on the roof nozzle */}
          <GateValve x={530} y={185} open={psv201.open} tag="PSV-201" interlock={psv201.interlock} />
          <OffPageArrow x={530} y={125} angle={-90} />
          <Label x={545} y={120} text="TO FLARE" anchor="start" />
          {/* agitator drive mounted on the vessel roof, clear of the centerline relief nozzle */}
          <AgitatorDrive x={560} y={250} running={sic201.pv > 1} tag="SIC-201" />
          {/* dashed ISA-5.1 signal leaders: dynamo edge -> dogleg clear of the relief valve -> motor housing center */}
          <path d="M412,-91 H560 V239" stroke="#555555" strokeDasharray="4,3" strokeWidth={1.2} fill="none" />
          <path d="M412,-37 H560 V239" stroke="#555555" strokeDasharray="4,3" strokeWidth={1.2} fill="none" />
          {/* batch header card: top-center in the clear gray space above everything else (pipes, dynamos, agitator) */}
          <BatchStatusCard x={420} y={-170} w={220} batch={batch} />

          {/* product header vessel */}
          <rect x={820} y={120} width={60} height={160} rx={6} fill="var(--dv-panel-2)" stroke="var(--dv-border-light)" strokeWidth={2} />
          <text x={850} y={112} fill="var(--dv-text)" fontSize={12} fontWeight={700} textAnchor="middle">
            HDR-301
          </text>

          <ControlValve x={110} y={70} position={fic.out} tag="FIC-101" />
          <GateValve x={180} y={70} open={xv101.open} tag="XV-101" interlock={xv101.interlock} />
          <Pump x={350} y={360} running={p101.running} tag="P-101" orientation="left" />
          <PermissiveFlag x={400} y={360} ok={p101.permissiveOk} />
          <Pump x={660} y={470} running={p201.running} tag="P-201" orientation="left" />
          <PermissiveFlag x={715} y={470} ok={p201.permissiveOk} />
          <GateValve x={462} y={40} open={xv201.open} tag="XV-201" interlock={xv201.interlock} />
          <ControlValve x={880} y={366} position={pic.out} tag="PIC-301" />

          {/* ---------------- Instrument taps / signal leaders ---------------- */}
          <InstrumentTap tapX={75} tapY={70} toX={75} toY={-34} />
          <InstrumentTap tapX={220} tapY={70} toX={220} toY={-34} />
          <InstrumentTap tapX={300} tapY={160} toX={330} toY={160} />
          <InstrumentTap tapX={300} tapY={210} toX={330} toY={210} />
          <InstrumentTap tapX={900} tapY={150} toX={905} toY={178} />
          <InstrumentTap tapX={590} tapY={370} toX={600} toY={385} />

          <Label x={20} y={64} text="FEED" anchor="start" />
          <Label x={55} y={64} text={'2"-PR-316L'} anchor="start" />
          <Label x={450} y={32} text={'1"-STM-50#'} anchor="start" />
          <Label x={1000} y={145} text="PRODUCT" anchor="middle" />

          {/* ---------------- Dynamo value boxes ---------------- */}
          {/* FIC-101 / TI-101: lifted into the whitespace above the steam header so the pipe stays unbroken */}
          <ValueBox tag="FIC-101" x={20} y={-70} svg />
          <ValueBox tag="LIC-101" x={335} y={195} svg />
          <ValueBox tag="TI-101" x={150} y={-70} svg />
          <ValueBox tag="LIC-201" x={600} y={250} svg />
          <ValueBox tag="TIC-201" x={600} y={310} svg />
          <ValueBox tag="AT-301" x={905} y={178} svg />
          <ValueBox tag="PIC-301" x={940} y={361} svg />
          <ValueBox tag="LSH-101" x={335} y={140} svg />
          <ValueBox tag="PT-201" x={600} y={370} svg />
          {/* agitator instruments: stacked in clear whitespace left of the batch card, wired to the motor with dashed leaders */}
          <text x={300} y={-120} fill="var(--dv-text-mute)" fontSize={10} fontWeight={700} letterSpacing={0.5}>
            AGITATOR DRIVE
          </text>
          <ValueBox tag="SIC-201" x={300} y={-114} svg />
          <ValueBox tag="II-201" x={300} y={-60} svg />
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
      <rect x={x} y={y} width={w} height={32} rx={3} fill="var(--dv-faceplate-header, #3a434c)" />
      <text x={x + w / 2} y={y + 12} fill="#ffffff" fontSize={9} fontWeight={800} textAnchor="middle" letterSpacing={0.4}>
        BATCH {batch.id} · {batch.status} · {batch.recipe}
      </text>
      <text x={x + w / 2} y={y + 24} fill="#cfd4da" fontSize={8} textAnchor="middle">
        {line2}
      </text>
    </g>
  )
}
