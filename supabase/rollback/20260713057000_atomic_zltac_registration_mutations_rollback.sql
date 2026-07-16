-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 57000 closes registration cap, event lifecycle, pricing rollback, committee
-- bundle, and payment-evidence races. Restoring the former route/table writes
-- or registration-first lock order would reopen those defects. Roll application
-- code forward with a new migration instead of reverting this boundary.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 57000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
