import { useMemo, type ReactNode } from 'react'
import { MeetingProvider } from '@videosdk.live/react-sdk'
import { MeetingBridge } from './bridges/MeetingBridge'
import { ParticipantBridges } from './bridges/ParticipantBridges'
import { PubSubBridge } from './bridges/PubSubBridge'
import { NetworkReporter } from './bridges/NetworkReporter'
import { RemoteAudio } from './RemoteAudio'
import { RoomStoreContext } from './hooks'
import { createRoomStore } from './store'
import { CHAT_TOPIC, CONSENT_TOPIC, NETWORK_TOPIC } from './topics'

/* The single mount point. MeetingProvider plus every bridge, all of which
   render nothing.

   MeetingProvider's `reinitialiseMeetingOnConfigChange` defaults to FALSE, so
   config is read on the first mount and changes afterwards are ignored.
   Custom precall tracks therefore have to be in hand before this component
   mounts, which is why precall is a sibling screen and not a child. */

export interface RoomProviderProps {
  meetingId: string
  token: string
  name: string
  /* Derived from the Supabase user id and already baked into the token, so
     the two agree. Passed separately because the store needs it before the
     SDK reports a local participant. */
  participantId: string
  /* The doctor's participantId, server-derived from visit ownership, so the
     patient's stage can find the doctor among the remotes. Whether the LOCAL
     user is the doctor stays a prop on the screens - the real enforcement is
     allow_mod inside the token, and nothing here. */
  doctorId: string
  micEnabled: boolean
  camEnabled: boolean
  customCameraVideoTrack?: MediaStream
  customMicrophoneAudioTrack?: MediaStream
  children: ReactNode
}

export function RoomProvider({
  meetingId,
  token,
  name,
  participantId,
  doctorId,
  micEnabled,
  camEnabled,
  customCameraVideoTrack,
  customMicrophoneAudioTrack,
  children,
}: RoomProviderProps) {
  /* One store per provider instance. doctorId is fixed for the life of a
     visit; a store rebuilt mid-meeting would drop every participant row, so
     nothing else may join this dependency list. */
  const store = useMemo(() => createRoomStore(doctorId), [doctorId])

  return (
    <MeetingProvider
      token={token}
      config={{
        meetingId,
        name,
        participantId,
        /* Declared non-optional in the typings, so all three are always
           passed even where a default would do. */
        micEnabled,
        webcamEnabled: camEnabled,
        debugMode: false,
        customCameraVideoTrack,
        customMicrophoneAudioTrack,
      }}
      joinWithoutUserInteraction
    >
      <RoomStoreContext.Provider value={store}>
        <MeetingBridge store={store} />
        <ParticipantBridges store={store} />
        <PubSubBridge topic={CHAT_TOPIC} store={store} persist={false} />
        <PubSubBridge topic={CONSENT_TOPIC} store={store} persist={false} />
        <PubSubBridge topic={NETWORK_TOPIC} store={store} persist={false} />
        <NetworkReporter />
        <RemoteAudio />
        {children}
      </RoomStoreContext.Provider>
    </MeetingProvider>
  )
}
