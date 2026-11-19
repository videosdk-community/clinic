import { useEffect } from 'react'
import { useLocalId, useNetworkQuality, useParticipantIds, useRoomActions } from '../hooks'
import { NETWORK_TOPIC } from '../topics'

/* Tells the other side how our own connection looks, so their tile for us
   shows our link and not just theirs (see useNetworkQuality).

   Sent when our level changes, and again whenever the room's membership
   changes, because the topic is unpersisted and someone who just arrived
   has heard nothing yet. Renders nothing. */
export function NetworkReporter() {
  const localId = useLocalId()
  const level = useNetworkQuality(localId ?? '')
  const peers = useParticipantIds().length
  const actions = useRoomActions()

  useEffect(() => {
    if (!localId || level === 'unknown' || peers < 2) return
    void actions.publish(NETWORK_TOPIC, level).catch(() => {
      // A report that does not arrive is replaced by the next one.
    })
  }, [localId, level, peers, actions])

  return null
}
