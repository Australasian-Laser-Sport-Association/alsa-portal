BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- Every account, registration, roster, payment, legal, and volunteer table
-- must retain RLS even though supported writes go through service-role APIs.
WITH expected(name) AS (
  VALUES
    ('profiles'),
    ('zltac_events'),
    ('zltac_registrations'),
    ('teams'),
    ('team_members'),
    ('competitions'),
    ('competition_managers'),
    ('competition_registrations'),
    ('payment_records'),
    ('legal_documents'),
    ('legal_acceptances'),
    ('under_18_approvals'),
    ('volunteer_roles'),
    ('event_volunteer_settings'),
    ('volunteer_signups'),
    ('volunteer_signup_roles')
)
SELECT is(
  (
    SELECT count(*)
    FROM expected AS e
    LEFT JOIN pg_namespace AS n ON n.nspname = 'public'
    LEFT JOIN pg_class AS c
      ON c.relnamespace = n.oid
     AND c.relname = e.name
     AND c.relkind IN ('r', 'p')
    WHERE c.oid IS NULL OR NOT c.relrowsecurity
  ),
  0::bigint,
  'security-sensitive tables exist and have RLS enabled'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS relation_schema
      ON relation_schema.oid = relation.relnamespace
    WHERE relation_schema.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND NOT relation.relrowsecurity
  ),
  0::bigint,
  'every public base and partitioned table has row-level security enabled'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'public', 'CREATE')
  AND NOT has_schema_privilege('authenticated', 'public', 'CREATE')
  AND has_schema_privilege('anon', 'public', 'USAGE')
  AND has_schema_privilege('authenticated', 'public', 'USAGE'),
  'browser roles can use but cannot create objects in the public schema'
);

-- Migration 66000 makes the browser mutation contract schema-wide. Test all
-- current public relations so a newly added table cannot quietly inherit a
-- historical default grant. The only exception is the exact own-profile
-- UPDATE column allow-list asserted immediately below.
WITH browser_role(name) AS (
  VALUES ('anon'::text), ('authenticated'::text)
), public_relation AS (
  SELECT relation.oid, relation.relname
  FROM pg_class AS relation
  JOIN pg_namespace AS relation_schema
    ON relation_schema.oid = relation.relnamespace
  WHERE relation_schema.nspname = 'public'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
)
SELECT is(
  (
    SELECT count(*)
    FROM public_relation AS relation
    CROSS JOIN browser_role AS browser
    WHERE has_any_column_privilege(browser.name, relation.oid, 'INSERT')
       OR has_table_privilege(browser.name, relation.oid, 'DELETE')
       OR has_table_privilege(browser.name, relation.oid, 'TRUNCATE')
       OR has_any_column_privilege(browser.name, relation.oid, 'REFERENCES')
       OR has_table_privilege(browser.name, relation.oid, 'TRIGGER')
       OR (
         has_any_column_privilege(browser.name, relation.oid, 'UPDATE')
         AND NOT (
           browser.name = 'authenticated'
           AND relation.relname = 'profiles'
         )
       )
  ),
  0::bigint,
  'browser roles have no public-schema mutation or schema-control grant outside own-profile UPDATE'
);

SELECT is(
  CASE
    WHEN current_setting('server_version_num')::integer >= 170000 THEN (
      SELECT count(*)
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_schema
        ON relation_schema.oid = relation.relnamespace
      CROSS JOIN (VALUES ('anon'::text), ('authenticated'::text)) AS browser(name)
      WHERE relation_schema.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND has_table_privilege(browser.name, relation.oid, 'MAINTAIN')
    )
    ELSE 0::bigint
  END,
  0::bigint,
  'browser roles have no PostgreSQL 17 MAINTAIN privilege on public relations'
);

WITH allowed(name) AS (
  SELECT unnest(ARRAY[
    'first_name',
    'last_name',
    'alias',
    'dob',
    'phone',
    'state',
    'home_arena',
    'emergency_contact_name',
    'emergency_contact_phone'
  ]::text[])
)
SELECT is(
  (
    SELECT count(*)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.profiles'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND has_column_privilege(
        'authenticated',
        'public.profiles',
        attribute.attname,
        'UPDATE'
      ) IS DISTINCT FROM EXISTS (
        SELECT 1 FROM allowed WHERE allowed.name = attribute.attname
      )
  ),
  0::bigint,
  'authenticated profile UPDATE privileges exactly match the nine reviewed mutable columns'
);

