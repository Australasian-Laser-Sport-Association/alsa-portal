-- Unify competition_registrations money columns to integer cents.
-- Matches payment_records.amount and zltac_registrations.amount_owing.
-- price_per_player stays numeric(8,2) dollars; the insert trigger scales to cents on copy.

BEGIN;

ALTER TABLE public.competition_registrations
  ALTER COLUMN amount_owing TYPE integer USING round(amount_owing * 100),
  ALTER COLUMN amount_paid  TYPE integer USING round(amount_paid  * 100);

CREATE OR REPLACE FUNCTION public.set_competition_amount_owing()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_price numeric(8,2);
BEGIN
  SELECT price_per_player INTO v_price
  FROM public.competitions
  WHERE id = NEW.competition_id;
  IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
    NEW.amount_owing   := (round(coalesce(v_price, 0) * 100))::integer;  -- cents
    NEW.amount_paid    := 0;
    NEW.payment_status := 'unpaid';
  ELSE
    IF NEW.amount_owing IS NULL OR NEW.amount_owing = 0 THEN
      NEW.amount_owing := (round(coalesce(v_price, 0) * 100))::integer;  -- cents
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- ALTER TABLE public.competition_registrations
--   ALTER COLUMN amount_owing TYPE numeric(8,2) USING (amount_owing::numeric / 100),
--   ALTER COLUMN amount_paid  TYPE numeric(8,2) USING (amount_paid::numeric  / 100);
-- CREATE OR REPLACE FUNCTION public.set_competition_amount_owing()
-- RETURNS trigger LANGUAGE plpgsql AS $function$
-- DECLARE v_price numeric(8,2);
-- BEGIN
--   SELECT price_per_player INTO v_price FROM public.competitions WHERE id = NEW.competition_id;
--   IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
--     NEW.amount_owing := coalesce(v_price, 0); NEW.amount_paid := 0; NEW.payment_status := 'unpaid';
--   ELSE
--     IF NEW.amount_owing IS NULL OR NEW.amount_owing = 0 THEN NEW.amount_owing := coalesce(v_price, 0); END IF;
--   END IF;
--   RETURN NEW;
-- END; $function$;
-- COMMIT;
