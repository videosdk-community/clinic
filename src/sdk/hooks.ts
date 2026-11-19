import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react'
import type { RoomStore } from './store'
import { NETWORK_TOPIC } from './topics'
import type { NetworkQuality, ParticipantView, RoomMessage, RoomSnapshot, TrackKind } from './types'

export const RoomStoreContext = createContext<RoomStore | null>(null)

export function useRoomStore(): RoomStore {
  const store = useContext(RoomStoreContext)
  if (!store) throw new Error('useRoomStore must be used inside <RoomProvider>')
  return store
}

/* The selector hook.

   useSyncExternalStore has no selector argument, and the naive wrapper
   `useSyncExternalStore(sub, () => select(getSnapshot()))` recreates the
   selected value on every call and loops forever. Two things prevent that:
   the store guarantees reference stability for anything already inside the
   snapshot, and this cache keys on the store's version counter so a derived
   value is computed at most once per commit and keeps its old reference when
   equal.

   Every call site below passes a MODULE-LEVEL selector constant, never an
   inline arrow. With stable identities the dependency list never fires, so
   `get` is built once; an inline arrow would rebuild it every render and
   defeat the cache. That discipline is enforced structurally rather than by
   convention: useSelector is not exported from index.ts, so no feature
   component can pass one. */
function useSelector<T>(select: (s: RoomSnapshot) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useRoomStore()
  const cache = useRef<{ version: number; value: T } | null>(null)

  const get = useCallback(() => {
    const version = store.getVersion()
    if (cache.current && cache.current.version === version) return cache.current.value

    const next = select(store.getSnapshot())
    if (cache.current && isEqual(cache.current.value, next)) {
      /* Keep the OLD reference. Returning a new-but-equal object here is
         exactly the loop this cache exists to prevent. */
      cache.current = { version, value: cache.current.value }
      return cache.current.value
    }
    cache.current = { version, value: next }
    return next
  }, [store, select, isEqual])

  return useSyncExternalStore(store.subscribe, get, get)
}

function arrayEqual<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

const EMPTY: readonly RoomMessage[] = []

// Module-level selectors, so nothing captures a fresh closure per render.
const selStatus = (s: RoomSnapshot) => s.status
const selLocalId = (s: RoomSnapshot) => s.localId
const selDoctorId = (s: RoomSnapshot) => s.doctorId
const selIds = (s: RoomSnapshot) => s.participantIds
const selPresenter = (s: RoomSnapshot) => s.presenterId
const selRecording = (s: RoomSnapshot) => s.isRecording
const selEntryQueue = (s: RoomSnapshot) => s.entryQueue
const selEntryDecision = (s: RoomSnapshot) => s.lastEntryDecision
const selMediaRequest = (s: RoomSnapshot) => s.mediaRequest
const selError = (s: RoomSnapshot) => s.lastError
const selLeaveReason = (s: RoomSnapshot) => s.leaveReason

export const useRoomStatus = () => useSelector(selStatus)
export const useLocalId = () => useSelector(selLocalId)
/** The doctor's participantId, as the server derived it from visit ownership. */
export const useDoctorId = () => useSelector(selDoctorId)
export const useParticipantIds = () => useSelector(selIds, arrayEqual)
/** Who is sharing a screen, or null. One presenter at a time, from the SDK. */
export const usePresenterId = () => useSelector(selPresenter)
export const useIsRecording = () => useSelector(selRecording)
export const useEntryQueue = () => useSelector(selEntryQueue, arrayEqual)
export const useEntryDecision = () => useSelector(selEntryDecision)
/** A pending "please turn your mic on" from a host, or null. */
export const useMediaRequest = () => useSelector(selMediaRequest)
export const useRoomError = () => useSelector(selError)
/** Why the meeting ended. The only room-ended signal the SDK has. */
export const useLeaveReason = () => useSelector(selLeaveReason)

/** One participant. The store gives these reference identity, so this is a
    plain read and needs no equality function. */
export function useParticipantView(id: string): ParticipantView | undefined {
  const store = useRoomStore()
  const get = useCallback(() => store.getSnapshot().participants[id], [store, id])
  return useSyncExternalStore(store.subscribe, get, get)
}

/** One participant's connection reading. Changes only when the smoothed
    level changes, never on every poll. */
/* A tile's level. For your own tile it is your own reading. For someone
   else's it is the WORSE of two readings: theirs, which they broadcast on
   NETWORK_TOPIC and which describes their link to the server, and ours of
   their stream, which describes our link. Our reading alone would show the
   doctor's bad Wi-Fi as the patient's bars. */
export function useNetworkQuality(id: string): NetworkQuality {
  const store = useRoomStore()
  const get = useCallback(() => {
    const snap = store.getSnapshot()
    const ours = snap.participants[id]?.network ?? 'unknown'
    if (id === snap.localId) return ours
    const reports = snap.topics[NETWORK_TOPIC] ?? EMPTY
    let theirs: NetworkQuality = 'unknown'
    for (let i = reports.length - 1; i >= 0; i--) {
      if (reports[i].senderId === id) {
        theirs = asQuality(reports[i].text)
        break
      }
    }
    return worse(ours, theirs)
  }, [store, id])
  return useSyncExternalStore(store.subscribe, get, get)
}

const RANK: Record<NetworkQuality, number> = { unknown: 0, good: 1, fair: 2, poor: 3 }

function worse(a: NetworkQuality, b: NetworkQuality): NetworkQuality {
  return RANK[a] >= RANK[b] ? a : b
}

function asQuality(text: string): NetworkQuality {
  return text === 'good' || text === 'fair' || text === 'poor' ? text : 'unknown'
}

export function useTopic(topic: string): readonly RoomMessage[] {
  const store = useRoomStore()
  const get = useCallback(() => store.getSnapshot().topics[topic] ?? EMPTY, [store, topic])
  return useSyncExternalStore(store.subscribe, get, get)
}

/** The imperative surface. One object, stable for the life of the provider.

    Deliberately not the registered object itself: bridges register in effects,
    and React flushes a parent's effects after its children render, so reading
    the real one during the first commit finds nothing. The facade resolves
    each call at call time instead, which is always an event handler and always
    after effects have run. */
export function useRoomActions() {
  return useRoomStore().getActionFacade()
}

/** Live media for one participant, from the non-reactive registry. */
export function useTrack(id: string, kind: TrackKind) {
  const store = useRoomStore()
  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribeTracks((changed) => {
        if (changed === id) onChange()
      }),
    [store, id],
  )
  const get = useCallback(() => store.getTrack(id, kind), [store, id, kind])
  return useSyncExternalStore(subscribe, get, get)
}
