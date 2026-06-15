-- Make the payment columns on public.competition_registrations
-- server-authoritative, mirroring the ZLTAC protect_registration_admin_fields
-- pattern.
--
-- BACKGROUND
-- ----------
-- A direct `authenticated` insert/update could previously seed or mutate
-- amount_owing / amount_paid / payment_status to attacker-chosen values:
--   * INSERT: the self_insert RLS policy only pins user_id; the BEFORE INSERT
--     trigger only overrode amount_owing when it was NULL/0, so a non-null,
--     non-zero amount_owing (and any amount_paid / payment_status) survived.
--   * UPDATE: the self_update_nonpayment policy guarded the three payment
--     columns via value-equality subselects, but that guard lived only in the
--     policy.
-- The app never exposes these writes (all client access is brokered through
-- the service-role API), but RLS + GRANT permitted them. This migration moves
-- the protection into trigger logic that runs regardless of how the write
-- arrives, and simplifies the now-redundant policy guard.
--
-- AUTH MODEL
-- ----------
-- Both trigger functions branch on `auth.uid() IS NOT NULL AND NOT
-- public.is_committee()`:
--   * Player (auth.uid() set, not committee) -> payment columns are forced /
--     frozen.
--   * Committee (is_committee() true) -> preserves prior behaviour.
--   * Service-role (auth.uid() IS NULL: computeCompetitionAmountPaid recompute,
--     team_id updates) -> falls through, writes freely. The IS NOT NULL guard
--     is what lets these pass.

-- -----------------------------------------------------------------------------
-- 1. set_competition_amount_owing() — BEFORE INSERT (existing trigger reused)
-- -----------------------------------------------------------------------------
-- The trigger competition_registrations_set_amount_owing (BEFORE INSERT) is NOT
-- recreated; we only replace the function body it already points at.
--
-- Player inserts now have all three payment columns forced to their canonical
-- starting values (price-derived owing, zero paid, 'unpaid'); committee /
-- service-role inserts keep the original "default owing only when null/zero"
-- behaviour.

CREATE OR REPLACE FUNCTION public.set_competition_amount_owing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_price numeric(8,2);
BEGIN
  SELECT price_per_player INTO v_price
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
    -- Player insert: payment columns are server-authoritative.
    NEW.amount_owing   := coalesce(v_price, 0);
    NEW.amount_paid    := 0;
    NEW.payment_status := 'unpaid';
  ELSE
    -- Committee or service-role: preserve the original behaviour.
    IF NEW.amount_owing IS NULL OR NEW.amount_owing = 0 THEN
      NEW.amount_owing := coalesce(v_price, 0);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. protect_competition_registration_fields() — BEFORE UPDATE (new trigger)
-- -----------------------------------------------------------------------------
-- Rejects any player-originated change to the payment columns. Committee and
-- service-role updates pass through.

CREATE OR REPLACE FUNCTION public.protect_competition_registration_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
    IF NEW.amount_owing IS DISTINCT FROM OLD.amount_owing
       OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      RAISE EXCEPTION 'Payment fields on a competition registration are not user-editable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competition_registrations_protect_fields ON public.competition_registrations;
CREATE TRIGGER competition_registrations_protect_fields
  BEFORE UPDATE ON public.competition_registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_competition_registration_fields();

-- -----------------------------------------------------------------------------
-- 3. self_update_nonpayment policy — drop the now-redundant column guard
-- -----------------------------------------------------------------------------
-- The payment-column freeze is now enforced by the BEFORE UPDATE trigger above,
-- so the policy's WITH CHECK can collapse to the ownership check alone.

DROP POLICY IF EXISTS "competition_registrations_self_update_nonpayment" ON public.competition_registrations;
CREATE POLICY "competition_registrations_self_update_nonpayment" ON public.competition_registrations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- ROLLBACK (commented out — run this block manually to revert this migration)
-- =============================================================================
-- -- 3. Restore the original self_update_nonpayment policy verbatim.
-- DROP POLICY IF EXISTS "competition_registrations_self_update_nonpayment" ON public.competition_registrations;
-- CREATE POLICY "competition_registrations_self_update_nonpayment" ON public.competition_registrations
--   FOR UPDATE TO authenticated
--   USING (user_id = auth.uid())
--   WITH CHECK (
--     user_id = auth.uid()
--     AND payment_status = (SELECT payment_status FROM public.competition_registrations WHERE id = competition_registrations.id)
--     AND amount_paid    = (SELECT amount_paid    FROM public.competition_registrations WHERE id = competition_registrations.id)
--     AND amount_owing   = (SELECT amount_owing   FROM public.competition_registrations WHERE id = competition_registrations.id)
--   );
--
-- -- 2. Drop the BEFORE UPDATE protect trigger + its function.
-- DROP TRIGGER IF EXISTS competition_registrations_protect_fields ON public.competition_registrations;
-- DROP FUNCTION IF EXISTS public.protect_competition_registration_fields();
--
-- -- 1. Restore the original set_competition_amount_owing body (trigger unchanged).
-- CREATE OR REPLACE FUNCTION public.set_competition_amount_owing()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $$
-- DECLARE
--   v_price numeric(8,2);
-- BEGIN
--   IF NEW.amount_owing IS NULL OR NEW.amount_owing = 0 THEN
--     SELECT price_per_player INTO v_price
--     FROM public.competitions
--     WHERE id = NEW.competition_id;
--     NEW.amount_owing := coalesce(v_price, 0);
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
