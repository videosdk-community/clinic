import { Button } from '../design/ui'
import { RoomIcon } from './icons'
import { formatDuration, formatRecordedAt, formatSize, type Recording } from '../lib/recordings'

/* One recording of a visit. The visit page already names the patient, so the
   row leads with when it was recorded. */

export interface RecordingRowProps {
  recording: Recording
  onPlay: () => void
}

export function RecordingRow({ recording, onPlay }: RecordingRowProps) {
  const recordedAt = formatRecordedAt(recording.createdAt)
  const size = formatSize(recording.sizeBytes)

  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors duration-[120ms] ease-standard hover:bg-subtle sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-inset text-ink-secondary">
        <RoomIcon name="record" size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-medium text-ink">
          {recordedAt ? `Recorded ${recordedAt}` : 'Recording'}
        </span>
        {/* Duration with the size, not as a separate badge: on a phone the
            badge took the width the title needed. */}
        <span className="truncate text-sm text-ink-tertiary">
          {formatDuration(recording.durationSeconds)} · {size || recording.id}
        </span>
      </div>
      <span className="flex shrink-0 items-center">
        <Button variant="secondary" className="max-sm:h-10" onClick={onPlay}>
          Play
        </Button>
      </span>
    </li>
  )
}
