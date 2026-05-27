-- =============================================================================
-- Pre-nationals sub-phase — competition abbreviation prefix on payment refs
-- =============================================================================
-- Adds an `abbreviation` column to public.competitions and reshapes the auto-
-- generated payment reference from {YEAR}{ALIAS} to {ABBREV}{YEAR}{ALIAS}. The
-- abbreviation distinguishes refs across competitions sharing a year (e.g. two
-- pre-nats events in 2027 would otherwise collide on alias-only refs without
-- the collision-suffix loop having to work hard).
--
-- ZLTAC's reference format (zltac_registrations / generate_payment_reference)
-- is NOT touched. This change only affects competition_registrations.
--
-- Forward-only rule: payment references are forward-only after this migration.
-- Any pre-migration test rows that need format alignment must be handled by a
-- separate one-shot UPDATE outside the migration file. See the post-migration
-- notes referenced in the PR description for the specific UPDATE.
--
-- abbreviation is nullable on the column to keep forward-compatibility with
-- rows created before this migration. Going forward, the API layer enforces
-- presence on insert (auto-deriving when the admin omits it), so production
-- rows will always have one.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Column + format check
-- -----------------------------------------------------------------------------
-- 2-8 chars, uppercase letters + digits only. Tight enough to keep references
-- short and bank-statement-friendly; loose enough to fit event organisers'
-- existing internal shorthand (VPN, CPN, NSWPN24, etc.).

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS abbreviation text;

ALTER TABLE public.competitions
  DROP CONSTRAINT IF EXISTS competitions_abbreviation_format;
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_abbreviation_format
  CHECK (abbreviation IS NULL OR abbreviation ~ '^[A-Z0-9]{2,8}$');


-- -----------------------------------------------------------------------------
-- 2. Backfill known existing rows
-- -----------------------------------------------------------------------------
-- These two rows pre-date the abbreviation column; the API can't auto-derive
-- them without a write so we hard-code the chosen abbreviations here. New
-- competitions inserted after this migration will pick up an abbreviation via
-- the API layer.

UPDATE public.competitions SET abbreviation = 'TPN' WHERE slug = 'test-pre-nats-2027';
UPDATE public.competitions SET abbreviation = 'CPN' WHERE slug = 'canberra-pre-nats-1';


-- -----------------------------------------------------------------------------
-- 3. Reference generator — replace with abbreviation-aware version
-- -----------------------------------------------------------------------------
-- New format:
--   {ABBREV}{YYYY}{SANITIZED_ALIAS}        when abbreviation IS NOT NULL
--   {YYYY}{SANITIZED_ALIAS}                when abbreviation IS NULL
-- Empty alias fallback uses the same prefix rule with 'USER' + short id.
--
-- The collision-suffix loop (n=2,3,...) is unchanged. Alias sanitisation is
-- unchanged. ZLTAC's generator (generate_payment_reference) is unrelated and
-- not touched.
--
-- VOLATILE because it reads competition_registrations to detect collisions.

CREATE OR REPLACE FUNCTION public.generate_competition_payment_reference(
  p_competition_id uuid,
  p_alias          text,
  p_id             uuid
) RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_year     integer;
  v_abbrev   text;
  v_alias    text := coalesce(p_alias, '');
  alias_part text := substr(upper(regexp_replace(v_alias, '[^A-Za-z0-9]', '', 'g')), 1, 14);
  prefix     text;
  base_ref   text;
  candidate  text;
  n          integer := 1;
BEGIN
  SELECT EXTRACT(YEAR FROM start_date)::int, abbreviation
    INTO v_year, v_abbrev
  FROM public.competitions
  WHERE id = p_competition_id;

  IF v_year IS NULL THEN
    -- Competition row missing or unreadable — refuse rather than emit a
    -- meaningless reference. The caller's INSERT will fail loudly.
    RAISE EXCEPTION 'competition % not found while generating payment reference', p_competition_id;
  END IF;

  prefix := coalesce(v_abbrev, '');

  -- Empty alias after sanitisation -> {PREFIX}{YYYY}USER{short id}. Short id
  -- is the first 8 chars of the registration UUID, which is unique enough to
  -- avoid the collision loop in practice but the loop below still handles ties.
  IF alias_part = '' THEN
    base_ref := prefix || v_year::text || 'USER' || substr(replace(p_id::text, '-', ''), 1, 8);
  ELSE
    base_ref := prefix || v_year::text || alias_part;
  END IF;

  candidate := base_ref;
  WHILE EXISTS (
    SELECT 1 FROM public.competition_registrations
    WHERE payment_reference = candidate
      AND id <> p_id
  ) LOOP
    n := n + 1;
    candidate := base_ref || n::text;
  END LOOP;

  RETURN candidate;
END;
$$;
