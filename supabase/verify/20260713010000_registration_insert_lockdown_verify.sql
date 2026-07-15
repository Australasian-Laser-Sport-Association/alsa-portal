-- Verify Wave A registration INSERT lockdown. Read-only except for local DO
-- block state used to raise assertion failures.

DO $$
DECLARE
  v_column text;
  v_minimization_view regclass := to_regclass('public.own_zltac_teams');
  v_registration_safe constant text[] := ARRAY[
    'id', 'user_id', 'team_id', 'year', 'side_events', 'dinner_guests',
    'emergency_contact_name', 'emergency_contact_phone', 'status',
    'has_confirmed_side_events', 'has_confirmed_extras', 'created_at',
    'payment_reference', 'amount_owing', 'dob_at_registration'
  ]::text[];
BEGIN
  IF v_minimization_view IS NOT NULL
     AND obj_description(v_minimization_view::oid, 'pg_class') IS DISTINCT FROM
       'Authenticated actor-scoped ZLTAC team presentation without ownership profile identifiers.' THEN
    RAISE EXCEPTION 'own_zltac_teams exists without the 60000 data-minimization marker';
  END IF;

  IF has_table_privilege(
    'authenticated', 'public.zltac_registrations', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'authenticated still has zltac_registrations INSERT';
  END IF;

  IF v_minimization_view IS NULL THEN
    IF NOT has_table_privilege(
      'authenticated', 'public.zltac_registrations', 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated own-registration reads were removed';
    END IF;
  ELSE
    IF has_table_privilege(
      'authenticated', 'public.zltac_registrations', 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated retains broad registration SELECT after 60000';
    END IF;

    FOREACH v_column IN ARRAY v_registration_safe LOOP
      IF NOT has_column_privilege(
        'authenticated', 'public.zltac_registrations', v_column, 'SELECT'
      ) THEN
        RAISE EXCEPTION 'authenticated lost safe own-registration column: %', v_column;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
        FROM pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.zltac_registrations'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND NOT (attribute.attname = ANY (v_registration_safe))
         AND has_column_privilege(
           'authenticated', 'public.zltac_registrations', attribute.attname, 'SELECT'
         )
    ) THEN
      RAISE EXCEPTION 'authenticated can SELECT a non-allow-listed registration column';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_class AS relation
       WHERE relation.oid = v_minimization_view
         AND relation.relkind = 'v'
    )
       OR NOT has_table_privilege(
         'authenticated', 'public.own_zltac_teams', 'SELECT'
       )
       OR has_any_column_privilege(
         'authenticated', 'public.teams', 'SELECT'
       ) THEN
      RAISE EXCEPTION '60000 safe team read boundary is incomplete';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'own_zltac_teams'
         AND column_name IN ('captain_id', 'manager_id', 'competition_id')
    ) THEN
      RAISE EXCEPTION 'own_zltac_teams exposes ownership identifiers';
    END IF;
  END IF;

  IF NOT has_table_privilege(
    'service_role', 'public.zltac_registrations', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'service_role registration INSERT was removed';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.guard_zltac_registration_privileged_insert()',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.guard_zltac_registration_privileged_insert()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'registration insert guard is directly executable by a browser role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'zltac_registrations'
      AND t.tgname = 'zltac_registrations_guard_privileged_insert'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND p.proname = 'guard_zltac_registration_privileged_insert'
  ) THEN
    RAISE EXCEPTION 'registration privileged-insert guard trigger is missing or disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'zltac_registrations'
      AND policyname = 'zltac_registrations_select_own'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'own-registration SELECT policy is missing';
  END IF;
END;
$$;
