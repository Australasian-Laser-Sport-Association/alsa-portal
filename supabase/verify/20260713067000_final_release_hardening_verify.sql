DO $$
DECLARE
  v_function regprocedure;
  v_table text;
  v_has_maintain boolean;
BEGIN
  IF to_regclass('public.referee_questions_public') IS NOT NULL THEN
    RAISE EXCEPTION 'The obsolete public referee-question view still exists.';
  END IF;

  IF to_regclass('public.own_zltac_teams') IS NULL
     OR NOT has_table_privilege(
       'authenticated', 'public.own_zltac_teams', 'SELECT'
     )
     OR has_table_privilege('anon', 'public.own_zltac_teams', 'SELECT')
     OR pg_get_viewdef('public.own_zltac_teams'::regclass, true)
        NOT ILIKE '%is_active_user()%'
     OR NOT EXISTS (
       SELECT 1
         FROM pg_class AS relation
        WHERE relation.oid = 'public.own_zltac_teams'::regclass
          AND relation.reloptions @> ARRAY[
            'security_barrier=true', 'security_invoker=false'
          ]::text[]
     ) THEN
    RAISE EXCEPTION 'The actor-scoped team view is not active-account gated.';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.is_active_user()'::regprocedure,
    'public.is_committee()'::regprocedure
  ] LOOP
    IF pg_get_functiondef(v_function) NOT ILIKE '%access_revoked_at IS NULL%'
       OR obj_description(v_function, 'pg_proc') IS DISTINCT FROM
          'SECURITY_HELPER_CONTRACT_V1:' || md5(concat_ws(
            '|',
            pg_get_functiondef(v_function),
            (
              SELECT owner_role.rolname
                FROM pg_proc AS function_row
                JOIN pg_roles AS owner_role
                  ON owner_role.oid = function_row.proowner
               WHERE function_row.oid = v_function
            )
          )) THEN
      RAISE EXCEPTION 'Active-account helper % is not sealed correctly.', v_function;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.touch_updated_at()'::regprocedure,
    'public.set_competition_payment_reference()'::regprocedure,
    'public.set_competition_amount_owing()'::regprocedure,
    'public.protect_competition_registration_fields()'::regprocedure,
    'public.generate_competition_payment_reference(uuid,text,uuid)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc AS function_row
       WHERE function_row.oid = v_function
         AND EXISTS (
           SELECT 1
             FROM unnest(function_row.proconfig) AS setting(value)
            WHERE setting.value IN ('search_path=', 'search_path=""')
         )
    ) THEN
      RAISE EXCEPTION 'Function % does not have an empty search path.', v_function;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
       'service_role', 'public.payment_mutation_requests', 'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role', 'public.payment_mutation_requests', 'INSERT'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_mutation_requests', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_mutation_requests', 'DELETE'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_mutation_requests', 'TRUNCATE'
     )
     OR has_any_column_privilege(
       'service_role', 'public.payment_mutation_requests', 'UPDATE'
     )
     OR has_any_column_privilege(
       'service_role', 'public.payment_mutation_requests', 'REFERENCES'
     )
     OR NOT has_table_privilege(
       'service_role', 'public.payment_records_history', 'SELECT'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_records_history', 'INSERT'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_records_history', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_records_history', 'DELETE'
     )
     OR has_table_privilege(
       'service_role', 'public.payment_records_history', 'TRUNCATE'
     )
     OR has_any_column_privilege(
       'service_role', 'public.payment_records_history', 'INSERT'
     )
     OR has_any_column_privilege(
       'service_role', 'public.payment_records_history', 'UPDATE'
     )
     OR has_any_column_privilege(
       'service_role', 'public.payment_records_history', 'REFERENCES'
     )
     OR NOT has_table_privilege(
       'service_role', 'public.profile_change_audit', 'SELECT'
     )
     OR has_table_privilege(
       'service_role', 'public.profile_change_audit', 'INSERT'
     )
     OR has_table_privilege(
       'service_role', 'public.profile_change_audit', 'UPDATE'
     )
     OR has_table_privilege(
       'service_role', 'public.profile_change_audit', 'DELETE'
     )
     OR has_table_privilege(
       'service_role', 'public.profile_change_audit', 'TRUNCATE'
     )
     OR has_any_column_privilege(
       'service_role', 'public.profile_change_audit', 'INSERT'
     )
     OR has_any_column_privilege(
       'service_role', 'public.profile_change_audit', 'UPDATE'
     )
     OR has_any_column_privilege(
       'service_role', 'public.profile_change_audit', 'REFERENCES'
     ) THEN
    RAISE EXCEPTION 'Service-role audit/receipt grants exceed the reviewed contract.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('payment_mutation_requests'),
        ('payment_records_history'),
        ('profile_change_audit')
      ) AS protected_table(name)
     WHERE has_table_privilege(
             'service_role', format('public.%I', protected_table.name), 'REFERENCES'
           )
        OR has_table_privilege(
             'service_role', format('public.%I', protected_table.name), 'TRIGGER'
           )
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute AS attribute
      CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
      JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
     WHERE attribute.attrelid IN (
       'public.payment_mutation_requests'::regclass,
       'public.payment_records_history'::regclass,
       'public.profile_change_audit'::regclass
     )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND grantee_role.rolname = 'service_role'
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'Service-role column or extended table grants exceed the reviewed contract.';
  END IF;

  IF current_setting('server_version_num')::integer >= 170000 THEN
    FOREACH v_table IN ARRAY ARRAY[
      'payment_mutation_requests',
      'payment_records_history',
      'profile_change_audit'
    ]::text[] LOOP
      EXECUTE format(
        'SELECT has_table_privilege(''service_role'', %L, ''MAINTAIN'')',
        format('public.%I', v_table)
      ) INTO v_has_maintain;
      IF v_has_maintain THEN
        RAISE EXCEPTION 'service_role retains MAINTAIN on public.%', v_table;
      END IF;
    END LOOP;
  END IF;
END;
$$;
