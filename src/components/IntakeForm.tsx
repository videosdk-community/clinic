import { useState, type FormEvent, type ReactNode } from 'react'
import { Alert, Button, Input } from '../design/ui'
import { SINCE_LABEL, type Intake, type IntakeSince } from '../lib/visits'

/* The patient's intake: why they are here, in their words, before the doctor
   lets them in. Step 1 of the patient flow and the waiting room's Edit use
   this one form.

   Only the reason is required. "When" and "pain" are radio groups of native
   inputs, so arrows and screen readers work for free; tapping the selected
   option clears it, because both answers are optional. */

const SINCE = Object.keys(SINCE_LABEL) as IntakeSince[]
const PAIN = Array.from({ length: 11 }, (_, n) => n)

const LABEL = 'text-sm font-medium text-ink-secondary'
/* 16px type on a phone, or iOS zooms the page on focus. */
const FIELD_TEXT = '[&_input]:text-lg'

export interface IntakeFormProps {
  initial: Intake | null
  submitLabel: string
  busy?: boolean
  error?: string | null
  onSubmit: (intake: Intake) => void
  onSkip?: () => void
  onCancel?: () => void
  /** Small print under the buttons. */
  footnote?: ReactNode
}

export function IntakeForm({ initial, submitLabel, busy = false, error, onSubmit, onSkip, onCancel, footnote }: IntakeFormProps) {
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [symptoms, setSymptoms] = useState(initial?.symptoms ?? '')
  const [since, setSince] = useState<IntakeSince | null>(initial?.since ?? null)
  const [pain, setPain] = useState<number | null>(initial?.pain ?? null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim() || busy) return
    onSubmit({ reason: reason.trim(), symptoms: symptoms.trim() || null, since, pain })
  }

  return (
    <form className="flex flex-1 flex-col gap-5" onSubmit={submit}>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Reason for visit</span>
        <Input
          size="lg"
          required
          maxLength={200}
          value={reason}
          placeholder="For example, a rash on my arm"
          className={`max-sm:h-11 ${FIELD_TEXT}`}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>
          Symptoms <span className="font-normal text-ink-tertiary">(optional)</span>
        </span>
        <textarea
          rows={3}
          maxLength={1000}
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          className="min-h-11 w-full resize-none rounded-lg border-0 bg-card px-3 py-2.5 text-lg text-ink shadow-hairline outline-none transition-[box-shadow] duration-[120ms] ease-standard placeholder:text-ink-tertiary focus:shadow-[inset_0_0_0_1.5px_var(--color-accent-ring)]"
        />
      </label>

      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className={`${LABEL} mb-2 p-0`}>When did it start?</legend>
        <div className="flex flex-wrap gap-2">
          {SINCE.map((value) => (
            <label key={value} className="relative cursor-pointer">
              <input
                type="radio"
                name="intake-since"
                className="peer sr-only"
                checked={since === value}
                onChange={() => setSince(value)}
                onClick={() => since === value && setSince(null)}
              />
              <span className="flex h-9 items-center rounded-pill border border-line bg-card px-3 text-base font-medium text-ink-secondary peer-checked:border-accent-line peer-checked:bg-accent-soft peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ring max-sm:h-11">
                {SINCE_LABEL[value]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className={`${LABEL} mb-2 p-0`}>
          Pain right now <span className="font-normal text-ink-tertiary">(optional)</span>
        </legend>
        <div className="grid grid-cols-11 gap-1">
          {PAIN.map((n) => (
            <label key={n} className="relative cursor-pointer">
              <input
                type="radio"
                name="intake-pain"
                className="peer sr-only"
                aria-label={n === 0 ? '0, no pain' : n === 10 ? '10, worst pain' : String(n)}
                checked={pain === n}
                onChange={() => setPain(n)}
                onClick={() => pain === n && setPain(null)}
              />
              <span className="flex h-11 items-center justify-center rounded-lg border border-hairline bg-card text-base font-medium text-ink-secondary peer-checked:border-accent-mid peer-checked:bg-accent-mid peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ring sm:h-9">
                {n}
              </span>
            </label>
          ))}
        </div>
        <div aria-hidden className="mt-2 flex justify-between text-sm text-ink-tertiary">
          <span>No pain</span>
          <span>Worst pain</span>
        </div>
      </fieldset>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="mt-auto flex flex-col gap-1">
        <Button size="lg" type="submit" fullWidth className="max-sm:h-12 max-sm:text-lg" disabled={busy || !reason.trim()}>
          {busy ? 'Saving' : submitLabel}
        </Button>
        {onSkip && (
          <Button size="lg" variant="text" fullWidth className="max-sm:h-11" disabled={busy} onClick={onSkip}>
            Skip for now
          </Button>
        )}
        {onCancel && (
          <Button size="lg" variant="text" fullWidth className="max-sm:h-11" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        {footnote && <p className="m-0 text-center text-sm text-ink-tertiary">{footnote}</p>}
      </div>
    </form>
  )
}
