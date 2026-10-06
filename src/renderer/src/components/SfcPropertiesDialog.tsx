import { useState } from 'react'
import { SimulatorDialog } from './SimulatorDialog'
import { sfcExpressionContext, useStore } from '../engine/store'
import { sfcEditorDefinition } from '../engine/sfcLifecycle'
import type { SfcExpressionContext } from '../engine/sfcParameters'
import { logicError } from '../engine/sfcLogic'
import { TIMED_QUALIFIERS, sfcJoinPredecessors, sfcParallelJoin, type ActionQualifier, type SfcAction, type SfcStep } from '../engine/sfc'
import { assignmentExpression, conditionExpression, parseSfcAssignment, parseSfcBlockAction, parseSfcBooleanAction, parseSfcCondition } from '../engine/sfcExpressions'
import type { AnyModule } from '../engine/types'

export type SfcPropertiesTarget = { step: SfcStep; kind: 'transition' } |
  { step: SfcStep; kind: 'action'; index: number | null }

const QUALIFIERS: ActionQualifier[] = ['N', 'R', 'L', 'D', 'P', 'S', 'SD', 'DS', 'SL']
const QUALIFIER_NAMES: Record<ActionQualifier, string> = {
  N: 'non-stored', R: 'reset', L: 'time limited', D: 'delayed', P: 'pulse', S: 'stored',
  SD: 'stored and delayed', DS: 'delayed and stored', SL: 'stored and time limited'
}

function defaultAction(modules: Record<string, AnyModule>): SfcAction {
  const module = Object.values(modules).find(item => item.type === 'PID' || item.type === 'AO')
  return { kind: 'sp', tag: module?.tag ?? '', value: 0, qualifier: 'N' }
}

