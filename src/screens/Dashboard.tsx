import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Avatar, Badge, Button, IconButton, Input, cn, useToast } from '../design/ui'
import { DoctorShell } from '../components/DoctorShell'
import { IntakeView } from '../components/IntakeView'
import { RoomIcon } from '../components/icons'
import { RowSkeleton } from '../components/RowSkeleton'
import { suggestedName, useAuth } from '../auth/context'
import {
  createVisit,
  formatVisitTime,
  listMyVisits,
  visitLink,
  type Visit,
} from '../lib/visits'

/* The doctor's dashboard: who is next, the rest of today, what is coming,
   book a visit, look back.

   The list is read straight from Supabase under RLS rather than through api/.
   The owner-scoped select policy exists for exactly this, and putting it on
   the real path means a mistake in that policy shows up here. */

/* The "I just ended this one" hint, read once and then forgotten.

   It rides on the navigation from the room, and a history entry keeps its
   state for as long as the entry exists. React Router keeps its state under
   `history.state.usr`, so clearing that key drops the hint without touching
   the entry itself. */
function useEndedHint(): string | undefined {
  const state = useLocation().state as { endedRoomId?: string } | null
  const [hint] = useState(state?.endedRoomId)

  useEffect(() => {
    if (!hint) return
    const entry = (window.history.state ?? {}) as Record<string, unknown>
    window.history.replaceState({ ...entry, usr: null }, '')
  }, [hint])

  return hint
}

/** The current time, re-read every `ms`, so countdowns move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

const sameDay = (iso: string, now: number) =>
  new Date(iso).toDateString() === new Date(now).toDateString()

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

const minutes = (m: number) =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`

/* Relative while it is today; a plain date otherwise. The time is shown to
   the patient, never enforced, so "Started" means the slot did. */
function countdown(iso: string, now: number): string {
  if (!sameDay(iso, now)) {
    return Date.parse(iso) < now ? `Was due ${formatVisitTime(iso)}` : formatVisitTime(iso)
  }
  const m = Math.round((Date.parse(iso) - now) / 60_000)
  if (m > 0) return `Starts in ${minutes(m)}`
  if (m === 0) return 'Starting now'
  return `Started ${minutes(-m)} ago`
}

