-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Normalized side-event roster state and uniqueness/coherence constraints are
-- data-bearing. A downgrade would discard state and restore forgery races.
DO $$
BEGIN
  RAISE EXCEPTION
    '31000 contains roster evidence and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
