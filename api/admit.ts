import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, handle, json, readJson, requirePost } from './_lib/http.js'
import { requireUser, serviceClient } from './_lib/supabase.js'
import { readRoomId, requireOpen, requireVisit } from './_lib/visits.js'

/* POST /api/admit - the doctor records that a patient was let in, so that
   patient's next api/session call gets allow_join instead of ask_join.

   The participantId here is read from the body, unlike everywhere else. That
   is safe because only the visit owner can write it, and the doctor's client
   got it from the SDK's knock event for the person they just admitted. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default handle(async (req: VercelRequest, res: VercelResponse) => {
  requirePost(req)

  const db = serviceClient()
  const user = await requireUser(req, db)

  const body = readJson(req)
  const visit = await requireVisit(db, readRoomId(body.roomId))

  if (visit.owner_id !== user.id) {
    throw new HttpError(403, 'not_owner', 'Only the doctor for this visit can admit patients.')
  }
  requireOpen(visit)

  const participantId = typeof body.participantId === 'string' ? body.participantId.trim() : ''
  /* Participant ids are Supabase user ids, and admitted is uuid[]. */
  if (!UUID.test(participantId)) {
    throw new HttpError(400, 'invalid_body', 'participantId must be a participant id.')
  }
  if (participantId === visit.owner_id) {
    throw new HttpError(400, 'invalid_body', 'The doctor does not need admitting.')
  }

  if (visit.admitted.includes(participantId)) {
    json(res, 200, { ok: true })
    return
  }

  /* ponytail: read-then-write. Two admits for DIFFERENT patients landing in
     the same instant could drop one; the doctor clicks one card at a time, and
     the dropped patient only knocks again on rejoin. Move to an rpc doing
     array_append if that ever matters. */
  const { data, error } = await db
    .from('visits')
    .update({ admitted: [...visit.admitted, participantId] })
    .eq('room_id', visit.room_id)
    .is('ended_at', null)
    .select('room_id')

  if (error) {
    console.error('[api] admit failed', error)
    throw new HttpError(500, 'internal', 'The patient could not be admitted. Try again.')
  }
  /* The visit ended between the read and the write. */
  if (!data || data.length === 0) {
    throw new HttpError(409, 'visit_ended', 'This visit has ended.')
  }

  json(res, 200, { ok: true })
})
