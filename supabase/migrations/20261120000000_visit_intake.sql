-- The patient's pre-visit intake, on the visit row.
--
-- Written only by api/intake.ts under the service role, from the patient's own
-- verified session, so a patient still needs no policy on this table. The
-- doctor reads it through visits_select_own like every other column.
--
-- intake_by is the participant id of whoever sent it. The admit card shows the
-- intake only when it matches the person knocking, so a stranger with the link
-- can never put words on the real patient's card.
--
-- This is patient health information at rest. A HIPAA-ready deployment needs
-- Supabase under its own BAA, as well as VideoSDK's.

alter table public.visits
  add column intake_reason text check (char_length(btrim(intake_reason)) between 1 and 200),
  add column intake_symptoms text check (char_length(intake_symptoms) <= 1000),
  add column intake_since text check (intake_since in ('today', 'days', 'week', 'longer')),
  add column intake_pain smallint check (intake_pain between 0 and 10),
  add column intake_by uuid,
  add column intake_at timestamptz,
  -- An intake is a reason plus optional detail, or nothing at all.
  add constraint visits_intake_whole check (
    (intake_reason is null) = (intake_by is null)
    and (intake_reason is null) = (intake_at is null)
    and (intake_reason is not null or (intake_symptoms is null and intake_since is null and intake_pain is null))
  );
