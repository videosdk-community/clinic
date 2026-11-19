#!/usr/bin/env node
/* Drives a real two-party visit: a doctor and a patient, each in their own
 * browser context with Chromium's fake camera and microphone.
 *
 *     node scripts/drive.mjs [baseUrl]        default http://localhost:3000
 *
 * Needs `pnpm dev:api` running (or a deployed URL) and .env filled in. The
 * doctor is seeded with a redeemed session (see scripts/link.mjs for why the
 * magic link itself cannot be driven); the patient goes through the real
 * anonymous entry screen. Screenshots land in ./drive-out/.
 *
 * Not a test suite. It is the one script that proves the flows a reader of the
 * blog will try, and it fails loudly at the first step that does not happen. */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = 'drive-out'
const DOCTOR_EMAIL = 'drive-doctor@clinic.test'
const DOCTOR_NAME = 'Asha Rao'
const PATIENT_NAME = 'Jordan Lee'

const env = {}
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
mkdirSync(OUT, { recursive: true })

const t0 = Date.now()
const log = (msg) => console.log(`${String(Date.now() - t0).padStart(6)}ms  ${msg}`)

async function doctorSession() {
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const pub = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  })
  const { data: created } = await admin.auth.admin.createUser({
    email: DOCTOR_EMAIL,
    email_confirm: true,
    user_metadata: { display_name: DOCTOR_NAME },
  })
  if (!created?.user) {
    /* Already exists: make sure the name is what the admit card expects. */
    const { data } = await admin.auth.admin.listUsers()
    const u = data.users.find((x) => x.email === DOCTOR_EMAIL)
    await admin.auth.admin.updateUserById(u.id, { user_metadata: { display_name: DOCTOR_NAME } })
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: DOCTOR_EMAIL })
  if (error) throw error
  const { data: redeemed, error: e2 } = await pub.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  })
  if (e2) throw e2
  /* Each run creates a visit; clear the earlier ones so the dashboard shows this run's. */
  await admin.from('visits').delete().eq('owner_id', redeemed.user.id)
  return redeemed.session
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.HEADED ? false : true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--auto-accept-this-tab-capture',
  ],
})

async function party(name, session) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    viewport: { width: 1280, height: 800 },
  })
  if (session) {
    await ctx.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      [`sb-${ref}-auth-token`, JSON.stringify(session)],
    )
  }
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to fetch|WebSocket connection/.test(m.text())) console.log(`  [${name} console] ${m.text()}`)
  })
  page.on('pageerror', (e) => console.log(`  [${name} pageerror] ${e.message}`))
  return page
}

/* Chrome ignores an unknown switch silently and then drives the real webcam,
   so prove the device is fake before anything else counts. */
async function assertFakeDevices(page, who) {
  const labels = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    s.getTracks().forEach((t) => t.stop())
    return (await navigator.mediaDevices.enumerateDevices()).map((d) => d.label)
  })
  if (!labels.some((l) => /fake/i.test(l))) throw new Error(`${who}: devices are not fake: ${labels}`)
  log(`${who}: fake devices confirmed`)
}

/* A remote video is "real" when some <video> other than the self view has
   decoded frames. */
async function waitRemoteVideo(page, who) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2).length >= 2,
    null,
    { timeout: 30_000 },
  )
  log(`${who}: two playing videos on screen`)
}

