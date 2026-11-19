import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spinner } from '../design/ui'
import { useAuth } from './context'

/* Guards a doctor's route, remembering where they were going.

   An anonymous session is a patient who opened a visit link in this browser.
   It is a real Supabase user, but it owns nothing, so for a doctor's route it
   counts as signed out and goes to the magic link. */

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner />
      </div>
    )
  }

  if (status === 'signedOut' || user?.is_anonymous) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/signin?next=${encodeURIComponent(next)}`} replace />
  }

  return <>{children}</>
}
