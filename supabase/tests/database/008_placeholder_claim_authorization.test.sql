BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Exercise the auth trigger so self mode can prove email ownership against
-- auth.users without trusting any API-supplied email value.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (
  '64000000-0000-4000-8000-000000000002',
  'self-claim-640@example.test',
  clock_timestamp(),
  '{"first_name":"Self","last_name":"Target","alias":"Claim640Self"}'::jsonb
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '64000000-0000-4000-8000-000000000007',
  'unconfirmed-640@example.test',
  '{"first_name":"Unconfirmed","last_name":"Target","alias":"Claim640Unconfirmed"}'::jsonb
);

UPDATE public.profiles
   SET dob = DATE '1990-01-01'
 WHERE id = '64000000-0000-4000-8000-000000000002';
UPDATE public.profiles
   SET dob = DATE '1990-01-02'
 WHERE id = '64000000-0000-4000-8000-000000000007';

INSERT INTO public.profiles (
  id, first_name, alias, dob, roles, suspended, is_placeholder, placeholder_email
)
VALUES
  ('64000000-0000-4000-8000-000000000001', 'Admin', 'Claim640Admin', DATE '1980-01-01', ARRAY['alsa_committee','player']::text[], false, false, NULL),
  ('64000000-0000-4000-8000-000000000003', 'Admin target', 'Claim640AdminTarget', DATE '1991-01-01', ARRAY['player']::text[], false, false, NULL),
  ('64000000-0000-4000-8000-000000000004', 'Ordinary', 'Claim640Ordinary', DATE '1992-01-01', ARRAY['player']::text[], false, false, NULL),
  ('64000000-0000-4000-8000-000000000005', 'Suspended admin', 'Claim640Suspended', DATE '1981-01-01', ARRAY['alsa_committee','player']::text[], true, false, NULL),
  ('64000000-0000-4000-8000-000000000006', 'Conflict target', 'Claim640ConflictTarget', DATE '1993-01-01', ARRAY['player']::text[], false, false, NULL),
  ('64000000-0000-4000-8000-000000000101', 'Unrelated source', 'Claim640UnrelatedSource', DATE '1994-01-01', ARRAY['player']::text[], false, true, 'other-640@example.test'),
  ('64000000-0000-4000-8000-000000000102', 'Self source', 'Claim640SelfSource', DATE '1995-01-01', ARRAY['player']::text[], false, true, 'self-claim-640@example.test'),
  ('64000000-0000-4000-8000-000000000103', 'Admin source', 'Claim640AdminSource', DATE '1996-01-01', ARRAY['player']::text[], false, true, 'nonmatching-640@example.test'),
  ('64000000-0000-4000-8000-000000000104', 'Ordinary source', 'Claim640OrdinarySource', DATE '1997-01-01', ARRAY['player']::text[], false, true, NULL),
  ('64000000-0000-4000-8000-000000000105', 'Suspended source', 'Claim640SuspendedSource', DATE '1998-01-01', ARRAY['player']::text[], false, true, NULL),
  ('64000000-0000-4000-8000-000000000106', 'Conflict source', 'Claim640ConflictSource', DATE '1999-01-01', ARRAY['player']::text[], false, true, NULL),
  ('64000000-0000-4000-8000-000000000107', 'Unconfirmed source', 'Claim640UnconfirmedSource', DATE '2000-01-01', ARRAY['player']::text[], false, true, 'unconfirmed-640@example.test'),
  ('64000000-0000-4000-8000-000000000112', 'Revoked target source', 'Claim640RevokedSource', DATE '2001-01-05', ARRAY['player']::text[], false, true, NULL);

INSERT INTO public.profiles (
  id, dob, roles, suspended, is_placeholder, access_revoked_at, access_revoked_by
)
VALUES (
  '64000000-0000-4000-8000-000000000008',
  NULL,
  ARRAY['player']::text[],
  true,
  false,
  clock_timestamp(),
  '64000000-0000-4000-8000-000000000001'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_index AS index_record
     WHERE index_record.indexrelid = 'public.profiles_alias_lower_unique'::regclass
       AND index_record.indisunique
       AND pg_get_indexdef(index_record.indexrelid) ILIKE '%lower(btrim(alias))%'
  ),
  'profile aliases have a normalized case-insensitive unique boundary'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_record
     WHERE constraint_record.conrelid = 'public.profiles'::regclass
       AND constraint_record.conname = 'profiles_alias_trimmed_nonempty'
       AND constraint_record.contype = 'c'
       AND constraint_record.convalidated
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%alias = btrim(alias)%'
  ),
  'profile aliases have a validated canonical-value constraint'
);

