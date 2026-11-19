import { useEffect, useRef, type ReactNode } from 'react'
import { useParticipantView, useTrack } from '../sdk'
import { RoomIcon } from './icons'
import { cn } from '../design/ui'

/* A tile backed by a real video track: the stage and the picture-in-picture
   tiles are both this, at different sizes.

   The camera-off placeholder is a gradient over a stable per-id hue, so a
   participant does not change colour on re-render. */

function hueFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export interface LiveTileProps {
  id: string
  selfId: string | null
  /** cover fills the frame and crops; contain letterboxes and crops nothing. */
  fit?: 'cover' | 'contain'
  /** Top-left controls, such as the doctor's mute on the patient's video. */
  action?: ReactNode
  className?: string
}

export function LiveTile({ id, selfId, fit = 'cover', action, className }: LiveTileProps) {
  const p = useParticipantView(id)
  const stream = useTrack(id, 'cam')
  const ref = useRef<HTMLVideoElement>(null)
  const self = id === selfId

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream) el.play().catch(() => {})
  }, [stream])

  if (!p) return null

  const ring = p.isActiveSpeaker
    ? 'inset 0 0 0 2.5px var(--primary-button)'
    : 'inset 0 0 0 1px rgba(255,255,255,.06)'

  const initials = p.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl bg-inset', className)}
      style={{ boxShadow: ring }}
    >
      {p.camOn && stream ? (
        /* Always muted. This element carries video only; audio is one
           <audio> per remote participant in the seam. An unmuted video
           element here would reintroduce the feedback howl. Self view is
           mirrored, the way every camera preview is. */
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          className={cn(
            'h-full w-full',
            fit === 'contain' ? 'object-contain' : 'object-cover',
            self && 'scale-x-[-1]',
          )}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: `linear-gradient(135deg, hsl(${hueFor(id)} 45% 26%), #0f0f12)` }}
        >
          <div
            className="flex size-10 items-center justify-center rounded-[50%] text-base font-semibold"
            style={{ background: 'var(--primary-200)', color: 'var(--primary-900)' }}
          >
            {initials}
          </div>
        </div>
      )}

      <div
        className="absolute bottom-1.5 left-1.5 flex h-6 max-w-[calc(100%-12px)] items-center gap-1 rounded-md px-2 text-sm text-white backdrop-blur-[4px]"
        style={{ background: 'rgba(0,0,0,.55)' }}
      >
        <RoomIcon
          name={p.micOn ? 'mic' : 'micOff'}
          size={12}
          style={p.micOn ? undefined : { color: 'var(--red-400)' }}
        />
        <span className="truncate">{self ? 'You' : p.name}</span>
      </div>

      {action && <div className="absolute left-2 top-2">{action}</div>}
    </div>
  )
}
