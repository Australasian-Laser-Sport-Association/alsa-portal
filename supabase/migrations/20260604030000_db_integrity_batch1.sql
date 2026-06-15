-- =============================================================================
-- Database integrity hardening - batch 1
-- =============================================================================
-- All changes below were gated against live data first (zero violating rows
-- confirmed for every CHECK / UNIQUE before writing this file). Order is
-- deliberate and preserved.
--
-- NOTE on the distinctness CHECKs: the plain `<>` operator is used, NOT
-- `IS DISTINCT FROM`. The player slots are nullable, and `<>` yields NULL when
-- either side is NULL, which a CHECK constraint treats as PASS. So a partially
-- filled pairing (one slot still NULL) is correctly accepted; the constraint
-- fails only when two *filled* slots hold the same id. `IS DISTINCT FROM` would
-- treat NULL vs filled as "distinct = true" but would also reject nothing extra
-- here — the real reason for `<>` is to keep NULL slots passing rather than
-- forcing a comparison result. Do not "fix" these to IS DISTINCT FROM.
--
-- SCOPE of these distinctness CHECKs: SELF-PAIRING prevention ONLY — a single
-- player cannot occupy two slots within the SAME row. They do NOT enforce
-- one-appearance-per-player-per-event_year; that cross-row guard is intentionally
-- out of scope for Batch 1. Do not mistake these for per-year uniqueness.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Within-row distinctness on side-event pairings/teams.
--    SELF-PAIRING prevention ONLY (no player twice in the same row). This is NOT
--    a per-player-per-event_year uniqueness guard — that cross-row rule is out of
--    scope for Batch 1.
-- -----------------------------------------------------------------------------
ALTER TABLE public.doubles_pairs ADD CONSTRAINT doubles_pairs_distinct
  CHECK (player1_id <> player2_id);

ALTER TABLE public.triples_teams ADD CONSTRAINT triples_teams_distinct
  CHECK (player1_id <> player2_id AND player1_id <> player3_id AND player2_id <> player3_id);

-- Durable scope note in the catalog so this is never mistaken for per-year uniqueness.
COMMENT ON CONSTRAINT doubles_pairs_distinct ON public.doubles_pairs IS
  'Self-pairing prevention only: a player cannot occupy both slots of the SAME row. Does NOT enforce one-appearance-per-player-per-event_year (out of scope, Batch 1).';

COMMENT ON CONSTRAINT triples_teams_distinct ON public.triples_teams IS
  'Self-pairing prevention only: a player cannot occupy two/three slots of the SAME row. Does NOT enforce one-appearance-per-player-per-event_year (out of scope, Batch 1).';


-- -----------------------------------------------------------------------------
-- 2. Non-negative amount_owing (amount_paid intentionally NOT constrained —
--    an over-refund can legitimately drive paid negative)
-- -----------------------------------------------------------------------------
ALTER TABLE public.zltac_registrations ADD CONSTRAINT zltac_registrations_amount_owing_nonneg
  CHECK (amount_owing >= 0);

ALTER TABLE public.competition_registrations ADD CONSTRAINT competition_registrations_amount_owing_nonneg
  CHECK (amount_owing >= 0);


-- -----------------------------------------------------------------------------
-- 3. Drop redundant indexes (each duplicates a UNIQUE index on the same column)
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.zltac_registrations_payment_reference_idx;
DROP INDEX IF EXISTS public.competitions_slug_idx;
DROP INDEX IF EXISTS public.competition_registrations_competition_idx;


-- -----------------------------------------------------------------------------
-- 4. Missing FK-covering index on teams.event_id (event delete cascade + roster
--    joins currently sequential-scan teams). Partial, mirroring teams_competition_idx.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS teams_event_id_idx ON public.teams (event_id) WHERE event_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. One referee/rules test result per user
-- -----------------------------------------------------------------------------
ALTER TABLE public.referee_test_results ADD CONSTRAINT referee_test_results_user_id_key UNIQUE (user_id);


-- -----------------------------------------------------------------------------
-- 6. De-FK the audit actor so attribution outlives the actor's profile.
--    Matches recorded_by (a plain uuid snapshot) in the same table. The column
--    and its data are untouched — only the FK constraint is removed.
-- -----------------------------------------------------------------------------
ALTER TABLE public.payment_records_history DROP CONSTRAINT IF EXISTS payment_records_history_changed_by_fkey;


-- -----------------------------------------------------------------------------
-- 7. payment_reference collision scan must see ALL rows, not just the caller's.
--    The collision SELECT inside generate_payment_reference runs under the
--    caller's RLS today (SECURITY INVOKER), so a player self-insert sees only
--    their own rows, the suffix loop never fires, and a same-alias/same-year
--    clash surfaces as a raw 23505 on the payment_reference UNIQUE constraint.
--    Recreate the generator AND the BEFORE INSERT trigger function that calls it
--    with SECURITY DEFINER + SET search_path = public (mirroring is_committee /
--    claim_placeholder_profile). Function BODIES are copied verbatim from the
--    current definitions; ONLY the security context + search_path are added.
-- -----------------------------------------------------------------------------

