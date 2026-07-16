-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Removing the explicit Storage defense-in-depth predicates or restoring
-- browser payment DML would weaken account enforcement and reopen a
-- financial-audit bypass. Keep this migration applied and repair forward if
-- a dependent client is discovered.
DO $$
BEGIN
  RAISE EXCEPTION
    '44000 is an account-access and payment-integrity boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
