-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Anonymous base-table grants expose bank, ownership, legal, and deprecated
-- roster identity fields. Public callers must stay on masked/API surfaces.
DO $$
BEGIN
  RAISE EXCEPTION
    '43000 is a public-data security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
