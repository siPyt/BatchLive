import type { DcState } from '../engine/types'

/**
 * DV visual-fidelity pass: real DeltaV Motor/Valve faceplates (see
 * newImage/newNewImages/IMG_0639.jpeg, IMG_0646.jpeg) show a standard
 * "Device State / Operation State / Failure State" block. This derives that
 * block's text purely from existing engine fields — no new simulated state.
 */
export function deviceStatusBlock(
  dcState: DcState,
  interlock: boolean,
  permissiveRequired: boolean,
  permissiveOk: boolean,
  fault: boolean,
  activeWord: string,
  passiveWord: string
): {
  deviceState: string
  deviceColor: string
  operationState: string
  opColor: string
  failureState: string
  failColor: string
} {
  let deviceState: string
  let deviceColor = 'var(--dv-text)'
  switch (dcState) {
    case 'CONFIRMED_ACTIVE':
      deviceState = `Confirmed ${activeWord}`
      deviceColor = 'var(--dv-run)'
      break
    case 'CONFIRMED_PASSIVE':
      deviceState = `Confirmed ${passiveWord}`
      break
    case 'GOING_ACTIVE':
      deviceState = `Going to ${activeWord}`
      deviceColor = 'var(--mode-man)'
      break
    case 'GOING_PASSIVE':
      deviceState = `Going to ${passiveWord}`
      deviceColor = 'var(--mode-man)'
      break
    case 'FAILED_ACTIVE':
      deviceState = `Failed ${activeWord}`
      deviceColor = 'var(--dv-critical)'
      break
    case 'FAILED_PASSIVE':
      deviceState = `Failed ${passiveWord}`
      deviceColor = 'var(--dv-critical)'
      break
    case 'SHUTDOWN':
      deviceState = 'Shutdown'
      deviceColor = 'var(--dv-critical)'
      break
    case 'LOCKED':
      deviceState = 'Locked'
      deviceColor = 'var(--dv-critical)'
      break
    default:
      deviceState = dcState
  }
  let operationState = 'Normal'
  let opColor = 'var(--dv-text-dim)'
  if (interlock) {
    operationState = 'Interlocked'
    opColor = 'var(--dv-critical)'
  } else if (permissiveRequired && !permissiveOk) {
    operationState = 'Permissive Not Met'
    opColor = 'var(--dv-bypass)'
  }
  // A valve that did not confirm its commanded position reports which travel time was exceeded.
  const travelFailure = fault && activeWord === 'Open'
    ? dcState === 'FAILED_ACTIVE' ? 'Open travel time exceeded' : dcState === 'FAILED_PASSIVE' ? 'Close travel time exceeded' : null
    : null
  const failureState = travelFailure ?? (fault ? 'Faulted' : 'Clear')
  const failColor = fault ? 'var(--dv-critical)' : 'var(--dv-text-dim)'
  return { deviceState, deviceColor, operationState, opColor, failureState, failColor }
}

/** Device State / Operation State / Failure State rows, matching the real
 * Motor/Valve faceplate block (IMG_0639.jpeg / IMG_0646.jpeg). */
export function DeviceStateRows({
  dcState,
  interlock,
  permissiveRequired,
  permissiveOk,
  fault,
  activeWord,
  passiveWord
}: {
  dcState: DcState
  interlock: boolean
  permissiveRequired: boolean
  permissiveOk: boolean
  fault: boolean
  activeWord: string
  passiveWord: string
}): JSX.Element {
  const st = deviceStatusBlock(dcState, interlock, permissiveRequired, permissiveOk, fault, activeWord, passiveWord)
  return (
    <div className="fp-devstate-block">
      <div className="fp-devstate-row">
        <span className="fp-label">Device State</span>
        <b style={{ color: st.deviceColor }}>{st.deviceState}</b>
      </div>
      <div className="fp-devstate-row">
        <span className="fp-label">Operation State</span>
        <b style={{ color: st.opColor }}>{st.operationState}</b>
      </div>
      <div className="fp-devstate-row">
        <span className="fp-label">Failure State</span>
        <b style={{ color: st.failColor }}>{st.failureState}</b>
      </div>
    </div>
  )
}

/** REQ. MODE box pair, matching the small requested-mode box + bold
 * actual-mode box seen on every real faceplate reference (PID MAN,
 * speed-motor AUTO, valve CAS). For devices without a separate request/
 * actual distinction, pass the same value for both. */
export function ModeBoxRow({ reqMode, actualMode }: { reqMode: string; actualMode: string }): JSX.Element {
  return (
    <div className="fp-moderow2">
      <span className="fp-label">Req. Mode</span>
      <div className="fp-mode-boxes">
        <span className="fp-mode-box sm">{reqMode}</span>
        <span className="fp-mode-box lg">{actualMode}</span>
      </div>
    </div>
  )
}

/** Modelock Override checkbox — visually matches the reference faceplates,
 * but stays disabled with an honest tooltip: this simulator does not model
 * Equipment Module/Phase acquire-release arbitration (C_ARB_MOD_EM/PH), so a
 * live checkbox would be decorative, not a real control. */
export function ModelockOverrideRow(): JSX.Element {
  return (
    <label
      className="fp-modelock-row"
      title="Modelock Override requires Equipment Module/Phase acquire-release arbitration (C_ARB_MOD_EM/PH), which this simulator does not model yet. Shown for layout fidelity only; not a functional control."
    >
      <input type="checkbox" disabled checked={false} readOnly />
      <span>Modelock Override</span>
    </label>
  )
}

/** Static equipment membership is not live acquire/release ownership. */
export function OwnedByRow({ equipmentModule }: { equipmentModule?: string }): JSX.Element {
  return (
    <div className="fp-owned-block">
      <div className="fp-owned-row">
        <span className="fp-label">Owned by:</span>
        <span title="Equipment Module/Phase acquire-release ownership is not modeled">Not modeled</span>
      </div>
      <div className="fp-owned-row">
        <span className="fp-label">Unit:</span>
        <span>{'\u2014'}</span>
      </div>
      {equipmentModule && <div className="fp-owned-row">
        <span className="fp-label">Equipment Module:</span>
        <span>{equipmentModule}</span>
      </div>}
    </div>
  )
}
