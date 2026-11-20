# Decisions

Why Clinic is shaped the way it is. Anything here is settled. Reopen a decision with new evidence,
not with an argument.

_Seeded 2026-11-19, before any code existed._ Every entry below is a design decision. None of it
has been measured yet. When the code that implements an entry lands, rewrite the entry against what
was actually driven in a browser, in the same commit. Entries marked **Unverified** depend on SDK
behaviour that must be checked first.

## The feature set is whatever stays on under the HIPAA add-on

Clinic is meant to keep working after the builder turns on VideoSDK's HIPAA add-on and signs the
BAA. According to VideoSDK's HIPAA post, HIPAA mode turns these off:

- live transcription and closed captions
- post-call transcription
- AI summaries
- HLS/RTMP

These stay on:

- recording
- noise cancellation
- whiteboard
- polls
- SIP
- chat kept only for the session

Clinic therefore uses none of the features on the "off" list. Turning on E2EE also disables
recording, so Clinic does not turn on E2EE either.

**Unverified:** the feature list comes from a VideoSDK blog post, not from the reference docs.
Confirm it before the blog repeats it.

## The role comes from visit ownership, on the server

This is Classroom's model with a visit in place of a room. `api/session.ts` verifies the Supabase
session and reads `visits.owner_id`. If the caller owns the visit, they are the doctor and get
`['allow_join', 'allow_mod']`. Anyone else is a patient and gets `['ask_join']`. No role,
permission or participant id is read from the request body.

## A patient has no visible account, but is still a real Supabase user

The patient opens the link, types a name and knocks. There is no sign-up screen and no email.
Behind that, the join page calls `signInAnonymously()`, so the patient has a real `user.id` and a
JWT.

That means `participantId` can be the verified user id, as it is in Classroom. Every server check,
including the admitted-patient lookup below, keys on an identity the server verified, not on an id
the client chose. Classroom's "guests are real users" entry is the evidence that this changes no
part of the security model.

## The patient knocks, and the doctor is the gate

- The admit card shows the name the patient typed beside `visits.patient_name`, the name the doctor
  entered. Matching them is the doctor's identity check. The typed name is chosen by the client and
  proves nothing on its own.
- A denied patient's own client calls `leave()`. The SDK does not disconnect them.
- A second person can knock while the patient is in the room. The doctor gets that card too. Clinic
  does not auto-deny, because the doctor is the right judge (it may be a family member).

## An admitted patient who returns skips the knock

1. When the doctor clicks Admit, the doctor's client calls `POST /api/admit` with the `roomId` and
   `participantId`. The server checks that the caller owns the visit and writes the id to the visit's
   admitted list.
2. When the patient joins again, `api/session.ts` looks up their verified user id. If it is on the
   admitted list and the visit has not ended, the token gets `allow_join`. Otherwise it gets
   `ask_join`.
3. The token uses `version: 2`, scoped to that `roomId` and `participantId`.
4. Only the same browser skips the knock, because the anonymous session lives in its storage. A new
   device knocks again.
5. Admission ends when the visit ends.

Measured 2026-11-19 (react-sdk 1.3.0, two to four Chrome participants with fake devices): a patient
who reloads during the visit sees "Join the visit" instead of "Ask to join" and reaches `CONNECTED`
2.8s after the click, with no card on the doctor's side.

**Known gap, measured.** `onEntryRequested` fires on every `allow_join` holder, exactly as the lobby
docs say. With a stranger knocking:

| Participant | Token | Received the knock |
|---|---|---|
| Doctor | `allow_join`, `allow_mod` | yes |
| Patient who returned | `allow_join` | yes |
| Patient on their first entry | `ask_join` (admitted) | no |

So a returning patient's client gets the same knock and the same `allow`/`deny` closures as the
doctor. The patient UI ignores the event and the doctor's card stays the only admit button on screen,
but an admitted patient with devtools could admit a stranger. Classroom's "only `allow_mod` receives
it" was a teacher holding both permissions, not evidence about `allow_mod` alone. The gap is accepted:
it only opens for someone the doctor already let in, and only after they returned.

## The patient sends an intake before knocking

Step 1 of the patient's flow, before the device check: reason for visit (required, up to 200
characters), symptoms (optional, up to 1000), when it started (`today`, `days`, `week`, `longer`)
and pain from 0 to 10. It can be skipped. It is shown once per page load, never again on an
ask-again or a reconnect, and an admitted patient coming back never sees it.

