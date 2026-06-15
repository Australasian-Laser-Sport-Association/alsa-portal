-- Run after 20260615040000_atomic_zltac_capacity_and_captain_team.sql.

DO $$
DECLARE
  v_trigger_count integer;
  v_insert_order text[];
  v_update_order text[];
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.create_zltac_captain_team(uuid, integer, text, text, text, text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute create_zltac_captain_team directly';
  END IF;
  IF has_function_privilege('authenticated', 'public.add_zltac_team_player(uuid, uuid, uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.disband_zltac_team(uuid, uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.remove_zltac_team_player(uuid, uuid, uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.recalculate_zltac_amount_owing(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute a service-only ZLTAC workflow';
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN (
      'teams_enforce_zltac_capacity',
      'zltac_registrations_enforce_event_capacity',
      'zltac_registrations_enforce_roster_capacity_insert',
      'zltac_registrations_enforce_roster_capacity_update'
    );
  IF v_trigger_count <> 4 THEN
    RAISE EXCEPTION 'Expected 4 ZLTAC capacity triggers, found %', v_trigger_count;
  END IF;

  SELECT array_agg(t.tgname ORDER BY t.tgname)
    INTO v_insert_order
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.zltac_registrations'::regclass
     AND NOT t.tgisinternal
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 4) = 4;
  IF v_insert_order IS DISTINCT FROM ARRAY[
    'trg_enforce_zltac_roster_lock',
    'zltac_registrations_enforce_event_capacity',
    'zltac_registrations_enforce_roster_capacity_insert',
    'zltac_registrations_set_payment_reference'
  ]::text[] THEN
    RAISE EXCEPTION 'Unexpected registration BEFORE INSERT trigger order: %', v_insert_order;
  END IF;

  SELECT array_agg(t.tgname ORDER BY t.tgname)
    INTO v_update_order
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.zltac_registrations'::regclass
     AND NOT t.tgisinternal
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 16) = 16;
  IF v_update_order IS DISTINCT FROM ARRAY[
    'trg_enforce_zltac_roster_lock',
    'trg_protect_registration_admin_fields',
    'zltac_registrations_enforce_roster_capacity_update'
  ]::text[] THEN
    RAISE EXCEPTION 'Unexpected registration BEFORE UPDATE trigger order: %', v_update_order;
  END IF;

  RAISE NOTICE 'PASS: ZLTAC caps are serialized and captain creation is service-only';
END $$;
