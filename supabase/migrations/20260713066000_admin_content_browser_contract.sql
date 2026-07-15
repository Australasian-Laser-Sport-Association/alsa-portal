-- Final browser contract for privileged administration and cross-user data.
-- Apply only after 65000 and the API/frontend release have been deployed and
-- verified against the safe views and actor-explicit service mutations.

BEGIN;

-- Browser roles need schema USAGE to reach reviewed objects, never CREATE.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- RLS state is part of the contract, not just the policies themselves. Enable
-- it on every application base/partitioned table so a dashboard toggle cannot
-- turn a narrow grant into unrestricted row access.
DO $$
DECLARE
  v_relation record;
BEGIN
  FOR v_relation IN
    SELECT relation.relname
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
     WHERE relation_schema.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_relation.relname
    );
  END LOOP;
END;
$$;

-- A populated environment must prove that the deployed service/API path can
-- perform and attribute a real content mutation before the legacy browser
-- grants disappear. Migration 65000 creates this audit table empty, so any row
-- is durable evidence of a post-expand smoke action. Empty disposable
-- databases remain replayable in CI and local development.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles)
     AND NOT EXISTS (SELECT 1 FROM public.admin_content_mutation_audit) THEN
    RAISE EXCEPTION
      'ADMIN_CONTENT_CONTRACT_BLOCKED: complete an audited admin-content smoke mutation through the deployed API before applying 66000.'
      USING ERRCODE = '55000';
  END IF;

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
    RAISE EXCEPTION
      'ADMIN_ASSET_CONTRACT_BLOCKED: complete and finalize every signed-upload smoke through the deployed API before applying 66000.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Public-safe and actor-owned reads remain available through dedicated views
-- or narrow RLS policies. The browser has no public-schema mutation path other
-- than the exact own-profile UPDATE allow-list regranted below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Anonymous reads are allow-listed below. This removes inherited/public and
-- direct grants from actor-owned tables even where RLS already denies rows, so
-- a later policy change cannot silently turn grant drift into a disclosure.
REVOKE SELECT
  ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon;

-- MAINTAIN was added in PostgreSQL 17. Keep this migration replayable if a
-- Supabase project is still on an older major while removing it wherever the
-- privilege exists.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE
      'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES
  ON ALL SEQUENCES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Table-level REVOKEs do not remove historical column ACLs. Clear every
-- browser mutation/reference column privilege from every current public
-- relation, including automatically updatable views.
DO $$
DECLARE
  v_relation record;
  v_columns text;
BEGIN
  FOR v_relation IN
    SELECT relation.relname
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
     WHERE relation_schema.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
      INTO v_columns
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = format('public.%I', v_relation.relname)::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_relation.relname
      );
      EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_relation.relname
      );
      EXECUTE format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_relation.relname
      );
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon',
        v_columns,
        v_relation.relname
      );
    END IF;
  END LOOP;
END;
$$;

-- Exact anonymous Data API surface. Public API routes may further filter these
-- relations, but no other public-schema base table or view is browser-readable
-- before sign-in.
GRANT SELECT ON
  public.alsa_membership_periods,
  public.cms_global,
  public.document_categories,
  public.documents,
  public.zltac_event_placings,
  public.public_competition_roster_safe,
  public.public_competitions,
  public.public_event_roster,
  public.public_referee_test_settings,
  public.public_zltac_dynasties,
  public.public_zltac_event_history,
  public.public_zltac_events,
  public.public_zltac_hall_of_fame,
  public.public_zltac_legends,
  public.public_zltac_teams,
  public.referee_questions_public
TO anon, authenticated;

