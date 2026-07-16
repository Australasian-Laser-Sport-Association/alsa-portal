-- Close the remaining low-risk release gaps after the final browser contract.
-- This migration is deliberately additive to the applied 66000 contract.

BEGIN;

-- Permanent access revocation is a first-class account state. Suspension is
-- currently required alongside revocation, but checking both fields keeps the
-- database authorization contract correct even if that lifecycle changes.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND suspended = false
      AND access_revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_committee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND suspended = false
      AND access_revoked_at IS NULL
      AND roles && ARRAY[
        'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
      ]::text[]
  );
$$;

ALTER FUNCTION public.is_active_user() OWNER TO postgres;
ALTER FUNCTION public.is_committee() OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION
  public.is_active_user(),
  public.is_committee()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_active_user()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_committee()
  TO anon, authenticated, service_role;

-- Refresh the tamper-evident helper signatures after changing their bodies.
DO $$
DECLARE
  v_function record;
  v_signature text;
  v_sealed integer := 0;
BEGIN
  FOR v_function IN
    SELECT function_row.oid, owner_role.rolname AS owner_name
      FROM pg_proc AS function_row
      JOIN pg_roles AS owner_role
        ON owner_role.oid = function_row.proowner
     WHERE function_row.oid IN (
       'public.is_active_user()'::regprocedure,
       'public.is_committee()'::regprocedure
     )
  LOOP
    v_signature := 'SECURITY_HELPER_CONTRACT_V1:' || md5(concat_ws(
      '|',
      pg_get_functiondef(v_function.oid),
      v_function.owner_name
    ));

    EXECUTE format(
      'COMMENT ON FUNCTION %s IS %L',
      v_function.oid::regprocedure,
      v_signature
    );
    v_sealed := v_sealed + 1;
  END LOOP;

  IF v_sealed <> 2 THEN
    RAISE EXCEPTION
      'FINAL_HELPER_SIGNATURE_CONTRACT_BLOCKED: sealed %, expected 2',
      v_sealed
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- This definer-mode view is necessary because browser roles cannot read the
-- teams base table. Add the canonical active-account check before evaluating
-- ownership so a still-valid JWT cannot retain team presentation access.
CREATE OR REPLACE VIEW public.own_zltac_teams
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  team.id,
  team.event_id,
  team.name,
  team.status,
  team.rejection_reason,
  team.state,
  team.home_venue,
  team.colour,
  team.logo_url,
  team.created_at,
  CASE
    WHEN team.captain_id = (SELECT auth.uid()) THEN 'captain'::text
    WHEN team.manager_id = (SELECT auth.uid()) THEN 'manager'::text
    ELSE NULL::text
  END AS viewer_role
FROM public.teams AS team
WHERE (SELECT public.is_active_user())
  AND team.event_id IS NOT NULL
  AND (
    team.captain_id = (SELECT auth.uid())
    OR team.manager_id = (SELECT auth.uid())
  );

REVOKE ALL PRIVILEGES ON public.own_zltac_teams
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.own_zltac_teams TO authenticated, service_role;

COMMENT ON VIEW public.own_zltac_teams IS
  'Authenticated actor-scoped ZLTAC team presentation without ownership profile identifiers.';

-- Test questions are now issued only by the authenticated, rate-limited
-- attempt API. The legacy view exposed the complete active question pool and
-- has no remaining application consumer. RESTRICT makes an unexpected
-- dependency fail the migration instead of being removed implicitly.
REVOKE ALL PRIVILEGES ON public.referee_questions_public
  FROM PUBLIC, anon, authenticated, service_role;
DROP VIEW public.referee_questions_public RESTRICT;

-- These invoker-mode helpers use only schema-qualified application objects.
-- An empty search path removes the remaining mutable-path advisor findings
-- without changing their trigger bindings, ownership, or execute grants.
ALTER FUNCTION public.touch_updated_at()
  SET search_path = '';
ALTER FUNCTION public.set_competition_payment_reference()
  SET search_path = '';
ALTER FUNCTION public.set_competition_amount_owing()
  SET search_path = '';
ALTER FUNCTION public.protect_competition_registration_fields()
  SET search_path = '';
ALTER FUNCTION public.generate_competition_payment_reference(uuid, text, uuid)
  SET search_path = '';

-- Reinstate the narrow grants originally intended by the atomic/audit
-- migrations. Later broad service-role defaults had widened these existing
-- tables. SECURITY DEFINER workflows owned by postgres retain their writes.
REVOKE ALL PRIVILEGES ON TABLE
  public.payment_mutation_requests,
  public.payment_records_history,
  public.profile_change_audit
FROM service_role;

-- Table-level revocation does not clear historical column ACLs. Remove every
-- column privilege before installing the exact table-level allow-list.
DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payment_mutation_requests',
    'payment_records_history',
    'profile_change_audit'
  ]::text[] LOOP
    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
      INTO v_columns
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = format('public.%I', v_table)::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM service_role',
        v_columns,
        v_table
      );
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM service_role',
        v_columns,
        v_table
      );
      EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM service_role',
        v_columns,
        v_table
      );
      EXECUTE format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM service_role',
        v_columns,
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

GRANT SELECT, INSERT ON TABLE public.payment_mutation_requests TO service_role;
GRANT SELECT ON TABLE
  public.payment_records_history,
  public.profile_change_audit
TO service_role;

-- Fail closed if the deployed catalog is not the reviewed final contract.
DO $$
DECLARE
  v_function regprocedure;
  v_table text;
  v_has_maintain boolean;
BEGIN
  IF to_regclass('public.referee_questions_public') IS NOT NULL THEN
    RAISE EXCEPTION 'FINAL_REFEREE_QUESTION_VIEW_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'FINAL_OWN_TEAM_VIEW_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
  END IF;

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
      RAISE EXCEPTION 'FINAL_FUNCTION_SEARCH_PATH_CONTRACT_BLOCKED: %', v_function
        USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'FINAL_SERVICE_AUDIT_GRANT_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'FINAL_SERVICE_AUDIT_EXTENDED_GRANT_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
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
        RAISE EXCEPTION 'FINAL_SERVICE_AUDIT_MAINTAIN_CONTRACT_BLOCKED: %', v_table
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END IF;
END;
$$;

COMMIT;
