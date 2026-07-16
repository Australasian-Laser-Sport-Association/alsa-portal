-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- This migration contains live team invariants and atomic competition state.
-- Dropping its columns, indexes, triggers, or RPCs can corrupt existing data.
DO $$
BEGIN
  RAISE EXCEPTION
    '30000 contains live competition state and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
