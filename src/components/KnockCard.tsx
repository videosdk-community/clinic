import { KnockRow } from './KnockRow'
import type { EntryRequest } from '../sdk'

/* The doctor's waiting room, floating over the stage.

   It floats because the doctor is looking at the patient, not at a panel, and
   a knock is time-sensitive in a way nothing else in the room is. Every knock
   gets a row, including a second one while the patient is already in: the
   doctor decides, because it may well be a family member. */

export interface KnockCardProps {
  waiting: readonly EntryRequest[]
  /** visits.patient_name - the name the doctor booked the visit under. */
  expectedName: string
  onRespond: (id: string, allow: boolean) => void
}

export function KnockCard({ waiting, expectedName, onRespond }: KnockCardProps) {
  if (waiting.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Waiting to join"
      className="pointer-events-auto w-[360px] max-w-[calc(100vw-40px)] overflow-y-auto rounded-2xl border border-line bg-card"
      style={{ boxShadow: 'var(--elevation-popover)' }}
    >
      <div className="px-4 pb-1 pt-3 text-sm font-semibold text-ink">
        {waiting.length === 1 ? 'Waiting to join' : `Waiting to join (${waiting.length})`}
      </div>

      <div className="divide-y divide-hairline">
        {waiting.map((request) => (
          <KnockRow
            key={request.participantId}
            request={request}
            expectedName={expectedName}
            onRespond={onRespond}
          />
        ))}
      </div>
    </div>
  )
}
