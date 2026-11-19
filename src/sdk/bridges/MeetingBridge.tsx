import { useEffect, useRef } from 'react'
import { useMeeting } from '@videosdk.live/react-sdk'
import { warn } from '../log'
import { normaliseEntryResponded } from '../normalise'
import type { RoomStore } from '../store'
import type { RoomStatus } from '../types'

/* useMeeting, subscribed exactly once.

   The reason is not CPU. `useMeeting` registers roughly forty listeners per
   call site against an eventEmitter created once at module scope and shared by
   every provider on the page. A dozen call sites is ~480 listeners and a
   MaxListenersExceededWarning per event name. Do not remove the bridge. */

/* The five states js-sdk actually emits, from
   constants/meetingConnectionState.js. The react-sdk typings declare CLOSING
   and CLOSED, which nothing emits, and omit RECONNECTING, which is emitted -
   a map built from the typings leaves a reconnect showing the last status,
   and on the waiting screen that reads as a freeze. */
const STATUS: Record<string, RoomStatus> = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed',
  DISCONNECTED: 'disconnected',
}

/* How the cloud composites the visit. Measured, see DECISIONS.md: GRID puts
   the patient and the doctor side by side, SPOTLIGHT filled the frame with one
   person and dropped the doctor entirely. LIGHT matches the clinic theme.
   gridSize is required by the typings. Nothing here configures the
   composite's size; both layouts rendered at 1920x1080. */
const RECORDING_CONFIG = {
  layout: { type: 'GRID', priority: 'SPEAKER', gridSize: 4 },
  theme: 'LIGHT',
  mode: 'video-and-audio',
  quality: 'high',
  orientation: 'landscape',
} as const

