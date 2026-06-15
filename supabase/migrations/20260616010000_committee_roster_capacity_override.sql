-- =============================================================================
-- Committee/service-role override of the ZLTAC per-team roster capacity cap
-- Date: 2026-06-16
-- =============================================================================
-- Builds on 20260615040000_atomic_zltac_capacity_and_captain_team.sql. The
-- committee can now edit any ZLTAC team's roster from the admin tools, which may
-- mean moving a player onto a team that is already at max_players_per_team. The
-- enforce_zltac_roster_capacity trigger previously raised for ALL callers; this
-- exempts the service role (auth.uid() IS NULL) and committee members from the
-- capacity RAISE only.
--
-- Preserved for everyone (captains/players via the anon client included):
--   * the "Team is not a ZLTAC team" integrity check
--   * the "Team belongs to a different event year" integrity check
-- These are correctness guards, not capacity, so they are NOT exempted.
--
-- There is no fee recompute inside this trigger to preserve: amount_owing is
-- recomputed by the caller (the captain RPCs via recalculate_zltac_amount_owing,
-- and the admin API via computeAndWriteAmountOwing). Those paths are unchanged,
-- so committee roster writes still recompute fees.
--
-- Only the function body changes. The two triggers created in 20260615040000
-- (..._roster_capacity_insert / ..._roster_capacity_update) are unchanged and
-- are not recreated here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_zltac_roster_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_year integer;
  v_max_players integer;
  v_roster_count integer;
BEGIN
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
     AND NEW.year IS NOT DISTINCT FROM OLD.year THEN
    RETURN NEW;
  END IF;

  SELECT e.year, e.max_players_per_team
    INTO v_event_year, v_max_players
    FROM public.teams t
    JOIN public.zltac_events e ON e.id = t.event_id
   WHERE t.id = NEW.team_id
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team is not a ZLTAC team' USING ERRCODE = '23503';
  END IF;
  IF v_event_year <> NEW.year THEN
    RAISE EXCEPTION 'Team belongs to a different event year' USING ERRCODE = '23514';
  END IF;

  -- Capacity cap only. Service role (auth.uid() IS NULL) and committee always
  -- pass so the admin tools can override a full team. The integrity checks
  -- above still apply to everyone.
  IF v_max_players IS NOT NULL AND v_max_players > 0
     AND auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
    SELECT count(*) INTO v_roster_count
      FROM public.zltac_registrations
     WHERE team_id = NEW.team_id
       AND year = NEW.year
       AND id <> NEW.id;
    IF v_roster_count >= v_max_players THEN
      RAISE EXCEPTION 'Team is full (%/%). Contact the committee.', v_max_players, v_max_players;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- ROLLBACK (restores the cap-for-everyone body from 20260615040000; the two
-- triggers are untouched so this is the only statement needed). Run as the
-- table owner / service role:
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.enforce_zltac_roster_capacity()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_event_year integer;
--   v_max_players integer;
--   v_roster_count integer;
-- BEGIN
--   IF NEW.team_id IS NULL THEN
--     RETURN NEW;
--   END IF;
--   IF TG_OP = 'UPDATE'
--      AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
--      AND NEW.year IS NOT DISTINCT FROM OLD.year THEN
--     RETURN NEW;
--   END IF;
--
--   SELECT e.year, e.max_players_per_team
--     INTO v_event_year, v_max_players
--     FROM public.teams t
--     JOIN public.zltac_events e ON e.id = t.event_id
--    WHERE t.id = NEW.team_id
--    FOR UPDATE OF t;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Team is not a ZLTAC team' USING ERRCODE = '23503';
--   END IF;
--   IF v_event_year <> NEW.year THEN
--     RAISE EXCEPTION 'Team belongs to a different event year' USING ERRCODE = '23514';
--   END IF;
--
--   IF v_max_players IS NOT NULL AND v_max_players > 0 THEN
--     SELECT count(*) INTO v_roster_count
--       FROM public.zltac_registrations
--      WHERE team_id = NEW.team_id
--        AND year = NEW.year
--        AND id <> NEW.id;
--     IF v_roster_count >= v_max_players THEN
--       RAISE EXCEPTION 'Team is full (%/%). Contact the committee.', v_max_players, v_max_players;
--     END IF;
--   END IF;
--
--   RETURN NEW;
-- END;
-- $$;
-- =============================================================================
