import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Input, Spinner } from '../design/ui'
import { RoomGate, type ExitReason } from './RoomGate'
import { Precall, type JoinDetails } from './Precall'
import { RoomProvider } from '../sdk'
import { useSession } from '../session/useSession'
import { useAuth } from '../auth/context'
import { readDisplayName, writeDisplayName } from '../lib/displayName'
import { formatVisitTime } from '../lib/visits'
import { supabase } from '../lib/supabase'
import type { VisitSession } from '../session/types'

/* /v/:roomId - the one way into a visit, for both sides.

   Not behind RequireAuth. A patient has no account: they type a name, get an
   anonymous Supabase session, and from then on look like any signed-in user
   to api/session.ts, which derives the role from who owns the visit. The room
   id is the only thing the URL carries, and it decides nothing on its own. */

export function JoinRoute() {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const { status } = useAuth()

  if (status === 'loading') return <Centered label="Opening the visit" />
  if (status === 'signedOut') return <PatientEntry roomId={roomId} />
  return <VisitJoin roomId={roomId} />
}

function Centered({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas">
      <Spinner />
      <span className="text-base text-ink-secondary">{label}</span>
    </div>
  )
}

/* The patient's front door: one field. The name rides in user_metadata and
   in localStorage, and it is what the doctor sees on the knock beside the name
   they booked. It is chosen by the client and proves nothing. */
