import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { controllerLeds, indicatorState, INDICATOR_NOTE, type Led } from '../engine/controllerLeds'
import type { Controller } from '../engine/hardware'

const COLOR: Record<Led['color'], { on: string; off: string }> = {
  green: { on: '#37d36b', off: '#17361f' },
  red: { on: '#ff4d4d', off: '#3a1717' },
  yellow: { on: '#ffd23f', off: '#3a3217' }
}

/** Re-renders every 250 ms so one-second flashing and random activity LEDs animate. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export function ControllerLedStrip({ controller }: { controller: Controller }): JSX.Element {
  const now = useClock()
  const leds = controllerLeds(controller, now)
  return (
    <span className="controller-leds" role="group" aria-label={`${controller.tag} indicators`} title={INDICATOR_NOTE[indicatorState(controller)]}
      style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {leds.map((led) => (
        <span key={led.id} data-led={led.id} data-on={led.on} aria-label={`${led.label} LED ${led.on ? 'on' : 'off'}`}
          style={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid #000', display: 'inline-block',
            background: led.on ? COLOR[led.color].on : COLOR[led.color].off }} />
      ))}
    </span>
  )
}

/** The Identify pop-up: closing it, like Stop Flashing, ends the Identify state. */
export function IdentifyDialog({ tag }: { tag: string }): JSX.Element | null {
  const controller = useStore((s) => s.hardware.controllers[tag])
  const identify = useStore((s) => s.identifyController)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => { if (controller?.identified) setDismissed(false) }, [controller?.identified])
  if (!controller || !controller.identified || dismissed) return null
  const stop = (): void => { identify(tag, false); setDismissed(true) }
  return (
    <div role="dialog" aria-label={`Identify ${tag}`} className="identify-dialog"
      style={{ position: 'fixed', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 50, padding: 14, minWidth: 340,
        background: 'var(--dv-panel, #1d2733)', border: '1px solid var(--dv-border, #445)', boxShadow: '0 6px 24px #000a' }}
      onKeyDown={(e) => { if (e.key === 'Escape') stop() }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b>Identify — {tag}</b>
        <button className="tbtn sm" aria-label="Close Identify dialog" onClick={stop}>×</button>
      </div>
      <p>The controller indicators are flashing so you can locate it on the network.</p>
      <ControllerLedStrip controller={controller} />
      <p style={{ fontSize: 11 }}>{INDICATOR_NOTE.IDENTIFY} Closing this dialog or choosing Stop Flashing ends the Identify state.</p>
      <button className="tbtn sm" onClick={stop}>Stop Flashing</button>
    </div>
  )
}
