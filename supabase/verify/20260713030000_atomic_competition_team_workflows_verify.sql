-- Verify 20260713030000_atomic_competition_team_workflows.sql.

DO $$
DECLARE
  v_signature text;
  v_proc regprocedure;
  v_definition text;
  v_workflows text[] := ARRAY[
    'public.register_for_competition(uuid,uuid)',
    'public.cancel_competition_registration(uuid,uuid)',
    'public.create_competition_team(uuid,uuid,text,text)',
    'public.update_competition_team(uuid,uuid,text,text)',
    'public.disband_competition_team(uuid,uuid)',
    'public.invite_competition_team_member(uuid,uuid,uuid)',
    'public.respond_competition_team_invite(uuid,uuid,text)',
    'public.remove_competition_team_member(uuid,uuid)',
    'public.moderate_competition_team(uuid,uuid,text,text)',
    'public.record_competition_payment(uuid,uuid,integer,timestamp with time zone,text,text)',
    'public.update_competition_payment(uuid,uuid,jsonb)',
    'public.remove_competition_payment(uuid,uuid)'
  ]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'team_members'
       AND column_name = 'competition_id'
       AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'team_members.competition_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'team_members_one_accepted_per_competition'
       AND indexdef ILIKE '%UNIQUE INDEX%'
       AND indexdef ILIKE '%competition_id%user_id%'
       AND indexdef ILIKE '%invite_status%accepted%'
  ) THEN
    RAISE EXCEPTION 'accepted competition membership unique index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'team_members'
       AND t.tgname = 'team_members_sync_competition_id'
       AND NOT t.tgisinternal
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'team_members competition sync trigger is missing or disabled';
  END IF;

  IF has_table_privilege('authenticated', 'public.team_members', 'INSERT')
     OR has_table_privilege('authenticated', 'public.team_members', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.team_members', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated retains a direct team_members write grant';
  END IF;

  FOREACH v_signature IN ARRAY v_workflows LOOP
    v_proc := to_regprocedure(v_signature);
    IF v_proc IS NULL THEN
      RAISE EXCEPTION 'required workflow function is missing: %', v_signature;
    END IF;

    -- anon/authenticated effective privilege checks also include any grant to
    -- PUBLIC, so a stray PUBLIC EXECUTE is detected here without treating
    -- PUBLIC as a login role.
    IF has_function_privilege('anon', v_proc::oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_proc::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'browser role can execute service-only workflow: %', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_proc::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute workflow: %', v_signature;
    END IF;

    SELECT pg_get_functiondef(v_proc::oid) INTO v_definition;
    IF position('FOR UPDATE' IN upper(v_definition)) = 0 THEN
      RAISE EXCEPTION 'workflow does not lock mutable rows: %', v_signature;
    END IF;
    IF position('LOCK_OPEN_COMPETITION' IN upper(v_definition)) = 0 THEN
      RAISE EXCEPTION 'workflow does not enforce the competition lifecycle: %', v_signature;
    END IF;
  END LOOP;

  v_proc := to_regprocedure('public.lock_open_competition(uuid)');
  IF v_proc IS NULL THEN
    RAISE EXCEPTION 'lock_open_competition is missing';
  END IF;
  SELECT pg_get_functiondef(v_proc::oid) INTO v_definition;
  IF position('ARCHIVED_AT' IN upper(v_definition)) = 0
     OR position('REGISTRATION_OPEN_AT' IN upper(v_definition)) = 0
     OR position('REGISTRATION_CLOSE_AT' IN upper(v_definition)) = 0
     OR position('FOR UPDATE' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'lock_open_competition does not enforce the complete lifecycle';
  END IF;

  RAISE NOTICE 'PASS: competition roster and billing workflows are atomic and service-only';
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE competition_id IS NOT NULL
       AND invite_status = 'accepted'
     GROUP BY competition_id, user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate accepted competition memberships exist';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
     WHERE tm.competition_id IS DISTINCT FROM t.competition_id
  ) THEN
    RAISE EXCEPTION 'team_members competition scope is out of sync with teams';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.competition_registrations cr
      JOIN public.teams t ON t.id = cr.team_id
     WHERE cr.competition_id IS DISTINCT FROM t.competition_id
  ) THEN
    RAISE EXCEPTION 'competition registration points at a team in another competition';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.competition_registrations cr
     WHERE cr.team_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.team_members tm
          WHERE tm.team_id = cr.team_id
            AND tm.user_id = cr.user_id
            AND tm.invite_status = 'accepted'
       )
  ) THEN
    RAISE EXCEPTION 'competition registration team link lacks accepted membership';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.team_members tm
     WHERE tm.competition_id IS NOT NULL
       AND tm.invite_status = 'accepted'
       AND NOT EXISTS (
         SELECT 1
           FROM public.competition_registrations cr
          WHERE cr.competition_id = tm.competition_id
            AND cr.user_id = tm.user_id
            AND cr.team_id = tm.team_id
       )
  ) THEN
    RAISE EXCEPTION 'accepted competition membership lacks a matching registration team link';
  END IF;
END;
$$;