WITH server_only(name) AS (
  VALUES
    ('admin_asset_upload_audit'),
    ('admin_content_mutation_audit'),
    ('alsa_lifetime_members'),
    ('alsa_memberships'),
    ('backup_runs'),
    ('backup_settings'),
    ('competition_managers'),
    ('competitions'),
    ('payment_mutation_requests'),
    ('payment_records_history'),
    ('placeholder_merge_audit'),
    ('profile_access_audit'),
    ('profile_change_audit'),
    ('profile_governance_state'),
    ('public_competition_roster'),
    ('referee_questions'),
    ('referee_test_attempts'),
    ('referee_test_settings'),
    ('team_members'),
    ('teams'),
    ('volunteer_signup_roles'),
    ('volunteer_signups'),
    ('zltac_dynasties'),
    ('zltac_event_history'),
    ('zltac_event_lifecycle_audit'),
    ('zltac_hall_of_fame'),
    ('zltac_legends'),
    ('zltac_side_event_roster_members'),
    ('zltac_events')
)
SELECT is(
  (
    SELECT count(*)
    FROM server_only AS relation
    WHERE has_any_column_privilege(
      'anon', format('public.%I', relation.name), 'SELECT'
    ) OR has_any_column_privilege(
      'authenticated', format('public.%I', relation.name), 'SELECT'
    )
  ),
  0::bigint,
  'operational, audit, roster, and cross-user tables are server-readable only'
);

WITH allowed(name) AS (
  VALUES
    ('alsa_membership_periods'), ('cms_global'), ('document_categories'),
    ('documents'), ('zltac_event_placings'),
    ('public_competition_roster_safe'), ('public_competitions'),
    ('public_event_roster'), ('public_referee_test_settings'),
    ('public_zltac_dynasties'), ('public_zltac_event_history'),
    ('public_zltac_events'), ('public_zltac_hall_of_fame'),
    ('public_zltac_legends'), ('public_zltac_teams'),
    ('referee_questions_public')
)
SELECT is(
  (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS relation_schema
      ON relation_schema.oid = relation.relnamespace
    WHERE relation_schema.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_any_column_privilege('anon', relation.oid, 'SELECT')
      AND NOT EXISTS (
        SELECT 1 FROM allowed WHERE allowed.name = relation.relname
      )
  ),
  0::bigint,
  'anonymous public-schema reads do not exceed the exact reviewed allow-list'
);

WITH expected(name) AS (
  VALUES
    ('alsa_membership_periods'), ('cms_global'),
    ('competition_registrations'), ('document_categories'), ('documents'),
    ('doubles_pairs'), ('event_volunteer_settings'), ('legal_acceptances'),
    ('legal_documents'), ('own_zltac_teams'), ('payment_records'),
    ('payments'), ('profiles'), ('public_competition_roster_safe'),
    ('public_competitions'), ('public_event_roster'),
    ('public_referee_test_settings'), ('public_zltac_dynasties'),
    ('public_zltac_event_history'), ('public_zltac_events'),
    ('public_zltac_hall_of_fame'), ('public_zltac_legends'),
    ('public_zltac_teams'), ('referee_questions_public'),
    ('referee_test_results'), ('triples_teams'), ('under_18_approvals'),
    ('volunteer_roles'), ('zltac_event_placings'), ('zltac_registrations')
), actual(name) AS (
  SELECT relation.relname
  FROM pg_class AS relation
  JOIN pg_namespace AS relation_schema
    ON relation_schema.oid = relation.relnamespace
  WHERE relation_schema.nspname = 'public'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_any_column_privilege('authenticated', relation.oid, 'SELECT')
), drift(name) AS (
  SELECT actual.name
  FROM actual
  WHERE NOT EXISTS (SELECT 1 FROM expected WHERE expected.name = actual.name)
  UNION ALL
  SELECT expected.name
  FROM expected
  WHERE NOT EXISTS (SELECT 1 FROM actual WHERE actual.name = expected.name)
)
SELECT is(
  (SELECT count(*) FROM drift),
  0::bigint,
  'authenticated public-schema reads exactly match the reviewed relation allow-list'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_class AS sequence_row
    JOIN pg_namespace AS sequence_schema
      ON sequence_schema.oid = sequence_row.relnamespace
    CROSS JOIN (VALUES ('anon'::text), ('authenticated'::text)) AS browser(name)
    WHERE sequence_schema.nspname = 'public'
      AND sequence_row.relkind = 'S'
      AND (
        has_sequence_privilege(browser.name, sequence_row.oid, 'USAGE')
        OR has_sequence_privilege(browser.name, sequence_row.oid, 'SELECT')
        OR has_sequence_privilege(browser.name, sequence_row.oid, 'UPDATE')
      )
  ),
  0::bigint,
  'browser roles have no public sequence privileges'
);

