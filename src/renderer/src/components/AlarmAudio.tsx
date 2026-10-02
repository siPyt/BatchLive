import { useEffect, useRef } from 'react'
import { useStore } from '../engine/store'

// Synthesizes the DeltaV-style audible alarm tone: a two-tone alternating
// beep for Critical, a single pulsed chime for Warning. Muted by Horn Silence
// (F8) until a new alarm trips.
export function AlarmAudio(): null {
  const alarms = useStore((s) => s.alarms)
  const hornSilenced = useStore((s) => s.hornSilenced)
  const ctxRef = useRef<AudioContext | null>(null)
  const lastBeepRef = useRef(0)

  useEffect(() => {
    const hasUnackedCritical = alarms.some(
      (a) => a.active && !a.acknowledged && a.priority === 'CRITICAL' && a.shelvedUntil === undefined
    )
    const hasUnackedWarning = alarms.some(
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
  }, [alarms, hornSilenced])

  return null
}
