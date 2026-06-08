-- =============================================================================
-- ZLTAC team lock — status state machine + server-enforced lock (Batch 1)
-- Date: 2026-06-05
-- =============================================================================
-- Today teams.status is toothless: a captain can self-approve via a direct
-- anon-client UPDATE (teams_captain_update pins captain_id but has no
-- column-level restriction), and ZLTAC rosters stay editable regardless of
-- approval state. This migration makes the lock real and server-authoritative.
--
-- State machine (ZLTAC teams only):
--   editable = status IN ('draft', 'rejected')
--   locked   = status IN ('pending', 'approved')
--
-- This migration:
--   1. Adds 'draft' to the teams.status CHECK and makes it the new DEFAULT.
--      Existing rows are NOT backfilled — the default change only affects newly
--      created teams. (Captain-driven draft->pending "submit" is a Batch-2
--      SERVICE-ROLE API write, so it bypasses the status-change block below by
--      design: auth.uid() IS NULL for the service role.)
--   2. teams BEFORE UPDATE trigger — for ZLTAC teams only (event_id IS NOT NULL):
--        * blocks ANY status change by a captain (closes the self-approval
--          hole; status moves only via the Batch-2 submit API or the committee);
--        * when locked (pending/approved), freezes name / state / home_venue /
--          manager_id. logo_url and colour stay editable.
--   3. zltac_registrations BEFORE INSERT OR UPDATE trigger — blocks a captain or
--      player from setting, changing, or clearing team_id when the OLD or NEW
--      team is a locked ZLTAC team (adding, removing, or moving roster members).
--
-- Authorisation model (BOTH triggers): the service role (auth.uid() IS NULL)
-- and any committee member (public.is_committee()) ALWAYS pass. Enforcement
-- applies only to a non-committee authenticated caller — i.e. a captain or a
-- player writing through the anon client.
--
-- Competition teams (competition_id IS NOT NULL, event_id IS NULL) are exempt
-- from both triggers — they own their lifecycle in /api/superadmin and are
-- created 'approved'. The teams.event_id XOR competition_id CHECK
-- (chk_teams_event_xor_competition) guarantees event_id IS NOT NULL is an
-- exact, sufficient test for "this is a ZLTAC team".
-- =============================================================================


-- 1. Status state machine: add 'draft', make it the default. No backfill.
--    The inline CHECK from the initial schema is named teams_status_check.
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_status_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected'));
ALTER TABLE public.teams ALTER COLUMN status SET DEFAULT 'draft';


-- 2. teams BEFORE UPDATE — status + locked-field guard (ZLTAC only).
CREATE OR REPLACE FUNCTION public.enforce_zltac_team_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ZLTAC teams only. Competition teams (event_id IS NULL) are exempt.
  IF OLD.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Service role (auth.uid() IS NULL) and committee always pass.
  IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN

    -- Captains can never change status (closes the self-approval hole). The
    -- draft->pending submit is a Batch-2 service-role write (auth.uid() NULL),
    -- so it does not reach this branch.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION
        'ZLTAC team status can only be changed by the committee (team %).', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Once locked, identity fields are frozen; cosmetic logo/colour stay open.
    IF OLD.status IN ('pending', 'approved') THEN
      IF NEW.name       IS DISTINCT FROM OLD.name
      OR NEW.state      IS DISTINCT FROM OLD.state
      OR NEW.home_venue IS DISTINCT FROM OLD.home_venue
      OR NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
        RAISE EXCEPTION
          'ZLTAC team % is locked (%) — name, state, home venue and manager cannot be changed. Contact the committee.',
          OLD.id, OLD.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_zltac_team_lock ON public.teams;
CREATE TRIGGER trg_enforce_zltac_team_lock
  BEFORE UPDATE ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_zltac_team_lock();


-- 3. zltac_registrations BEFORE INSERT OR UPDATE — roster lock (ZLTAC only).
CREATE OR REPLACE FUNCTION public.enforce_zltac_roster_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_team uuid := NULL;
  v_new_team uuid := NEW.team_id;
  v_locked   boolean;
BEGIN
  -- Service role (auth.uid() IS NULL) and committee always pass.
  IF auth.uid() IS NULL OR public.is_committee() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_team := OLD.team_id;
  END IF;

  -- Only gate when team membership is set, changed, or cleared. An edit that
  -- leaves team_id untouched is governed by the existing reg-lock RLS, not here.
  IF v_new_team IS NOT DISTINCT FROM v_old_team THEN
    RETURN NEW;
  END IF;

  -- Block when either side of the move is a locked ZLTAC team. NULLs in the
  -- IN-list never match, so a clear (NEW NULL) checks the OLD team and a set
  -- (OLD NULL) checks the NEW team.
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id IN (v_old_team, v_new_team)
      AND t.event_id IS NOT NULL
      AND t.status IN ('pending', 'approved')
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION
      'Roster is locked for this ZLTAC team — contact the committee to change membership.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_zltac_roster_lock ON public.zltac_registrations;
CREATE TRIGGER trg_enforce_zltac_roster_lock
  BEFORE INSERT OR UPDATE ON public.zltac_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_zltac_roster_lock();


-- =============================================================================
-- ROLLBACK (run as the table owner / service role to undo this migration):
-- -----------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS trg_enforce_zltac_roster_lock ON public.zltac_registrations;
-- DROP FUNCTION IF EXISTS public.enforce_zltac_roster_lock();
-- DROP TRIGGER IF EXISTS trg_enforce_zltac_team_lock ON public.teams;
-- DROP FUNCTION IF EXISTS public.enforce_zltac_team_lock();
--
-- ALTER TABLE public.teams ALTER COLUMN status SET DEFAULT 'pending';
-- -- If any teams were created at 'draft' after this migration, re-map them
-- -- first or the restored CHECK will reject them:
-- --   UPDATE public.teams SET status = 'pending' WHERE status = 'draft';
-- ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_status_check;
-- ALTER TABLE public.teams
--   ADD CONSTRAINT teams_status_check
--   CHECK (status IN ('pending', 'approved', 'rejected'));
-- =============================================================================
