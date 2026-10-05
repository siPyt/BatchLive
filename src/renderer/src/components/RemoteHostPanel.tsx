import { useState } from 'react'
import { useStore } from '../engine/store'
import {
  MAX_HOST_TIMEOUT_SEC, MIN_HOST_TIMEOUT_SEC, hostSignalStatus, remoteHostOf, type HostInput
} from '../engine/remoteHost'

/** DV09-055: simulated external control program writing RCAS_IN (setpoint) and ROUT_IN (output) for a PID. */
export function RemoteHostPanel({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore(s => s.modules[tag])
  const writeHost = useStore(s => s.writeRemoteHost)
  const setTimeout_ = useStore(s => s.setRemoteHostTimeout)
  const [values, setValues] = useState<Record<HostInput, string>>({ RCAS_IN: '', ROUT_IN: '' })
  const [timeout, setTimeoutText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  if (!m || m.type !== 'PID') return null
  const host = remoteHostOf(m)
  const row = (input: HostInput, label: string, unit: string, signal = input === 'RCAS_IN' ? host.rcasIn : host.routIn): JSX.Element => (
    <div className="traditional-channel-form">
      <label className="bld-f">{label} ({unit})
        <input aria-label={`${tag} ${input}`} value={values[input]} placeholder={signal.good ? String(signal.value) : ''}
          onChange={e => setValues({ ...values, [input]: e.target.value })} />
      </label>
      <button className="tbtn sm" onClick={() => setMessage(writeHost(tag, input, values[input].trim() === '' ? NaN : Number(values[input])) ?? `${input} written.`)}>Write as host</button>
      <button className="tbtn sm" onClick={() => setMessage(writeHost(tag, input, null) ?? `${input} marked Bad.`)}>Host Bad</button>
      <span>{hostSignalStatus(signal, host.timeoutSec)}{Number.isFinite(signal.ageSec) ? ` · value ${signal.value}` : ''}</span>
    </div>
  )
  return <div className="exp-props-alarms">
    <div className="exp-props-subhead">Remote Host (RCAS_IN / ROUT_IN)</div>
    {row('RCAS_IN', 'RCAS_IN', m.unit)}
    {row('ROUT_IN', 'ROUT_IN', '%')}
    <div className="traditional-channel-form">
      <label className="bld-f">Host timeout (s, {MIN_HOST_TIMEOUT_SEC}-{MAX_HOST_TIMEOUT_SEC})
        <input aria-label={`${tag} host timeout`} value={timeout} placeholder={String(host.timeoutSec)} onChange={e => setTimeoutText(e.target.value)} />
      </label>
      <button className="tbtn sm" onClick={() => setMessage(setTimeout_(tag, timeout.trim() === '' ? NaN : Number(timeout)) ?? 'Host timeout set.')}>Apply Timeout</button>
    </div>
    {message && <div role="status">{message}</div>}
    <p>RCAS takes its setpoint from RCAS_IN and ROUT its output from ROUT_IN, both written by a simulated external control
      program. Without fresh Good data within the timeout, RCAS sheds to AUTO and ROUT to MAN. No OPC or network host is
      involved; these buttons stand in for it.</p>
  </div>
}
