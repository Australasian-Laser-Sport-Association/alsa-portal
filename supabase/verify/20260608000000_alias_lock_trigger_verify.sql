-- =============================================================================
-- VERIFICATION for 20260608000000_alias_lock_trigger.sql  (NOT a migration)
-- =============================================================================
-- Run the migration FIRST, then run this whole script in one go (SQL Editor).
-- It creates throwaway fixtures, then for each case simulates an authenticated
-- or service-role JWT via request.jwt.claims + SET LOCAL ROLE *only around the
-- attempted op*, captures whether the op raised, RESETs the role, and records
-- PASS/FAIL/INCONCLUSIVE into a temp table. The script ends with
-- SELECT * FROM verify_results so the web SQL Editor grid shows every case,
-- then ROLLS BACK so nothing persists.
--
-- The temp table is created, written, and read ONLY by the runner role: every
-- INSERT happens after RESET ROLE, so the switched role never touches it.
--
-- Blocked case: a caught trigger exception = PASS; the op succeeding (rows>0)
-- = FAIL; 0 rows = INCONCLUSIVE (RLS shadowed the trigger — itself a finding).
-- Allowed cases: op succeeding (rows>0) = PASS; raising or 0 rows = FAIL.
--
-- Cases (per the three required by the brief):
--   (a) registered   authenticated user changes own alias       -> expect RAISE
--   (b) unregistered authenticated user changes own alias        -> expect success
--   (c) service_role (no auth.uid) changes a registered user's alias -> expect success
-- =============================================================================

BEGIN;

-- Results sink shown in the grid at the end. Created, written, and read solely
-- by the runner role (never under a switched role), then discarded by ROLLBACK.
CREATE TEMP TABLE verify_results (case_label text, expected text, outcome text);

-- ───────────────────────────── Fixtures (as runner) ─────────────────────────
-- A = registered user (has a ZLTAC registration). B = unregistered user.
INSERT INTO auth.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'reg@verify.invalid'),
  ('b2222222-2222-2222-2222-222222222222', 'unreg@verify.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, first_name, alias, roles) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Reg',   'OldAliasA', ARRAY['player']::text[]),
  ('b2222222-2222-2222-2222-222222222222', 'Unreg', 'OldAliasB', ARRAY['player']::text[])
ON CONFLICT (id) DO UPDATE SET roles = EXCLUDED.roles, first_name = EXCLUDED.first_name, alias = EXCLUDED.alias;

-- status 'closed' (not 'open') to avoid the zltac_events_one_open partial unique
-- index colliding with the real prod open event. The lock keys off the presence
-- of a registration row, not the event status.
INSERT INTO public.zltac_events (id, year, name, status, reg_close_date) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2099, 'Verify ZLTAC', 'closed', NULL)
ON CONFLICT (id) DO NOTHING;

-- Only A is registered. A pending row counts per the locked design decision.
INSERT INTO public.zltac_registrations (id, user_id, year, status) VALUES
  ('f1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 2099, 'pending')
ON CONFLICT (id) DO NOTHING;


-- Each DO block: set the actor JWT + SET LOCAL ROLE, attempt the op inside an
-- inner BEGIN/EXCEPTION that records the outcome into a variable, RESET ROLE,
-- then INSERT the result row as the runner.

-- ───────────────────── (a) registered authenticated -> RAISE ────────────────
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.profiles SET alias = 'NewAliasA'
      WHERE id = 'a1111111-1111-1111-1111-111111111111';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'FAIL' ELSE 'INCONCLUSIVE' END;
  EXCEPTION WHEN others THEN
    outcome := 'PASS';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(a) registered user changes alias', 'blocked', outcome);
END $$;

-- ──────────────────── (b) unregistered authenticated -> success ─────────────
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.profiles SET alias = 'NewAliasB'
      WHERE id = 'b2222222-2222-2222-2222-222222222222';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END;
  EXCEPTION WHEN others THEN
    outcome := 'FAIL';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(b) unregistered user changes alias', 'allowed', outcome);
END $$;

-- ───────────── (c) service_role changes a registered user's alias -> success ─
-- Empty claims -> auth.uid() IS NULL; service_role also bypasses RLS.
DO $$
DECLARE n int; outcome text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    UPDATE public.profiles SET alias = 'AdminSetAliasA'
      WHERE id = 'a1111111-1111-1111-1111-111111111111';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END;
  EXCEPTION WHEN others THEN
    outcome := 'FAIL';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO verify_results VALUES ('(c) service_role changes registered alias', 'allowed', outcome);
END $$;


-- ───────────────────────────── Results (grid) ───────────────────────────────
-- Runner role (no switch active here).
SELECT * FROM verify_results ORDER BY case_label;

ROLLBACK;
-- =============================================================================
-- Expected: outcome = PASS for every row (a, b, c). Any FAIL is a real failure;
-- INCONCLUSIVE on case (a) means RLS shadowed the trigger — itself a finding
-- worth investigating.
-- =============================================================================
