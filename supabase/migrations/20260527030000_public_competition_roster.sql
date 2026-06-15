-- ============================================================
-- Migration: public.public_competition_roster — masked anon-readable view
-- Date: 2026-05-27
-- Purpose:
--   Surface a minimal, column-masked view of pre-nationals registrations
--   and team rosters so the public CompetitionDetail page can render
--   "Registered Teams" for users who are NOT logged in.
--
--   Mirrors the existing ZLTAC pattern from
--   20260520010000_public_event_roster.sql: a definer-mode VIEW that runs
--   with its owner's privileges and bypasses the underlying tables' RLS.
--   Anon callers get SELECT on the VIEW only — the underlying
--   competition_registrations, team_members, and profiles tables stay
--   locked.
--
--   Exposes only:
--     competition_id, competition_slug,
--     team_id, team_name, team_colour,
--     user_id, alias, first_name, last_name,
--     role_in_team ('captain' | 'player' | NULL for unteamed),
--     invite_status (always 'accepted' for teamed rows, NULL for unteamed)
--   Hides:
--     payment_status, amount_paid, amount_owing, payment_reference,
--     invited_by, invited_at, responded_at, registered_at, email,
--     phone, dob, emergency contact, side events — everything else.
--
--   Row visibility filter:
--     - Only registrations for non-archived competitions whose registration
--       window has NOT closed (matches the anon RLS predicate from
--       20260527000000_competitions_anon_discovery.sql).
--     - LEFT JOIN to team_members on invite_status='accepted' so pending
--       and declined invites NEVER appear in the public roster.
--     - LEFT JOIN to teams so registered-but-unteamed players appear with
--       team_id = NULL.
--
--   security_invoker = false (the Postgres 15+ default) is set explicitly
--   for documentation. The view runs as its owner; underlying-table RLS
--   does not apply.
-- ============================================================

CREATE OR REPLACE VIEW public.public_competition_roster
WITH (security_invoker = false) AS
SELECT
  c.id          AS competition_id,
  c.slug        AS competition_slug,
  t.id          AS team_id,
  t.name        AS team_name,
  t.colour      AS team_colour,
  p.id          AS user_id,
  p.alias       AS alias,
  p.first_name  AS first_name,
  p.last_name   AS last_name,
  CASE
    WHEN tm.roles @> ARRAY['captain']::text[] THEN 'captain'
    WHEN tm.id IS NOT NULL                    THEN 'player'
    ELSE NULL
  END           AS role_in_team,
  tm.invite_status AS invite_status
FROM public.competition_registrations r
JOIN public.competitions c ON c.id = r.competition_id
JOIN public.profiles     p ON p.id = r.user_id
LEFT JOIN public.team_members tm
  ON tm.user_id       = r.user_id
 AND tm.team_id       = r.team_id
 AND tm.invite_status = 'accepted'
LEFT JOIN public.teams t
  ON t.id             = r.team_id
 AND t.competition_id = c.id
WHERE c.archived_at IS NULL
  AND (c.registration_close_at IS NULL OR c.registration_close_at > now());

GRANT SELECT ON public.public_competition_roster TO anon, authenticated;
