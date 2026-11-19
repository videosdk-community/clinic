/* Topic names, in their own file so hooks.ts can read them without importing
   RoomProvider, which imports hooks.ts for the store context.

   All are unpersisted. Chat is kept only for the session, a consent request
   only means anything at the moment it is asked - so does a doctor's request
   to see something on the back camera - and a network report is superseded
   by the next one. */

export const CHAT_TOPIC = 'CHAT'
export const CONSENT_TOPIC = 'CONSENT'
export const SHOWME_TOPIC = 'SHOWME'

/** Each client's reading of its own connection. Internal to the seam. */
export const NETWORK_TOPIC = 'NETWORK'
