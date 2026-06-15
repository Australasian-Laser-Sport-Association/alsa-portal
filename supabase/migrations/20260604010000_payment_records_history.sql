-- Audit trail for lossy payment_records mutations (edits + deletes), covering
-- BOTH the ZLTAC ledger (payment_records.registration_id) and the competition
-- ledger (payment_records.competition_registration_id).
--
-- WHY
-- ---
-- Today an edit (PATCH) overwrites amount / recorded_at / bank_reference /
-- notes in place, and a delete (DELETE) hard-removes the row — in both cases
-- the prior values are lost. This migration adds an append-only history table
-- plus two SECURITY DEFINER RPCs that snapshot the OLD row before mutating it,
-- so every edit and delete is reconstructable: pre-change values + who + when.
--
-- The handler changes that route the existing API writes through these RPCs
-- are a SEPARATE follow-up change set; this migration only lays the schema +
-- functions. Until the handlers are switched over, direct service-role
-- update/delete on payment_records still works and is simply not yet audited.
--
-- SECURITY
-- --------
-- The two RPCs are SECURITY DEFINER (mirroring claim_placeholder_profile) so
-- they can write the history table, which is otherwise not writable by any
-- application role. EXECUTE is locked to service_role only: these are called
-- exclusively from the service-role API, which has already authorised the
-- caller (verifyCommittee on the ZLTAC side, gateCompetitionPaymentRecord on
-- the competition side) and passes the resolved user id as p_changed_by.

-- -----------------------------------------------------------------------------
-- 1. History table
-- -----------------------------------------------------------------------------
-- Append-only snapshot of the row as it existed immediately BEFORE an update or
-- delete. payment_record_id intentionally has NO foreign key to
-- payment_records: a delete hard-removes the parent, and the trail must
-- outlive it.

CREATE TABLE public.payment_records_history (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_record_id           uuid NOT NULL,        -- intentionally NO FK: the trail must survive a hard-delete of the parent
  operation                   text NOT NULL CHECK (operation IN ('update', 'delete')),
  registration_id             uuid,                 -- snapshot (OLD values below)
  competition_registration_id uuid,
  amount                      integer,
  recorded_at                 timestamptz,
  recorded_by                 uuid,
  bank_reference              text,
  notes                       text,
  changed_by                  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_records_history_payment_record_idx
  ON public.payment_records_history (payment_record_id);

ALTER TABLE public.payment_records_history ENABLE ROW LEVEL SECURITY;

-- Committee read-only. There is no insert/update/delete policy and no write
-- GRANT: the only writers are the SECURITY DEFINER RPCs below.
CREATE POLICY "payment_records_history_committee_read" ON public.payment_records_history
  FOR SELECT TO authenticated
  USING (public.is_committee());

GRANT SELECT ON public.payment_records_history TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. edit_payment_record — snapshot OLD, then apply a partial update
-- -----------------------------------------------------------------------------
-- p_changes is a JSON object of the columns to change. The "key present?" test
-- (p_changes ? 'key') means an explicit null clears the column while an absent
-- key leaves it unchanged — matching the handler's hasOwnProperty semantics.

CREATE OR REPLACE FUNCTION public.edit_payment_record(
  p_id         uuid,
  p_changes    jsonb,
  p_changed_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old public.payment_records%ROWTYPE;
BEGIN
  SELECT * INTO old FROM public.payment_records WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_records row % not found', p_id;
  END IF;

  INSERT INTO public.payment_records_history (
    payment_record_id, operation,
    registration_id, competition_registration_id,
    amount, recorded_at, recorded_by, bank_reference, notes,
    changed_by
  ) VALUES (
    old.id, 'update',
    old.registration_id, old.competition_registration_id,
    old.amount, old.recorded_at, old.recorded_by, old.bank_reference, old.notes,
    p_changed_by
  );

  UPDATE public.payment_records
  SET
    amount         = CASE WHEN p_changes ? 'amount'         THEN (p_changes->>'amount')::integer        ELSE amount END,
    recorded_at    = CASE WHEN p_changes ? 'recorded_at'    THEN (p_changes->>'recorded_at')::timestamptz ELSE recorded_at END,
    bank_reference = CASE WHEN p_changes ? 'bank_reference' THEN  p_changes->>'bank_reference'           ELSE bank_reference END,
    notes          = CASE WHEN p_changes ? 'notes'          THEN  p_changes->>'notes'                    ELSE notes END
  WHERE id = p_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. delete_payment_record — snapshot OLD, then hard-delete
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_payment_record(
  p_id         uuid,
  p_changed_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old public.payment_records%ROWTYPE;
BEGIN
  SELECT * INTO old FROM public.payment_records WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_records row % not found', p_id;
  END IF;

  INSERT INTO public.payment_records_history (
    payment_record_id, operation,
    registration_id, competition_registration_id,
    amount, recorded_at, recorded_by, bank_reference, notes,
    changed_by
  ) VALUES (
    old.id, 'delete',
    old.registration_id, old.competition_registration_id,
    old.amount, old.recorded_at, old.recorded_by, old.bank_reference, old.notes,
    p_changed_by
  );

  DELETE FROM public.payment_records WHERE id = p_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Lock execution to the service-role API only
-- -----------------------------------------------------------------------------
-- Not granted to authenticated: these are called solely from the service-role
-- API, which authorises the caller before invoking them.

REVOKE EXECUTE ON FUNCTION public.edit_payment_record(uuid, jsonb, uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_payment_record(uuid, uuid)        FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.edit_payment_record(uuid, jsonb, uuid)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.delete_payment_record(uuid, uuid)        TO service_role;


-- =============================================================================
-- ROLLBACK (commented out — run this block manually to revert this migration)
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.delete_payment_record(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.edit_payment_record(uuid, jsonb, uuid);
-- DROP POLICY   IF EXISTS "payment_records_history_committee_read" ON public.payment_records_history;
-- DROP TABLE    IF EXISTS public.payment_records_history;
