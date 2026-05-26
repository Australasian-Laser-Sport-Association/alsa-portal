-- =============================================================================
-- Pre-nationals Phase 3a — anon discovery for competitions
-- =============================================================================
-- Opens public.competitions to logged-out browsers so the marketing /
-- competition-listing pages (landing in Phase 3b) can render without an auth
-- session. The existing authenticated-side policies in
-- 20260526010000_pre_nationals_phase1.sql are unchanged; this migration adds
-- one new policy + the matching GRANT, mirroring the pattern used for
-- zltac_events (initial_schema.sql:565 + role_grants_baseline.sql:34).
--
-- Anon visibility model:
--   - Non-archived competitions where registration_close_at is NULL or still
--     in the future are publicly listable. This includes events not-yet-opened
--     for registration so players can plan ahead.
--   - Closed events drop out of public discovery once registration_close_at
--     passes. Archived events are never visible to anon.
--   - Bank details and other sensitive fields are NOT filtered at the row
--     level. Column-level filtering is handled by the public API endpoint
--     (Phase 3b). RLS here is defence-in-depth: a future direct PostgREST
--     query from an unauthenticated browser would still see only the rows
--     this policy admits, but every column on those rows.
--
-- competition_managers and competition_registrations are NOT changed by this
-- migration; both stay locked to authenticated users.
-- teams / team_members anon access is deferred to Phase 3d (invite flow).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Discovery SELECT policy (anon + authenticated)
-- -----------------------------------------------------------------------------
-- Postgres OR-combines permissive policies, so this one stacks on top of the
-- existing superadmin_read / manager_read policies for authenticated callers
-- — those keep working unchanged. The Phase 1a competitions_open_window_read
-- policy is now redundant: its predicate
--     archived_at IS NULL
--     AND (registration_open_at IS NULL OR registration_open_at <= now())
--     AND (registration_close_at IS NULL OR registration_close_at >= now())
-- is a strict subset of the new predicate (which drops the open_at gate, so
-- authenticated players can see events scheduled to open later and plan
-- ahead). It can be dropped in a future cleanup migration — left in place
-- here to keep this change minimal and isolated.

CREATE POLICY "competitions_discovery_read" ON public.competitions
  FOR SELECT TO anon, authenticated
  USING (
    archived_at IS NULL
    AND (registration_close_at IS NULL OR registration_close_at > now())
  );


-- -----------------------------------------------------------------------------
-- 2. Table-level GRANT to anon
-- -----------------------------------------------------------------------------
-- RLS policies don't grant base access on their own (default-deny model, see
-- ADR-0002 § Default deny). Pair the policy above with an explicit SELECT
-- grant so anon callers actually reach the policy check.
--
-- Column-level restrictions are deferred to the API layer for simpler
-- reasoning. If a future developer wants stricter column-level guards (hide
-- bank details from direct PostgREST queries even though the rows are
-- visible), switch this to a column-listed grant such as:
--   GRANT SELECT (id, slug, name, start_date, end_date,
--                 registration_open_at, registration_close_at,
--                 price_per_player, payment_info_visible) ON public.competitions TO anon;
-- and stop relying solely on the API to drop bank_* fields from the response.

GRANT SELECT ON public.competitions TO anon;
