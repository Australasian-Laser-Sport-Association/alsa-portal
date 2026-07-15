CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Fixed identities make this test repeatable in a disposable database. Keep
-- one active superadmin at the end because 61000 intentionally prevents a
-- database that has had a superadmin from returning to zero. Access-audit
-- evidence is immutable, so this suite never deletes it.

INSERT INTO public.profiles (id, first_name, alias, roles, suspended)
VALUES (
  '61010000-0000-4000-8000-000000000002',
  'Governance Admin B',
  'GovernanceAdminB',
  ARRAY['superadmin', 'player']::text[],
  false
)
ON CONFLICT (id) DO UPDATE
  SET roles = EXCLUDED.roles,
      suspended = false;

CREATE TEMP TABLE governance_counter_before_conflict AS
SELECT active_superadmin_count
  FROM public.profile_governance_state
 WHERE singleton;

INSERT INTO public.profiles (id, first_name, alias, roles, suspended)
VALUES (
  '61010000-0000-4000-8000-000000000002',
  'Governance Admin B',
  'GovernanceAdminB',
  ARRAY['superadmin', 'player']::text[],
  false
)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (SELECT active_superadmin_count::bigint
     FROM public.profile_governance_state WHERE singleton),
  (SELECT active_superadmin_count::bigint
     FROM governance_counter_before_conflict),
  'an idempotent conflicting insert does not drift the governance counter'
);

-- Earlier database suites may intentionally leave a superadmin sentinel so
-- their own cleanup cannot violate 61000. Temporarily demote those unrelated
-- sentinels, then restore their exact role arrays before this suite finishes.
CREATE TEMP TABLE governance_other_superadmins AS
SELECT id, roles
  FROM public.profiles
 WHERE NOT suspended
   AND 'superadmin' = ANY (roles)
   AND id NOT IN (
     '61010000-0000-4000-8000-000000000001',
     '61010000-0000-4000-8000-000000000002'
   );

UPDATE public.profiles AS profile
   SET roles = array_remove(profile.roles, 'superadmin')
  FROM governance_other_superadmins AS saved
 WHERE profile.id = saved.id;

INSERT INTO public.profiles (id, first_name, alias, roles, suspended)
VALUES
  (
    '61010000-0000-4000-8000-000000000001',
    'Governance Admin A',
    'GovernanceAdminA',
    ARRAY['superadmin', 'player']::text[],
    false
  ),
  (
    '61010000-0000-4000-8000-000000000003',
    'Governance Player',
    'GovernancePlayer',
    ARRAY['player']::text[],
    false
  ),
  (
    '61010000-0000-4000-8000-000000000004',
    'Canonical Committee',
    'CanonicalCommittee',
    ARRAY['player', 'alsa_committee']::text[],
    false
  )
ON CONFLICT (id) DO UPDATE
  SET roles = EXCLUDED.roles,
      suspended = false;

SELECT is(
  (SELECT roles::text FROM public.profiles
    WHERE id = '61010000-0000-4000-8000-000000000004'),
  '{alsa_committee,player}'::text,
  'valid profile roles are normalized to canonical order'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET roles = ARRAY['made_up_role', 'player']::text[]
     WHERE id = '61010000-0000-4000-8000-000000000003'
  $$,
  'P0001',
  'Profile roles contain an unknown role.',
  'unknown roles are rejected in PostgreSQL'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET roles = ARRAY['player', 'player']::text[]
     WHERE id = '61010000-0000-4000-8000-000000000003'
  $$,
  'P0001',
  'Profile roles must not contain duplicates.',
  'duplicate roles are rejected in PostgreSQL'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET roles = ARRAY['alsa_committee']::text[]
     WHERE id = '61010000-0000-4000-8000-000000000003'
  $$,
  'P0001',
  'Profile roles must include the base player role.',
  'the base player role cannot be omitted'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET suspended = true
     WHERE id = '61010000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Remove the superadmin role before suspending this account.',
  'a superadmin must be demoted before suspension'
);

SELECT ok(
  NOT has_column_privilege('service_role', 'public.profiles', 'roles', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.profiles', 'suspended', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.profiles', 'alsa_position', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.profiles', 'access_revoked_at', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.profiles', 'access_revoked_by', 'UPDATE'),
  'the service role cannot bypass the audited profile-governance RPC'
);

