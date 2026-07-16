-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Removing the overlap guard would make the canonical active membership period
-- ambiguous for future writes, even when current rows happen not to overlap.
DO $$
BEGIN
  RAISE EXCEPTION
    '50000 is a membership-integrity boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
