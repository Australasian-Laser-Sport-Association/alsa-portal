-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Restoring broad browser privileges would re-expose bank instructions,
-- identity ownership, legal storage paths, and administrative evidence.
DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: authenticated data minimization cannot be safely rolled back; restore service by fixing forward';
END;
$$;
