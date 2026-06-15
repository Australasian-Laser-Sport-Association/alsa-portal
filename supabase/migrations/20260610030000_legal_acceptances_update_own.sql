-- Players re-attest (re-sign) the Code of Conduct / Media Release via an upsert
-- after a committee force-incomplete, so the new attestation counts and the DB
-- trigger clears the override. An upsert that conflicts on an existing row
-- performs an UPDATE, which the previous insert-only design did not permit.
-- This grants UPDATE and adds an own-rows UPDATE policy so a player can only
-- re-attest their own acceptance.

BEGIN;

GRANT UPDATE ON public.legal_acceptances TO authenticated;

CREATE POLICY legal_acceptances_update_own ON public.legal_acceptances
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- DROP POLICY IF EXISTS legal_acceptances_update_own ON public.legal_acceptances;
-- REVOKE UPDATE ON public.legal_acceptances FROM authenticated;
-- COMMIT;
