/* Topic names, in their own file so hooks.ts can read them without importing
   RoomProvider, which imports hooks.ts for the store context.

   Both are unpersisted. Chat is kept only for the session, and a consent
   request only means anything at the moment it is asked. */

export const CHAT_TOPIC = 'CHAT'
export const CONSENT_TOPIC = 'CONSENT'
