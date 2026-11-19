import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from './http.js'

/* The one visit lookup every handler shares. Always by room_id, always under
   the service role, so the patient never needs a read policy on the table. */

export interface Visit {
  room_id: string
  owner_id: string
  doctor_name: string
  patient_name: string
  scheduled_at: string
  ended_at: string | null
  admitted: string[]
}

export function readRoomId(value: unknown): string {
  const roomId = typeof value === 'string' ? value.trim() : ''
  if (!roomId) {
    throw new HttpError(400, 'invalid_body', 'No visit was named in the request.')
  }
  return roomId
}

export async function requireVisit(db: SupabaseClient, roomId: string): Promise<Visit> {
  const { data, error } = await db
    .from('visits')
    .select('room_id, owner_id, doctor_name, patient_name, scheduled_at, ended_at, admitted')
    .eq('room_id', roomId)
    .maybeSingle()

  if (error) {
    console.error('[api] visits lookup failed', error)
    throw new HttpError(500, 'internal', 'The visit could not be looked up. Try again.')
  }
  if (!data) {
    throw new HttpError(404, 'visit_not_found', 'That link does not point to a visit.')
  }
  return data as Visit
}

export function requireOpen(visit: Visit): void {
  if (visit.ended_at) {
    throw new HttpError(409, 'visit_ended', 'This visit has ended.')
  }
}
