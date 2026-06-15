-- =============================================================================
-- Case-insensitive alias uniqueness — partial unique index on lower(alias)
-- Date: 2026-06-08
-- =============================================================================
-- Hard DB-level backstop for alias uniqueness. Complements (does not replace)
-- the application soft-checks in api/admin/users.js and the friendly 23505
-- handling in PlayerDashboard.jsx / PlayerRegister.jsx.
--
-- APPLY ORDER: run 20260608010000_handle_new_user_alias_dup.sql FIRST so a
-- colliding alias at signup degrades to alias = NULL instead of wiping the
-- profile. Only then apply this index.
--
-- Preflight check: run this first against prod and confirm it returns zero rows:
--   SELECT lower(alias), count(*), array_agg(id)
--   FROM public.profiles
--   WHERE alias IS NOT NULL
--   GROUP BY lower(alias)
--   HAVING count(*) > 1;
-- If it returns ANY rows, STOP: the index build will fail on the existing
-- duplicates and a dedup step is required first.
--
-- Design:
--   * PARTIAL (WHERE alias IS NOT NULL) so multiple NULL aliases remain allowed.
--   * lower(alias) to match claim_placeholder's case-insensitive comparison and
--     the committee soft-check. All write paths already trim, so no trim() here.
--   * Plain CREATE UNIQUE INDEX (not CONCURRENTLY): the table is tiny and
--     CONCURRENTLY cannot run inside a transaction.
-- =============================================================================

CREATE UNIQUE INDEX profiles_alias_lower_unique
  ON public.profiles (lower(alias))
  WHERE alias IS NOT NULL;


-- =============================================================================
-- ROLLBACK:
-- -----------------------------------------------------------------------------
-- DROP INDEX IF EXISTS public.profiles_alias_lower_unique;
-- =============================================================================
