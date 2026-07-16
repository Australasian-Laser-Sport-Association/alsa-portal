-- Provide explicit, column-masked database surfaces for anonymous discovery.
--
-- These views are the only browser-readable catalogue/roster surfaces after
-- 20260713043000_revoke_public_base_table_access.sql. They deliberately omit
-- payment instructions, profile identifiers, legal names, account ownership,
-- and administrative/audit fields.

BEGIN;

CREATE OR REPLACE VIEW public.public_zltac_events
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  e.id,
  e.name,
  e.year,
  e.location,
  e.venue,
  e.start_date,
  e.end_date,
  e.status,
  e.description,
  e.logo_url,
  e.side_events,
  e.reg_open_date,
  e.reg_close_date,
  e.event_starts_at,
  e.timezone,
  e.committee_email,
  e.hero_text,
  e.photo_urls,
  e.cover_photo_url
FROM public.zltac_events AS e
WHERE e.status IN ('open', 'closed', 'archived')
   OR public.is_committee();

REVOKE ALL ON public.public_zltac_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_zltac_events TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_zltac_events IS
  'Column-masked ZLTAC discovery. Draft rows are visible only to committee callers.';

CREATE OR REPLACE VIEW public.public_competitions
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  c.id,
  c.slug,
  c.name,
  c.start_date,
  c.end_date,
  c.registration_open_at,
  c.registration_close_at,
  c.price_per_player,
  c.payment_info_visible,
  c.description,
  c.links,
  c.banner_url
FROM public.competitions AS c
WHERE c.archived_at IS NULL
  AND (
    c.registration_close_at IS NULL
    OR c.registration_close_at > pg_catalog.now()
  );

REVOKE ALL ON public.public_competitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_competitions TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_competitions IS
  'Column-masked competition discovery without bank, owner, or administrative fields.';

CREATE OR REPLACE VIEW public.public_zltac_teams
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  t.id,
  t.event_id,
  t.name,
  t.status,
  t.logo_url,
  captain.alias AS captain_alias,
  captain.state AS captain_state
FROM public.teams AS t
JOIN public.zltac_events AS e
  ON e.id = t.event_id
LEFT JOIN public.profiles AS captain
  ON captain.id = t.captain_id
WHERE t.status = 'approved'
  AND e.status IN ('open', 'closed', 'archived');

REVOKE ALL ON public.public_zltac_teams FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_zltac_teams TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_zltac_teams IS
  'Approved public ZLTAC team display data with captain alias only.';

-- Keep the established view name and response columns, while closing two
-- leaks in its original definition: cancelled registrations and players on
-- unapproved teams must not surface in side-event or roster displays.
CREATE OR REPLACE VIEW public.public_event_roster
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.team_id,
  r.year,
  r.side_events,
  p.alias,
  p.state
FROM public.zltac_registrations AS r
JOIN public.profiles AS p
  ON p.id = r.user_id
JOIN public.zltac_events AS e
  ON e.year = r.year
LEFT JOIN public.teams AS t
  ON t.id = r.team_id
 AND t.event_id = e.id
 AND t.status = 'approved'
WHERE e.status IN ('open', 'closed', 'archived')
  AND r.status <> 'cancelled'
  AND (r.team_id IS NULL OR t.id IS NOT NULL);

REVOKE ALL ON public.public_event_roster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_event_roster TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_event_roster IS
  'Alias-only public ZLTAC roster; excludes cancelled registrations and unapproved teams.';

CREATE OR REPLACE VIEW public.public_competition_roster_safe
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  c.id AS competition_id,
  c.slug AS competition_slug,
  t.id AS team_id,
  t.name AS team_name,
  t.colour AS team_colour,
  p.alias,
  CASE
    WHEN tm.roles @> ARRAY['captain']::text[] THEN 'captain'
    WHEN tm.id IS NOT NULL THEN 'player'
    ELSE NULL
  END AS role_in_team
FROM public.competition_registrations AS r
JOIN public.competitions AS c
  ON c.id = r.competition_id
JOIN public.profiles AS p
  ON p.id = r.user_id
LEFT JOIN public.team_members AS tm
  ON tm.user_id = r.user_id
 AND tm.team_id = r.team_id
 AND tm.invite_status = 'accepted'
LEFT JOIN public.teams AS t
  ON t.id = r.team_id
 AND t.competition_id = c.id
 AND t.status = 'approved'
WHERE c.archived_at IS NULL
  AND (
    c.registration_close_at IS NULL
    OR c.registration_close_at > pg_catalog.now()
  )
  AND (r.team_id IS NULL OR t.id IS NOT NULL);

REVOKE ALL ON public.public_competition_roster_safe
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_competition_roster_safe
  TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_competition_roster_safe IS
  'Alias-only approved competition roster without profile identifiers or legal names.';

-- Preserve the old view's column contract during the migration-first rollout,
-- but irreversibly mask its profile UUID and legal-name fields. This keeps the
-- previously deployed public API operational until it is cut to the safe view
-- while eliminating the data exposure immediately.
CREATE OR REPLACE VIEW public.public_competition_roster
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.competition_id,
  r.competition_slug,
  r.team_id,
  r.team_name,
  r.team_colour,
  NULL::uuid AS user_id,
  r.alias,
  NULL::text AS first_name,
  NULL::text AS last_name,
  r.role_in_team,
  CASE WHEN r.team_id IS NULL THEN NULL::text ELSE 'accepted'::text END
    AS invite_status
FROM public.public_competition_roster_safe AS r;

GRANT SELECT ON public.public_competition_roster
  TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_competition_roster IS
  'Deprecated compatibility view. Identity and legal-name columns are always NULL.';

COMMIT;