SELECT ok(
  NOT has_column_privilege('anon', 'public.profiles', 'access_revoked_at', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.profiles', 'access_revoked_by', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.profiles', 'access_revoked_at', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.profiles', 'access_revoked_by', 'SELECT'),
  'browser roles cannot read permanent access-revocation evidence'
);

SELECT ok(
  has_function_privilege(
    'service_role', 'public.profile_roles_are_canonical(text[])', 'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated', 'public.profile_roles_are_canonical(text[])', 'EXECUTE'
  ),
  'normal profile writers can evaluate the canonical-role CHECK predicate'
);

SET ROLE service_role;
UPDATE public.profiles
   SET alias = alias
 WHERE id = '61010000-0000-4000-8000-000000000003';
RESET ROLE;

-- Two sessions submit opposing demotions. The RPC advisory lock makes the
-- second call wait; after the first commits, the second call re-authorizes its
-- now-demoted actor and fails before it can remove the final superadmin.
-- These suites run only against `supabase test db`; `postgres` is the fixed
-- disposable local-stack password, never a hosted-project credential.
DO $concurrency$
DECLARE
  v_connection text := format(
    'host=%s port=%s dbname=%s user=%s password=postgres',
    inet_server_addr(), inet_server_port(), current_database(), current_user
  );
BEGIN
  PERFORM extensions.dblink_connect('governance_concurrent_1', v_connection);
  PERFORM extensions.dblink_connect('governance_concurrent_2', v_connection);
  PERFORM extensions.dblink_exec('governance_concurrent_1', 'BEGIN');
  PERFORM response.result
    FROM extensions.dblink(
      'governance_concurrent_1',
      $$SELECT public.admin_mutate_profile_access(
        '61010000-0000-4000-8000-000000000001',
        '61010000-0000-4000-8000-000000000002',
        'roles',
        '{"roles":["player"]}'::jsonb
      )$$
    ) AS response(result jsonb);
  PERFORM extensions.dblink_send_query(
    'governance_concurrent_2',
    $$SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000002',
      '61010000-0000-4000-8000-000000000001',
      'roles',
      '{"roles":["player"]}'::jsonb
    )$$
  );
  PERFORM pg_sleep(0.15);
END;
$concurrency$;

SELECT is(
  extensions.dblink_is_busy('governance_concurrent_2')::bigint,
  1::bigint,
  'a concurrent opposing demotion waits on the governance transaction lock'
);

SELECT lives_ok(
  $$SELECT extensions.dblink_exec('governance_concurrent_1', 'COMMIT')$$,
  'the first audited demotion commits while another superadmin remains'
);

SELECT throws_ok(
  $$
    SELECT *
      FROM extensions.dblink_get_result('governance_concurrent_2')
        AS result(status text)
  $$,
  'P0001',
  'Forbidden.',
  'the waiting request re-authorizes its actor and cannot remove the final superadmin'
);

DO $$
BEGIN
  PERFORM extensions.dblink_disconnect('governance_concurrent_1');
  PERFORM extensions.dblink_disconnect('governance_concurrent_2');
END;
$$;

SELECT is(
  (SELECT active_superadmin_count::bigint
     FROM public.profile_governance_state WHERE singleton),
  1::bigint,
  'the active-superadmin counter remains exact after concurrent demotions'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET roles = ARRAY['player']::text[]
     WHERE id = '61010000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'At least one active superadmin must remain.',
  'even a sequential owner write cannot remove the final active superadmin'
);

-- Exercise another service-only RPC and leave A as the sentinel.

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000001',
      '61010000-0000-4000-8000-000000000002',
      'roles',
      '{"roles":["zltac_committee","player"],"alsa_position":"Treasurer"}'::jsonb
    )
  $$,
  'the service governance RPC applies a valid role change'
);

SELECT is(
  (SELECT (count(*) >= 1) FROM public.profile_access_audit
    WHERE profile_id = '61010000-0000-4000-8000-000000000002'
      AND actor_id = '61010000-0000-4000-8000-000000000001'
      AND action = 'roles'
      AND new_roles = ARRAY['zltac_committee', 'player']::text[]
      AND new_alsa_position = 'Treasurer'),
  true,
  'the role RPC writes attributed append-only audit evidence'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000001',
      '61010000-0000-4000-8000-000000000003',
      'suspension',
      '{"suspended":true}'::jsonb
    )
  $$,
  'a committee governance action can suspend a regular account'
);

SELECT ok(
  (SELECT suspended FROM public.profiles
    WHERE id = '61010000-0000-4000-8000-000000000003'),
  'the suspension mutation updates the guarded profile state'
);

