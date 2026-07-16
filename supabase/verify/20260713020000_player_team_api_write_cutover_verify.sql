-- Verify final Wave A browser-write cutover.

DO $$
DECLARE
  v_column text;
  v_table text;
  v_minimization_view regclass := to_regclass('public.own_zltac_teams');
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_contract_applied boolean := coalesce(
    obj_description(
      to_regprocedure('public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'),
      'pg_proc'
    ) = v_contract_marker,
    false
  );
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.under_18_approvals'::regclass
      AND conname = 'under_18_approvals_document_required'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'new under-18 submissions do not require document provenance';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'zltac_registrations',
    'under_18_approvals',
    'teams'
  ] LOOP
    IF has_table_privilege(
      'authenticated', format('public.%I', v_table), 'INSERT'
    ) OR has_table_privilege(
      'authenticated', format('public.%I', v_table), 'UPDATE'
    ) OR has_table_privilege(
      'authenticated', format('public.%I', v_table), 'DELETE'
    ) THEN
      RAISE EXCEPTION 'authenticated still has a table write privilege on public.%', v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND grantee = 'authenticated'
        AND privilege_type IN ('INSERT', 'UPDATE')
    ) THEN
      RAISE EXCEPTION 'authenticated still has a column write privilege on public.%', v_table;
    END IF;

    IF v_table = 'under_18_approvals' OR v_minimization_view IS NULL THEN
      IF NOT has_table_privilege(
        'authenticated', format('public.%I', v_table), 'SELECT'
      ) THEN
        RAISE EXCEPTION 'authenticated SELECT was removed from public.%', v_table;
      END IF;
    ELSIF v_table = 'zltac_registrations' THEN
      IF has_table_privilege(
        'authenticated', 'public.zltac_registrations', 'SELECT'
      ) THEN
        RAISE EXCEPTION 'authenticated retains broad registration SELECT after 60000';
      END IF;
    ELSIF has_any_column_privilege(
      'authenticated', 'public.teams', 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated retains a teams base-table SELECT privilege after 60000';
    END IF;

    IF v_table = 'under_18_approvals'
      AND to_regprocedure(
        'public.committee_create_under_18_approval(uuid,uuid,integer,text,text)'
      ) IS NOT NULL THEN
      IF has_table_privilege(
        'service_role', 'public.under_18_approvals', 'INSERT'
      ) OR has_table_privilege(
        'service_role', 'public.under_18_approvals', 'UPDATE'
      ) OR has_table_privilege(
        'service_role', 'public.under_18_approvals', 'DELETE'
      ) THEN
        RAISE EXCEPTION '55000 RPC cutover still permits direct under-18 writes';
      END IF;
    ELSIF NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'INSERT'
    ) OR NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'UPDATE'
    ) OR NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'DELETE'
    ) THEN
      RAISE EXCEPTION 'service_role writes were removed from public.%', v_table;
    END IF;
  END LOOP;

  IF v_minimization_view IS NOT NULL THEN
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
       ) THEN
      RAISE EXCEPTION '60000 actor-scoped team view is missing or unreadable';
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

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (tablename = 'zltac_registrations' AND policyname IN (
          'zltac_registrations_insert_own',
          'zltac_registrations_update_own',
          'zltac_registrations_delete_own'
        ))
        OR
        (tablename = 'under_18_approvals' AND policyname IN (
          'under_18_approvals_owner_insert',
          'under_18_approvals_owner_update'
        ))
        OR
        (tablename = 'teams' AND policyname IN (
          'teams_captain_insert',
          'teams_captain_update'
        ))
      )
  ) THEN
    RAISE EXCEPTION 'a legacy owner write policy remains after API cutover';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'zltac_registrations'
      AND policyname = 'zltac_registrations_select_own'
      AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'under_18_approvals'
      AND policyname = 'under_18_approvals_select_own'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'an own-row SELECT policy was removed by the cutover';
  END IF;

  IF v_contract_applied THEN
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'teams'
        AND policyname = 'teams_owner_read'
    ) THEN
      RAISE EXCEPTION 'retired teams base-table browser policy remains after 66000';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teams'
      AND policyname = 'teams_owner_read'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'teams own-row SELECT policy is missing before 66000';
  END IF;
END;
$$;
