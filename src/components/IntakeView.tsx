import { Badge } from '../design/ui'
import { RoomIcon } from './icons'
import { PainBar } from './PainBar'
import { formatVisitTime, SINCE_LABEL, type Intake, type IntakeSince } from '../lib/visits'

/* The patient's pre-visit intake, presentational only.

   `full` is the Details page section, heading included. `compact` is the
   boxed preview the dashboard's Next up card shows, and is meant to drop into
   the doctor's side panel and admit card as is. */

export interface IntakeViewProps {
  intake: Intake | null
  intakeAt: string | null
  variant: 'full' | 'compact'
}

/* SINCE_LABEL reads as a field value ("A few days ago"); the compact line
   needs it as the end of a sentence. */
const STARTED: Record<IntakeSince, string> = {
  today: 'Started today',
  days: 'Started a few days ago',
  week: 'Started about a week ago',
  longer: 'Started more than a week ago',
}

/** "18:12" when it was today, the full date and time otherwise. */
function sentAt(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : formatVisitTime(iso)
}

const LABEL = 'text-sm font-medium text-ink-tertiary'

export function IntakeView({ intake, intakeAt, variant }: IntakeViewProps) {
  return variant === 'compact' ? (
    <Compact intake={intake} intakeAt={intakeAt} />
  ) : (
    <Full intake={intake} intakeAt={intakeAt} />
  )
}

function Compact({ intake, intakeAt }: Omit<IntakeViewProps, 'variant'>) {
  if (!intake) {
    return (
      <div className="rounded-xl border border-hairline bg-subtle px-4 py-3 text-base text-ink-tertiary">
        No intake yet. The patient can send one from their link before they join.
      </div>
    )
  }

  const line = [
    intake.since && STARTED[intake.since],
    intake.pain != null && `Pain ${intake.pain} of 10`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-subtle px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={LABEL}>Intake{intakeAt && ` · sent ${sentAt(intakeAt)}`}</span>
        <Badge tone="success">
          <RoomIcon name="check" size={12} strokeWidth={2.5} />
          Intake received
        </Badge>
      </div>
      <p className="text-base font-medium break-words text-ink">{intake.reason}</p>
      {line && <p className="text-sm text-ink-secondary">{line}</p>}
    </div>
  )
}

function Full({ intake, intakeAt }: Omit<IntakeViewProps, 'variant'>) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-accent-wash text-accent-strong">
            <RoomIcon name="clipboard" size={18} />
          </span>
          <h2 className="text-xl font-semibold text-ink">Pre-visit intake</h2>
        </div>
        {intakeAt && <span className={LABEL}>Sent by the patient, {sentAt(intakeAt)}</span>}
      </div>

      {!intake ? (
        <p className="text-base text-ink-secondary">No intake was sent before this visit.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Reason for visit</span>
            <p className="text-2xl font-medium tracking-tight break-words text-ink">{intake.reason}</p>
          </div>

          {intake.symptoms && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Symptoms</span>
              <p className="text-base break-words whitespace-pre-line text-ink-secondary">
                {intake.symptoms}
              </p>
            </div>
          )}

          <div className="grid gap-6 border-t border-hairline pt-5 sm:grid-cols-[200px_1fr]">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Started</span>
              <span className="text-base font-medium text-ink">
                {intake.since ? SINCE_LABEL[intake.since] : 'Not given'}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className={LABEL}>Pain</span>
                {intake.pain != null ? (
                  <span className="text-base font-semibold text-ink">
                    {intake.pain} <span className="font-normal text-ink-tertiary">of 10</span>
                  </span>
                ) : (
                  <span className="text-base font-medium text-ink">Not given</span>
                )}
              </div>
              {intake.pain != null && (
                <>
                  <PainBar value={intake.pain} />
                  <div className="flex justify-between text-sm text-ink-tertiary">
                    <span>0 none</span>
                    <span>10 worst</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
