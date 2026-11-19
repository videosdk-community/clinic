import { useEffect, useState } from 'react'
import { MicMeter } from './MicMeter'
import { RoomIcon } from './icons'
import { BottomSheet, cn, useToast } from '../design/ui'
import { useLocalDevices, useLocalId, useRoomActions, useTrack, type DeviceOption } from '../sdk'

/* The phone's camera and microphone picker, opened from the More sheet.

   The desktop's two split-button menus, flattened into one sheet: Flip first
   (the thing a phone user actually wants), then a radio list per device kind
   and the mic's live input level. The list is read on open and again after
   each switch, so the checked row is always the device in use. */

export interface DevicesSheetProps {
  open: boolean
  onClose: () => void
}

interface Listing {
  cameras: DeviceOption[]
  mics: DeviceOption[]
  cameraId: string | null
  micId: string | null
}

export function DevicesSheet({ open, onClose }: DevicesSheetProps) {
  const actions = useRoomActions()
  const toast = useToast()
  const { facing, cameraId, micId } = useLocalDevices()
  const localId = useLocalId()
  const micStream = useTrack(localId ?? '', 'mic')
  const [list, setList] = useState<Listing | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open) return
    let live = true
    actions
      .listDevices()
      .then((l) => live && setList(l))
      .catch(() => live && setList({ cameras: [], mics: [], cameraId: null, micId: null }))
    return () => {
      live = false
    }
  }, [open, version, actions])

  const run = (fn: () => Promise<unknown>, failure: string) =>
    fn()
      .catch(() => toast(failure, 'danger'))
      .finally(() => setVersion((v) => v + 1))

  const canFlip = list?.cameras.some((c) => c.facing === 'environment') ?? false

  return (
    <BottomSheet open={open} onClose={onClose} title="Camera and microphone">
      <div className="flex flex-col gap-3 px-4 pt-3">
        {canFlip && (
          <button
            type="button"
            onClick={() =>
              void run(
                () => actions.switchCamera({ facing: facing === 'environment' ? 'user' : 'environment' }),
                'Could not flip the camera.',
              )
            }
            className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-accent-wash px-4 text-lg font-medium text-accent-ink hover:bg-accent-soft"
          >
            <RoomIcon name="flip" size={18} />
            Flip camera
          </button>
        )}

        {!list ? (
          <p className="px-3 py-2 text-base text-ink-tertiary">Looking for devices...</p>
        ) : (
          <>
            <RadioList
              label="Camera"
              options={list.cameras}
              currentId={cameraId}
              onPick={(id) => void run(() => actions.switchCamera({ deviceId: id }), 'Could not switch cameras.')}
            />
            <div className="mx-1 h-px bg-inset" />
            <RadioList
              label="Microphone"
              options={list.mics}
              currentId={micId}
              onPick={(id) => void run(() => actions.switchMic(id), 'Could not switch microphones.')}
            />
          </>
        )}

        <div className="flex flex-col gap-1.5 px-3 pt-1">
          <span className="text-sm font-medium text-ink-tertiary">Input level</span>
          <MicMeter stream={micStream} />
        </div>
      </div>
    </BottomSheet>
  )
}

function RadioList({
  label,
  options,
  currentId,
  onPick,
}: {
  label: string
  options: DeviceOption[]
  currentId: string | null
  onPick: (id: string) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-0.5">
      <span className="px-3 py-1 text-sm font-medium text-ink-secondary">{label}</span>
      {options.length === 0 && (
        <span className="px-3 py-2 text-base text-ink-tertiary">No {label.toLowerCase()} found</span>
      )}
      {options.map((d, i) => {
        const on = d.id === currentId
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onPick(d.id)}
            className={cn(
              'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg border-0 px-3 text-left text-lg text-ink',
              on ? 'bg-accent-wash font-medium' : 'bg-transparent hover:bg-subtle',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-5 shrink-0 rounded-pill border-solid',
                on ? 'border-[6px] border-accent-mid' : 'border-2 border-line-strong',
              )}
            />
            <span className="min-w-0 flex-1 break-words">{d.label || `${label} ${i + 1}`}</span>
          </button>
        )
      })}
    </div>
  )
}
