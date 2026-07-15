-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Removing DOB snapshots, document provenance, or decision constraints would
-- discard identity evidence and permit incoherent under-18 decisions.
DO $$
BEGIN
  RAISE EXCEPTION
    '11000 contains identity evidence and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
