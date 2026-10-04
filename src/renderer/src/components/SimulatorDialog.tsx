import { useEffect, useRef, type ReactNode } from 'react'
import { useSecurity } from '../engine/security'

export function SimulatorDialog({ label, className, onClose, children }: {
  label: string; className: string; onClose: () => void; children: ReactNode
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const locked = useSecurity(s => s.locked)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    if (element && !element.open) element.showModal()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  useEffect(() => {
    if (locked) { dialog.current?.close(); onClose() }
  }, [locked, onClose])
  return <dialog ref={dialog} className={className} aria-label={label}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose() }}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}>
    {children}
  </dialog>
}
