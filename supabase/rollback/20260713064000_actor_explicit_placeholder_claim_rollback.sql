-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
--
-- 64000 replaces an ambiguous service-role contract with an actor-explicit,
-- verified-email ownership boundary and normalizes alias uniqueness. Dropping
-- its constraint or rebuilding the older lower(alias) index would permit
-- ambiguous edge-space aliases; restoring the previous function would make a
-- user-editable alias ownership proof again; dropping its merge audit would
-- erase durable security evidence. There is no safe data-only precondition for
-- reopening these boundaries. Keep the migration applied and fix forward.

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLL_FORWARD_ONLY_SECURITY_BOUNDARY: 64000 verified-email claims and normalized aliases cannot be safely rolled back. Keep it applied and fix forward.'
    USING ERRCODE = '55000';
END;
$$;
