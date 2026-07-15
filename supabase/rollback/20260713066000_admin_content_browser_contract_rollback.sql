-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 66000 contracts browser privileges only after the server replacement and
-- public-safe views from 65000 are available. Restoring direct content writes
-- or sensitive base-table reads would reopen confirmed security and integrity
-- defects. Keep the boundary applied and fix forward.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 66000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
