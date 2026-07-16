-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- This migration replaces non-atomic cancellation, committee roster, team
-- move, and placeholder paths. The superseded paths have confirmed defects.
DO $$
BEGIN
  RAISE EXCEPTION
    '54000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
