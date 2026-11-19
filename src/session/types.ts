import type { Role } from '../domain/visit'

/* What api/session.ts hands back. Everything here is server-derived: the
   client sends a roomId and its Supabase access token, and nothing else in
   the request is read. */
export interface VisitSession {
  meetingId: string
  token: string
  /* Decoration, for deciding which controls to draw. The real enforcement is
     the permissions array inside `token`, and nowhere else. */
  role: Role
  participantId: string
  /* The doctor's participantId, derived server-side from visit ownership. */
  doctorParticipantId: string
  doctorName: string
  patientName: string
  scheduledAt: string
  /* True when this patient was admitted earlier in the visit, so the token
     skips the knock. */
  admitted: boolean
  expiresIn: number
}
