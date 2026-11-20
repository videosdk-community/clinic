import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'
import { ControlBar } from '../components/ControlBar'
import { KnockCard } from '../components/KnockCard'
import { LeavePrompt } from '../components/LeavePrompt'
import { LiveTile } from '../components/LiveTile'
import { MediaRequestPrompt } from '../components/MediaRequestPrompt'
import { RoomIcon } from '../components/icons'
import { RecordingConsentPrompt } from '../components/RecordingConsentPrompt'
import { PatientPanel, RoomRail, type RailTab } from '../components/RoomRail'
import { ScreenStage } from '../components/ScreenStage'
import { ShowMePrompt } from '../components/ShowMePrompt'
import { SidePanel } from '../components/SidePanel'
import { Avatar, BottomSheet, Button, Spinner, useToast } from '../design/ui'
import { firstName } from '../lib/names'
import {
  admitPatient,
  endVisit,
  formatVisitTime,
  getMyVisit,
  visitLink,
  wasAdmitted,
  type Visit,
} from '../lib/visits'
import { useDeviceClass } from '../lib/useDeviceClass'
import { useElapsedSeconds } from '../lib/useElapsedSeconds'
import { useExitGuard } from '../lib/useExitGuard'
import {
  CHAT_TOPIC,
  useDoctorId,
  useEntryQueue,
  useIsRecording,
  useLocalId,
  useMediaRequest,
  useParticipantIds,
  useParticipantView,
  usePresenterId,
  useRoomActions,
  useRoomError,
  useTopic,
} from '../sdk'
import type { VisitSession } from '../session/types'
import { useRecordingConsent } from './useRecordingConsent'
import { useShowMe } from './useShowMe'

/* The visit: two people, one stage.

   The other person's video fills the stage and your own camera sits in a
   picture-in-picture corner. A screen share, from either side, takes the stage
   and the other person's video shrinks into the corner beside yours. This file
   never mentions the SDK - it reads app-shaped types from src/sdk. */

/* getDisplayMedia is absent on mobile browsers entirely, and on an insecure
   origin mediaDevices itself is undefined. Read once at module scope. */
const SCREEN_SHARE_SUPPORTED =
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