-- 7a. generate_payment_reference(integer, text, uuid)
--     Current definition: 20260522000000_simplify_payment_reference.sql
CREATE OR REPLACE FUNCTION public.generate_payment_reference(
  p_year  integer,
  p_alias text,
  p_id    uuid
) RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_ref  text := p_year::text
    || substr(upper(regexp_replace(coalesce(p_alias, ''), '[^A-Za-z0-9]', '', 'g')), 1, 14);
  candidate text := base_ref;
  n         integer := 1;
BEGIN
  -- Append 2, 3, ... until the reference is unique. The current row is excluded
  -- (id <> p_id) so regenerating a row against itself is never a collision.
  WHILE EXISTS (
    SELECT 1 FROM public.zltac_registrations
    WHERE payment_reference = candidate
      AND id <> p_id
  ) LOOP
    n := n + 1;
    candidate := base_ref || n::text;
  END LOOP;

  RETURN candidate;
END;
$$;

-- 7b. set_zltac_registration_payment_reference() — BEFORE INSERT trigger fn on
--     zltac_registrations (trigger: zltac_registrations_set_payment_reference).
--     Current definition: 20260514000000_payment_tracking.sql
CREATE OR REPLACE FUNCTION public.set_zltac_registration_payment_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alias text;
BEGIN
  IF NEW.payment_reference IS NULL THEN
    SELECT alias INTO v_alias FROM public.profiles WHERE id = NEW.user_id;
    NEW.payment_reference := public.generate_payment_reference(NEW.year, v_alias, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


-- =============================================================================
-- ROLLBACK (commented out — run this block manually to revert this migration)
-- =============================================================================
-- -- 1. Distinctness CHECKs
-- ALTER TABLE public.doubles_pairs  DROP CONSTRAINT IF EXISTS doubles_pairs_distinct;
-- ALTER TABLE public.triples_teams  DROP CONSTRAINT IF EXISTS triples_teams_distinct;
--
-- -- 2. Non-negative owing CHECKs
-- ALTER TABLE public.zltac_registrations        DROP CONSTRAINT IF EXISTS zltac_registrations_amount_owing_nonneg;
-- ALTER TABLE public.competition_registrations  DROP CONSTRAINT IF EXISTS competition_registrations_amount_owing_nonneg;
--
-- -- 5. UNIQUE on referee_test_results
-- ALTER TABLE public.referee_test_results DROP CONSTRAINT IF EXISTS referee_test_results_user_id_key;
--
-- -- 3. Recreate the three dropped indexes (non-unique, same column)
-- CREATE INDEX zltac_registrations_payment_reference_idx
--   ON public.zltac_registrations (payment_reference);
-- CREATE INDEX competitions_slug_idx
--   ON public.competitions (slug);
-- CREATE INDEX competition_registrations_competition_idx
--   ON public.competition_registrations (competition_id);
--
-- -- 4. Drop the teams.event_id index
-- DROP INDEX IF EXISTS public.teams_event_id_idx;
--
-- -- 6. Re-add the changed_by FK
-- ALTER TABLE public.payment_records_history
--   ADD CONSTRAINT payment_records_history_changed_by_fkey
--   FOREIGN KEY (changed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--
-- -- 7a. Restore generate_payment_reference to SECURITY INVOKER (no search_path)
-- CREATE OR REPLACE FUNCTION public.generate_payment_reference(
--   p_year  integer,
--   p_alias text,
--   p_id    uuid
-- ) RETURNS text
-- LANGUAGE plpgsql
-- VOLATILE
-- AS $$
-- DECLARE
--   base_ref  text := p_year::text
--     || substr(upper(regexp_replace(coalesce(p_alias, ''), '[^A-Za-z0-9]', '', 'g')), 1, 14);
--   candidate text := base_ref;
--   n         integer := 1;
-- BEGIN
--   WHILE EXISTS (
--     SELECT 1 FROM public.zltac_registrations
--     WHERE payment_reference = candidate
--       AND id <> p_id
--   ) LOOP
--     n := n + 1;
--     candidate := base_ref || n::text;
--   END LOOP;
--   RETURN candidate;
-- END;
-- $$;
--
-- -- 7b. Restore set_zltac_registration_payment_reference to SECURITY INVOKER (no search_path)
-- CREATE OR REPLACE FUNCTION public.set_zltac_registration_payment_reference()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $$
-- DECLARE
--   v_alias text;
-- BEGIN
--   IF NEW.payment_reference IS NULL THEN
--     SELECT alias INTO v_alias FROM public.profiles WHERE id = NEW.user_id;
--     NEW.payment_reference := public.generate_payment_reference(NEW.year, v_alias, NEW.id);
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- =============================================================================