SELECT is(
  (
    SELECT count(*)
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
  ),
  0::bigint,
  'public-schema default privileges fail closed for browser roles'
);

SELECT is(
  (
    SELECT count(*)
    FROM (VALUES ('buckets'::text), ('objects'::text)) AS expected(name)
    LEFT JOIN pg_namespace AS relation_schema
      ON relation_schema.nspname = 'storage'
    LEFT JOIN pg_class AS relation
      ON relation.relnamespace = relation_schema.oid
     AND relation.relname = expected.name
    LEFT JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid IS NULL
       OR owner_role.rolname <> 'supabase_storage_admin'
       OR NOT relation.relrowsecurity
  ),
  0::bigint,
  'Supabase-owned Storage boundary retains RLS on buckets and objects'
);

WITH private_base(name) AS (
  VALUES ('zltac_events'), ('competitions'), ('teams'), ('legal_documents')
)
SELECT is(
  (
    SELECT count(*)
    FROM private_base AS t
    WHERE has_table_privilege(
      'anon', format('public.%I', t.name), 'SELECT'
    )
  ),
  0::bigint,
  'anonymous users cannot bypass masked public views by reading base tables'
);

WITH public_view(name) AS (
  VALUES
    ('public_zltac_events'),
    ('public_competitions'),
    ('public_zltac_teams'),
    ('public_event_roster'),
    ('public_competition_roster_safe')
)
SELECT is(
  (
    SELECT count(*)
    FROM public_view AS v
    WHERE has_table_privilege(
      'anon', format('public.%I', v.name), 'SELECT'
    )
  ),
  5::bigint,
  'anonymous discovery is available only through the five masked views'
);

SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.public_competition_roster', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.public_competition_roster', 'SELECT'
  ),
  'deprecated roster view is unreachable to browser roles'
);

WITH forbidden(name) AS (
  VALUES
    ('user_id'), ('first_name'), ('last_name'), ('email'), ('phone'),
    ('dob'), ('payment_reference'), ('amount_paid'), ('amount_owing')
)
SELECT is(
  (
    SELECT count(*)
    FROM information_schema.columns AS c
    JOIN forbidden AS f ON f.name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = 'public_competition_roster_safe'
  ),
  0::bigint,
  'safe competition roster exposes no account, legal-name, contact, or payment fields'
);

WITH forbidden(name) AS (
  VALUES
    ('user_id'), ('first_name'), ('last_name'), ('email'), ('phone'),
    ('dob'), ('payment_reference'), ('amount_owing')
)
SELECT is(
  (
    SELECT count(*)
    FROM information_schema.columns AS c
    JOIN forbidden AS f ON f.name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = 'public_event_roster'
  ),
  0::bigint,
  'public ZLTAC roster is alias-only and contains no account or payment fields'
);

WITH forbidden(name) AS (
  VALUES
    ('bank_account_name'), ('bank_bsb'), ('bank_account_number'),
    ('created_by'), ('archived_at')
)
SELECT is(
  (
    SELECT count(*)
    FROM information_schema.columns AS c
    JOIN forbidden AS f ON f.name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = 'public_competitions'
  ),
  0::bigint,
  'public competition catalogue omits bank and administrative fields'
);

SELECT ok(
  NOT has_column_privilege(
    'anon', 'public.profiles', 'email', 'SELECT'
  ),
  'anonymous sessions cannot read profile email addresses'
);

-- A table-level SELECT grant overrides a column REVOKE. This assertion catches
-- both forms of grant drift and keeps cross-user email reads server-side.
SELECT ok(
  NOT has_column_privilege(
    'authenticated', 'public.profiles', 'email', 'SELECT'
  ),
  'authenticated browser sessions cannot select profiles.email'
);

