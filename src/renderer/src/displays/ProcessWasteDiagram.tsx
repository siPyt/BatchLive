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
  PALE_PIPE,
  PALE_TEXT
} from '../components/ClassicGraphics'
import { pidIo } from '../engine/analogStrategy'
import { PWASTE_TAGS, PW, processWasteComplete } from '../engine/processWaste'
import { deviceDescriptorLabel } from '../engine/deviceDescriptors'
import type { AnalogIndicator, DiscreteInput, MotorModule, PidModule, ValveModule } from '../engine/types'

/** Process Waste Neutralization (3WT-0001) P&ID mimic, laid out like the plant's N4 overview screen and drawn in the
 * same visual language as the GMP pharma area pictures. Standalone mode fits the operator working area; `embedded`
 * mode renders a bare <g> for placement on the shared master plant canvas. */
const HEIGHT = 620

function Wrap({ children, embedded }: { children: ReactNode; embedded?: boolean }): JSX.Element {
  if (embedded) return <g>{children}</g>
  return (
    <div className="plant-diagram">
      <svg width="100%" height="100%" viewBox={`0 0 1040 ${HEIGHT}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {children}
      </svg>
    </div>
  )
}

/** Chemical metering device on a drum line: green while the pH loop is dosing through it. */
function DosingDevice({ x, y, label, dosing }: { x: number; y: number; label: string; dosing: boolean }): JSX.Element {
  return (
    <g>
      <title>{`${label} dosing: ${dosing ? 'dosing' : 'not dosing'}`}</title>
      <circle cx={x} cy={y} r={7} fill={dosing ? '#3f8f32' : '#2b3137'} stroke={PALE_BORDER} strokeWidth={1.2} />
    </g>
  )
}

function ChemicalDrum({ x, y, label }: { x: number; y: number; label: string }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={48} height={82} rx={5} fill="#dfe6ec" stroke={PALE_BORDER} strokeWidth={1.8} />
      <line x1={x} y1={y + 16} x2={x + 48} y2={y + 16} stroke={PALE_BORDER} strokeWidth={1} />
      <line x1={x} y1={y + 66} x2={x + 48} y2={y + 66} stroke={PALE_BORDER} strokeWidth={1} />
      <text x={x + 24} y={y + 44} fill={PALE_TEXT} fontSize={10} fontWeight={700} textAnchor="middle">{label}</text>
    </g>
  )
}

export function ProcessWasteDiagram({ embedded }: { embedded?: boolean } = {}): JSX.Element | null {
  const modules = useStore((s) => s.modules)
  const namedSets = useStore((s) => s.namedSets)
  if (!processWasteComplete(modules)) {
    const missingTags = PWASTE_TAGS.filter((tag) => !modules[tag])
    const message = `Process Waste Neutralization picture is unavailable. Required modules missing: ${missingTags.join(', ') || 'one or more have the wrong type'}.`
    if (embedded) return <text x={20} y={40} fill={PALE_TEXT} fontSize={12}>{message}</text>
    return <div className="graphic-empty" role="status">{message} Use DeltaV Explorer to configure the 3WT-0001 modules.</div>
  }

  const aic = modules[PW.pid] as PidModule
  const li001 = modules[PW.eqLevel] as AnalogIndicator
  const li002 = modules[PW.neutLevel] as AnalogIndicator
  const p01 = modules[PW.transferPump] as MotorModule
  const p02 = modules[PW.recircPump] as MotorModule
  const xv010 = modules[PW.wasteInlet] as ValveModule
  const xv025 = modules[PW.cipInlet] as ValveModule
  const xv01 = modules[PW.transferValve] as ValveModule
  const xv05 = modules[PW.drainValve] as ValveModule
  const lal001 = modules[PW.baseDrumLow] as DiscreteInput
  const lal002 = modules[PW.acidDrumLow] as DiscreteInput
  const fal001 = modules[PW.transferLowFlow] as DiscreteInput
  const fal002 = modules[PW.drainLowFlow] as DiscreteInput
  const lahh001 = modules['3WT-0001-LAHH001']
  const lahh002 = modules['3WT-0001-LAHH002']

  // AIC002 split range: AO1 doses acid (high pH), AO2 doses base (low pH). An empty drum delivers nothing.
  const io = pidIo(aic)
  const dosingAcid = !lal002.state && io.ao.out > 1
  const dosingBase = !lal001.state && (io.ao2?.out ?? 0) > 1

  const stateOf = (m: ValveModule): string => deviceDescriptorLabel(m, namedSets, 'feedback', m.open).label
  const level = (m: typeof lahh001): string => ('out' in m && m.out !== 0) ? 'High' : 'Normal'

  return (
    <Wrap embedded={embedded}>
      <ClassicBackground w={1040} h={HEIGHT} />
      <ClassicTitle x={520} y={26} text="Process Waste Neutralization" />

      {/* ===== inlet sources: each line enters the equalization tank on its own ===== */}
      <ClassicFlag x={22} y={24} w={76} text="N3026 PW" />
      <ClassicFlag x={22} y={76} w={76} text="3CIP-3200" />
      <ClassicPipe d="M108,34 H154 V240" width={1.3} />
      <ClassicPipe d="M108,86 H112 V240" width={1.3} />
      <ClassicHandValve x={112} y={136} open={xv025.open} tag="3CIP-3200-XV025" label="3CIP-3200-XV025" orientation="vertical" labelPosition="below" />
      <ClassicHandValve x={154} y={196} open={xv010.open} tag="3WT-0001-XV010" label="3WT-0001-XV010" orientation="vertical" labelPosition="below" />

      {/* ===== equalization tank ===== */}
      <ClassicTank x={70} y={236} w={130} h={190} level={li001.pv} label="" />
      <ClassicLabel x={135} y={400} text="Equalization" />
      <ClassicReadout tag={PW.eqLevel} x={214} y={262} />
      <ClassicNamedValue x={214} y={318} tag="3WT-0001-LAHH001" value={level(lahh001)} />

      {/* ===== P01 -> XV01 diverter: RECIRC back to the equalization tank, TRANSFER to the neutralization tank ===== */}
      <ClassicPipe d="M200,382 H316" width={1.3} />
      <ClassicPump x={330} y={382} running={p01.running} tag={PW.transferPump} />
      <ClassicPipe d="M340,367 V221" width={1.3} />
      <ClassicPipe d="M324,205 H176 V240" width={1.3} />
      <ClassicPipe d="M356,205 H514 V343" width={1.3} />
      <ClassicControlValve x={340} y={205} position={xv01.open ? 100 : 0} tag={PW.transferValve} labelPosition="above" stateLabel={stateOf(xv01)} />
      <ClassicLabel x={340} y={236} text={stateOf(xv01)} />
      <ClassicNamedValue x={352} y={292} tag="3WT-0001-FAL001" value={fal001.state ? fal001.activeDescriptor : fal001.inactiveDescriptor} />

      {/* ===== neutralization (treatment) tank, with its P02 loop and XV05 diverter ===== */}
      <ClassicTank x={507} y={330} w={115} h={145} level={li002.pv} label="" />
      <ClassicLabel x={565} y={430} text="Neutralization" />
      <ClassicPump x={565} y={326} running={p02.running} tag={PW.recircPump} discharge="up" labelPosition="left" />
      <ClassicPipe d="M592,343 V126" width={1.3} />
      <ClassicPipe d="M576,126 H532 V343" width={1.3} />
      <ClassicPipe d="M608,126 H884" width={1.3} />
      <ClassicControlValve x={592} y={126} position={xv05.open ? 100 : 0} tag={PW.drainValve} labelPosition="above" stateLabel={stateOf(xv05)} />
      <ClassicLabel x={592} y={157} text={stateOf(xv05)} />
      <ClassicNamedValue x={612} y={172} tag="3WT-0001-FAL002" value={fal002.state ? fal002.activeDescriptor : fal002.inactiveDescriptor} />
      <ClassicFlag x={884} y={116} w={52} text="Drain" />
      <ClassicReadout tag={PW.effluentPh} x={700} y={70} />
      <ClassicReadout tag={PW.effluentTemp} x={806} y={70} />
      <ClassicReadout tag={PW.neutLevel} x={632} y={340} />
      <ClassicNamedValue x={632} y={392} tag="3WT-0001-LAHH002" value={level(lahh002)} />
      <ClassicReadout tag={PW.tankPhAvg} x={632} y={424} />

      {/* ===== pH loop AIC002 and the acid / base metering lines into the neutralization tank ===== */}
      <ClassicPipe d="M772,396 V232 H609 V343" width={1.1} />
      <ClassicPipe d="M863,396 V218 H602 V343" width={1.1} />
      <DosingDevice x={772} y={346} label="Base" dosing={dosingBase} />
      <DosingDevice x={863} y={346} label="Acid" dosing={dosingAcid} />
      <ClassicPidBox tag={PW.pid} x={640} y={240} label="3WT-0001-AIC002" />
      <ClassicNamedValue x={640} y={296} tag="Ramp Mod" value={aic.rampModule ?? ''} w={120} />
      <path d="M700,286 V314 H863 V339 M772,314 V339" fill="none" stroke={PALE_PIPE} strokeWidth={1} strokeDasharray="4 3" />
      <ChemicalDrum x={748} y={396} label="Base" />
      <ChemicalDrum x={839} y={396} label="Acid" />
      <ClassicNamedValue x={732} y={500} tag="3WT-0001-LAL001" value={lal001.state ? lal001.activeDescriptor : lal001.inactiveDescriptor} w={80} />
      <ClassicNamedValue x={823} y={500} tag="3WT-0001-LAL002" value={lal002.state ? lal002.activeDescriptor : lal002.inactiveDescriptor} w={80} />

      {/* ===== NEUT phase: the HOLD state shown on the plant screen (the phase itself is not simulated) ===== */}
      <ClassicPanel
        x={40}
        y={510}
        w={250}
        h={92}
        title="3WT-0001-NEUT"
        rows={[
          ['State', 'HOLD'],
          ['Message', 'Holding Due to Operator Request'],
          ['Wait Time', '0.25 min']
        ]}
        button="Timer"
      />
    </Wrap>
  )
}
