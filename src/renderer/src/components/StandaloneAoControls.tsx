import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import type { AnalogOutputModule } from '../engine/types'
import { fmt } from '../utils/format'

export function StandaloneAoControls({ module: m, configuration = true }: {
  module: AnalogOutputModule; configuration?: boolean
}): JSX.Element {
  const configure = useStore(s => s.configureStandaloneAo)
  const mode = useStore(s => s.setStandaloneAoMode)
  const value = useStore(s => s.setStandaloneAoValue)
  const add = useStore(s => s.addAoParameter)
  const write = useStore(s => s.setAoParameter)
  const connect = useStore(s => s.connectAoParameter)
  const [name, setName] = useState('CAS_SP')
  const [initial, setInitial] = useState(500)
  const [scale, setScale] = useState({ pvMin: m.pvMin, pvMax: m.pvMax,
    unit: m.unit, spLow: m.spLow, spHigh: m.spHigh })
  useEffect(() => {
    setScale({ pvMin: m.pvMin, pvMax: m.pvMax, unit: m.unit, spLow: m.spLow, spHigh: m.spHigh })
  }, [m.pvMin, m.pvMax, m.unit, m.spLow, m.spHigh])
  const quality = m.bad ? 'Bad - held output' : m.limited ? 'Limited' : 'Good'
  return <>
    <tr><td>MODE.TARGET</td><td><select aria-label={`${m.tag} AO mode`} value={m.mode}
      onChange={e => {
        const target = e.target.value
        if (target === 'CAS' || target === 'AUTO' || target === 'MAN' || target === 'OOS') mode(m.tag, target)
      }}>
      <option>CAS</option><option>AUTO</option><option>MAN</option><option>OOS</option>
    </select></td><td>{quality}</td></tr>
    <tr><td>MODE.ACTUAL</td><td>{m.actualMode}</td><td>{quality}</td></tr>
    <tr><td>SP.CV</td><td>{m.mode === 'AUTO' ? <input type="number"
      aria-label={`${m.tag} AO SP`} min={m.spLow} max={m.spHigh} value={m.sp}
      onChange={e => value(m.tag, Number(e.target.value))} /> : `${fmt(m.sp, m.decimals)} ${m.unit}`}</td><td>{quality}</td></tr>
    <tr><td>OUT.CV</td><td>{m.mode === 'MAN' ? <input type="number"
      aria-label={`${m.tag} AO manual output`} min={0} max={100} value={m.manualOutput}
      onChange={e => value(m.tag, Number(e.target.value))} /> : `${fmt(m.out, 1)} %`}</td><td>{quality}</td></tr>
    <tr><td>APPLIED OUTPUT</td><td>{fmt(m.out, 1)} % / {fmt(m.pv, m.decimals)} {m.unit}</td><td>{quality}</td></tr>
    {Object.entries(m.parameters).map(([key, parameter]) => <tr key={key}>
      <td>{key}.CV</td><td><input type="number" aria-label={`${m.tag} ${key}.CV`}
        value={parameter.value}
        onChange={e => write(m.tag, key, Number(e.target.value))} /></td><td>Floating Point</td>
    </tr>)}
    {configuration && <>
      <tr><td>CAS_IN.SOURCE</td><td><select aria-label={`${m.tag} CAS_IN source`}
        value={m.casParameter ?? ''} onChange={e => connect(m.tag, e.target.value || undefined)}>
        <option value="">(not connected)</option>
        {Object.keys(m.parameters).map(key => <option key={key}>{key}</option>)}
      </select></td><td>{m.casParameter ? 'Connected' : 'Not connected'}</td></tr>
      <tr><td>PV_SCALE / SP LIMITS</td><td>
        <div className="traditional-channel-form">
          {(['pvMin', 'pvMax', 'spLow', 'spHigh'] as const).map(key => <label key={key}>
            {{ pvMin: 'Scale Low', pvMax: 'Scale High', spLow: 'SP Low', spHigh: 'SP High' }[key]}
            <input type="number" aria-label={`${m.tag} ${key}`} value={scale[key]}
              onChange={e => setScale({ ...scale, [key]: Number(e.target.value) })} />
          </label>)}
          <label>Unit <input aria-label={`${m.tag} scale unit`} value={scale.unit}
            onChange={e => setScale({ ...scale, unit: e.target.value })} /></label>
          <button className="tbtn sm" onClick={() => configure(m.tag, scale)}>Apply AO Scale / Limits</button>
        </div>
      </td><td>Configured</td></tr>
      <tr><td>INPUT PARAMETER</td><td><div className="traditional-channel-form">
        <label>Name <input aria-label={`${m.tag} new parameter name`} value={name}
          onChange={e => setName(e.target.value)} /></label>
        <label>Default Value <input type="number" aria-label={`${m.tag} new parameter value`} value={initial}
          onChange={e => setInitial(Number(e.target.value))} /></label>
        <button className="tbtn sm" onClick={() => add(m.tag, name, initial)}>New Floating Point Input</button>
      </div></td><td>Session-local</td></tr>
    </>}
  </>
}
