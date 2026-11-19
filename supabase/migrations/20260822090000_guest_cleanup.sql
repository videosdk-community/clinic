-- Guest accounts expire. Nothing else in Supabase does this for us.
--
-- signInAnonymously() writes a real auth.users row, and a guest who closes
-- the tab never comes back to it - the session only ever lived in that
-- browser's localStorage. Left alone the table grows for as long as the demo
-- is up, which is the one real cost of guest sign-in.
--
-- In Clinic every guest is a patient, and a patient owns nothing: visits
-- belong to doctors, who sign in with a magic link and are never anonymous.
-- Deleting a guest only leaves its id behind in a visit's admitted list or
-- recording_consent_by, where it admits nobody and still records who
-- consented.
--
-- Thirty days is long enough that a patient can rejoin a visit they were
-- admitted to (meeting tokens live 600 seconds; nothing here outlives a
-- session by more than the link someone bookmarked) and short enough that
-- abuse does not accumulate.
--
-- Permanent accounts are never touched: `is_anonymous is true` is the whole
-- predicate, and it is a column on auth.users, not a claim we derive.

create extension if not exists pg_cron;

create or replace function public.delete_expired_guests()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users
  where is_anonymous is true
    and created_at < now() - interval '30 days';
$$;

comment on function public.delete_expired_guests is
  'Removes guest (patient) accounts older than 30 days.';

-- Not executable by a browser under any role. The function exists to give
-- cron one name to call, not to give the client a new capability.
--
-- PUBLIC is the grant that has to go. Postgres grants EXECUTE on a new
-- function to PUBLIC by default, and revoking from anon and authenticated
-- leaves that default in place - the function stays reachable at
-- /rest/v1/rpc/delete_expired_guests with nothing but the publishable key,
-- running as its definer. Revoke PUBLIC first; the named roles after it are
-- belt and braces against a later grant.
revoke execute on function public.delete_expired_guests() from public;
revoke execute on function public.delete_expired_guests() from anon, authenticated;

select cron.schedule(
  'delete-expired-guests',
  '17 3 * * *',
  $$select public.delete_expired_guests()$$
);
