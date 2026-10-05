import type { AnyModule, AlarmPriority } from './types'
import { conditionSourceError, evaluateConditionExpression, type ConditionReference } from './fbCondition'
import { substituteAlarmMessage, type CustomAlarmTypeDef } from './customAlarmTypes'

/**
 * DV09-047 "custom advisory when [condition A] and [condition B] for over
 * N seconds": a reusable two-condition conjunction with a strict elapsed-time
 * delay, bound to a named custom alarm type (Pass59's registry) for its
 * word/type/priority/message. Not a constant checkbox: the conjunction and
 * timer genuinely evaluate real module signals every scan.
 */
export interface ConditionDelayAlarmDef {
  /** The module this alarm is attributed to (ActiveAlarm.moduleTag/moduleDesc). */
  hostTag: string
  /** Key into the deployed customAlarmTypes registry for word/priority/message. */
  customType: string
  /** fbCondition expressions, e.g. "'//LI-101/AI1/PV' > 900" and "'//XV-101/DI1/PV_D' = 0". Both must be true. */
  conditionA: string
  conditionB: string
  /** Strict elapsed-time threshold in seconds: active only once elapsed > delaySeconds. */
  delaySeconds: number
}

export interface ConditionDelayAlarmRuntime {
  elapsed: number
}

export function conditionDelayAlarmDefError(def: ConditionDelayAlarmDef, modules: Record<string, AnyModule>,
  customAlarmTypes: Record<string, CustomAlarmTypeDef>): string | null {
  if (!modules[def.hostTag]) return `Host module ${def.hostTag} does not exist`
  if (!Object.hasOwn(customAlarmTypes, def.customType)) {
    return `Custom alarm type ${def.customType} is not in the deployed Alarm Types setup`
  }
  const a = conditionSourceError(def.conditionA, modules)
  if (a) return `Condition A: ${a}`
  const b = conditionSourceError(def.conditionB, modules)
  if (b) return `Condition B: ${b}`
  if (!Number.isFinite(def.delaySeconds) || def.delaySeconds <= 0) {
    return 'Condition delay must be a finite positive number of seconds'
  }
  return null
}

function resolveRef(modules: Record<string, AnyModule>) {
  return (ref: ConditionReference): { value: number; bad: boolean } => {
    const m = modules[ref.tag]
    if (!m) return { value: NaN, bad: true }
    if (ref.block === 'DI1') return m.type === 'DI' ? { value: m.state ? 1 : 0, bad: !!m.ioBad } : { value: NaN, bad: true }
    if (m.type === 'AI' || m.type === 'PID') return { value: m.pv, bad: m.pvBad }
    return { value: NaN, bad: true }
  }
}

function conditionTrue(expression: string, modules: Record<string, AnyModule>): boolean {
  const result = evaluateConditionExpression(expression, 0, 0, resolveRef(modules))
  return !('error' in result) && result.value !== 0
}

/**
 * Advances the conjunction's elapsed timer by dtSeconds. The timer resets to
 * zero the instant either condition clears (DV09-047 "reset when either
 * condition clears"); it trips only once elapsed STRICTLY exceeds
 * delaySeconds (DV09-047 "strict elapsed threshold"), and can reactivate
 * after any later reset (DV09-047 "reactivation").
 */
export function stepConditionDelayAlarm(runtime: ConditionDelayAlarmRuntime, def: ConditionDelayAlarmDef,
  modules: Record<string, AnyModule>, dtSeconds: number): { runtime: ConditionDelayAlarmRuntime; tripped: boolean } {
  const bothTrue = conditionTrue(def.conditionA, modules) && conditionTrue(def.conditionB, modules)
  if (!bothTrue) return { runtime: { elapsed: 0 }, tripped: false }
  const raw = runtime.elapsed + Math.max(0, dtSeconds)
  // Snap near-exact scan-sum totals to the configured threshold (same tolerance
  // pattern as sfcBlocks.ts's executeSfcBlock) so repeated 0.1s accumulation
  // never trips a fraction of a scan early/late due to floating-point drift.
  const tolerance = Number.EPSILON * Math.max(1, raw, def.delaySeconds) * 64
  const elapsed = Math.abs(raw - def.delaySeconds) <= tolerance ? def.delaySeconds : raw
  return { runtime: { elapsed }, tripped: elapsed > def.delaySeconds }
}

/** The custom alarm type's priority for this alarm, or undefined if its type is not (yet) deployed. */
export function conditionDelayAlarmPriority(def: ConditionDelayAlarmDef,
  customAlarmTypes: Record<string, CustomAlarmTypeDef>): AlarmPriority | undefined {
  return customAlarmTypes[def.customType]?.priority
}

/** DV09-047 "captured message": the custom type's %P1/%P2-substituted message, or undefined if not deployed. */
export function conditionDelayAlarmMessage(def: ConditionDelayAlarmDef,
  customAlarmTypes: Record<string, CustomAlarmTypeDef>, modules: Record<string, AnyModule>): string | undefined {
  const type = customAlarmTypes[def.customType]
  return type ? substituteAlarmMessage(def.hostTag, type, modules) : undefined
}
