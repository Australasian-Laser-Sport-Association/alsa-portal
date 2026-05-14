-- =============================================================================
-- Payment tracking: payment_reference + amount_owing on zltac_registrations,
-- payment_records ledger, and backfill of existing rows.
-- =============================================================================
-- The legacy public.payments table is intentionally left in place. Readers
-- still depend on it; deprecation will happen in a later chunk once UI moves
-- to deriving payment state from payment_records vs amount_owing.


-- -----------------------------------------------------------------------------
-- 1. Columns on zltac_registrations
-- -----------------------------------------------------------------------------

ALTER TABLE public.zltac_registrations
  ADD COLUMN payment_reference text UNIQUE,
  ADD COLUMN amount_owing      integer NOT NULL DEFAULT 0;

CREATE INDEX zltac_registrations_payment_reference_idx
  ON public.zltac_registrations (payment_reference);


-- -----------------------------------------------------------------------------
-- 2. Reference generator
-- -----------------------------------------------------------------------------
-- Format: ZLT{YY}{ALIAS}{HASH}
--   ZLT     = literal prefix (3)
--   YY      = last 2 digits of event year (2)
--   ALIAS   = uppercased, alphanumeric-only, truncated to 8 chars (0–8)
--   HASH    = first 3 hex chars of the registration UUID (3)
-- Length range: 8–16 chars. Stable per registration (set once at insert).

CREATE OR REPLACE FUNCTION public.generate_payment_reference(
  p_year  integer,
  p_alias text,
  p_id    uuid
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  yy        text := lpad((p_year % 100)::text, 2, '0');
  alias_part text := substr(upper(regexp_replace(coalesce(p_alias, ''), '[^A-Za-z0-9]', '', 'g')), 1, 8);
  hash_part  text := upper(substr(regexp_replace(p_id::text, '[^A-Fa-f0-9]', '', 'g'), 1, 3));
BEGIN
  RETURN 'ZLT' || yy || alias_part || hash_part;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Trigger to populate payment_reference on insert
-- -----------------------------------------------------------------------------
-- Pulls alias from profiles at insert time. Stable thereafter — alias edits
-- do not rewrite the reference, so bank-statement matching keeps working.

CREATE OR REPLACE FUNCTION public.set_zltac_registration_payment_reference()
RETURNS trigger
LANGUAGE plpgsql
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

CREATE TRIGGER zltac_registrations_set_payment_reference
  BEFORE INSERT ON public.zltac_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_zltac_registration_payment_reference();


-- -----------------------------------------------------------------------------
-- 4. payment_records ledger
-- -----------------------------------------------------------------------------
-- One row per individual payment movement. Supports partials, refunds
-- (negative amount), and corrections. Amount is integer cents to match
-- the rest of the schema's money convention.

CREATE TABLE public.payment_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.zltac_registrations(id) ON DELETE CASCADE,
  amount          integer NOT NULL CHECK (amount <> 0),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  recorded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bank_reference  text,
  notes           text
);

CREATE INDEX payment_records_registration_idx ON public.payment_records (registration_id);
CREATE INDEX payment_records_bank_reference_idx ON public.payment_records (bank_reference);

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

-- Players: read only their own records, joined via registration_id → user_id.
CREATE POLICY "payment_records_own_read" ON public.payment_records
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.zltac_registrations r
    WHERE r.id = payment_records.registration_id
      AND r.user_id = auth.uid()
  ));

-- Committee: full access.
CREATE POLICY "payment_records_committee_all" ON public.payment_records
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- -----------------------------------------------------------------------------
-- 5. Backfill existing rows
-- -----------------------------------------------------------------------------

-- 5a. payment_reference for any pre-existing rows.
UPDATE public.zltac_registrations r
SET payment_reference = public.generate_payment_reference(r.year, p.alias, r.id)
FROM public.profiles p
WHERE r.user_id = p.id
  AND r.payment_reference IS NULL;

-- 5b. amount_owing computed from current event pricing + the registration's
--     own side_events / dinner_guests. Side-event prices are unpacked from
--     zltac_events.side_events JSONB. Best-effort: doubles/triples slugs are
--     included whenever present on the registration row, regardless of
--     partner-confirmation state. Going forward the application is the
--     source of truth and will recompute on save.
WITH side_prices AS (
  SELECT
    e.year,
    se.slug,
    coalesce(se.price, 0)::int AS price
  FROM public.zltac_events e
  CROSS JOIN LATERAL jsonb_to_recordset(coalesce(e.side_events, '[]'::jsonb))
    AS se(slug text, enabled boolean, price int)
  WHERE coalesce(se.enabled, false) = true
    AND se.slug <> 'presentation-dinner'
)
UPDATE public.zltac_registrations r
SET amount_owing =
  e.main_fee
  + coalesce((
      SELECT sum(sp.price)
      FROM unnest(coalesce(r.side_events, ARRAY[]::text[])) AS reg_slug(slug)
      JOIN side_prices sp ON sp.year = r.year AND sp.slug = reg_slug.slug
    ), 0)
  + r.dinner_guests * e.dinner_guest_price
FROM public.zltac_events e
WHERE e.year = r.year;