- **Written by `POST /api/intake` from the patient's own session**, like consent, so the patient
  still needs no policy on `visits`. The columns live on the visit row (`intake_reason`,
  `intake_symptoms`, `intake_since`, `intake_pain`, `intake_by`, `intake_at`), and the database
  checks every limit, plus that an intake is a reason with optional detail or nothing at all.
- **Anyone with the link may write it before someone is admitted**, because the patient is not
  admitted when they fill it. `intake_by` records who did. Once the doctor admits anyone, only an
  admitted participant may change it, so a later stranger cannot overwrite the patient's words. The
  doctor never writes it (403).
- **The admit card shows an intake only when `intake_by` is the person knocking.** A stranger who
  wrote one before the patient arrived can only ever put it on their own card.
- **Editable from the waiting room.** The patient keeps their answers in client state, since they
  cannot read `visits`, and a save replaces the whole intake. The doctor's room re-reads the visit
  every 5s while a knock is pending, so an edit reaches the admit card without a refresh.
- **The doctor sees it three times:** on the admit card, in the room's Patient tab, and on the visit
  details page afterwards.

Measured 2026-11-19 with `scripts/drive.mjs`: the intake reaches the admit card, a lobby edit
reaches it within one 5s re-read, a stranger's intake is refused with 403 once the patient is
admitted, the stranger's card shows "No intake sent.", and the details page shows the edited intake.

**This is patient health information at rest in Supabase.** Every other piece of PHI in Clinic
(video, audio, chat, recordings) stays with VideoSDK. A HIPAA-ready deployment therefore needs
Supabase under its own BAA as well as VideoSDK's, and the blog must say so.

## Camera and microphone can be switched in the call

Both roles can change camera and microphone in the room: a chevron beside Mic and Cam on desktop,
"Camera and microphone" in the More sheet on a phone, and "Switch camera" to flip between front and
back.

- **Through streams, not device ids.** `switchCamera` and `switchMic` in the SDK seam build a fresh
  track with `createCameraVideoTrack` / `createMicrophoneAudioTrack` and hand it to `changeWebcam`
  / `changeMic`, the same way the precall hands its tracks to the meeting.
- **The old device is released first.** Phones cannot open the back camera while the front one is
  live, so a switch closes the current track (`disableWebcam` / `muteMic`), then opens the new one.
  If the new device fails, the previous one is reopened.
- **The choice survives off and on.** `toggleWebcam()` with no stream reopens whatever the SDK last
  saw, which misses a choice made while the camera was off. So the seam keeps the chosen ids and
  turning the camera or mic back on opens a fresh track from them. A switch while the device is off
  only records the choice: `changeWebcam` on an idle camera would turn it on.
- **Facing comes from the browser, not the SDK.** In react-sdk 1.3.x, `getWebcams()` reports
  `facingMode: "environment"` for every web camera, because it reads a field browsers do not set.
  The seam asks the track instead (`getCapabilities().facingMode` in Chromium, else the label: front,
  back, rear). A camera it cannot place is `null`. The self view is mirrored only for a front camera.
- **The menu's check follows the store**, not the listing it read on open: a switch still finishing
  when the menu is reopened lands a moment later, and the check moves with it.

Measured 2026-11-19 on Chromium with two fake cameras and microphones: the doctor switched camera
and mic mid-call, the patient kept receiving video, and the menu showed the new devices. Flipping to
a real back camera on iOS and Android has **not** been driven yet.

## Show me: the doctor asks for a closer look

Telehealth's most common physical-exam moment is "can you show me that?". The doctor clicks Show me,
and the patient can switch to their back camera with one tap. It reuses the consent pattern exactly:
an unpersisted `SHOWME` topic, the message kind as the text, a request id, sender checks.

1. The doctor publishes `request { id, to }`. The stage shows "Waiting for {patient} to show you"
   with Cancel (`cancel { id }`).
2. The patient sees "Dr. X wants a closer look". With a back camera the button is "Switch to back
   camera"; without one (desktops, Chromium's fake camera) it is "Show it on my camera" and nothing
   switches. Not now publishes `decline { id }` and the doctor gets "{patient} did not switch
   cameras". The prompt waits behind the recording consent prompt, so only one shows at a time.
3. Accept runs `switchCamera({ facing: 'environment' })` first, then publishes
   `accept { id, back }`. The back camera opens with `optimizationMode: 'detail'`, which favours
   sharpness over frame rate.