-- Permanent access removal is represented by an attributed tombstone. Once
-- committed, every ordinary profile-access path and direct profile write must
-- fail closed rather than recreating access or identity data.
CREATE TEMP TABLE access_revocation_fixture AS
SELECT gen_random_uuid() AS id;

INSERT INTO public.profiles (id, first_name, alias, email, roles, suspended)
SELECT
  id,
  'Revoked',
  'RevokedPlayer',
  id::text || '@governance.example.test',
  ARRAY['player']::text[],
  false
FROM access_revocation_fixture;

-- Seed subject-owned acknowledgements plus a separate approval reviewed by the
-- target. Remove access must delete the former and only detach the latter.
CREATE TEMP TABLE acknowledgement_cleanup_other_subject AS
SELECT gen_random_uuid() AS id;

INSERT INTO public.profiles (id, first_name, alias, roles, suspended)
SELECT
  id,
  'Other approval subject',
  'OtherApprovalSubject-' || left(id::text, 8),
  ARRAY['player']::text[],
  false
FROM acknowledgement_cleanup_other_subject;

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date, timezone
) VALUES (
  '61020000-0000-4000-8000-000000000001',
  'Governance acknowledgement cleanup',
  2610,
  'closed',
  DATE '2610-07-01',
  DATE '2610-07-03',
  'Australia/Sydney'
)
ON CONFLICT (year) DO NOTHING;

CREATE TEMP TABLE governance_previous_active_documents AS
SELECT id
  FROM public.legal_documents
 WHERE document_type IN ('code_of_conduct', 'under_18_form')
   AND is_active;

CREATE TEMP TABLE governance_acknowledgement_documents AS
SELECT
  (public.publish_legal_document(
    'code_of_conduct',
    format('legal/code_of_conduct/%s.pdf', gen_random_uuid()),
    'Governance Code of Conduct.pdf',
    DATE '2026-07-15',
    '61010000-0000-4000-8000-000000000001',
    true,
    NULL,
    repeat('a', 64),
    1024
  )->>'id')::uuid AS code_of_conduct_id,
  (public.publish_legal_document(
    'under_18_form',
    format('legal/under_18_form/%s.pdf', gen_random_uuid()),
    'Governance Under 18 Form.pdf',
    DATE '2026-07-15',
    '61010000-0000-4000-8000-000000000001',
    true,
    NULL,
    repeat('b', 64),
    1024
  )->>'id')::uuid AS under_18_form_id;

INSERT INTO public.legal_acceptances (
  user_id, document_id, event_year, ip_address, user_agent
)
SELECT
  fixture.id,
  document.code_of_conduct_id,
  2610,
  NULL,
  NULL
FROM access_revocation_fixture AS fixture
CROSS JOIN governance_acknowledgement_documents AS document;

INSERT INTO public.under_18_approvals (
  user_id, event_year, document_id, status, submitted_at, notes
)
SELECT
  fixture.id,
  2610,
  document.under_18_form_id,
  'pending',
  clock_timestamp(),
  'subject-owned note must be deleted'
FROM access_revocation_fixture AS fixture
CROSS JOIN governance_acknowledgement_documents AS document;

INSERT INTO public.under_18_approvals (
  user_id, event_year, document_id, status,
  approved_at, approved_by, notes
)
SELECT
  subject.id,
  2610,
  document.under_18_form_id,
  'approved',
  clock_timestamp(),
  fixture.id,
  'other subject decision remains'
FROM acknowledgement_cleanup_other_subject AS subject
CROSS JOIN access_revocation_fixture AS fixture
CROSS JOIN governance_acknowledgement_documents AS document;

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000001',
      (SELECT id FROM access_revocation_fixture),
      'remove-access',
      '{}'::jsonb
    )
  $$,
  'a superadmin can commit an attributed permanent access revocation'
);

SELECT ok(
  (
    SELECT profile.access_revoked_at IS NOT NULL
       AND profile.access_revoked_by = '61010000-0000-4000-8000-000000000001'
       AND profile.suspended
       AND profile.roles = ARRAY['player']::text[]
       AND profile.first_name IS NULL
       AND profile.alias IS NULL
       AND profile.email IS NULL
      FROM public.profiles AS profile
      JOIN access_revocation_fixture AS fixture ON fixture.id = profile.id
  ),
  'remove-access retains a disabled anonymized profile with actor and time'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.legal_acceptances AS acceptance
      JOIN access_revocation_fixture AS fixture
        ON fixture.id = acceptance.user_id
  ),
  0::bigint,
  'remove-access deletes the subject owned acknowledgements'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.under_18_approvals AS approval
      JOIN access_revocation_fixture AS fixture
        ON fixture.id = approval.user_id
  ),
  0::bigint,
  'remove-access deletes the subject owned under-18 workflow row'
);