-- Future application objects created by the migration role fail closed until
-- a reviewed migration grants the exact privilege. service_role defaults
-- remain unchanged. Supabase does not allow the non-superuser migration role
-- to alter supabase_admin's platform defaults; the verifier therefore also
-- requires that supabase_admin owns no application objects in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Historical migrations revoked PUBLIC and authenticated but accidentally
-- preserved direct anon EXECUTE. These actor-explicit mutators are service API
-- internals and must never be callable with an unauthenticated JWT role.
REVOKE ALL PRIVILEGES ON FUNCTION
  public.change_profile_alias(uuid, text, text, uuid, text),
  public.disband_zltac_team(uuid, uuid, integer),
  public.remove_zltac_team_player(uuid, uuid, uuid, integer),
  public.recalculate_zltac_amount_owing(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.change_profile_alias(uuid, text, text, uuid, text),
  public.disband_zltac_team(uuid, uuid, integer),
  public.remove_zltac_team_player(uuid, uuid, uuid, integer),
  public.recalculate_zltac_amount_owing(uuid)
TO service_role;

-- Production can retain this legacy trigger helper even though clean and
-- staging databases do not. Trigger dispatch does not require browser roles
-- to call the SECURITY DEFINER function directly, so remove the inherited and
-- direct Data API grants while keeping service-role execution available.
DO $$
BEGIN
  IF to_regprocedure('public.prevent_profile_self_escalation()') IS NOT NULL THEN
    EXECUTE
      'REVOKE EXECUTE ON FUNCTION public.prevent_profile_self_escalation() '
      'FROM PUBLIC, anon, authenticated';
    EXECUTE
      'GRANT EXECUTE ON FUNCTION public.prevent_profile_self_escalation() '
      'TO service_role';
  END IF;
END;
$$;

-- Normalize the only SECURITY DEFINER helpers that remain browser-executable.
-- Every referenced object is schema-qualified and the empty search path keeps
-- untrusted objects out of name resolution.
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
      AND roles && ARRAY[
        'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
      ]::text[]
  );
$$;

ALTER FUNCTION public.is_active_user() OWNER TO postgres;
ALTER FUNCTION public.is_committee() OWNER TO postgres;

-- Privileged role helpers are service internals after the browser-policy
-- cutover. The two remaining browser-callable SECURITY DEFINER helpers are
-- required by a reviewed view or the own-profile RLS policy.
REVOKE ALL PRIVILEGES ON FUNCTION
  public.is_superadmin(),
  public.is_competition_manager(uuid),
  public.is_active_event_open(),
  public.is_reg_open_for_year(integer),
  public.can_read_team_members(uuid),
  public.can_write_team_logo(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.is_superadmin(),
  public.is_competition_manager(uuid),
  public.is_active_event_open(),
  public.is_reg_open_for_year(integer),
  public.can_read_team_members(uuid)
TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION
  public.is_committee(),
  public.is_active_user()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_committee()
TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_active_user()
TO authenticated, service_role;

DO $$
DECLARE
  v_function_drift text;
BEGIN
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
        OR has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
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
    INTO v_function_drift
    FROM drift;

  IF v_function_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'BROWSER_SECURITY_DEFINER_CONTRACT_BLOCKED: %',
      v_function_drift
      USING ERRCODE = '55000';
  END IF;
END;
$$;

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
      'SECURITY_HELPER_SIGNATURE_CONTRACT_BLOCKED: sealed %, expected 2',
      v_sealed
      USING ERRCODE = '55000';
  END IF;
END;
$$;

GRANT UPDATE (
  first_name,
  last_name,
  alias,
  dob,
  phone,
  state,
  home_arena,
  emergency_contact_name,
  emergency_contact_phone
) ON TABLE public.profiles TO authenticated;

-- These operational and audit relations have no actor-owned browser use.
-- This also covers answer keys, internal history notes, and hidden editorial
-- drafts. Public/committee consumers use safe views or authenticated APIs.
REVOKE SELECT ON
  public.admin_asset_upload_audit,
  public.admin_content_mutation_audit,
  public.alsa_lifetime_members,
  public.alsa_memberships,
  public.backup_runs,
  public.backup_settings,
  public.competition_managers,
  public.competitions,
  public.payment_mutation_requests,
  public.payment_records_history,
  public.placeholder_merge_audit,
  public.profile_access_audit,
  public.profile_change_audit,
  public.profile_governance_state,
  public.public_competition_roster,
  public.referee_questions,
  public.referee_test_attempts,
  public.referee_test_settings,
  public.team_members,
  public.teams,
  public.volunteer_signup_roles,
  public.volunteer_signups,
  public.zltac_dynasties,
  public.zltac_event_history,
  public.zltac_event_lifecycle_audit,
  public.zltac_hall_of_fame,
  public.zltac_legends,
  public.zltac_side_event_roster_members,
  public.zltac_events
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'admin_asset_upload_audit', 'admin_content_mutation_audit',
    'alsa_lifetime_members', 'alsa_memberships', 'backup_runs',
    'backup_settings', 'competition_managers', 'competitions',
    'payment_mutation_requests', 'payment_records_history',
    'placeholder_merge_audit', 'profile_access_audit',
    'profile_change_audit', 'profile_governance_state',
    'public_competition_roster', 'referee_questions',
    'referee_test_attempts', 'referee_test_settings',
    'team_members', 'teams', 'volunteer_signup_roles', 'volunteer_signups',
    'zltac_dynasties', 'zltac_event_history', 'zltac_event_lifecycle_audit',
    'zltac_hall_of_fame', 'zltac_legends',
    'zltac_side_event_roster_members', 'zltac_events'
  ]::text[] LOOP
    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
      INTO v_columns
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = format('public.%I', v_table)::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

