import { runPreCallTest } from '@videosdk.live/react-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { warn } from '../log'
import { stopStream } from './tracks'
import type { usePrecall } from './usePrecall'

/* The pre-call check: runPreCallTest, reshaped for the precall screen.

   It runs on the precall preview tracks, passed as videoTrack/audioTrack,
   so the test never opens a second camera. The SDK does not stop tracks it
   was handed, which is what lets the same streams go on to MeetingProvider.
   A device that failed to open in precall is handed to the SDK by id
   instead, so the SDK's own error lands on that row; whatever the SDK opened
   that way is stopped here, because on success and on an abort during the
   network phase it comes back in the result still live.

   A microphone the user switched off is replaced by a silent track rather
   than opened by the SDK: a muted patient's mic must not go anywhere, not
   even to a test. A camera switched off means audioOnly. */

/** The SDK's floor. At it the whole test measured 11.0s. */
const SAMPLING_MS = 10000

export interface DeviceCheck {
  ok: boolean
  code?: string
}

export interface PrecallTestResult {
  /** null when the user had that device switched off. */
  camera: DeviceCheck | null
  microphone: DeviceCheck | null
  /** 1 (bad) to 5 (excellent). null when not measured. */
  uplink: number | null
  downlink: number | null
  /** Why a score is low (rtt, packetLoss, jitter, bandwidth, cpu, freeze). Empty when nothing is wrong. */
  factors: string[]
  /** The worst round trip and loss seen across both directions. */
  rttMs: number | null
  lossPct: number | null
}

/** Which row a whole-test failure belongs to. 'devices' is neither camera nor mic. */
export type PrecallTestPart = 'camera' | 'microphone' | 'devices' | 'network'

export type PrecallTestState =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'done'; result: PrecallTestResult }
  | { status: 'failed'; part: PrecallTestPart; code: string; message: string }

type PrecallMedia = Pick<
  ReturnType<typeof usePrecall>,
  'state' | 'preview' | 'micPreview' | 'camOn' | 'micOn' | 'cameraId' | 'microphoneId' | 'cameraFailed' | 'micFailed'
>

/* The typings say `camera: object` and `network: object`; these are the
   fields the measured result actually carries (DECISIONS.md). */
interface RawDevice { status?: boolean; track?: MediaStream; error?: { code?: string } }
interface RawStats { rtt?: number | null; packetLoss?: number | null }
interface RawDirection { quality?: number; factors?: string[]; audio?: RawStats | null; video?: RawStats | null }
interface RawResult {
  aborted: boolean
  camera?: RawDevice | null
  microphone?: RawDevice | null
  networkQuality?: { uplink?: RawDirection; downlink?: RawDirection } | null
}

const live = (s?: MediaStream) => s?.getTracks()[0]?.readyState === 'live'

function silence() {
  const ctx = new AudioContext()
  const stream = ctx.createMediaStreamDestination().stream
  return { stream, close: () => { stopStream(stream); void ctx.close() } }
}

function device(d: RawDevice | null | undefined, on: boolean): DeviceCheck | null {
  if (!on) return null
  return d?.status ? { ok: true } : { ok: false, code: d?.error?.code }
}

function shape(raw: RawResult, camOn: boolean, micOn: boolean): PrecallTestResult {
  const up = raw.networkQuality?.uplink
  const down = raw.networkQuality?.downlink
  const stats = [up?.audio, up?.video, down?.audio, down?.video]
  const worst = (k: keyof RawStats) => {
    const v = stats.map((s) => s?.[k]).filter((n): n is number => typeof n === 'number')
    return v.length ? Math.max(...v) : null
  }
  return {
    camera: device(raw.camera, camOn),
    microphone: device(raw.microphone, micOn),
    uplink: up?.quality ?? null,
    downlink: down?.quality ?? null,
    factors: [...new Set([...(up?.factors ?? []), ...(down?.factors ?? [])])],
    rttMs: worst('rtt'),
    lossPct: worst('packetLoss'),
  }
}