SELECT ok(
  (
    SELECT approval.approved_by IS NULL
       AND approval.status = 'approved'
       AND approval.approved_at IS NOT NULL
       AND approval.notes = 'other subject decision remains'
      FROM public.under_18_approvals AS approval
      JOIN acknowledgement_cleanup_other_subject AS subject
        ON subject.id = approval.user_id
     WHERE approval.event_year = 2610
  ),
  'remove-access detaches reviewer attribution without deleting another subject decision'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.profile_access_audit AS audit
      JOIN access_revocation_fixture AS fixture ON fixture.id = audit.profile_id
     WHERE audit.actor_id = '61010000-0000-4000-8000-000000000001'
       AND audit.action = 'remove-access'
       AND audit.old_access_revoked_at IS NULL
       AND audit.new_access_revoked_at IS NOT NULL
       AND audit.new_access_revoked_by = audit.actor_id
  ),
  1::bigint,
  'the permanent revocation writes attributed immutable audit evidence'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000001',
      (SELECT id FROM access_revocation_fixture),
      'suspension',
      '{"suspended":false}'::jsonb
    )
  $$,
  'P0001',
  'Account access has been permanently revoked.',
  'ordinary suspension restore cannot reopen a revoked account'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000001',
      (SELECT id FROM access_revocation_fixture),
      'roles',
      '{"roles":["alsa_committee","player"]}'::jsonb
    )
  $$,
  'P0001',
  'Account access has been permanently revoked.',
  'role mutation cannot reopen a revoked account'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_profile_access(
      '61010000-0000-4000-8000-000000000001',
      (SELECT id FROM access_revocation_fixture),
      'reset',
      '{}'::jsonb
    )
  $$,
  'P0001',
  'Account access has been permanently revoked.',
  'account reset cannot clear a permanent revocation'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET alias = 'Reopened'
     WHERE id = (SELECT id FROM access_revocation_fixture)
  $$,
  'P0001',
  'Account access has been permanently revoked.',
  'a direct profile write cannot repopulate a revoked tombstone'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
       SET access_revoked_at = clock_timestamp(),
           access_revoked_by = '61010000-0000-4000-8000-000000000001'
     WHERE id = '61010000-0000-4000-8000-000000000003'
  $$,
  'P0001',
  'Account access revocation must use an attributed governance operation.',
  'a direct write cannot fabricate a revocation tombstone'
);

SELECT throws_ok(
  $$
    UPDATE public.profile_access_audit
       SET action = action
     WHERE profile_id = (SELECT id FROM access_revocation_fixture)
  $$,
  'P0001',
  'Profile access audit rows are immutable.',
  'profile access audit evidence cannot be rewritten even by the owner'
);

SELECT throws_ok(
  $$
    DELETE FROM public.profiles
     WHERE id = '61010000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Portal accounts cannot be hard-deleted; remove access and anonymise instead.',
  'a real portal account cannot be hard-deleted even by a table owner'
);

-- Empty placeholders remain removable, while any current or historical FK
-- reference blocks the deletion.
DELETE FROM public.profiles
 WHERE id IN (
   '61010000-0000-4000-8000-000000000010',
   '61010000-0000-4000-8000-000000000011'
 );
INSERT INTO public.profiles (id, alias, roles, is_placeholder)
VALUES (
  '61010000-0000-4000-8000-000000000010',
  'ReferencedPlaceholder',
  ARRAY['player']::text[],
  true
), (
  '61010000-0000-4000-8000-000000000011',
  'ChildPlaceholder',
  ARRAY['player']::text[],
  true
);
UPDATE public.profiles
   SET created_by_admin_id = '61010000-0000-4000-8000-000000000010'
 WHERE id = '61010000-0000-4000-8000-000000000011';

SELECT throws_ok(
  $$
    DELETE FROM public.profiles
     WHERE id = '61010000-0000-4000-8000-000000000010'
  $$,
  'P0001',
  'This placeholder has retained history and cannot be hard-deleted.',
  'a referenced placeholder cannot be hard-deleted'
);