4. The doctor's stage goes into close look: the patient's video uncropped (`contain`), a "Close look
   · {name}'s back camera" pill with Done, and the Show me button pressed as "Showing". Done
   publishes `end { id }`, and the patient switches back to the front camera only if it had switched.
   A cancel after accept, or the doctor leaving, also switches the patient back.

Measured 2026-11-19 with `scripts/drive.mjs` on Chromium fake devices: decline reaches the doctor,
accept puts the doctor in close look, Done restores the stage. The back-camera path itself needs a
real phone and has **not** been driven yet.

Known gap: if only the doctor drops and reconnects during a close look, the patient switches back
while the doctor's client still shows close look until Done.

## The doctor's room has a Patient panel

On desktop the doctor's room is the video stage plus a 360px side panel with two tabs:

- **Patient:** name, "Name matched" when the admitted patient's typed name matches the booking, the
  intake, and "This visit" (recording state, their connection level, which camera they are on).
- **Chat:** the same chat panel as before, with an unread count on the tab while Patient is open.

Telehealth doctors work from the patient's context, and a call screen with only video and buttons
reads as a generic meeting app.

**The panel is optional.** It is open by default on desktop and closed on a tablet, where it floats
over the stage. A panel button in the control bar, and a close button in the panel itself, hide it
so the patient's video takes the whole width. While it is hidden, a message from the patient puts an
unread count on that button ("Show side panel, 1 unread"). On a phone chat stays a sheet and patient
details open from More. Driven 2026-11-19: hiding the panel widened the stage at 1280px and the
count appeared for a message sent meanwhile. The patient's own room is unchanged:
stage, self view and the old chat panel.

While nobody is in, the stage shows who is expected or knocking, the scheduled time and Copy visit
link, instead of grey text.

## Recording needs the patient's consent at the moment it starts

1. The doctor clicks Record. Clinic publishes `request` on the unpersisted `CONSENT` topic, with
   payload `{ id, to }`: a fresh request id and the patient's participantId. The doctor sees "Waiting
   for {patient} to allow recording" and can Cancel, which publishes `cancel { id }`.
2. The patient sees a modal, "Dr. X wants to record this visit. Allow / Decline". Escape is Decline.
3. Allow calls `POST /api/consent { roomId }` first. The patient writes consent from their own
   session, so the row's `recording_consent_by` and `recording_consent_at` come from the consenting
   party. Only after that succeeds does the patient publish `allow { id }`. A failed write publishes
   nothing and the dialog stays open.
4. Decline publishes `decline { id }`. The doctor gets "{patient} declined recording" and nothing
   is recorded.
5. The doctor's client is the only one that calls `startRecording`, and only on an `allow` whose id
   is its current request and whose sender is the participant the request went to. Old answers,
   other senders, and anything in the store before this participant joined are ignored.
6. While it runs, both sides see a red Recording pill with Stop on it, and either side can stop it
   directly. A patient who joins mid-recording sees the pill from the SDK's recording state.

**Consent is a contract between the two UIs, not something the SDK enforces.** The doctor's client
holds a meeting token and could call `startRecording` without asking. The doctor is the trusted
party in this app, and the consent row is the audit trail.

Measured 2026-11-19:

- **Either side can stop.** A patient admitted with `ask_join`, and one returning with `allow_join`,
  each called `stopRecording()` with no `allow_mod`. Neither call threw, no `onError` fired, and the
  doctor's client saw `RECORDING_STOPPING` then `RECORDING_STOPPED`. The patient's Stop is a direct
  call, not a request to the doctor. The same token could also start a recording, which is the
  patient consenting on their own behalf.
- **The composite is `GRID`, `LIGHT`.** Both layouts rendered at 1920x1080. `GRID` puts the patient
  and the doctor side by side on a light surround. `SPOTLIGHT` filled the frame with one person and
  dropped the doctor entirely, which is the wrong record of a consult. The call stays positional,
  `startRecording(null, null, { layout: { type: 'GRID', priority: 'SPEAKER', gridSize: 4 },
  theme: 'LIGHT', ... })`. The typings require `gridSize`.

## Recordings are stored by VideoSDK and listed by visit owner

The demo uses VideoSDK's default storage, so anyone can clone the repo and run it without setting up
a cloud bucket. The blog covers switching to your own bucket for production.

