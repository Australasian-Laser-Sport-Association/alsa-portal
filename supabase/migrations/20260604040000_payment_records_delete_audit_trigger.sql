-- =============================================================================
-- Record every payment_records delete, including cascades.
-- =============================================================================
-- Today only delete_payment_record() writes a history row, so a delete that
-- arrives via cascade (deleting a zltac_events year, a competition, a profile,
-- or a registration) removes payment_records rows outside the usual RPC path.
--
-- Fix: an AFTER DELETE trigger logs every delete to payment_records_history.
-- The RPC stops writing history itself and instead passes its actor to the
-- trigger through a txn-local GUC (app.payment_changed_by), so there is exactly
-- ONE history row per delete:
--   * RPC-initiated delete  -> changed_by = the RPC's p_changed_by
--   * cascade/system delete -> GUC unset  -> changed_by = NULL
--
-- payment_records_history.changed_by is a plain uuid (its FK was dropped in
-- 20260604030000), so writing NULL or any uuid there is fine.
--
-- edit_payment_record() is intentionally NOT touched: UPDATE has no cascade gap,
-- so it keeps its own history insert. The delete_payment_record() signature is
-- unchanged, so the API handlers stay as-is.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. AFTER DELETE trigger: log every payment_records delete
-- -----------------------------------------------------------------------------
-- current_setting('app.payment_changed_by', true) returns NULL when the GUC is
-- unset (the `true` = missing_ok), so a cascade/system delete logs with
-- changed_by NULL. An RPC delete sets the GUC first (see section 2).

CREATE OR REPLACE FUNCTION public.log_payment_record_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.payment_changed_by', true), '')::uuid;
BEGIN
  INSERT INTO public.payment_records_history (
    payment_record_id, operation,
    registration_id, competition_registration_id,
    amount, recorded_at, recorded_by, bank_reference, notes,
    changed_by
  ) VALUES (
    OLD.id, 'delete',
    OLD.registration_id, OLD.competition_registration_id,
    OLD.amount, OLD.recorded_at, OLD.recorded_by, OLD.bank_reference, OLD.notes,
    v_actor
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS payment_records_log_delete ON public.payment_records;
CREATE TRIGGER payment_records_log_delete
  AFTER DELETE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.log_payment_record_delete();


-- -----------------------------------------------------------------------------
-- 2. delete_payment_record: set actor GUC, delete, clear GUC; no manual history
-- -----------------------------------------------------------------------------
-- The trailing set_config that clears the GUC comes AFTER the DELETE so the
-- AFTER DELETE trigger still observes the actor, and the actor cannot linger for
-- the rest of the transaction. Same signature + not-found error as before; the
-- manual history INSERT is removed because the trigger now does the logging.

CREATE OR REPLACE FUNCTION public.delete_payment_record(p_id uuid, p_changed_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payment_records WHERE id = p_id) THEN
    RAISE EXCEPTION 'payment_records row % not found', p_id;
  END IF;
  PERFORM set_config('app.payment_changed_by', coalesce(p_changed_by::text, ''), true);
  DELETE FROM public.payment_records WHERE id = p_id;
  PERFORM set_config('app.payment_changed_by', '', true);
END;
$$;


-- =============================================================================
-- ROLLBACK (commented out — run this block manually to revert this migration)
-- =============================================================================
-- -- 1. Drop the AFTER DELETE trigger + its function.
-- DROP TRIGGER IF EXISTS payment_records_log_delete ON public.payment_records;
-- DROP FUNCTION IF EXISTS public.log_payment_record_delete();
--
-- -- 2. Restore delete_payment_record to its 20260604010000 definition verbatim
-- --    (fetches OLD via %ROWTYPE and inserts its own history row).
-- CREATE OR REPLACE FUNCTION public.delete_payment_record(
--   p_id         uuid,
--   p_changed_by uuid
-- )
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   old public.payment_records%ROWTYPE;
-- BEGIN
--   SELECT * INTO old FROM public.payment_records WHERE id = p_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'payment_records row % not found', p_id;
--   END IF;
--
--   INSERT INTO public.payment_records_history (
--     payment_record_id, operation,
--     registration_id, competition_registration_id,
--     amount, recorded_at, recorded_by, bank_reference, notes,
--     changed_by
--   ) VALUES (
--     old.id, 'delete',
--     old.registration_id, old.competition_registration_id,
--     old.amount, old.recorded_at, old.recorded_by, old.bank_reference, old.notes,
--     p_changed_by
--   );
--
--   DELETE FROM public.payment_records WHERE id = p_id;
-- END;
-- $$;
-- =============================================================================
