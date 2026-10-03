import { useState } from 'react'
import { useStore } from '../engine/store'
import { PROCEDURE, type PhaseState, type BatchStatus, type BatchCommand } from '../engine/batch'
import { newStep, describeAction, describeCondition, type SfcStep } from '../engine/sfc'
import { ActionEditor, TransitionEditor, firstTag } from './SfcDisplay'
import { clockString } from '../utils/format'

const PHASE_STATE_COLOR: Record<PhaseState, string> = {
  IDLE: 'var(--dv-text-mute)',
  RUNNING: '#37b24d',
  HOLDING: '#f2c313',
  HELD: '#f2c313',
  RESTARTING: '#1aa7ec',
  STOPPING: '#9fb0c0',
  STOPPED: '#9fb0c0',
  ABORTING: '#e8232c',
  ABORTED: '#e8232c',
  COMPLETE: '#37b24d'
}

const STATUS_COLOR: Record<BatchStatus, string> = {
  READY: '#9aa0a7',
  RUNNING: '#37b24d',
  HELD: '#f2c313',
  STOPPED: '#9fb0c0',
  ABORTED: '#e8232c',
  COMPLETE: '#1aa7ec'
}

// Which commands are enabled for a given batch status.
const ENABLED: Record<BatchStatus, BatchCommand[]> = {
  READY: ['START'],
  RUNNING: ['HOLD', 'STOP', 'ABORT'],
  HELD: ['RESTART', 'STOP', 'ABORT'],
  STOPPED: ['RESET'],
  ABORTED: ['RESET'],
  COMPLETE: ['RESET']
}

const COMMANDS: BatchCommand[] = ['START', 'HOLD', 'RESTART', 'STOP', 'ABORT', 'RESET']

