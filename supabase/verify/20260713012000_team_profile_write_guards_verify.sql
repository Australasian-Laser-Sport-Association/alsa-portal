-- Verify Wave A team and profile write guards.

DO $$
DECLARE
  v_column text;
  v_governance_rpc regprocedure := to_regprocedure(
    'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)'
  );
  v_profile_guard regprocedure := to_regprocedure(
    'public.guard_profile_email_and_dob()'
  );
  v_profile_guard_definition text;
  v_service_profile_mutable constant text[] := ARRAY[
    'first_name', 'last_name', 'alias', 'dob', 'phone', 'state',
    'home_arena', 'emergency_contact_name', 'emergency_contact_phone',
    'alsa_member_id', 'avatar_url', 'placeholder_email', 'email', 'updated_at'
  ]::text[];
BEGIN
  IF v_profile_guard IS NULL THEN
    RAISE EXCEPTION 'profile identity and access-state guard is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name = 'access_revoked_at'
       AND data_type = 'timestamp with time zone'
       AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name = 'access_revoked_by'
       AND data_type = 'uuid'
       AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.profiles'::regclass
       AND constraint_row.contype = 'f'
       AND pg_get_constraintdef(constraint_row.oid) ILIKE
         '%FOREIGN KEY (access_revoked_by) REFERENCES profiles(id) ON DELETE RESTRICT%'
  ) THEN
    RAISE EXCEPTION 'phase-1 profile access-state columns or restrictive actor FK are missing';
  END IF;

  v_profile_guard_definition := pg_get_functiondef(v_profile_guard);
  IF v_profile_guard_definition NOT ILIKE '%NEW.access_revoked_at%'
     OR v_profile_guard_definition NOT ILIKE '%NEW.access_revoked_by%'
     OR v_profile_guard_definition NOT ILIKE '%Profile access state is managed by the server.%'
  THEN
    RAISE EXCEPTION 'phase-1 profile access-state fields are not browser guarded';
  END IF;

  IF v_governance_rpc IS NOT NULL
     AND obj_description(v_governance_rpc::oid, 'pg_proc') IS DISTINCT FROM
       'Service-only profile governance mutation with database authorisation, concurrency guards, and audit attribution.' THEN
    RAISE EXCEPTION 'admin_mutate_profile_access exists without the 61000 governance marker';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'teams'
      AND t.tgname = 'teams_guard_authenticated_control_fields'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'authenticated team-control guard is missing or disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'profiles_guard_identity_insert'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'profiles_guard_identity_update'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'profile identity guard trigger is missing or disabled';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.guard_authenticated_team_control_fields()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.guard_profile_email_and_dob()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'a Wave A trigger function is directly executable by authenticated';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.teams', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.teams', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role team operations were removed';
  END IF;

  IF v_governance_rpc IS NULL THEN
    IF NOT has_table_privilege('service_role', 'public.profiles', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.profiles', 'UPDATE') THEN
      RAISE EXCEPTION 'pre-61000 service_role profile operations were removed';
    END IF;
  ELSE
    IF has_table_privilege('service_role', 'public.profiles', 'INSERT')
       OR has_table_privilege('service_role', 'public.profiles', 'UPDATE')
       OR has_table_privilege('service_role', 'public.profiles', 'TRUNCATE') THEN
      RAISE EXCEPTION 'service_role retains a broad profile mutation privilege after 61000';
    END IF;

    FOREACH v_column IN ARRAY v_service_profile_mutable LOOP
      IF NOT has_column_privilege(
        'service_role', 'public.profiles', v_column, 'UPDATE'
      ) THEN
        RAISE EXCEPTION 'service_role lost safe profile UPDATE column: %', v_column;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
        FROM pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.profiles'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND NOT (attribute.attname = ANY (v_service_profile_mutable))
         AND has_column_privilege(
           'service_role', 'public.profiles', attribute.attname, 'UPDATE'
         )
    ) THEN
      RAISE EXCEPTION 'service_role can UPDATE a non-allow-listed profile column';
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
END;
$$;

-- Preflight inventory. These checks do not disclose email values.
SELECT 'profile_email_mirror_mismatch' AS check_name, count(*) AS row_count
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.email IS DISTINCT FROM u.email
UNION ALL
SELECT 'profile_invalid_dob', count(*)
FROM public.profiles
WHERE dob IS NOT NULL
  AND (dob < DATE '1900-01-01' OR dob > current_date)
UNION ALL
SELECT 'team_invalid_scope', count(*)
FROM public.teams
WHERE (event_id IS NULL) = (competition_id IS NULL);
