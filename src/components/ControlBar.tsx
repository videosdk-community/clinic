import { CtrlBtn } from './CtrlBtn'
import { useEffect, useState } from 'react'
import { DeviceMenu } from './DeviceMenu'
import { DevicesSheet } from './DevicesSheet'
import { RoomIcon, type IconName } from './icons'
import { BottomSheet, cn, useToast } from '../design/ui'
import { useDeviceClass } from '../lib/useDeviceClass'
import { useLocalDevices, useRoomActions } from '../sdk'

/* The control bar: mic, camera, screen share, chat, leave. The doctor also
   gets Show me and Record, and their exit says "End visit" because it closes
   the room for both people. While a recording runs, the patient gets Stop
   too: either side can stop it. Mic and camera are split buttons whose
   chevron opens a device menu. Phone gets its own bar, below, with the same
   props. */

/** The doctor's Show me control: idle, asking the patient, or a close look on. */
export interface ShowMeControl {
  state: 'idle' | 'pending' | 'active'
  /** Nobody to ask until the patient is in. */
  disabled: boolean
  /** Asks when idle, ends the close look when active. */
  onClick: () => void
}

export interface ControlBarProps {
  /** Who the visit is with, shown at the left edge on tablet and desktop. */
  title: string
  elapsed: string

  micOn: boolean
  camOn: boolean
  onToggleMic: () => void
  onToggleCam: () => void

  /** Whether the LOCAL participant is presenting, not whether anyone is. */
  sharingScreen: boolean
  /** Somebody else is presenting. One presenter at a time is the SDK's model,
      so the control disables itself rather than failing on the click. */
  shareTakenBy: string | null
  /** getDisplayMedia is absent on mobile browsers, so the control says why
      it is off rather than opening nothing. */
  shareSupported: boolean
  onToggleShare: () => void

  isDoctor: boolean
  isRecording: boolean
  /** The doctor asked the patient and is waiting for the answer. */
  recordingPending: boolean
  onToggleRecording: () => void

  chatOpen: boolean
  /** Absent where chat lives in the doctor's side panel instead. */
  onToggleChat?: () => void
  /** Doctor on tablet and desktop: shows or hides the Patient | Chat panel. */
  panel?: PanelControl

  /** Doctor only. */
  showMe?: ShowMeControl
  /** Phone doctor: opens the patient's details in a sheet. */
  onShowPatient?: () => void

  onLeave: () => void
}

export interface PanelControl {
  open: boolean
  /** Messages that arrived while chat was not on screen. */
  unread: number
  onToggle: () => void
}

function recordLabel({ isRecording, recordingPending }: Pick<ControlBarProps, 'isRecording' | 'recordingPending'>) {
  if (isRecording) return 'Stop recording'
  if (recordingPending) return 'Waiting for consent'
  return 'Start recording'
}

function showMeLabel(state: ShowMeControl['state']) {
  if (state === 'active') return 'End the close look'
  if (state === 'pending') return 'Waiting for them to show you'
  return 'Show me'
}

function shareLabel({
  sharingScreen,
  shareSupported,
  shareTakenBy,
}: Pick<ControlBarProps, 'sharingScreen' | 'shareSupported' | 'shareTakenBy'>) {
  if (sharingScreen) return 'Stop sharing your screen'
  if (!shareSupported) return 'Screen sharing needs a desktop browser'
  if (shareTakenBy) return `${shareTakenBy} is sharing a screen`
  return 'Share your screen'
}

export function ControlBar(props: ControlBarProps) {
  if (useDeviceClass() === 'phone') return <PhoneControlBar {...props} />
  return <DesktopControlBar {...props} />
}

