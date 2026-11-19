import { useEffect, useRef, useState } from 'react'
import { useToast } from '../design/ui'
import { giveRecordingConsent } from '../lib/visits'
import { CONSENT_TOPIC, useDoctorId, useIsRecording, useLocalId, useRoomActions, useTopic } from '../sdk'

/* Recording consent, asked at the moment recording would start.

   The protocol rides CONSENT_TOPIC (unpersisted). The message text is the
   kind and the payload carries the request id:

     doctor  -> request { id, to }   to = the patient's participantId
     doctor  -> cancel  { id }
     patient -> allow   { id }       sent only after POST /api/consent succeeds
     patient -> decline { id }

   Only the doctor ever starts a recording, and only on an `allow` that
   answers its CURRENT request id and comes from the participant that request
   went to. Anything else - an old answer, someone else's answer, a message
   that was already in the store when this mounted - is ignored. */

export interface RecordingConsent {
  /** Doctor: a request is out and unanswered. */
  pending: boolean
  /** Patient: the doctor is asking right now. */
  asking: boolean
  /** Patient: the consent write is in flight. */
  busy: boolean
  request: () => void
  cancel: () => void
  allow: () => void
  decline: () => void
}

export function useRecordingConsent(
  roomId: string,
  isDoctor: boolean,
  patientId: string | null,
  patientName: string,
): RecordingConsent {
  const messages = useTopic(CONSENT_TOPIC)
  const localId = useLocalId()
  const doctorId = useDoctorId()
  const recording = useIsRecording()
  const actions = useRoomActions()
  const toast = useToast()

  const [pending, setPending] = useState<{ id: string; to: string } | null>(null)
  const [askId, setAskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* Everything already in the store at mount predates this participant's
     join, so reading starts after it. */
  const seen = useRef(messages.length)

  /* A request dies with the recording starting or the patient leaving.
     Adjusted during render, React's pattern for state derived from a change. */
  if (pending && (recording || pending.to !== patientId)) setPending(null)
  if (askId && recording) setAskId(null)

  useEffect(() => {
    const fresh = messages.slice(seen.current)
    seen.current = messages.length
    if (!localId) return
    for (const m of fresh) {
      const id = m.payload.id
      if (typeof id !== 'string') continue
      if (isDoctor) {
        if (!pending || id !== pending.id || m.senderId !== pending.to) continue
        if (m.text === 'allow') {
          setPending(null)
          if (!recording) actions.startRecording()
        } else if (m.text === 'decline') {
          setPending(null)
          toast(`${patientName} declined recording`, 'neutral')
        }
      } else if (m.senderId === doctorId) {
        if (m.text === 'request' && m.payload.to === localId) setAskId(id)
        else if (m.text === 'cancel') setAskId((cur) => (cur === id ? null : cur))
      }
    }
  }, [messages, localId, doctorId, isDoctor, pending, recording, patientName, actions, toast])

  const send = (kind: string, payload: Record<string, unknown>) =>
    actions.publish(CONSENT_TOPIC, kind, payload)

  return {
    pending: pending !== null,
    asking: askId !== null,
    busy,

    request: () => {
      if (!patientId) {
        toast(`${patientName} has not joined yet`, 'neutral')
        return
      }
      const next = { id: crypto.randomUUID(), to: patientId }
      setPending(next)
      send('request', next).catch(() => {
        setPending((cur) => (cur?.id === next.id ? null : cur))
        toast(`Could not ask ${patientName}. Try again.`, 'danger')
      })
    },

    cancel: () => {
      if (!pending) return
      setPending(null)
      void send('cancel', { id: pending.id }).catch(() => {})
    },

    /* Consent is written first, by the patient's own session. Only once the
       server has it does the doctor hear "allow". A failure leaves the dialog
       open, so the patient can try again or decline. */
    allow: async () => {
      if (!askId || busy) return
      const id = askId
      setBusy(true)
      try {
        await giveRecordingConsent(roomId)
        await send('allow', { id })
        setAskId((cur) => (cur === id ? null : cur))
      } catch {
        toast('Your answer did not go through, so nothing is being recorded. Try again.', 'danger')
      } finally {
        setBusy(false)
      }
    },

    decline: () => {
      if (!askId || busy) return
      const id = askId
      setAskId(null)
      send('decline', { id }).catch(() => toast('Your answer did not reach the doctor.', 'warning'))
    },
  }
}
