DO $$
DECLARE
  v_mutate regprocedure := to_regprocedure(
    'public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'
  );
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_table text;
  v_view text;
  v_bucket record;
  v_relation record;
  v_column record;
  v_role text;
  v_has_maintain constant boolean :=
    current_setting('server_version_num')::integer >= 170000;
  v_anon_reads constant text[] := ARRAY[
    'alsa_membership_periods', 'cms_global', 'document_categories',
    'documents', 'zltac_event_placings',
    'public_competition_roster_safe', 'public_competitions',
    'public_event_roster', 'public_referee_test_settings',
    'public_zltac_dynasties', 'public_zltac_event_history',
    'public_zltac_events', 'public_zltac_hall_of_fame',
    'public_zltac_legends', 'public_zltac_teams',
    'referee_questions_public'
  ]::text[];
  v_server_only constant text[] := ARRAY[
    'admin_asset_upload_audit', 'admin_content_mutation_audit',
    'alsa_lifetime_members', 'alsa_memberships', 'backup_runs',
    'backup_settings', 'competition_managers', 'competitions',
    'payment_mutation_requests', 'payment_records_history',
    'placeholder_merge_audit', 'profile_access_audit',
    'profile_change_audit', 'public_competition_roster',
    'referee_questions', 'referee_test_attempts', 'referee_test_settings',
    'team_members', 'teams', 'volunteer_signup_roles', 'volunteer_signups',
    'zltac_dynasties', 'zltac_event_history', 'zltac_event_lifecycle_audit',
    'zltac_hall_of_fame', 'zltac_legends',
    'zltac_side_event_roster_members', 'zltac_events'
  ]::text[];
  v_service_function text;
  v_policy_drift text;
  v_profile_updates constant text[] := ARRAY[
    'first_name', 'last_name', 'alias', 'dob', 'phone', 'state',
    'home_arena', 'emergency_contact_name', 'emergency_contact_phone'
  ]::text[];