-- Authenticated users may read only these actor-owned or deliberately public
-- relations. Several base tables use column grants, so test effective SELECT
-- at relation level without widening those grants to whole-table access.
DO $$
DECLARE
  v_relation_drift text;
BEGIN
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
    INTO v_relation_drift
    FROM drift;

  IF v_relation_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'AUTHENTICATED_SELECT_CONTRACT_BLOCKED: %',
      v_relation_drift
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- All committee, superadmin, and competition-manager cross-user access is now
-- mediated by rate-limited service-role routes that check current account
-- status. Removing the legacy policies also prevents a future grant drift from
-- silently reopening those browser paths.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT * FROM (VALUES
      ('alsa_lifetime_members', 'alsa_lifetime_members_committee_all'),
      ('alsa_membership_periods', 'alsa_membership_periods_committee_write'),
      ('alsa_memberships', 'alsa_memberships_committee_all'),
      ('backup_runs', 'backup_runs_committee_read'),
      ('backup_settings', 'backup_settings_committee_read'),
      ('backup_settings', 'backup_settings_superadmin_update'),
      ('cms_global', 'cms_global_committee_write'),
      ('competition_managers', 'competition_managers_peer_read'),
      ('competition_managers', 'competition_managers_self_read'),
      ('competition_managers', 'competition_managers_superadmin_read'),
      ('competition_managers', 'competition_managers_superadmin_write'),
      ('competition_registrations', 'competition_registrations_manager_delete'),
      ('competition_registrations', 'competition_registrations_manager_read'),
      ('competition_registrations', 'competition_registrations_manager_update'),
      ('competition_registrations', 'competition_registrations_superadmin_delete'),
      ('competition_registrations', 'competition_registrations_superadmin_read'),
      ('competition_registrations', 'competition_registrations_superadmin_update'),
      ('competitions', 'competitions_discovery_read'),
      ('competitions', 'competitions_manager_read'),
      ('competitions', 'competitions_manager_update'),
      ('competitions', 'competitions_open_window_read'),
      ('competitions', 'competitions_superadmin_insert'),
      ('competitions', 'competitions_superadmin_read'),
      ('competitions', 'competitions_superadmin_update'),
      ('document_categories', 'document_categories_committee_write'),
      ('documents', 'documents_committee_write'),
      ('doubles_pairs', 'doubles_pairs_committee_read'),
      ('event_volunteer_settings', 'event_volunteer_settings_committee_write'),
      ('legal_acceptances', 'legal_acceptances_committee_read'),
      ('legal_documents', 'legal_documents_committee_read'),
      ('payment_records', 'payment_records_committee_all'),
      ('payment_records_history', 'payment_records_history_committee_read'),
      ('profile_change_audit', 'profile_change_audit_committee_read'),
      ('profiles', 'profiles_select_committee'),
      ('referee_questions', 'referee_questions_committee_write'),
      ('referee_test_results', 'referee_test_results_committee_read'),
      ('referee_test_settings', 'referee_test_settings_read'),
      ('referee_test_settings', 'referee_test_settings_committee_write'),
      ('team_members', 'team_members_committee_all'),
      ('team_members', 'team_members_self_read'),
      ('team_members', 'team_members_team_read'),
      ('teams', 'teams_committee_write'),
      ('teams', 'teams_owner_read'),
      ('teams', 'teams_public_read'),
      ('triples_teams', 'triples_teams_committee_read'),
      ('under_18_approvals', 'under_18_approvals_committee_all'),
      ('volunteer_roles', 'volunteer_roles_committee_write'),
      ('volunteer_signup_roles', 'volunteer_signup_roles_committee_delete'),
      ('volunteer_signup_roles', 'volunteer_signup_roles_committee_read'),
      ('volunteer_signup_roles', 'volunteer_signup_roles_own_delete'),
      ('volunteer_signup_roles', 'volunteer_signup_roles_own_insert'),
      ('volunteer_signup_roles', 'volunteer_signup_roles_own_select'),
      ('volunteer_signups', 'volunteer_signups_committee_delete'),
      ('volunteer_signups', 'volunteer_signups_committee_read'),
      ('volunteer_signups', 'volunteer_signups_own'),
      ('zltac_dynasties', 'zltac_dynasties_committee_write'),
      ('zltac_dynasties', 'zltac_dynasties_public_read'),
      ('zltac_event_history', 'zltac_event_history_committee_write'),
      ('zltac_event_history', 'zltac_event_history_public_read'),
      ('zltac_event_lifecycle_audit', 'zltac_event_lifecycle_audit_committee_read'),
      ('zltac_event_placings', 'zltac_event_placings_committee_write'),
      ('zltac_events', 'zltac_events_committee_read_all'),
      ('zltac_events', 'zltac_events_committee_write'),
      ('zltac_events', 'zltac_events_public_read'),
      ('zltac_hall_of_fame', 'zltac_hall_of_fame_committee_write'),
      ('zltac_hall_of_fame', 'zltac_hall_of_fame_public_read'),
      ('zltac_legends', 'zltac_legends_committee_write'),
      ('zltac_legends', 'zltac_legends_public_read')
    ) AS policy_to_drop(table_name, policy_name)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy.policy_name,
      v_policy.table_name
    );
  END LOOP;
