import { useMediaDevice } from '@videosdk.live/react-sdk'
import { warn } from '../log'
import type { CameraFacing } from '../types'

/* Device enumeration, normalised to one shape.

   The SDK offers two families with DIFFERENT names on either side of
   MeetingProvider: getCameras/getMicrophones outside it, getWebcams/getMics
   inside. They also return different shapes. Both are flattened to
   MediaDeviceOption so the picker component is the same on both sides and no
   feature code has to know which side of the provider it is on. */

export interface MediaDeviceOption {
  id: string
  label: string
}

export function toOption(d: { deviceId?: string; label?: string }, index: number, kind: string): MediaDeviceOption {
  return {
    id: d.deviceId ?? '',
    /* Labels are empty until permission is granted; a numbered fallback beats
       a list of blank rows. */
    label: d.label || `${kind} ${index + 1}`,
  }
}

/** Outside MeetingProvider. */
export function usePrecallDevices() {
  const { getCameras, getMicrophones } = useMediaDevice()

  return {
    async cameras(): Promise<MediaDeviceOption[]> {
      try {
        return (await getCameras()).map((d, i) => toOption(d, i, 'Camera'))
      } catch (err) {
        warn('getCameras failed', err)
        return []
      }
    },
    async microphones(): Promise<MediaDeviceOption[]> {
      try {
        return (await getMicrophones()).map((d, i) => toOption(d, i, 'Microphone'))
      } catch (err) {
        warn('getMicrophones failed', err)
        return []
      }
    },
  }
}

function asFacing(v: unknown): CameraFacing | null {
  return v === 'user' || v === 'environment' ? v : null
}

/* Which way each camera faces, keyed by deviceId.

   Not from the SDK. On the web getWebcams() reports `facing || "environment"`
   over raw MediaDeviceInfo entries, which have no `facing`, so every web
   camera comes back "environment" - desktops and Chromium's fake camera
   included. Trusting it would "switch to the back camera" on a laptop.

   Chromium answers through InputDeviceInfo.getCapabilities(); Safari has no
   such method but labels its cameras "Front Camera" / "Back Camera", and
   Android Chrome's labels end "facing front" / "facing back". */
// ponytail: English labels only, a localised iPhone falls back to null and the UI's no-back-camera path
export async function cameraFacings(): Promise<Map<string, CameraFacing | null>> {
  const facings = new Map<string, CameraFacing | null>()
  try {
    for (const d of await navigator.mediaDevices.enumerateDevices()) {
      if (d.kind !== 'videoinput') continue
      let caps: string[] = []
      try {
        caps = (d as InputDeviceInfo).getCapabilities?.().facingMode ?? []
      } catch {
        // Some browsers expose the method and throw before permission.
      }
      facings.set(
        d.deviceId,
        caps.includes('user') || /\b(front|user)\b/i.test(d.label)
          ? 'user'
          : caps.includes('environment') || /\b(back|rear|environment)\b/i.test(d.label)
            ? 'environment'
            : null,
      )
    }
  } catch (err) {
    warn('enumerateDevices failed', err)
  }
  return facings
}

/** The device a live stream is really on, read from its track. */
export function streamDevice(stream: MediaStream | undefined | null) {
  const s = stream?.getTracks()[0]?.getSettings()
  return { id: s?.deviceId || null, facing: asFacing(s?.facingMode) }
}
