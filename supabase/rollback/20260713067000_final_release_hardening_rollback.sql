-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 67000 removes an obsolete question-bank disclosure, makes permanent account
-- revocation explicit in database authorization, fixes function search paths,
-- and narrows audit-ledger privileges. Reversing it would reopen reviewed
-- security gaps. Keep the boundary applied and fix forward.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 67000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
