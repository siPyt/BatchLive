import { useState } from 'react'
import { useSecurity } from '../engine/security'
import type { LockType } from '../engine/security'
import type { Controller } from '../engine/hardware'
import { helpFor, type ControllerHelpTopic } from '../engine/contextHelp'

const KEYS: LockType[] = ['DIAGNOSTIC', 'CAN_CONFIGURE', 'CAN_DOWNLOAD']

/** "What's This?" button: explains a controller control and shows which prerequisites are met right now. */
export function WhatsThis({ topic, controller }: { topic: ControllerHelpTopic; controller: Controller }): JSX.Element {
  const [open, setOpen] = useState(false)
  // Subscribing re-renders the popover when keys change; hasLock is read at render time.
  useSecurity((s) => s.currentUser)
  useSecurity((s) => s.groups)
  useSecurity((s) => s.users)
  const keys = new Set(KEYS.filter((lock) => useSecurity.getState().hasLock(lock)))
  const { entry, prerequisites, ready } = helpFor(topic, { controller, keys })
  return (
    <span className="whats-this" style={{ position: 'relative', display: 'inline-block' }}>
      <button className="tbtn sm" aria-label={`What's This? ${entry.title}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>?</button>
      {open && (
        <div role="note" aria-label={`Help: ${entry.title}`}
          style={{ position: 'absolute', zIndex: 40, top: '100%', left: 0, width: 320, padding: 10, textAlign: 'left', textTransform: 'none', fontWeight: 400, cursor: 'default',
            background: 'var(--dv-panel, #1d2733)', border: '1px solid var(--dv-border, #445)', boxShadow: '0 6px 24px #000a', fontSize: 12 }}>
          <b>{entry.title}</b> <span style={{ color: 'var(--dv-text-mute)' }}>(course {entry.source})</span>
          <p>{entry.body}</p>
          <div><b>{ready ? 'Ready: all prerequisites are met' : 'Not ready yet'}</b></div>
          <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
            {prerequisites.map((p) => <li key={p.text} data-met={p.met}>{p.met ? '✓' : '✗'} {p.text}</li>)}
          </ul>
          <button className="tbtn sm" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </span>
  )
}