function PatientEntry({ roomId }: { roomId: string }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const chosen = name.trim()
    setBusy(true)
    setError(null)
    writeDisplayName(chosen)
    const { error: err } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: chosen } },
    })
    /* Success needs nothing here: AuthProvider sees the new session and
       JoinRoute moves on to the visit. */
    if (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="vsdk-enter flex w-full max-w-[400px] flex-col gap-6 rounded-2xl border border-line bg-card p-8 shadow-lg">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-ink">Join your visit</h1>
          <p className="text-base text-ink-secondary">
            No account needed. Your doctor will see this name when you ask to join.
          </p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-tertiary">Your name</span>
            <Input
              size="lg"
              required
              autoFocus
              maxLength={80}
              autoComplete="name"
              value={name}
              error={Boolean(error)}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button size="lg" type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Getting you in' : 'Continue'}
          </Button>
        </form>
        <p className="text-sm text-ink-tertiary">
          Are you the doctor?{' '}
          <Link className="text-ink-link hover:underline" to={`/signin?next=${encodeURIComponent(`/v/${roomId}`)}`}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

function VisitJoin({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { status, session, error, retry, refresh } = useSession(roomId)
  const isPatient = user?.is_anonymous === true

  if (status === 'loading') return <Centered label="Opening the visit" />

  if (status === 'error' || !session) {
    const ended = error?.code === 'visit_ended'
    const missing = error?.code === 'visit_not_found'
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6">
        <div className="flex w-full max-w-[420px] flex-col gap-4">
          <Alert
            tone={ended ? 'info' : 'danger'}
            title={ended ? 'Visit ended' : missing ? 'Visit not found' : 'Cannot open this visit'}
          >
            {ended
              ? 'This visit is over, and the link no longer opens it.'
              : missing
                ? 'Check the link you were sent. It may be incomplete.'
                : (error?.message ?? 'Something went wrong.')}
          </Alert>
          <div className="flex justify-center gap-2">
            {!ended && !missing && (
              <Button size="lg" onClick={retry}>
                Try again
              </Button>
            )}
            {!isPatient && (
              <Button size="lg" variant="secondary" onClick={() => navigate('/')}>
                Back to dashboard
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <PrecallThenRoom
      roomId={roomId}
      session={session}
      refresh={refresh}
      /* The patient's typed name; the doctor's name as stamped on the visit. */
      name={session.role === 'doctor' ? session.doctorName : readDisplayName(user)}
    />
  )
}

/* Precall and the room are SIBLINGS, never nested.

   MeetingProvider reads its config on first mount and ignores later changes,
   so precall tracks only take effect if they exist before the provider
   mounts. */
function PrecallThenRoom({
  roomId,
  session,
  refresh,
  name,
}: {
  roomId: string
  session: VisitSession
  refresh: () => Promise<VisitSession>
  name: string
}) {
  const navigate = useNavigate()
  const [joined, setJoined] = useState<JoinDetails | null>(null)
  const [fresh, setFresh] = useState<VisitSession>(session)
  const [joining, setJoining] = useState(false)
  /* Bumped on every re-knock, and used as RoomProvider's key. MeetingProvider
     reads its config once, so there is no way to ask again except to build a
     new provider. */
  const [attempt, setAttempt] = useState(0)
  const [exit, setExit] = useState<ExitReason | null>(null)
  const isDoctor = session.role === 'doctor'

  /* Back to precall rather than straight into a new join. leave() stops the
     tracks handed to the previous provider, so reusing them would give the
     next attempt a dead camera. */
  const askAgain = () => {
    setExit(null)
    setJoined(null)
    setAttempt((n) => n + 1)
  }

  /* The doctor's End never comes through here: VisitRoom ends the meeting
     and navigates away itself, because RoomGate's exits call leave(). */
  const onExit = (reason: ExitReason) => {
    if (reason === 'ask-again') askAgain()
    else setExit(reason)
  }

  if (exit && exit !== 'ask-again') {
    return (
      <ExitScreen
        reason={exit}
        isDoctor={isDoctor}
        onAskAgain={askAgain}
        onHome={() => navigate('/')}
      />
    )
  }

  if (!joined) {
    const when = formatVisitTime(session.scheduledAt)
    return (
      <Precall
        greeting={
          isDoctor
            ? `Your visit with ${session.patientName} at ${when}`
            : `Hi ${session.patientName}, your visit with Dr. ${session.doctorName} at ${when}`
        }
        name={name}
        joinLabel={isDoctor || session.admitted ? 'Join the visit' : 'Ask to join'}
        busy={joining}
        notice={attempt > 0 ? 'You can join again when you are ready.' : undefined}
        onJoin={async (details) => {
          setJoining(true)
          /* Re-mint before mounting the provider. Ten minutes can pass while
             someone picks a microphone, and the token is checked at join. */
          try {
            setFresh(await refresh())
          } catch {
            /* Keep the token we already hold; if it has expired the join will
               fail loudly, which beats blocking on a transient hiccup. */
          }
          setJoining(false)
          setJoined(details)
        }}
      />
    )
  }

  return (
    <RoomProvider
      key={attempt}
      meetingId={fresh.meetingId}
      token={fresh.token}
      name={joined.name}
      participantId={fresh.participantId}
      doctorId={fresh.doctorParticipantId}
      micEnabled={joined.micOn}
      camEnabled={joined.camOn}
      customCameraVideoTrack={joined.tracks.camera}
      customMicrophoneAudioTrack={joined.tracks.microphone}
    >
      <RoomGate session={fresh} roomId={roomId} name={joined.name} onExit={onExit} />
    </RoomProvider>
  )
}

/* Every way out of a visit, said plainly. These render with the provider
   UNMOUNTED, so "declined" can never be confused with "still connecting". */
const EXIT_COPY: Record<
  Exclude<ExitReason, 'ask-again'>,
  { tone: 'info' | 'danger'; title: string; body: string; canAskAgain: boolean }
> = {
  declined: {
    tone: 'info',
    title: 'The doctor did not let you in',
    body: 'They may be finishing another visit, or expecting you at a different time. You can ask again.',
    canAskAgain: true,
  },
  left: {
    tone: 'info',
    title: 'You left the visit',
    body: 'You can join again from this page while the visit is still open.',
    canAskAgain: true,
  },
  ended: {
    tone: 'info',
    title: 'Visit ended',
    body: 'The doctor ended the visit. You can close this page.',
    canAskAgain: false,
  },
  /* participantId is the Supabase user id, so one browser session is one
     seat and the newer tab evicts the older. */
  evicted: {
    tone: 'danger',
    title: 'This visit is open in another tab',
    body: 'One browser can hold one seat, and the newest tab keeps it. Close the others and rejoin here.',
    canAskAgain: true,
  },
}

function ExitScreen({
  reason,
  isDoctor,
  onAskAgain,
  onHome,
}: {
  reason: Exclude<ExitReason, 'ask-again'>
  isDoctor: boolean
  onAskAgain: () => void
  onHome: () => void
}) {
  const copy = EXIT_COPY[reason]
  const home = isDoctor && (
    <Button size="lg" variant="secondary" onClick={onHome}>
      Back to dashboard
    </Button>
  )

  /* The end of a visit is not an error, so it does not get an error card. */
  if (reason === 'ended') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
        <span className="text-2xl font-semibold text-ink">{copy.title}</span>
        <span className="max-w-[420px] text-base text-ink-secondary">{copy.body}</span>
        {home}
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="flex w-full max-w-[420px] flex-col gap-4">
        <Alert tone={copy.tone} title={copy.title}>
          {copy.body}
        </Alert>
        <div className="flex justify-center gap-2">
          {copy.canAskAgain && (
            <Button size="lg" onClick={onAskAgain}>
              {reason === 'declined' ? 'Ask again' : 'Join again'}
            </Button>
          )}
          {home}
        </div>
      </div>
    </div>
  )
}