export function BatchDisplay(): JSX.Element {
  const batch = useStore((s) => s.batch)
  const batchCommand = useStore((s) => s.batchCommand)
  const phases = useStore((s) => s.phases)
  const enabled = ENABLED[batch.status]
  const [editingPhase, setEditingPhase] = useState<string | null>(null)

  return (
    <div className="display batch">
      <div className="batch-toolbar">
        <span className="batch-title">Batch Operator Interface</span>
        <span className="batch-id">{batch.id}</span>
        <span className="batch-recipe">{batch.recipe}</span>
        <span className="batch-unit">Unit: {batch.unit}</span>
        <span className="batch-status" style={{ background: STATUS_COLOR[batch.status] }}>
          {batch.status}
        </span>
        <span style={{ flex: 1 }} />
        {COMMANDS.map((c) => (
          <button
            key={c}
            className={'batch-cmd ' + c.toLowerCase()}
            disabled={!enabled.includes(c)}
            onClick={() => batchCommand(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="batch-body">
        <div className="batch-procedure">
          <div className="batch-panel-head">Procedure — {batch.recipe}</div>
          {PROCEDURE.map((name, i) => {
            const active = batch.phase && batch.opIndex === i && batch.status !== 'READY'
            const done = batch.opIndex > i || batch.status === 'COMPLETE'
            const state = active && batch.phase ? batch.phase.state : done ? 'COMPLETE' : 'IDLE'
            return (
              <div
                key={name}
                className={'batch-op' + (active ? ' active' : '') + (editingPhase === name ? ' editing' : '')}
                onClick={() => setEditingPhase(editingPhase === name ? null : name)}
                title="Click to view/edit this phase's logic"
              >
                <span className="batch-op-num">{i + 1}</span>
                <div className="batch-op-main">
                  <b>{name}</b>
                  <span className="batch-op-desc">{phases[name].description}</span>
                </div>
                <span className="batch-op-state" style={{ color: PHASE_STATE_COLOR[state] }}>
                  {state}
                </span>
              </div>
            )
          })}
        </div>

        <div className="batch-active">
          <div className="batch-panel-head">Active Phase</div>
          {batch.phase ? (
            <div className="batch-phase-card">
              <div className="batch-phase-top">
                <b>{batch.phase.name}</b>
                <span
                  className="batch-phase-state"
                  style={{ background: PHASE_STATE_COLOR[batch.phase.state] }}
                >
                  {batch.phase.state}
                </span>
              </div>
              <div className="batch-phase-desc">{batch.phase.description}</div>
              <div className="batch-phase-rows">
                <div>
                  <span className="k">Step</span>
                  <span className="v">{batch.phase.stepName}</span>
                </div>
                <div>
                  <span className="k">Elapsed</span>
                  <span className="v">{batch.phase.elapsed.toFixed(1)} s</span>
                </div>
                <div>
                  <span className="k">Operation</span>
                  <span className="v">
                    {batch.opIndex + 1} / {PROCEDURE.length}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="exp-empty">No active phase. Press START to run the batch.</div>
          )}

          <div className="batch-panel-head" style={{ marginTop: 16 }}>
            Batch Journal
          </div>
          <div className="batch-log">
            {batch.log.length === 0 ? (
              <div className="exp-empty sm">No events yet.</div>
            ) : (
              batch.log.map((e, i) => (
                <div key={i} className="batch-log-row">
                  <span className="batch-log-t">{clockString(e.t)}</span>
                  <span className="batch-log-txt">{e.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {editingPhase && (
        <PhaseEditor
          name={editingPhase}
          steps={phases[editingPhase].steps}
          editable={batch.status === 'READY' || batch.status === 'COMPLETE'}
          onClose={() => setEditingPhase(null)}
        />
      )}
    </div>
  )
}

function PhaseEditor({
  name,
  steps,
  editable,
  onClose
}: {
  name: string
  steps: SfcStep[]
  editable: boolean
  onClose: () => void
}): JSX.Element {
  const modules = useStore((s) => s.modules)
  const setPhaseSteps = useStore((s) => s.setPhaseSteps)

  const update = (next: SfcStep[]): void => setPhaseSteps(name, next)
  const setStep = (i: number, patch: Partial<SfcStep>): void =>
    update(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  return (
    <div className="batch-phase-editor">
      <div className="sfc-toolbar">
        <span className="sfc-title">Phase Logic — {name}</span>
        {!editable && <span className="sfc-area">read-only while batch is active</span>}
        <span style={{ flex: 1 }} />
        <button className="tbtn sm" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      <div className="sfc-canvas">
        {steps.length === 0 && <div className="exp-empty">No steps.</div>}
        {steps.map((step, i) => (
          <div key={step.id} className="sfc-stepwrap">
            <div className={'sfc-step' + (i === 0 ? ' initial' : '')}>
              <div className="sfc-step-head">
                <span className="sfc-step-num">{i + 1}</span>
                {editable ? (
                  <input
                    className="sfc-stepname"
                    value={step.name}
                    onChange={(e) => setStep(i, { name: e.target.value })}
                  />
                ) : (
                  <b>{step.name}</b>
                )}
                {editable && (
                  <button className="sfc-x" onClick={() => update(steps.filter((_, idx) => idx !== i))}>
                    ✕
                  </button>
                )}
              </div>
              <div className="sfc-actions">
                {step.actions.map((a, ai) => (
                  <div key={ai} className="sfc-action">
                    {editable ? (
                      <ActionEditor
                        action={a}
                        modules={modules}
                        onChange={(na) => setStep(i, { actions: step.actions.map((x, idx) => (idx === ai ? na : x)) })}
                        onRemove={() => setStep(i, { actions: step.actions.filter((_, idx) => idx !== ai) })}
                      />
                    ) : (
                      <span>• {describeAction(a, modules[a.tag])}</span>
                    )}
                  </div>
                ))}
                {editable && (
                  <button
                    className="sfc-add"
                    onClick={() =>
                      setStep(i, { actions: [...step.actions, { kind: 'valve', tag: firstTag(modules, 'VALVE'), open: true }] })
                    }
                  >
                    + action
                  </button>
                )}
              </div>
            </div>
            <div className="sfc-trans">
              <span className="sfc-trans-bar" />
              {editable ? (
                <TransitionEditor cond={step.transition} modules={modules} onChange={(c) => setStep(i, { transition: c })} />
              ) : (
                <span className="sfc-trans-txt">⟶ {describeCondition(step.transition)}</span>
              )}
            </div>
          </div>
        ))}
        {editable && (
          <button className="tbtn sm" onClick={() => update([...steps, newStep(`STEP ${steps.length + 1}`)])}>
            + Add Step
          </button>
        )}
      </div>
    </div>
  )
}