Recordings are listed per visit, on the visit's details page. `GET /api/recordings?roomId=` loads
that visit and answers 404 unless the caller owns it, so a room id from the request is only ever
used after the server has checked it belongs to the caller. `GET /v2/recordings` is account-wide,
which is why that check cannot be skipped. The patient has no route to recordings at all.

## A visit is one-time

Ending the visit sets `visits.ended_at`. `api/session.ts` refuses to mint a token for an ended visit,
and the link shows "Visit ended". Classroom's restart-on-same-link behaviour does not carry over,
because a medical visit is a single event.

## The scheduled time is display only

`visits.scheduled_at` is shown on the patient's join page and on the dashboard. Nothing is gated on
it: a patient can knock early or late. There is no calendar, booking or reminder.

## Light theme on VideoSDK tokens

Clinic keeps VideoSDK's single lavender accent and Inter, but uses the light, calm surface patients
expect from a medical app. It does not use the design system's dark default.

- **Light only.** `<html>` carries no `dark` class, so the vendored tokens resolve to their light
  `:root` set, and `color-scheme: light` makes native controls (the date picker, autofill) match.
  Components use the Tailwind utilities mapped in `src/index.css`, never a raw hex or a palette
  step; the `@theme` block is the one place a palette step (`--primary-100`, `--red-600`) appears.
  The header wordmark is the design system's black wordmark.
- **Surfaces.** Pages outside the room are `bg-subtle` with white cards (hairline border,
  `shadow-sm`). The room itself is white, with a `bg-subtle` stage while nobody is on it.
- **Video surfaces stay dark.** Camera and screen pixels are not themed, so the frame they sit in is
  a fixed near-black (`--color-video`, `--neutral-950`) in either theme. A letterbox bar on white
  reads as a broken layout; on near-black it reads as a video. A camera that is off is not video,
  so that tile is a light `bg-inset` surface with the person's initials.
- **Chips over video are dark glass, always.** The name chip, the network bars, the doctor's mute
  control and the screen-share label are all `bg-video/60 text-on-video`, whatever the camera shows
  and whatever the page theme. Their status colours use the steps that hold up on dark
  (`success-dot`, `warning-dot`, `danger-soft`), not the light `--*-fg` aliases. One rule, so a
  chip never has to know what is behind it. Status pills at the top of the stage (Recording,
  Reconnecting, waiting for consent) are opaque and keep their own tone, so they read on anything.
- **The doctor's mute sits beside the patient's name chip**, in the same glass, rather than alone
  in a corner: it is about that person. Its hit area is widened to 40px without growing the chip.
- **Red is for two things.** Solid red is End visit and a running recording. Being muted or having
  the camera off is a red *tint* (`danger-bg` / `danger-fg`), still answerable at a glance but not
  competing with the way out. The "Live" dot is green.
