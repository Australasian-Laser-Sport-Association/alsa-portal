-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Restoring direct volunteer-table writes would bypass the validated server
-- workflow and its authorization, validation, and failure handling.
DO $$
BEGIN
  RAISE EXCEPTION
    '13000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
