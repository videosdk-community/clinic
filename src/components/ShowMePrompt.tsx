import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { RoomIcon } from './icons'
import { cn } from '../design/ui'
import { drShort } from '../lib/names'

/* "Dr. X wants a closer look" - the patient's half of Show me.

   A bottom sheet on a phone, where the thumb is; a centred dialog elsewhere.
   Modal like RecordingConsentPrompt: focus lands on the primary button, Tab
   stays inside, and Escape is Not now, because closing the question is never
   a yes. Without a back camera (every desktop) it asks the patient to hold
   the thing up to the camera they have. */

/* 48px tall, full width: the phone mockup's size, and a thumb's. */
const BIG =
  'flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 px-4 text-lg font-medium'

export interface ShowMePromptProps {
  doctorName: string
  hasBack: boolean
  busy: boolean
  isPhone: boolean
  onAccept: () => void
  onDecline: () => void
}

export function ShowMePrompt({ doctorName, hasBack, busy, isPhone, onAccept, onDecline }: ShowMePromptProps) {
  const panel = useRef<HTMLDivElement>(null)
  const dr = drShort(doctorName)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onDecline()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onDecline])

  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const buttons = panel.current?.querySelectorAll('button')
    if (!buttons?.length) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className={cn('fixed inset-0 z-50 flex bg-video/45', isPhone ? 'items-end' : 'items-center justify-center p-4')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="showme-title"
      aria-describedby="showme-body"
    >
      <div
        ref={panel}
        onKeyDown={trapTab}
        className={cn(
          'flex flex-col gap-4 bg-card',
          isPhone
            ? 'vsdk-sheet-slide-in w-full rounded-t-2xl px-5 pb-7 pt-3'
            : 'w-[400px] max-w-full rounded-xl border border-line-strong p-6',
        )}
        style={{ boxShadow: 'var(--elevation-popover)' }}
      >
        {isPhone && <span aria-hidden className="h-1 w-9 self-center rounded-pill bg-line-strong" />}
        <div className="flex flex-col items-center gap-3 pt-1 text-center">
          <span className="inline-flex size-16 items-center justify-center rounded-pill bg-accent-wash text-accent-strong">
            <RoomIcon name="scan" size={28} />
          </span>
          <h2 id="showme-title" className="text-2xl font-semibold tracking-tight text-ink">
            {dr} wants a closer look
          </h2>
          <p id="showme-body" className="text-base text-ink-secondary">
            {hasBack
              ? `Switch to your back camera and point it at what you'd like to show. Your front camera comes back when ${dr} is done.`
              : `Hold it close to your camera so ${dr} can see it.`}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          {/* Not disabled while switching, as in the consent prompt: a disabled
              button drops focus to the page. */}
          <button
            type="button"
            autoFocus
            aria-busy={busy}
            onClick={busy ? undefined : onAccept}
            className={cn(BIG, 'bg-accent text-accent-fg shadow-hairline-filled hover:bg-accent-soft')}
          >
            {hasBack && <RoomIcon name="flip" size={18} />}
            {busy ? 'Switching...' : hasBack ? 'Switch to back camera' : 'Show it on my camera'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className={cn(BIG, 'bg-transparent text-ink-secondary hover:bg-subtle disabled:opacity-45')}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
