import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, handle, json, readJson, requirePost } from './_lib/http.js'
import { requireUser, serviceClient } from './_lib/supabase.js'
import { readRoomId, requireOpen, requireVisit } from './_lib/visits.js'

/* POST /api/consent - the patient records consent to recording.

   The patient writes this, not the doctor, so the audit row comes from the
   consenting party's own verified session. Only an admitted patient can,
   which rules out the doctor and anyone still knocking. */

export default handle(async (req: VercelRequest, res: VercelResponse) => {
  requirePost(req)

  const db = serviceClient()
  const user = await requireUser(req, db)

  const visit = await requireVisit(db, readRoomId(readJson(req).roomId))

  if (!visit.admitted.includes(user.id)) {
    throw new HttpError(403, 'not_admitted', 'Only an admitted patient can consent to recording.')
  }
  requireOpen(visit)

  const consentAt = new Date().toISOString()
  const { data, error } = await db
    .from('visits')
    .update({ recording_consent_by: user.id, recording_consent_at: consentAt })
    .eq('room_id', visit.room_id)
    .is('ended_at', null)
    .select('room_id')

  if (error) {
    console.error('[api] consent failed', error)
    throw new HttpError(500, 'internal', 'Consent could not be saved. Try again.')
  }
  if (!data || data.length === 0) {
    throw new HttpError(409, 'visit_ended', 'This visit has ended.')
  }

  json(res, 200, { consentAt })
})
