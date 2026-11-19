import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Input, Spinner } from '../design/ui'
import { useAuth } from '../auth/context'
import { supabase } from '../lib/supabase'
import wordmark from '../assets/videosdk-wordmark-white.svg'

/* Doctor sign-in, by magic link. Patients never come here: they type a name
   on the visit link and get an anonymous session there.

   The optional name rides along as user_metadata.display_name, which is what
   api/visits.ts reads when it stamps a visit with the doctor's name. Supabase
   only applies `data` when the account is created, so it is a first-time
   field in practice.

   emailRedirectTo is built from window.location.origin, never a hardcoded
   URL, so localhost and the deployed domain both work from one build. */

function safeNext(raw: string | null): string {
  /* Only same-site paths. An open redirect on an auth screen is the one place
     it really matters. */
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

/* The built-in sender allows only a handful of messages an hour for the whole
   project, and "email rate limit exceeded" tells the person at the keyboard
   nothing they can act on. Match the stable code, with the message as a
   fallback for an older gotrue. */
function isRateLimited(err: { code?: string; message: string }): boolean {
  if (err.code === 'over_email_send_rate_limit') return true
  return err.message.toLowerCase().includes('rate limit')
}

export function SignIn() {
  const { status, user } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner />
      </div>
    )
  }
  /* A patient's anonymous session stays here: it is not a doctor account. */
  if (status === 'signedIn' && !user?.is_anonymous) {
    return <Navigate to={next} replace />
  }

  const sendLink = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setState('sending')

    const chosen = name.trim()
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
        data: chosen ? { display_name: chosen } : undefined,
      },
    })

    if (err) {
      setError(
        isRateLimited(err)
          ? 'Too many sign-in emails have gone out from this project in the last hour. Wait a little and try again.'
          : err.message,
      )
      setState('idle')
      return
    }
    setState('sent')
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <img src={wordmark} alt="VideoSDK" className="h-5" />
          <div className="h-5 w-px bg-hairline" />
          <span className="text-lg font-medium text-ink">Clinic</span>
        </div>

        <div className="vsdk-enter flex w-full flex-col gap-6 rounded-2xl border border-line bg-card p-8 shadow-lg">
          <h1 className="text-2xl font-semibold text-ink">Doctor sign in</h1>

          {state === 'sent' ? (
            <Alert tone="success" title="Check your email">
              We sent a link to <span className="text-ink">{email.trim()}</span>. Open it in this
              browser to finish. It only works in the browser that asked for it.
            </Alert>
          ) : (
            <>
              <form className="flex flex-col gap-3" onSubmit={(e) => void sendLink(e)}>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm text-ink-tertiary">Email</span>
                  <Input
                    size="lg"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    error={Boolean(error)}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm text-ink-tertiary">
                    Your name (shown to patients as Dr. ...)
                  </span>
                  <Input
                    size="lg"
                    maxLength={80}
                    autoComplete="name"
                    placeholder="Optional"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

                {error && <Alert tone="danger">{error}</Alert>}

                <Button
                  size="lg"
                  type="submit"
                  disabled={state === 'sending' || email.trim() === ''}
                >
                  {state === 'sending' ? 'Sending the link' : 'Send me a link'}
                </Button>
              </form>

              <p className="text-sm text-ink-tertiary">
                No password. We email you a link that signs you in. Patients do not need an
                account: they join from the link you send them.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
