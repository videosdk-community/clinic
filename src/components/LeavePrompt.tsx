import { useEffect } from 'react'
import { Button } from '../design/ui'

/* "Leave the visit?" - shown when a Back gesture is caught, never from the
   Leave button, which is deliberate enough on its own.

   A dimmed full-screen layer rather than a pill, because the swipe that opened
   it was an accident and the answer has to be unmissable. Focus lands on Stay:
   the person did not mean to go anywhere, so Enter should return them to the
   visit. */

export interface LeavePromptProps {
  isDoctor: boolean
  onStay: () => void
  onLeave: () => void
}

export function LeavePrompt({ isDoctor, onStay, onLeave }: LeavePromptProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStay])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-video/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-prompt-title"
    >
      <div
        className="w-[380px] max-w-full rounded-xl border border-line-strong bg-card p-5"
        style={{ boxShadow: 'var(--elevation-popover)' }}
      >
        <h2 id="leave-prompt-title" className="text-lg font-semibold text-ink">
          Leave the visit?
        </h2>
        <p className="mt-1.5 text-base text-ink-secondary">
          {isDoctor
            ? 'You went back. Leaving ends the visit for both of you.'
            : 'You went back. You can join again from the same link.'}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button autoFocus variant="secondary" onClick={onStay}>
            Stay
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            {isDoctor ? 'End visit' : 'Leave'}
          </Button>
        </div>
      </div>
    </div>
  )
}
