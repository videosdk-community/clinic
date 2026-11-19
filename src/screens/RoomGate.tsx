import { useCallback, useEffect, useRef, useState } from 'react'
import { LobbyWaiting } from '../components/LobbyWaiting'
import { VisitRoom } from './VisitRoom'
import {
  LEAVE_DUPLICATE_PARTICIPANT,
  LEAVE_MEETING_END_API,
  LEAVE_ROOM_CLOSE,
  useEntryDecision,
  useLeaveReason,
  useRoomActions,
  useRoomStatus,
} from '../sdk'
import type { Intake } from '../lib/visits'
import type { VisitSession } from '../session/types'

/* What you see between mounting the meeting and being in the visit.

   This has to live INSIDE RoomProvider, because only a child of the provider
   can read the store. Everything it decides is handed back up to JoinRoute,
   which owns the screens that must render with no meeting behind them. */

export type ExitReason = 'declined' | 'left' | 'ended' | 'evicted' | 'ask-again'

export interface RoomGateProps {
  session: VisitSession
  /** The visit's room id, for the doctor's admit and end calls. */
  roomId: string
  name: string
  /** The camera stream handed to the meeting, for the lobby's self-view. */
  camera?: MediaStream
  /** True for a patient who came through intake and devices. */
  stepped: boolean
  intake: Intake | null
  onIntakeChange: (intake: Intake) => void
  /** inRoomMs: how long this attempt was in the room, 0 if it never got in. */
  onExit: (reason: ExitReason, inRoomMs: number) => void
}

export function RoomGate({ session, roomId, name, camera, stepped, intake, onIntakeChange, onExit }: RoomGateProps) {
  const status = useRoomStatus()
  const decision = useEntryDecision()
  const leaveReason = useLeaveReason()
  const actions = useRoomActions()
  const isDoctor = session.role === 'doctor'
  /* The id compared below is the SESSION's participantId, never the store's
     localId: a knocking patient has no local participant yet. */
  const participantId = session.participantId

  /* Exits fire once. leave() settles asynchronously and both the decision and
     the leave reason can re-render this component afterwards. */
  const exited = useRef(false)

  /* onExit is an inline arrow from the parent, so it lives in a ref updated
     in an effect. Declared FIRST, so it is current when the effects below run
     in the same commit. */
  const onExitRef = useRef(onExit)
  useEffect(() => {
    onExitRef.current = onExit
  })

  /* When this attempt first reached the room, for the ended screen. */
  const enteredAt = useRef<number | null>(null)
  useEffect(() => {
    if (status === 'connected' && enteredAt.current === null) enteredAt.current = Date.now()
  }, [status])

  const exit = useCallback(
    (reason: ExitReason) => {
      if (exited.current) return
      exited.current = true
      /* A room the SDK already dropped us from does not need leaving, and
         calling leave() anyway throws ERROR_ALREADY_IN_REQUESTED_STATE. Only
         the exits we decide ourselves are still connected at this point. */
      if (reason !== 'ended' && reason !== 'evicted') actions.leave()
      onExitRef.current(reason, enteredAt.current === null ? 0 : Date.now() - enteredAt.current)
    },
    [actions],
  )

  /* A denied patient is not disconnected by the SDK. Without this they sit at
     CONNECTING forever and "the doctor declined" becomes pixel-identical to
     "this app is frozen". The app leaves on its own behalf. */
  useEffect(() => {
    if (!decision) return
    if (decision.participantId !== participantId) return
    if (decision.decision === 'denied') exit('declined')
    /* 'allowed' is deliberately not handled. Admission arrives as
       onMeetingJoined flipping the status to connected. */
  }, [decision, participantId, exit])

  /* The only room-ended signal that exists is the code on the leave reason. */
  useEffect(() => {
    if (!leaveReason) return
    if (leaveReason.code === LEAVE_DUPLICATE_PARTICIPANT) exit('evicted')
    else if (leaveReason.code === LEAVE_ROOM_CLOSE || leaveReason.code === LEAVE_MEETING_END_API) {
      exit('ended')
    }
  }, [leaveReason, exit])

  /* Once in, a reconnect keeps the room on screen under a banner rather than
     dropping back to the waiting room, which would read as being let out.
     Adjusted during render, React's own pattern for state derived from a
     changing value. */
  const [inRoom, setInRoom] = useState(false)
  if (status === 'connected' && !inRoom) setInRoom(true)

  if (status === 'connected' || (inRoom && status === 'reconnecting')) {
    return (
      <VisitRoom
        session={session}
        roomId={roomId}
        reconnecting={status === 'reconnecting'}
        onLeave={() => exit('left')}
      />
    )
  }

  /* A patient is not "joining" - they are knocking. The doctor holds
     allow_join and walks in, so for them the wait really is a connection. An
     admitted patient returning also holds allow_join and never sees this for
     long. */
  if (!isDoctor && (status === 'connecting' || status === 'reconnecting')) {
    return (
      <LobbyWaiting
        roomId={roomId}
        doctorName={session.doctorName}
        scheduledAt={session.scheduledAt}
        name={name}
        camera={camera}
        stepped={stepped}
        intake={intake}
        onIntakeChange={onIntakeChange}
        onAskAgain={() => exit('ask-again')}
        onLeave={() => exit('left')}
      />
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-subtle p-6 text-center">
      <span className="text-xl font-semibold text-ink">
        {status === 'failed' ? 'Could not join the visit' : 'Joining the visit'}
      </span>
      <span className="text-base text-ink-secondary">
        {status === 'failed'
          ? 'The connection did not come up. Try opening the link again.'
          : status === 'reconnecting'
            ? 'Reconnecting...'
            : 'Setting up your camera and microphone.'}
      </span>
    </div>
  )
}
