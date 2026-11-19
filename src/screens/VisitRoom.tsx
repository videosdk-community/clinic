import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'
import { ControlBar } from '../components/ControlBar'
import { KnockCard } from '../components/KnockCard'
import { LeavePrompt } from '../components/LeavePrompt'
import { LiveTile } from '../components/LiveTile'
import { MediaRequestPrompt } from '../components/MediaRequestPrompt'
import { RecordingConsentPrompt } from '../components/RecordingConsentPrompt'
import { ScreenStage } from '../components/ScreenStage'
import { SidePanel } from '../components/SidePanel'
import { BottomSheet, Button, Spinner, useToast } from '../design/ui'
import { admitPatient, endVisit } from '../lib/visits'
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
  const elapsed = formatClock(useElapsedSeconds())

  const [chatOpen, setChatOpen] = useState(false)

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
    await actions.respondEntry(id, allow)
  }

  /* Mute is real; unmute only asks, and the patient answers on their side. */
  const moderate = isDoctor && main && (
    <button
      type="button"
      onClick={() => (main.micOn ? actions.muteParticipant(main.id) : actions.askToUnmute(main.id))}
      className="h-7 cursor-pointer rounded-pill border-0 px-2.5 text-sm text-white backdrop-blur-[4px]"
      style={{ background: 'rgba(0,0,0,.55)' }}
    >
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

  const pip = isPhone ? 'aspect-[3/4] w-24' : 'aspect-video w-40 lg:w-56'

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className={isPhone ? 'min-h-0 flex-1 p-2' : 'min-h-0 flex-1 p-4'}>
            <div className="relative h-full w-full overflow-hidden rounded-2xl bg-inset">
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
                       cropping someone's face. */
                    fit={isPhone ? 'cover' : 'contain'}
                    action={moderate}
                    className="h-full w-full rounded-2xl"
                  />
                </div>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-6 text-center">
                  <span className="text-lg font-semibold text-ink">Waiting for {otherName}</span>
                  <span className="text-base text-ink-secondary">
                    {isDoctor
                      ? 'They will knock when they open the link. You decide who comes in.'
                      : 'They will be with you shortly.'}
                  </span>
                </div>
              )}

              {/* Red and solid on both sides, with Stop on the pill itself: on a
                  phone the control bar's Stop is one sheet away, and either
                  person stopping is a direct call, not a request. A patient
                  who joins mid-recording sees it from the SDK's state. */}
              {(recording || reconnecting || consent.pending) && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-wrap justify-center gap-2 px-3">
                  {recording && (
                    <span
                      role="status"
                      className="pointer-events-auto flex h-8 items-center gap-2 rounded-pill bg-danger-solid pl-3 pr-1 text-sm font-semibold text-white"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <span aria-hidden className="h-2 w-2 animate-pulse rounded-pill bg-white" />
                      Recording
                      <button
                        type="button"
                        aria-label="Stop recording"
                        onClick={actions.stopRecording}
                        className="h-6 cursor-pointer rounded-pill border-0 bg-white/20 px-2.5 text-sm font-semibold text-white hover:bg-white/30"
                      >
                        Stop
                      </button>
                    </span>
                  )}
                  {consent.pending && !recording && (
                    <span
                      role="status"
                      className="pointer-events-auto flex min-h-8 max-w-full items-center gap-2 rounded-pill border border-line-strong bg-card py-1 pl-3 pr-1 text-sm text-ink-secondary"
                      style={{ boxShadow: 'var(--elevation-popover)' }}
                    >
                      <Spinner size={14} />
                      <span className="min-w-0">Waiting for {session.patientName} to allow recording</span>
                      <Button size="sm" variant="secondary" onClick={consent.cancel}>
                        Cancel
                      </Button>
                    </span>
                  )}
                  {reconnecting && (
                    <span
                      className="rounded-pill px-2.5 py-1 text-xs font-semibold"
                      style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}
                    >
                      Reconnecting...
                    </span>
                  )}
                </div>
              )}

              {isDoctor && (
                <div className="absolute right-3 top-3 z-20">
                  <KnockCard
                    waiting={waiting}
                    expectedName={session.patientName}
                    onRespond={(id, allow) => void respond(id, allow)}
                  />
                </div>
              )}

              <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
                {presenterId && mainId && <LiveTile id={mainId} selfId={localId} className={pip} />}
                {others.map((id) => (
                  <LiveTile key={id} id={id} selfId={localId} className={pip} />
                ))}
                {localId && <LiveTile id={localId} selfId={localId} className={pip} />}
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
            onToggleChat={() => setChatOpen(!chatOpen)}
            onLeave={exit}
          />
        </main>

        {isPhone ? (
          <BottomSheet open={chatOpen} onClose={() => setChatOpen(false)} title="Messages">
            <ChatPanel messages={chatMessages} onSend={send} />
          </BottomSheet>
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
