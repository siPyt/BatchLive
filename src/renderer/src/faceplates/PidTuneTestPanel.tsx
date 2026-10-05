import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { requireUnlockedKey } from '../engine/security'
import { controllerIsDown } from '../engine/hardware'
import { findDst } from '../engine/traditionalIo'
import { analyzePidTuneTest, pidTuneSample, pidTuneSignature, suggestPidTuning, type PidTuneSample } from '../engine/pidTuneTest'

type Phase = 'ready' | 'recording' | 'review' | 'updated' | 'invalid'

export function PidTuneTestPanel({ tag, onBack }: { tag: string; onBack: () => void }): JSX.Element {
  const module = useStore(state => state.modules[tag])
  const time = useStore(state => state.time)
  const running = useStore(state => state.running)
  const hardware = useStore(state => state.hardware)
  const lifecycle = useStore(state => state.pidLifecycle[tag])
  const [phase, setPhase] = useState<Phase>('ready')
  const [samples, setSamples] = useState<PidTuneSample[]>([])
  const [status, setStatus] = useState('')
  const [signature, setSignature] = useState('')
  const [output, setOutput] = useState(String(module?.type === 'PID' ? module.out : 0))
  const [candidate, setCandidate] = useState({
    gain: String(module?.type === 'PID' ? module.gain : 0),
    reset: String(module?.type === 'PID' ? module.reset : 0),
    rate: String(module?.type === 'PID' ? module.rate ?? 0 : 0)
  })
  const controller = lifecycle?.deployed ? hardware.controllers[lifecycle.deployed.controllerTag] : undefined
  const unavailable = lifecycle && (!lifecycle.online || !controller || controllerIsDown(controller))
  const bindings = hardware.analogBindings?.[tag]
  const input = bindings?.input ? findDst(hardware, bindings.input)?.channel : undefined
  const currentSignature = JSON.stringify([
    module?.type === 'PID' ? pidTuneSignature(module) : null,
    lifecycle?.deployedRevision, lifecycle?.deployed?.controllerTag,
    bindings, input?.filterSeconds
  ])
  const live = module?.type === 'PID' ? pidTuneSample(module, time) : { error: 'PID module no longer exists' }
  const liveError = (phase === 'recording' || phase === 'review') && signature !== currentSignature
    ? 'PID configuration or tuning changed during Test; begin a new test' :
    unavailable ? 'Process Test requires an Online PID with an available deployed controller' :
    'error' in live ? live.error : null
  const result = analyzePidTuneTest(samples)
  const suggestion = module?.type === 'PID' ? suggestPidTuning(samples, module) : { error: 'PID module no longer exists' }

  const reject = (message: string): void => {
    setStatus(message)
    useStore.getState().logEvent('DIAGNOSTIC', tag, `Tune Test rejected: ${message}`)
  }

  useEffect(() => {
    if (phase !== 'recording') return
    if (liveError) {
      setPhase('invalid')
      setStatus(liveError)
      useStore.getState().logEvent('DIAGNOSTIC', tag, `Tune Test invalidated: ${liveError}`)
      return
    }
    if ('error' in live) return
    const sample = live
    if (samples.length && sample.time - samples[0].time > 300_000) {
      setPhase('invalid')
      setStatus('Simulator Test exceeded five simulated minutes; begin a new test')
      useStore.getState().logEvent('DIAGNOSTIC', tag, 'Tune Test exceeded five simulated minutes')
      return
    }
    setSamples(current => current.at(-1)?.time === sample.time ? current : [...current, sample])
  }, [phase, time, module, liveError, tag, samples])

  const values = { gain: Number(candidate.gain), reset: Number(candidate.reset), rate: Number(candidate.rate) }
  const duration = samples.length > 1 ? (samples.at(-1)!.time - samples[0].time) / 1000 : 0
  const chartPoints = (field: 'pv' | 'appliedOut'): string => samples.map(sample => {
    const span = field === 'pv' && module?.type === 'PID' ? module.pvMax - module.pvMin : 100
    const minimum = field === 'pv' && module?.type === 'PID' ? module.pvMin : 0
    return `${10 + (sample.time - samples[0].time) / Math.max(duration * 1000, 1) * 370},${100 - Math.max(0, Math.min(1, (sample[field] - minimum) / Math.max(span, 1))) * 90}`
  }).join(' ')

  return <section aria-label={`${tag} Simulator Tune Test`}>
    <b>Simulator Tune: Test / Review / Update</b>
    <p>Records a real simulated PV/applied-output response. A calculated
      open-loop reaction-curve tuning suggestion is offered as a reviewable
      starting point; native DeltaV Tune system identification is not
      replicated or claimed. First select MAN and confirm good feedback. Test
      requires at least 10 simulated seconds, a 0.1% applied output step and a
      measurable PV response. Split-range and overridden output are not supported.</p>
    <p>Manual output writes below are operator commands, not temporary overrides.
      They remain after closing or cancelling. Return output/mode explicitly
      through the faceplate when finished; Test never changes mode automatically.</p>
    <button className="tbtn sm" disabled={phase === 'recording'} onClick={() => {
      if (!requireUnlockedKey('TUNING', `Test ${tag}`) || !requireUnlockedKey('CONTROL', `Test ${tag}`)) return
      if (!running || unavailable || 'error' in live) {
        reject(unavailable ? 'Go Online with an available deployed controller before Test' :
          'error' in live ? live.error : 'Start the simulator before recording a process test')
        return
      }
      setSamples([live])
      setSignature(currentSignature)
      setPhase('recording')
      setStatus('Recording. Request a bounded manual output change and observe the measured PV response.')
      useStore.getState().logEvent('OPERATOR', tag, 'Simulator Tune Test started; no automatic mode/output changes')
    }}>Test Process</button>
    {phase === 'recording' && <>
      <label className="bld-f">Manual output (%)
        <input aria-label="Test manual output" type="number" min={0} max={100} step={0.1}
          value={output} onChange={event => setOutput(event.target.value)} />
      </label>
      <button className="tbtn sm" onClick={() => {
        const value = Number(output)
        if (!output.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
          reject('Test output requires a finite value from 0 to 100%')
          return
        }
        if (liveError) { reject(liveError); return }
        if (useStore.getState().setOutput(tag, value)) setStatus(`Manual output requested at ${value}%; observe applied feedback.`)
      }}>Apply Manual Output</button>
      <button className="tbtn sm" onClick={() => {
        if (!requireUnlockedKey('TUNING', `Review Test ${tag}`)) return
        if (liveError || 'error' in result) { reject(liveError ?? ('error' in result ? result.error : 'Invalid test')); return }
        setPhase('review')
        setStatus('Review observed response and enter your new tuning values. Update changes runtime only.')
        useStore.getState().logEvent('OPERATOR', tag, `Simulator Tune Test reviewed: ${JSON.stringify(result)}`)
      }}>Review Test</button>
      <button className="tbtn sm" onClick={() => {
        setPhase('ready')
        setSamples([])
        setStatus('Test recording cancelled. Operator output commands remain; no tuning was changed.')
        useStore.getState().logEvent('OPERATOR', tag, 'Simulator Tune Test cancelled without tuning Update')
      }}>Cancel Test</button>
    </>}
    <p>State: {phase} / {samples.length} samples / {duration.toFixed(1)} simulated seconds
      {!running ? ' / Simulator on hold' : ''}</p>
    {samples.length > 0 && <svg viewBox="0 0 400 110" role="img" aria-label="Recorded PV and applied output response">
      <rect x={10} y={10} width={370} height={90} fill="none" stroke="#aebdc9" />
      <polyline data-tune-pen="PV" points={chartPoints('pv')} fill="none" stroke="#2f6fbe" strokeWidth={2} />
      <polyline data-tune-pen="AO1/OUT" points={chartPoints('appliedOut')} fill="none" stroke="#c07a24" strokeWidth={2} />
    </svg>}
    <p>Blue: PV ({module?.type === 'PID' ? module.unit : ''}); orange: applied AO1 output (%).
      Applied output is not physical valve travel.</p>
    {phase === 'review' && !('error' in result) && <>
      <p>Observed: PV change {result.pvChange.toFixed(3)}, PV span {result.pvSpan.toFixed(3)};
        applied output change {result.outputChange.toFixed(2)}% over {result.duration.toFixed(1)}s.</p>
      {'error' in suggestion ? <p>Suggested tuning unavailable: {suggestion.error}</p> : <p>
        Suggested tuning (calculated open-loop reaction-curve estimate, not native DeltaV Tune):
        GAIN {suggestion.gain}, RESET {suggestion.reset}s/repeat, RATE {suggestion.rate}s.{' '}
        <button className="tbtn sm" type="button" onClick={() => setCandidate({
          gain: String(suggestion.gain), reset: String(suggestion.reset), rate: String(suggestion.rate)
        })}>Use Suggested Values</button>
      </p>}
      {(['gain', 'reset', 'rate'] as const).map(parameter => <label className="bld-f" key={parameter}>{parameter.toUpperCase()}
        <input aria-label={`Tune candidate ${parameter}`} type="number" min={0} step={0.1}
          value={candidate[parameter]} onChange={event => setCandidate(current => ({
            ...current, [parameter]: event.target.value
          }))} />
      </label>)}
      <button className="tbtn sm" onClick={() => {
        if (liveError) { reject(liveError); return }
        if (Object.values(candidate).some(value => !value.trim()) ||
            Object.values(values).some(value => !Number.isFinite(value) || value < 0)) {
          reject('Update requires finite non-negative GAIN/RESET/RATE values')
          return
        }
        if (useStore.getState().setTuning(tag, values)) {
          setPhase('updated')
          setStatus('Reviewed tuning updated online. Upload selected parameters to persist configured defaults.')
        }
      }}>Update Tuning</button>
    </>}
    <p role={phase === 'invalid' ? 'alert' : 'status'}>{status}</p>
    <button className="tbtn sm" onClick={onBack}>Back to Detail</button>
  </section>
}