WITH protected(name) AS (
  VALUES
    ('email'),
    ('alsa_member_id'),
    ('alsa_position'),
    ('is_placeholder'),
    ('created_by_admin_id'),
    ('placeholder_email'),
    ('updated_at')
)
SELECT is(
  (
    SELECT count(*)
    FROM protected AS column_name
    WHERE has_column_privilege(
      'authenticated',
      'public.profiles',
      column_name.name,
      'SELECT'
    )
  ),
  0::bigint,
  'authenticated browsers cannot read protected identity, placeholder, or audit profile fields'
);

WITH required(name) AS (
  SELECT unnest(ARRAY[
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
  ]::text[])
)
SELECT is(
  (
    SELECT count(*)
    FROM required AS column_name
    WHERE has_column_privilege(
      'authenticated',
      'public.profiles',
      column_name.name,
      'SELECT'
    )
  ),
  14::bigint,
  'authenticated profile screens retain their explicit browser read allow-list'
);

WITH mutable(name) AS (
  SELECT unnest(ARRAY[
    'first_name',
    'last_name',
    'alias',
    'dob',
    'phone',
    'state',
    'home_arena',
    'emergency_contact_name',
    'emergency_contact_phone'
  ]::text[])
)
SELECT is(
  (
    SELECT count(*)
    FROM mutable AS column_name
    WHERE has_column_privilege(
      'authenticated',
      'public.profiles',
      column_name.name,
      'UPDATE'
    )
  ),
  9::bigint,
  'own-profile forms retain only their explicit mutable-column allow-list'
);

WITH protected(name) AS (
  SELECT unnest(ARRAY[
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
  ]::text[])
)
SELECT is(
  (
    SELECT count(*)
    FROM protected AS column_name
    WHERE has_column_privilege(
      'authenticated',
      'public.profiles',
      column_name.name,
      'UPDATE'
    )
  ),
  0::bigint,
  'authenticated browsers cannot update server-managed profile fields'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname IN (
        'profiles_update_committee',
        'profiles_update_superadmin'
      )
  ),
  0::bigint,
  'committee profile writes remain server-authoritative'
);

WITH required(name) AS (
  SELECT unnest(ARRAY[
    'submit_under_18_approval',
    'register_for_competition',
    'cancel_competition_registration',
    'create_competition_team',
    'update_competition_team',
    'disband_competition_team',
    'invite_competition_team_member',
    'respond_competition_team_invite',
    'remove_competition_team_member',
    'moderate_competition_team',
    'record_competition_payment',
    'update_competition_payment',
    'remove_competition_payment',
    'mutate_zltac_doubles_roster',
    'mutate_zltac_triples_roster',
    'archive_zltac_event',
    'delete_zltac_event',
    'start_referee_test_attempt',
    'submit_referee_test_attempt',
    'publish_legal_document',
    'generate_payment_reference',
    'generate_competition_payment_reference',
    'edit_payment_record',
    'delete_payment_record',
    'merge_placeholder_profile',
    'begin_portal_backup_run',
    'finish_portal_backup_run',
    'change_profile_alias',
    'disband_zltac_team',
    'remove_zltac_team_player',
    'recalculate_zltac_amount_owing'
  ]::text[])
), functions AS (
  SELECT p.oid, p.proname
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN required AS r ON r.name = p.proname
  WHERE n.nspname = 'public'
)
SELECT is(
  (SELECT count(DISTINCT proname) FROM functions),
  31::bigint,
  'all service-only workflow functions exist'
);

WITH required(name) AS (
  SELECT unnest(ARRAY[
    'submit_under_18_approval',
    'register_for_competition',
    'cancel_competition_registration',
    'create_competition_team',
    'update_competition_team',
    'disband_competition_team',
    'invite_competition_team_member',
    'respond_competition_team_invite',
    'remove_competition_team_member',
    'moderate_competition_team',
    'record_competition_payment',
    'update_competition_payment',
    'remove_competition_payment',
    'mutate_zltac_doubles_roster',
    'mutate_zltac_triples_roster',
    'archive_zltac_event',
    'delete_zltac_event',
    'start_referee_test_attempt',
    'submit_referee_test_attempt',
    'publish_legal_document',
    'generate_payment_reference',
    'generate_competition_payment_reference',
    'edit_payment_record',
    'delete_payment_record',
    'merge_placeholder_profile',
    'begin_portal_backup_run',
    'finish_portal_backup_run',
    'change_profile_alias',
    'disband_zltac_team',
    'remove_zltac_team_player',
    'recalculate_zltac_amount_owing'
  ]::text[])
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN required AS r ON r.name = p.proname
    WHERE n.nspname = 'public'
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  'service workflows cannot be invoked directly with browser JWT roles'
);