END;
$$;

-- Remove every remaining permissive browser DML policy except the exact
-- own-profile UPDATE contract. Restrictive active-user guards may remain but
-- cannot grant access by themselves.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policy.tablename, policy.policyname
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
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  END LOOP;
END;
$$;

-- Recreate the sole browser DML policy and every permissive browser SELECT
-- policy. This makes the cutover self-healing if a dashboard policy kept the
-- expected name but drifted to broader roles or predicates.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS active_user_update ON public.profiles;
CREATE POLICY active_user_update ON public.profiles
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS alsa_membership_periods_public_read
  ON public.alsa_membership_periods;
CREATE POLICY alsa_membership_periods_public_read
  ON public.alsa_membership_periods
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS cms_global_public_read ON public.cms_global;
CREATE POLICY cms_global_public_read ON public.cms_global
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS competition_registrations_self_read
  ON public.competition_registrations;
CREATE POLICY competition_registrations_self_read
  ON public.competition_registrations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS document_categories_public_read
  ON public.document_categories;
CREATE POLICY document_categories_public_read
  ON public.document_categories
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS documents_public_read ON public.documents;
CREATE POLICY documents_public_read ON public.documents
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS doubles_pairs_own ON public.doubles_pairs;
CREATE POLICY doubles_pairs_own ON public.doubles_pairs
  FOR SELECT TO authenticated
  USING (player1_id = (SELECT auth.uid()) OR player2_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS event_volunteer_settings_authenticated_read
  ON public.event_volunteer_settings;
CREATE POLICY event_volunteer_settings_authenticated_read
  ON public.event_volunteer_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS legal_acceptances_select_own
  ON public.legal_acceptances;
CREATE POLICY legal_acceptances_select_own
  ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS legal_documents_acceptance_owner_read
  ON public.legal_documents;
CREATE POLICY legal_documents_acceptance_owner_read
  ON public.legal_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.legal_acceptances AS acceptance
      WHERE acceptance.document_id = legal_documents.id
        AND acceptance.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS legal_documents_public_read
  ON public.legal_documents;
CREATE POLICY legal_documents_public_read
  ON public.legal_documents
  FOR SELECT TO anon, authenticated
  USING (
    is_active
    AND published_at IS NOT NULL
    AND content_sha256 IS NOT NULL
    AND object_size IS NOT NULL
  );

DROP POLICY IF EXISTS payment_records_competition_own_read
  ON public.payment_records;
CREATE POLICY payment_records_competition_own_read
  ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    competition_registration_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.competition_registrations AS registration
      WHERE registration.id = payment_records.competition_registration_id
        AND registration.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS payment_records_own_read ON public.payment_records;
CREATE POLICY payment_records_own_read ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.zltac_registrations AS registration
      WHERE registration.id = payment_records.registration_id
        AND registration.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS payments_own_read ON public.payments;
CREATE POLICY payments_own_read ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS referee_test_results_self_read
  ON public.referee_test_results;
CREATE POLICY referee_test_results_self_read
  ON public.referee_test_results
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS triples_teams_own ON public.triples_teams;
CREATE POLICY triples_teams_own ON public.triples_teams
  FOR SELECT TO authenticated
  USING (
    player1_id = (SELECT auth.uid())
    OR player2_id = (SELECT auth.uid())
    OR player3_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS under_18_approvals_select_own
  ON public.under_18_approvals;
CREATE POLICY under_18_approvals_select_own
  ON public.under_18_approvals
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS volunteer_roles_authenticated_read
  ON public.volunteer_roles;
CREATE POLICY volunteer_roles_authenticated_read
  ON public.volunteer_roles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS zltac_event_placings_public_read
  ON public.zltac_event_placings;
CREATE POLICY zltac_event_placings_public_read
  ON public.zltac_event_placings
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS zltac_registrations_select_own
  ON public.zltac_registrations;
CREATE POLICY zltac_registrations_select_own
  ON public.zltac_registrations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- A permissive SELECT policy grants rows whenever any one policy matches. Stop
-- the cutover if a dashboard-created or renamed policy exists outside the
-- reviewed final set, or if an expected policy has disappeared.
DO $$
DECLARE
  v_policy_drift text;
BEGIN
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
    RAISE EXCEPTION
      'ADMIN_BROWSER_POLICY_CONTRACT_BLOCKED: %',
      v_policy_drift
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Seal the exact catalog representation after recreation. ALTER POLICY keeps
-- the old comment and DROP/CREATE loses it, so the verifier detects any later
-- role, command, permissiveness, USING, or WITH CHECK drift without relying on
-- PostgreSQL pretty-printer whitespace.
DO $$
DECLARE
  v_policy record;
  v_signature text;
  v_signed integer := 0;
BEGIN
  FOR v_policy IN
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
    SELECT policy.*
    FROM pg_policies AS policy
    JOIN expected
      ON expected.table_name = policy.tablename
     AND expected.policy_name = policy.policyname
    WHERE policy.schemaname = 'public'
  LOOP
    v_signature := 'BROWSER_POLICY_CONTRACT_V1:' || md5(concat_ws(
      '|',
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.policyname,
      v_policy.permissive,
      v_policy.roles::text,
      v_policy.cmd,
      coalesce(v_policy.qual, ''),
      coalesce(v_policy.with_check, '')
    ));

    EXECUTE format(
      'COMMENT ON POLICY %I ON public.%I IS %L',
      v_policy.policyname,
      v_policy.tablename,
      v_signature
    );
    v_signed := v_signed + 1;
  END LOOP;

  IF v_signed <> 22 THEN
    RAISE EXCEPTION
      'PUBLIC_POLICY_SIGNATURE_CONTRACT_BLOCKED: signed %, expected 22',
      v_signed
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.can_read_team_members(uuid);

-- Storage object mutation is server-authorised. Public buckets serve bytes by
-- exact object URL without SELECT policies; removing browser policies also
-- prevents unauthenticated object listing and metadata enumeration.
DROP POLICY IF EXISTS event_logos_committee ON storage.objects;
DROP POLICY IF EXISTS event_photos_committee ON storage.objects;
DROP POLICY IF EXISTS event_covers_committee ON storage.objects;
DROP POLICY IF EXISTS referee_test_media_committee ON storage.objects;
DROP POLICY IF EXISTS competition_banners_write ON storage.objects;

DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS team_logos_public_read ON storage.objects;
DROP POLICY IF EXISTS event_logos_public_read ON storage.objects;
DROP POLICY IF EXISTS event_photos_public_read ON storage.objects;
DROP POLICY IF EXISTS event_covers_public_read ON storage.objects;
DROP POLICY IF EXISTS referee_test_media_public_read ON storage.objects;
DROP POLICY IF EXISTS competition_banners_public_read ON storage.objects;
DROP POLICY IF EXISTS avatars_owner_write ON storage.objects;
DROP POLICY IF EXISTS team_logos_owner_write ON storage.objects;
DROP POLICY IF EXISTS team_logos_captain_team_write ON storage.objects;

DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policy.tablename, policy.policyname
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'storage'
       AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.can_write_team_logo(text);
DROP FUNCTION IF EXISTS public.can_write_preteam_logo(text, text);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'storage'
       AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ) THEN
    RAISE EXCEPTION
      'BROWSER_STORAGE_POLICY_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
      JOIN pg_roles AS owner_role
        ON owner_role.oid = relation.relowner
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
    RAISE EXCEPTION
      'STORAGE_OWNERSHIP_OR_RLS_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Earlier bucket migrations used ON CONFLICT DO NOTHING. Reassert the
-- production contract here so dashboard-created drift cannot preserve a
-- broader MIME list, larger object cap, or private/public mismatch.
UPDATE storage.buckets
SET public = true,
    file_size_limit = CASE id
      WHEN 'avatars' THEN 2097152
      WHEN 'team-logos' THEN 2097152
      WHEN 'event-logos' THEN 2097152
      WHEN 'referee-test-media' THEN 26214400
      ELSE 5242880
    END,
    allowed_mime_types = CASE id
      WHEN 'referee-test-media' THEN
        ARRAY['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
      ELSE ARRAY['image/png','image/jpeg','image/webp']::text[]
    END
WHERE id IN (
  'avatars',
  'team-logos',
  'event-logos',
  'event-photos',
  'event-covers',
  'referee-test-media',
  'competition-banners'
);

UPDATE storage.buckets
SET public = false,
    file_size_limit = 4194304,
    allowed_mime_types = ARRAY['application/pdf']::text[]
WHERE id = 'legal-documents';

UPDATE storage.buckets
SET public = false,
    file_size_limit = 26214400,
    allowed_mime_types = ARRAY['text/csv', 'application/json']::text[]
WHERE id = 'portal-backups';

DO $$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM storage.buckets
     WHERE (
         id IN ('avatars', 'team-logos', 'event-logos')
         AND public = true
         AND file_size_limit = 2097152
         AND allowed_mime_types = ARRAY[
           'image/png', 'image/jpeg', 'image/webp'
         ]::text[]
       ) OR (
         id IN ('event-photos', 'event-covers', 'competition-banners')
         AND public = true
         AND file_size_limit = 5242880
         AND allowed_mime_types = ARRAY[
           'image/png', 'image/jpeg', 'image/webp'
         ]::text[]
       ) OR (
         id = 'referee-test-media'
         AND public = true
         AND file_size_limit = 26214400
         AND allowed_mime_types = ARRAY[
           'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'
         ]::text[]
       )
  ) <> 7 THEN
    RAISE EXCEPTION
      'PUBLIC_STORAGE_BUCKET_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION
      'PRIVATE_STORAGE_BUCKET_CONTRACT_BLOCKED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_mutate_content(uuid, text, text, uuid, jsonb, jsonb) IS
  'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';

COMMIT;
