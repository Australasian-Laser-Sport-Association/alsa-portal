-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Publication hashes, immutable metadata, acceptance digests, and append-only
-- evidence are compliance records. Restoring browser writes is also unsafe.
DO $$
BEGIN
  RAISE EXCEPTION
    '40000 contains immutable legal evidence and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
