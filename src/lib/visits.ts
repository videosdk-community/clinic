import { apiPost } from './api'
import { supabase } from './supabase'

/* Visits, from both directions.

   Creating one goes through api/visits.ts, because it needs the VideoSDK
   secret and because public.visits has no insert policy at all. Admitting a
   patient goes through api/admit.ts, which checks ownership server-side.

   Listing and ending the visits you own go straight to Supabase under RLS.
   That is what the owner-scoped policies are for, and using them on the real
   path means a broken policy fails visibly here. */

export interface Visit {
  id: string
  roomId: string
  patientName: string
  doctorName: string
  scheduledAt: string
  createdAt: string
  endedAt: string | null
  recordingConsentBy: string | null
  recordingConsentAt: string | null
}

const COLUMNS =
  'id, room_id, patient_name, doctor_name, scheduled_at, created_at, ended_at, recording_consent_by, recording_consent_at'

function toVisit(r: Record<string, unknown>): Visit {
  return {
    id: r.id as string,
    roomId: r.room_id as string,
    patientName: r.patient_name as string,
    doctorName: r.doctor_name as string,
    scheduledAt: r.scheduled_at as string,
    createdAt: r.created_at as string,
    endedAt: r.ended_at as string | null,
    recordingConsentBy: r.recording_consent_by as string | null,
    recordingConsentAt: r.recording_consent_at as string | null,
  }
}

export async function createVisit(patientName: string, scheduledAt: string): Promise<Visit> {
  const { visit } = await apiPost<{
    visit: Omit<Visit, 'endedAt' | 'recordingConsentBy' | 'recordingConsentAt'>
  }>('/api/visits', { patientName, scheduledAt })
  return { ...visit, endedAt: null, recordingConsentBy: null, recordingConsentAt: null }
}

export async function listMyVisits(): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('visits')
    .select(COLUMNS)
    .order('scheduled_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map(toVisit)
}

/** One visit you own, or null when RLS hides it or it does not exist. */
export async function getMyVisit(roomId: string): Promise<Visit | null> {
  const { data, error } = await supabase
    .from('visits')
    .select(COLUMNS)
    .eq('room_id', roomId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? toVisit(data) : null
}

/* Marks a visit ended, at the moment its doctor ends it.

   Under RLS: only the owner's row matches. Clearing `admitted` ends every
   skip-the-knock admission with the visit. `is('ended_at', null)` keeps the
   first ending. The caller does not await this - see VisitRoom. */
export async function endVisit(roomId: string): Promise<void> {
  const { error } = await supabase
    .from('visits')
    .update({ ended_at: new Date().toISOString(), admitted: [] })
    .eq('room_id', roomId)
    .is('ended_at', null)

  if (error) throw new Error(error.message)
}

/** Records the admit server-side, so the same browser skips the knock on a rejoin. */
export async function admitPatient(roomId: string, participantId: string): Promise<void> {
  await apiPost<{ ok: true }>('/api/admit', { roomId, participantId })
}

/** The patient's consent to recording, written from their own session.
    The server answers 403 not_admitted and 409 visit_ended. */
export async function giveRecordingConsent(roomId: string): Promise<string> {
  const { consentAt } = await apiPost<{ consentAt: string }>('/api/consent', { roomId })
  return consentAt
}

/** The link the doctor sends. Same shape everywhere, so it is built once. */
export function visitLink(roomId: string): string {
  return `${window.location.origin}/v/${roomId}`
}

/** "Thu, Nov 20, 3:30 PM" in the viewer's own locale and time zone. */
export function formatVisitTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
