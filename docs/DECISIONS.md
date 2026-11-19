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

**Known gap.** The VideoSDK lobby docs say any `allow_join` holder "can accept or reject others' join
requests". The patient UI ignores `onEntryRequested`, so the doctor's card stays the only admit
button on screen. Even so, an admitted patient with devtools could admit a stranger. This was
accepted because the gap only opens for someone the doctor already let in.

**Unverified:** Classroom measured `onEntryRequested` firing on clients that hold `allow_mod`, while
the docs say `allow_join`. If Classroom was right, a patient with `allow_join` and no `allow_mod`
never receives knocks and the gap may close. Measure it before writing the rejoin flow.

## Recording needs the patient's consent at the moment it starts

1. The doctor clicks Record. Clinic sends a PubSub request.
2. The patient sees "Dr. X wants to record this visit. Allow / Decline".
3. Allow starts the recording. Decline tells the doctor and nothing is recorded.
4. While it runs, both sides see a red Recording pill, and either side can stop it.
5. Consent is written to the visit row: who consented and when.

**Consent is a contract between the two UIs, not something the SDK enforces.** The doctor's client
holds a meeting token and could call `startRecording` without asking. The doctor is the trusted
party in this app, and the consent row is the audit trail.

**Unverified:**

- Whether a patient can call `stopRecording` without `allow_mod`.
- Which composite layout fits a 1:1 visit best. Classroom used SPOTLIGHT because a board was on
  screen, and GRID is the likely choice here. Keep the positional `startRecording` arguments either way.

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