function DesktopControlBar(props: ControlBarProps) {
  const {
    title,
    elapsed,
    micOn,
    camOn,
    onToggleMic,
    onToggleCam,
    sharingScreen,
    shareTakenBy,
    shareSupported,
    onToggleShare,
    isDoctor,
    isRecording,
    recordingPending,
    onToggleRecording,
    chatOpen,
    onToggleChat,
    showMe,
    onLeave,
  } = props

  return (
    <div className="relative flex h-16 shrink-0 items-center gap-2 border-t border-line px-3">
      {/* min-w-0 + truncate means the title loses the fight for space instead
          of drawing on top of the buttons. */}
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <span className="truncate text-base font-semibold text-ink">{title}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex">
          <CtrlBtn split label={micOn ? 'Mute yourself' : 'Unmute yourself'} off={!micOn} onClick={onToggleMic}>
            <RoomIcon name={micOn ? 'mic' : 'micOff'} size={18} />
          </CtrlBtn>
          <DeviceMenu kind="mic" />
        </div>
        <div className="flex">
          <CtrlBtn split label={camOn ? 'Turn camera off' : 'Turn camera on'} off={!camOn} onClick={onToggleCam}>
            <RoomIcon name={camOn ? 'cam' : 'camOff'} size={18} />
          </CtrlBtn>
          <DeviceMenu kind="cam" />
        </div>
        <CtrlBtn
          label={shareLabel(props)}
          text="Share"
          active={sharingScreen}
          disabled={!sharingScreen && (!shareSupported || shareTakenBy !== null)}
          onClick={onToggleShare}
        >
          <RoomIcon name="share" size={18} />
        </CtrlBtn>
        {/* Off while the patient is being asked, like Record; Cancel is on the
            stage pill. Pressed while the close look is on, and a second click
            ends it. */}
        {showMe && (
          <CtrlBtn
            label={showMeLabel(showMe.state)}
            text={showMe.state === 'active' ? 'Showing' : showMe.state === 'pending' ? 'Asking...' : 'Show me'}
            active={showMe.state === 'active'}
            disabled={showMe.disabled || showMe.state === 'pending'}
            onClick={showMe.onClick}
          >
            <RoomIcon name="scan" size={18} />
          </CtrlBtn>
        )}
        {/* Red while recording, matching the pill both sides see. The state
            comes from the SDK's own recording event, so the control is already
            lit during RECORDING_STARTING and cannot be double-fired. Off while
            the patient is being asked; Cancel is on the waiting banner. */}
        {(isDoctor || isRecording) && (
          <CtrlBtn
            label={recordLabel(props)}
            text={isRecording ? 'Stop' : recordingPending ? 'Asking...' : 'Record'}
            danger={isRecording}
            disabled={recordingPending && !isRecording}
            onClick={onToggleRecording}
          >
            <RoomIcon name="record" size={18} />
          </CtrlBtn>
        )}
        {onToggleChat && (
          <CtrlBtn label="Chat" active={chatOpen} onClick={onToggleChat}>
            <RoomIcon name="chat" size={18} />
          </CtrlBtn>
        )}
        {props.panel && <PanelBtn {...props.panel} />}

        <div className="mx-2 h-6 w-px bg-line" />

        <CtrlBtn
          label={isDoctor ? 'End visit for both of you' : 'Leave visit'}
          text={isDoctor ? 'End visit' : 'Leave'}
          danger
          onClick={onLeave}
        >
          <RoomIcon name="phoneOff" size={18} />
        </CtrlBtn>
      </div>

      {/* Counts from when this participant mounted: the SDK exposes no session
          start time to anchor on. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden whitespace-nowrap text-sm text-ink-tertiary">
        {/* Green, not red: being connected is good news, and red in this room
            means a recording or the way out. */}
        <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-success-dot" />
        <span className="hidden font-medium text-ink-secondary lg:inline">Live</span>
        {elapsed}
      </div>
    </div>
  )
}

/* The phone control bar: Mic, Camera, Chat, More, Leave or End.

   A different button set from desktop's, not a CSS-hidden subset of it.
   Screen share, Record, Show me and the device controls flatten into one
   BottomSheet - share is usually unavailable on a phone browser anyway, and
   the five buttons that stay are the ones a patient reaches for. */

function SheetRow({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 px-4 py-3 text-left hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-inset' : 'bg-transparent',
      )}
    >
      <RoomIcon name={icon} size={18} className="text-ink-secondary" />
      <span className="flex-1 text-base text-ink">{label}</span>
    </button>
  )
}

