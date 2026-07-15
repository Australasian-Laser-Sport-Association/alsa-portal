DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_event_lock_pos integer;
  v_registration_lock_pos integer;
  v_payment_guard_pos integer;
  v_first_cascade_pos integer;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.register_zltac_player(uuid,integer,date,text,text)'::regprocedure,
    'public.confirm_zltac_registration_choices(uuid,integer,text,text[],integer)'::regprocedure,
    'public.admin_update_zltac_registration(uuid,uuid,jsonb)'::regprocedure,
    'public.admin_update_zltac_registration_bundle(uuid,uuid,jsonb)'::regprocedure,
    'public.cancel_zltac_registration(uuid,integer)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Atomic registration function % is browser-callable.', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute atomic registration function %.', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc procedure
       WHERE procedure.oid = v_signature
         AND procedure.prosecdef
         AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION 'Atomic registration function % is not a hardened SECURITY DEFINER.', v_signature;
    END IF;
  END LOOP;

  v_definition := pg_get_functiondef(
    'public.register_zltac_player(uuid,integer,date,text,text)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_lock_open_zltac_event%'
     OR v_definition NOT ILIKE '%max_players%'
     OR v_definition NOT ILIKE '%competition_registrations%'
     OR v_definition NOT ILIKE '%DOB_LOCKED%'
     OR v_definition NOT ILIKE '%recalculate_zltac_amount_owing%' THEN
    RAISE EXCEPTION 'Player registration is missing an atomic lifecycle, cap, DOB, or pricing guard.';
  END IF;
  IF v_definition ILIKE '%to_jsonb(v_registration)%'
     OR v_definition ILIKE '%placeholder_id%'
     OR v_definition ILIKE '%placeholder_exists%'
     OR v_definition NOT ILIKE '%has_confirmed_side_events%'
     OR v_definition NOT ILIKE '%dob_at_registration%' THEN
    RAISE EXCEPTION 'Player registration leaks placeholder identity or does not return the narrow registration allow-list.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.confirm_zltac_registration_choices(uuid,integer,text,text[],integer)'::regprocedure
  );
  IF v_definition NOT ILIKE '%_lock_open_zltac_event%'
     OR v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%recalculate_zltac_amount_owing%'
     OR v_definition NOT ILIKE '%SIDE_EVENT_ROSTER_EXISTS%'
     OR v_definition ILIKE '%to_jsonb(v_registration)%' THEN
    RAISE EXCEPTION 'Player choice confirmation is missing its event/registration lock or pricing reconciliation.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.admin_update_zltac_registration(uuid,uuid,jsonb)'::regprocedure
  );
  v_event_lock_pos := strpos(v_definition, 'SELECT * INTO v_event');
  v_registration_lock_pos := strpos(v_definition, 'SELECT * INTO v_registration');
  IF v_event_lock_pos = 0 OR v_registration_lock_pos = 0
     OR v_event_lock_pos >= v_registration_lock_pos THEN
    RAISE EXCEPTION 'Admin registration update does not lock the event before the registration.';
  END IF;
  IF v_definition NOT ILIKE '%CANCELLATION_WORKFLOW_REQUIRED%'
     OR v_definition NOT ILIKE '%cancel_zltac_registration%' THEN
    RAISE EXCEPTION 'Generic admin registration updates can still bypass cancellation semantics.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.admin_update_zltac_registration_bundle(uuid,uuid,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%admin_update_zltac_registration(%'
     OR v_definition NOT ILIKE '%committee_set_zltac_team_roster(%'
     OR v_definition NOT ILIKE '%admin_replace_zltac_side_event_roster(%'
     OR v_definition NOT ILIKE '%change_profile_alias(%'
     OR v_definition NOT ILIKE '%payment_records%' THEN
    RAISE EXCEPTION 'Admin registration bundle is missing a composed mutation or response balance.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.cancel_zltac_registration(uuid,integer)'::regprocedure
  );
  v_payment_guard_pos := strpos(v_definition, 'FROM public.payment_records');
  v_first_cascade_pos := strpos(v_definition, 'DELETE FROM public.team_members');
  IF v_payment_guard_pos = 0
     OR v_definition NOT ILIKE '%PAYMENT_RECORDS_EXIST%'
     OR v_first_cascade_pos = 0
     OR v_payment_guard_pos >= v_first_cascade_pos THEN
    RAISE EXCEPTION 'Cancellation does not stop on payment evidence before cascading roster data.';
  END IF;
END;
$$;
