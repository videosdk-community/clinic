import { useEffect, useRef, useState } from 'react'
import { Alert, Avatar, Button } from '../design/ui'
import { useElapsedSeconds } from '../lib/useElapsedSeconds'
import { ApiError } from '../lib/api'
import { submitIntake, type Intake, type IntakeSince } from '../lib/visits'
import { IntakeForm } from './IntakeForm'
import { PatientFrame } from './PatientFrame'
import { drShort } from '../lib/names'
import { RoomIcon } from './icons'

/* "Waiting to be let in" - the derived lobby state, step 3.

   Nothing sends this. A patient holding ask_join reaches CONNECTING and stays
   there, and the SDK has no waiting-room event, so every word on this screen
   is inferred from role plus connection state plus a clock.

   THE SCREEN NEVER NAVIGATES ON ITS OWN. Time changes the words and reveals a
   button; it never decides. A patient about to be admitted at second 95 must
   not be thrown out at 90. */

const STILL_WAITING = 20
const PROBABLY_ABSENT = 60

function copyFor(seconds: number, dr: string) {
  if (seconds < STILL_WAITING) {
    return {
      headline: `${dr} knows you're here`,
      detail: "You're in the waiting room. Keep this page open and they'll let you in.",
    }
  }
  if (seconds < PROBABLY_ABSENT) {
    return {
      headline: `${dr} knows you're here`,
      detail: `Still waiting. ${dr} has your request and may be finishing another visit.`,
    }
  }
  return {
    headline: 'Nobody has answered yet',
    detail: `${dr} may not have opened the visit yet, or may have missed the request. You can ask again, or come back later.`,
  }
}

const SINCE_SUMMARY: Record<IntakeSince, string> = {
  today: 'Started today',
  days: 'Started a few days ago',
  week: 'Started about a week ago',
  longer: 'Started over a week ago',
}

export interface LobbyWaitingProps {
  roomId: string
  /** The doctor's name as stamped on the visit, without "Dr.". */
  doctorName: string
  scheduledAt: string
  name: string
  /** The camera stream the patient joined with, for a muted self-view. */
  camera?: MediaStream
  /** True for a patient who came through the three steps. Shows the stepper and the intake card. */
  stepped: boolean
  /** What the patient sent in step 1, or null if they skipped it. */
  intake: Intake | null
  onIntakeChange: (intake: Intake) => void
  /** Shown from the third tier on. Leaves and knocks again from scratch. */
  onAskAgain: () => void
  onLeave: () => void
}

export function LobbyWaiting({
  roomId,
  doctorName,
  scheduledAt,
  name,
  camera,
  stepped,
  intake,
  onIntakeChange,
  onAskAgain,
  onLeave,
}: LobbyWaitingProps) {
  const seconds = useElapsedSeconds()
  const dr = drShort(doctorName)
  const { headline, detail } = copyFor(seconds, dr)
  const canAskAgain = seconds >= PROBABLY_ABSENT

  return (
    <PatientFrame doctorName={doctorName} scheduledAt={scheduledAt} step={stepped ? 3 : null}>
      <div className="vsdk-enter flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-1" aria-live="polite">
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">{headline}</h1>
          <p className="m-0 text-base text-ink-secondary">{detail}</p>
        </div>

        <SelfView stream={camera} name={name} />

        {stepped && <IntakeCard roomId={roomId} dr={dr} intake={intake} onChange={onIntakeChange} />}

        <div className="mt-auto flex flex-col gap-2">
          {canAskAgain && (
            <Button size="lg" fullWidth className="max-sm:h-12 max-sm:text-lg" onClick={onAskAgain}>
              Ask again
            </Button>
          )}
          <Button size="lg" variant="outlined" fullWidth className="max-sm:h-12 max-sm:text-lg" onClick={onLeave}>
            Leave the waiting room
          </Button>
          <p className="m-0 text-center text-sm text-ink-tertiary">Joining as {name}</p>
        </div>
      </div>
    </PatientFrame>
  )
}

/* Muted and mirrored, like the precall preview. The stream is the one handed
   to the meeting, so this is exactly what the doctor will see. */
function SelfView({ stream, name }: { stream?: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const live = stream?.getVideoTracks().some((t) => t.readyState === 'live') ?? false

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = live ? (stream ?? null) : null
    if (live) el.play().catch(() => {})
  }, [stream, live])

  if (!live) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl bg-inset text-base text-ink-tertiary">
        <Avatar name={name} size={56} />
        Camera is off
      </div>
    )
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-video">
      <video ref={ref} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
      <span className="absolute bottom-2.5 left-2.5 inline-flex h-7 items-center gap-1.5 rounded-lg bg-video/60 px-2.5 text-sm font-medium text-on-video">
        <span className="size-1.5 rounded-pill bg-success-dot" />
        Your camera is ready
      </span>
    </div>
  )
}

/* What the patient told the doctor, and the way to change it while they wait.
   The server accepts a re-send until someone is let in; a 403 after that is
   not an error the patient caused, so it is said calmly and the card locks. */
function IntakeCard({
  roomId,
  dr,
  intake,
  onChange,
}: {
  roomId: string
  dr: string
  intake: Intake | null
  onChange: (intake: Intake) => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  const save = async (next: Intake) => {
    setBusy(true)
    setError(null)
    try {
      await submitIntake(roomId, next)
      onChange(next)
      setEditing(false)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
        setLocked(true)
        setEditing(false)
      } else {
        setError(err instanceof Error ? err.message : 'Your answers could not be saved. Try again.')
      }
    }
    setBusy(false)
  }

  if (editing) {
    return (
      <section aria-label={`Edit what you told ${dr}`} className="rounded-xl border border-hairline p-3.5">
        <IntakeForm
          initial={intake}
          submitLabel="Save"
          busy={busy}
          error={error}
          onSubmit={(next) => void save(next)}
          onCancel={() => {
            setEditing(false)
            setError(null)
          }}
        />
      </section>
    )
  }

  const lockedNote = locked && (
    <Alert tone="neutral">These answers can't be changed any more. You can tell {dr} in the visit.</Alert>
  )

  if (!intake) {
    return (
      lockedNote || (
        <Button
          size="lg"
          variant="outlined"
          fullWidth
          className="max-sm:h-11"
          iconLeft={<RoomIcon name="pencil" size={16} />}
          onClick={() => setEditing(true)}
        >
          Add details for {dr}
        </Button>
      )
    )
  }

  const meta = [intake.since && SINCE_SUMMARY[intake.since], intake.pain !== null && `Pain ${intake.pain} of 10`]
    .filter(Boolean)
    .join(' · ')

  return (
    <section aria-label={`What you told ${dr}`} className="flex flex-col gap-2 rounded-xl border border-hairline p-3.5">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink-secondary">What you told {dr}</span>
        {!locked && (
          <Button
            variant="link"
            className="max-sm:h-11"
            iconLeft={<RoomIcon name="pencil" size={14} />}
            aria-label={`Edit what you told ${dr}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>
      <span className="text-base font-medium break-words text-ink">{intake.reason}</span>
      {intake.symptoms && <span className="line-clamp-2 text-base break-words text-ink-secondary">{intake.symptoms}</span>}
      {meta && <span className="text-sm text-ink-secondary">{meta}</span>}
      {lockedNote}
    </section>
  )
}
