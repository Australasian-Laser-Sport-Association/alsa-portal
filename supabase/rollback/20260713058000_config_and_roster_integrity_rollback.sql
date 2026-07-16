-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Re-enabling direct configuration writes or authenticated base-table
-- competition reads would recreate race and bank-data exposure defects.
DO $$
BEGIN
  RAISE EXCEPTION
    '58000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
