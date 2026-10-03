import { useStore } from '../engine/store'
import { fmt, fmtQ } from '../utils/format'

export function AoFaceplate({ tag }: { tag: string }): JSX.Element | null {
  const m = useStore(s => s.modules[tag])
  const mode = useStore(s => s.setStandaloneAoMode)
  const write = useStore(s => s.setStandaloneAoValue)
  const parameter = useStore(s => s.setAoParameter)
  if (m?.type !== 'AO') return null
  return <div className="fp-body">
    <div className="fp-row"><span className="fp-label">Target Mode</span>
      <select aria-label={`${tag} faceplate AO mode`} value={m.mode} onChange={e => {
        const target = e.target.value
        if (target === 'CAS' || target === 'AUTO' || target === 'MAN' || target === 'OOS') mode(tag, target)
      }}><option>CAS</option><option>AUTO</option><option>MAN</option><option>OOS</option></select>
    </div>
    <div className="fp-row"><span className="fp-label">Actual / Quality</span>
      <span>{m.actualMode} / {m.bad ? 'Bad' : m.limited ? 'Limited' : 'Good'}</span></div>
    <div className="fp-row"><span className="fp-label">SP ({m.unit})</span>
      {m.mode === 'AUTO' ? <input className="fp-numinput" type="number" aria-label={`${tag} faceplate SP`}
        min={m.spLow} max={m.spHigh} value={m.sp} onChange={e => write(tag, Number(e.target.value))} />
        : <span>{fmt(m.sp, m.decimals)}</span>}
    </div>
    <div className="fp-row"><span className="fp-label">OUT (%)</span>
      {m.mode === 'MAN' ? <input className="fp-numinput" type="number" aria-label={`${tag} faceplate manual output`}
        min={0} max={100} value={m.manualOutput} onChange={e => write(tag, Number(e.target.value))} />
        : <span>{fmtQ(m.out, 1, m.bad)}</span>}
    </div>
    <div className="fp-row"><span className="fp-label">Held / Applied (%)</span><span>{fmt(m.out, 1)}</span></div>
    <div className="fp-row"><span className="fp-label">Engineering ({m.unit})</span><span>{fmtQ(m.pv, m.decimals, m.bad)}</span></div>
    {Object.entries(m.parameters).map(([name, p]) => <div className="fp-row" key={name}>
      <span className="fp-label">{name}</span><input className="fp-numinput" type="number"
        aria-label={`${tag} faceplate ${name}`} value={p.value} onChange={e => parameter(tag, name, Number(e.target.value))} />
    </div>)}
  </div>
}
