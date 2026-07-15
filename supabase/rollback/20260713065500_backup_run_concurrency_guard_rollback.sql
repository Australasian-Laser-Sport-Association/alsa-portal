-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 65500 prevents concurrent full-portal backup exports and supplies the
-- durable lease contract required by the deployed backup worker. Dropping the
-- functions or singleton index while that worker is deployed would reopen an
-- availability and storage-amplification risk. Keep the boundary and fix
-- forward.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 65500 cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
