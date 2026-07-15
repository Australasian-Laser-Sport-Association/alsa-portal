-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- The superseded team_members policy recursively queried itself and could fail
-- every roster read. It must never be recreated during incident response.
DO $$
BEGIN
  RAISE EXCEPTION
    '52000 fixes recursive RLS and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
