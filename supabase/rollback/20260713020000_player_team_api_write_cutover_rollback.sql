-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Browser grants and owner policies removed here admitted registration,
-- under-18 evidence, and team-control mutations outside server transactions.
DO $$
BEGIN
  RAISE EXCEPTION
    '20000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
