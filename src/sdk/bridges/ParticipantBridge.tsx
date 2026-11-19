import { useEffect } from 'react'
import { useParticipant } from '@videosdk.live/react-sdk'
import type { RoomStore } from '../store'
import type { NetworkQuality } from '../types'

/* useParticipant is inherently per-id, so this is the one bridge that renders
   more than once. Still exactly one subscription per participant, which is
   the floor rather than a choice.

   Media streams go to the store's non-reactive registry, not the snapshot: a
   MediaStream identity change on one person must not bump the version for the
   whole tree. */

export function ParticipantBridge({ id, store }: { id: string; store: RoomStore }) {
  const {
    displayName,
    micOn,
    webcamOn,
    isLocal,
    isActiveSpeaker,
    micStream,
    webcamStream,
    screenShareStream,
    getVideoStats,
    getAudioStats,
  } = useParticipant(id)

  useEffect(() => {
    store.upsertParticipant(id, {
      name: displayName || 'Someone',
      micOn: Boolean(micOn),
      camOn: Boolean(webcamOn),
      isLocal: Boolean(isLocal),
      isActiveSpeaker: Boolean(isActiveSpeaker),
    })
  }, [store, id, displayName, micOn, webcamOn, isLocal, isActiveSpeaker])

  useEffect(() => {
    const stream = micStream?.track ? new MediaStream([micStream.track]) : undefined
    store.setTrack(id, 'mic', stream)
    return () => store.setTrack(id, 'mic', undefined)
  }, [store, id, micStream])

  useEffect(() => {
    const stream = webcamStream?.track ? new MediaStream([webcamStream.track]) : undefined
    store.setTrack(id, 'cam', stream)
    return () => store.setTrack(id, 'cam', undefined)
  }, [store, id, webcamStream])

  /* The share track, on whoever is presenting. Never rendered in a tile - the
     stage reads it by presenter id. object-fit differs from a camera's too:
     a cropped screen loses the lab result being shown. */
  useEffect(() => {
    const stream = screenShareStream?.track
      ? new MediaStream([screenShareStream.track])
      : undefined
    store.setTrack(id, 'screen', stream)
    return () => store.setTrack(id, 'screen', undefined)
  }, [store, id, screenShareStream])

  /* Network quality, polled. No SDK event carries a per-participant signal:
     onQualityLimitation is the local sender only, and onVideoQualityChanged
     reports which simulcast layer we consume. A setTimeout chain rather than
     setInterval, so a slow getStats can never overlap the next one. */
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    /* Seeded from the store: a camera toggle restarts this effect, and a
       local 'unknown' would then never write over the stale level. */
    let shown: NetworkQuality = store.getSnapshot().participants[id]?.network ?? 'unknown'
    let last: NetworkQuality | null = null

    const tick = async () => {
      let reading: NetworkQuality = 'unknown'
      /* Camera stats when it is on, mic otherwise. Neither on means nothing
         flows to measure, which is 'unknown', not a bad connection. */
      const read = webcamOn ? getVideoStats : micOn ? getAudioStats : null
      try {
        const [entry] = (read ? await read() : null) ?? []
        reading = gradeStats(entry, Boolean(isLocal && webcamOn))
      } catch {
        // A stats call on a closing transport rejects; that is 'unknown'.
      }
      if (stopped) return
      /* Two consecutive readings must agree before the level moves, so one
         spike does not flicker the bars. upsertParticipant skips equal rows,
         so a steady level never re-renders anything. */
      if (reading === last && reading !== shown) {
        shown = reading
        store.upsertParticipant(id, { network: reading })
      }
      last = reading
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [store, id, webcamOn, micOn, isLocal, getVideoStats, getAudioStats])

  return null
}

const POLL_MS = 4000

interface StatsEntry {
  rtt?: number
  jitter?: number
  packetsLost?: number
  totalPackets?: number
  limitation?: { reason?: string } | null
}

/* The thresholds. Every field below is the SDK's per-interval DELTA, not a
   running total (js-sdk maps packetsLost from delta_packets_lost_*,
   totalPackets from delta_packets_*, rtt from delta_rtt_connectivity_ms,
   jitter from delta_jitter_ms_*), so the loss ratio needs no differencing
   here.

     good: rtt < 150ms and loss < 2%
     poor: rtt > 400ms or  loss > 8% or  jitter > 100ms
     fair: anything between

   Jitter only ever pushes toward poor. Inbound video jitter measured 15-50ms
   on a clean path (a frame leaves as a burst of packets), so a "good" bar
   gated on it showed fair for a call with no loss at 20ms rtt.

   Stats are only read for media that is on, so an interval with zero
   packets is a stalled stream and grades poor. Measured under a lossy link:
   the remote video entry reported totalPackets 0 for an interval while
   frozen, and reading that as 'unknown' hid the bars at the worst moment.
   On our own camera, a sender limited by bandwidth is at most 'fair' even
   when the path looks clean: the encoder already gave up resolution. */
function gradeStats(s: StatsEntry | undefined, localVideo: boolean): NetworkQuality {
  if (!s) return 'unknown'
  const sent = s.totalPackets ?? 0
  const lost = Math.max(0, s.packetsLost ?? 0)
  if (sent + lost === 0) return 'poor'
  const loss = lost / Math.max(sent, 1)
  const rtt = s.rtt ?? 0
  const jitter = s.jitter ?? 0
  if (rtt > 400 || loss > 0.08 || jitter > 100) return 'poor'
  const good = rtt < 150 && loss < 0.02
  if (good && !(localVideo && s.limitation?.reason === 'bandwidth')) return 'good'
  return 'fair'
}