function greeting(now: number): string {
  const h = new Date(now).getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/* 44px targets on a phone; a pointer keeps the compact sizes. */
const TAP = 'max-sm:h-11'

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const now = useNow(30_000)

  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [patientName, setPatientName] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [allComing, setAllComing] = useState(false)
  const [allEnded, setAllEnded] = useState(false)

  /* The doctor who just pressed End is first-hand evidence that the visit is
     over, so the row reads ended from the first paint even though the write
     on the way out was not awaited. */
  const endedHere = useEndedHint()

  const refresh = useCallback(async () => {
    try {
      const mine = await listMyVisits()
      setVisits(
        endedHere
          ? mine.map((v) =>
              v.roomId === endedHere && !v.endedAt ? { ...v, endedAt: new Date().toISOString() } : v,
            )
          : mine,
      )
      setListError(null)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Your visits could not be loaded.')
    }
  }, [endedHere])

  /* Every setState in `refresh` happens after an await; the lint rule cannot
     see that. */
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      /* datetime-local has no zone; Date reads it as the doctor's local time. */
      await createVisit(patientName.trim(), new Date(scheduledAt).toISOString())
      setPatientName('')
      setScheduledAt('')
      toast('Visit created. Copy the link and send it to your patient.', 'success')
      await refresh()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'The visit could not be created.')
    } finally {
      setCreating(false)
    }
  }

  const copyLink = async (roomId: string) => {
    try {
      await navigator.clipboard.writeText(visitLink(roomId))
      toast('Link copied', 'success')
    } catch {
      toast(visitLink(roomId))
    }
  }

  const start = (roomId: string) => navigate(`/v/${roomId}`)
  const details = (roomId: string) => navigate(`/visits/${roomId}`)

  /* Fetched in schedule order, so the first open visit is the next one. An
     overdue visit (earlier, never ended) sorts first and stays in view. */
  const open = visits?.filter((v) => !v.endedAt) ?? []
  const next = open[0]
  const midnight = new Date(now).setHours(24, 0, 0, 0)
  const laterToday = open.slice(1).filter((v) => Date.parse(v.scheduledAt) < midnight)
  const comingUp = open.slice(1).filter((v) => Date.parse(v.scheduledAt) >= midnight)
  const ended = (visits ?? [])
    .filter((v) => v.endedAt)
    .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))

  const todayCount = visits?.filter((v) => sameDay(v.scheduledAt, now)).length ?? 0
  const summary = visits
    ? [
        todayCount === 0 ? 'No visits today.' : `${todayCount} ${todayCount === 1 ? 'visit' : 'visits'} today.`,
        next &&
          (next.intake
            ? `${next.patientName} has sent their intake.`
            : `${next.patientName} has not sent their intake yet.`),
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  const lastName = suggestedName(user).split(/\s+/).at(-1)

  const band = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold tracking-wide text-accent-strong uppercase">
          {new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <h1 className="text-4xl font-semibold tracking-tight break-words text-ink">
          {greeting(now)}, Dr. {lastName}
        </h1>
        <p className="min-h-5 text-base text-ink-secondary">{summary}</p>
      </div>
      <Button
        size="lg"
        className={cn('shrink-0 self-start sm:self-auto', TAP)}
        iconLeft={<RoomIcon name="plus" size={18} />}
        onClick={() => document.getElementById('patient-name')?.focus()}
      >
        New visit
      </Button>
    </div>
  )

  return (
    <DoctorShell band={band} signOut>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,376px)]">
        <div className="flex min-w-0 flex-col gap-6">
          {listError ? (
            <Alert tone="danger">{listError}</Alert>
          ) : visits === null ? (
            <RowSkeleton />
          ) : !next ? (
            <p className="rounded-2xl border border-hairline bg-card px-5 py-6 text-base text-ink-secondary shadow-md">
              No upcoming visits. The visit you create will appear here.
            </p>
          ) : (
            <NextUp
              visit={next}
              now={now}
              onStart={() => start(next.roomId)}
              onCopy={() => void copyLink(next.roomId)}
              onDetails={() => details(next.roomId)}
            />
          )}

          {laterToday.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle title="Later today" count={laterToday.length} />
              <ul className="rounded-2xl border border-hairline bg-card py-2 shadow-sm">
                {laterToday.map((v) => (
                  <TimelineRow
                    key={v.id}
                    visit={v}
                    when={sameDay(v.scheduledAt, now) ? clock(v.scheduledAt) : shortDay(v.scheduledAt)}
                    onCopy={() => void copyLink(v.roomId)}
                    onDetails={() => details(v.roomId)}
                    onStart={() => start(v.roomId)}
                  />
                ))}
              </ul>
            </section>
          )}

          {comingUp.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle
                title="Coming up"
                count={comingUp.length}
                action={
                  comingUp.length > 1 && (
                    <Button variant="text" className={TAP} onClick={() => setAllComing((x) => !x)}>
                      {allComing ? 'Show fewer' : `Show all ${comingUp.length}`}
                    </Button>
                  )
                }
              />
              <ul className="rounded-2xl border border-hairline bg-card py-2 shadow-sm">
                {(allComing ? comingUp : comingUp.slice(0, 1)).map((v) => (
                  <TimelineRow
                    key={v.id}
                    visit={v}
                    when={shortDay(v.scheduledAt)}
                    time={clock(v.scheduledAt)}
                    onCopy={() => void copyLink(v.roomId)}
                    onDetails={() => details(v.roomId)}
                    onStart={() => start(v.roomId)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <form
            className="vsdk-enter flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-5 shadow-md"
            onSubmit={(e) => void create(e)}
          >
            <h2 className="text-lg font-semibold text-ink">New visit</h2>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-tertiary">Patient name</span>
              <Input
                id="patient-name"
                size="lg"
                className={TAP}
                required
                maxLength={80}
                placeholder="Jordan Lee"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-tertiary">Scheduled for</span>
              <Input
                size="lg"
                className={TAP}
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
            <Button
              size="lg"
              type="submit"
              fullWidth
              className={TAP}
              disabled={creating || patientName.trim() === '' || scheduledAt === ''}
            >
              {creating ? 'Creating' : 'Create visit'}
            </Button>
            {createError && <Alert tone="danger">{createError}</Alert>}
            <p className="text-sm text-ink-tertiary">
              The time is shown to the patient, never enforced. They can join early or late.
            </p>
          </form>

          <section className="flex flex-col gap-3">
            <SectionTitle
              title="Ended"
              count={ended.length}
              action={
                ended.length > 3 && (
                  <Button variant="text" className={TAP} onClick={() => setAllEnded((x) => !x)}>
                    {allEnded ? 'Show fewer' : 'View all'}
                  </Button>
                )
              }
            />
            {listError ? (
              <Alert tone="danger">{listError}</Alert>
            ) : visits === null ? (
              <RowSkeleton />
            ) : ended.length === 0 ? (
              <p className="rounded-2xl border border-hairline bg-card px-5 py-6 text-base text-ink-secondary shadow-sm">
                No ended visits yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-card shadow-sm">
                {(allEnded ? ended : ended.slice(0, 3)).map((v) => (
                  <li key={v.id}>
                    <Link
                      to={`/visits/${v.roomId}`}
                      className="flex flex-col gap-1.5 px-4 py-3 transition-colors duration-[120ms] ease-standard hover:bg-subtle"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-base font-medium text-ink">{v.patientName}</span>
                        <span className="shrink-0 text-sm text-ink-tertiary">
                          {sameDay(v.endedAt!, now) ? `Today, ${clock(v.endedAt!)}` : formatVisitTime(v.endedAt!)}
                        </span>
                      </span>
                      {(v.recordingConsentAt || v.intake) && (
                        <span className="flex flex-wrap gap-1.5">
                          {v.recordingConsentAt && <Badge tone="primary">Recording allowed</Badge>}
                          {v.intake && <Badge>Intake</Badge>}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </DoctorShell>
  )
}

/** "Fri 20" for the timeline's date column. */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
}

function SectionTitle({ title, count, action }: { title: string; count: number; action?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {count > 0 && <Badge>{count}</Badge>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

function IntakeChip({ visit }: { visit: Visit }) {
  return visit.intake ? <Badge tone="success">Intake received</Badge> : <Badge>No intake yet</Badge>
}

function NextUp({
  visit,
  now,
  onStart,
  onCopy,
  onDetails,
}: {
  visit: Visit
  now: number
  onStart: () => void
  onCopy: () => void
  onDetails: () => void
}) {
  return (
    <article className="vsdk-enter flex flex-col gap-6 rounded-2xl border border-hairline bg-card p-5 shadow-md sm:flex-row sm:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tracking-wide text-accent-strong uppercase">Next up</span>
          <Badge tone="primary">
            <RoomIcon name="clock" size={12} />
            {countdown(visit.scheduledAt, now)}
          </Badge>
        </div>
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={visit.patientName} size="xl" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="truncate text-3xl font-semibold tracking-tight text-ink">{visit.patientName}</h2>
            <span className="text-base text-ink-secondary">
              {sameDay(visit.scheduledAt, now) ? clock(visit.scheduledAt) : formatVisitTime(visit.scheduledAt)}
              {' · Video visit'}
            </span>
          </div>
        </div>
        <IntakeView intake={visit.intake} intakeAt={visit.intakeAt} variant="compact" />
      </div>
      <div className="flex flex-col justify-end gap-2 sm:w-[168px]">
        <Button size="lg" fullWidth className={TAP} onClick={onStart}>
          Start visit
        </Button>
        <Button
          variant="outlined"
          size="lg"
          fullWidth
          className={TAP}
          iconLeft={<RoomIcon name="copy" size={16} />}
          onClick={onCopy}
        >
          Copy link
        </Button>
        <Button variant="text" size="lg" fullWidth className={TAP} onClick={onDetails}>
          Details
        </Button>
      </div>
    </article>
  )
}

/* One row of the day's timeline: time, ring, who, then the three actions.
   On a phone the actions wrap to their own line under the name. */
function TimelineRow({
  visit,
  when,
  time,
  onCopy,
  onDetails,
  onStart,
}: {
  visit: Visit
  when: string
  /** Set for later days: the time beside the name, and a filled dot instead of a ring. */
  time?: string
  onCopy: () => void
  onDetails: () => void
  onStart: () => void
}) {
  return (
    <li className="mx-4 grid grid-cols-[56px_10px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-hairline py-2.5 not-first:border-t sm:mx-5 sm:grid-cols-[64px_10px_minmax(0,1fr)_auto]">
      <span className={cn('font-semibold tabular-nums', time ? 'text-ink-secondary' : 'text-ink')}>{when}</span>
      <span
        className={cn(
          'size-2.5 rounded-full',
          time ? 'bg-hairline' : 'border-2 border-accent-line bg-card',
        )}
      />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-base font-medium text-ink">
          {visit.patientName}
          {time && <span className="font-normal text-ink-tertiary"> · {time}</span>}
        </span>
        {!time && <IntakeChip visit={visit} />}
      </span>
      <span className="col-span-full flex items-center justify-end gap-1 sm:col-span-1">
        <IconButton aria-label={`Copy link for ${visit.patientName}`} className="max-sm:size-11" onClick={onCopy}>
          <RoomIcon name="copy" size={16} />
        </IconButton>
        <Button variant="text" className={TAP} onClick={onDetails}>
          Details
        </Button>
        <Button variant="outlined" className={TAP} onClick={onStart}>
          Start
        </Button>
      </span>
    </li>
  )
}
