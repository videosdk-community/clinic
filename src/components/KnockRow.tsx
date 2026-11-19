import { useState } from 'react'
import { Avatar, Button, cn } from '../design/ui'
import type { EntryRequest } from '../sdk'

/* One knock, with the two buttons that answer it.

   The row shows the name the person typed beside the name the doctor booked.
   Comparing the two is the doctor's identity check - the typed name is chosen
   by the client and proves nothing on its own - so both are written out in
   full, on their own lines, and never truncated. When they differ (ignoring
   case and spacing) the row turns to the warning tone and says so, because a
   mismatch is exactly the case the check exists for. */

const normalise = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export interface KnockRowProps {
  request: EntryRequest
  expectedName: string
  onRespond: (id: string, allow: boolean) => void
}

export function KnockRow({ request, expectedName, onRespond }: KnockRowProps) {
  /* Optimistic locally too. A decision is a round trip, and a doctor who sees
     no feedback clicks again - which is how someone gets admitted and then
     denied. */
  const [answering, setAnswering] = useState(false)

  const respond = (allow: boolean) => {
    setAnswering(true)
    onRespond(request.participantId, allow)
  }

  const typed = request.name.trim()
  const mismatch = normalise(typed) !== normalise(expectedName)

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <div className="flex items-start gap-3">
        <Avatar name={typed || '?'} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-base">
          <Line label="Typed" value={typed || 'No name given'} strong />
          <Line label="Expected" value={expectedName} />
        </div>
      </div>

      <p
        className={cn(
          'text-sm',
          mismatch
            ? 'rounded-lg border border-warning-border bg-warning-bg px-3 py-2 font-medium text-warning-fg'
            : 'text-success-fg',
        )}
      >
        {mismatch
          ? 'The names do not match. Check who this is before you admit them.'
          : 'Matches the name on the booking.'}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" variant="secondary" disabled={answering} onClick={() => respond(false)}>
          Deny
        </Button>
        <Button size="lg" disabled={answering} onClick={() => respond(true)}>
          Admit
        </Button>
      </div>
    </div>
  )
}

/* "Label: value" with the label in its own column, so the two names line up
   and long ones wrap under themselves. The text content stays the plain
   sentence "Expected: Jordan Lee" for screen readers and scripts/drive.mjs. */
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="grid grid-cols-[72px_1fr] gap-x-2">
      <span className="text-ink-tertiary">{`${label}: `}</span>
      <span className={cn('min-w-0 break-words', strong ? 'font-medium text-ink' : 'text-ink')}>
        {value}
      </span>
    </p>
  )
}
