-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- This migration irreversibly scrubs previously collected IP addresses and
-- user-agent strings, then prevents collecting them again. A rollback cannot
-- reconstruct that deleted metadata and must not reopen its collection.
DO $$
BEGIN
  RAISE EXCEPTION
    '53000 minimises acknowledgement data and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
