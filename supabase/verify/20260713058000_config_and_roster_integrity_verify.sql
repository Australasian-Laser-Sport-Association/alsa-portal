-- Read-only verification for locked configuration, team workflows, and
-- masked/suspension-aware public roster surfaces.

DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_view_definition text;
  v_bank_column text;
  v_pre_62000_signature regprocedure := to_regprocedure(
    'public.committee_update_zltac_team_pre_62000(uuid,uuid,jsonb,text)'
  );
BEGIN
  IF v_pre_62000_signature IS NOT NULL
     AND obj_description(v_pre_62000_signature::oid, 'pg_proc') IS DISTINCT FROM
       'Service-only, event-first committee ZLTAC team update with roster reconciliation.' THEN
    RAISE EXCEPTION 'pre-62000 committee team implementation has an unexpected marker';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.committee_save_zltac_event(uuid,uuid,jsonb)'::regprocedure,
    'public.committee_update_zltac_team(uuid,uuid,jsonb,text)'::regprocedure,
    'public.captain_mutate_zltac_team(uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.update_competition_config(uuid,uuid,jsonb)'::regprocedure
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

  v_definition := pg_get_functiondef(
    'public.committee_save_zltac_event(uuid,uuid,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%Archived events are immutable%'
     OR v_definition NOT ILIKE '%v_critical_changed%'
     OR v_definition NOT ILIKE '%zltac_registrations%' THEN
    RAISE EXCEPTION 'ZLTAC event configuration function lacks lifecycle locks';
  END IF;

  IF v_pre_62000_signature IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.committee_update_zltac_team(uuid,uuid,jsonb,text)'::regprocedure
    );
    IF v_definition NOT ILIKE '%FOR UPDATE%'
       OR v_definition NOT ILIKE '%recalculate_zltac_amount_owing%'
       OR v_definition NOT ILIKE '%team_members%'
       OR v_definition NOT ILIKE '%zltac_registrations%'
       OR v_definition NOT ILIKE '%profile.suspended%' THEN
      RAISE EXCEPTION 'committee team function lacks roster reconciliation';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc AS function_row
       WHERE function_row.oid = v_pre_62000_signature
         AND function_row.prosecdef
         AND function_row.proconfig @> ARRAY[
           'search_path=pg_catalog, public'
         ]::text[]
    )
       OR has_function_privilege('anon', v_pre_62000_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_pre_62000_signature, 'EXECUTE')
       OR has_function_privilege('service_role', v_pre_62000_signature, 'EXECUTE')
       OR EXISTS (
         SELECT 1
           FROM pg_proc AS function_row,
                aclexplode(coalesce(
                  function_row.proacl,
                  acldefault('f', function_row.proowner)
                )) AS privilege
          WHERE function_row.oid = v_pre_62000_signature
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'pre-62000 committee team implementation is externally executable';
    END IF;

    v_definition := pg_get_functiondef(v_pre_62000_signature);
    IF v_definition NOT ILIKE '%FOR UPDATE%'
       OR v_definition NOT ILIKE '%recalculate_zltac_amount_owing%'
       OR v_definition NOT ILIKE '%team_members%'
       OR v_definition NOT ILIKE '%zltac_registrations%'
       OR v_definition NOT ILIKE '%profile.suspended%' THEN
      RAISE EXCEPTION 'pre-62000 committee team implementation lacks roster reconciliation';
    END IF;

    v_definition := pg_get_functiondef(
      'public.committee_update_zltac_team(uuid,uuid,jsonb,text)'::regprocedure
    );
    IF v_definition NOT ILIKE '%committee_update_zltac_team_pre_62000%'
       OR v_definition NOT ILIKE '%_assert_zltac_team_approvable%'
       OR v_definition NOT ILIKE '%FOR UPDATE%' THEN
      RAISE EXCEPTION '62000 committee team wrapper does not safely delegate';
    END IF;
  END IF;

  v_definition := pg_get_functiondef(
    'public.captain_mutate_zltac_team(uuid,uuid,uuid,text,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%v_roster_count < 5%'
     OR v_definition NOT ILIKE '%membership and registration roster are inconsistent%'
     OR v_definition NOT ILIKE '%profile.suspended%' THEN
    RAISE EXCEPTION 'captain team function lacks atomic eligibility/roster checks';
  END IF;

  v_definition := pg_get_functiondef(
    'public.update_competition_config(uuid,uuid,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%Archived competitions are immutable%'
     OR v_definition NOT ILIKE '%v_locked_changed%'
     OR v_definition NOT ILIKE '%competition_registrations%' THEN
    RAISE EXCEPTION 'competition configuration function lacks lifecycle locks';
  END IF;

  IF has_table_privilege('authenticated', 'public.competitions', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated still has base-table competition SELECT';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.public_competitions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.public_competition_roster_safe', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated safe competition views are not readable';
  END IF;

  FOREACH v_bank_column IN ARRAY ARRAY[
    'bank_account_name', 'bank_bsb', 'bank_account_number'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('public_competitions', 'public_competition_roster_safe')
         AND column_name = v_bank_column
    ) THEN
      RAISE EXCEPTION 'safe public competition views expose %', v_bank_column;
    END IF;
  END LOOP;

  FOREACH v_view_definition IN ARRAY ARRAY[
    pg_get_viewdef('public.public_zltac_teams'::regclass, true),
    pg_get_viewdef('public.public_event_roster'::regclass, true),
    pg_get_viewdef('public.public_competition_roster_safe'::regclass, true)
  ] LOOP
    IF v_view_definition NOT ILIKE '%suspended%' THEN
      RAISE EXCEPTION 'a public roster view does not exclude suspended profiles';
    END IF;
  END LOOP;
END;
$$;
