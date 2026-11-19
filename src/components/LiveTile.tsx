import { useEffect, useRef, type ReactNode } from 'react'
import { useLocalDevices, useNetworkQuality, useParticipantView, useTrack, type NetworkQuality } from '../sdk'
import { RoomIcon } from './icons'
import { Avatar, cn } from '../design/ui'

/* A tile backed by a real video track: the stage and the picture-in-picture
   tiles are both this, at different sizes. With the camera off it shows the
   person's initials on a plain light surface. */

/* Three bars, lit by level. Hidden for 'unknown': no media flowing is not a
   bad connection, and a grey icon would read as one. */
const BARS: Record<Exclude<NetworkQuality, 'unknown'>, { lit: number; tone: string }> = {
  good: { lit: 3, tone: 'text-success-dot' },
  fair: { lit: 2, tone: 'text-warning-dot' },
  poor: { lit: 1, tone: 'text-danger-soft' },
}

function SignalBars({ level }: { level: NetworkQuality }) {
  if (level === 'unknown') return null
  const { lit, tone } = BARS[level]
  const label = `Connection: ${level}`
  return (
    <span role="img" aria-label={label} title={label} className={cn('shrink-0', tone)}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={1 + i * 4}
            y={8 - i * 3}
            width="2.5"
            height={3 + i * 3}
            rx="0.5"
            fill="currentColor"
            opacity={i < lit ? 1 : 0.35}
          />
        ))}
      </svg>
    </span>
  )
}

export interface LiveTileProps {
  id: string
  selfId: string | null
  /** `stage` fills the visit's stage; `pip` is a small inset tile in the
      corner, with its own border and shadow so it reads as lifted off the
      video behind it. */
  variant?: 'stage' | 'pip'
  /** cover fills the frame and crops; contain letterboxes and crops nothing. */
  fit?: 'cover' | 'contain'
  /** Sits beside the name chip, such as the doctor's mute on the patient's
      video: the control is about that person, so it lives next to their name. */
  action?: ReactNode
  className?: string
}

export function LiveTile({ id, selfId, variant = 'stage', fit = 'cover', action, className }: LiveTileProps) {
  const p = useParticipantView(id)
  const network = useNetworkQuality(id)
  const stream = useTrack(id, 'cam')
  const { facing } = useLocalDevices()
  const ref = useRef<HTMLVideoElement>(null)
  const self = id === selfId
  const pip = variant === 'pip'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream) el.play().catch(() => {})
  }, [stream])

  if (!p) return null

  const showVideo = p.camOn && stream

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden',
        pip ? 'rounded-xl shadow-lg ring-2 ring-canvas' : 'rounded-2xl',
        /* Camera pixels sit on the fixed video black, so a letterbox reads
           as a frame; a camera that is off is just a calm surface. */
        showVideo ? 'bg-video' : 'bg-inset',
        className,
      )}
    >
      {showVideo ? (
        /* Always muted. This element carries video only; audio is one
           <audio> per remote participant in the seam. An unmuted video
           element here would reintroduce the feedback howl. Self view is
           mirrored, the way every camera preview is - but only the front
           camera: a back camera mirrored writes a label backwards.

           rounded-[inherit] on the video itself, not only overflow-hidden on
           the tile: the mirror transform gives the video its own compositing
           layer, and Chrome then paints its square corners straight past the
           parent's rounded clip. */
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          className={cn(
            'h-full w-full rounded-[inherit]',
            fit === 'contain' ? 'object-contain' : 'object-cover',
            self && facing === 'user' && 'scale-x-[-1]',
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Avatar name={p.name} size={pip ? 'md' : 'xl'} />
        </div>
      )}

      {/* The speaking ring is an overlay, not the tile's own box-shadow: an
          inset shadow paints under the children, so the video would hide it. */}
      {p.isActiveSpeaker && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2px_var(--accent)]"
        />
      )}

      {/* Dark glass over the picture, whatever the page theme: see the video
          tokens in index.css. */}
      <div
        className={cn(
          'absolute flex max-w-[calc(100%-16px)] items-center gap-1.5',
          pip ? 'bottom-1.5 left-1.5' : 'bottom-3 left-3',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-md bg-video/60 text-on-video backdrop-blur-sm',
            pip ? 'h-6 px-1.5 text-sm' : 'h-7 px-2 text-sm',
          )}
        >
          <RoomIcon
            name={p.micOn ? 'mic' : 'micOff'}
            size={12}
            className={cn('shrink-0', !p.micOn && 'text-danger-soft')}
          />
          {/* First name only on the small tile, so it is a name and not "As...". */}
          <span className="truncate">{self ? 'You' : pip ? p.name.split(' ')[0] : p.name}</span>
          <SignalBars level={network} />
        </div>
        {action}
      </div>
    </div>
  )
}
