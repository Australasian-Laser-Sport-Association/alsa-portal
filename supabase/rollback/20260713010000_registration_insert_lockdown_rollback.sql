-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Regranting browser INSERT would restore the confirmed registration and
-- protected financial-field forgery path. Keep the boundary and fix forward.
DO $$
BEGIN
  RAISE EXCEPTION
    '10000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
