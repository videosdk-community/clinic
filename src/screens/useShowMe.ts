import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../design/ui'
import { SHOWME_TOPIC, useDoctorId, useLocalId, useParticipantIds, useRoomActions, useTopic } from '../sdk'

/* Show me: the doctor asks the patient for a closer look on their back camera.

   The same shape as useRecordingConsent, on SHOWME_TOPIC (unpersisted). The
   message text is the kind and the payload carries the request id:

     doctor  -> request { id, to }    to = the patient's participantId
     doctor  -> cancel  { id }        before or after an accept
     doctor  -> end     { id }        the close look is over
     patient -> accept  { id, back }  sent after switchCamera({ facing: 'environment' })
                                      resolves; back = it actually switched
     patient -> decline { id }

   The doctor acts only on an answer to its CURRENT request id from the
   participant that request went to; the patient only on the doctor. A patient
   without a back camera (every desktop) still accepts, with back false, and
   holds the thing up to the camera they have. The patient switches back to
   the front camera on end, on cancel, and when the doctor leaves - only if it
   switched in the first place. */

export interface ShowMe {
  /** Doctor: a request is out and unanswered. */
  pending: boolean
  /** Doctor: the patient accepted. `back` says whether they are on the back camera. */
  active: { back: boolean } | null
  /** Patient: the doctor is asking right now. */
  asking: boolean
  /** Patient: a back camera exists, so the prompt offers to switch to it. */
  hasBack: boolean
  /** Patient: the camera switch is in flight. */
  busy: boolean
  request: () => void
  cancel: () => void
  end: () => void
  accept: () => void
  decline: () => void
}

export function useShowMe(isDoctor: boolean, patientId: string | null, patientName: string): ShowMe {
  const messages = useTopic(SHOWME_TOPIC)
  const localId = useLocalId()
  const doctorId = useDoctorId()
  const ids = useParticipantIds()
  const actions = useRoomActions()
  const toast = useToast()

  /* Doctor: the current request, and the patient's answer once accepted. */
  const [req, setReq] = useState<{ id: string; to: string; back: boolean | null } | null>(null)
  /* Patient: the question on screen, and whether a back camera exists (null
     while the device list is being read). */
  const [askId, setAskId] = useState<string | null>(null)
  const [hasBack, setHasBack] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  /* Patient: the close look in progress. A ref, not state: nothing on the
     patient's screen draws it, it only says what to undo. */
  const showing = useRef<{ id: string; switched: boolean } | null>(null)

  /* The accept awaits a camera switch; a cancel can land meanwhile. */
  const askRef = useRef(askId)
  useEffect(() => {
    askRef.current = askId
  }, [askId])

  /* Everything already in the store at mount predates this participant's
     join, so reading starts after it. */
  const seen = useRef(messages.length)

  const doctorHere = doctorId !== null && ids.includes(doctorId)

  /* A request dies with the patient leaving; a question with the doctor
     leaving. Adjusted during render, as useRecordingConsent does. */
  if (req && req.to !== patientId) setReq(null)
  if (askId && !doctorHere) setAskId(null)
  if (!askId && hasBack !== null) setHasBack(null)

  const restore = useCallback(
    (switched: boolean) => {
      showing.current = null
      if (!switched) return
      actions
        .switchCamera({ facing: 'user' })
        .catch(() => toast('Could not switch back to your front camera.', 'warning'))
    },
    [actions, toast],
  )

  /* Once per question: whether to offer the back camera at all. */
  useEffect(() => {
    if (!askId) return
    let live = true
    actions
      .listDevices()
      .then((l) => l.cameras.some((c) => c.facing === 'environment'))
      .catch(() => false)
      .then((back) => live && setHasBack(back))
    return () => {
      live = false
    }
  }, [askId, actions])

  /* The doctor left mid close look: nobody is looking any more. */
  useEffect(() => {
    if (showing.current && !doctorHere) restore(showing.current.switched)
  }, [doctorHere, restore])

  useEffect(() => {
    const fresh = messages.slice(seen.current)
    seen.current = messages.length
    if (!localId) return
    for (const m of fresh) {
      const id = m.payload.id
      if (typeof id !== 'string') continue
      if (isDoctor) {
        if (!req || req.back !== null || id !== req.id || m.senderId !== req.to) continue
        if (m.text === 'accept') {
          setReq({ ...req, back: m.payload.back === true })
        } else if (m.text === 'decline') {
          setReq(null)
          toast(`${patientName} did not switch cameras`, 'neutral')
        }
      } else if (m.senderId === doctorId) {
        if (m.text === 'request' && m.payload.to === localId) setAskId(id)
        else if (m.text === 'cancel' || m.text === 'end') {
          setAskId((cur) => (cur === id ? null : cur))
          if (showing.current?.id === id) restore(showing.current.switched)
        }
      }
    }
  }, [messages, localId, doctorId, isDoctor, req, patientName, toast, restore])

  const send = (kind: string, payload: Record<string, unknown>) =>
    actions.publish(SHOWME_TOPIC, kind, payload)

  const stop = (kind: 'cancel' | 'end') => {
    if (!req) return
    setReq(null)
    void send(kind, { id: req.id }).catch(() => {})
  }

  return {
    pending: req !== null && req.back === null,
    active: req && req.back !== null ? { back: req.back } : null,
    asking: askId !== null && hasBack !== null,
    hasBack: hasBack === true,
    busy,

    request: () => {
      if (!patientId) {
        toast(`${patientName} has not joined yet`, 'neutral')
        return
      }
      const next = { id: crypto.randomUUID(), to: patientId }
      setReq({ ...next, back: null })
      send('request', next).catch(() => {
        setReq((cur) => (cur?.id === next.id ? null : cur))
        toast(`Could not ask ${patientName}. Try again.`, 'danger')
      })
    },

    cancel: () => stop('cancel'),
    end: () => stop('end'),

    /* The camera switches first, so the doctor's "accept" arrives with the
       back camera already on the wire. A cancel that landed during the switch
       wins: the camera goes back and nothing is sent. */
    accept: async () => {
      if (!askId || busy) return
      const id = askId
      setBusy(true)
      let switched = false
      try {
        switched = (await actions.switchCamera({ facing: 'environment' })) === 'switched'
        if (askRef.current !== id) {
          restore(switched)
          return
        }
        await send('accept', { id, back: switched })
        showing.current = { id, switched }
        setAskId((cur) => (cur === id ? null : cur))
      } catch {
        restore(switched)
        toast('Could not show the doctor your camera. Try again.', 'danger')
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
