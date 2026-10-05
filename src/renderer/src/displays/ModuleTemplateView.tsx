import type { ReactNode } from 'react'
import { useStore } from '../engine/store'
import type { MotorModule, ValveModule } from '../engine/types'
import { deviceInterlockSignal, devicePermissiveSignal } from '../engine/simulate'

type Device = MotorModule | ValveModule

const ROW = 17
const FRAME = '#414141'
const BODY = '#eceeef'
const HEAD = '#e4e6e7'
const RULE = '#a3a6a8'

const yes = (value: boolean): string => value ? 'True' : 'False'

/** Function block frame: type caption above, instance name in the header, inputs left, outputs right. */
function Block({ x, y, w = 190, type, name, order, left, right, values = {} }: {
  x: number; y: number; w?: number; type: string; name: string; order: number
  left: string[]; right: string[]; values?: Record<string, string>
}): JSX.Element {
  const rows = Math.max(left.length, right.length)
  const h = 24 + rows * ROW + 16
  return <g data-block={name}>
    <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="#222">{type}</text>
    <rect x={x} y={y} width={w} height={h} fill={BODY} stroke={FRAME} />
    <rect x={x} y={y} width={w} height={22} fill={HEAD} stroke={FRAME} />
    <text x={x + w / 2} y={y + 15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#222">{name}</text>
    {Array.from({ length: rows }, (_, index) => <line key={index} x1={x} x2={x + w} y1={y + 22 + (index + 1) * ROW}
      y2={y + 22 + (index + 1) * ROW} stroke={RULE} />)}
    {left.map((pin, index) => <g key={pin}>
      <rect x={x + 3} y={y + 28 + index * ROW} width={7} height={7} fill="#fff" stroke={FRAME} />
      <text x={x + 14} y={y + 35 + index * ROW} fontSize={9} fill="#222">{pin}{values[pin] !== undefined ? ` = ${values[pin]}` : ''}</text>
    </g>)}
    {right.map((pin, index) => <g key={pin}>
      <rect x={x + w - 10} y={y + 28 + index * ROW} width={7} height={7} fill="#fff" stroke={FRAME} />
      <text x={x + w - 14} y={y + 35 + index * ROW} fontSize={9} textAnchor="end" fill="#222">
        {values[pin] !== undefined ? `${values[pin]} = ` : ''}{pin}</text>
    </g>)}
    <text x={x + w - 6} y={y + h - 4} textAnchor="end" fontSize={9} fill="#333">#{order}</text>
  </g>
}

/** Module-level parameter box with the live value to its right. */
function Param({ x, y, w = 150, name, value }: { x: number; y: number; w?: number; name: string; value?: string }): JSX.Element {
  return <g data-parameter={name}>
    <rect x={x} y={y} width={w} height={20} fill="#dcdedf" stroke={FRAME} />
    <text x={x + 8} y={y + 14} fontSize={10} fill="#222">{name}</text>
    <rect x={x + w - 12} y={y + 6} width={7} height={7} fill="#fff" stroke={FRAME} />
    {value !== undefined && <text x={x + w + 8} y={y + 14} fontSize={10} fill="#0b4a8f" fontWeight={700}>{value}</text>}
  </g>
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }): JSX.Element {
  return <section className="tmpl-section" aria-label={title}>
    <h3>{title}{note && <small>{note}</small>}</h3>
    {children}
  </section>
}

