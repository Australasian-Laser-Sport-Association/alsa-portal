-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 59000 makes payment creates idempotent and all ledger mutations atomic with
-- their canonical balance, cached competition status, and audit evidence.
-- Restoring the former split API/database writes would reintroduce ambiguous
-- retries and ledger drift. Apply a corrective migration instead.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 59000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
