import { Navigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Spinner } from '../design/ui'
import { useAuth } from '../auth/context'

/* Where the magic link lands.

   The client is configured with detectSessionInUrl, so by the time this
   renders supabase-js is already exchanging the code in the URL for a
   session; AuthProvider reports it through onAuthStateChange. All this screen
   does is wait, then send the doctor where they were originally going.

   Settled means a permanent account. A browser that was a patient a moment
   ago still holds that anonymous session until the exchange replaces it, and
   redirecting on it would bounce straight back to sign-in. */

function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

export function AuthCallback() {
  const { status, user } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const settled = status === 'signedIn' && user?.is_anonymous === false

  /* Supabase reports a failed exchange in the URL rather than by throwing. */
  const failure = params.get('error_description') ?? params.get('error')

  if (failure) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6">
        <div className="flex w-full max-w-[420px] flex-col gap-4">
          <Alert tone="danger" title="That link did not work">
            {failure}. Links expire, and they only complete in the browser that asked for them.
          </Alert>
          <Button size="lg" onClick={() => (window.location.href = '/signin')}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (settled) return <Navigate to={next} replace />

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas">
      <Spinner />
      <span className="text-base text-ink-secondary">Signing you in</span>
    </div>
  )
}