function PhoneControlBar(props: ControlBarProps) {
  const {
    micOn,
    camOn,
    onToggleMic,
    onToggleCam,
    sharingScreen,
    shareTakenBy,
    shareSupported,
    onToggleShare,
    isDoctor,
    isRecording,
    recordingPending,
    onToggleRecording,
    chatOpen,
    onToggleChat,
    showMe,
    onShowPatient,
    onLeave,
  } = props
  const actions = useRoomActions()
  const toast = useToast()
  const { facing } = useLocalDevices()
  const [moreOpen, setMoreOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)

  /* Read on open, so "Switch camera" only appears with a camera to switch to. */
  useEffect(() => {
    if (!moreOpen) return
    let live = true
    actions
      .listDevices()
      .then((l) => live && setCameraCount(l.cameras.length))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [moreOpen, actions])

  /* The other facing first. Where nothing reports a facing (Chromium's fake
     camera, many Android builds), the next camera in the list instead. */
  const switchCamera = async () => {
    try {
      const flipped = await actions.switchCamera({ facing: facing === 'environment' ? 'user' : 'environment' })
      if (flipped === 'switched') return
      const l = await actions.listDevices()
      const next = l.cameras[(l.cameras.findIndex((c) => c.id === l.cameraId) + 1) % l.cameras.length]
      if (next && next.id !== l.cameraId) await actions.switchCamera({ deviceId: next.id })
    } catch {
      toast('Could not switch cameras.', 'danger')
    }
  }

  /* Each sheet action closes the sheet first, so the result is visible. */
  const run = (fn: () => void) => () => {
    setMoreOpen(false)
    fn()
  }

  return (
    <div className="relative flex h-16 shrink-0 items-center justify-center gap-2 border-t border-line px-3">
      <CtrlBtn label={micOn ? 'Mute yourself' : 'Unmute yourself'} off={!micOn} onClick={onToggleMic}>
        <RoomIcon name={micOn ? 'mic' : 'micOff'} size={18} />
      </CtrlBtn>
      <CtrlBtn label={camOn ? 'Turn camera off' : 'Turn camera on'} off={!camOn} onClick={onToggleCam}>
        <RoomIcon name={camOn ? 'cam' : 'camOff'} size={18} />
      </CtrlBtn>
      {onToggleChat && (
        <CtrlBtn label="Chat" active={chatOpen} onClick={onToggleChat}>
          <RoomIcon name="chat" size={18} />
        </CtrlBtn>
      )}
      <CtrlBtn label="More controls" active={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
        <RoomIcon name="more" size={18} />
      </CtrlBtn>
      <CtrlBtn label={isDoctor ? 'End visit for both of you' : 'Leave visit'} danger onClick={onLeave}>
        <RoomIcon name="phoneOff" size={18} />
      </CtrlBtn>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More controls">
        <SheetRow
          icon="share"
          label={shareLabel(props)}
          active={sharingScreen}
          disabled={!sharingScreen && (!shareSupported || shareTakenBy !== null)}
          onClick={run(onToggleShare)}
        />
        {(isDoctor || isRecording) && (
          <SheetRow
            icon="record"
            label={recordLabel(props)}
            active={isRecording}
            disabled={recordingPending && !isRecording}
            onClick={run(onToggleRecording)}
          />
        )}
        {showMe && (
          <SheetRow
            icon="scan"
            label={showMeLabel(showMe.state)}
            active={showMe.state === 'active'}
            disabled={showMe.disabled || showMe.state === 'pending'}
            onClick={run(showMe.onClick)}
          />
        )}
        {cameraCount > 1 && <SheetRow icon="flip" label="Switch camera" onClick={run(() => void switchCamera())} />}
        <SheetRow icon="cam" label="Camera and microphone" onClick={run(() => setDevicesOpen(true))} />
        {onShowPatient && <SheetRow icon="clipboard" label="Patient details" onClick={run(onShowPatient)} />}
      </BottomSheet>

      <DevicesSheet open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </div>
  )
}

/* The doctor's side panel toggle. Hiding it gives the patient's video the
   whole width; a count on the button says a message came in meanwhile. */
function PanelBtn({ open, unread, onToggle }: PanelControl) {
  const label = open ? 'Hide side panel' : 'Show side panel'
  return (
    <span className="relative">
      <CtrlBtn label={unread > 0 ? `${label}, ${unread} unread` : label} active={open} onClick={onToggle}>
        <RoomIcon name="panel" size={18} />
      </CtrlBtn>
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent-mid px-1 text-xs font-semibold text-white"
        >
          {unread}
        </span>
      )}
    </span>
  )
}
