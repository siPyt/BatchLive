import { useEffect, useRef } from 'react'
import { useStore } from '../engine/store'
import { useSecurity } from '../engine/security'
import { useUi } from '../ui/uiStore'
import { alarmEligible } from '../utils/format'

// Synthesizes the DeltaV-style audible alarm tone: a two-tone alternating
// beep for Critical, a single pulsed chime for Warning. Muted by Horn Silence
// (F8) until a new alarm trips.
export function AlarmAudio(): null {
  const alarms = useStore((s) => s.alarms)
  const modules = useStore((s) => s.modules)
  const hornSilenced = useStore((s) => s.hornSilenced)
  const subscribedAreas = useUi((s) => s.subscribedAreas)
  const hasAreaKey = useSecurity((s) => s.hasAreaKey)
  const ctxRef = useRef<AudioContext | null>(null)
  const lastBeepRef = useRef(0)

  useEffect(() => {
    // DV09-044: the horn must trigger only on the same subscribed-area AND
    // area-write-key eligible set used by the banner's counts/tiles/ack.
    const eligible = alarms.filter((a) =>
      alarmEligible(a, modules[a.moduleTag]?.area, subscribedAreas, hasAreaKey)
    )
    const hasUnackedCritical = eligible.some(
      (a) => a.active && !a.acknowledged && a.priority === 'CRITICAL' && a.shelvedUntil === undefined
    )
    const hasUnackedWarning = eligible.some(
      (a) => a.active && !a.acknowledged && a.priority === 'WARNING' && a.shelvedUntil === undefined
    )
    if (hornSilenced || (!hasUnackedCritical && !hasUnackedWarning)) return
    // The alarm list is recreated every ~100ms scan; throttle so this reads
    // as a periodic chime rather than a continuous buzz.
    const now = performance.now()
    if (now - lastBeepRef.current < 2000) return
    lastBeepRef.current = now

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    if (!ctxRef.current) ctxRef.current = new AudioCtx()
    const ctx = ctxRef.current

    function beep(freq: number, start: number, duration: number): void {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'square'
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + start + 0.01)
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + duration + 0.02)
    }

    if (hasUnackedCritical) {
      beep(800, 0, 0.15)
      beep(1000, 0.18, 0.15)
    } else if (hasUnackedWarning) {
      beep(500, 0, 0.12)
    }
  }, [alarms, hornSilenced, modules, subscribedAreas, hasAreaKey])

  return null
}

