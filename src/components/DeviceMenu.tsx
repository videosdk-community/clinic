import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { MicMeter } from './MicMeter'
import { RoomIcon } from './icons'
import { cn, useToast } from '../design/ui'
import { useLocalDevices, useLocalId, useRoomActions, useTrack, type DeviceOption } from '../sdk'

/* The chevron half of the Mic and Camera split buttons, and the menu it opens.

   The menu opens upward from the control bar and lists the devices as radio
   items, the one in use checked. The list is read every time it opens, so a
   headset plugged in mid-visit shows up. The mic menu carries a live input
   level, the only proof the chosen mic is producing sound; the camera menu
   offers Flip when a camera faces the other way (phones and tablets only).
   Escape, a click outside and a choice all close it, and focus goes back to
   the chevron. */

export interface DeviceMenuProps {
  kind: 'mic' | 'cam'
}

interface Listing {
  options: DeviceOption[]
  canFlip: boolean
}

export function DeviceMenu({ kind }: DeviceMenuProps) {
  const actions = useRoomActions()
  const toast = useToast()
  /* The check follows the store, not the listing: a switch still finishing
     when the menu opens lands a moment later. */
  const { facing, cameraId, micId } = useLocalDevices()
  const currentId = kind === 'mic' ? micId : cameraId
  const localId = useLocalId()
  const micStream = useTrack(localId ?? '', 'mic')
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Listing | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const chevron = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const isMic = kind === 'mic'
  const title = isMic ? 'Microphone' : 'Camera'

  const close = () => {
    setOpen(false)
    chevron.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    let live = true
    actions
      .listDevices()
      .then((l) => {
        if (!live) return
        setList({
          options: isMic ? l.mics : l.cameras,
          canFlip: !isMic && l.cameras.some((c) => c.facing === 'environment'),
        })
      })
      .catch(() => live && setList({ options: [], canFlip: false }))
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      chevron.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      live = false
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, isMic, actions])

  /* Focus the checked item once the list has arrived, as a menu should. */
  useEffect(() => {
    if (!open || !list) return
    const items = menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')
    const checked = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(checked ?? items?.[0])?.focus()
  }, [open, list])

  const choose = (run: () => Promise<unknown>, failure: string) => {
    close()
    run().catch(() => toast(failure, 'danger'))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <div ref={root} className="relative flex">
      <button
        ref={chevron}
        type="button"
        aria-label={`${title} settings`}
        title={`${title} settings`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'flex h-10 w-7 cursor-pointer items-center justify-center rounded-r-lg border-0 border-l border-solid border-hairline transition-colors duration-[120ms] ease-standard',
          open ? 'bg-accent-soft text-accent-ink' : 'bg-inset text-ink-secondary hover:bg-hairline hover:text-ink',
        )}
      >
        <RoomIcon name="chevronUp" size={14} />
      </button>

      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={title}
          onKeyDown={onKeyDown}
          className="absolute bottom-full left-1/2 z-40 mb-3 flex w-[300px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col gap-0.5 rounded-xl border border-line bg-card p-2"
          style={{ boxShadow: 'var(--elevation-popover)' }}
        >
          <span className="px-2.5 pb-1 pt-1.5 text-sm font-medium text-ink-tertiary">{title}</span>
          {!list ? (
            <span className="px-2.5 py-2 text-base text-ink-tertiary">Looking for devices...</span>
          ) : list.options.length === 0 ? (
            <span className="px-2.5 py-2 text-base text-ink-tertiary">No {title.toLowerCase()} found</span>
          ) : (
            list.options.map((d, i) => {
              const on = d.id === currentId
              return (
                <button
                  key={d.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() =>
                    on
                      ? close()
                      : choose(
                          () => (isMic ? actions.switchMic(d.id) : actions.switchCamera({ deviceId: d.id })),
                          `Could not switch to ${d.label || `that ${title.toLowerCase()}`}.`,
                        )
                  }
                  className={cn(
                    'flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 px-2.5 py-2 text-left text-base text-ink hover:bg-subtle',
                    on ? 'bg-accent-wash font-medium' : 'bg-transparent',
                  )}
                >
                  <span className="flex w-4 shrink-0 justify-center text-accent-strong">
                    {on && <RoomIcon name="check" size={16} strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{d.label || `${title} ${i + 1}`}</span>
                </button>
              )
            })
          )}

          {list?.canFlip && (
            <>
              <div className="mx-1 my-1.5 h-px bg-inset" />
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  choose(
                    () => actions.switchCamera({ facing: facing === 'environment' ? 'user' : 'environment' }),
                    'Could not flip the camera.',
                  )
                }
                className="flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-base text-ink hover:bg-subtle"
              >
                <RoomIcon name="flip" size={16} className="text-ink-secondary" />
                Flip camera
              </button>
            </>
          )}

          {isMic && (
            <>
              <div className="mx-1 my-1.5 h-px bg-inset" />
              <div className="flex flex-col gap-1.5 px-2.5 pb-2 pt-1.5">
                <span className="text-sm font-medium text-ink-tertiary">Input level</span>
                <MicMeter stream={micStream} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
