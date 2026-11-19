import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Badge } from '../design/ui'
import { PageShell } from '../components/PageShell'
import { RecordingList } from '../components/RecordingList'
import { RowSkeleton } from '../components/RowSkeleton'
import { SectionHeader } from '../components/SectionHeader'
import { formatVisitTime, getMyVisit, type Visit } from '../lib/visits'
import { listVisitRecordings, type Recording } from '../lib/recordings'

/* /visits/:roomId - one visit, for the doctor who owns it.

   The row comes from Supabase under RLS, so a visit you do not own reads as
   not found. Recordings come through api/recordings.ts, which checks
   ownership itself, as a separate fetch so a slow VideoSDK call never keeps
   the visit off the screen. */

export function VisitDetails() {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined)
  const [visitError, setVisitError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [recordingsError, setRecordingsError] = useState<string | null>(null)

  /* Every setState below happens after an await. */
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void getMyVisit(roomId)
      .then(setVisit)
      .catch((err: unknown) =>
        setVisitError(err instanceof Error ? err.message : 'The visit could not be loaded.'),
      )
    void listVisitRecordings(roomId)
      .then(setRecordings)
      .catch((err: unknown) =>
        setRecordingsError(err instanceof Error ? err.message : 'Recordings could not be loaded.'),
      )
  }, [roomId])

  return (
    <PageShell>
      {visitError ? (
        <Alert tone="danger">{visitError}</Alert>
      ) : visit === undefined ? (
        <RowSkeleton />
      ) : visit === null ? (
        <Alert tone="danger" title="Visit not found">
          It may belong to another account.
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold text-ink">{visit.patientName}</h1>
            <Badge tone={visit.endedAt ? 'neutral' : 'success'} outline>
              {visit.endedAt ? 'Ended' : 'Upcoming'}
            </Badge>
          </div>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-base">
            <dt className="text-ink-tertiary">Scheduled</dt>
            <dd className="text-ink">{formatVisitTime(visit.scheduledAt)}</dd>
            {visit.endedAt && (
              <>
                <dt className="text-ink-tertiary">Ended</dt>
                <dd className="text-ink">{formatVisitTime(visit.endedAt)}</dd>
              </>
            )}
            <dt className="text-ink-tertiary">Recording consent</dt>
            <dd className="text-ink">
              {visit.recordingConsentAt
                ? `Given by the patient, ${formatVisitTime(visit.recordingConsentAt)}`
                : 'No recording consent'}
            </dd>
          </dl>
        </>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <SectionHeader title="Recordings" count={recordings?.length} />
        <RecordingList
          recordings={recordings}
          error={recordingsError}
          emptyText="No recordings. A recorded visit appears here a minute or two after it ends."
        />
      </div>
    </PageShell>
  )
}
