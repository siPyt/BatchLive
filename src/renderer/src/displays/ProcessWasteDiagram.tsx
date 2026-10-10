import type { ReactNode } from 'react'
import { useStore } from '../engine/store'
import {
  ClassicBackground,
  ClassicPipe,
  ClassicLabel,
  ClassicTank,
  ClassicPump,
  ClassicControlValve,
  ClassicHandValve,
  ClassicFlag,
  ClassicReadout,
  ClassicPidBox,
  ClassicNamedValue,
  ClassicPanel,
  ClassicTitle,
  PALE_BORDER,
  PALE_TEXT
} from '../components/ClassicGraphics'
import { pidIo } from '../engine/analogStrategy'
import { processWasteComplete, processWasteFlows } from '../engine/processWaste'
import { readModuleValue } from '../engine/fb'
import type { AnalogIndicator, DiscreteInput, MotorModule, PidModule, ValveModule } from '../engine/types'

/** Process Waste Neutralization (3WT-0001) P&ID mimic, in the same visual
 * language as the GMP pharma area pictures (ClassicGraphics symbols). Standalone
 * mode fits the operator working area; `embedded` mode renders a bare <g> for
 * placement on the shared master plant canvas. */
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

/** Small acid/base metering (dosing) drum with a pump head on its roof. The
 * pump animates green while the pH controller is dosing in that direction. */
function DosingDrum({ x, y, label, dosing }: { x: number; y: number; label: string; dosing: boolean }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={56} height={70} rx={4} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={1.8} />
      <rect x={x + 6} y={y + 14} width={44} height={52} fill="#eef2f5" stroke={PALE_BORDER} strokeWidth={0.6} />
      <circle cx={x + 28} cy={y - 10} r={8} fill={dosing ? '#3f8f32' : '#5b6b78'} stroke={PALE_BORDER} strokeWidth={1.2} />
      <text x={x + 28} y={y + 44} fill={PALE_TEXT} fontSize={10} fontWeight={700} textAnchor="middle">{label}</text>
    </g>
  )
}

const PW_TAGS = [
  '3WT-0001-AIC002',
  '3WT-0001-LI001',
  '3WT-0001-LI002',
  '3WT-0001-AI001',
  '3WT-0001-AI02AVG',
  '3WT-0001-TI001',
  '3WT-0001-P01',
  '3WT-0001-P02',
  '3WT-0001-XV01',
  '3WT-0001-XV05',
  '3WT-0001-XV010',
  '3CIP-3200-XV025',
  '3WT-0001-LAHH001',
  '3WT-0001-LAHH002',
  '3WT-0001-LAL001',
  '3WT-0001-LAL002'
]

