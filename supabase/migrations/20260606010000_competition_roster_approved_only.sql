-- ============================================================
-- Migration: public.public_competition_roster — approved-teams-only
-- Date: 2026-06-06
-- Purpose:
--   Recreate the public competition roster view so that only teams with
--   status = 'approved' surface publicly. Competition teams now start life
--   in 'pending' (see api/superadmin/[resource].js competition-team POST)
--   and must be approved by committee or the competition's manager before
--   they appear on the public CompetitionDetail "Registered Teams" list.
--
--   Changes from 20260527030000_public_competition_roster.sql (only two):
--     1. The teams LEFT JOIN gains "AND t.status = 'approved'".
--     2. The WHERE gains "AND (r.team_id IS NULL OR t.id IS NOT NULL)".
--   Every other clause (archived_at, registration window,
--   invite_status='accepted') is identical, and the exposed column set is
--   unchanged.
--
--   NOTE on behaviour: change (1) alone would drop only the TEAM identity for
--   a non-approved team (the registrant would resolve to team_id = NULL and
--   re-bucket as an unteamed player). Change (2) closes that: a registrant who
--   IS on a team (r.team_id NOT NULL) only survives when the approved-team join
--   matched (t.id NOT NULL), so a pending/draft/rejected team is hidden
--   ENTIRELY — both its name and its full roster. Genuinely unteamed
--   registrants (r.team_id IS NULL) still show under "Registered Players".
--
--   No data backfill: existing rows are re-evaluated by the new view at read
--   time; nothing is written.
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
 AND t.status         = 'approved'
WHERE c.archived_at IS NULL
  AND (c.registration_close_at IS NULL OR c.registration_close_at > now())
  AND (r.team_id IS NULL OR t.id IS NOT NULL);

GRANT SELECT ON public.public_competition_roster TO anon, authenticated;

-- ============================================================
-- ROLLBACK (run manually to restore the prior view — recreates
-- 20260527030000_public_competition_roster.sql verbatim, i.e. without the
-- "AND t.status = 'approved'" predicate and without the WHERE team_id guard):
-- ------------------------------------------------------------
-- CREATE OR REPLACE VIEW public.public_competition_roster
-- WITH (security_invoker = false) AS
-- SELECT
--   c.id          AS competition_id,
--   c.slug        AS competition_slug,
--   t.id          AS team_id,
--   t.name        AS team_name,
--   t.colour      AS team_colour,
--   p.id          AS user_id,
--   p.alias       AS alias,
--   p.first_name  AS first_name,
--   p.last_name   AS last_name,
--   CASE
--     WHEN tm.roles @> ARRAY['captain']::text[] THEN 'captain'
--     WHEN tm.id IS NOT NULL                    THEN 'player'
--     ELSE NULL
--   END           AS role_in_team,
--   tm.invite_status AS invite_status
-- FROM public.competition_registrations r
-- JOIN public.competitions c ON c.id = r.competition_id
-- JOIN public.profiles     p ON p.id = r.user_id
-- LEFT JOIN public.team_members tm
--   ON tm.user_id       = r.user_id
--  AND tm.team_id       = r.team_id
--  AND tm.invite_status = 'accepted'
-- LEFT JOIN public.teams t
--   ON t.id             = r.team_id
--  AND t.competition_id = c.id
-- WHERE c.archived_at IS NULL
--   AND (c.registration_close_at IS NULL OR c.registration_close_at > now());
--
-- GRANT SELECT ON public.public_competition_roster TO anon, authenticated;
-- ============================================================
