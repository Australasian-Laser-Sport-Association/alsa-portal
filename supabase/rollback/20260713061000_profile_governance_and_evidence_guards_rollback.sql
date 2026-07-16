-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Removing the role constraint, active-superadmin guard, immutable access
-- audit, permanent access-revocation tombstone, or evidence-preserving delete
-- behaviour would recreate governance, account-reopening, and data-loss
-- defects. Keep the migration applied and correct any issue with a new
-- roll-forward migration. The sensitive tombstone is intentionally retained.
DO $$
BEGIN
  RAISE EXCEPTION
    '61000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