function partOf(code: string): PrecallTestPart {
  if (code === 'ERROR_PRECALL_MEDIA_CHECK_FAILED') return 'devices'
  if (/CAMERA|WEBCAM|VIDEO/.test(code)) return 'camera'
  if (/MICROPHONE|AUDIO/.test(code)) return 'microphone'
  return 'network'
}

export function usePrecallTest(token: string | undefined, media: PrecallMedia) {
  const [state, setState] = useState<PrecallTestState>({ status: 'idle' })
  /* The ORIGINAL promise: .stop() is not on anything chained from it. */
  const test = useRef<ReturnType<typeof runPreCallTest> | null>(null)
  /* Bumped by every run and stop, so a superseded test never writes state. */
  const gen = useRef(0)

  const stop = useCallback(async () => {
    gen.current++
    const t = test.current
    test.current = null
    await t?.stop()
  }, [])

  /* A fresh closure each render on purpose, so a rerun always reads the
     current tracks. */
  const run = async () => {
    if (!token) return
    const my = ++gen.current
    const m = media
    /* One test at a time, and stop() resolves only once the old one has torn
       down - otherwise this start fails with ERROR_PRECALL_TEST_ALREADY_RUNNING. */
    const prev = test.current
    test.current = null
    await prev?.stop()
    if (my !== gen.current) return

    const camera = live(m.preview) ? m.preview : undefined
    const mic = live(m.micPreview) ? m.micPreview : undefined
    const quiet = !mic && !m.micOn ? silence() : undefined
    const audioOnly = !camera && !m.camOn
    let sampling = 0
    setState({ status: 'running', progress: 0 })

    const t = runPreCallTest({
      token,
      samplingDuration: SAMPLING_MS,
      audioOnly,
      ...(camera
        ? { videoTrack: camera }
        : audioOnly
          ? {}
          : { videoConfig: { cameraId: m.cameraId, optimizationMode: 'motion' as const, multiStream: false } }),
      ...(mic || quiet
        ? { audioTrack: mic ?? quiet!.stream }
        : { audioConfig: { microphoneId: m.microphoneId } }),
      /* Fires about every 0.6s, and only while sampling, so progress is
         timed from the first call rather than from the media check. */
      onStatsChange: () => {
        if (my !== gen.current) return
        sampling ||= Date.now()
        setState({ status: 'running', progress: Math.min(1, (Date.now() - sampling) / SAMPLING_MS) })
      },
    })
    test.current = t

    try {
      const raw = (await t) as unknown as RawResult
      for (const d of [raw.camera, raw.microphone]) {
        if (d?.track && d.track !== camera && d.track !== mic) stopStream(d.track)
      }
      if (my === gen.current && !raw.aborted) setState({ status: 'done', result: shape(raw, m.camOn, m.micOn) })
    } catch (err) {
      if (my !== gen.current) return
      const { code = 'UNKNOWN', message = String(err) } = err as { code?: string; message?: string }
      warn('pre-call test failed', err)
      setState({ status: 'failed', part: partOf(code), code, message })
    } finally {
      quiet?.close()
      if (test.current === t) test.current = null
    }
  }

  /* Starts once each device has either opened or failed, and again whenever
     the tracks change - a camera switch stops the track a running test is
     sending, which would otherwise score the switch rather than the network. */
  const ready =
    Boolean(token) &&
    media.state === 'granted' &&
    (!media.camOn || Boolean(media.preview) || media.cameraFailed) &&
    (!media.micOn || Boolean(media.micPreview) || media.micFailed)

  useEffect(() => {
    if (!ready) return
    /* usePrecall's effects run first and have just stopped the old track of
       a device being switched; wait for the replacement. */
    if ((media.preview && !live(media.preview)) || (media.micPreview && !live(media.micPreview))) return
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, media.preview, media.micPreview, media.camOn, media.micOn, media.cameraFailed, media.micFailed])

  useEffect(() => () => { void stop() }, [stop])

  return {
    state,
    run: () => void run(),
    stop: () => { void stop(); setState({ status: 'idle' }) },
  }
}
