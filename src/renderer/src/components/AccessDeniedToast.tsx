import { useEffect } from 'react'
import { useSecurity } from '../engine/security'

// Mirrors the DeltaV "Access Denied" dialog shown when a write is attempted
// without the required Lock & Key.
export function AccessDeniedToast(): JSX.Element | null {
  const lastDenied = useSecurity((s) => s.lastDenied)
  const clearDenied = useSecurity((s) => s.clearDenied)

  useEffect(() => {
    if (!lastDenied) return
    const t = setTimeout(clearDenied, 3500)
    return () => clearTimeout(t)
  }, [lastDenied, clearDenied])

  if (!lastDenied) return null

  return (
    <div className="denied-toast" onClick={clearDenied}>
      🔒 {lastDenied}
    </div>
  )
}