export function SfcPropertiesDialog({ name, target, onClose }: {
  name: string; target: SfcPropertiesTarget; onClose: () => void
}): JSX.Element {
  const modules = useStore(s => s.modules)
  const context = { ...sfcExpressionContext(useStore.getState(), name), stepId: target.step.id }
  const initial = target.kind === 'action' && target.index !== null ? target.step.actions[target.index] : defaultAction(modules)
  const [description, setDescription] = useState(target.kind === 'transition' ?
    target.step.transitionDescription ?? '' : initial.description ?? '')
  const [actionName, setActionName] = useState(initial.name ?? '')
  const [qualifier, setQualifier] = useState<ActionQualifier>(initial.qualifier ?? 'N')
  const [actionType, setActionType] = useState<'ASSIGNMENT' | 'BOOLEAN' | 'BLOCK'>(
    initial.kind === 'boolean' ? 'BOOLEAN' : initial.kind === 'block' ? 'BLOCK' : 'ASSIGNMENT')
  const [seconds, setSeconds] = useState(String(initial.seconds ?? 0))
  const [delayExpression, setDelayExpression] = useState(initial.timingCondition ?
    conditionExpression(initial.timingCondition, 'tag' in initial.timingCondition ? modules[initial.timingCondition.tag] : undefined) : 'TRUE')
  const [useExpression, setUseExpression] = useState(!!initial.timingCondition)
  const [expression, setExpression] = useState(target.kind === 'transition' ?
    conditionExpression(target.step.transition, 'tag' in target.step.transition ? modules[target.step.transition.tag] : undefined) :
    assignmentExpression(initial, modules[initial.tag]))
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'general' | 'confirm'>('general')
  const confirmInitial = initial.confirm
  const [confirmOn, setConfirmOn] = useState(!!confirmInitial)
  const [confirmExpression, setConfirmExpression] = useState(confirmInitial?.expression ?? '')
  const [confirmByExpression, setConfirmByExpression] = useState(confirmInitial?.timeoutExpression !== undefined)
  const [confirmSeconds, setConfirmSeconds] = useState(String(confirmInitial?.timeout ?? 0))
  const [confirmTimeoutExpression, setConfirmTimeoutExpression] = useState(confirmInitial?.timeoutExpression ?? 'FALSE')
  const [validation, setValidation] = useState('')
  const [browser, setBrowser] = useState<'action' | 'transition' | 'delay' | 'confirm' | 'confirmTimeout' | null>(null)
  const [route, setRoute] = useState(target.step.nextStep === undefined ? 'sequential' :
    target.step.nextStep === null ? 'complete' : `step:${target.step.nextStep}`)
  const [alternatives, setAlternatives] = useState((target.step.alternatives ?? []).map(item => ({
    expression: conditionExpression(item.condition, 'tag' in item.condition ? modules[item.condition.tag] : undefined),
    nextStep: item.nextStep, description: item.description ?? ''
  })))
  const runtime = useStore(s => s.sfcs[name])
  const lifecycle = useStore(s => s.sfcLifecycle[name])
  const steps = runtime ? sfcEditorDefinition(runtime, lifecycle).steps : []
  const oldJoin = sfcParallelJoin(steps, target.step)
  const [parallel, setParallel] = useState(!!target.step.parallelNextSteps?.length)
  const [parallelTargets, setParallelTargets] = useState(target.step.parallelNextSteps ?? [])
  const [parallelJoin, setParallelJoin] = useState(oldJoin?.id ?? '')
  const title = target.kind === 'transition' ? 'Transition Properties' :
    target.index === null ? 'Add Action' : 'Action Properties'
  const fail = (message: string): void => {
    setError(message)
    useStore.getState().logEvent('DIAGNOSTIC', name, `${title} rejected: ${message}`)
  }
  const validateCondition = (): void => {
    const result = parseSfcCondition(expression, useStore.getState().modules, context)
    setValidation(result.error !== undefined ? result.error : 'Condition is valid.')
  }
  const apply = (): void => {
    let patch: Partial<SfcStep>
    const related: { expected: SfcStep; patch: Partial<SfcStep> }[] = []
    if (target.kind === 'transition') {
      const result = parseSfcCondition(expression, useStore.getState().modules, context)
      if (result.error !== undefined) { fail(result.error); return }
      const parsed: NonNullable<SfcStep['alternatives']> = []
      for (const item of alternatives) {
        const condition = parseSfcCondition(item.expression, useStore.getState().modules, context)
        if (condition.error !== undefined) { fail(condition.error); return }
        parsed.push({ condition: condition.value, nextStep: item.nextStep, description: item.description })
      }
      patch = { transition: result.value, transitionDescription: description,
        nextStep: parallel ? undefined : route === 'sequential' ? undefined : route === 'complete' ? null : route.slice(5),
        alternatives: parallel ? undefined : parsed.length ? parsed : undefined,
        parallelNextSteps: parallel ? parallelTargets : undefined }
      if (oldJoin && (!parallel || oldJoin.id !== parallelJoin)) related.push({ expected: oldJoin, patch: { joinFrom: undefined } })
      if (parallel) {
        const join = steps.find(step => step.id === parallelJoin)
        if (!join) { fail('Choose an existing synchronization join step'); return }
        related.push({ expected: join, patch: { joinFrom: sfcJoinPredecessors(steps, join.id) } })
      }
    } else {
      let action: SfcAction
      if (qualifier === 'R') {
        if (!actionName.trim()) { fail('Enter the name of the stored action to reset'); return }
                const result = actionType === 'BOOLEAN' ? parseSfcBooleanAction(expression, context) :
          actionType === 'BLOCK' ? parseSfcBlockAction(expression, context) : { value: initial }
        if (result.error !== undefined) { fail(result.error); return }
        action = { ...result.value, qualifier, name: actionName.trim(), description, seconds: undefined, timingCondition: undefined }
      } else {
                const result = actionType === 'BOOLEAN' ? parseSfcBooleanAction(expression, context) :
          actionType === 'BLOCK' ? parseSfcBlockAction(expression, context) : parseSfcAssignment(expression, useStore.getState().modules, context)
        if (result.error !== undefined) { fail(result.error); return }
        action = { ...result.value, qualifier, name: actionName.trim() || undefined, description }
        if (TIMED_QUALIFIERS.includes(qualifier)) {
          if (useExpression) {
            const condition = parseSfcCondition(delayExpression, useStore.getState().modules, context)
            if (condition.error !== undefined) { fail(condition.error); return }
            action.timingCondition = condition.value
          } else {
            const time = seconds.trim() ? Number(seconds) : NaN
            if (!Number.isFinite(time) || time < 0) { fail('Time value must be finite and nonnegative'); return }
            action.seconds = time
          }
        }
      }
      if (confirmOn && qualifier === 'R') { fail('A reset action cannot be confirmed'); return }
      if (confirmOn) {
        const problem = logicError(confirmExpression.trim(), modules, context, 'boolean')
        if (problem) { setTab('confirm'); fail(`Confirm expression: ${problem}`); return }
        if (confirmByExpression) {
          const timeoutProblem = logicError(confirmTimeoutExpression.trim(), modules, context, 'boolean')
          if (timeoutProblem) { setTab('confirm'); fail(`Confirm timeout expression: ${timeoutProblem}`); return }
          action.confirm = { expression: confirmExpression.trim(), timeoutExpression: confirmTimeoutExpression.trim() }
        } else {
          const timeout = confirmSeconds.trim() ? Number(confirmSeconds) : NaN
          if (!Number.isFinite(timeout) || timeout < 0) { setTab('confirm'); fail('Confirm timeout must be finite and nonnegative'); return }
          action.confirm = { expression: confirmExpression.trim(), timeout }
        }
      } else delete action.confirm
      patch = { actions: target.index === null ? [...target.step.actions, action] :
        target.step.actions.map((item, index) => index === target.index ? action : item) }
    }
    if (useStore.getState().applySfcStepProperties(name, target.step, patch, related)) onClose()
    else setError('Properties were not applied. See the reported validation or permission error.')
  }
  return <SimulatorDialog className="sfc-properties-dialog" label={title} onClose={onClose}>
    <h3>{title} — {target.step.name}</h3>
    {target.kind === 'action' && <div role="tablist" className="sfc-edit-row">
      <button role="tab" aria-selected={tab === 'general'} className="tbtn sm" onClick={() => setTab('general')}>General</button>
      <button role="tab" aria-selected={tab === 'confirm'} className="tbtn sm" onClick={() => setTab('confirm')}>Confirm</button>
    </div>}
    {(target.kind === 'transition' || tab === 'general') &&
    <label>Description<input aria-label="Description" value={description} onChange={e => setDescription(e.target.value)} /></label>}
    {target.kind === 'transition' && !parallel && <label>When true, go to
      <select aria-label="Transition destination" value={route} onChange={e => setRoute(e.target.value)}>
        <option value="sequential">Next sequential step (last step completes)</option>
        <option value="complete">Complete routine</option>
        {steps.map(step => <option key={step.id} value={`step:${step.id}`}>{step.name} ({step.id})</option>)}
      </select>
    </label>}
    {target.kind === 'action' && tab === 'general' && <>
      <div className="sfc-edit-row">
        <label>{qualifier === 'R' ? 'Reset target' : 'Action name'}<input aria-label="Action name"
          value={actionName} onChange={e => setActionName(e.target.value)} /></label>
        <label>Type<select aria-label="Action type" value={actionType} onChange={e => {
          const type = e.target.value === 'BOOLEAN' ? 'BOOLEAN' : e.target.value === 'BLOCK' ? 'BLOCK' : 'ASSIGNMENT'
          setActionType(type)
          const parameter = Object.entries(context.parameters).find(([, binding]) => binding.type === 'BOOLEAN')?.[0] ?? 'ACTIVE'
          const fallback = defaultAction(modules)
          setExpression(type === 'BOOLEAN' ? `'${parameter}.CV'` : type === 'BLOCK' ? `'${Object.keys(context.blocks ?? {})[0] ?? 'TIMECHK'}'` :
            assignmentExpression(fallback, modules[fallback.tag]))
        }}><option value="ASSIGNMENT">Assignment</option><option value="BOOLEAN">Boolean parameter</option>
          <option value="BLOCK">Non-Boolean function block</option></select></label>
        <label>Qualifier<select aria-label="Action qualifier" value={qualifier}
          onChange={e => setQualifier(e.target.value as ActionQualifier)}>
          {QUALIFIERS.map(item => <option key={item}>{item}</option>)}
        </select></label>
      </div>
      {TIMED_QUALIFIERS.includes(qualifier) && <fieldset><legend>{qualifier === 'L' || qualifier === 'SL' ? 'Duration' : 'Delay'}</legend>
        <label><input type="radio" name="sfc-timing" checked={!useExpression} onChange={() => setUseExpression(false)} />Time value</label>
        <input aria-label="Time value" type="number" min={0} step="any" disabled={useExpression}
          value={seconds} onChange={e => setSeconds(e.target.value)} />
        <label><input type="radio" name="sfc-timing" checked={useExpression} onChange={() => setUseExpression(true)} />Expression</label>
        {useExpression && <textarea aria-label="Timing expression" value={delayExpression}
          onChange={e => setDelayExpression(e.target.value)} />}
        <button className="tbtn sm" disabled={!useExpression} onClick={() => setBrowser('delay')}>Timing Expression Assistant</button>
      </fieldset>}
    </>}
    {(target.kind === 'transition' || tab === 'general' && qualifier !== 'R') && <>
      <label>{target.kind === 'transition' ? 'Transition Condition' : 'Action expression'}
        <textarea aria-label={target.kind === 'transition' ? 'Transition Condition' : 'Action expression'}
          value={expression} onChange={e => setExpression(e.target.value)} />
      </label>
      <button className="tbtn sm" onClick={() => setBrowser(target.kind)}>Expression Assistant</button>
      {target.kind === 'transition' && <>
        <button className="tbtn sm" onClick={validateCondition}>Validate Condition</button>
        <label>Validation results<textarea aria-label="Validation results" readOnly value={validation} /></label>
      </>}
    </>}
    {target.kind === 'action' && tab === 'confirm' && <div role="tabpanel" aria-label="Confirm">
      <label><input type="checkbox" aria-label="Confirm action" checked={confirmOn} disabled={qualifier === 'R'}
        onChange={e => setConfirmOn(e.target.checked)} />Confirm action for {QUALIFIER_NAMES[qualifier]} qualifier</label>
      <label>Confirm expression<textarea aria-label="Confirm expression" disabled={!confirmOn} value={confirmExpression}
        onChange={e => setConfirmExpression(e.target.value)} /></label>
      <button className="tbtn sm" disabled={!confirmOn} onClick={() => setBrowser('confirm')}>Expression Assistant</button>
      <fieldset disabled={!confirmOn}><legend>Confirm Timeout</legend>
        <label><input type="radio" name="sfc-confirm-timeout" checked={!confirmByExpression} onChange={() => setConfirmByExpression(false)} />Time value</label>
        <input aria-label="Confirm timeout seconds" type="number" min={0} step="any" disabled={confirmByExpression || !confirmOn}
          value={confirmSeconds} onChange={e => setConfirmSeconds(e.target.value)} />
        <label><input type="radio" name="sfc-confirm-timeout" checked={confirmByExpression} onChange={() => setConfirmByExpression(true)} />Expression</label>
        {confirmByExpression && <textarea aria-label="Confirm timeout expression" value={confirmTimeoutExpression}
          onChange={e => setConfirmTimeoutExpression(e.target.value)} />}
        <button className="tbtn sm" disabled={!confirmByExpression} onClick={() => setBrowser('confirmTimeout')}>Timeout Expression Assistant</button>
      </fieldset>
      <p className="traditional-note">The action is confirmed when the expression becomes TRUE once it has run. If the timeout
        elapses first (0 waits indefinitely) the action fails: CONFIRM_FAIL is set and FAILED_CONFIRMS increases; PENDING_CONFIRMS counts
        actions not yet confirmed or failed. The step's transition must test these parameters, for example 'PENDING_CONFIRMS.CV' = 0.</p>
    </div>}
    {target.kind === 'transition' && <fieldset><legend>Parallel divergence and synchronization</legend>
      <label><input type="checkbox" aria-label="Activate parallel paths" checked={parallel}
        onChange={e => setParallel(e.target.checked)} />Activate parallel paths when true</label>
      {parallel && <>
        <p className="traditional-note">Select at least two independent branch starts. Configure each leg to reach the same join step before adding this fork.
          All leg-ending transitions must pass before the join activates. Legs may branch selectively and contain further divergences; routes that leave or cross legs, legs with two ends and conflicting branch writes are rejected.
          Fork and join are applied atomically; this is not the native graph palette.</p>
        {steps.filter(step => step.id !== target.step.id).map(step => <label key={step.id}>
          <input type="checkbox" aria-label={`Parallel destination ${step.name}`} checked={parallelTargets.includes(step.id)}
            onChange={e => setParallelTargets(items => e.target.checked ? [...items, step.id] : items.filter(id => id !== step.id))} />
          {step.name}
        </label>)}
        <label>Synchronization join<select aria-label="Parallel synchronization join" value={parallelJoin} onChange={e => setParallelJoin(e.target.value)}>
          <option value="">Choose a step</option>
          {steps.filter(step => step.id !== target.step.id).map(step => <option key={step.id} value={step.id}>{step.name}</option>)}
        </select></label>
      </>}
    </fieldset>}
    {target.kind === 'transition' && !parallel && <fieldset><legend>Selective alternate routes</legend>
      <p className="traditional-note">Primary transition is evaluated first, then these routes in order. Only one path activates.
        Choose an explicit primary destination when adding routes. Use parallel divergence above for concurrent independent paths; native palette editing is not implemented.</p>
      {alternatives.map((item, index) => <div key={index}>
        <label>Condition {index + 1}<textarea aria-label={`Alternate condition ${index + 1}`} value={item.expression}
          onChange={e => setAlternatives(items => items.map((value, i) => i === index ? { ...value, expression: e.target.value } : value))} /></label>
        <label>Destination<select aria-label={`Alternate destination ${index + 1}`} value={item.nextStep}
          onChange={e => setAlternatives(items => items.map((value, i) => i === index ? { ...value, nextStep: e.target.value } : value))}>
          <option value="">Choose a step</option>
          {steps.map(step => <option key={step.id} value={step.id}>{step.name} ({step.id})</option>)}
        </select></label>
        <button className="tbtn sm" onClick={() => setAlternatives(items => items.filter((_, i) => i !== index))}>Remove route {index + 1}</button>
      </div>)}
      <button className="tbtn sm" onClick={() => setAlternatives(items => [...items, { expression: 'TRUE', nextStep: '', description: '' }])}>Add alternate route</button>
    </fieldset>}
    <p className="traditional-note">
      Expressions combine module paths ('^/TAG/PID1/PV.CV', '//TAG/DC1/PV_D.CV'), local Boolean/Named Set parameters, step parameters
      ('PENDING_CONFIRMS.CV'), T_ACTIVE and numbers with AND, OR, XOR, NOT, comparisons, + - * / and ABS, SQRT, ROUND, MIN, MAX, IF.
      Boolean actions reference a local parameter instead of assigning a literal. Non-Boolean actions reference a configured local ALARM
      action-time monitor; other function-block activation types remain unsupported. Properties edits do not Save or Download the SFC.
    </p>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={apply}>OK</button>
      <button className="tbtn sm" onClick={onClose}>Cancel</button>
    </div>
    {browser && <SfcExpressionBrowser modules={modules} context={context} assignment={browser === 'action'}
      booleanAction={browser === 'action' && actionType === 'BOOLEAN'}
      blockAction={browser === 'action' && actionType === 'BLOCK'}
      onClose={() => setBrowser(null)} onInsert={(text, append) => {
        const join = (current: string): string => append && current.trim() ? `${current.trim()} ${text}` : text
        if (browser === 'delay') setDelayExpression(join)
        else if (browser === 'confirm') setConfirmExpression(join)
        else if (browser === 'confirmTimeout') setConfirmTimeoutExpression(join)
        else setExpression(join)
        setBrowser(null)
      }} />}
  </SimulatorDialog>
}

