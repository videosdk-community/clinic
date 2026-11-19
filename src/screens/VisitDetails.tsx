import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Avatar, Badge } from '../design/ui'
import { DoctorShell } from '../components/DoctorShell'
import { IntakeView } from '../components/IntakeView'
import { RecordingList } from '../components/RecordingList'
import { RoomIcon } from '../components/icons'
import { RowSkeleton } from '../components/RowSkeleton'
import { formatVisitTime, getMyVisit, type Visit } from '../lib/visits'
import { listVisitRecordings, type Recording } from '../lib/recordings'

/* /visits/:roomId - one visit, for the doctor who owns it.

   The row comes from Supabase under RLS, so a visit you do not own reads as
   not found. Recordings come through api/recordings.ts, which checks
   ownership itself, as a separate fetch so a slow VideoSDK call never keeps
   the visit off the screen. */

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** "Thu 19 Nov · scheduled 18:30 · ended 18:47". The end gets its own date only when it differs. */
function metaLine(v: Visit): string {
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const parts = [day(v.scheduledAt), `scheduled ${clock(v.scheduledAt)}`]
  if (v.endedAt) {
    parts.push(
      `ended ${day(v.endedAt) === day(v.scheduledAt) ? clock(v.endedAt) : formatVisitTime(v.endedAt)}`,
    )
  }
  return parts.join(' · ')
}

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

  const band = (
    <div className="flex flex-col gap-4">
      <Link
        to="/"
        className="inline-flex w-max items-center gap-1.5 text-base font-medium text-accent-strong hover:text-accent-ink max-sm:min-h-11"
      >
        <RoomIcon name="arrowLeft" size={16} />
        All visits
      </Link>
      {visit && (
        <div className="flex min-w-0 items-center gap-4">
          <Avatar
            name={visit.patientName}
            size="xl"
            className="rounded-full shadow-[0_0_0_3px_var(--surface-card)]"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-4xl font-semibold tracking-tight break-words text-ink">
                {visit.patientName}
              </h1>
              <Badge tone={visit.endedAt ? 'neutral' : 'success'}>
                {visit.endedAt ? 'Ended' : 'Upcoming'}
              </Badge>
            </div>
            <span className="text-base text-ink-secondary">{metaLine(visit)}</span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <DoctorShell band={band}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {visitError ? (
          <Alert tone="danger">{visitError}</Alert>
        ) : visit === undefined ? (
          <RowSkeleton />
        ) : visit === null ? (
          <Alert tone="danger" title="Visit not found">
            It may belong to another account.
          </Alert>
        ) : (
          <article className="vsdk-enter rounded-2xl border border-hairline bg-card p-5 shadow-md sm:p-7">
            <IntakeView intake={visit.intake} intakeAt={visit.intakeAt} variant="full" />
          </article>
        )}

        <aside className="flex min-w-0 flex-col gap-6">
          {visit && (
            <section className="flex flex-col gap-3.5 rounded-2xl border border-hairline bg-card p-5 shadow-md">
              <h2 className="text-lg font-semibold text-ink">Visit record</h2>
              <dl className="grid grid-cols-[minmax(0,130px)_1fr] gap-x-3 gap-y-2.5 text-base">
                <dt className="text-sm leading-5 font-medium text-ink-tertiary">Scheduled</dt>
                <dd className="text-ink">{formatVisitTime(visit.scheduledAt)}</dd>
                {visit.endedAt && (
                  <>
                    <dt className="text-sm leading-5 font-medium text-ink-tertiary">Ended</dt>
                    <dd className="text-ink">{formatVisitTime(visit.endedAt)}</dd>
                  </>
                )}
                <dt className="text-sm leading-5 font-medium text-ink-tertiary">Recording consent</dt>
                <dd className="text-ink">
                  {visit.recordingConsentAt
                    ? `Given by the patient, ${formatVisitTime(visit.recordingConsentAt)}`
                    : 'No recording consent'}
                </dd>
              </dl>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">Recordings</h2>
              {recordings && recordings.length > 0 && <Badge>{recordings.length}</Badge>}
            </div>
            <RecordingList
              recordings={recordings}
              error={recordingsError}
              emptyText="No recordings. A recorded visit appears here a minute or two after it ends."
            />
          </section>
        </aside>
      </div>
    </DoctorShell>
  )
}
