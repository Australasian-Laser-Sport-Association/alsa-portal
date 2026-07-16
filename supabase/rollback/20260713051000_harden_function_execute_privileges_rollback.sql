-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- PUBLIC function execution and permissive default privileges would expose
-- internal payment and future SECURITY DEFINER functions through PostgREST.
DO $$
BEGIN
  RAISE EXCEPTION
    '51000 is a function-ACL security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
