import { useState } from 'react'
import type { EntryRequest } from '../sdk'

/* One knock, with the two buttons that answer it.

   The row shows the name the person typed beside the name the doctor booked.
   Comparing the two is the doctor's identity check - the typed name is chosen
   by the client and proves nothing on its own. */

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

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

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-[50%] text-sm font-semibold"
        style={{ background: 'var(--primary-200)', color: 'var(--primary-900)' }}
      >
        {initials(request.name || '?')}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base text-ink">{request.name || 'Someone'}</span>
        <span className="truncate text-sm text-ink-tertiary">Expected: {expectedName}</span>
      </div>

      <button
        type="button"
        disabled={answering}
        onClick={() => respond(false)}
        className="h-7 cursor-pointer rounded-lg border border-line-strong bg-transparent px-2.5 text-sm text-ink-secondary hover:bg-raised disabled:cursor-default disabled:opacity-50"
      >
        Deny
      </button>
      <button
        type="button"
        disabled={answering}
        onClick={() => respond(true)}
        className="h-7 cursor-pointer rounded-lg border-0 px-2.5 text-sm font-medium disabled:cursor-default disabled:opacity-50"
        style={{ background: 'var(--primary-500)', color: 'var(--primary-on)' }}
      >
        Admit
      </button>
    </div>
  )
}
