import { useEffect, useRef } from 'react'
import { ConnectionCheck } from '../components/ConnectionCheck'
import { MicMeter } from '../components/MicMeter'
import { PermissionHelp } from '../components/PermissionHelp'
import { RoomIcon } from '../components/icons'
import { Avatar, Button, Select, Spinner, cn } from '../design/ui'
import { usePrecall, usePrecallTest, type PrecallTracks } from '../sdk'

/* Precall: check the devices before the other side sees you.

   Runs OUTSIDE MeetingProvider, and that is structural rather than tidy.
   MeetingProvider's reinitialiseMeetingOnConfigChange defaults to false, so
   custom tracks are read on its first mount and ignored afterwards - the
   handoff only works if the tracks exist before the provider exists.

   It renders a body only; the caller puts it in PatientFrame, with the
   steps for a patient on their way to knocking. */

/* Mic or camera off: the same red tint as the room's control bar, so "off"
   looks the same before and after joining. */
const OFF = 'bg-danger-bg text-danger-fg shadow-[inset_0_0_0_1px_var(--danger-border)]'
const ON = 'bg-video/60 text-on-video backdrop-blur-sm hover:bg-video/80'
const ROUND = 'flex size-11 cursor-pointer items-center justify-center rounded-pill border-0'
const LABEL = 'text-sm font-medium text-ink-secondary'
/* 44px and 16px type on a phone, like every field in the patient flow. */
const SELECT = 'w-full max-sm:[&>button]:h-11 max-sm:[&>button]:text-lg'

export interface JoinDetails {
  tracks: PrecallTracks
  micOn: boolean
  camOn: boolean
  name: string
}

export interface PrecallProps {
  onJoin: (details: JoinDetails) => void
  heading: string
  /** Who and when, so nobody wonders which link they clicked. The patient's
      frame already says it, so only the doctor passes one. */
  greeting?: string
  /** The name the other side will see. Chosen before this screen, so it is
      only carried through to the join. */
  name: string
  /** "Ask to join" for a patient who knocks; "Join the visit" for the doctor
      and a patient already let in. scripts/drive.mjs clicks both by name. */
  joinLabel: string
  /** Why someone is looking at this screen a second time. Set only when a
      knock was answered with a no, or ran out of patience - without it, being
      returned to a device picker reads as the app losing its place. */
  notice?: string
  busy?: boolean
  /** The visit's session token. runPreCallTest needs one, and the patient's
      ask_join token works without joining or knocking. */
  token: string
}

