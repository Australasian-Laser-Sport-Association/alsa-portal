-- =============================================================================
-- VERIFICATION for the alias-uniqueness work  (NOT a migration)
--   - 20260608010000_handle_new_user_alias_dup.sql
--   - 20260608020000_alias_lower_unique.sql
-- =============================================================================
-- Apply BOTH migrations FIRST (function-fix, then index), then run this whole
-- script in one go (SQL Editor). It seeds throwaway fixtures, records PASS/FAIL
-- into a temp table, prints the grid, then ROLLS BACK so nothing persists.
--
-- Cases:
--   (a) a duplicate-alias UPDATE (different case) raises 23505 (unique_violation)
--   (b) the handle_new_user signup path, given a colliding alias, yields a
--       profile with alias = NULL but first/last name + dob INTACT (NOT a wiped
--       id+roles-only row)
--
-- Notes / coverage:
--   * Case (b) drives the REAL trigger by inserting into auth.users (the
--     on_auth_user_created trigger fires handle_new_user). The FK
--     profiles -> auth.users was dropped in 20260524000000_placeholder_profiles,
--     so the case-(a) seed rows do not need matching auth.users rows.
--   * Runs as the runner role (table owner). The unique index raises 23505 for
--     any role, so case (a) needs no role switch. handle_new_user is
--     SECURITY DEFINER, so case (b) needs no role switch either.
--   * Does NOT cover: the client-side 23505 -> friendly-message mapping (that is
--     UI code), nor concurrency/race timing.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE verify_results (case_label text, expected text, outcome text);

-- ───────────────────────────── Fixtures (as runner) ─────────────────────────
-- A and B are existing profiles. A owns alias 'Dupe'. (No auth.users rows
-- needed — the profiles->auth.users FK was dropped.)
INSERT INTO public.profiles (id, first_name, alias, roles) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Ay', 'Dupe', ARRAY['player']::text[]),
  ('b2222222-2222-2222-2222-222222222222', 'Bee', 'Bee', ARRAY['player']::text[])
ON CONFLICT (id) DO UPDATE SET alias = EXCLUDED.alias, first_name = EXCLUDED.first_name;

-- ───────────── (a) duplicate-alias UPDATE (different case) -> 23505 ──────────
DO $$
DECLARE n int; outcome text;
BEGIN
  BEGIN
    UPDATE public.profiles SET alias = 'dupe'   -- lower-case variant of 'Dupe'
      WHERE id = 'b2222222-2222-2222-2222-222222222222';
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := CASE WHEN n > 0 THEN 'FAIL' ELSE 'INCONCLUSIVE' END;
  EXCEPTION
    WHEN unique_violation THEN outcome := 'PASS';   -- SQLSTATE 23505
    WHEN others THEN outcome := 'FAIL (' || SQLSTATE || ')';
  END;
  INSERT INTO verify_results VALUES ('(a) duplicate alias UPDATE', 'raise 23505', outcome);
END $$;

-- ───────────── (b) signup with colliding alias -> alias NULL, metadata kept ──
-- Insert a new auth user whose metadata alias ('DUPE') collides with A's 'Dupe'.
-- handle_new_user should insert the profile with alias = NULL but keep the rest.
DO $$
DECLARE
  v_id    uuid := 'c3333333-3333-3333-3333-333333333333';
  r       public.profiles%ROWTYPE;
  outcome text;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      v_id,
      'dupe-signup@verify.invalid',
      '{"first_name":"Jo","last_name":"Bloggs","alias":"DUPE","dob":"2000-01-01"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT * INTO r FROM public.profiles WHERE id = v_id;

    IF r.id IS NULL THEN
      outcome := 'FAIL (no profile row)';
    ELSIF r.alias IS NOT NULL THEN
      outcome := 'FAIL (alias not NULL: ' || r.alias || ')';
    ELSIF r.first_name IS DISTINCT FROM 'Jo'
       OR r.last_name  IS DISTINCT FROM 'Bloggs'
       OR r.dob        IS DISTINCT FROM DATE '2000-01-01' THEN
      outcome := 'FAIL (metadata wiped: ' || coalesce(r.first_name,'<null>')
                 || '/' || coalesce(r.last_name,'<null>')
                 || '/' || coalesce(r.dob::text,'<null>') || ')';
    ELSE
      outcome := 'PASS';
    END IF;
  EXCEPTION WHEN others THEN
    -- A raised exception here would mean signup FAILED (auth user blocked).
    outcome := 'FAIL (signup raised ' || SQLSTATE || ')';
  END;
  INSERT INTO verify_results VALUES ('(b) signup colliding alias', 'alias NULL, name+dob kept', outcome);
END $$;

-- ───────────────────────────── Results (grid) ───────────────────────────────
SELECT * FROM verify_results ORDER BY case_label;

ROLLBACK;
-- =============================================================================
-- Expected: PASS for both (a) and (b). Any FAIL is a real failure.
-- (a) INCONCLUSIVE would mean the index did not fire (was it applied?).
-- =============================================================================