SELECT throws_matching(
  $$
    INSERT INTO public.profiles (id, first_name, alias, dob, roles)
    VALUES (
      '64000000-0000-4000-8000-000000000108',
      'Padded alias', ' Claim640Padded ', DATE '2001-01-01', ARRAY['player']::text[]
    )
  $$,
  'violates check constraint "profiles_alias_trimmed_nonempty"',
  'edge-space aliases are rejected instead of creating an ownership lookalike'
);

SELECT throws_matching(
  $$
    INSERT INTO public.profiles (id, first_name, alias, dob, roles)
    VALUES (
      '64000000-0000-4000-8000-000000000109',
      'Blank alias', '', DATE '2001-01-02', ARRAY['player']::text[]
    )
  $$,
  'violates check constraint "profiles_alias_trimmed_nonempty"',
  'blank aliases are rejected rather than stored as ambiguous identifiers'
);

INSERT INTO public.profiles (id, first_name, alias, dob, roles)
VALUES (
  '64000000-0000-4000-8000-000000000110',
  'Unique alias', 'Claim640Normalized', DATE '2001-01-03', ARRAY['player']::text[]
);

SELECT throws_matching(
  $$
    INSERT INTO public.profiles (id, first_name, alias, dob, roles)
    VALUES (
      '64000000-0000-4000-8000-000000000111',
      'Duplicate alias', 'claim640normalized', DATE '2001-01-04', ARRAY['player']::text[]
    )
  $$,
  'duplicate key value violates unique constraint "profiles_alias_lower_unique"',
  'case variants cannot bypass normalized alias uniqueness'
);

UPDATE public.zltac_events SET status = 'draft' WHERE status = 'open';
INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date,
  reg_open_date, reg_close_date, event_starts_at, timezone, main_fee
)
VALUES (
  '64000000-0000-4000-8000-000000000201',
  'Placeholder claim authorization fixture',
  2188,
  'open',
  DATE '2188-07-01',
  DATE '2188-07-03',
  clock_timestamp() - interval '1 day',
  clock_timestamp() + interval '30 days',
  clock_timestamp() + interval '31 days',
  'Australia/Sydney',
  1000
);

INSERT INTO public.zltac_registrations (id, user_id, year, status)
VALUES
  ('64000000-0000-4000-8000-000000000301', '64000000-0000-4000-8000-000000000102', 2188, 'pending'),
  ('64000000-0000-4000-8000-000000000302', '64000000-0000-4000-8000-000000000106', 2188, 'pending'),
  ('64000000-0000-4000-8000-000000000303', '64000000-0000-4000-8000-000000000006', 2188, 'pending');

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.merge_placeholder_profile(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.merge_placeholder_profile(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'only the server workflow role can invoke the actor-explicit merge'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.claim_placeholder_profile(uuid,uuid)',
    'EXECUTE'
  ),
  'the ambiguous two-argument service contract is retired'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000002',
    '64000000-0000-4000-8000-000000000101',
    '64000000-0000-4000-8000-000000000002',
    'self'
  )->>'error'),
  'placeholder does not belong to caller',
  'self mode rejects an unrelated placeholder'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000007',
    '64000000-0000-4000-8000-000000000107',
    '64000000-0000-4000-8000-000000000007',
    'self'
  )->>'error'),
  'placeholder does not belong to caller',
  'self mode rejects an email match until the Auth email is confirmed'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000002',
    '64000000-0000-4000-8000-000000000102',
    '64000000-0000-4000-8000-000000000002',
    'self'
  )->>'ok'),
  'true',
  'self mode accepts a placeholder whose recorded email is confirmed for the actor'
);

SELECT is(
  (SELECT user_id FROM public.zltac_registrations
    WHERE id = '64000000-0000-4000-8000-000000000301'),
  '64000000-0000-4000-8000-000000000002'::uuid,
  'the self merge moves the existing registration atomically'
);
SELECT is(
  (SELECT count(*) FROM public.profiles
    WHERE id = '64000000-0000-4000-8000-000000000102'),
  0::bigint,
  'the successfully merged placeholder is removed'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000103',
    '64000000-0000-4000-8000-000000000003',
    'admin'
  )->>'ok'),
  'true',
  'active committee mode deliberately links a nonmatching placeholder'
);

