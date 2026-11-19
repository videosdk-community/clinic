import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Input, useToast } from '../design/ui'
import { RowSkeleton } from '../components/RowSkeleton'
import { SectionHeader } from '../components/SectionHeader'
import { useAuth } from '../auth/context'
import { supabase } from '../lib/supabase'
import {
  createVisit,
  formatVisitTime,
  listMyVisits,
  visitLink,
  type Visit,
} from '../lib/visits'
import wordmark from '../assets/videosdk-wordmark-black.svg'

/* The doctor's dashboard: book a visit, send its link, start it, look back.

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

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [patientName, setPatientName] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

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

  const upcoming = visits?.filter((v) => !v.endedAt) ?? null
  /* Most recent first: the list is fetched in schedule order for Upcoming. */
  const ended = visits ? visits.filter((v) => v.endedAt).reverse() : null

  return (
    <div className="h-full overflow-y-auto bg-subtle">
      <header className="sticky top-0 z-10 h-14 border-b border-hairline bg-subtle/80 backdrop-blur">
        <div className="mx-auto flex h-full w-full max-w-[760px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={wordmark} alt="VideoSDK" className="h-3.5 shrink-0" />
            <span className="hidden h-4 w-px shrink-0 bg-hairline sm:block" />
            <span className="hidden truncate text-base font-medium text-ink sm:inline">Clinic</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-ink-tertiary">{user?.email}</span>
            <Button variant="text" className="-mr-3 shrink-0 max-sm:h-10" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 pt-6 pb-16 sm:px-6 sm:pt-12">
        <form
          className="vsdk-enter flex flex-col gap-4 rounded-2xl border border-hairline bg-card shadow-sm p-5 sm:p-8"
          onSubmit={(e) => void create(e)}
        >
          <h1 className="text-3xl font-semibold tracking-tight text-ink">New visit</h1>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm text-ink-tertiary">Patient name</span>
              <Input
                size="lg"
                required
                maxLength={80}
                placeholder="Jordan Lee"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-ink-tertiary">Scheduled for</span>
              <Input
                size="lg"
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
            <Button
              size="lg"
              type="submit"
              disabled={creating || patientName.trim() === '' || scheduledAt === ''}
            >
              {creating ? 'Creating' : 'Create visit'}
            </Button>
          </div>
          <p className="text-sm text-ink-tertiary">
            The time is shown to the patient, never enforced. They can join early or late.
          </p>
        </form>

        {createError && (
          <div className="mt-4">
            <Alert tone="danger">{createError}</Alert>
          </div>
        )}

        <section className="mt-10 flex flex-col gap-3">
          <SectionHeader title="Upcoming" count={upcoming?.length} />
          <VisitList
            visits={upcoming}
            error={listError}
            emptyText="No upcoming visits. The visit you create above will appear here."
            onCopy={(id) => void copyLink(id)}
            onStart={(id) => navigate(`/v/${id}`)}
            onDetails={(id) => navigate(`/visits/${id}`)}
          />
        </section>

        <section className="mt-10 flex flex-col gap-3">
          <SectionHeader title="Ended" count={ended?.length} />
          <VisitList
            visits={ended}
            error={listError}
            emptyText="No ended visits yet."
            onDetails={(id) => navigate(`/visits/${id}`)}
          />
        </section>
      </div>
    </div>
  )
}

/* An ended visit gets Details only: the link answers "Visit ended" and a
   start would be refused, so neither is offered. */
function VisitList({
  visits,
  error,
  emptyText,
  onCopy,
  onStart,
  onDetails,
}: {
  visits: Visit[] | null
  error: string | null
  emptyText: string
  onCopy?: (roomId: string) => void
  onStart?: (roomId: string) => void
  onDetails: (roomId: string) => void
}) {
  if (error) return <Alert tone="danger">{error}</Alert>
  if (visits === null) return <RowSkeleton />
  if (visits.length === 0) {
    return <p className="rounded-2xl border border-hairline bg-card shadow-sm px-5 py-6 text-base text-ink-secondary">{emptyText}</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-card shadow-sm">
      {visits.map((v) => (
        <li
          key={v.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-[120ms] ease-standard hover:bg-subtle sm:px-5"
        >
          <div className="flex min-w-[160px] flex-1 flex-col gap-0.5">
            <span className="truncate text-base font-medium text-ink">{v.patientName}</span>
            <span className="truncate text-sm text-ink-tertiary">
              {formatVisitTime(v.endedAt ?? v.scheduledAt)}
            </span>
          </div>
          {/* The name keeps 160px, so on a phone the buttons wrap to their own
              right-aligned line instead of squeezing the date. max-sm:h-10 is a
              40px target for a finger; a pointer keeps the compact 32px. */}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {onCopy && (
              <Button variant="text" className="max-sm:h-10" onClick={() => onCopy(v.roomId)}>
                Copy link
              </Button>
            )}
            <Button variant="text" className="max-sm:h-10" onClick={() => onDetails(v.roomId)}>
              Details
            </Button>
            {onStart && (
              <Button variant="secondary" className="max-sm:h-10" onClick={() => onStart(v.roomId)}>
                Start
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