WITH required(name) AS (
  SELECT unnest(ARRAY[
    'submit_under_18_approval',
    'register_for_competition',
    'cancel_competition_registration',
    'create_competition_team',
    'update_competition_team',
    'disband_competition_team',
    'invite_competition_team_member',
    'respond_competition_team_invite',
    'remove_competition_team_member',
    'moderate_competition_team',
    'record_competition_payment',
    'update_competition_payment',
    'remove_competition_payment',
    'mutate_zltac_doubles_roster',
    'mutate_zltac_triples_roster',
    'archive_zltac_event',
    'delete_zltac_event',
    'start_referee_test_attempt',
    'submit_referee_test_attempt',
    'publish_legal_document',
    'generate_payment_reference',
    'generate_competition_payment_reference',
    'edit_payment_record',
    'delete_payment_record',
    'merge_placeholder_profile',
    'begin_portal_backup_run',
    'finish_portal_backup_run',
    'change_profile_alias',
    'disband_zltac_team',
    'remove_zltac_team_player',
    'recalculate_zltac_amount_owing'
  ]::text[])
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN required AS r ON r.name = p.proname
    WHERE n.nspname = 'public'
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'service role retains every required workflow function grant'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE coalesce(qual, '') ILIKE '%user_metadata%'
       OR coalesce(with_check, '') ILIKE '%user_metadata%'
  ),
  0::bigint,
  'no RLS policy trusts user-editable JWT metadata'
);

SELECT ok(
  NOT EXISTS (
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
        'is_committee',
        'is_superadmin',
        'is_competition_manager',
        'can_read_team_members'
      )
  ),
  'browser-facing public policies do not depend on privileged cross-user helpers'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
      AND cmd = 'UPDATE'
      AND permissive = 'PERMISSIVE'
      AND roles @> ARRAY['authenticated']::name[]
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND permissive = 'PERMISSIVE'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      AND NOT (
        tablename = 'profiles'
        AND policyname = 'profiles_update_own'
        AND cmd = 'UPDATE'
      )
  ),
  'own-profile UPDATE is the only permissive public browser mutation policy'
);

WITH expected(table_name, policy_name) AS (
  VALUES
    ('profiles', 'profiles_select_own'),
    ('zltac_registrations', 'zltac_registrations_select_own'),
    ('doubles_pairs', 'doubles_pairs_own'),
    ('triples_teams', 'triples_teams_own'),
    ('referee_test_results', 'referee_test_results_self_read'),
    ('competition_registrations', 'competition_registrations_self_read'),
    ('legal_acceptances', 'legal_acceptances_select_own'),
    ('legal_documents', 'legal_documents_acceptance_owner_read'),
    ('payment_records', 'payment_records_own_read'),
    ('payment_records', 'payment_records_competition_own_read'),
    ('payments', 'payments_own_read'),
    ('under_18_approvals', 'under_18_approvals_select_own')
)
SELECT is(
  (
    SELECT count(*)
    FROM expected AS required
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = required.table_name
        AND policy.policyname = required.policy_name
        AND policy.cmd = 'SELECT'
        AND policy.permissive = 'PERMISSIVE'
        AND policy.roles @> ARRAY['authenticated']::name[]
    )
  ),
  0::bigint,
  'all reviewed actor-owned browser read policies remain SELECT-only and available'
);

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
), drift(table_name, policy_name) AS (
  SELECT expected.table_name, expected.policy_name
  FROM expected
  LEFT JOIN pg_policies AS policy
    ON policy.schemaname = 'public'
    AND policy.tablename = expected.table_name
    AND policy.policyname = expected.policy_name
  LEFT JOIN pg_class AS relation
    ON relation.oid = format('public.%I', expected.table_name)::regclass
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
)
SELECT is(
  (SELECT count(*) FROM drift),
  0::bigint,
  'all 22 public browser policies retain their sealed exact signatures'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'team_members'
      AND policyname = 'team_members_team_read'
  ),
  'cross-user team-member browser policy is retired'
);

