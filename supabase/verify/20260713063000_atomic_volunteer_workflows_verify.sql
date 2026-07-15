DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_upsert_volunteer_role(uuid,uuid,jsonb)'::regprocedure,
    'public.mutate_own_volunteer_signup(uuid,uuid,text,uuid[],text)'::regprocedure,
    'public.admin_create_volunteer_signup(uuid,uuid,uuid[],text)'::regprocedure,
    'public.admin_set_volunteer_role_decisions(uuid,uuid,jsonb)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Atomic volunteer function % has unsafe execute grants.', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      WHERE procedure.oid = v_signature
        AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION 'Atomic volunteer function % is not hardened.', v_signature;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.volunteer_signups', 'INSERT')
     OR has_table_privilege('authenticated', 'public.volunteer_signups', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.volunteer_signups', 'DELETE')
     OR has_table_privilege('authenticated', 'public.volunteer_signup_roles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.volunteer_signup_roles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.volunteer_signup_roles', 'DELETE') THEN
    RAISE EXCEPTION 'Browser volunteer writes were re-enabled.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.admin_upsert_volunteer_role(uuid,uuid,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_assert_volunteer_committee_actor%'
     OR v_definition NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%SET is_default = false%' THEN
    RAISE EXCEPTION 'Volunteer role/default configuration is not a serialized atomic mutation.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.mutate_own_volunteer_signup(uuid,uuid,text,uuid[],text)'::regprocedure
  );
  IF v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
     OR v_definition NOT ILIKE '%FROM public.zltac_registrations%FOR UPDATE%'
     OR v_definition NOT ILIKE '%suspended%'
     OR v_definition NOT ILIKE '%status = ''approved''%'
     OR v_definition NOT ILIKE '%DELETE FROM public.volunteer_signup_roles%'
     OR v_definition NOT ILIKE '%INSERT INTO public.volunteer_signup_roles%' THEN
    RAISE EXCEPTION 'Player volunteer mutation lacks lifecycle, ownership, evidence, or atomic child writes.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.admin_create_volunteer_signup(uuid,uuid,uuid[],text)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_assert_volunteer_committee_actor%'
     OR v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
     OR v_definition NOT ILIKE '%FROM public.zltac_registrations%FOR UPDATE%'
     OR v_definition NOT ILIKE '%INSERT INTO public.volunteer_signups%'
     OR v_definition NOT ILIKE '%INSERT INTO public.volunteer_signup_roles%' THEN
    RAISE EXCEPTION 'Manual volunteer signup is not a single guarded transaction.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.admin_set_volunteer_role_decisions(uuid,uuid,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_assert_volunteer_committee_actor%'
     OR v_definition NOT ILIKE '%FROM public.volunteer_signups%FOR UPDATE%'
     OR v_definition NOT ILIKE '%FROM public.volunteer_signup_roles%FOR UPDATE%'
     OR v_definition NOT ILIKE '%ON CONFLICT (signup_id, role_id) DO UPDATE%'
     OR v_definition NOT ILIKE '%WITH ORDINALITY%' THEN
    RAISE EXCEPTION 'Volunteer decision batches are not validated and applied atomically.';
  END IF;
END;
$$;
