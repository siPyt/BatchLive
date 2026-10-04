import { useEffect, useRef, type ReactNode } from 'react'
import { useSecurity } from '../engine/security'

export function SimulatorDialog({ label, className, onClose, children }: {
  label: string; className: string; onClose: () => void; children: ReactNode
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const locked = useSecurity(s => s.locked)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    if (locked) { dialog.current?.close(); onClose() }
  }, [locked, onClose])
  return <dialog ref={dialog} className={className} aria-label={label} onCancel={onClose}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
    {children}
  </dialog>
}
