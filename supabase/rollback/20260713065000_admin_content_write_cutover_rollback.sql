-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 65000 introduces the actor-explicit server replacement, attributed immutable
-- audit records, transactional event history/placing saves, and safe public
-- views required before the browser contract can be narrowed. Dropping these
-- expansion contracts would leave the deployed application incompatible.
-- Keep the boundary applied and fix forward.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 65000 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
