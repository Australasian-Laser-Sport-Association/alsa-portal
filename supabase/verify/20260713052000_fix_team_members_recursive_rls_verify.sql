-- Verify the non-recursive team-member policy and helper ACL/security posture.

DO $$
DECLARE
  policy_expression text;
  helper_search_path text;
BEGIN
  IF to_regprocedure('public.can_read_team_members(uuid)') IS NULL THEN
    RAISE EXCEPTION 'can_read_team_members(uuid) is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.can_read_team_members(uuid)'::regprocedure
      AND prosecdef
      AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'can_read_team_members must be stable and SECURITY DEFINER';
  END IF;

  SELECT array_to_string(proconfig, ',')
    INTO helper_search_path
    FROM pg_proc
   WHERE oid = 'public.can_read_team_members(uuid)'::regprocedure;

  IF helper_search_path IS DISTINCT FROM 'search_path=pg_catalog, public' THEN
    RAISE EXCEPTION 'can_read_team_members search_path is not pinned: %',
      helper_search_path;
  END IF;

  IF has_function_privilege('anon',
       'public.can_read_team_members(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.can_read_team_members(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'can_read_team_members has incorrect browser-role grants';
  END IF;

  SELECT qual
    INTO policy_expression
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'team_members'
     AND policyname = 'team_members_team_read';

  IF policy_expression IS NULL
     OR policy_expression NOT LIKE '%can_read_team_members(team_id)%'
     OR policy_expression LIKE '%FROM team_members%' THEN
    RAISE EXCEPTION 'team_members_team_read does not use the non-recursive helper: %',
      policy_expression;
  END IF;
END
$$;
