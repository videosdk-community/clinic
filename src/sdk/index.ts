/* The seam's entire public surface.

   Hand-curated on purpose. The lint rule stops feature code importing the SDK,
   but nothing stops this file re-exporting the SDK's hooks or types, and that
   would be a hole no linter can see. Everything below is app-shaped.

   Note what is NOT exported: useSelector. Every selector must be a
   module-level constant, and an exported useSelector would invite inline
   arrows that silently read stale values. */

export { RoomProvider } from './RoomProvider'
export { CHAT_TOPIC, CONSENT_TOPIC } from './topics'

export {
  useRoomStatus,
  useLocalId,
  useDoctorId,
  useParticipantIds,
  useParticipantView,
  usePresenterId,
  useIsRecording,
  useEntryQueue,
  useEntryDecision,
  useMediaRequest,
  useLeaveReason,
  useRoomError,
  useTopic,
  useRoomActions,
  useTrack,
} from './hooks'

/* Leave-reason codes, as values. Feature code compares against these rather
   than against bare numbers, so the meaning of 1011 lives in one place. */
export { LEAVE_ROOM_CLOSE, LEAVE_MEETING_END_API, LEAVE_DUPLICATE_PARTICIPANT } from './types'

export type { EntryRequest, MediaRequest } from './types'

export { usePrecall } from './media/usePrecall'
export type { PrecallTracks } from './media/usePrecall'
