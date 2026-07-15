-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Restoring table-level profile SELECT would expose email, placeholder_email,
-- membership identifiers, and every future profile column to authenticated
-- browser sessions. Keep the allow-list applied and fix forward.
DO $$
BEGIN
  RAISE EXCEPTION
    '56000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
