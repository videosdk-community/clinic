import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, handle, json, readJson, requirePost } from './_lib/http.js'
import { requireUser, serviceClient } from './_lib/supabase.js'
import { readRoomId, requireOpen, requireVisit } from './_lib/visits.js'

/* POST /api/intake - the patient sends their pre-visit intake.

   Unlike consent, the caller is not admitted yet: the intake is filled before
   the knock and can be edited from the waiting room. So anyone with the link
   may write it, and intake_by records who did. The admit card only shows an
   intake whose intake_by is the person knocking.

   Once the doctor has admitted someone, only an admitted participant may
   change it, so a later stranger cannot overwrite the real patient's words.
   The doctor never writes it. Sending again replaces the whole intake. */

const SINCE = ['today', 'days', 'week', 'longer'] as const

function text(value: unknown, max: number, field: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_body', `${field} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new HttpError(400, 'invalid_body', `${field} is too long.`)
  return trimmed || null
}

export default handle(async (req: VercelRequest, res: VercelResponse) => {
  requirePost(req)

  const body = readJson(req)
  const reason = text(body.reason, 200, 'Reason')
  if (!reason) throw new HttpError(400, 'invalid_body', 'Say why you are seeing the doctor.')
  const symptoms = text(body.symptoms, 1000, 'Symptoms')
  const since = body.since ?? null
  if (since !== null && !SINCE.includes(since as (typeof SINCE)[number])) {
    throw new HttpError(400, 'invalid_body', 'Pick when it started.')
  }
  const pain = body.pain ?? null
  if (pain !== null && !(Number.isInteger(pain) && (pain as number) >= 0 && (pain as number) <= 10)) {
    throw new HttpError(400, 'invalid_body', 'Pain is a whole number from 0 to 10.')
  }

  const db = serviceClient()
  const user = await requireUser(req, db)
  const visit = await requireVisit(db, readRoomId(body.roomId))

  if (visit.owner_id === user.id) {
    throw new HttpError(403, 'not_patient', 'Only the patient fills in the intake.')
  }
  if (visit.admitted.length > 0 && !visit.admitted.includes(user.id)) {
    throw new HttpError(403, 'not_admitted', 'The doctor has already let someone else in.')
  }
  requireOpen(visit)

  const intakeAt = new Date().toISOString()
  const { data, error } = await db
    .from('visits')
    .update({
      intake_reason: reason,
      intake_symptoms: symptoms,
      intake_since: since,
      intake_pain: pain,
      intake_by: user.id,
      intake_at: intakeAt,
    })
    .eq('room_id', visit.room_id)
    .is('ended_at', null)
    .select('room_id')

  if (error) {
    console.error('[api] intake failed', error)
    throw new HttpError(500, 'internal', 'Your answers could not be saved. Try again.')
  }
  if (!data || data.length === 0) {
    throw new HttpError(409, 'visit_ended', 'This visit has ended.')
  }

  json(res, 200, { intakeAt })
})