SELECT ok(
  to_regprocedure('public.can_read_team_members(uuid)') IS NULL,
  'retired team-member cross-user helper no longer exists'
);

SELECT ok(
  to_regprocedure('public.can_write_team_logo(text)') IS NULL
  AND to_regprocedure('public.can_write_preteam_logo(text,text)') IS NULL,
  'retired browser Storage authorization helpers no longer exist'
);

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
), drift(
  function_name, identity_args, anon_execute, auth_execute, service_execute
) AS (
  SELECT *
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
  SELECT *
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
SELECT is(
  (SELECT count(*) FROM drift),
  0::bigint,
  'browser-executable SECURITY DEFINER functions exactly match the reviewed role matrix'
);

WITH expected(function_oid) AS (
  VALUES
    (to_regprocedure('public.is_active_user()')),
    (to_regprocedure('public.is_committee()'))
), drift(function_oid) AS (
  SELECT expected.function_oid
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
)
SELECT is(
  (SELECT count(*) FROM drift),
  0::bigint,
  'browser security helper definitions retain their sealed exact signatures'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ),
  0::bigint,
  'browser roles cannot list or mutate Supabase Storage metadata'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.payments', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.payments', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.payments', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.payments', 'DELETE')
  AND NOT has_any_column_privilege('authenticated', 'public.payments', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.payments', 'UPDATE')
  AND NOT EXISTS (
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
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'payments'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  )
  AND EXISTS (
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
  )
  AND has_table_privilege('service_role', 'public.payments', 'SELECT')
  AND has_table_privilege('service_role', 'public.payments', 'INSERT')
  AND has_table_privilege('service_role', 'public.payments', 'UPDATE')
  AND has_table_privilege('service_role', 'public.payments', 'DELETE'),
  'legacy payments preserve owner reads and service access without browser writes'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'legal-documents'
      AND public = false
      AND file_size_limit = 4194304
      AND allowed_mime_types = ARRAY['application/pdf']::text[]
  ),
  'legal-document storage bucket is private, PDF-only, and size-limited'
);

SELECT is(
  (
    SELECT count(*)
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
  ),
  7::bigint,
  'all public Storage buckets retain exact size and MIME limits'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') LIKE '%legal-documents%'
        OR coalesce(with_check, '') LIKE '%legal-documents%'
      )
  ),
  0::bigint,
  'no browser storage policy exposes or overwrites legal PDFs'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'legal_documents'
      AND policyname = 'legal_documents_public_read'
      AND coalesce(qual, '') LIKE '%is_active%'
      AND coalesce(qual, '') LIKE '%published_at%'
      AND coalesce(qual, '') LIKE '%content_sha256%'
      AND coalesce(qual, '') LIKE '%object_size%'
  ),
  'legal catalogue policy exposes only active integrity-stamped publications'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.legal_documents'::regclass
      AND NOT t.tgisinternal
      AND (t.tgtype & 16) = 16
      AND t.tgenabled <> 'D'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.legal_documents'::regclass
      AND NOT t.tgisinternal
      AND (t.tgtype & 8) = 8
      AND t.tgenabled <> 'D'
  ),
  'published legal records have enabled UPDATE and DELETE immutability triggers'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.legal_acceptances'::regclass
      AND NOT t.tgisinternal
      AND (t.tgtype & 16) = 16
      AND t.tgenabled <> 'D'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.legal_acceptances'::regclass
      AND NOT t.tgisinternal
      AND (t.tgtype & 8) = 8
      AND t.tgenabled <> 'D'
  ),
  'acknowledgements block rewrites without blocking lifecycle deletion'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.alsa_membership_periods'::regclass
      AND p.proname = 'guard_alsa_membership_period_overlap'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ),
  'membership periods have the overlap guard enabled'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'active_user_update'
      AND permissive = 'RESTRICTIVE'
      AND coalesce(qual, '') LIKE '%is_active_user%'
  ),
  'suspended accounts are blocked by a restrictive profile write policy'
);

SELECT * FROM finish();
ROLLBACK;
