import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, handle, json, requireGet } from './_lib/http.js'
import { readEnv } from './_lib/env.js'
import { signMeetingToken } from './_lib/tokens.js'
import { listRecordings } from './_lib/videosdk.js'
import { requireUser, serviceClient } from './_lib/supabase.js'
import { readRoomId, requireVisit } from './_lib/visits.js'

/* GET /api/recordings?roomId= - the recordings of one visit you own.

   VideoSDK has no owner concept: every recording under the account is
   reachable by anyone holding the secret. So ownership is checked here, on
   public.visits under the service role, before any REST call goes out. */

export default handle(async (req: VercelRequest, res: VercelResponse) => {
  requireGet(req)

  const env = readEnv()
  const db = serviceClient()
  const user = await requireUser(req, db)

  const raw = req.query.roomId
  const visit = await requireVisit(db, readRoomId(Array.isArray(raw) ? raw[0] : raw))

  /* Same answer as a missing visit, so a room id cannot be probed for
     existence. */
  if (visit.owner_id !== user.id) {
    throw new HttpError(404, 'visit_not_found', 'That link does not point to a visit.')
  }

  /* Unscoped and short-lived, exactly like the room-creation token. */
  const restToken = signMeetingToken({
    apiKey: env.videosdkApiKey,
    secret: env.videosdkSecret,
    permissions: ['allow_join', 'allow_mod'],
    ttlSeconds: 120,
  })

  const files = await listRecordings(restToken, visit.room_id)

  json(res, 200, {
    recordings: files.map((file) => ({
      id: file.id,
      roomId: visit.room_id,
      fileUrl: file.fileUrl,
      sizeBytes: file.sizeBytes,
      durationSeconds: file.durationSeconds,
      createdAt: file.createdAt,
    })),
  })
})
