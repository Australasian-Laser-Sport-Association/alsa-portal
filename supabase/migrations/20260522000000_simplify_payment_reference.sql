-- =============================================================================
-- Simplify payment_reference format: {YYYY}{ALIAS}
-- =============================================================================
-- Replaces the old ZLT{YY}{ALIAS}{HASH} format with a plainer
-- {YYYY}{SANITIZED_ALIAS} form (e.g. 2027CROUCHY) that is easier for players
-- to type into a bank transfer and easier for the treasurer to recognise on a
-- bank statement.
--
-- The function keeps its original three-argument signature so the existing
-- BEFORE INSERT trigger (and its NULL guard) needs no changes. p_id is no
-- longer used for a hash suffix; it now excludes the row from its own collision
-- check, which makes the function both collision-safe and idempotent.
--
-- payment_records.bank_reference rows are NOT touched. They are historical text
-- recording what the bank statement showed at the time of payment, regardless
-- of the current reference format.


-- -----------------------------------------------------------------------------
-- 1. New reference generator
-- -----------------------------------------------------------------------------
-- Format: {YYYY}{ALIAS}
--   YYYY    = four-digit event year
--   ALIAS   = uppercased, alphanumeric-only, truncated to 14 chars (0-14)
-- Total length stays under 18 chars (the Australian bank reference field limit
-- on most banks). On a collision an incrementing numeric suffix (2, 3, ...) is
-- appended, which in the worst case can nudge a maximum-length alias one char
-- over 18; that requires a 14+ char alias plus a same-year same-alias clash and
-- is accepted as-is.
--
-- VOLATILE (not IMMUTABLE) because it now reads zltac_registrations to detect
-- collisions.

CREATE OR REPLACE FUNCTION public.generate_payment_reference(
  p_year  integer,
  p_alias text,
  p_id    uuid
) RETURNS text
LANGUAGE plpgsql
VOLATILE
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


-- -----------------------------------------------------------------------------
-- 2. Regenerate all existing references in the new format
-- -----------------------------------------------------------------------------
-- Row by row, ordered deterministically, so each new reference is committed and
-- visible to the next row's collision check. A single set-based UPDATE cannot
-- detect collisions among the references it is assigning in the same statement.
-- Old ZLT-prefixed references can never equal a new digit-prefixed one, so the
-- transition introduces no false collisions.

DO $$
DECLARE
  r       record;
  v_alias text;
BEGIN
  FOR r IN
    SELECT id, year, user_id
    FROM public.zltac_registrations
    ORDER BY created_at, id
  LOOP
    SELECT alias INTO v_alias FROM public.profiles WHERE id = r.user_id;
    UPDATE public.zltac_registrations
    SET payment_reference = public.generate_payment_reference(r.year, v_alias, r.id)
    WHERE id = r.id;
  END LOOP;
END;
$$;
