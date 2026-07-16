-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Referee attempt rows are anti-replay and assessment evidence. They must not
-- be dropped merely to return application code to an older deployment.
DO $$
BEGIN
  RAISE EXCEPTION
    '33000 contains referee attempt evidence and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
