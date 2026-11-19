import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { Button } from '../design/ui'

/* "Dr. X wants to record this visit." - the patient's half of recording
   consent.

   Modal, because nothing should start recording while the question is still
   on screen unanswered. Focus lands on Allow and Tab stays inside the two
   buttons. Escape is Decline: closing the question is never a yes. */

export interface RecordingConsentPromptProps {
  doctorName: string
  busy: boolean
  onAllow: () => void
  onDecline: () => void
}

export function RecordingConsentPrompt({
  doctorName,
  busy,
  onAllow,
  onDecline,
}: RecordingConsentPromptProps) {
  const panel = useRef<HTMLDivElement>(null)

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-video/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      aria-describedby="consent-body"
    >
      <div
        ref={panel}
        onKeyDown={trapTab}
        className="w-[380px] max-w-full rounded-xl border border-line-strong bg-card p-5"
        style={{ boxShadow: 'var(--elevation-popover)' }}
      >
        <h2 id="consent-title" className="text-lg font-semibold text-ink">
          Dr. {doctorName} wants to record this visit.
        </h2>
        <p id="consent-body" className="mt-1.5 text-base text-ink-secondary">
          Recording starts only if you allow it. Either of you can stop it at any time.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="lg" disabled={busy} onClick={onDecline}>
            Decline
          </Button>
          {/* Not disabled while saving: a disabled button drops focus to the
              page, and a failed save must leave the patient where they were. */}
          <Button autoFocus size="lg" aria-busy={busy} onClick={busy ? undefined : onAllow}>
            {busy ? 'Saving...' : 'Allow'}
          </Button>
        </div>
      </div>
    </div>
  )
}
