-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 55000 removes direct legal-evidence writes and makes event state part of the
-- same transaction as each signature or under-18 decision. Restoring the old
-- grants or functions would reopen confirmed race and authorisation defects.
-- Roll application code forward with a new migration; do not repair migration
-- history backward through this boundary.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 55000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
