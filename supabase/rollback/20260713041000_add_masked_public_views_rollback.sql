-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- The prior public views exposed account UUIDs, legal names, cancelled rows,
-- and unapproved teams. Those public contracts must not be restored.
DO $$
BEGIN
  RAISE EXCEPTION
    '41000 is a public-privacy boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
