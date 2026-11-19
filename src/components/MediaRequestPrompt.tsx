import { RoomIcon } from './icons'
import { Button } from '../design/ui'
import type { MediaRequest } from '../sdk'

/* "Dr. X asked you to turn your microphone on."

   This is the other half of the doctor's "Ask to unmute". enableMic() and
   enableWebcam() only REQUEST - they fire onMicRequested / onWebcamRequested
   on the target, who decides. There is no force-unmute anywhere in the SDK,
   and without this prompt the request lands on a patient who is never told.

   It sits above the control bar, because the answer is about the two buttons
   directly below it. */

export interface MediaRequestPromptProps {
  request: MediaRequest
  requesterName: string
  onRespond: (accept: boolean) => void
}

export function MediaRequestPrompt({ request, requesterName, onRespond }: MediaRequestPromptProps) {
  const thing = request.kind === 'mic' ? 'microphone' : 'camera'

  return (
    <div className="flex justify-center px-3 pb-2">
      <div
        role="alertdialog"
        aria-label={`${requesterName} asked you to turn your ${thing} on`}
        className="flex w-full max-w-[520px] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-card py-2 pl-4 pr-2"
        style={{ boxShadow: 'var(--elevation-popover)' }}
      >
        <span className="flex min-w-0 flex-1 basis-[220px] items-center gap-2.5 text-base text-ink-secondary">
          <RoomIcon name={request.kind === 'mic' ? 'mic' : 'cam'} size={16} className="shrink-0 text-ink-tertiary" />
          {requesterName} asked you to turn your {thing} on
        </span>
        <span className="ml-auto flex shrink-0 gap-2">
          <Button size="lg" variant="secondary" onClick={() => onRespond(false)}>
            Not now
          </Button>
          <Button size="lg" onClick={() => onRespond(true)}>
            Turn on
          </Button>
        </span>
      </div>
    </div>
  )
}
