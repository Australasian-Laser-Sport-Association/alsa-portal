-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Subject tokens, unlink timestamps, RESTRICT foreign keys, and retention
-- triggers protect evidence after account deletion. Downgrading can erase it.
DO $$
BEGIN
  RAISE EXCEPTION
    '53000 contains retained legal evidence and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
