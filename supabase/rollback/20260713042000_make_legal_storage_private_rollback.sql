-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Legal PDF objects are intentionally private and API-authorized. Reopening
-- the bucket or browser storage policies would bypass publication integrity.
DO $$
BEGIN
  RAISE EXCEPTION
    '42000 is a legal-storage security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
