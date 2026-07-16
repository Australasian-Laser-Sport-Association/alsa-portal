DO $$
DECLARE
  v_required constant text[] := ARRAY[
    'id',
    'first_name',
    'last_name',
    'alias',
    'dob',
    'phone',
    'state',
    'home_arena',
    'emergency_contact_name',
    'emergency_contact_phone',
    'avatar_url',
    'roles',
    'suspended',
    'created_at'
  ]::text[];
  v_forbidden constant text[] := ARRAY[
    'email',
    'alsa_member_id',
    'alsa_position',
    'is_placeholder',
    'created_by_admin_id',
    'placeholder_email',
    'updated_at'
  ]::text[];
  v_mutable constant text[] := ARRAY[
    'first_name',
    'last_name',
    'alias',
    'dob',
    'phone',
    'state',
    'home_arena',
    'emergency_contact_name',
    'emergency_contact_phone'
  ]::text[];
  v_server_managed constant text[] := ARRAY[
    'id',
    'email',
    'roles',
    'suspended',
    'alsa_member_id',
    'alsa_position',
    'avatar_url',
    'is_placeholder',
    'created_by_admin_id',
    'placeholder_email',
    'created_at',
    'updated_at'
  ]::text[];
  v_service_mutable constant text[] := ARRAY[
    'first_name',
    'last_name',
    'alias',
    'dob',
    'phone',
    'state',
    'home_arena',
    'emergency_contact_name',
    'emergency_contact_phone',
    'alsa_member_id',
    'avatar_url',
    'placeholder_email',
    'email',
    'updated_at'
  ]::text[];
  v_governance_rpc regprocedure := to_regprocedure(
    'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)'
  );
  v_column text;
BEGIN
  IF v_governance_rpc IS NOT NULL
     AND obj_description(v_governance_rpc::oid, 'pg_proc') IS DISTINCT FROM
       'Service-only profile governance mutation with database authorisation, concurrency guards, and audit attribution.' THEN
    RAISE EXCEPTION 'admin_mutate_profile_access exists without the 61000 governance marker';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION
      'authenticated still has table-level SELECT on public.profiles';
  END IF;

  IF has_any_column_privilege('anon', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION
      'anon unexpectedly has a profile column SELECT privilege';
  END IF;

  FOREACH v_column IN ARRAY v_required LOOP
    IF NOT has_column_privilege(
      'authenticated', 'public.profiles', v_column, 'SELECT'
    ) THEN
      RAISE EXCEPTION
        'authenticated is missing required profile column SELECT: %',
        v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY v_forbidden LOOP
    IF has_column_privilege(
      'authenticated', 'public.profiles', v_column, 'SELECT'
    ) THEN
      RAISE EXCEPTION
        'authenticated can still SELECT protected profile column: %',
        v_column;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION
      'authenticated still has table-level UPDATE on public.profiles';
  END IF;

  FOREACH v_column IN ARRAY v_mutable LOOP
    IF NOT has_column_privilege(
      'authenticated', 'public.profiles', v_column, 'UPDATE'
    ) THEN
      RAISE EXCEPTION
        'authenticated is missing required profile column UPDATE: %',
        v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY v_server_managed LOOP
    IF has_column_privilege(
      'authenticated', 'public.profiles', v_column, 'UPDATE'
    ) THEN
      RAISE EXCEPTION
        'authenticated can still UPDATE server-managed profile column: %',
        v_column;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION
      'service_role lost profile SELECT required by vetted server APIs';
  END IF;

  IF v_governance_rpc IS NULL THEN
    IF NOT has_table_privilege('service_role', 'public.profiles', 'UPDATE') THEN
      RAISE EXCEPTION
        'service_role lost profile UPDATE required by pre-61000 server APIs';
    END IF;
  ELSE
    IF has_table_privilege('service_role', 'public.profiles', 'INSERT')
       OR has_table_privilege('service_role', 'public.profiles', 'UPDATE')
       OR has_table_privilege('service_role', 'public.profiles', 'TRUNCATE') THEN
      RAISE EXCEPTION
        'service_role retains a broad profile mutation privilege after 61000';
    END IF;

    FOREACH v_column IN ARRAY v_service_mutable LOOP
      IF NOT has_column_privilege(
        'service_role', 'public.profiles', v_column, 'UPDATE'
      ) THEN
        RAISE EXCEPTION
          'service_role lost safe profile UPDATE column: %',
          v_column;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
        FROM pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.profiles'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND NOT (attribute.attname = ANY (v_service_mutable))
         AND has_column_privilege(
           'service_role', 'public.profiles', attribute.attname, 'UPDATE'
         )
    ) THEN
      RAISE EXCEPTION
        'service_role can UPDATE a non-allow-listed profile column';
    END IF;

    IF has_function_privilege('anon', v_governance_rpc, 'EXECUTE')
       OR has_function_privilege('authenticated', v_governance_rpc, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_governance_rpc, 'EXECUTE')
       OR EXISTS (
         SELECT 1
           FROM pg_proc AS function_row,
                aclexplode(coalesce(
                  function_row.proacl,
                  acldefault('f', function_row.proowner)
                )) AS privilege
          WHERE function_row.oid = v_governance_rpc
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
       )
       OR NOT EXISTS (
         SELECT 1
           FROM pg_proc AS function_row
          WHERE function_row.oid = v_governance_rpc
            AND function_row.prosecdef
            AND function_row.proconfig @> ARRAY[
              'search_path=pg_catalog, public'
            ]::text[]
       ) THEN
      RAISE EXCEPTION '61000 profile governance RPC boundary is unsafe';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND policyname IN (
         'profiles_update_committee',
         'profiles_update_superadmin'
       )
  ) THEN
    RAISE EXCEPTION
      'committee browser profile-write policies must remain removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND policyname = 'profiles_update_own'
       AND coalesce(qual, '') = '(id = auth.uid())'
       AND coalesce(with_check, '') = '(id = auth.uid())'
  ) THEN
    RAISE EXCEPTION
      'profiles_update_own is missing or broader than the own-row boundary';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS c
     WHERE c.oid = 'public.profiles'::regclass
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'public.profiles must retain RLS';
  END IF;
END;
$$;
