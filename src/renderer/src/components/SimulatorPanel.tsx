import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import {
  NODE_MODE_LABEL, SCALE_MAX, SCALE_MIN, SCALE_PRESETS, SIMULATOR_DISCLOSURE, TEST_MODE_LABEL,
  achievedScale, nodeStatuses, testReadiness, useSimulator, validateScale, type NodeMode, type ScaleSample, type TestMode
} from '../engine/simulatorSession'

/** DV09-082: local simulator controls - initialize, time scaling, node and test mode - with an explicit non-Simulate disclosure. */
export function SimulatorPanel(): JSX.Element {
  const speed = useStore((s) => s.speed)
  const running = useStore((s) => s.running)
  const time = useStore((s) => s.time)
  const hardware = useStore((s) => s.hardware)
  const modules = useStore((s) => s.modules)
  const sfcs = useStore((s) => s.sfcs)
  const setSpeed = useStore((s) => s.setSpeed)
  const setRunning = useStore((s) => s.setRunning)
  const initialize = useStore((s) => s.initializeSimulation)
  const nodeMode = useSimulator((s) => s.nodeMode)
  const testMode = useSimulator((s) => s.testMode)
  const nodeUnderTest = useSimulator((s) => s.nodeUnderTest)
  const lastInitialized = useSimulator((s) => s.lastInitialized)
  const setNodeMode = useSimulator((s) => s.setNodeMode)
  const setTestMode = useSimulator((s) => s.setTestMode)
  const [custom, setCustom] = useState(String(speed))
  const [message, setMessage] = useState<string | null>(null)
  const samples = useRef<ScaleSample[]>([])
  const [achieved, setAchieved] = useState<number | null>(null)

  useEffect(() => setCustom(String(speed)), [speed])
  useEffect(() => { samples.current = [] }, [speed, running])
  useEffect(() => {
    const id = window.setInterval(() => {
      const state = useStore.getState()
      samples.current = [...samples.current, { wallMs: Date.now(), simMs: state.time }].slice(-8)
      setAchieved(state.running ? achievedScale(samples.current) : null)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const nodes = nodeStatuses(hardware, { nodeMode, nodeUnderTest })
  const issues = testReadiness({ modules, hardware, sfcs }, { nodeMode, testMode, nodeUnderTest })
  const customError = validateScale(Number(custom))

  return (
    <section className="simulator-panel" aria-label="Local simulator" style={{ marginTop: 16 }}>
      <h3>Local simulator</h3>
      <p className="muted">{SIMULATOR_DISCLOSURE}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="tbtn sm" onClick={() => {
          if (!window.confirm('Initialize the simulation? Process values return to their initial conditions and runtime state is cleared.')) return
          setMessage(initialize() ? 'Simulation initialized and on hold.' : 'Initialize was refused (see the event journal).')
        }}>Initialize simulation</button>
        <button className={'tbtn sm' + (running ? ' active' : '')} onClick={() => setRunning(!running)}>{running ? '❚❚ Running' : '▶ Hold'}</button>
        <span>Simulation time {new Date(time).toISOString().replace('T', ' ').slice(0, 19)}</span>
        {lastInitialized && <span className="muted">Last initialized by {lastInitialized.user} at {new Date(lastInitialized.wallTime).toLocaleString()}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <label>Time scale
          <input aria-label="Custom time scale" style={{ width: 70, marginLeft: 6 }} value={custom} onChange={e => setCustom(e.target.value)} />x
        </label>
        <button className="tbtn sm" disabled={!!customError} onClick={() => setSpeed(Number(custom))}>Apply</button>
        {SCALE_PRESETS.map(p => <button key={p} className={'tbtn sm' + (speed === p ? ' active' : '')} onClick={() => setSpeed(p)}>{p}×</button>)}
        <span className="muted">Allowed {SCALE_MIN}×–{SCALE_MAX}× · set {speed}× · achieved {achieved === null ? '—' : achieved.toFixed(2) + '×'}</span>
      </div>
      {customError && <div role="alert" style={{ color: '#ff8b8b' }}>{customError}</div>}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <label>Nodes
          <select aria-label="Node mode" value={nodeMode} style={{ marginLeft: 6 }} onChange={e => {
            const mode = e.target.value as NodeMode
            const error = setNodeMode(mode, mode === 'single' ? nodeUnderTest ?? Object.keys(hardware.controllers)[0] ?? null : null)
            setMessage(error)
          }}>
            {(Object.keys(NODE_MODE_LABEL) as NodeMode[]).map(m => <option key={m} value={m}>{NODE_MODE_LABEL[m]}</option>)}
          </select>
        </label>
        {nodeMode === 'single' && (
          <label>Node under test
            <select aria-label="Node under test" value={nodeUnderTest ?? ''} style={{ marginLeft: 6 }} onChange={e => setMessage(setNodeMode('single', e.target.value))}>
              {Object.keys(hardware.controllers).map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
        )}
        <label>Testing
          <select aria-label="Test mode" value={testMode} style={{ marginLeft: 6 }} onChange={e => setTestMode(e.target.value as TestMode)}>
            {(Object.keys(TEST_MODE_LABEL) as TestMode[]).map(m => <option key={m} value={m}>{TEST_MODE_LABEL[m]}</option>)}
          </select>
        </label>
      </div>
      {message && <div role="status">{message}</div>}
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Controller node</th><th>Status</th></tr></thead>
        <tbody>{nodes.map(n => <tr key={n.tag}><td>{n.tag}</td><td>{n.executing ? '▶ ' : '— '}{n.reason}</td></tr>)}</tbody>
      </table>
      <h4>Readiness for {TEST_MODE_LABEL[testMode].toLowerCase()}</h4>
      {issues.length === 0 ? <div>No issues found.</div> :
        <ul>{issues.map((i, n) => <li key={n}>{i.severity === 'blocking' ? '⛔ ' : 'ℹ '}{i.text}</li>)}</ul>}
    </section>
  )
}