const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` })

try {
  const session = await doctorSession()
  log('doctor session seeded')
  const doctor = await party('doctor', session)
  const patient = await party('patient')

  await doctor.goto('/')
  await assertFakeDevices(doctor, 'doctor')
  await doctor.getByPlaceholder('Jordan Lee').fill(PATIENT_NAME)
  const when = new Date(Date.now() + 15 * 60_000)
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  await doctor.locator('input[type="datetime-local"]').fill(local)
  const created = doctor.waitForResponse((r) => r.url().endsWith('/api/visits') && r.request().method() === 'POST')
  await doctor.getByRole('button', { name: 'Create visit' }).click()
  const res = await created
  if (res.status() !== 201) throw new Error(`create visit: ${res.status()} ${await res.text()}`)
  const { visit } = await res.json()
  log(`visit created ${visit.roomId}`)
  await shot(doctor, '01-dashboard')

  await patient.goto(`/v/${visit.roomId}`)
  await assertFakeDevices(patient, 'patient')
  await patient.getByLabel('Your name').fill(PATIENT_NAME)
  await patient.getByRole('button', { name: 'Continue' }).click()
  await patient.getByText(DOCTOR_NAME).first().waitFor({ timeout: 15_000 })
  log('patient precall greets with doctor name')
  await shot(patient, '02-patient-precall')

  await doctor.goto(`/v/${visit.roomId}`)
  await doctor.getByRole('button', { name: /join the visit/i }).click({ timeout: 20_000 })
  log('doctor joining')

  await patient.getByRole('button', { name: /ask to join/i }).click({ timeout: 20_000 })
  log('patient knocked')

  await doctor.getByText(`Expected: ${PATIENT_NAME}`).waitFor({ timeout: 20_000 })
  log('doctor sees knock card with expected name')
  await shot(doctor, '03-doctor-knock')
  await doctor.getByRole('button', { name: 'Admit' }).click()
  log('doctor admitted')

  await waitRemoteVideo(doctor, 'doctor')
  await waitRemoteVideo(patient, 'patient')
  await shot(doctor, '04-doctor-room')
  await shot(patient, '05-patient-room')

  /* Chat both ways. */
  const openChat = async (page) => {
    const box = page.getByPlaceholder('Send a message')
    if (!(await box.isVisible())) await page.getByRole('button', { name: 'Chat' }).first().click()
    return box
  }
  await openChat(patient)
  const say = async (page, who, text) => {
    const box = await openChat(page)
    await box.fill(text)
    await box.press('Enter')
    log(`${who} sent "${text}"`)
  }
  await say(doctor, 'doctor', 'Hello Jordan, can you hear me?')
  await patient.getByText('Hello Jordan, can you hear me?').waitFor({ timeout: 10_000 })
  log('patient received chat')
  await say(patient, 'patient', 'Yes, loud and clear.')
  await doctor.getByText('Yes, loud and clear.').waitFor({ timeout: 10_000 })
  log('doctor received chat')
  await shot(doctor, '06-doctor-chat')
  await shot(patient, '07-patient-chat')

  /* Screen share from the patient (showing a lab result is the brief's case). */
  await patient.getByRole('button', { name: 'Share your screen' }).click()
  await doctor.getByText(`${PATIENT_NAME} is sharing a screen`).waitFor({ timeout: 15_000 })
  log('doctor sees the patient sharing')
  await shot(doctor, '08-doctor-share')
  await patient.getByRole('button', { name: 'Stop sharing your screen' }).click()
  await doctor.getByText(`${PATIENT_NAME} is sharing a screen`).waitFor({ state: 'hidden', timeout: 15_000 })
  log('share stopped')

  /* Recording, with consent. Decline first, then allow, then the patient stops it. */
  const askToRecord = async () => {
    await doctor.getByRole('button', { name: 'Start recording' }).click()
    return patient.getByRole('dialog').filter({ hasText: `Dr. ${DOCTOR_NAME} wants to record this visit.` })
  }
  let dialog = await askToRecord()
  await dialog.waitFor({ timeout: 10_000 })
  await shot(patient, '09-patient-consent')
  await dialog.getByRole('button', { name: 'Decline' }).click()
  await doctor.getByText(`${PATIENT_NAME} declined recording`).waitFor({ timeout: 10_000 })
  log('decline reached the doctor, nothing recorded')
  dialog = await askToRecord()
  await dialog.getByRole('button', { name: 'Allow' }).click()
  const pill = (page) => page.getByRole('button', { name: 'Stop recording' }).first()
  await pill(doctor).waitFor({ timeout: 45_000 })
  await pill(patient).waitFor({ timeout: 15_000 })
  log('recording running, pill on both sides')
  await shot(doctor, '10-doctor-recording')
  await shot(patient, '11-patient-recording')
  await patient.waitForTimeout(10_000)
  await pill(patient).click()
  await pill(doctor).waitFor({ state: 'hidden', timeout: 20_000 })
  log('patient stopped the recording')

  /* Reconnect: the patient's network drops for 8s. */
  await patient.context().setOffline(true)
  await patient.getByText('Reconnecting...').first().waitFor({ timeout: 15_000 })
  log('patient sees Reconnecting...')
  await shot(patient, '12-patient-reconnecting')
  await patient.waitForTimeout(Number(process.env.OFFLINE_EXTRA ?? 0))
  await patient.context().setOffline(false)
  log('patient back online')
  /* A patient who joined on ask_join reconnects through the lobby; the
     doctor's client must let them back in without a card. */
  await patient.getByText('Reconnecting...').first().waitFor({ state: 'hidden', timeout: 30_000 })
  log('patient reconnected')
  if (await doctor.getByText(/^Expected:/).isVisible()) throw new Error('reconnect left a knock card')
  await waitRemoteVideo(patient, 'patient after reconnect')
  await waitRemoteVideo(doctor, 'doctor after reconnect')

  /* A stranger knocks while the patient is in; the doctor denies. */
  const stranger = await party('stranger')
  await stranger.goto(`/v/${visit.roomId}`)
  await stranger.getByLabel('Your name').fill('Stranger')
  await stranger.getByRole('button', { name: 'Continue' }).click()
  await stranger.getByRole('button', { name: /ask to join/i }).click({ timeout: 20_000 })
  await doctor.getByText('Stranger').first().waitFor({ timeout: 20_000 })
  await doctor.getByRole('button', { name: 'Deny' }).click()
  await stranger.getByText('The doctor did not let you in').waitFor({ timeout: 15_000 })
  log('second knock denied, stranger told')
  await stranger.context().close()

  /* The admitted patient reloads and comes straight back in. */
  await patient.reload()
  await patient.getByRole('button', { name: /join the visit/i }).click({ timeout: 30_000 })
  await waitRemoteVideo(patient, 'patient after rejoin')
  if (await doctor.getByText(/^Expected:/).isVisible()) throw new Error('rejoin raised a knock card')
  log('rejoin skipped the knock')

  /* The doctor ends the visit; the link is dead afterwards. */
  await doctor.getByRole('button', { name: 'End visit for both of you' }).click()
  await patient.getByText('Visit ended').first().waitFor({ timeout: 15_000 })
  log('patient sees Visit ended')
  await shot(patient, '13-patient-ended')
  await patient.reload()
  await patient.getByText('Visit ended').first().waitFor({ timeout: 15_000 })
  log('the link shows Visit ended after reload')

  await doctor.goto(`/visits/${visit.roomId}`)
  await doctor.getByText(/Given by the patient/).waitFor({ timeout: 15_000 })
  log('details page shows the consent')
  if (process.env.WAIT_RECORDING) {
    for (let i = 0; i < 30; i++) {
      await doctor.reload()
      if (await doctor.locator('video, [data-recording-row]').count()) break
      if (await doctor.getByText(/\d+:\d\d/).count()) break
      await doctor.waitForTimeout(10_000)
    }
    await shot(doctor, '14-doctor-details')
    log('recording listed on the details page')
  }

  log('ALL FLOWS PASSED')
} catch (err) {
  console.error(`FAILED: ${err.message}`)
  process.exitCode = 1
} finally {
  if (!process.env.KEEP) await browser.close()
}
