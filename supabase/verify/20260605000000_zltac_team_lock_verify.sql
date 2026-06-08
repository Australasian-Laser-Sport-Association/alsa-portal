-- =============================================================================
-- VERIFICATION for 20260605000000_zltac_team_lock.sql  (NOT a migration)
-- =============================================================================
-- Run the migration FIRST, then run this whole script in one go (SQL Editor).
-- It creates throwaway fixtures, then for each case simulates a captain /
-- player / committee / service-role JWT via request.jwt.claims + SET LOCAL ROLE
-- *only around the attempted op*, captures whether the op raised, RESETs the
-- role, and records PASS/FAIL/INCONCLUSIVE into a temp table. The script ends
-- with SELECT * FROM verify_results ORDER BY case_label; so the web SQL Editor
-- grid shows every case, then ROLLS BACK so nothing persists.
--
-- The temp table is created, written, and read ONLY by the runner role: every
-- INSERT happens after RESET ROLE, so the switched role never touches it (that
-- was the "relation verify_results does not exist" cause).
--
-- Blocked cases: a caught trigger exception = PASS; the op succeeding (rows>0)
-- = FAIL; 0 rows = INCONCLUSIVE (RLS shadowed the trigger — itself a finding).
-- Allowed cases: op succeeding (rows>0) = PASS; raising or 0 rows = FAIL.
--
-- Roster edits by the COMMITTEE go through the service role in this app (no
-- permissive committee write policy on zltac_registrations), so committee is
-- proven on the teams table and the service role is used to prove roster pass.
-- Competition rosters live in competition_registrations, which has no trigger
-- here, so they are inherently unaffected (asserted via the teams exemption).
-- =============================================================================

BEGIN;

-- Results sink shown in the grid at the end. Created, written, and read solely
-- by the runner role (never under a switched role), then discarded by ROLLBACK.
CREATE TEMP TABLE verify_results (case_label text, expected text, outcome text);

-- ───────────────────────────── Fixtures (as runner) ─────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cap@verify.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'comm@verify.invalid'),
  ('33333333-3333-3333-3333-333333333333', 'play@verify.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, first_name, roles) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Cap',  ARRAY['player']::text[]),
  ('22222222-2222-2222-2222-222222222222', 'Comm', ARRAY['zltac_committee']::text[]),
  ('33333333-3333-3333-3333-333333333333', 'Play', ARRAY['player']::text[])
ON CONFLICT (id) DO UPDATE SET roles = EXCLUDED.roles, first_name = EXCLUDED.first_name;

-- status is 'closed' (not 'open') to avoid the zltac_events_one_open partial
-- unique index colliding with the real prod open event. The lock logic keys
-- off teams.status, and the reg-lock RLS keys off reg_close_date (NULL = open
-- here), so no assertion depends on this event's status being 'open'.
INSERT INTO public.zltac_events (id, year, name, status, reg_close_date) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2099, 'Verify ZLTAC', 'closed', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.competitions (id, slug, name, start_date, end_date, created_by) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'verify-comp', 'Verify Comp',
   DATE '2099-01-01', DATE '2099-01-02', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;

-- Locked ZLTAC team (pending) + competition team (approved), both captained by Cap.
INSERT INTO public.teams (id, name, captain_id, status, event_id) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Locked ZLTAC', '11111111-1111-1111-1111-111111111111', 'pending', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id, name, captain_id, status, competition_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Comp Team', '11111111-1111-1111-1111-111111111111', 'approved', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
ON CONFLICT (id) DO NOTHING;

-- Captain registered onto the locked team; player unteamed.
INSERT INTO public.zltac_registrations (id, user_id, year, team_id) VALUES
  ('f1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 2099, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('f3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 2099, NULL)
ON CONFLICT (id) DO NOTHING;


-- Each DO block: set the actor JWT + SET LOCAL ROLE, attempt the op inside an
-- inner BEGIN/EXCEPTION that records the outcome into a variable, RESET ROLE,
-- then INSERT the result row as the runner. verify_results is only ever touched
-- after RESET ROLE.

-- ─────────────────────────────────── CAPTAIN ────────────────────────────────

-- (a) captain CANNOT set status
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.teams SET status = 'approved' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'FAIL' ELSE 'INCONCLUSIVE' END;
  EXCEPTION WHEN others THEN
    outcome := 'PASS';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(a) captain set status', 'blocked', outcome);
END $$;

-- (b1) captain CANNOT change name on a locked team
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.teams SET name = 'Hacked Name' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'FAIL' ELSE 'INCONCLUSIVE' END;
  EXCEPTION WHEN others THEN
    outcome := 'PASS';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(b1) captain rename locked team', 'blocked', outcome);
END $$;

-- (b2) captain CANNOT change the roster (clear own membership) on a locked team
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.zltac_registrations SET team_id = NULL
      WHERE user_id = '11111111-1111-1111-1111-111111111111' AND year = 2099;
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'FAIL' ELSE 'INCONCLUSIVE' END;
  EXCEPTION WHEN others THEN
    outcome := 'PASS';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(b2) captain clear own roster (locked)', 'blocked', outcome);
END $$;

-- (c) captain CAN change logo + colour on a locked team
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.teams SET logo_url = 'https://x/logo.png', colour = '#00FF41'
      WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END;
  EXCEPTION WHEN others THEN
    outcome := 'FAIL';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(c) captain edit logo/colour (locked)', 'allowed', outcome);
END $$;

-- ─────────────────────────────────── PLAYER ─────────────────────────────────

-- (b3) player CANNOT self-add onto a locked ZLTAC team
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.zltac_registrations SET team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      WHERE user_id = '33333333-3333-3333-3333-333333333333' AND year = 2099;
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'FAIL' ELSE 'INCONCLUSIVE' END;
  EXCEPTION WHEN others THEN
    outcome := 'PASS';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(b3) player self-add to locked team', 'blocked', outcome);
END $$;

-- ────────────────────────────────── COMMITTEE ───────────────────────────────

-- (d-teams) committee CAN rename AND change status on a locked team
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.teams SET name = 'Committee Renamed', status = 'approved'
      WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END;
  EXCEPTION WHEN others THEN
    outcome := 'FAIL';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(d-teams) committee rename+status (locked)', 'allowed', outcome);
END $$;

-- ───────────────────────────────── SERVICE ROLE ─────────────────────────────
-- Empty claims -> auth.uid() IS NULL; service_role also bypasses RLS.

-- (d-roster) service role CAN add a player onto a locked team
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    UPDATE public.zltac_registrations SET team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      WHERE user_id = '33333333-3333-3333-3333-333333333333' AND year = 2099;
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END;
  EXCEPTION WHEN others THEN
    outcome := 'FAIL';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(d-roster) service roster change (locked)', 'allowed', outcome);
END $$;

-- ──────────────────────── CAPTAIN — competition exemption ────────────────────

-- (e) competition team is unaffected: captain CAN rename AND change its status
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.teams SET name = 'Comp Renamed', status = 'draft'
      WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END;
  EXCEPTION WHEN others THEN
    outcome := 'FAIL';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(e) competition team rename+status', 'allowed', outcome);
END $$;


-- ───────────────────────────── Results (grid) ───────────────────────────────
-- Runner role (no switch active here).
SELECT * FROM verify_results ORDER BY case_label;

ROLLBACK;
-- =============================================================================
-- Expected: outcome = PASS for every row (a, b1, b2, b3, c, d-roster, d-teams,
-- e). Any FAIL is a real failure; INCONCLUSIVE on a blocked case means RLS
-- shadowed the trigger — itself a finding worth investigating.
-- =============================================================================
