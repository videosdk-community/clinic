-- One row per visit: a VideoSDK room, the doctor who owns it, and the
-- patient it was booked for.
--
-- Rows are only ever created by api/visits.ts under the service role, because
-- creating the VideoSDK room needs the account secret and a row must never
-- claim a room_id nobody owns. So there is no insert or delete policy, and the
-- insert grant is revoked outright.
--
-- A patient is an anonymous Supabase user, and an anonymous user still has
-- the `authenticated` role. The owner-scoped policies below already shut them
-- out: a patient owns no visit, so every predicate is false for them. They
-- learn the names and time from api/session.ts instead.

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  room_id text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  doctor_name text not null check (char_length(btrim(doctor_name)) between 1 and 80),
  patient_name text not null check (char_length(btrim(patient_name)) between 1 and 80),
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Patient user ids the doctor let in. No foreign key: a patient's guest
  -- account expires after 30 days, and a stale id here admits nobody.
  admitted uuid[] not null default '{}',
  recording_consent_by uuid,
  recording_consent_at timestamptz
);

create index visits_owner_scheduled_idx on public.visits (owner_id, scheduled_at desc);

alter table public.visits enable row level security;

create policy visits_select_own on public.visits
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy visits_update_own on public.visits
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke insert on public.visits from anon, authenticated;
