-- Read-only verification for captain roster ownership and team approval guards.

DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_zltac_captain_team(uuid,integer,text,text,text,text,text,text)'::regprocedure,
    'public.add_zltac_team_player(uuid,uuid,uuid,integer)'::regprocedure,
    'public.committee_update_zltac_team(uuid,uuid,jsonb,text)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc function_row
       WHERE function_row.oid = v_signature
         AND function_row.prosecdef
         AND function_row.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION '% is not a pinned SECURITY DEFINER function', v_signature;
    END IF;
    IF EXISTS (
         SELECT 1
           FROM pg_proc function_row,
                aclexplode(coalesce(
                  function_row.proacl,
                  acldefault('f', function_row.proowner)
                )) AS privilege
          WHERE function_row.oid = v_signature
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% has unsafe execute privileges', v_signature;
    END IF;
  END LOOP;

  v_signature :=
    'public.committee_update_zltac_team_pre_62000(uuid,uuid,jsonb,text)'::regprocedure;
  IF has_function_privilege('anon', v_signature, 'EXECUTE')
     OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_proc function_row,
              aclexplode(coalesce(
                function_row.proacl,
                acldefault('f', function_row.proowner)
              )) AS privilege
        WHERE function_row.oid = v_signature
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'legacy committee team implementation remains externally executable';
  END IF;

  v_signature :=
    'public._assert_zltac_team_approvable(uuid,uuid,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc function_row
     WHERE function_row.oid = v_signature
       AND function_row.prosecdef
       AND function_row.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'team approval helper is not an owner-only pinned function';
  END IF;

  v_definition := pg_get_functiondef(
    'public.create_zltac_captain_team(uuid,integer,text,text,text,text,text,text)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_lock_open_zltac_event%'
     OR v_definition NOT ILIKE '%team_id IS NULL%'
     OR v_definition NOT ILIKE '%side-event selections%'
     OR v_definition NOT ILIKE '%profile.suspended%' THEN
    RAISE EXCEPTION 'captain team creation lacks lifecycle, ownership, or preservation guards';
  END IF;

  v_definition := pg_get_functiondef(
    'public.add_zltac_team_player(uuid,uuid,uuid,integer)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_lock_open_zltac_event%'
     OR v_definition NOT ILIKE '%team_id IS NULL%'
     OR v_definition NOT ILIKE '%registration.status NOT IN%'
     OR v_definition NOT ILIKE '%profile.suspended%' THEN
    RAISE EXCEPTION 'captain add-player lacks lifecycle, ownership, or eligibility guards';
  END IF;

  v_definition := pg_get_functiondef(
    'public.committee_update_zltac_team(uuid,uuid,jsonb,text)'::regprocedure
  );
  IF v_definition NOT ILIKE '%Only a pending team can be reviewed%'
     OR v_definition NOT ILIKE '%dedicated review action%'
     OR v_definition NOT ILIKE '%_assert_zltac_team_approvable%'
     OR v_definition NOT ILIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'committee team entry point lacks approval guards';
  END IF;

  v_definition := pg_get_functiondef(
    'public._assert_zltac_team_approvable(uuid,uuid,integer)'::regprocedure
  );
  IF v_definition NOT ILIKE '%v_roster_count < 5%'
     OR v_definition NOT ILIKE '%profile.suspended%'
     OR v_definition NOT ILIKE '%membership and registration roster are inconsistent%'
     OR v_definition NOT ILIKE '%Captain membership is missing or inconsistent%' THEN
    RAISE EXCEPTION 'team approval helper lacks roster parity or eligibility checks';
  END IF;
END;
$$;