export function ProcessWasteDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  const time = useStore((s) => s.time)
  const missingTags = PW_TAGS.filter((tag) => !modules[tag])
  if (missingTags.length || !processWasteComplete(modules)) {
    const message = `Process Waste Neutralization picture is unavailable. Required modules missing: ${missingTags.join(', ') || 'one or more have the wrong type'}.`
    if (embedded) return <text x={20} y={40} fill={PALE_TEXT} fontSize={12}>{message}</text>
    return <div className="graphic-empty" role="status">{message} Use DeltaV Explorer to configure the 3WT-0001 modules.</div>
  }

  const aic = modules['3WT-0001-AIC002'] as PidModule
  const li001 = modules['3WT-0001-LI001'] as AnalogIndicator
  const li002 = modules['3WT-0001-LI002'] as AnalogIndicator
  const p01 = modules['3WT-0001-P01'] as MotorModule
  const p02 = modules['3WT-0001-P02'] as MotorModule
  const xv01 = modules['3WT-0001-XV01'] as ValveModule
  const xv010 = modules['3WT-0001-XV010'] as ValveModule
  const xv025 = modules['3CIP-3200-XV025'] as ValveModule
  const xv05 = modules['3WT-0001-XV05'] as ValveModule
  const lal001 = modules['3WT-0001-LAL001'] as DiscreteInput
  const lal002 = modules['3WT-0001-LAL002'] as DiscreteInput

  // AIC002 split range: AO1 doses acid (high pH), AO2 doses base (low pH). An empty drum delivers nothing.
  const io = pidIo(aic)
  const dosingAcid = !lal002.state && io.ao.out > 1
  const dosingBase = !lal001.state && (io.ao2?.out ?? 0) > 1

  const flows = processWasteFlows(modules, time)
  const flow001 = flows.transfer > 0 ? 'Flow' : 'No Flow'
  const flow002 = flows.drain > 0 ? 'Flow' : 'No Flow'
  const high = (tag: string): string => readModuleValue(modules[tag]) !== 0 ? 'High' : 'Normal'

  return (
    <Wrap height={560} embedded={embedded}>
      <ClassicBackground w={1040} h={560} />
      <ClassicTitle x={520} y={28} text="Process Waste Neutralization" />

      {/* ===== inlet sources ===== */}
      <ClassicFlag x={40} y={70} w={78} text="N3026 PW" />
      <ClassicFlag x={40} y={120} w={78} text="3CIP-3200" />
      <ClassicPipe d="M128,80 H215 V250" width={1.3} />
      <ClassicPipe d="M128,130 H70 V250" width={1.3} />
      <ClassicHandValve x={70} y={250} open={xv025.open} tag="3CIP-3200-XV025" label="3CIP-3200-XV025" orientation="vertical" labelPosition="right" />
      <ClassicHandValve x={215} y={250} open={xv010.open} tag="3WT-0001-XV010" label="3WT-0001-XV010" orientation="vertical" labelPosition="right" />
      <ClassicPipe d="M70,270 V290 H144 V300" width={1.3} />
      <ClassicPipe d="M215,270 V290 H144" width={1.3} />

      {/* ===== equalization tank ===== */}
      <ClassicTank x={78} y={300} w={132} h={120} level={li001.pv} label="" />
      <ClassicLabel x={144} y={388} text="Equalization" />
      <ClassicReadout tag="3WT-0001-LI001" x={224} y={316} />
      <ClassicNamedValue x={224} y={372} tag="3WT-0001-LAHH001" value={high('3WT-0001-LAHH001')} />

      {/* ===== equalization transfer pump + discharge valve ===== */}
      <ClassicPipe d="M144,420 V448 H330" width={1.3} />
      <ClassicPump x={360} y={448} running={p01.running} tag="3WT-0001-P01" />
      <ClassicNamedValue x={312} y={506} tag="3WT-0001-FAL001" value={flow001} />
      <ClassicPipe d="M373,440 V392 H430" width={1.3} />
      <ClassicControlValve x={430} y={392} position={xv01.open ? 100 : 0} tag="3WT-0001-XV01" labelPosition="above" />
      <ClassicPipe d="M446,392 H610 V430" width={1.3} />

      {/* ===== neutralization (treatment) tank ===== */}
      <ClassicTank x={540} y={300} w={150} h={140} level={li002.pv} label="" />
      <ClassicLabel x={615} y={398} text="Neutralization" />
      <ClassicPump x={596} y={300} running={p02.running} tag="3WT-0001-P02" discharge="up" labelPosition="left" />
      <ClassicReadout tag="3WT-0001-LI002" x={704} y={312} />
      <ClassicNamedValue x={704} y={372} tag="3WT-0001-LAHH002" value={high('3WT-0001-LAHH002')} />
      <ClassicReadout tag="3WT-0001-AI02AVG" x={704} y={404} />

      {/* ===== pH control + acid/base dosing ===== */}
      <ClassicPidBox tag="3WT-0001-AIC002" x={812} y={300} label="3WT-0001-AIC002" />
      <ClassicNamedValue x={812} y={370} tag="Ramp Mod" value="3WT-0001-AI02RMP" w={116} />
      <DosingDrum x={820} y={430} label="Base" dosing={dosingBase} />
      <DosingDrum x={916} y={430} label="Acid" dosing={dosingAcid} />
      <ClassicPipe d="M848,420 V430" width={1.1} />
      <ClassicPipe d="M944,420 V430" width={1.1} />
      <ClassicNamedValue x={808} y={512} tag="3WT-0001-LAL001" value={lal001.state ? 'Low' : 'Normal'} w={80} />
      <ClassicNamedValue x={908} y={512} tag="3WT-0001-LAL002" value={lal002.state ? 'Low' : 'Normal'} w={80} />
      <ClassicPipe d="M848,340 H812" width={1.1} />
      <ClassicPipe d="M944,340 H936 V300 H690" width={1.1} />

      {/* ===== discharge to drain ===== */}
      <ClassicPipe d="M690,360 H760 V150 H800" width={1.3} />
      <ClassicControlValve x={820} y={150} position={xv05.open ? 100 : 0} tag="3WT-0001-XV05" labelPosition="above" />
      <ClassicPipe d="M836,150 H920" width={1.3} />
      <ClassicFlag x={922} y={140} w={64} text="Drain" />
      <ClassicReadout tag="3WT-0001-AI001" x={620} y={74} />
      <ClassicReadout tag="3WT-0001-TI001" x={724} y={74} />
      <ClassicNamedValue x={776} y={178} tag="3WT-0001-FAL002" value={flow002} />

      {/* ===== phase / equipment-module status ===== */}
      <ClassicPanel
        x={40}
        y={470}
        w={210}
        h={74}
        title="3WT-0001-NEUT"
        rows={[
          ['State', 'HOLD'],
          ['Message', 'Holding Due to Operator Request']
        ]}
      />
    </Wrap>
  )
}