export function Precall({ onJoin, heading, greeting, name, joinLabel, notice, busy = false, token }: PrecallProps) {
  const p = usePrecall()
  /* Declared after usePrecall on purpose: its effects must run after
     usePrecall's, which stop a track being switched away from. */
  const check = usePrecallTest(token, p)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = p.preview ?? null
    if (p.preview) el.play().catch(() => {})
  }, [p.preview])

  /* Abandoning precall without joining must release the camera. Joining must
     NOT - the live tracks become the meeting's, which is what stops the
     camera blinking between the two screens.

     Depends on p.discard, NOT on p. usePrecall returns a fresh object every
     render, so `[p]` re-runs this effect on every render and its cleanup
     tears down the track that was just acquired - the preview then resolves
     and vanishes in the same breath, with nothing logged and no error. It
     presents as a camera that will not turn on. p.discard is a stable
     useCallback, so this now runs only on real unmount. */
  const joined = useRef(false)
  const discard = p.discard
  useEffect(() => {
    return () => {
      if (!joined.current) discard()
    }
  }, [discard])

  /* A blank name never reaches the room. 'Patient' beats a nameless tile. */
  const joinName = name.trim() || 'Patient'
  const canJoin = !busy

  const join = () => {
    if (!canJoin) return
    joined.current = true
    onJoin({ tracks: p.handOff(), micOn: p.micOn, camOn: p.camOn, name: joinName })
  }

  /* The bail-out path skips the `granted` block entirely, so it carries the
     name too - otherwise someone whose camera is blocked joins nameless. */
  const joinWithout = () => {
    joined.current = true
    onJoin({ tracks: {}, micOn: false, camOn: false, name: joinName })
  }

  /* Flip cycles to the next camera, which on a phone is front to back. */
  const nextCamera = () => {
    const i = p.cameras.findIndex((c) => c.id === p.cameraId)
    const next = p.cameras[(i + 1) % p.cameras.length]
    if (next) p.setCameraId(next.id)
  }

  return (
    <div className="vsdk-enter flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">{heading}</h1>
        {greeting && <p className="m-0 text-base text-ink-secondary">{greeting}</p>}
        {notice && <p className="m-0 text-base text-ink-tertiary">{notice}</p>}
      </div>

      {p.state === 'checking' && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {p.state === 'blocked' && <PermissionHelp onContinue={joinWithout} />}

      {p.state === 'unavailable' && (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-base text-ink-secondary">
            No camera or microphone is available. Another application may be using it, or none is
            attached. You can still join and listen.
          </p>
          <Button size="lg" fullWidth className="max-sm:h-12 max-sm:text-lg" onClick={joinWithout}>
            Join to listen
          </Button>
        </div>
      )}

      {(p.state === 'askable' || p.state === 'requesting') && (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-base text-ink-secondary">
            Clinic needs your camera and microphone. Your browser will ask next.
          </p>
          <Button
            size="lg"
            fullWidth
            className="max-sm:h-12 max-sm:text-lg"
            onClick={() => void p.ask()}
            disabled={p.state === 'requesting'}
          >
            {p.state === 'requesting' ? 'Waiting for your browser' : 'Allow camera and microphone'}
          </Button>
        </div>
      )}

      {p.state === 'granted' && (
        <>
          <div
            className={cn(
              'relative aspect-video w-full overflow-hidden rounded-2xl',
              p.camOn && p.preview ? 'bg-video' : 'bg-inset',
            )}
          >
            {p.camOn && p.preview ? (
              /* Muted, always. An unmuted preview of your own microphone is
                 a feedback loop before the visit has even started. */
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full scale-x-[-1] rounded-[inherit] object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 pb-10 text-base text-ink-tertiary">
                <Avatar name={name} size={56} />
                Camera is off
              </div>
            )}

            {/* A scrim under the controls. They sit over whatever the camera
                happens to see, and a mid-grey fill disappears against a
                bright wall or a window. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-video/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
              <button
                type="button"
                aria-label={p.micOn ? 'Mute yourself' : 'Unmute yourself'}
                onClick={() => p.setMicOn(!p.micOn)}
                className={cn(ROUND, p.micOn ? ON : OFF)}
              >
                <RoomIcon name={p.micOn ? 'mic' : 'micOff'} size={18} />
              </button>
              <button
                type="button"
                aria-label={p.camOn ? 'Turn camera off' : 'Turn camera on'}
                onClick={() => p.setCamOn(!p.camOn)}
                className={cn(ROUND, p.camOn ? ON : OFF)}
              >
                <RoomIcon name={p.camOn ? 'cam' : 'camOff'} size={18} />
              </button>
              {p.cameras.length > 1 && (
                <button
                  type="button"
                  aria-label="Switch camera"
                  onClick={nextCamera}
                  disabled={!p.camOn}
                  className={cn(ROUND, ON, 'disabled:cursor-not-allowed disabled:opacity-45')}
                >
                  <RoomIcon name="flip" size={18} />
                </button>
              )}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Camera</span>
            <Select
              className={SELECT}
              size="lg"
              value={p.cameraId}
              options={p.cameras.map((c) => ({ label: c.label, value: c.id }))}
              onChange={(v) => p.setCameraId(v)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Microphone</span>
            <Select
              className={SELECT}
              size="lg"
              value={p.microphoneId}
              options={p.microphones.map((m) => ({ label: m.label, value: m.id }))}
              onChange={(v) => p.setMicrophoneId(v)}
            />
            <MicMeter stream={p.micOn ? p.micPreview : undefined} />
          </label>

          <ConnectionCheck state={check.state} camOn={p.camOn} micOn={p.micOn} onRunAgain={check.run} />

          <Button
            size="lg"
            fullWidth
            className="mt-auto max-sm:h-12 max-sm:text-lg"
            onClick={join}
            disabled={!canJoin}
          >
            {busy ? 'Joining' : joinLabel}
          </Button>
        </>
      )}
    </div>
  )
}
