import { useEffect, useRef } from 'react'
import { useTrack } from '../sdk'
import { RoomIcon } from './icons'
import { Button } from '../design/ui'

/* The presenter's screen, on the stage. Either side can share, for example to
   show lab results, and the share takes the stage while it runs.

   `object-contain`, never `cover`. A shared screen is the one video in this
   app where cropping loses the content. The letterbox bars are the honest
   result. */

export interface ScreenStageProps {
  /** Who is presenting. From onPresenterChanged, never from a local flag. */
  presenterId: string
  presenterName: string
  /** Whether the local participant is the one sharing. */
  isSelf: boolean
  /** Stops the local share. Only rendered when `isSelf`, because nothing in
      the SDK lets one participant stop another's screen share. */
  onStop: () => void
}

export function ScreenStage({ presenterId, presenterName, isSelf, onStop }: ScreenStageProps) {
  const stream = useTrack(presenterId, 'screen')
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream) el.play().catch(() => {})
  }, [stream])

  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl" style={{ background: '#0a0a0c' }}>
      {stream ? (
        /* Muted like every other video element in this app. */
        <video ref={ref} autoPlay playsInline muted className="h-full w-full object-contain" />
      ) : (
        /* presenter-changed lands before the track does, so this is a real
           beat rather than a defensive branch nobody sees. */
        <div className="flex h-full w-full items-center justify-center text-base text-ink-tertiary">
          Waiting for {isSelf ? 'your screen' : `${presenterName}'s screen`}
        </div>
      )}

      <div
        className="absolute left-3 top-3 flex items-center gap-2 rounded-pill px-3 py-1 text-sm text-white backdrop-blur-[4px]"
        style={{ background: 'rgba(0,0,0,.6)' }}
      >
        <RoomIcon name="share" size={13} />
        {isSelf ? 'You are sharing your screen' : `${presenterName} is sharing a screen`}
      </div>

      {/* A second stop, next to the thing being stopped. The browser's own
          sharing bar is off-window on a second display often enough to be no
          help at all. */}
      {isSelf && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button size="md" variant="destructive" onClick={onStop}>
            Stop sharing
          </Button>
        </div>
      )}
    </div>
  )
}