export function DiscreteModuleTemplate({ module: m }: { module: Device }): JSX.Element {
  const binding = useStore(s => s.hardware.deviceBindings?.[m.tag])
  const modules = useStore(s => s.modules)
  const valve = m.type === 'VALVE'
  const noun = valve ? 'valve' : 'motor'
  const requested = valve ? (m as ValveModule).commandedOpen : (m as MotorModule).commanded
  const feedback = valve ? (m as ValveModule).open : (m as MotorModule).running
  const activeWord = valve ? 'Open' : 'Running'
  const passiveWord = valve ? 'Closed' : 'Stopped'
  const interlockSignal = deviceInterlockSignal(m, modules)
  const permissiveSignal = devicePermissiveSignal(m, modules)
  const tripped = m.interlock || interlockSignal.value !== 0 || interlockSignal.bad
  const permitted = !m.permissiveRequired || permissiveSignal.value !== 0
  const failure = m.fault || !!m.ioInputBad || !!m.ioOutputBad || m.dcState.startsWith('FAILED')
  const mode = m.commandSource ? 'CAS' : 'MAN'
  const failConditions = [
    m.fault && 'Device fault (transition not confirmed or fault injected)',
    m.ioInputBad && 'Bad feedback input quality',
    m.ioOutputBad && 'Bad command output quality',
    m.dcState.startsWith('FAILED') && `DC_STATE is ${m.dcState}`
  ].filter((entry): entry is string => !!entry)
  const bindingText = binding ? Object.entries(binding).map(([port, dst]) => `${port.toUpperCase()}=${dst}`).join(', ') : ''
  const interlockText = m.interlockSource ? `${m.interlockSource} = ${yes(interlockSignal.value !== 0)}` : 'none wired'
  const permissiveText = m.permissiveSource ? `${m.permissiveSource} = ${yes(permissiveSignal.value !== 0)}` : m.permissiveRequired ? 'forced permissive flag' : 'not required'
  const options: [string, string][] = [
    ['Permissive required', yes(m.permissiveRequired)],
    ['Reset required after trip', yes(m.resetRequired)],
    ['Interlock inverted', yes(!!m.interlockInverted)],
    ['Feedback polarity inverted', yes(!!m.feedbackInverted)],
    ['Feedback unavailable (travel-time confirmation)', yes(!!m.feedbackUnavailable)],
    ['Passive on timeout', yes(!!m.passiveOnTimeout)],
    ['Confirmation time', `${m.confirmTimeSec} s`],
    ['Command source (CAS)', m.commandSource ?? 'none (operator MAN)'],
    ['Interlock source', m.interlockSource ?? 'none'],
    ['Permissive source', m.permissiveSource ?? 'none'],
    ['State descriptors', m.descriptors ? 'Named Set descriptors configured' : 'Default descriptors'],
    ['Controller assignment', m.controllerTag ?? 'Not assigned']
  ]
  const steps = [
    'Assign the device signal tags (DSTs) for the command output and, when the device reports its state, the feedback input.',
    `Open the device options. This module commands its ${noun} to ${valve ? 'the Open state and returns it to Closed' : 'Running and returns it to Stopped'} when interlocked, so the passive state is the safe state.`,
    'Wire the interlock source: a logic or alarm module whose true value trips the device to its passive state. Choose whether a trip must be reset by the operator before the device can move again.',
    'Wire the permissive source and enable Permissive required when a start or open must be blocked until a condition is met. A missing or Bad permissive source denies the command.',
    'Set the confirmation time to the real travel or run-up time. If feedback does not match the command within this time the device fails (or reverts to Passive when Passive on timeout is selected).',
    'When no feedback signal exists, select Feedback unavailable so the state is confirmed by elapsed time instead of real feedback. Use feedback polarity inversion when the wiring reports the opposite bit.',
    'Select state descriptors (Named Sets) so the faceplate and graphics show process wording rather than 0/1.',
    'Enable the failure alarm and set its priority in the Alarm View below. Failure is raised for a device fault or Bad I/O quality.',
    'Assign the module to a controller, save the configuration and download it. Equipment Module ownership is displayed from the module membership; acquire/release arbitration is not simulated.'
  ]
  return <div className="tmpl-document" role="document" aria-label={`${m.tag} module template`}>
    <Section title={`DISCRETE ${noun.toUpperCase()} MODULE WITH INTERLOCKS AND PERMISSIVES`}>
      <p>This module provides discrete control of an on/off {noun}. The {noun} returns to its passive
        ({passiveWord.toLowerCase()}) state when it is interlocked or when its output is de-energized. Interlock and
        permissive conditions are evaluated every scan, and each commanded state is confirmed from the device
        feedback, never from the command itself.</p>
      <p>Wired in this module: interlock source <b>{interlockText}</b>, permissive <b>{permissiveText}</b>, command
        source <b>{m.commandSource ?? 'none'}</b>. Force setpoints and multiple condition lists are not configurable in
        this simulation; one interlock source and one permissive source can be wired and the operator can force an
        interlock from the faceplate.</p>
    </Section>

    <Section title="Mode Locking" note="Owner arbitration is not simulated">
      <svg viewBox="0 0 900 150" role="img" aria-label="Mode locking">
        <Param x={20} y={14} name="OWNER_ID" value={m.equipmentModule ?? '(none)'} />
        <Param x={20} y={42} name="HOLD_REQ" value="False" />
        <Param x={20} y={70} name="MODELOCK_OVR" value="False" />
        <Param x={20} y={112} name="REQ_MODE" value={mode} />
        <Block x={520} y={20} w={210} type="C_DC_ML_V01" name="MODELOCK" order={1}
          left={['SELECT_ML', 'ENAB_DFLT_OPMD', 'DFLT_OPMD']} right={['MODELOCKED']} values={{ MODELOCKED: 'False' }} />
        <Param x={760} y={34} w={120} name="MODELOCKED" value="" />
      </svg>
      <p>Mode locking decides whether an owner, normally an Equipment Module or Phase, may hold the device in a given
        operating mode. OWNER_ID reports the static Equipment Module membership. HOLD_REQ and MODELOCK_OVR are always
        False and MODELOCKED therefore stays False, so the operator command mode (REQ_MODE) is always honored.
        Operator Modelock Override on the faceplate is likewise informational.</p>
    </Section>

    <Section title="DC Algorithm">
      <svg viewBox="0 0 900 330" role="img" aria-label="Device control algorithm">
        <Block x={20} y={24} w={200} type="DCC" name="DCC1" order={2}
          left={['CMD_IN_D']} right={['P_OUT_D', 'I_OUT_D', 'I_OUT', 'F_OUT_D', 'F_OUT', 'DISABLE_ACT', 'P_DISABLE_ACT', 'I_DISABLE_ACT', 'F_DISABLE_ACT', 'I_FIRST_OUT']}
          values={{ CMD_IN_D: yes(requested), P_OUT_D: yes(permitted), I_OUT_D: yes(tripped), I_OUT: tripped ? '1' : '0', F_OUT_D: 'False', F_OUT: '0' }} />
        <Block x={430} y={24} w={210} type="EDC" name="EDC1" order={3}
          left={['SHUTDOWN_D', 'PERMISSIVE_D', 'INTERLOCK_D', 'INTERLOCK_STATE', 'FORCE_SP_D', 'FORCE_SP_VAL', 'TRK_IN_D', 'SIMULATE_IN_D', 'CAS_IN_D']}
          right={['CMD_D', 'OUT_D', 'PV_D', 'SENTINEL']}
          values={{ PERMISSIVE_D: yes(permitted), INTERLOCK_D: yes(tripped), FORCE_SP_D: 'False', CAS_IN_D: yes(requested),
            CMD_D: yes(!!m.appliedCommand), OUT_D: yes(!!m.outputCommand), PV_D: yes(feedback) }} />
        <polyline points="220,58 330,58 330,60 430,60" fill="none" stroke="#333" />
        <polyline points="220,75 300,75 300,77 430,77" fill="none" stroke="#333" />
        <polyline points="220,92 270,92 270,94 430,94" fill="none" stroke="#333" />
        <polyline points="220,109 250,109 250,111 430,111" fill="none" stroke="#333" />
        <polyline points="220,126 240,126 240,128 430,128" fill="none" stroke="#333" />
        <Param x={20} y={250} w={130} name="REQ_SP" value={`${requested ? 'Active' : 'Passive'}`} />
        <polyline points="150,260 400,260 400,196 430,196" fill="none" stroke="#333" />
        <text x={160} y={278} fontSize={9} fill="#222">EDC1/CAS_IN_D</text>
        <Param x={700} y={110} w={130} name="BYPASSED" value="False" />
        <text x={20} y={310} fontSize={10} fill="#222">IO_OUT_1 = {bindingText || '(unbound: simulated device)'}</text>
        <text x={20} y={324} fontSize={10} fill="#222">DC_STATE = {m.dcState}   Travel timer = {m.travelTimer.toFixed(1)} / {m.confirmTimeSec} s</text>
      </svg>
      <p><b>DCC1</b> evaluates the device conditions. The command request (CMD_IN_D) is checked against the interlock
        ({interlockText}) and the permissive ({permissiveText}); the result is passed to EDC1 as P_OUT_D (permit) and
        I_OUT_D (trip). No force setpoint conditions are configured, so F_OUT_D stays False.</p>
      <p><b>EDC1</b> applies the request to the field device. A trip drives it to Passive
        ({passiveWord}); a request while the permit is missing is refused; the result of the command is confirmed
        against the feedback to produce PV_D ({activeWord} = {yes(feedback)}). While Reset required is set, a trip
        leaves the device Locked until the operator resets it.</p>
    </Section>

    <Section title="Standard Interface Parameters" note="Parameters a higher-level module or display can read and write">
      <svg viewBox="0 0 900 200" role="img" aria-label="Standard interface parameters">
        <Param x={20} y={14} name="SP_D" value={requested ? 'Active' : 'Passive'} />
        <text x={20} y={48} fontSize={10} fill="#222">EDC1/SP_D</text>
        <Param x={250} y={14} name="MODE" value={mode} />
        <text x={250} y={48} fontSize={10} fill="#222">EDC1/MODE</text>
        <Param x={480} y={14} name="PV_D" value={yes(feedback)} />
        <text x={480} y={48} fontSize={10} fill="#222">EDC1/PV_D</text>
        <Param x={710} y={14} w={140} name="PV_STATE" value={feedback ? activeWord : passiveWord} />
        <text x={710} y={48} fontSize={10} fill="#222">EDC1/PV_STATE</text>
      </svg>
      <ul>
        <li><b>SP_D</b> is written by the operator (faceplate Start/Stop or Open/Close) or by the command source; it is the
          requested state of the device.</li>
        <li><b>MODE</b> shows the actual mode: CAS while a command source drives the request, MAN for direct operator control.</li>
        <li><b>PV_D</b> is the confirmed device state read back from the feedback ({feedback ? 'currently active' : 'currently passive'}).</li>
        <li><b>PV_STATE</b> is the descriptor text for the confirmed state.</li>
      </ul>
    </Section>

    <Section title="User Defined Variables" note="Not used by this module">
      <svg viewBox="0 0 900 76" role="img" aria-label="User defined variables">
        {Array.from({ length: 10 }, (_, index) => {
          const n = String(index + 1).padStart(2, '0')
          return <g key={n}>
            <rect x={14 + index * 87} y={12} width={78} height={20} fill="#dcdedf" stroke={FRAME} />
            <text x={20 + index * 87} y={26} fontSize={9} fill="#222">TP{n}_D</text>
            <rect x={14 + index * 87} y={38} width={78} height={20} fill="#dcdedf" stroke={FRAME} />
            <text x={20 + index * 87} y={52} fontSize={9} fill="#222">TP{n}</text>
          </g>
        })}
      </svg>
      <p>The variables TP01 to TP10 and their descriptors TP01_D to TP10_D are spare module parameters for site-specific
        use. This simulated module does not read or write them.</p>
    </Section>

    <Section title="Failure Propagation to Higher Levels">
      <svg viewBox="0 0 900 110" role="img" aria-label="Failure propagation">
        <Block x={20} y={22} w={200} type="CND" name="CND1" order={4} left={[]} right={['OUT_D']} values={{ OUT_D: yes(failure) }} />
        <polyline points="220,58 330,58" fill="none" stroke="#333" />
        <Param x={330} y={48} w={160} name="FAILURE" value={yes(failure)} />
      </svg>
      <p>CND1 sets FAILURE to True when any active fail condition exists.
        {failConditions.length ? ` Active now: ${failConditions.join('; ')}.` : ' No fail condition is active.'}
        {' '}FAILURE is the parameter a higher-level module reads, and it raises the module failure alarm.</p>
    </Section>

    <div className="tmpl-config">
      <Section title="Module Configuration">
        <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>
      </Section>
      <Section title="Configured Device Options" note={`Live values for ${m.tag}`}>
        <table className="tmpl-table" aria-label="Configured device options">
          <thead><tr><th>Option</th><th>Value</th></tr></thead>
          <tbody>{options.map(([name, value]) => <tr key={name}><td>{name}</td><td>{value}</td></tr>)}</tbody>
        </table>
        <p>The passive state of this {noun} is {passiveWord.toLowerCase()}. Normally-open conversion is not a separate
          setting here: invert the feedback polarity and choose descriptors that match the process wording.</p>
      </Section>
    </div>

    <Section title="Revision History">
      <table className="tmpl-table" aria-label="Revision history">
        <thead><tr><th>Version</th><th>Date</th><th>Initials</th><th>Changed</th></tr></thead>
        <tbody><tr><td>1.0.0</td><td>2026-10-05</td><td>BL</td><td>Discrete device module template documented in Control Studio</td></tr></tbody>
      </table>
    </Section>
  </div>
}
