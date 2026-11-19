import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, handle, json, readJson, requirePost } from './_lib/http.js'
import { readEnv } from './_lib/env.js'
import { signMeetingToken } from './_lib/tokens.js'
import { createRoom } from './_lib/videosdk.js'
import { requireUser, serviceClient } from './_lib/supabase.js'

/* POST /api/visits - a doctor books a visit.

   Creating the VideoSDK room needs the account secret, and public.visits has
   no insert policy, so this handler under the service role is the only way a
   row exists. owner_id comes from the verified session and nothing else: it is
   the fact every later role decision is derived from. */

export default handle(async (req: VercelRequest, res: VercelResponse) => {
  requirePost(req)

  const env = readEnv()
  const db = serviceClient()
  const user = await requireUser(req, db)

  /* Patients are anonymous users with a valid session too. Without this, any
     patient could mint visits they own and get allow_mod in them. */
  if (user.is_anonymous) {
    throw new HttpError(403, 'doctor_only', 'Only a signed-in doctor can create visits.')
  }

  const body = readJson(req)
  const patientName = typeof body.patientName === 'string' ? body.patientName.trim() : ''
  const scheduledAt = typeof body.scheduledAt === 'string' ? new Date(body.scheduledAt) : null

  if (patientName.length < 1 || patientName.length > 80) {
    throw new HttpError(400, 'invalid_body', "Give the patient's name, up to 80 characters.")
  }
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    throw new HttpError(400, 'invalid_body', 'scheduledAt must be an ISO date and time.')
  }

  const displayName =
    typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name.trim() : ''
  const doctorName = (displayName || user.email?.split('@')[0] || 'Doctor').slice(0, 80)

  /* Unscoped and short-lived: this token exists to create a room, so it has
     no roomId to be scoped to yet. */
  const restToken = signMeetingToken({
    apiKey: env.videosdkApiKey,
    secret: env.videosdkSecret,
    permissions: ['allow_join', 'allow_mod'],
    ttlSeconds: 120,
  })

  const { roomId } = await createRoom(restToken)

  const { data, error } = await db
    .from('visits')
    .insert({
      room_id: roomId,
      owner_id: user.id,
      doctor_name: doctorName,
      patient_name: patientName,
      scheduled_at: scheduledAt.toISOString(),
    })
    .select('id, room_id, patient_name, doctor_name, scheduled_at, created_at')
    .single()

  if (error || !data) {
    /* The VideoSDK room now exists with no row pointing at it. We leave it:
       a room costs nothing until someone joins, and a compensating delete is
       more failure surface than the leak it cleans up. */
    console.error('[api] visits insert failed', error)
    throw new HttpError(500, 'internal', 'The visit could not be saved. Try again.')
  }

  json(res, 201, {
    visit: {
      id: data.id,
      roomId: data.room_id,
      patientName: data.patient_name,
      doctorName: data.doctor_name,
      scheduledAt: data.scheduled_at,
      createdAt: data.created_at,
    },
  })
})
