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
      className="pointer-events-auto w-[312px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line-strong bg-card"
      style={{ boxShadow: 'var(--elevation-popover)' }}
    >
      <div className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-ink-tertiary">
        {waiting.length === 1 ? 'Waiting to join' : `Waiting to join (${waiting.length})`}
      </div>

      {waiting.map((request) => (
        <KnockRow
          key={request.participantId}
          request={request}
          expectedName={expectedName}
          onRespond={onRespond}
        />
      ))}
    </div>
  )
}
