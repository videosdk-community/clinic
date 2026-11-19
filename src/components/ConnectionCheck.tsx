import type { ReactNode } from 'react'
import { Badge, Button, type BadgeTone } from '../design/ui'
import type { PrecallTestPart, PrecallTestState } from '../sdk'

/* "Check your connection": the pre-call test, as three rows.

   It never gates anything. Join stays live while the test runs and after a
   bad result; the most it does is suggest a fix. */

type Level = { tone: BadgeTone; label: string }

const CHECKING: Level = { tone: 'neutral', label: 'Checking...' }
const OFF: Level = { tone: 'neutral', label: 'Off' }
const NOT_CHECKED: Level = { tone: 'neutral', label: 'Not checked' }
const WORKING: Level = { tone: 'success', label: 'Working' }
const BROKEN: Level = { tone: 'danger', label: 'Not working' }

/** The SDK scores 1 (bad) to 5 (excellent): 4-5 good, 3 fair, 1-2 poor. */
function networkLevel(score: number): Level {
  if (score >= 4) return { tone: 'success', label: 'Good' }
  if (score === 3) return { tone: 'warning', label: 'Fair' }
  return { tone: 'danger', label: 'Poor' }
}

const FAILURE_HINT: Record<PrecallTestPart, string> = {
  camera: 'Your camera did not start. You can still join with sound only.',
  microphone: 'Your microphone did not start. You can still join and use the chat.',
  devices: 'Your camera and microphone did not start. You can still join and use the chat.',
  network: 'We could not check your connection. You can still join.',
}

const WEAK_HINT = 'Your connection is weak. Try moving closer to your Wi-Fi router or closing other apps.'

export function ConnectionCheck({
  state,
  camOn,
  micOn,
  onRunAgain,
}: {
  state: PrecallTestState
  camOn: boolean
  micOn: boolean
  onRunAgain: () => void
}) {
  let camera = camOn ? CHECKING : OFF
  let microphone = micOn ? CHECKING : OFF
  let network = CHECKING
  let detail: string | undefined
  let hint: string | undefined

  if (state.status === 'done') {
    const r = state.result
    if (r.camera) camera = r.camera.ok ? WORKING : BROKEN
    if (r.microphone) microphone = r.microphone.ok ? WORKING : BROKEN
    const scores = [r.uplink, r.downlink].filter((n): n is number => n !== null)
    network = scores.length ? networkLevel(Math.min(...scores)) : NOT_CHECKED
    if (network.tone === 'danger') hint = WEAK_HINT
    else if (r.camera?.ok === false) hint = FAILURE_HINT.camera
    else if (r.microphone?.ok === false) hint = FAILURE_HINT.microphone
    detail = [
      r.rttMs !== null && `${r.rttMs} ms delay`,
      r.lossPct !== null && `${r.lossPct}% loss`,
    ]
      .filter(Boolean)
      .join(', ')
  }

  if (state.status === 'failed') {
    const { part } = state
    camera = !camOn ? OFF : part === 'camera' || part === 'devices' ? BROKEN : NOT_CHECKED
    microphone = !micOn ? OFF : part === 'microphone' || part === 'devices' ? BROKEN : NOT_CHECKED
    network = part === 'network' ? { tone: 'danger', label: 'Could not check' } : NOT_CHECKED
    hint = FAILURE_HINT[part]
  }

  const settled = state.status === 'done' || state.status === 'failed'

  return (
    <section aria-label="Connection check" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">Check your connection</h2>
        {settled && (
          <Button size="sm" variant="text" onClick={onRunAgain}>
            Run again
          </Button>
        )}
      </div>

      {state.status === 'running' && (
        <div
          role="progressbar"
          aria-label="Checking your connection"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.progress * 100)}
          className="h-1 overflow-hidden rounded-pill bg-muted"
        >
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-500 ease-linear"
            style={{ width: `${state.progress * 100}%` }}
          />
        </div>
      )}

      <ul className="flex flex-col gap-2">
        <Row label="Camera" level={camera} />
        <Row label="Microphone" level={microphone} />
        <Row label="Network" level={network}>
          {detail && <span className="text-sm text-ink-tertiary">{detail}</span>}
        </Row>
      </ul>

      {hint && <p className="text-sm text-ink-secondary">{hint}</p>}
    </section>
  )
}

function Row({ label, level, children }: { label: string; level: Level; children?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-base text-ink">{label}</span>
        {children}
      </span>
      <Badge tone={level.tone} dot aria-live="polite">
        {level.label}
      </Badge>
    </li>
  )
}