UPDATE public.profiles
   SET created_by_admin_id = NULL
 WHERE id = '61010000-0000-4000-8000-000000000011';
SELECT lives_ok(
  $$
    DELETE FROM public.profiles
     WHERE id IN (
       '61010000-0000-4000-8000-000000000010',
       '61010000-0000-4000-8000-000000000011'
     )
  $$,
  'truly empty placeholders can still be cleaned up'
);

-- Exercise the real auth trigger: deleting authentication access preserves the
-- governance tombstone while removing operational acknowledgement data.
CREATE TEMP TABLE auth_delete_fixture AS
SELECT gen_random_uuid() AS id;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT
  id,
  id::text || '@governance.example.test',
  '{"first_name":"Delete","last_name":"Preserve","alias":"PreserveMe"}'::jsonb
FROM auth_delete_fixture;

INSERT INTO public.legal_acceptances (
  user_id, document_id, event_year, ip_address, user_agent
)
SELECT
  fixture.id,
  document.code_of_conduct_id,
  2610,
  NULL,
  NULL
FROM auth_delete_fixture AS fixture
CROSS JOIN governance_acknowledgement_documents AS document;

INSERT INTO public.under_18_approvals (
  user_id, event_year, document_id, status, submitted_at, notes
)
SELECT
  fixture.id,
  2610,
  document.under_18_form_id,
  'pending',
  clock_timestamp(),
  'auth-delete subject note must be deleted'
FROM auth_delete_fixture AS fixture
CROSS JOIN governance_acknowledgement_documents AS document;

UPDATE public.under_18_approvals AS approval
   SET approved_by = fixture.id
  FROM auth_delete_fixture AS fixture,
       acknowledgement_cleanup_other_subject AS subject
 WHERE approval.user_id = subject.id
   AND approval.event_year = 2610;

DELETE FROM auth.users AS auth_user
USING auth_delete_fixture AS fixture
WHERE auth_user.id = fixture.id;

SELECT is(
  (
    SELECT count(*)
      FROM public.profiles AS profile
      JOIN auth_delete_fixture AS fixture ON fixture.id = profile.id
     WHERE profile.suspended
       AND profile.roles = ARRAY['player']::text[]
       AND profile.access_revoked_at IS NOT NULL
       AND profile.access_revoked_by = profile.id
       AND profile.first_name IS NULL
       AND profile.last_name IS NULL
       AND profile.alias IS NULL
  ),
  1::bigint,
  'Auth deletion tombstones and anonymizes the profile without deleting it'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.legal_acceptances AS acceptance
      JOIN auth_delete_fixture AS fixture ON fixture.id = acceptance.user_id
  ),
  0::bigint,
  'Auth deletion removes the subject owned acknowledgements'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.under_18_approvals AS approval
      JOIN auth_delete_fixture AS fixture ON fixture.id = approval.user_id
  ),
  0::bigint,
  'Auth deletion removes the subject owned under-18 workflow row'
);

SELECT ok(
  (
    SELECT approval.approved_by IS NULL
       AND approval.status = 'approved'
       AND approval.approved_at IS NOT NULL
      FROM public.under_18_approvals AS approval
      JOIN acknowledgement_cleanup_other_subject AS subject
        ON subject.id = approval.user_id
     WHERE approval.event_year = 2610
  ),
  'Auth deletion detaches reviewer attribution from another subject decision'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.profile_access_audit AS audit
      JOIN auth_delete_fixture AS fixture ON fixture.id = audit.profile_id
     WHERE audit.action = 'auth-user-delete'
       AND audit.actor_id = fixture.id
       AND audit.new_access_revoked_by = fixture.id
       AND audit.new_access_revoked_at IS NOT NULL
  ),
  1::bigint,
  'Auth deletion leaves attributed permanent-revocation audit evidence'
);

-- Do not leak active publication state into later pgTAP files. Published test
-- rows remain immutable catalogue history, but only the previously active
-- versions (if any) are reactivated.
UPDATE public.legal_documents
   SET is_active = false
 WHERE id IN (
   SELECT code_of_conduct_id FROM governance_acknowledgement_documents
   UNION ALL
   SELECT under_18_form_id FROM governance_acknowledgement_documents
 );

UPDATE public.legal_documents
   SET is_active = true
 WHERE id IN (SELECT id FROM governance_previous_active_documents);

UPDATE public.profiles AS profile
   SET roles = saved.roles
  FROM governance_other_superadmins AS saved
 WHERE profile.id = saved.id;

SELECT * FROM finish();
