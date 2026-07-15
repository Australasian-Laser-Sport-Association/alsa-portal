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

WITH server_written(name) AS (
  VALUES
    ('zltac_registrations'),
    ('under_18_approvals'),
    ('teams'),
    ('team_members'),
    ('competition_registrations'),
    ('doubles_pairs'),
    ('triples_teams'),
    ('legal_documents'),
    ('legal_acceptances'),
    ('volunteer_roles'),
    ('event_volunteer_settings'),
    ('volunteer_signups'),
    ('volunteer_signup_roles')
)
SELECT is(
  (
    SELECT count(*)
    FROM server_written AS t
    WHERE has_table_privilege(
      'authenticated', format('public.%I', t.name), 'INSERT'
    )
    OR has_table_privilege(
      'authenticated', format('public.%I', t.name), 'UPDATE'
    )
    OR has_table_privilege(
      'authenticated', format('public.%I', t.name), 'DELETE'
    )
    OR EXISTS (
      SELECT 1
      FROM information_schema.column_privileges AS cp
      WHERE cp.table_schema = 'public'
        AND cp.table_name = t.name
        AND cp.grantee = 'authenticated'
        AND cp.privilege_type IN ('INSERT', 'UPDATE')
    )
  ),
  0::bigint,
  'browser sessions have no table-level or column-level mutation grants on server-written data'
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
    'finish_portal_backup_run'
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
  27::bigint,
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
    'finish_portal_backup_run'
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
    'merge_placeholder_profile'
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
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'team_members'
      AND policyname = 'team_members_team_read'
      AND coalesce(qual, '') LIKE '%can_read_team_members%'
  ),
  'team member reads use the non-recursive SECURITY DEFINER helper'
);

SELECT ok(
  has_function_privilege(
    'authenticated', 'public.can_read_team_members(uuid)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.can_read_team_members(uuid)', 'EXECUTE'
  ),
  'team-member RLS helper is available only to authenticated and service roles'
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
  AND EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.legal_acceptances'::regclass
      AND NOT t.tgisinternal
      AND (t.tgtype & 8) = 8
      AND t.tgenabled <> 'D'
  ),
  'legal acceptance evidence has enabled UPDATE and DELETE retention triggers'
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
