import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChatPanel } from './ChatPanel'
import { PainBar } from './PainBar'
import { RoomIcon } from './icons'
import { Avatar, Badge, IconButton, cn } from '../design/ui'
import type { ChatMessage } from '../domain/visit'
import { SINCE_LABEL, type Intake, type IntakeSince } from '../lib/visits'
import { firstName } from '../lib/names'
import { useNetworkQuality, useParticipantView } from '../sdk'

/* The doctor's right-hand column, 360px: who the patient is, and the chat.

   Two tabs, Patient first, because the doctor's question in a consult is
   "who is this and why are they here", and the intake answers it. Chat keeps
   an unread count on its tab while Patient is showing. Docked on desktop and
   always there; on a tablet it floats over the stage like the patient's chat
   column, so the video is never squeezed. Phone has no rail: chat stays a
   sheet and PatientPanel opens in a sheet of its own.

   Both tab panels stay mounted, so a half-typed message survives a look at
   the intake. */

const ROOM_RAIL_WIDTH = 360

export type RailTab = 'patient' | 'chat'

export interface RoomRailProps {
  overlay: boolean
  open: boolean
  tab: RailTab
  onTab: (tab: RailTab) => void
  onHide: () => void
  messages: ChatMessage[]
  onSend: (text: string) => Promise<void>
  patient: PatientPanelProps
}

