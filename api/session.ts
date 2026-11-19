import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handle, json, readJson, requirePost } from './_lib/http.js'
import { readEnv } from './_lib/env.js'
import { signMeetingToken, type Permission } from './_lib/tokens.js'
import { requireUser, serviceClient } from './_lib/supabase.js'
import { readRoomId, requireOpen, requireVisit } from './_lib/visits.js'

/* POST /api/session - the security centre of the whole app.

   It verifies the Supabase session, looks up the visit, and derives the
   meeting permissions from two server-side facts: who owns the visit, and
   whether the doctor already admitted this user. Nothing else in the request
   is read - no role, no permissions, no participantId.

   It also returns the names and time, which is how the patient's join page
   learns them without any read access to public.visits. */

const DOCTOR: readonly Permission[] = ['allow_join', 'allow_mod']
const ADMITTED_PATIENT: readonly Permission[] = ['allow_join']
const KNOCKING_PATIENT: readonly Permission[] = ['ask_join']

/* Long enough that nobody is disconnected mid-sentence by a slow precall,
   short enough that a leaked token is worthless by the time it is found.
   VideoSDK validates the token at join only, so expiry never interrupts an
   active participant. */
const TTL_SECONDS = 600

export default handle(async (req: VercelRequest, res: VercelResponse) => {
  requirePost(req)

  const env = readEnv()
  const db = serviceClient()
  const user = await requireUser(req, db)

  const visit = await requireVisit(db, readRoomId(readJson(req).roomId))

  /* A visit is one-time, so ended means ended for the doctor too. There is no
     restart on the same link. */
  requireOpen(visit)

  const isOwner = visit.owner_id === user.id
  const isAdmitted = !isOwner && visit.admitted.includes(user.id)

  /* participantId is the verified Supabase user id. With version 2 in the
     payload it pins one seat per user, and it is the id the admitted list
     is keyed on, so a returning patient is recognised by identity, not by a
     value the client chose. */
  const token = signMeetingToken({
    apiKey: env.videosdkApiKey,
    secret: env.videosdkSecret,
    permissions: isOwner ? DOCTOR : isAdmitted ? ADMITTED_PATIENT : KNOCKING_PATIENT,
    roomId: visit.room_id,
    participantId: user.id,
    ttlSeconds: TTL_SECONDS,
  })

  res.setHeader('Cache-Control', 'no-store')
  json(res, 200, {
    meetingId: visit.room_id,
    token,
    /* Decoration, for deciding which buttons to draw. The enforcement lives
       in the token's permissions array and nowhere else. */
    role: isOwner ? 'doctor' : 'patient',
    participantId: user.id,
    /* From ownership, on the same lookup that decided the permissions, so no
       client can claim to be the doctor's seat. */
    doctorParticipantId: visit.owner_id,
    doctorName: visit.doctor_name,
    patientName: visit.patient_name,
    scheduledAt: visit.scheduled_at,
    /* True when this token joins without knocking: the doctor, or a patient
       the doctor already let in. */
    admitted: isOwner || isAdmitted,
    expiresIn: TTL_SECONDS,
  })
})
