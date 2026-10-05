import { useState, type ReactNode } from 'react'
import { useStore } from '../engine/store'
import {
  deviceForceConditions, deviceInterlockConditions, devicePermissiveConditions,
  type DeviceConditionResult
} from '../engine/simulate'
import { explainModuleLogic, type LogicExplanation } from '../engine/logicExplanation'
import { DEVICE_LIMITS } from '../engine/types'
import type { AnyModule, DeviceCondition, DeviceForceSetpoint, MotorModule, ValveModule } from '../engine/types'

type Device = MotorModule | ValveModule

const FRAME = '#414141'
const BODY = '#eceeef'
const HEAD = '#e4e6e7'
const RULE = '#a3a6a8'
const ROW = 17
const TRIP = '#b3261e'
const OK = '#1f6b2f'

const yes = (value: boolean): string => value ? 'True' : 'False'
const pinY = (y: number, index: number): number => y + 31.5 + index * ROW

function Block({ x, y, w, type, name, order, left, right, values = {} }: {
  x: number; y: number; w: number; type: string; name: string; order: number
  left: string[]; right: string[]; values?: Record<string, string>
}): JSX.Element {
  const rows = Math.max(left.length, right.length, 1)
  const h = 24 + rows * ROW + 16
  return <g data-block={name}>
    <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="#222">{type}</text>
    <rect x={x} y={y} width={w} height={h} fill={BODY} stroke={FRAME} />
    <rect x={x} y={y} width={w} height={22} fill={HEAD} stroke={FRAME} />
    <text x={x + w / 2} y={y + 15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#222">{name}</text>
    {Array.from({ length: rows }, (_, i) => <line key={i} x1={x} x2={x + w} y1={y + 22 + (i + 1) * ROW} y2={y + 22 + (i + 1) * ROW} stroke={RULE} />)}
    {left.map((pin, i) => <g key={pin}>
      <rect x={x + 3} y={y + 28 + i * ROW} width={7} height={7} fill="#fff" stroke={FRAME} />
      <text x={x + 14} y={y + 35 + i * ROW} fontSize={9} fill="#222">{pin}{values[pin] !== undefined ? ` = ${values[pin]}` : ''}</text>
    </g>)}
    {right.map((pin, i) => <g key={pin}>
      <rect x={x + w - 10} y={y + 28 + i * ROW} width={7} height={7} fill="#fff" stroke={FRAME} />
      <text x={x + w - 14} y={y + 35 + i * ROW} fontSize={9} textAnchor="end" fill="#222">{values[pin] !== undefined ? `${values[pin]} = ` : ''}{pin}</text>
    </g>)}
    <text x={x + w - 6} y={y + h - 4} textAnchor="end" fontSize={9} fill="#333">#{order}</text>
  </g>
}

function Param({ x, y, w, name, value, hot }: { x: number; y: number; w: number; name: string; value: string; hot?: boolean }): JSX.Element {
  return <g data-parameter={name}>
    <rect x={x} y={y} width={w} height={20} fill="#dcdedf" stroke={FRAME} />
    <text x={x + 6} y={y + 14} fontSize={10} fill="#222">{name}</text>
    <text x={x + w - 6} y={y + 14} fontSize={10} textAnchor="end" fontWeight={700} fill={hot ? TRIP : '#0b4a8f'}>{value}</text>
  </g>
}

function Note({ x, y, lines }: { x: number; y: number; lines: string[] }): JSX.Element {
  return <g>{lines.map((line, i) => <text key={line} x={x} y={y + i * 12} fontSize={9.5} fill="#44525c" fontStyle="italic">{line}</text>)}</g>
}

function ConditionNodes({ title, items, x, y, pin, color }: {
  title: string; items: DeviceConditionResult[]; x: number; y: number; pin: { x: number; y: number }; color: (c: DeviceConditionResult) => string
}): { node: JSX.Element; height: number } {
  const rows = Math.max(items.length, 1)
  const node = <g data-conditions={title}>
    <text x={x} y={y} fontSize={10} fontWeight={700} fill="#222">{title} ({items.length})</text>
    {items.length === 0 && <g><rect x={x} y={y + 6} width={236} height={20} fill="none" stroke="#9aa" strokeDasharray="4 3" />
      <text x={x + 8} y={y + 20} fontSize={9} fill="#667">none configured</text></g>}
    {items.map((c, i) => {
      const top = y + 6 + i * 24
      return <g key={c.index} data-condition={`${title} ${c.index}`}>
        <rect x={x} y={top} width={236} height={20} fill="#fff" stroke={c.effective ? TRIP : FRAME} strokeWidth={c.effective ? 2 : 1} />
        <text x={x + 6} y={top + 14} fontSize={9.5} fill="#222">#{c.index} {c.description || c.source}</text>
        <text x={x + 230} y={top + 14} fontSize={9.5} textAnchor="end" fontWeight={700} fill={color(c)}>
          {c.source}{c.invert ? ' (inv)' : ''} = {c.bad ? 'Bad' : yes(c.value)}{c.bypassed ? ' BYPASSED' : ''}</text>
        <polyline points={`${x + 236},${top + 10} ${pin.x - 40 + (i % 4) * 8},${top + 10} ${pin.x - 40 + (i % 4) * 8},${pin.y} ${pin.x},${pin.y}`}
          fill="none" stroke={c.effective ? TRIP : '#333'} />
      </g>
    })}
  </g>
  return { node, height: 14 + rows * 24 + 10 }
}

type Row = DeviceCondition & { state?: 'ACTIVE' | 'PASSIVE' }

function ConditionEditor({ device, kind }: { device: Device; kind: 'interlockConditions' | 'permissiveConditions' | 'forceSetpoints' }): JSX.Element {
  const modules = useStore(s => s.modules)
  const setLogic = useStore(s => s.setDeviceLogic)
  const managed = useStore(s => !!s.deviceLifecycle[device.tag])
  const applied = (device[kind] ?? []) as Row[]
  const [rows, setRows] = useState<Row[]>(applied.map(row => ({ ...row })))
  const label = kind === 'interlockConditions' ? 'Interlock' : kind === 'permissiveConditions' ? 'Permissive' : 'Force setpoint'
  const max = kind === 'interlockConditions' ? DEVICE_LIMITS.interlocks : kind === 'permissiveConditions' ? DEVICE_LIMITS.permissives : DEVICE_LIMITS.forceSetpoints
  const listId = `${device.tag}-${kind}-sources`
  const update = (index: number, patch: Partial<Row>): void => setRows(rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  const apply = (): void => {
    const cleaned = rows.map(row => ({ ...row, description: row.description.trim(), source: row.source.trim() }))
    if (kind === 'forceSetpoints') setLogic(device.tag, { forceSetpoints: cleaned.map(row => ({ ...row, state: row.state ?? 'ACTIVE' }) as DeviceForceSetpoint) })
    else setLogic(device.tag, { [kind]: cleaned })
  }
  return <section className="logic-editor" aria-label={`${label} conditions editor`}>
    <h4>{label} conditions <small>{rows.length} of {max}</small></h4>
    <table className="tmpl-table">
      <thead><tr><th>#</th><th>Description (max {DEVICE_LIMITS.description})</th><th>Source module</th><th>Invert</th>
        {kind === 'interlockConditions' && <th>Bypassable</th>}{kind === 'forceSetpoints' && <th>Forces</th>}<th /></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={6}>None configured.</td></tr>}
        {rows.map((row, i) => <tr key={i}>
          <td>{i + 1}</td>
          <td><input aria-label={`${label} ${i + 1} description`} value={row.description} maxLength={DEVICE_LIMITS.description} disabled={managed}
            onChange={e => update(i, { description: e.target.value })} /></td>
          <td><input aria-label={`${label} ${i + 1} source`} list={listId} value={row.source} disabled={managed}
            onChange={e => update(i, { source: e.target.value })} /></td>
          <td><input type="checkbox" aria-label={`${label} ${i + 1} invert`} checked={!!row.invert} disabled={managed}
            onChange={e => update(i, { invert: e.target.checked })} /></td>
          {kind === 'interlockConditions' && <td><input type="checkbox" aria-label={`${label} ${i + 1} bypassable`} checked={!!row.bypassable} disabled={managed}
            onChange={e => update(i, { bypassable: e.target.checked })} /></td>}
          {kind === 'forceSetpoints' && <td><select aria-label={`${label} ${i + 1} state`} value={row.state ?? 'ACTIVE'} disabled={managed}
            onChange={e => update(i, { state: e.target.value as 'ACTIVE' | 'PASSIVE' })}>
            <option value="ACTIVE">Active</option><option value="PASSIVE">Passive</option></select></td>}
          <td><button type="button" disabled={managed} aria-label={`Remove ${label} ${i + 1}`} onClick={() => setRows(rows.filter((_, n) => n !== i))}>Remove</button></td>
        </tr>)}
      </tbody>
    </table>
    <datalist id={listId}>{Object.keys(modules).filter(tag => tag !== device.tag).map(tag => <option key={tag} value={tag} />)}</datalist>
    <div className="logic-editor-buttons">
      <button type="button" disabled={managed || rows.length >= max}
        onClick={() => setRows([...rows, { source: '', description: '', ...(kind === 'forceSetpoints' ? { state: 'ACTIVE' as const } : {}) }])}>Add condition</button>
      <button type="button" disabled={managed} onClick={apply}>Apply</button>
      <button type="button" disabled={managed} onClick={() => setRows(applied.map(row => ({ ...row })))}>Revert</button>
    </div>
  </section>
}

export function LogicExplanationView({ module: m, after }: { module: AnyModule; after?: (heading: string) => ReactNode }): JSX.Element {
  const modules = useStore(s => s.modules)
  const text: LogicExplanation = explainModuleLogic(m, modules)
  return <div className="logic-explanation" role="region" aria-label={`${m.tag} logic explanation`}>
    <h3>{text.title}</h3>
    <p className="logic-decision"><b>Right now:</b> {text.decision}</p>
    <p>{text.summary}</p>
    {text.sections.map(section => <section key={section.heading}>
      <h4>{section.heading}</h4>
      <ul>{section.lines.map(line => <li key={line}>{line}</li>)}</ul>
      {after?.(section.heading)}
    </section>)}
  </div>
}

export function DeviceLogicView({ module: m, zoom = 1 }: { module: Device; zoom?: number }): JSX.Element {
  const modules = useStore(s => s.modules)
  const binding = useStore(s => s.hardware.deviceBindings?.[m.tag])
  const setLogic = useStore(s => s.setDeviceLogic)
  const managed = useStore(s => !!s.deviceLifecycle[m.tag])
  const valve = m.type === 'VALVE'
  const active = valve ? 'Open' : 'Running'
  const passive = valve ? 'Closed' : 'Stopped'
  const requested = valve ? (m as ValveModule).commandedOpen : (m as MotorModule).commanded
  const feedback = valve ? (m as ValveModule).open : (m as MotorModule).running
  const forces = deviceForceConditions(m, modules)
  const interlocks = deviceInterlockConditions(m, modules)
  const permissives = devicePermissiveConditions(m, modules)
  const forced = forces.find(c => c.effective)
  const tripped = m.interlock
  const permitted = !m.permissiveRequired || m.permissiveOk
  const failure = m.fault || !!m.ioInputBad || !!m.ioOutputBad || m.dcState.startsWith('FAILED')
  const mode = m.commandSource || forced ? 'CAS' : 'MAN'
  const bindingText = binding ? Object.entries(binding).map(([port, dst]) => `${port}=${dst}`).join(', ') : ''

  const dccX = 330
  const dccY = 36
  const edcX = 640
  const edcY = 36
  const colX = 10
  const forceNodes = ConditionNodes({ title: 'Force setpoints', items: forces, x: colX, y: 22, pin: { x: dccX, y: pinY(dccY, 1) },
    color: c => c.effective ? TRIP : '#44525c' })
  const interlockNodes = ConditionNodes({ title: 'Interlock conditions', items: interlocks, x: colX, y: 22 + forceNodes.height, pin: { x: dccX, y: pinY(dccY, 2) },
    color: c => c.effective ? TRIP : OK })
  const permissiveNodes = ConditionNodes({ title: 'Permissive conditions', items: permissives, x: colX, y: 22 + forceNodes.height + interlockNodes.height,
    pin: { x: dccX, y: pinY(dccY, 3) }, color: c => c.effective ? TRIP : OK })
  const leftHeight = 22 + forceNodes.height + interlockNodes.height + permissiveNodes.height
  const height = Math.max(leftHeight + 40, 420)
  const reqY = 220
  const edcPinCas = pinY(edcY, 5)
  const srcLine = m.commandSource ? `command source ${m.commandSource}` : 'operator buttons'

  return <div className="logic-document" role="document" aria-label={`${m.tag} module logic`}>
    <section className="tmpl-section" aria-label="Module logic diagram">
      <h3>{m.tag} - {m.description}<small>Live logic: every box below is what the simulator executes each scan</small></h3>
      <svg style={{ width: `${zoom * 100}%` }} viewBox={`0 0 1000 ${height}`} role="img" aria-label={`${m.tag} device control logic`}>
        {forceNodes.node}{interlockNodes.node}{permissiveNodes.node}
        <Block x={dccX} y={dccY} w={200} type="DCC - device control conditions" name="DCC1" order={2}
          left={['CMD_IN_D', 'F_COND', 'I_COND', 'P_COND', 'BYPASSED']}
          right={['P_OUT_D', 'I_OUT_D', 'I_OUT', 'F_OUT_D', 'F_OUT']}
          values={{ CMD_IN_D: yes(requested), BYPASSED: yes(!!m.bypassed), P_OUT_D: yes(permitted), I_OUT_D: yes(tripped),
            I_OUT: String(interlocks.filter(c => c.effective).length), F_OUT_D: yes(!!forced), F_OUT: String(forced?.index ?? 0) }} />
        <Block x={edcX} y={edcY} w={210} type="EDC - enhanced device control" name="EDC1" order={3}
          left={['SHUTDOWN_D', 'PERMISSIVE_D', 'INTERLOCK_D', 'INTERLOCK_STATE', 'FORCE_SP_D', 'CAS_IN_D', 'FORCE_SP_VAL', 'TRK_IN_D', 'SIMULATE_IN_D']}
          right={['CMD_D', 'OUT_D', 'PV_D', 'SENTINEL']}
          values={{ PERMISSIVE_D: yes(permitted), INTERLOCK_D: yes(tripped), FORCE_SP_D: yes(!!forced), CAS_IN_D: yes(requested),
            CMD_D: yes(!!m.appliedCommand), OUT_D: yes(!!m.outputCommand), PV_D: yes(feedback) }} />
        {[['P_OUT_D', 1, 1], ['I_OUT_D', 2, 2], ['I_OUT', 3, 3], ['F_OUT_D', 4, 4]].map(([name, from, to]) =>
          <polyline key={String(name)} points={`${dccX + 200},${pinY(dccY, Number(from) - 1)} ${dccX + 270 + Number(to) * 6},${pinY(dccY, Number(from) - 1)} ${dccX + 270 + Number(to) * 6},${pinY(edcY, Number(to))} ${edcX},${pinY(edcY, Number(to))}`}
            fill="none" stroke={name === 'I_OUT_D' && tripped ? TRIP : '#333'} />)}
        <polyline points={`${dccX + 200},${pinY(dccY, 4)} ${dccX + 300},${pinY(dccY, 4)} ${dccX + 300},${pinY(edcY, 6)} ${edcX},${pinY(edcY, 6)}`} fill="none" stroke="#333" />
        <Param x={dccX} y={reqY} w={200} name="REQ_SP" value={requested ? 'Active' : 'Passive'} />
        <polyline points={`${dccX + 200},${reqY + 10} ${dccX + 340},${reqY + 10} ${dccX + 340},${edcPinCas} ${edcX},${edcPinCas}`} fill="none" stroke="#333" />
        <polyline points={`${dccX},${reqY + 10} ${dccX - 20},${reqY + 10} ${dccX - 20},${pinY(dccY, 0)} ${dccX},${pinY(dccY, 0)}`} fill="none" stroke="#333" />
        <Note x={dccX} y={reqY + 36} lines={[`REQ_SP source: ${srcLine}.`, forced ? `Forced by setpoint #${forced.index} to ${forced.state === 'ACTIVE' ? active : passive}.` : 'No force setpoint is acting.']} />
        <Note x={dccX} y={dccY + 144} lines={['DCC1 evaluates the condition lists every scan:', 'any effective interlock -> I_OUT_D, all permissives -> P_OUT_D,', 'first true force setpoint -> F_OUT_D and its state.']} />
        <Param x={880} y={edcY + 10} w={112} name="SP_D" value={requested ? active : passive} />
        <Param x={880} y={edcY + 36} w={112} name="MODE" value={mode} />
        <Param x={880} y={edcY + 62} w={112} name="PV_D" value={yes(feedback)} />
        <Param x={880} y={edcY + 88} w={112} name="PV_STATE" value={feedback ? active : passive} />
        <polyline points={`${edcX + 210},${pinY(edcY, 0)} ${edcX + 232},${pinY(edcY, 0)} ${edcX + 232},${edcY + 20} ${880},${edcY + 20}`} fill="none" stroke="#333" />
        <Note x={edcX} y={edcY + 218} lines={[`EDC1 applies the request to the field device (IO_OUT_1 = ${bindingText || 'internal simulated device'}).`,
          `DC_STATE = ${m.dcState}; travel ${m.travelTimer.toFixed(1)} / ${m.confirmTimeSec} s.`,
          'An effective interlock forces Passive; a missing permissive refuses Active.']} />
        <Block x={edcX} y={edcY + 268} w={210} type="CND - failure conditions" name="CND1" order={4} left={[]} right={['OUT_D']} values={{ OUT_D: yes(failure) }} />
        <Param x={880} y={edcY + 294} w={112} name="FAILURE" value={yes(failure)} hot={failure} />
        <polyline points={`${edcX + 210},${edcY + 299} 880,${edcY + 304}`} fill="none" stroke={failure ? TRIP : '#333'} />
        <Note x={edcX} y={edcY + 346} lines={['FAILURE = device fault OR Bad feedback OR Bad output OR failed DC_STATE.']} />
        <Note x={colX} y={height - 14} lines={['Mode locking (OWNER_ID, HOLD_REQ, MODELOCK_OVR) is not simulated; see the explanation below.']} />
      </svg>
      <div className="logic-bypass">
        <label><input type="checkbox" checked={!!m.bypassed} disabled={managed} aria-label="BYPASSED"
          onChange={e => setLogic(m.tag, { bypassed: e.target.checked })} /> BYPASSED: ignore interlock conditions marked bypassable</label>
      </div>
    </section>
    {managed && <p className="logic-note">This device uses the saved device lifecycle; its logic lists are edited on the runtime module only.</p>}
    <LogicExplanationView module={m} after={(heading) =>
      heading.startsWith('2.') ? <ConditionEditor key={`${m.tag}-f`} device={m} kind="forceSetpoints" />
        : heading.startsWith('3.') ? <ConditionEditor key={`${m.tag}-i`} device={m} kind="interlockConditions" />
          : heading.startsWith('4.') ? <ConditionEditor key={`${m.tag}-p`} device={m} kind="permissiveConditions" /> : null} />
  </div>
}