export function RoomRail({ overlay, open, tab, onTab, onHide, messages, onSend, patient }: RoomRailProps) {
  /* Everything up to here has been read whenever the Chat tab is on screen. */
  const [seen, setSeen] = useState(messages.length)
  const reading = open && tab === 'chat'
  if (reading && seen !== messages.length) setSeen(messages.length)
  const unread = reading ? 0 : messages.slice(seen).filter((m) => !m.mine).length

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const next = tab === 'patient' ? 'chat' : 'patient'
    onTab(next)
    document.getElementById(`rail-tab-${next}`)?.focus()
  }

  return (
    <aside
      data-room-rail={overlay ? 'overlay' : 'docked'}
      aria-label="Visit panel"
      className={cn(
        'shrink-0 flex-col border-l border-line bg-card',
        open ? 'flex' : 'hidden',
        /* bottom-16 keeps the control bar, and End visit, uncovered. */
        overlay && 'absolute bottom-16 right-0 top-0 z-30',
      )}
      style={{ width: ROOM_RAIL_WIDTH, boxShadow: overlay ? 'var(--elevation-lg)' : undefined }}
    >
      <div className="flex h-14 shrink-0 items-end gap-5 border-b border-line px-5">
        <div role="tablist" aria-label="Visit panel" className="flex items-end gap-5" onKeyDown={onKeyDown}>
          <RailTabButton id="patient" tab={tab} onTab={onTab}>
            Patient
          </RailTabButton>
          <RailTabButton id="chat" tab={tab} onTab={onTab}>
            Chat
            {unread > 0 && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent-mid px-1.5 text-xs font-semibold text-white">
                {unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </RailTabButton>
        </div>
        {overlay && (
          <IconButton variant="ghost" size="sm" className="mb-2.5 ml-auto" aria-label="Hide panel" onClick={onHide}>
            <RoomIcon name="close" size={16} />
          </IconButton>
        )}
      </div>

      <div
        role="tabpanel"
        id="rail-panel-patient"
        aria-labelledby="rail-tab-patient"
        hidden={tab !== 'patient'}
        className="min-h-0 flex-1 overflow-y-auto p-5"
      >
        <PatientPanel {...patient} />
      </div>
      <div
        role="tabpanel"
        id="rail-panel-chat"
        aria-labelledby="rail-tab-chat"
        hidden={tab !== 'chat'}
        className={cn('min-h-0 flex-1 flex-col', tab === 'chat' && 'flex')}
      >
        <ChatPanel messages={messages} onSend={onSend} />
      </div>
    </aside>
  )
}

function RailTabButton({
  id,
  tab,
  onTab,
  children,
}: {
  id: RailTab
  tab: RailTab
  onTab: (tab: RailTab) => void
  children: ReactNode
}) {
  const on = id === tab
  return (
    <button
      type="button"
      role="tab"
      id={`rail-tab-${id}`}
      aria-selected={on}
      aria-controls={`rail-panel-${id}`}
      tabIndex={on ? 0 : -1}
      onClick={() => onTab(id)}
      className={cn(
        'inline-flex h-10 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-1 text-base font-medium',
        on ? 'border-accent-mid text-ink' : 'border-transparent text-ink-tertiary hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/* ---------- Patient tab ---------- */

const EYEBROW = 'text-sm font-semibold uppercase tracking-wide text-accent-strong'
const LABEL = 'text-sm font-medium text-ink-tertiary'

/* Same rule as KnockRow: trimmed, spaces collapsed, case ignored. */
const normalise = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export interface PatientPanelProps {
  /** visits.patient_name, the name the visit was booked under. */
  name: string
  /** The admitted patient on the stage, or null before anyone is in. */
  patientId: string | null
  /** Whole minutes since they reached the stage. */
  minutesIn: number
  knocking: boolean
  /** Only the intake the person in front of the doctor sent; VisitRoom decides. */
  intake: Intake | null
  intakeAt: string | null
  recording: 'off' | 'asking' | 'on'
  closeLook: { back: boolean } | null
}

export function PatientPanel({
  name,
  patientId,
  minutesIn,
  knocking,
  intake,
  intakeAt,
  recording,
  closeLook,
}: PatientPanelProps) {
  const p = useParticipantView(patientId ?? '')
  const network = useNetworkQuality(patientId ?? '')
  const matched = p && normalise(p.name) === normalise(name)

  const camera = !p
    ? 'Not here yet'
    : closeLook
      ? `${closeLook.back ? 'Back' : 'Front'} · close look`
      : p.camOn
        ? 'Front'
        : 'Off'

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar name={p?.name ?? name} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="break-words text-lg font-semibold text-ink">{name}</span>
          <span className="text-sm text-ink-tertiary">
            {p ? `In the visit · ${minutesIn} min` : knocking ? 'In the waiting room' : 'Not here yet'}
          </span>
        </div>
        {matched && <Badge tone="success">Name matched</Badge>}
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-hairline p-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className={EYEBROW}>Intake</span>
          {intake && intakeAt && <span className={LABEL}>sent {sentAt(intakeAt)}</span>}
        </div>
        {!intake ? (
          <p className="text-base text-ink-tertiary">No intake sent.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Reason</span>
              <span className="break-words text-base font-medium text-ink">{intake.reason}</span>
            </div>
            {intake.symptoms && (
              <div className="flex flex-col gap-1">
                <span className={LABEL}>Symptoms</span>
                <span className="whitespace-pre-line break-words text-base text-ink-secondary">
                  {intake.symptoms}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <span className={LABEL}>Started</span>
                <span className="text-base text-ink">{intake.since ? SINCE_LABEL[intake.since] : 'Not given'}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>{intake.pain != null ? `Pain ${intake.pain} of 10` : 'Pain'}</span>
                {intake.pain != null ? (
                  <PainBar value={intake.pain} size="sm" />
                ) : (
                  <span className="text-base text-ink">Not given</span>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <span className={EYEBROW}>This visit</span>
        <Row label="Recording">
          {recording === 'on' ? 'Recording' : recording === 'asking' ? 'Waiting for their OK' : 'Off · needs their OK'}
        </Row>
        <Row label="Their connection">{p ? QUALITY[network] : 'Not here yet'}</Row>
        <Row label="Their camera" strong={closeLook !== null}>
          {camera}
        </Row>
      </section>

      {p && !closeLook && (
        <div className="mt-auto flex items-start gap-3 rounded-xl bg-accent-wash p-3.5">
          <RoomIcon name="scan" size={18} className="mt-0.5 text-accent-strong" />
          <span className="text-sm text-accent-ink">
            <strong className="font-semibold">Need a closer look?</strong> Show me asks {firstName(name)} to switch to
            their back camera.
          </span>
        </div>
      )}
    </div>
  )
}

const QUALITY = { good: 'Good', fair: 'Fair', poor: 'Poor', unknown: 'Not measured yet' } as const

function Row({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium leading-5 text-ink-tertiary">{label}</span>
      <span className={cn('text-right text-base', strong ? 'font-medium text-accent-strong' : 'text-ink')}>
        {children}
      </span>
    </div>
  )
}

/** "18:12" when it was today, the date too otherwise. */
function sentAt(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

/* ---------- The one-glance intake, for the admit card ---------- */

/* SINCE_LABEL reads as a field value; this line needs a sentence. */
const STARTED: Record<IntakeSince, string> = {
  today: 'Started today',
  days: 'Started a few days ago',
  week: 'Started about a week ago',
  longer: 'Started more than a week ago',
}

/** Reason, then "Started ... · Pain N of 10", in the lavender box the admit card uses. */
export function IntakeBrief({ intake }: { intake: Intake }) {
  const line = [intake.since && STARTED[intake.since], intake.pain != null && `Pain ${intake.pain} of 10`]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-accent-wash p-3">
      <span className="text-sm font-medium text-accent-strong">Their intake</span>
      <span className="break-words text-base font-medium text-ink">{intake.reason}</span>
      {line && <span className="text-sm text-ink-secondary">{line}</span>}
    </div>
  )
}
