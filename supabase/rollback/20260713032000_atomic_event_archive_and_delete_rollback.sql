-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Archive guards, event/evidence foreign keys, and deletion audit records must
-- remain intact. Removing them can orphan or silently erase retained evidence.
DO $$
BEGIN
  RAISE EXCEPTION
    '32000 contains lifecycle and audit safeguards and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
