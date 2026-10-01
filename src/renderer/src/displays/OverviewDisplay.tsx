import { useStore } from '../engine/store'
import { Tank, Pump, GateValve, ControlValve, Pipe, FlowDot, Label } from '../components/Graphics'
import { ValueBox } from '../components/ValueBox'
import type { PidModule, MotorModule, ValveModule } from '../engine/types'

export function OverviewDisplay(): JSX.Element {
  const modules = useStore((s) => s.modules)
  const proc = useStore((s) => s.process)

  const fic = modules['FIC-101'] as PidModule
  const lic201 = modules['LIC-201'] as PidModule
  const tic = modules['TIC-201'] as PidModule
  const pic = modules['PIC-301'] as PidModule
  const p101 = modules['P-101'] as MotorModule
  const p201 = modules['P-201'] as MotorModule
  const xv101 = modules['XV-101'] as ValveModule
  const xv201 = modules['XV-201'] as ValveModule

  const feedActive = p101.running && xv101.open
  const prodActive = p201.running

  return (
    <div className="display" style={{ background: 'radial-gradient(circle at 40% 20%, #d9dde2, #c6cbd1)' }}>
      <div className="display-title">PLANT OVERVIEW — Continuous Reactor Train</div>

      <svg width={1060} height={600} style={{ display: 'block', margin: '0 auto' }}>
        {/* ---------------- Piping ---------------- */}
        {/* Feed supply -> feed valve -> feed tank */}
        <Pipe d="M40,150 H150" active={feedActive} />
        <Pipe d="M170,150 H250" active={feedActive} />
        {/* feed tank bottom -> P-101 -> reactor */}
        <Pipe d="M250,300 V360 H330" active={feedActive} />
        <Pipe d="M370,360 H470 V250" active={feedActive} />
        {/* reactor bottom -> P-201 -> header */}
        <Pipe d="M540,430 V470 H640" active={prodActive} />
        <Pipe d="M680,470 H820 V250" active={prodActive} />
        {/* header out */}
        <Pipe d="M820,150 H1010" active={prodActive} />
        {/* steam to reactor */}
        <Pipe d="M470,120 H540" active width={4} />

        {feedActive && <FlowDot path="M40,150 H150" active />}
        {prodActive && <FlowDot path="M680,470 H820 V250" active />}

        {/* ---------------- Equipment ---------------- */}
        <Tank x={200} y={120} w={100} h={180} level={proc.feedTankLevel} label="TK-101 FEED" />
        <Tank
          x={470}
          y={250}
          w={120}
          h={180}
          level={proc.reactorLevel}
          label="TK-201 REACTOR"
          liquidColor="#8a5a2b"
        />
        {/* reactor steam jacket indicator */}
        <rect x={462} y={258} width={8} height={164} rx={3} fill="var(--dv-steam)" opacity={0.25 + (tic.out / 100) * 0.6} />
        <Label x={445} y={250} text="STM" anchor="end" />

        {/* product header vessel */}
        <rect x={820} y={120} width={60} height={160} rx={6} fill="#eef1f4" stroke="var(--dv-metal)" strokeWidth={2} />
        <text x={850} y={112} fill="var(--dv-text)" fontSize={12} fontWeight={700} textAnchor="middle">
          HDR-301
        </text>

        <ControlValve x={160} y={150} position={fic.out} tag="FIC-101" />
        <GateValve x={250} y={150} open={xv101.open} tag="XV-101" interlock={xv101.interlock} />
        <Pump x={350} y={360} running={p101.running} tag="P-101" />
        <Pump x={660} y={470} running={p201.running} tag="P-201" />
        <GateValve x={530} y={120} open={xv201.open} tag="XV-201" interlock={xv201.interlock} />
        <ControlValve x={820} y={200} position={pic.out} tag="PIC-301" />

        <Label x={95} y={145} text="FEED" anchor="middle" />
        <Label x={1000} y={145} text="PRODUCT" anchor="middle" />
      </svg>

      {/* ---------------- Dynamo value boxes ---------------- */}
      <ValueBox tag="FIC-101" x={120} y={60} />
      <ValueBox tag="LIC-101" x={312} y={150} />
      <ValueBox tag="TI-101" x={120} y={200} />
      <ValueBox tag="LIC-201" x={600} y={250} />
      <ValueBox tag="TIC-201" x={600} y={310} />
      <ValueBox tag="AT-301" x={905} y={300} />
      <ValueBox tag="PIC-301" x={905} y={150} />
      <ValueBox tag="LSH-101" x={312} y={110} />
    </div>
  )
}