SELECT ok(
  has_table_privilege('service_role', 'public.placeholder_merge_audit', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.placeholder_merge_audit', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.placeholder_merge_audit', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.placeholder_merge_audit', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.placeholder_merge_audit', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.placeholder_merge_audit', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.placeholder_merge_audit', 'TRUNCATE'),
  'the merge audit is service-readable but has no direct mutation privilege'
);

SELECT is(
  (SELECT count(*) FROM public.placeholder_merge_audit),
  2::bigint,
  'only the two successful merges append audit rows'
);
SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.placeholder_merge_audit
     WHERE actor_id = '64000000-0000-4000-8000-000000000002'
       AND source_placeholder_id = '64000000-0000-4000-8000-000000000102'
       AND target_profile_id = '64000000-0000-4000-8000-000000000002'
       AND mode = 'self'
       AND merged_at IS NOT NULL
  ) AND EXISTS (
    SELECT 1
      FROM public.placeholder_merge_audit
     WHERE actor_id = '64000000-0000-4000-8000-000000000001'
       AND source_placeholder_id = '64000000-0000-4000-8000-000000000103'
       AND target_profile_id = '64000000-0000-4000-8000-000000000003'
       AND mode = 'admin'
       AND merged_at IS NOT NULL
  ),
  'successful self and admin merges record actor, source, target, mode, and time'
);

SELECT throws_ok(
  $$UPDATE public.placeholder_merge_audit SET mode = 'admin'$$,
  '55000',
  'Placeholder merge audit records are immutable.',
  'merge audit rows cannot be updated'
);
SELECT throws_ok(
  $$DELETE FROM public.placeholder_merge_audit$$,
  '55000',
  'Placeholder merge audit records are immutable.',
  'merge audit rows cannot be deleted'
);
SELECT throws_ok(
  $$TRUNCATE public.placeholder_merge_audit$$,
  '55000',
  'Placeholder merge audit records are immutable.',
  'the entire merge audit cannot be truncated'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000004',
    '64000000-0000-4000-8000-000000000104',
    '64000000-0000-4000-8000-000000000003',
    'admin'
  )->>'error'),
  'not authorised',
  'an ordinary actor cannot select admin mode'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000005',
    '64000000-0000-4000-8000-000000000105',
    '64000000-0000-4000-8000-000000000003',
    'admin'
  )->>'error'),
  'not authorised',
  'a suspended committee actor cannot merge a placeholder'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000105',
    '64000000-0000-4000-8000-000000000005',
    'admin'
  )->>'error'),
  'target profile is not active',
  'admin mode cannot merge into a suspended target profile'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000112',
    '64000000-0000-4000-8000-000000000008',
    'admin'
  )->>'error'),
  'target profile is not active',
  'admin mode cannot merge into a permanently access-revoked target profile'
);

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000106',
    '64000000-0000-4000-8000-000000000006',
    'admin'
  )->>'error'),
  'both profiles have registrations for the same year; reconcile manually before claiming',
  'the established same-year conflict remains fail closed'
);
SELECT is(
  (SELECT count(*) FROM public.profiles
    WHERE id = '64000000-0000-4000-8000-000000000106'),
  1::bigint,
  'a conflict leaves the source profile intact'
);

-- Prove alias is not a fallback ownership credential even if the normalized
-- alias boundary were disabled by operational drift. These DDL changes are
-- transaction-local and the final ROLLBACK restores the real schema.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_alias_trimmed_nonempty;
DROP INDEX public.profiles_alias_lower_unique;
UPDATE public.profiles
   SET alias = 'Claim640Self'
 WHERE id = '64000000-0000-4000-8000-000000000101';

SELECT is(
  (public.merge_placeholder_profile(
    '64000000-0000-4000-8000-000000000002',
    '64000000-0000-4000-8000-000000000101',
    '64000000-0000-4000-8000-000000000002',
    'self'
  )->>'error'),
  'placeholder does not belong to caller',
  'self mode rejects an alias-only match when the verified emails differ'
);
SELECT is(
  (SELECT count(*) FROM public.placeholder_merge_audit
    WHERE source_placeholder_id IN (
      '64000000-0000-4000-8000-000000000101',
      '64000000-0000-4000-8000-000000000105',
      '64000000-0000-4000-8000-000000000106',
      '64000000-0000-4000-8000-000000000107',
      '64000000-0000-4000-8000-000000000112'
    )),
  0::bigint,
  'failed ownership, inactive-target, and conflict attempts append no audit row'
);

SELECT * FROM finish();
ROLLBACK;
