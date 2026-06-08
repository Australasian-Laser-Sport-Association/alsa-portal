-- Convert competitions.price_per_player from numeric(8,2) dollars to integer
-- cents — the last pre-nats money unit unification. After this, every stored
-- money value (price_per_player, competition_registrations.amount_owing/
-- amount_paid, payment_records.amount) is integer cents, matching ZLTAC; dollars
-- live only at the input/display edge (CompetitionEditForm + dollars()).
--
-- The set_competition_amount_owing() BEFORE-INSERT trigger seeds amount_owing
-- from price_per_player. Since price_per_player is now ALREADY cents, the prior
-- `round(price * 100)` scaling is dropped — seed amount_owing directly. The rest
-- of the function body is copied verbatim from
-- 20260604050000_competition_amounts_to_cents.sql.

BEGIN;

ALTER TABLE public.competitions
  ALTER COLUMN price_per_player TYPE integer USING round(price_per_player * 100);

CREATE OR REPLACE FUNCTION public.set_competition_amount_owing()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_price integer;
BEGIN
  SELECT price_per_player INTO v_price
  FROM public.competitions
  WHERE id = NEW.competition_id;
  IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
    NEW.amount_owing   := coalesce(v_price, 0);  -- cents (price_per_player already cents)
    NEW.amount_paid    := 0;
    NEW.payment_status := 'unpaid';
  ELSE
    IF NEW.amount_owing IS NULL OR NEW.amount_owing = 0 THEN
      NEW.amount_owing := coalesce(v_price, 0);  -- cents (price_per_player already cents)
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- ALTER TABLE public.competitions
--   ALTER COLUMN price_per_player TYPE numeric(8,2) USING (price_per_player::numeric / 100);
-- CREATE OR REPLACE FUNCTION public.set_competition_amount_owing()
-- RETURNS trigger LANGUAGE plpgsql AS $function$
-- DECLARE v_price numeric(8,2);
-- BEGIN
--   SELECT price_per_player INTO v_price FROM public.competitions WHERE id = NEW.competition_id;
--   IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
--     NEW.amount_owing := (round(coalesce(v_price, 0) * 100))::integer; NEW.amount_paid := 0; NEW.payment_status := 'unpaid';
--   ELSE
--     IF NEW.amount_owing IS NULL OR NEW.amount_owing = 0 THEN NEW.amount_owing := (round(coalesce(v_price, 0) * 100))::integer; END IF;
--   END IF;
--   RETURN NEW;
-- END; $function$;
-- COMMIT;
