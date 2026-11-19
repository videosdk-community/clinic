import { Button, Spinner } from '../design/ui'
import { useElapsedSeconds } from '../lib/useElapsedSeconds'

/* "Waiting to be let in" - the derived lobby state.

   Nothing sends this. A patient holding ask_join reaches CONNECTING and stays
   there, and the SDK has no waiting-room event, so every word on this screen
   is inferred from role plus connection state plus a clock.

   THE SCREEN NEVER NAVIGATES ON ITS OWN. Time changes the words and reveals a
   button; it never decides. A patient about to be admitted at second 95 must
   not be thrown out at 90. */

const STILL_WAITING = 20
const PROBABLY_ABSENT = 60

function copyFor(seconds: number, doctor: string) {
  if (seconds < STILL_WAITING) {
    return {
      headline: `Asking ${doctor} to let you in`,
      detail: 'You are in the waiting room. This usually takes a moment.',
    }
  }
  if (seconds < PROBABLY_ABSENT) {
    return {
      headline: 'Still waiting',
      detail: `${doctor} has your request. They may be finishing another visit.`,
    }
  }
  return {
    headline: 'Nobody has answered yet',
    detail: `${doctor} may not have opened the visit yet, or may have missed the request. You can ask again, or come back later.`,
  }
}

export interface LobbyWaitingProps {
  /** "Dr. Rao", as the greeting reads. */
  doctor: string
  /** When the visit was booked for, already formatted. */
  when: string
  name: string
  /** Shown from the third tier on. Leaves and knocks again from scratch. */
  onAskAgain: () => void
  onLeave: () => void
}

export function LobbyWaiting({ doctor, when, name, onAskAgain, onLeave }: LobbyWaitingProps) {
  const seconds = useElapsedSeconds()
  const { headline, detail } = copyFor(seconds, doctor)
  const canAskAgain = seconds >= PROBABLY_ABSENT

  return (
    <div className="flex h-full overflow-y-auto bg-subtle p-4 sm:p-6">
      <div className="vsdk-enter m-auto flex w-full max-w-[440px] flex-col items-center gap-6 rounded-2xl border border-hairline bg-card p-6 text-center shadow-sm sm:p-8">
        <Spinner size={28} />

        <div className="flex flex-col gap-2" aria-live="polite">
          <h1 className="text-xl font-semibold text-ink">{headline}</h1>
          <p className="text-base leading-[22px] text-ink-secondary">{detail}</p>
        </div>

        {/* Which door they knocked on, and under what name. */}
        <div className="flex w-full flex-col gap-1 rounded-xl bg-inset px-4 py-3">
          <span className="text-base font-medium text-ink">
            Visit with {doctor}
            {when && `, ${when}`}
          </span>
          <span className="text-sm text-ink-tertiary">Joining as {name}</span>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {canAskAgain && (
            <Button size="lg" onClick={onAskAgain}>
              Ask again
            </Button>
          )}
          <Button size="lg" variant="secondary" onClick={onLeave}>
            Leave
          </Button>
        </div>
      </div>
    </div>
  )
}
