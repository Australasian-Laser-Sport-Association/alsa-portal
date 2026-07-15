-- Read-only verification for active-account Storage writes and legacy payment
-- browser-write retirement.

DO $$
DECLARE
  v_helper regprocedure;
  v_helper_definition text;
  v_policy_name text;
  v_policy record;
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_contract_applied boolean := coalesce(
    obj_description(
      to_regprocedure('public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'),
      'pg_proc'
    ) = v_contract_marker,
    false
  );
BEGIN
  IF to_regprocedure('public.is_active_user()') IS NULL THEN
    RAISE EXCEPTION 'public.is_active_user() is missing';
  END IF;

  IF v_contract_applied THEN
    IF to_regprocedure('public.can_write_team_logo(text)') IS NOT NULL
       OR to_regprocedure('public.can_write_preteam_logo(text,text)') IS NOT NULL THEN
      RAISE EXCEPTION 'a retired browser Storage write helper remains after the final contract';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_policies AS policy
       WHERE policy.schemaname = 'storage'
         AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
    ) THEN
      RAISE EXCEPTION 'a browser-executable Storage policy remains after the final contract';
    END IF;
  ELSE
    v_helper := to_regprocedure('public.can_write_team_logo(text)');
    IF v_helper IS NULL THEN
      RAISE EXCEPTION 'public.can_write_team_logo(text) is missing';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS function_row
      WHERE function_row.oid = v_helper
        AND function_row.prosecdef
        AND function_row.provolatile = 's'
        AND function_row.proowner = (
          SELECT role_row.oid
          FROM pg_roles AS role_row
          WHERE role_row.rolname = 'postgres'
        )
        AND EXISTS (
          SELECT 1
          FROM unnest(function_row.proconfig) AS setting(value)
          WHERE setting.value IN ('search_path=', 'search_path=""')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(
            coalesce(
              function_row.proacl,
              acldefault('f', function_row.proowner)
            )
          ) AS acl
          LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
          WHERE acl.privilege_type = 'EXECUTE'
            AND coalesce(grantee_role.rolname, 'PUBLIC') NOT IN (
              'postgres',
              'authenticated',
              'service_role'
            )
        )
        AND (
          SELECT count(*)
          FROM aclexplode(
            coalesce(
              function_row.proacl,
              acldefault('f', function_row.proowner)
            )
          ) AS acl
          JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
          WHERE acl.privilege_type = 'EXECUTE'
            AND NOT acl.is_grantable
            AND grantee_role.rolname IN ('authenticated', 'service_role')
        ) = 2
    ) THEN
      RAISE EXCEPTION
        'can_write_team_logo must have the trusted owner, exact ACL, and pinned SECURITY DEFINER configuration';
    END IF;

    IF has_function_privilege('anon', v_helper, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_helper, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_helper, 'EXECUTE') THEN
      RAISE EXCEPTION 'can_write_team_logo has unsafe EXECUTE privileges';
    END IF;

    v_helper_definition := pg_get_functiondef(v_helper);
    IF v_helper_definition NOT ILIKE '%public.is_active_user()%'
       OR v_helper_definition NOT ILIKE '%pg_input_is_valid%'
       OR v_helper_definition NOT ILIKE '%p_folder::pg_catalog.uuid%'
       OR v_helper_definition NOT ILIKE '%team.id = v_team_id%'
       OR v_helper_definition NOT ILIKE '%team.captain_id = v_actor_id%' THEN
      RAISE EXCEPTION
        'can_write_team_logo lacks active-user, safe UUID, or actor-bound ownership checks';
    END IF;

    FOREACH v_policy_name IN ARRAY ARRAY[
      'avatars_owner_write',
      'team_logos_owner_write',
      'team_logos_captain_team_write'
    ] LOOP
      SELECT policy.*
        INTO v_policy
        FROM pg_policies AS policy
       WHERE policy.schemaname = 'storage'
         AND policy.tablename = 'objects'
         AND policy.policyname = v_policy_name;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'storage policy % is missing', v_policy_name;
      END IF;
      IF v_policy.cmd <> 'ALL'
         OR NOT (v_policy.roles @> ARRAY['authenticated']::name[])
         OR coalesce(v_policy.qual, '') NOT LIKE '%is_active_user%'
         OR coalesce(v_policy.with_check, '') NOT LIKE '%is_active_user%' THEN
        RAISE EXCEPTION
          'storage policy % does not require an active authenticated user for every write path',
          v_policy_name;
      END IF;

      IF v_policy_name = 'team_logos_captain_team_write'
         AND (
           coalesce(v_policy.qual, '') NOT LIKE '%can_write_team_logo%'
           OR coalesce(v_policy.with_check, '') NOT LIKE '%can_write_team_logo%'
         ) THEN
        RAISE EXCEPTION
          'team_logos_captain_team_write does not use the private-table helper';
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'storage'
        AND policy.tablename = 'objects'
        AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
        AND policy.roles && ARRAY['public', 'authenticated']::name[]
        AND (
          coalesce(policy.qual, '') LIKE '%avatars%'
          OR coalesce(policy.qual, '') LIKE '%team-logos%'
          OR coalesce(policy.with_check, '') LIKE '%avatars%'
          OR coalesce(policy.with_check, '') LIKE '%team-logos%'
        )
        AND (
          (policy.cmd IN ('ALL', 'UPDATE', 'DELETE')
            AND coalesce(policy.qual, '') NOT LIKE '%is_active_user%')
          OR (policy.cmd IN ('ALL', 'INSERT', 'UPDATE')
            AND coalesce(policy.with_check, '') NOT LIKE '%is_active_user%')
        )
    ) THEN
      RAISE EXCEPTION 'an avatar/team-logo browser write policy lacks the active-user guard';
    END IF;
  END IF;

  IF has_table_privilege('authenticated', 'public.payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payments', 'DELETE')
     OR has_any_column_privilege('authenticated', 'public.payments', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.payments', 'UPDATE')
     OR EXISTS (
       WITH table_dml_grantees AS (
         SELECT relation.relowner, acl.grantee
         FROM pg_class AS relation
         CROSS JOIN LATERAL aclexplode(
           coalesce(relation.relacl, acldefault('r', relation.relowner))
         ) AS acl
         WHERE relation.oid = 'public.payments'::regclass
           AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
       ),
       column_dml_grantees AS (
         SELECT relation.relowner, acl.grantee
         FROM pg_class AS relation
         JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
         CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
         WHERE relation.oid = 'public.payments'::regclass
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND acl.privilege_type IN ('INSERT', 'UPDATE')
       )
       SELECT 1
       FROM (
         SELECT relowner, grantee FROM table_dml_grantees
         UNION
         SELECT relowner, grantee FROM column_dml_grantees
       ) AS direct_grant
       LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = direct_grant.grantee
       WHERE direct_grant.grantee <> direct_grant.relowner
         AND coalesce(grantee_role.rolname, 'PUBLIC') <> 'service_role'
     ) THEN
    RAISE EXCEPTION 'a non-owner/non-service role retains DML privileges on public.payments';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'payments'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'a permissive browser-write policy remains on public.payments';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.payments', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated owner reads on public.payments were not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'payments'
      AND policy.policyname = 'payments_own_read'
      AND policy.cmd = 'SELECT'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.roles @> ARRAY['authenticated']::name[]
      AND regexp_replace(
        coalesce(policy.qual, ''),
        '[[:space:]]+',
        '',
        'g'
      ) = '(user_id=(SELECTauth.uid()ASuid))'
      AND policy.with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'the exact owner-scoped payments read policy is missing';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.payments', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.payments', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.payments', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.payments', 'DELETE') THEN
    RAISE EXCEPTION 'service_role payment access is incomplete';
  END IF;
END;
$$;