- **The admit card's identity check.** The card writes out "Typed: X" and "Expected: Y" on their
  own lines and never truncates either, since comparing them is the whole point. When they differ
  after trimming, collapsing spaces and ignoring case, the row shows a warning-tone box ("The names
  do not match. Check who this is before you admit them."); when they match, one quiet green line.
  The check informs; it never disables Admit, because a parent or carer may well knock.
- **Toasts dodge the room.** Off the room they sit low and centred. In the room they are centred
  on the stage (not the window, when chat is docked) above Stop sharing, and on a phone, where the
  self-view takes the bottom corner, just under the status pills. This is CSS keyed off
  `[data-room]`, so the toast primitive stays unaware of screens.
- **Phone tap targets are 40px.** Compact 32px buttons get `max-sm:h-10`; small chips over video
  extend their hit area with an `::after` instead of growing.

## The network indicator is the app's reading of raw stats

The SDK has no quality score (see "Per-participant network stats have no score" below), so each
tile's three bars are graded in `ParticipantBridge` from one participant's stats:

- **Source.** `getVideoStats()` while the camera is on, `getAudioStats()` while only the mic is on.
  Neither on is `unknown` and the bars are hidden.
- **Poll.** Every 4 seconds, as a `setTimeout` chain so one slow call never overlaps the next.
  No SDK event replaces it: `onQualityLimitation` covers only your own sender, and
  `onVideoQualityChanged` reports which simulcast layer is being consumed.
- **Counters are per interval.** `packetsLost` and `totalPackets` are the js-sdk's
  `delta_packets_lost_*` / `delta_packets_*`. Measured: `totalPackets` stayed at 80-90 per reading
  while `packetsReceived` / `packetsSent` (the running totals) climbed past 6000. Loss is
  `packetsLost / totalPackets` with no differencing. `packetsLost` was seen at -4 and is clamped to 0.
- **Thresholds.** Good is rtt < 150ms and loss < 2%. Poor is rtt > 400ms, loss > 8% or
  jitter > 100ms. Anything else is fair. Jitter never gates good: inbound video jitter measured
  15-50ms on a clean path.
- **A stall is poor.** An interval with zero packets on media that is on means the stream froze,
  and the remote entry reported exactly that under a lossy link.
- **Your own tile.** When your video entry says `limitation.reason: 'bandwidth'`, it shows at most
  fair, because the encoder has already dropped quality.
- **Smoothing.** The level changes only when two consecutive readings agree, so one spike does not
  flicker the bars. An unchanged level is a no-op write and re-renders nothing.

Your reading of someone else's stream measures the path from the SFU to you, not their own
uplink: their loss is mostly repaired by retransmission before it reaches you, and your bad Wi-Fi
would show as their bars. So each client also broadcasts its own tile's level on the unpersisted
`NETWORK` topic, whenever it changes and whenever someone joins, and a remote tile shows the worse
of their report and your reading. Driven 2026-11-19 by forcing the patient's report to poor: the
doctor's tile for the patient read "Connection: poor" while the doctor's own read good. Chrome
DevTools network throttling does not touch WebRTC media; a libwebrtc fake-network field trial
(500ms delay, 15% loss) moved real tiles to fair and poor.

## The pre-call check

Precall runs `runPreCallTest` behind `usePrecallTest` in `src/sdk/media/`, with the visit's session
token, so the patient's `ask_join` token is enough and nothing is joined or knocked. It starts on
its own once each device has either opened or failed, and runs again when the tracks change (a
camera switch, a mute) or when "Run again" is pressed.

- **Thresholds.** The network row grades the lower of the uplink and downlink scores (1 to 5):
  4-5 good, 3 fair, 1-2 poor. Poor adds one plain-language hint. The worst rtt and loss across both
  directions sit in a small secondary line.
- **It never blocks joining.** Ask to join stays live while the test runs, after a poor score and
  after a failure. A failure lands on its row (camera, microphone, or network) with "You can still
  join". Joining mid-test stops the test on unmount through the original promise's `.stop()`.
- **The test reuses the preview tracks.** They are passed as `videoTrack` / `audioTrack`, and the
  SDK never stops a track it was handed, so the same live streams still go to MeetingProvider.
  Measured with a `getUserMedia` counter: one camera open across precall and a full test, one live
  camera track after it, and the handed-off track still live after a knock made mid-test.
  `videoConfig.cameraId` would have opened a second camera on the same device, the overlap
  `usePrecall` already documents as a hang. A device that failed to open in precall is passed by id
  instead, so the SDK's own error fills that row, and any track the SDK opened that way is stopped
  here: on success, and on an abort during the network phase, it comes back in the result live.
- **A muted mic is never opened for the test.** A silent `AudioContext` track stands in, and the
  microphone row reads "Off". A camera switched off runs the test `audioOnly`.
- **Timing.** At the 10000ms sampling floor a run took 10.8-11.4s. Progress is timed from the first
  `onStatsChange`, because the media check before sampling does not report.

## A reconnect from an admitted patient is let back in

When a patient who joined on `ask_join` loses their network, the SDK reconnects them on that same
token, which means knocking again. Without help the patient waits on "Reconnecting..." until the
doctor notices a second card for the person already on their screen.

So the doctor's client checks every knock against the visit's `admitted` list (a select on its own
row, under RLS) before showing a card. A match is admitted straight away with `respondEntry`; only
knocks that are not on the list, or that the check could not answer, reach the card. The
participant id is the one inside a token our server signed, so a stranger cannot claim an admitted
patient's id.

Measured 2026-11-19: patient offline about 5s, back in with video both ways 5.3-5.9s after the
network returned, and no card on the doctor's side. The doctor must be in the room for this, which
they are whenever there is a visit to reconnect to.

## Production runs at clinic-by-videosdk.vercel.app

The Vercel project `clinic` serves production at `https://clinic-by-videosdk.vercel.app`. Supabase
auth's `site_url` points there, and both that origin and `http://localhost:3000` are in
`additional_redirect_urls`, because `SignIn.tsx` builds the magic-link `emailRedirectTo` from
`window.location.origin`. A new origin that should sign doctors in has to be added there and pushed
with `supabase config push`. `[storage.vector]` is off to match the project; the app stores no vectors.

## What the SDK measured before the features were built

Probed 2026-11-19 on react-sdk 1.3.0, Chrome with fake devices, local `vercel dev`. These are facts
the pre-call check, the network indicator and the reconnect state are built on.

**`runPreCallTest` works before joining, with the patient's `ask_join` token.** No meeting is joined
and no knock is sent. `samplingDuration` has a floor of 10000ms; at that floor the whole test took
11.0s and `onStatsChange` fired 18 times. The result:

- `camera`: `status`, `track`, `captureResolution` ("1280x720"), `fps`, `codec`
- `microphone`: `status`, `track`, `codec`
- `networkQuality.uplink` and `.downlink`: `quality` from 1 (bad) to 5 (excellent), `factors` (empty
  when nothing is wrong), plus `audio` and `video` blocks with `rtt`, `bitrate`, `packetLoss`,
  `jitter` and, for video, `fps` and `resolution`

**Per-participant network stats have no score.** `participant.getVideoStats()` and
`getAudioStats()` resolve to an array of one entry with `rtt`, `jitter`, `packetsLost`,
`totalPackets`, `bitrate` and `network` ("WIFI"), for a remote participant and for yourself. The
local entry adds `limitation.reason` (`none`, `cpu`, `bandwidth`). Any quality bars on a tile are
the app's own reading of those numbers.

**Reconnection is the SDK's, and it held for 40 seconds offline.** Taking a patient's browser
offline:

- For 8s: `RECONNECTING` at +5.0s, `CONNECTED` at +10.3s, 2.3s after the network came back.
- For 40s: `RECONNECTING` re-emitted roughly every 5s, `CONNECTED` 3.2s after the network came back.
  No `FAILED`, and the doctor never lost the patient's tile.

That probe held `allow_join`. A patient on their first entry holds `ask_join`, and for them the
SDK's reconnect goes back through the lobby: the full-flow drive saw the patient sit on
"Reconnecting..." indefinitely while the doctor got a fresh knock card for someone already in the
visit. See "A reconnect from an admitted patient is let back in" for the fix.

## Ported from Classroom

Each of these carries over unchanged. The full reasoning is in
https://github.com/videosdk-community/classroom (`docs/DECISIONS.md`, same headings). Rewrite each
one here once Clinic's code implements it.

**SDK and tokens**

- **The SDK lives behind a seam.** Only `src/sdk/` imports `@videosdk.live/react-sdk`, and oxlint
  enforces it. Each hook is subscribed once, in a bridge component.
- **What the SDK actually does, where the docs and typings disagree.** `onEntryResponded` arrives
  in two shapes, PubSub ids need care, and more. Check each item against the installed SDK version.
- **VideoSDK token payload details that are not cosmetic.**
  - `version: 2` is required for scoping.
  - No `roles` field.
  - `participantId` is the Supabase user id.
  - `POST /v2/rooms` returns `roomId`.
  - No `Bearer` prefix in the header.
  - No `autoCloseConfig`.
- **The recording's `startRecording` arguments are positional.** The leading nulls are load-bearing.

**Auth and data**

- **Session verification is `getUser`, not a local signature check.**
- **The display name is chosen by the client, and is not identity.**
- **The patient never reads `public.visits` directly.** This is Classroom's student rule:
  `api/session.ts` returns the fields the join page needs (patient name, doctor name, scheduled time)
  along with the token.

**Media and UI**

- **`StrictMode` is off, deliberately.** It double-joins the meeting.
- **Audio is one element per remote participant.** Clinic does not use the SDK's `AudioPlayer`, the
  local participant is skipped, and every `<video>` is muted.
- **The precall mic meter needs the mic stream as state, not just a ref.**
- **A doctor can mute but cannot force-unmute.** The action is labelled "Ask to unmute".
- **The room screen is responsive.** Phone below 768px, tablet 768-1023px, desktop from 1024px. A
  patient on a phone is the main case here, not an edge case.

**Development**

- **Local development: two servers, both on port 3000.**
- **Signing in during development, without the email.** Use `scripts/dev-session.mjs`.
