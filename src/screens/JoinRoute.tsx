import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Avatar, Button, Input, Spinner } from '../design/ui'
import { RoomGate, type ExitReason } from './RoomGate'
import { PatientFrame } from '../components/PatientFrame'
import { drShort, firstName } from '../lib/names'
import { RoomIcon } from '../components/icons'
import { IntakeStep } from './IntakeStep'
import { Precall, type JoinDetails } from './Precall'
import { RoomProvider } from '../sdk'
import { useSession } from '../session/useSession'
import { useAuth } from '../auth/context'
import { readDisplayName, writeDisplayName } from '../lib/displayName'
import { formatVisitTime, type Intake } from '../lib/visits'
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
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-subtle">
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
    <PatientFrame>
      <div className="vsdk-enter flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">Join your visit</h1>
          <p className="m-0 text-base text-ink-secondary">
            No account needed. Your doctor will see this name when you ask to join.
          </p>
        </div>
        <form className="flex flex-1 flex-col gap-5" onSubmit={(e) => void submit(e)}>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-secondary">Your name</span>
            <Input
              size="lg"
              required
              autoFocus
              maxLength={80}
              autoComplete="name"
              value={name}
              error={Boolean(error)}
              className="max-sm:h-11 [&_input]:text-lg"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="mt-auto flex flex-col gap-3">
            <Button
              size="lg"
              type="submit"
              fullWidth
              className="max-sm:h-12 max-sm:text-lg"
              disabled={busy || name.trim() === ''}
            >
              {busy ? 'Getting you in' : 'Continue'}
            </Button>
            <p className="m-0 text-center text-sm text-ink-tertiary">
              Are you the doctor?{' '}
              <Link className="text-ink-link hover:underline" to={`/signin?next=${encodeURIComponent(`/v/${roomId}`)}`}>
                Sign in
              </Link>
            </p>
          </div>
        </form>
      </div>
    </PatientFrame>
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
      <Notice
        title={ended ? 'Visit ended' : missing ? 'Visit not found' : 'Cannot open this visit'}
        body={
          ended
            ? 'This visit is over, and the link no longer opens it.'
            : missing
              ? 'Check the link you were sent. It may be incomplete.'
              : (error?.message ?? 'Something went wrong.')
        }
      >
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
      </Notice>
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
   mounts.

   A patient who has not been let in yet walks three steps: intake, devices,
   then the waiting room. The intake is asked once per page load: re-knocks
   and reconnects keep this component mounted, so they never see it again. An
   admitted patient coming back and the doctor go straight to devices. */
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
  /* Decided on the first render only: being admitted later must not pull the
     steps out from under a patient who is already on them. */
  const [stepped] = useState(!isDoctor && !session.admitted)
  const [intakeDone, setIntakeDone] = useState(!stepped)
  /* What the patient sent. They cannot read the visit back, so this is the
     only copy the waiting room has to show and edit. */
  const [intake, setIntake] = useState<Intake | null>(null)
  /* Summed across attempts, for the ended screen. */
  const [inRoomMs, setInRoomMs] = useState(0)

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
  const onExit = (reason: ExitReason, ms: number) => {
    setInRoomMs((total) => total + ms)
    if (reason === 'ask-again') askAgain()
    else setExit(reason)
  }

  if (exit && exit !== 'ask-again') {
    return (
      <ExitScreen
        reason={exit}
        session={session}
        name={name}
        inRoomMs={inRoomMs}
        onAskAgain={askAgain}
        onHome={() => navigate('/')}
      />
    )
  }

  if (!intakeDone) {
    return (
      <IntakeStep
        roomId={roomId}
        doctorName={session.doctorName}
        scheduledAt={session.scheduledAt}
        patientName={name}
        onDone={(sent) => {
          setIntake(sent)
          setIntakeDone(true)
        }}
      />
    )
  }

  if (!joined) {
    const precall = (
      <Precall
        heading={isDoctor ? 'Ready to join?' : 'Check your camera and mic'}
        greeting={
          isDoctor
            ? `Your visit with ${session.patientName} at ${formatVisitTime(session.scheduledAt)}`
            : undefined
        }
        name={name}
        token={session.token}
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
    return isDoctor ? (
      <PatientFrame>{precall}</PatientFrame>
    ) : (
      <PatientFrame doctorName={session.doctorName} scheduledAt={session.scheduledAt} step={stepped ? 2 : null}>
        {precall}
      </PatientFrame>
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
      <RoomGate
        session={fresh}
        roomId={roomId}
        name={joined.name}
        camera={joined.camOn ? joined.tracks.camera : undefined}
        stepped={stepped}
        intake={intake}
        onIntakeChange={setIntake}
        onExit={onExit}
      />
    </RoomProvider>
  )
}

/* Every way out of a visit, said plainly. These render with the provider
   UNMOUNTED, so "declined" can never be confused with "still connecting". */
const EXIT_COPY: Record<
  Exclude<ExitReason, 'ask-again' | 'ended'>,
  { title: string; body: string }
> = {
  declined: {
    title: 'The doctor did not let you in',
    body: 'They may be finishing another visit, or expecting you at a different time. You can ask again.',
  },
  left: {
    title: 'You left the visit',
    body: 'You can join again from this page while the visit is still open.',
  },
  /* participantId is the Supabase user id, so one browser session is one
     seat and the newer tab evicts the older. */
  evicted: {
    title: 'This visit is open in another tab',
    body: 'One browser can hold one seat, and the newest tab keeps it. Close the others and rejoin here.',
  },
}

function ExitScreen({
  reason,
  session,
  name,
  inRoomMs,
  onAskAgain,
  onHome,
}: {
  reason: Exclude<ExitReason, 'ask-again'>
  session: VisitSession
  name: string
  inRoomMs: number
  onAskAgain: () => void
  onHome: () => void
}) {
  const isDoctor = session.role === 'doctor'
  const home = isDoctor && (
    <Button size="lg" variant="secondary" fullWidth className="max-sm:h-12 max-sm:text-lg" onClick={onHome}>
      Back to dashboard
    </Button>
  )

  if (reason === 'ended') {
    return <EndedScreen session={session} name={name} inRoomMs={inRoomMs} footer={home} />
  }

  const copy = EXIT_COPY[reason]
  return (
    <Notice
      title={copy.title}
      body={copy.body}
      doctorName={isDoctor ? undefined : session.doctorName}
      scheduledAt={session.scheduledAt}
    >
      <Button size="lg" fullWidth className="max-sm:h-12 max-sm:text-lg" onClick={onAskAgain}>
        {reason === 'declined' ? 'Ask again' : 'Join again'}
      </Button>
      {home}
    </Notice>
  )
}

/* "Under a minute", "17 min": the time this page spent in the room. */
function minutes(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m < 1 ? 'Under a minute' : `${m} min`
}

/* The visit is over. Only facts this page holds: who, when, and how long this
   page was in the room (not counted across a reload, so it is left out if the
   page never got in). */
function EndedScreen({
  session,
  name,
  inRoomMs,
  footer,
}: {
  session: VisitSession
  name: string
  inRoomMs: number
  footer: ReactNode
}) {
  const isDoctor = session.role === 'doctor'
  const other = isDoctor ? session.patientName : `Dr. ${session.doctorName}`
  const row = 'flex items-center justify-between gap-3 py-3'

  return (
    <PatientFrame
      hero={
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex size-[72px] items-center justify-center rounded-pill bg-card text-accent-strong ring-8 ring-card/50">
            <RoomIcon name="check" size={32} strokeWidth={2.5} />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">Your visit has ended</h1>
            <p className="m-0 text-base text-ink-secondary">
              {isDoctor ? 'The visit is closed.' : `Thanks for joining, ${firstName(name)}.`}
            </p>
          </div>
        </div>
      }
    >
      <div className="vsdk-enter flex flex-col gap-4">
        <section className="rounded-2xl border border-hairline bg-card px-5 py-2 shadow-md">
          <div className={`${row} justify-start border-b border-muted`}>
            <Avatar name={isDoctor ? session.patientName : session.doctorName} size={44} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-base font-semibold text-ink">{other}</span>
              <span className="text-sm font-medium text-ink-tertiary">Visit ended</span>
            </div>
          </div>
          <div className={`${row} ${inRoomMs > 0 ? 'border-b border-muted' : ''}`}>
            <span className="text-sm font-medium text-ink-tertiary">Date</span>
            <span className="text-base text-ink">{formatVisitTime(session.scheduledAt)}</span>
          </div>
          {inRoomMs > 0 && (
            <div className={row}>
              <span className="text-sm font-medium text-ink-tertiary">Time in the visit</span>
              <span className="text-base text-ink">{minutes(inRoomMs)}</span>
            </div>
          )}
        </section>

        {!isDoctor && (
          <p className="m-0 text-center text-base text-ink-secondary">
            You can close this page. This visit link no longer works, so ask {drShort(session.doctorName)}&apos;s
            clinic for a new one if you need to talk again.
          </p>
        )}
        {footer}
      </div>
    </PatientFrame>
  )
}

/* Every stopping point outside the room - the visit is over, the link is
   wrong, the doctor said no - in the patient frame. None of these is an alarm
   to the person reading it, so none gets an alarm colour; the words carry it. */
function Notice({
  title,
  body,
  doctorName,
  scheduledAt,
  children,
}: {
  title: string
  body: string
  doctorName?: string
  scheduledAt?: string
  children?: ReactNode
}) {
  return (
    <PatientFrame doctorName={doctorName} scheduledAt={scheduledAt}>
      <div className="vsdk-enter flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="m-0 text-base text-ink-secondary">{body}</p>
        </div>
        {/* empty:hidden, not a truthiness check: `children` is an array of
            falses when no button applies, which is truthy. */}
        <div className="mt-auto flex flex-col gap-2 empty:hidden">{children}</div>
      </div>
    </PatientFrame>
  )
}
