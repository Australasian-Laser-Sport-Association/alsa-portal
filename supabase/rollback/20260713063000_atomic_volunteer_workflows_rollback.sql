-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 63000 is the server-authoritative replacement for browser volunteer writes
-- and makes parent/role changes transactional. Restoring the split writes
-- would reintroduce a broken live route and partial volunteer records. Apply a
-- corrective migration instead.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 63000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