/* m:ss under an hour, h:mm:ss over it. */
function formatClock(total: number) {
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/* "18:30" for a visit today, the date too otherwise. */
function scheduledLabel(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : formatVisitTime(iso)
}

export interface VisitRoomProps {
  session: VisitSession
  roomId: string
  /** The SDK is reconnecting after the first join. The room stays on screen. */
  reconnecting: boolean
  /** The patient's exit. The doctor's End is handled here instead. */
  onLeave: () => void
}

export function VisitRoom({ session, roomId, reconnecting, onLeave }: VisitRoomProps) {
  const isDoctor = session.role === 'doctor'
  const ids = useParticipantIds()
  const localId = useLocalId()
  const doctorId = useDoctorId()
  const presenterId = usePresenterId()
  const recording = useIsRecording()
  const waiting = useEntryQueue()
  const mediaRequest = useMediaRequest()
  const roomError = useRoomError()
  const messages = useTopic(CHAT_TOPIC)
  const actions = useRoomActions()
  const navigate = useNavigate()
  const toast = useToast()
  const deviceClass = useDeviceClass()
  const isPhone = deviceClass === 'phone'
  const seconds = useElapsedSeconds()
  const elapsed = formatClock(seconds)

  /* The patient's chat column, and the doctor's chat sheet on a phone. */
  const [chatOpen, setChatOpen] = useState(false)
  /* The doctor's rail: which tab, and whether it is out. Until the doctor
     chooses, it is out on desktop (docked) and in on a tablet (it would cover
     the stage). Hiding it gives the patient's video the whole width. */
  const [railTab, setRailTab] = useState<RailTab>('patient')
  const [railChoice, setRailChoice] = useState<boolean | null>(null)
  const [patientSheet, setPatientSheet] = useState(false)

  /* Asked only when a Back gesture is caught, never by the Leave button. */
  const [confirmLeave, setConfirmLeave] = useState(false)
  useExitGuard(true, useCallback(() => setConfirmLeave(true), []))

  /* Who the visit is with. For the patient that is the doctor, found by the
     server-derived id; for the doctor it is whoever was admitted first.
     Anyone else admitted later rides along in the corner. */
  const remotes = ids.filter((id) => id !== localId)
  const mainId =
    !isDoctor && doctorId && remotes.includes(doctorId) ? doctorId : (remotes[0] ?? null)
  const others = remotes.filter((id) => id !== mainId)
  const self = useParticipantView(localId ?? '')
  const main = useParticipantView(mainId ?? '')
  const presenter = useParticipantView(presenterId ?? '')
  const otherName = isDoctor ? session.patientName : `Dr. ${session.doctorName}`

  /* The doctor asks whoever is on the stage, never themselves. */
  const consent = useRecordingConsent(roomId, isDoctor, isDoctor ? mainId : null, session.patientName)
  const showMe = useShowMe(isDoctor, isDoctor ? mainId : null, session.patientName)

  /* When whoever is on the stage got there, on the room's own clock, for
     "In the visit · 6 min". Adjusted during render, so a rejoin under a new
     id starts over. */
  const [arrival, setArrival] = useState({ id: mainId, at: seconds })
  if (arrival.id !== mainId) setArrival({ id: mainId, at: seconds })

  /* The doctor's exit ends the visit for both people: end(), never leave()
     after it - the room is already closing, and leave() on a closing room
     throws. end() closes the room at VideoSDK and nothing else, so the visit
     row is marked ended here too, which is what makes the link say "Visit
     ended" afterwards.

     The write is NOT awaited. It loses a race against the dashboard's own
     fetch while the meeting tears down, so the navigation carries
     `endedRoomId` and the dashboard marks the row ended from its first paint.
     Replace rather than push, so Back does not return to a closed room. */
  const exit = useCallback(() => {
    if (!isDoctor) {
      onLeave()
      return
    }
    actions.end()
    void endVisit(roomId).catch((err: unknown) =>
      console.warn('[clinic] could not mark the visit ended', err),
    )
    navigate('/', { replace: true, state: { endedRoomId: roomId } })
  }, [isDoctor, onLeave, actions, roomId, navigate])

  /* Announced on the transition rather than on the click, so the toast says
     what the SDK actually did. */
  const wasRecording = useRef(recording)
  useEffect(() => {
    if (wasRecording.current === recording) return
    wasRecording.current = recording
    toast(recording ? 'Recording started' : 'Recording stopped', recording ? 'danger' : 'neutral')
  }, [recording, toast])

  useEffect(() => {
    if (roomError) toast(roomError.message, 'danger')
  }, [roomError, toast])

  /* Admit records the admission on the server first, so the same browser can
     rejoin without knocking. If that write fails the patient is still let in -
     the doctor decided, and the visit matters more than the shortcut - but
     the doctor is told what it costs. */
  const respond = async (id: string, allow: boolean) => {
    if (allow) {
      try {
        await admitPatient(roomId, id)
      } catch {
        toast('Admitted, but not saved. If they drop out, they will knock again.', 'warning')
      }
    }
    setUnknownKnocks((s) => without(s, id))
    await actions.respondEntry(id, allow)
  }

  /* A knock from someone the doctor already admitted is a reconnect, not a
     new arrival. A patient who joined on ask_join keeps that token, and when
     their network drops the SDK's own reconnect goes back through the lobby:
     they sit on "Reconnecting..." and the doctor gets a fresh card. So every
     knock is checked against the visit's admitted list first, and a match is
     let straight back in. The id is the participantId inside a token our
     server signed, so a stranger cannot claim it. Only knocks that are not on
     the list reach the card. */
  const [unknownKnocks, setUnknownKnocks] = useState<ReadonlySet<string>>(new Set())
  const checking = useRef(new Set<string>())
  useEffect(() => {
    if (!isDoctor) return
    for (const { participantId: id } of waiting) {
      if (unknownKnocks.has(id) || checking.current.has(id)) continue
      checking.current.add(id)
      wasAdmitted(roomId, id)
        .then((admitted) => {
          if (admitted) void actions.respondEntry(id, true)
          else setUnknownKnocks((s) => new Set(s).add(id))
        })
        /* When the check cannot answer, the doctor decides. */
        .catch(() => setUnknownKnocks((s) => new Set(s).add(id)))
        .finally(() => checking.current.delete(id))
    }
  }, [isDoctor, waiting, unknownKnocks, roomId, actions])
  const knocks = waiting.filter((r) => unknownKnocks.has(r.participantId))

  /* The visit row, for the intake. The patient can still edit it from the
     lobby while knocking, so it is read again every 5s while a knock is up -
     and once as each knock appears and clears. The doctor-only read is RLS. */
  const [visit, setVisit] = useState<Visit | null>(null)
  const hasKnocks = knocks.length > 0
  useEffect(() => {
    if (!isDoctor) return
    let live = true
    const load = () =>
      getMyVisit(roomId)
        .then((v) => live && setVisit(v))
        .catch((err: unknown) => console.warn('[clinic] could not read the visit', err))
    void load()
    const poll = hasKnocks ? window.setInterval(() => void load(), 5000) : undefined
    return () => {
      live = false
      window.clearInterval(poll)
    }
  }, [isDoctor, roomId, hasKnocks])

  /* The rail shows the intake only when it came from the person in front of
     the doctor: the one on the stage, or else the one knocking. With nobody
     here yet there is no one to mismatch, so it shows whatever was sent. */
  const intakeFrom = mainId ?? knocks[0]?.participantId ?? null
  const railIntake =
    visit && (intakeFrom === null || visit.intakeBy === intakeFrom) ? visit : null

  const copyLink = () =>
    navigator.clipboard
      .writeText(visitLink(roomId))
      .then(() => toast('Visit link copied', 'success'))
      .catch(() => toast('Could not copy the link. Copy it from the dashboard.', 'danger'))

  /* Mute is real; unmute only asks, and the patient answers on their side.
     It sits beside the patient's name chip in the same dark glass, so it reads
     as "about this person". The ::after widens the hit area to 40px for a
     finger without making the chip itself any bigger. */
  const moderate = isDoctor && main && (
    <button
      type="button"
      onClick={() => (main.micOn ? actions.muteParticipant(main.id) : actions.askToUnmute(main.id))}
      title={main.micOn ? `Mute ${main.name}` : `Ask ${main.name} to unmute`}
      className="relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-video/60 px-2 text-sm text-on-video backdrop-blur-sm after:absolute after:-inset-1.5 after:content-[''] hover:bg-video/80"
    >
      <RoomIcon name={main.micOn ? 'micOff' : 'mic'} size={12} />
      {main.micOn ? 'Mute' : 'Ask to unmute'}
    </button>
  )

  const chatMessages = messages.map((m) => ({
    id: m.key,
    who: m.senderName,
    text: m.text,
    mine: m.senderId === localId,
  }))
  const send = (text: string) => actions.publish(CHAT_TOPIC, text)

  const patientPanel = {
    name: session.patientName,
    patientId: mainId,
    minutesIn: Math.floor((seconds - arrival.at) / 60),
    knocking: hasKnocks,
    intake: railIntake?.intake ?? null,
    intakeAt: railIntake?.intakeAt ?? null,
    recording: recording ? 'on' : consent.pending ? 'asking' : 'off',
    closeLook: showMe.active,
  } as const
  const patientFirst = firstName(session.patientName)
  const knocker = knocks[0]
  const when = scheduledLabel(session.scheduledAt)

  const railOpen = railChoice ?? deviceClass === 'desktop'
  /* Everything up to here has been read whenever the rail's Chat tab is on
     screen. Counted here, not in the rail, so the panel toggle can carry it
     while the rail is hidden. */
  const [railSeen, setRailSeen] = useState(messages.length)
  const railReading = railOpen && railTab === 'chat'
  if (railReading && railSeen !== messages.length) setRailSeen(messages.length)
  const railUnread = railReading ? 0 : messages.slice(railSeen).filter((m) => m.senderId !== localId).length

  const pip = isPhone ? 'aspect-[3/4] w-24' : 'aspect-video w-44 lg:w-56'

  return (
    <div data-room className="relative flex h-full flex-col bg-canvas">
      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className={isPhone ? 'min-h-0 flex-1 p-2' : 'min-h-0 flex-1 p-4'}>
            <div className="relative h-full w-full overflow-hidden rounded-2xl border border-hairline bg-subtle">
              {presenterId ? (
                <ScreenStage
                  presenterId={presenterId}
                  presenterName={presenter?.name ?? otherName}
                  isSelf={presenterId === localId}
                  onStop={() => void actions.toggleScreenShare()}
                />
              ) : mainId ? (
                <div className="absolute inset-0">
                  <LiveTile
                    id={mainId}
                    selfId={localId}
                    /* A phone is portrait and the camera is landscape, so
                       cover fills it; a wide screen letterboxes instead of
                       cropping someone's face. A close look never crops:
                       the edge of a rash is the point. */
                    fit={isPhone && !showMe.active ? 'cover' : 'contain'}
                    action={moderate}
                    className="h-full w-full"
                  />
                </div>
              ) : isDoctor ? (
                /* Who the doctor is waiting for, and the link in case they
                   never got it. A knock turns the heading into the news. */
                <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
                  <div className="relative mb-3">
                    <span aria-hidden className="absolute -inset-3 rounded-pill border-2 border-solid border-accent-soft" />
                    <span aria-hidden className="absolute -inset-6 rounded-pill border border-solid border-accent-wash" />
                    <Avatar name={knocker?.name || session.patientName} size={96} />
                  </div>
                  <div className="mt-3 flex max-w-[360px] flex-col gap-1">
                    <h2 className="text-2xl font-semibold text-ink">
                      {knocker ? `${knocker.name.trim() || 'Someone'} is knocking` : `Waiting for ${otherName}`}
                    </h2>
                    <p className="text-base text-ink-secondary">
                      {when && `Scheduled for ${when}. `}
                      {knocker
                        ? 'Check the name and their intake, then let them in.'
                        : 'They will knock when they open the link. You decide who comes in.'}
                    </p>
                  </div>
                  <Button variant="secondary" size="md" iconLeft={<RoomIcon name="copy" size={16} />} onClick={copyLink}>
                    Copy visit link
                  </Button>
                </div>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-6 text-center">
                  <span className="text-lg font-semibold text-ink">Waiting for {otherName}</span>
                  <span className="max-w-[360px] text-base text-ink-secondary">
                    They will be with you shortly.
                  </span>
                </div>
              )}

              {/* Red and solid on both sides, with Stop on the pill itself: on a
                  phone the control bar's Stop is one sheet away, and either
                  person stopping is a direct call, not a request. A patient
                  who joins mid-recording sees it from the SDK's state. */}
              {(recording || reconnecting || consent.pending || showMe.pending || showMe.active) && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-wrap justify-center gap-2 px-3">
                  {recording && (
                    <span
                      role="status"
                      className="pointer-events-auto flex h-9 items-center gap-2 rounded-pill bg-danger-solid pl-3.5 pr-1 text-sm font-semibold text-white"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <span aria-hidden className="h-2 w-2 animate-pulse rounded-pill bg-white" />
                      Recording
                      <button
                        type="button"
                        aria-label="Stop recording"
                        onClick={actions.stopRecording}
                        className="relative ml-1 h-7 cursor-pointer rounded-pill border-0 bg-white/20 px-3 text-sm font-semibold text-white after:absolute after:-inset-1.5 after:content-[''] hover:bg-white/30"
                      >
                        Stop
                      </button>
                    </span>
                  )}
                  {consent.pending && !recording && (
                    <span
                      role="status"
                      className="pointer-events-auto flex min-h-9 max-w-full items-center gap-2 rounded-pill border border-line bg-card py-1 pl-3.5 pr-1.5 text-sm text-ink-secondary"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <Spinner size={14} />
                      <span className="min-w-0">Waiting for {session.patientName} to allow recording</span>
                      <Button size="md" variant="secondary" onClick={consent.cancel}>
                        Cancel
                      </Button>
                    </span>
                  )}
                  {showMe.pending && (
                    <span
                      role="status"
                      className="pointer-events-auto flex min-h-9 max-w-full items-center gap-2 rounded-pill border border-line bg-card py-1 pl-3.5 pr-1.5 text-sm text-ink-secondary"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <Spinner size={14} />
                      <span className="min-w-0">Waiting for {session.patientName} to show you</span>
                      <Button size="md" variant="secondary" onClick={showMe.cancel}>
                        Cancel
                      </Button>
                    </span>
                  )}
                  {/* White on whatever the camera shows, so it reads on a
                      close-up of anything. Done hands the front camera back. */}
                  {showMe.active && (
                    <span
                      role="status"
                      className="pointer-events-auto flex min-h-11 max-w-full items-center gap-3 rounded-pill bg-card py-1.5 pl-4 pr-1.5 text-base font-medium text-accent-ink"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <RoomIcon name="scan" size={16} />
                      <span className="min-w-0">
                        Close look · {patientFirst}'s {showMe.active.back ? 'back camera' : 'camera'}
                      </span>
                      <button
                        type="button"
                        onClick={showMe.end}
                        className="h-8 shrink-0 cursor-pointer rounded-pill border-0 bg-accent px-4 text-base font-medium text-accent-fg hover:bg-accent-soft"
                      >
                        Done
                      </button>
                    </span>
                  )}
                  {reconnecting && (
                    <span
                      role="status"
                      className="flex h-9 items-center gap-2 rounded-pill border border-warning-border bg-warning-bg px-3 text-sm font-medium text-warning-fg"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <Spinner size={14} color="currentColor" />
                      Reconnecting...
                    </span>
                  )}
                </div>
              )}

              {/* z-40: above the tablet's overlaid chat column (z-30). A knock
                  is the one thing in the room that cannot wait behind chat. */}
              {isDoctor && (
                <div className="absolute right-3 top-3 z-40">
                  <KnockCard
                    waiting={knocks}
                    expectedName={session.patientName}
                    visit={visit}
                    onRespond={(id, allow) => void respond(id, allow)}
                  />
                </div>
              )}

              {/* Inset by the same 12px on every side the stage's 16px corner
                  allows, so the tiles sit inside the curve, never on it. */}
              <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2 md:bottom-4 md:right-4">
                {presenterId && mainId && (
                  <LiveTile id={mainId} selfId={localId} variant="pip" className={pip} />
                )}
                {others.map((id) => (
                  <LiveTile key={id} id={id} selfId={localId} variant="pip" className={pip} />
                ))}
                {localId && <LiveTile id={localId} selfId={localId} variant="pip" className={pip} />}
              </div>
            </div>
          </div>

          {confirmLeave && (
            <LeavePrompt isDoctor={isDoctor} onStay={() => setConfirmLeave(false)} onLeave={exit} />
          )}

          {consent.asking && (
            <RecordingConsentPrompt
              doctorName={session.doctorName}
              busy={consent.busy}
              onAllow={consent.allow}
              onDecline={consent.decline}
            />
          )}

          {/* One question at a time: Show me waits behind recording consent. */}
          {showMe.asking && !consent.asking && (
            <ShowMePrompt
              doctorName={session.doctorName}
              hasBack={showMe.hasBack}
              busy={showMe.busy}
              isPhone={isPhone}
              onAccept={showMe.accept}
              onDecline={showMe.decline}
            />
          )}

          {mediaRequest && (
            <MediaRequestPrompt
              request={mediaRequest}
              requesterName={`Dr. ${session.doctorName}`}
              onRespond={actions.respondMediaRequest}
            />
          )}

          <ControlBar
            title={`Visit with ${otherName}`}
            elapsed={elapsed}
            micOn={self?.micOn ?? false}
            camOn={self?.camOn ?? false}
            onToggleMic={actions.toggleMic}
            onToggleCam={actions.toggleWebcam}
            sharingScreen={presenterId !== null && presenterId === localId}
            shareTakenBy={
              presenterId && presenterId !== localId ? (presenter?.name ?? otherName) : null
            }
            shareSupported={SCREEN_SHARE_SUPPORTED}
            onToggleShare={() => void actions.toggleScreenShare()}
            isDoctor={isDoctor}
            isRecording={recording}
            recordingPending={consent.pending}
            /* Stop is direct for either side. Start is only ever a request:
               the recording begins on the patient's allow, see
               useRecordingConsent. */
            onToggleRecording={recording ? actions.stopRecording : consent.request}
            chatOpen={chatOpen}
            /* The doctor's chat is in the side panel on tablet and desktop. */
            onToggleChat={isDoctor && !isPhone ? undefined : () => setChatOpen(!chatOpen)}
            panel={
              isDoctor && !isPhone
                ? { open: railOpen, unread: railUnread, onToggle: () => setRailChoice(!railOpen) }
                : undefined
            }
            showMe={
              isDoctor
                ? {
                    state: showMe.active ? 'active' : showMe.pending ? 'pending' : 'idle',
                    disabled: !mainId,
                    onClick: showMe.active ? showMe.end : showMe.request,
                  }
                : undefined
            }
            onShowPatient={isDoctor && isPhone ? () => setPatientSheet(true) : undefined}
            onLeave={exit}
          />
        </main>

        {isDoctor && !isPhone ? (
          <RoomRail
            overlay={deviceClass === 'tablet'}
            open={railOpen}
            tab={railTab}
            onTab={setRailTab}
            onHide={() => setRailChoice(false)}
            unread={railUnread}
            messages={chatMessages}
            onSend={send}
            patient={patientPanel}
          />
        ) : isPhone ? (
          <>
            <BottomSheet open={chatOpen} onClose={() => setChatOpen(false)} title="Messages">
              <ChatPanel messages={chatMessages} onSend={send} />
            </BottomSheet>
            {isDoctor && (
              <BottomSheet open={patientSheet} onClose={() => setPatientSheet(false)} title="Patient">
                <div className="p-4">
                  <PatientPanel {...patientPanel} />
                </div>
              </BottomSheet>
            )}
          </>
        ) : (
          chatOpen && (
            <SidePanel
              messages={chatMessages}
              onSend={send}
              overlay={deviceClass === 'tablet'}
              onHide={() => setChatOpen(false)}
            />
          )
        )}
      </div>
    </div>
  )
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}
