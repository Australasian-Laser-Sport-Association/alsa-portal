-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Restoring the former captain/committee functions would allow cross-team
-- roster moves, registration-data loss, and approval of ineligible teams.
-- Keep the migration applied and correct any issue with a new roll-forward
-- migration.
DO $$
BEGIN
  RAISE EXCEPTION
    '62000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
