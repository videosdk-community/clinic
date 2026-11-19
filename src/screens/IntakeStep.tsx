import { useState } from 'react'
import { IntakeForm } from '../components/IntakeForm'
import { PatientFrame } from '../components/PatientFrame'
import { drShort, firstName } from '../lib/names'
import { submitIntake, type Intake } from '../lib/visits'

/* Step 1 for a patient who has not been let in yet: why they are here.

   Sent before the knock, so the admit card can show it. Skippable, and
   editable from the waiting room. Patients cannot read the visits table, so
   what they sent travels back up in client state. */

export function IntakeStep({
  roomId,
  doctorName,
  scheduledAt,
  patientName,
  onDone,
}: {
  roomId: string
  doctorName: string
  scheduledAt: string
  patientName: string
  onDone: (intake: Intake | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dr = drShort(doctorName)

  const send = async (intake: Intake) => {
    setBusy(true)
    setError(null)
    try {
      await submitIntake(roomId, intake)
      onDone(intake)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your answers could not be saved. Try again.')
      setBusy(false)
    }
  }

  return (
    <PatientFrame doctorName={doctorName} scheduledAt={scheduledAt} step={1}>
      <div className="vsdk-enter flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">
            What brings you in, {firstName(patientName)}?
          </h1>
          <p className="m-0 text-base text-ink-secondary">{dr} reads this before letting you in. It takes a minute.</p>
        </div>
        <IntakeForm
          initial={null}
          submitLabel="Continue"
          busy={busy}
          error={error}
          onSubmit={(intake) => void send(intake)}
          onSkip={() => onDone(null)}
          footnote={`Only ${dr} sees this. You can change it while you wait.`}
        />
      </div>
    </PatientFrame>
  )
}