function SfcExpressionBrowser({ modules, context, assignment, booleanAction, blockAction, onInsert, onClose }: {
  modules: Record<string, AnyModule>; context: SfcExpressionContext
  assignment: boolean; booleanAction: boolean; blockAction: boolean; onInsert: (text: string, append?: boolean) => void; onClose: () => void
}): JSX.Element {
  const [tag, setTag] = useState(Object.keys(modules)[0] ?? '')
  const module = modules[tag]
  const candidates: string[] = []
  if (module?.type === 'PID' || module?.type === 'AO') {
    if (assignment) {
      for (const action of [{ kind: 'sp', tag, value: 0 }, { kind: 'out', tag, value: 0 },
        { kind: 'mode', tag, mode: 'AUTO' }] satisfies SfcAction[]) {
        candidates.push(assignmentExpression(action, module))
      }
    } else {
      candidates.push(conditionExpression({ kind: 'pv', tag, op: '>', value: 0 }, module),
        conditionExpression({ kind: 'out', tag, op: '>', value: 0 }, module),
        conditionExpression({ kind: 'mode', tag, mode: 'AUTO' }, module))
    }
  } else if (module?.type === 'AI' && !assignment) {
    candidates.push(conditionExpression({ kind: 'pv', tag, op: '>', value: 0 }, module))
  } else if (module?.type === 'MOTOR' || module?.type === 'VALVE') {
    const action: SfcAction = module.type === 'MOTOR' ? { kind: 'motor', tag, run: true } : { kind: 'valve', tag, open: true }
    candidates.push(assignment ? assignmentExpression(action, module) :
      conditionExpression(module.type === 'MOTOR' ? { kind: 'motorRunning', tag, running: true } : { kind: 'valveOpen', tag, open: true }, module))
    if (assignment) candidates.push(assignmentExpression({ kind: 'deviceReset', tag, reset: true }, module))
  } else if (module?.type === 'DO' && assignment) {
    candidates.push(assignmentExpression({ kind: 'do', tag, on: true }, module))
  } else if (module?.type === 'DI' && !assignment) {
    candidates.push(conditionExpression({ kind: 'discrete', tag, state: true }, module))
  }
  return <SimulatorDialog className="sfc-properties-dialog" label="Expression Browser" onClose={onClose}>
    <h3>Expression Browser</h3>
    {booleanAction || blockAction ? <p>Module: {context.name} — local {blockAction ? 'function blocks' : 'Boolean parameters'}</p> :
    <label>Module<select aria-label="Expression module" value={tag} onChange={e => setTag(e.target.value)}>
      {Object.keys(modules).map(item => <option key={item}>{item}</option>)}
    </select></label>}
    <p>Choose a supported path; edit the inserted literal before accepting Properties.</p>
    {!booleanAction && !blockAction && candidates.map(text => <button className="ctx-item" key={text} onClick={() => onInsert(text)}>{text}</button>)}
    {blockAction && Object.keys(context.blocks ?? {}).map(block => <button className="ctx-item" key={block}
      onClick={() => onInsert(`'${block}'`)}>{`'${block}'`}</button>)}
    {!blockAction && Object.entries(context.parameters).flatMap(([parameter, binding]) =>
      binding.type === 'BOOLEAN' ? (booleanAction ? [`'${parameter}.CV'`] : assignment ? [] :
        [`'${parameter}.CV' = TRUE`, `'${parameter}.CV' = FALSE`]).map(text =>
        <button className="ctx-item" key={text} onClick={() => onInsert(text)}>{text}</button>) :
      (booleanAction ? [] : context.sets[binding.namedSet]?.entries ?? []).map(entry => {
        const text = `'${parameter}' ${assignment ? ':=' : '='} '${binding.namedSet}:${entry.name}'`
        return <button className="ctx-item" key={text} onClick={() => onInsert(text)}>{text}</button>
      }))}
    {booleanAction && !Object.values(context.parameters).some(binding => binding.type === 'BOOLEAN') &&
      <p>Create a Boolean module parameter before adding a Boolean action.</p>}
    {blockAction && !Object.keys(context.blocks ?? {}).length && <p>Add a local ALARM function block before adding a Non-Boolean action.</p>}
    {!booleanAction && !blockAction && !candidates.length && <p>No supported {assignment ? 'assignment' : 'condition'} paths for this module.</p>}
    {!assignment && !booleanAction && !blockAction && <>
      <p>Step parameters of this step, and expression building blocks (appended to the expression):</p>
      {["'PENDING_CONFIRMS.CV' = 0", "'FAILED_CONFIRMS.CV' = 0", "'CONFIRM_FAIL.CV'"].map(text =>
        <button className="ctx-item" key={text} onClick={() => onInsert(text)}>{text}</button>)}
      {['AND', 'OR', 'NOT', '(', ')'].map(text =>
        <button className="ctx-item" key={text} onClick={() => onInsert(text, true)}>{text}</button>)}
    </>}
    {assignment && !booleanAction && !blockAction && module && (module.type === 'PID' || module.type === 'AO') && <>
      <p>Numeric SP/OUT assignments accept an expression; insert a live value reference:</p>
      {[`'^/${tag}/${module.type === 'AO' ? 'AO1' : 'PID1'}/PV.CV'`, `'^/${tag}/${module.type === 'AO' ? 'AO1' : 'PID1'}/OUT.CV'`].map(text =>
        <button className="ctx-item" key={text} onClick={() => onInsert(text, true)}>{text}</button>)}
    </>}
    {!assignment && <button className="ctx-item" onClick={() => onInsert('T_ACTIVE >= 0')}>T_ACTIVE timer</button>}
    <button className="tbtn sm" onClick={onClose}>Cancel</button>
  </SimulatorDialog>
}