export function MeetingBridge({ store }: { store: RoomStore }) {
  const meeting = useMeeting({
    onMeetingJoined() {
      store.setStatus('connected')
    },
    /* The leave REASON is the payload, and it is the only room-ended signal
       the SDK has - there is no host-left and no room-ended event anywhere.
       js-sdk's leaveReason table gives 1006 the doctor closing the room, 1009
       the end API, 1011 the same account joining from another tab, and 1101
       our own leave() call. */
    onMeetingLeft(reason?: { code?: number; message?: string }) {
      store.setLeaveReason({
        code: Number(reason?.code ?? 0),
        message: reason?.message ?? 'You left the visit.',
      })
      store.setStatus('disconnected')
    },
    onMeetingStateChanged({ state }) {
      const mapped = STATUS[state]
      if (mapped) store.setStatus(mapped)
      else warn('unrecognised meeting state', state)
    },
    onParticipantJoined(participant) {
      store.upsertParticipant(participant.id, {
        name: participant.displayName,
        isLocal: Boolean(participant.local),
      })
    },
    onParticipantLeft(participant) {
      /* Removed synchronously in the callback so the per-participant bridge
         unmounts in the same commit. Deferring it leaves useParticipant
         running against an id the SDK has already dropped. */
      store.removeParticipant(participant.id)
    },
    onSpeakerChanged(activeSpeakerId) {
      store.setActiveSpeaker(activeSpeakerId)
    },
    /* The only broadcast screen-share signal there is. It fires with null
       when the share stops - including from the browser's own "Stop sharing"
       bar, which no app-side click can be listened for - so presence is read
       from here rather than from a local flag. */
    onPresenterChanged(presenterId) {
      store.setPresenter(presenterId ?? null)
    },
    onRecordingStateChanged({ status }) {
      store.setRecording(status === 'RECORDING_STARTED' || status === 'RECORDING_STARTING')
    },
    onEntryRequested({ participantId, name, allow, deny }) {
      /* The closures go to the non-reactive map, the row to the snapshot. */
      store.addEntryRequest({ participantId, name }, { allow, deny })
    },
    /* The .d.ts declares one object; the bundle emits two positional args.
       The cast is the one place the typings are knowingly overruled, and
       normaliseEntryResponded handles both. */
    onEntryResponded: ((...args: unknown[]) => {
      const decision = normaliseEntryResponded(...args)
      if (!decision) return
      store.setEntryDecision(decision)
      /* This event reaches EVERY allow_join holder, not just whoever clicked,
         so a queue cannot show someone who has already been answered. */
      store.removeEntryRequest(decision.participantId)
    }) as never,
    /* Registered on useMeeting, not on useParticipant - the request arrives
       at the TARGET. enableMic/enableWebcam only ever ask; the answer is
       here. */
    onMicRequested({ participantId, accept, reject }) {
      store.setMediaRequest({ kind: 'mic', requestedBy: participantId }, { accept, reject })
    },
    onWebcamRequested({ participantId, accept, reject }) {
      store.setMediaRequest({ kind: 'cam', requestedBy: participantId }, { accept, reject })
    },
    onError({ code, message }) {
      store.setError({ code: Number(code), message })
    },
  })

  /* The imperative surface, registered once. Kept in a ref so the identity of
     the registered actions never changes even as `meeting` is rebuilt. The
     ref is updated in an effect rather than during render; every action is
     called from an event handler, which always runs after effects flush. */
  const ref = useRef(meeting)
  useEffect(() => {
    ref.current = meeting
  })

  useEffect(() => {
    store.setActions({
      join: () => ref.current.join(),
      leave: () => ref.current.leave(),
      end: () => ref.current.end(),
      toggleMic: () => ref.current.toggleMic(),
      toggleWebcam: () => ref.current.toggleWebcam(),
      /* getDisplayMedia sits inside this, so a dismissed picker rejects with
         NotAllowedError. That is someone changing their mind, not a fault, so
         it is swallowed here. Nothing is written on success either: presence
         comes back on presenter-changed. */
      toggleScreenShare: async () => {
        try {
          await ref.current.toggleScreenShare()
        } catch (err) {
          warn('screen share was not started', err)
        }
      },
      /* Moderation is PER-PARTICIPANT: disableMic/enableMic hang off the
         Participant object, reached through the meeting's participants map. */
      muteParticipant: (id) => {
        void ref.current.participants.get(id)?.disableMic()
      },
      /* enableMic only REQUESTS - it fires onMicRequested on the target and
         they choose. A doctor can mute but cannot force-unmute. */
      askToUnmute: (id) => {
        void ref.current.participants.get(id)?.enableMic()
      },
      /* startRecording(webhookUrl, awsDirPath, config, transcription). ALL FOUR
         ARGUMENTS ARE POSITIONAL, so the two leading nulls are load-bearing:
         `startRecording(RECORDING_CONFIG)` would pass the config as the webhook
         URL and the recording would run with the default layout, silently.

         The cast is here because meeting.d.ts declares webhookUrl and
         awsDirPath as required `string`, requires config.layout.gridSize, and
         has no `orientation` field - none of which matches the runtime. */
      startRecording: () => {
        const start = ref.current.startRecording as unknown as (
          webhookUrl: null,
          awsDirPath: null,
          config: typeof RECORDING_CONFIG,
        ) => Promise<void>
        void start(null, null, RECORDING_CONFIG)
      },
      stopRecording: () => {
        void ref.current.stopRecording()
      },
      /* Optimistic, and it puts the row back if the decision fails, so a
         patient whose admit failed does not vanish while still knocking. */
      respondEntry: async (id, allow) => {
        const row = store.getEntryRequest(id)
        const closures = store.takeEntryClosures(id)
        store.removeEntryRequest(id)
        try {
          if (closures) {
            await (allow ? closures.allow() : closures.deny())
          } else {
            /* The decision is a STRING. Four declarations disagree about it;
               js-sdk's meeting.d.ts says "allowed" | "denied" and it wins -
               RoomClient.respondEntry forwards the value to the socket
               unmodified, and the SDK's own allow()/deny() closures are built
               as respondEntry(id, "allowed") / (id, "denied"). */
            warn('no entry closure for participant, falling back to respondEntry', id)
            await ref.current.respondEntry(id, allow ? 'allowed' : 'denied')
          }
        } catch (err) {
          warn('respondEntry failed, restoring the queue row', id, err)
          if (row) store.addEntryRequest(row)
          store.setError({ code: 0, message: 'That decision did not go through. Try again.' })
        }
      },
    })
  }, [store])

  /* Local participant is declared non-optional by the .d.ts but is undefined
     before join, so it is read defensively rather than eagerly. */
  const localId = meeting.localParticipant?.id ?? null
  const localName = meeting.localParticipant?.displayName ?? ''
  const meetingId = meeting.meetingId ?? null

  useEffect(() => {
    store.setMeeting(meetingId, localId)
    /* onParticipantJoined fires for OTHER people only. Without this the local
       participant never enters the store, there is no self view, and the
       control bar reads its own mic state as false. */
    if (localId) {
      store.upsertParticipant(localId, { name: localName || 'You', isLocal: true })
    }
  }, [store, meetingId, localId, localName])

  return null
}