BEGIN
  IF v_mutate IS NULL
     OR obj_description(v_mutate, 'pg_proc') IS DISTINCT FROM v_contract_marker THEN
    RAISE EXCEPTION 'Admin content browser contract marker is missing.';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE')
     OR NOT has_schema_privilege('anon', 'public', 'USAGE')
     OR NOT has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Browser public-schema CREATE/USAGE boundary is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
     WHERE relation_schema.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'A public base or partitioned table has RLS disabled';
  END IF;

  -- Browser roles may read only through separately reviewed grants and may
  -- mutate only the actor-owned profile columns asserted below.
  FOR v_relation IN
    SELECT relation.oid, relation.relname
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
     WHERE relation_schema.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
      IF has_any_column_privilege(v_role, v_relation.oid, 'INSERT')
         OR has_table_privilege(v_role, v_relation.oid, 'DELETE')
         OR has_table_privilege(v_role, v_relation.oid, 'TRUNCATE')
         OR has_any_column_privilege(v_role, v_relation.oid, 'REFERENCES')
         OR has_table_privilege(v_role, v_relation.oid, 'TRIGGER') THEN
        RAISE EXCEPTION
          'Browser role % retains a forbidden privilege on public.%',
          v_role,
          v_relation.relname;
      END IF;

      IF v_has_maintain THEN
        IF has_table_privilege(v_role, v_relation.oid, 'MAINTAIN') THEN
          RAISE EXCEPTION
            'Browser role % retains MAINTAIN on public.%',
            v_role,
            v_relation.relname;
        END IF;
      END IF;

      IF v_role = 'anon'
         AND has_any_column_privilege(v_role, v_relation.oid, 'UPDATE') THEN
        RAISE EXCEPTION 'anon retains UPDATE on public.%', v_relation.relname;
      END IF;

      IF v_role = 'anon'
         AND has_any_column_privilege(v_role, v_relation.oid, 'SELECT')
         AND NOT (v_relation.relname = ANY (v_anon_reads)) THEN
        RAISE EXCEPTION
          'anon retains SELECT outside the reviewed allow-list on public.%',
          v_relation.relname;
      END IF;

      IF v_role = 'authenticated'
         AND v_relation.relname <> 'profiles'
         AND has_any_column_privilege(v_role, v_relation.oid, 'UPDATE') THEN
        RAISE EXCEPTION
          'authenticated retains UPDATE outside profiles on public.%',
          v_relation.relname;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_table IN ARRAY v_anon_reads LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL
       OR NOT has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR NOT has_table_privilege(
         'authenticated', format('public.%I', v_table), 'SELECT'
       ) THEN
      RAISE EXCEPTION 'Reviewed public read surface public.% is unavailable', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated retains broad table-level profile UPDATE';
  END IF;

  FOR v_column IN
    SELECT attribute.attname AS column_name
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = 'public.profiles'::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  LOOP
    IF has_column_privilege(
      'authenticated',
      'public.profiles',
      v_column.column_name,
      'UPDATE'
    ) IS DISTINCT FROM (v_column.column_name = ANY (v_profile_updates)) THEN
      RAISE EXCEPTION
        'Profile UPDATE allow-list mismatch for column %',
        v_column.column_name;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_server_only LOOP
    IF has_any_column_privilege(
      'anon', format('public.%I', v_table), 'SELECT'
    ) OR has_any_column_privilege(
      'authenticated', format('public.%I', v_table), 'SELECT'
    ) THEN
      RAISE EXCEPTION 'Server-only relation public.% remains browser-readable', v_table;
    END IF;
    IF NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'SELECT'
    ) THEN
      RAISE EXCEPTION 'service_role lost SELECT on public.%', v_table;
    END IF;
  END LOOP;

  WITH expected(relation_name) AS (
    VALUES
      ('alsa_membership_periods'),
      ('cms_global'),
      ('competition_registrations'),
      ('document_categories'),
      ('documents'),
      ('doubles_pairs'),
      ('event_volunteer_settings'),
      ('legal_acceptances'),
      ('legal_documents'),
      ('own_zltac_teams'),
      ('payment_records'),
      ('payments'),
      ('profiles'),
      ('public_competition_roster_safe'),
      ('public_competitions'),
      ('public_event_roster'),
      ('public_referee_test_settings'),
      ('public_zltac_dynasties'),
      ('public_zltac_event_history'),
      ('public_zltac_events'),
      ('public_zltac_hall_of_fame'),
      ('public_zltac_legends'),
      ('public_zltac_teams'),
      ('referee_questions_public'),
      ('referee_test_results'),
      ('triples_teams'),
      ('under_18_approvals'),
      ('volunteer_roles'),
      ('zltac_event_placings'),
      ('zltac_registrations')
  ), actual(relation_name) AS (
    SELECT relation.relname
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
     WHERE relation_schema.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_any_column_privilege(
         'authenticated', relation.oid, 'SELECT'
       )
  ), drift(detail) AS (
    SELECT format('unexpected public.%I', actual.relation_name)
      FROM actual
     WHERE NOT EXISTS (
       SELECT 1
         FROM expected
        WHERE expected.relation_name = actual.relation_name
     )
    UNION ALL
    SELECT format('missing public.%I', expected.relation_name)
      FROM expected
     WHERE NOT EXISTS (
       SELECT 1
         FROM actual
        WHERE actual.relation_name = expected.relation_name
     )
  )
  SELECT string_agg(drift.detail, ', ' ORDER BY drift.detail)
    INTO v_policy_drift
    FROM drift;

  IF v_policy_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'Authenticated SELECT relation drift: %',
      v_policy_drift;
  END IF;

  IF EXISTS (
    WITH expected(function_oid) AS (
      VALUES
        (to_regprocedure('public.is_active_user()')),
        (to_regprocedure('public.is_committee()'))
    )
    SELECT 1
      FROM expected
      LEFT JOIN pg_proc AS function_row
        ON function_row.oid = expected.function_oid
      LEFT JOIN pg_roles AS owner_role
        ON owner_role.oid = function_row.proowner
     WHERE function_row.oid IS NULL
        OR obj_description(
          function_row.oid, 'pg_proc'
        ) IS DISTINCT FROM 'SECURITY_HELPER_CONTRACT_V1:' || md5(concat_ws(
          '|',
          pg_get_functiondef(function_row.oid),
          owner_role.rolname
        ))
  ) THEN
    RAISE EXCEPTION 'A sealed browser security helper definition has drifted';
  END IF;

  IF to_regprocedure('public.can_write_team_logo(text)') IS NOT NULL
     OR to_regprocedure('public.can_write_preteam_logo(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'A retired browser Storage authorization helper remains';
  END IF;

  IF has_any_column_privilege(
    'anon', 'public.profile_governance_state', 'SELECT'
  ) OR has_any_column_privilege(
    'authenticated', 'public.profile_governance_state', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Internal profile-governance state is browser-readable';
  END IF;

  FOREACH v_service_function IN ARRAY ARRAY[
    'public.change_profile_alias(uuid,text,text,uuid,text)',
    'public.disband_zltac_team(uuid,uuid,integer)',
    'public.remove_zltac_team_player(uuid,uuid,uuid,integer)',
    'public.recalculate_zltac_amount_owing(uuid)'
  ]::text[] LOOP
    IF to_regprocedure(v_service_function) IS NULL
       OR has_function_privilege('anon', v_service_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_service_function, 'EXECUTE')
       OR NOT has_function_privilege(
         'service_role', v_service_function, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'Service-only function ACL is invalid for %',
        v_service_function;
    END IF;
  END LOOP;

  -- This trigger helper exists only in the production lineage. If present, it
  -- must remain available to service writes without being directly callable
  -- through either browser database role.
  IF to_regprocedure('public.prevent_profile_self_escalation()') IS NOT NULL THEN
    IF has_function_privilege(
         'anon', 'public.prevent_profile_self_escalation()', 'EXECUTE'
       )
       OR has_function_privilege(
         'authenticated',
         'public.prevent_profile_self_escalation()',
         'EXECUTE'
       )
       OR NOT has_function_privilege(
         'service_role',
         'public.prevent_profile_self_escalation()',
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'Legacy profile self-escalation trigger function ACL is invalid';
    END IF;
  END IF;

  WITH expected(
    function_name, identity_args, anon_execute, auth_execute, service_execute
  ) AS (
    VALUES
      ('is_active_user', '', false, true, true),
      ('is_committee', '', true, true, true)
  ), actual(
    function_name, identity_args, anon_execute, auth_execute, service_execute
  ) AS (
    SELECT
      function_row.proname,
      pg_catalog.oidvectortypes(function_row.proargtypes),
      has_function_privilege('anon', function_row.oid, 'EXECUTE'),
      has_function_privilege('authenticated', function_row.oid, 'EXECUTE'),
      has_function_privilege('service_role', function_row.oid, 'EXECUTE')
      FROM pg_proc AS function_row
      JOIN pg_namespace AS function_schema
        ON function_schema.oid = function_row.pronamespace
     WHERE function_schema.nspname = 'public'
       AND function_row.prosecdef
       AND (
         has_function_privilege('anon', function_row.oid, 'EXECUTE')
         OR has_function_privilege(
           'authenticated', function_row.oid, 'EXECUTE'
         )
       )
  ), drift(detail) AS (
    SELECT format(
      'unexpected public.%I(%s) anon=%s authenticated=%s service=%s',
      actual.function_name,
      actual.identity_args,
      actual.anon_execute,
      actual.auth_execute,
      actual.service_execute
    )
      FROM actual
     WHERE NOT EXISTS (
       SELECT 1
         FROM expected
        WHERE expected.function_name = actual.function_name
          AND expected.identity_args = actual.identity_args
          AND expected.anon_execute = actual.anon_execute
          AND expected.auth_execute = actual.auth_execute
          AND expected.service_execute = actual.service_execute
     )
    UNION ALL
    SELECT format(
      'missing public.%I(%s) anon=%s authenticated=%s service=%s',
      expected.function_name,
      expected.identity_args,
      expected.anon_execute,
      expected.auth_execute,
      expected.service_execute
    )
      FROM expected
     WHERE NOT EXISTS (
       SELECT 1
         FROM actual
        WHERE actual.function_name = expected.function_name
          AND actual.identity_args = expected.identity_args
          AND actual.anon_execute = expected.anon_execute
          AND actual.auth_execute = expected.auth_execute
          AND actual.service_execute = expected.service_execute
     )
  )
  SELECT string_agg(drift.detail, ', ' ORDER BY drift.detail)
    INTO v_policy_drift
    FROM drift;

  IF v_policy_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'Browser SECURITY DEFINER function drift: %',
      v_policy_drift;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policy AS policy
      JOIN pg_class AS relation ON relation.oid = policy.polrelid
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
      JOIN pg_depend AS dependency
        ON dependency.classid = 'pg_policy'::regclass
       AND dependency.objid = policy.oid
       AND dependency.refclassid = 'pg_proc'::regclass
      JOIN pg_proc AS function_row ON function_row.oid = dependency.refobjid
      JOIN pg_namespace AS function_schema
        ON function_schema.oid = function_row.pronamespace
     WHERE relation_schema.nspname = 'public'
       AND function_schema.nspname = 'public'
       AND function_row.proname IN (
         'is_committee', 'is_superadmin', 'is_competition_manager',
         'can_read_team_members'
       )
  ) THEN
    RAISE EXCEPTION 'A public browser policy still depends on a privileged helper';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.permissive = 'PERMISSIVE'
       AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
       AND NOT (
         policy.tablename = 'profiles'
         AND policy.policyname = 'profiles_update_own'
         AND policy.cmd = 'UPDATE'
       )
  ) THEN
    RAISE EXCEPTION 'A permissive browser DML policy remains outside own-profile UPDATE';
  END IF;

  WITH expected(table_name, policy_name) AS (
    VALUES
      ('alsa_membership_periods', 'alsa_membership_periods_public_read'),
      ('cms_global', 'cms_global_public_read'),
      ('competition_registrations', 'competition_registrations_self_read'),
      ('document_categories', 'document_categories_public_read'),
      ('documents', 'documents_public_read'),
      ('doubles_pairs', 'doubles_pairs_own'),
      ('event_volunteer_settings', 'event_volunteer_settings_authenticated_read'),
      ('legal_acceptances', 'legal_acceptances_select_own'),
      ('legal_documents', 'legal_documents_acceptance_owner_read'),
      ('legal_documents', 'legal_documents_public_read'),
      ('payment_records', 'payment_records_competition_own_read'),
      ('payment_records', 'payment_records_own_read'),
      ('payments', 'payments_own_read'),
      ('profiles', 'profiles_select_own'),
      ('referee_test_results', 'referee_test_results_self_read'),
      ('triples_teams', 'triples_teams_own'),
      ('under_18_approvals', 'under_18_approvals_select_own'),
      ('volunteer_roles', 'volunteer_roles_authenticated_read'),
      ('zltac_event_placings', 'zltac_event_placings_public_read'),
      ('zltac_registrations', 'zltac_registrations_select_own')
  ), actual(table_name, policy_name) AS (
    SELECT policy.tablename, policy.policyname
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.permissive = 'PERMISSIVE'
       AND policy.cmd = 'SELECT'
       AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ), drift(detail) AS (
    SELECT format('unexpected public.%I.%I', actual.table_name, actual.policy_name)
      FROM actual
     WHERE NOT EXISTS (
       SELECT 1
         FROM expected
        WHERE expected.table_name = actual.table_name
          AND expected.policy_name = actual.policy_name
     )
    UNION ALL
    SELECT format('missing public.%I.%I', expected.table_name, expected.policy_name)
      FROM expected
     WHERE NOT EXISTS (
       SELECT 1
         FROM actual
        WHERE actual.table_name = expected.table_name
          AND actual.policy_name = expected.policy_name
     )
  )
  SELECT string_agg(drift.detail, ', ' ORDER BY drift.detail)
    INTO v_policy_drift
    FROM drift;

  IF v_policy_drift IS NOT NULL THEN
    RAISE EXCEPTION 'Permissive browser SELECT policy drift: %', v_policy_drift;
  END IF;

  IF EXISTS (
    WITH expected(table_name, policy_name) AS (
      VALUES
        ('alsa_membership_periods', 'alsa_membership_periods_public_read'),
        ('cms_global', 'cms_global_public_read'),
        ('competition_registrations', 'competition_registrations_self_read'),
        ('document_categories', 'document_categories_public_read'),
        ('documents', 'documents_public_read'),
        ('doubles_pairs', 'doubles_pairs_own'),
        ('event_volunteer_settings', 'event_volunteer_settings_authenticated_read'),
        ('legal_acceptances', 'legal_acceptances_select_own'),
        ('legal_documents', 'legal_documents_acceptance_owner_read'),
        ('legal_documents', 'legal_documents_public_read'),
        ('payment_records', 'payment_records_competition_own_read'),
        ('payment_records', 'payment_records_own_read'),
        ('payments', 'payments_own_read'),
        ('profiles', 'active_user_update'),
        ('profiles', 'profiles_select_own'),
        ('profiles', 'profiles_update_own'),
        ('referee_test_results', 'referee_test_results_self_read'),
        ('triples_teams', 'triples_teams_own'),
        ('under_18_approvals', 'under_18_approvals_select_own'),
        ('volunteer_roles', 'volunteer_roles_authenticated_read'),
        ('zltac_event_placings', 'zltac_event_placings_public_read'),
        ('zltac_registrations', 'zltac_registrations_select_own')
    )
    SELECT 1
      FROM expected
      LEFT JOIN pg_policies AS policy
        ON policy.schemaname = 'public'
       AND policy.tablename = expected.table_name
       AND policy.policyname = expected.policy_name
      LEFT JOIN pg_class AS relation
        ON relation.oid = format(
          'public.%I', expected.table_name
        )::regclass
      LEFT JOIN pg_policy AS catalog_policy
        ON catalog_policy.polrelid = relation.oid
       AND catalog_policy.polname = expected.policy_name
     WHERE policy.policyname IS NULL
        OR obj_description(
          catalog_policy.oid, 'pg_policy'
        ) IS DISTINCT FROM 'BROWSER_POLICY_CONTRACT_V1:' || md5(concat_ws(
          '|',
          policy.schemaname,
          policy.tablename,
          policy.policyname,
          policy.permissive,
          policy.roles::text,
          policy.cmd,
          coalesce(policy.qual, ''),
          coalesce(policy.with_check, '')
        ))
  ) THEN
    RAISE EXCEPTION 'A sealed public browser policy signature has drifted';
  END IF;

  IF to_regprocedure('public.can_read_team_members(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Retired cross-user team-member helper remains executable';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS sequence_row
      JOIN pg_namespace AS sequence_schema
        ON sequence_schema.oid = sequence_row.relnamespace
     WHERE sequence_schema.nspname = 'public'
       AND sequence_row.relkind = 'S'
       AND (
         has_sequence_privilege('anon', sequence_row.oid, 'USAGE')
         OR has_sequence_privilege('anon', sequence_row.oid, 'SELECT')
         OR has_sequence_privilege('anon', sequence_row.oid, 'UPDATE')
         OR has_sequence_privilege('authenticated', sequence_row.oid, 'USAGE')
         OR has_sequence_privilege('authenticated', sequence_row.oid, 'SELECT')
         OR has_sequence_privilege('authenticated', sequence_row.oid, 'UPDATE')
       )
  ) THEN
    RAISE EXCEPTION 'A public sequence remains accessible to a browser role';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_default_acl AS default_acl
      JOIN pg_roles AS owner_role ON owner_role.oid = default_acl.defaclrole
      LEFT JOIN pg_namespace AS default_schema
        ON default_schema.oid = default_acl.defaclnamespace
      CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl
      LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
     WHERE (
         default_acl.defaclnamespace = 0
         OR default_schema.nspname = 'public'
       )
       AND owner_role.rolname = 'postgres'
       AND coalesce(grantee_role.rolname, 'PUBLIC') IN (
         'PUBLIC', 'anon', 'authenticated'
       )
  ) THEN
    RAISE EXCEPTION 'Public-schema default privileges still grant browser access';
  END IF;

  -- Supabase's migration role cannot alter the superuser-owned platform
  -- defaults. Keep those defaults outside the application trust boundary by
  -- proving that the platform role owns no current public relations or
  -- functions.
  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
      JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
     WHERE relation_schema.nspname = 'public'
       AND owner_role.rolname = 'supabase_admin'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ) OR EXISTS (
    SELECT 1
      FROM pg_proc AS function_row
      JOIN pg_namespace AS function_schema
        ON function_schema.oid = function_row.pronamespace
      JOIN pg_roles AS owner_role ON owner_role.oid = function_row.proowner
     WHERE function_schema.nspname = 'public'
       AND owner_role.rolname = 'supabase_admin'
  ) THEN
    RAISE EXCEPTION 'supabase_admin owns an object inside the public application schema';
  END IF;

  -- Storage relations and their ACLs are owned by Supabase's platform role,
  -- not by the application migration role. Verify the enforceable boundary:
  -- RLS remains enabled and the platform owner remains intact; reviewed policy
  -- assertions below prove the legacy privileged write paths are absent.
  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
      JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
     WHERE relation_schema.nspname = 'storage'
       AND relation.relname IN ('buckets', 'objects')
       AND (
         owner_role.rolname <> 'supabase_storage_admin'
         OR NOT relation.relrowsecurity
       )
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
     WHERE relation_schema.nspname = 'storage'
       AND relation.relname IN ('buckets', 'objects')
  ) <> 2 THEN
    RAISE EXCEPTION 'Supabase Storage ownership or RLS boundary is invalid';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'document_categories',
    'documents',
    'cms_global',
    'referee_questions',
    'referee_test_settings',
    'zltac_event_history',
    'zltac_event_placings',
    'zltac_legends',
    'zltac_dynasties',
    'zltac_hall_of_fame'
  ] LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'Browser mutation privilege remains on public.%', v_table;
    END IF;
  END LOOP;

  IF has_any_column_privilege(
    'anon', 'public.legal_documents', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Anonymous users can bypass filtered legal-document delivery';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'referee_questions',
    'referee_test_settings',
    'zltac_event_history',
    'zltac_legends',
    'zltac_dynasties',
    'zltac_hall_of_fame'
  ] LOOP
    IF has_any_column_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_any_column_privilege(
         'authenticated', format('public.%I', v_table), 'SELECT'
       ) THEN
      RAISE EXCEPTION 'Sensitive browser base-table SELECT remains on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_view IN ARRAY ARRAY[
    'referee_questions_public',
    'public_referee_test_settings',
    'public_zltac_event_history',
    'public_zltac_legends',
    'public_zltac_dynasties',
    'public_zltac_hall_of_fame'
  ] LOOP
    IF to_regclass(format('public.%I', v_view)) IS NULL
       OR NOT has_table_privilege('anon', format('public.%I', v_view), 'SELECT')
       OR NOT has_table_privilege('authenticated', format('public.%I', v_view), 'SELECT') THEN
      RAISE EXCEPTION 'Browser-safe replacement view % is unavailable.', v_view;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'referee_questions_public'
       AND column_name = 'correct_answer'
  ) OR EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_zltac_event_history'
       AND column_name = 'internal_notes'
  ) THEN
    RAISE EXCEPTION 'A browser-safe replacement view exposes a protected column.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'storage'
       AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'A browser Storage metadata policy remains';
  END IF;

  FOR v_bucket IN
    SELECT id, public, file_size_limit, allowed_mime_types
     FROM storage.buckets
     WHERE id IN (
       'avatars', 'team-logos', 'event-logos', 'event-photos', 'event-covers',
       'referee-test-media', 'competition-banners'
     )
  LOOP
    IF v_bucket.public IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Public asset bucket % is not public.', v_bucket.id;
    END IF;
    IF v_bucket.file_size_limit IS DISTINCT FROM (CASE v_bucket.id
      WHEN 'avatars' THEN 2097152
      WHEN 'team-logos' THEN 2097152
      WHEN 'event-logos' THEN 2097152
      WHEN 'referee-test-media' THEN 26214400
      ELSE 5242880
    END)::bigint THEN
      RAISE EXCEPTION 'Public asset bucket % has the wrong size cap.', v_bucket.id;
    END IF;
    IF v_bucket.allowed_mime_types IS DISTINCT FROM (CASE v_bucket.id
      WHEN 'referee-test-media' THEN
        ARRAY['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
      ELSE ARRAY['image/png','image/jpeg','image/webp']::text[]
    END) THEN
      RAISE EXCEPTION 'Public asset bucket % has the wrong MIME allowlist.', v_bucket.id;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
     FROM storage.buckets
     WHERE id IN (
       'avatars', 'team-logos', 'event-logos', 'event-photos', 'event-covers',
       'referee-test-media', 'competition-banners'
     )
  ) <> 7 THEN
    RAISE EXCEPTION 'One or more required public asset buckets are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM storage.buckets
     WHERE id = 'legal-documents'
       AND public = false
       AND file_size_limit = 4194304
       AND allowed_mime_types = ARRAY['application/pdf']::text[]
  ) OR NOT EXISTS (
    SELECT 1
      FROM storage.buckets
     WHERE id = 'portal-backups'
       AND public = false
       AND file_size_limit = 26214400
       AND allowed_mime_types = ARRAY[
         'text/csv', 'application/json'
       ]::text[]
  ) THEN
    RAISE EXCEPTION 'A private Storage bucket contract has drifted.';
  END IF;

  IF to_regclass('public.admin_asset_upload_audit') IS NULL THEN
    RAISE EXCEPTION 'Admin asset upload audit evidence table is missing.';
  END IF;

  -- Disposable replay databases intentionally contain no profiles. A live
  -- environment must retain finalized evidence for every contracted upload
  -- purpose, matching the irreversible migration precondition.
  IF EXISTS (SELECT 1 FROM public.profiles)
     AND (
       SELECT pg_catalog.count(DISTINCT purpose)
         FROM public.admin_asset_upload_audit
        WHERE purpose IN (
          'event-logo', 'event-photo', 'event-cover',
          'history-logo', 'history-photo',
          'referee-image', 'referee-video', 'competition-banner'
        )
     ) <> 8 THEN
    RAISE EXCEPTION 'Finalized signed-upload evidence is incomplete.';
  END IF;
END;
$$;
