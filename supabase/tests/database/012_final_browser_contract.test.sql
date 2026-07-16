BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT extensions.no_plan();

-- Use the real signup trigger to create production-shaped profiles. Giving
-- one subject a committee role proves that roles no longer unlock cross-user
-- browser reads after the final service-API cutover.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '12000000-0000-4000-8000-000000000001',
    'browser-contract-committee@example.test',
    jsonb_build_object(
      'first_name', 'Contract',
      'last_name', 'Committee',
      'alias', 'ContractCommittee',
      'dob', '1990-01-01',
      'state', 'NSW'
    )
  ),
  (
    '12000000-0000-4000-8000-000000000002',
    'browser-contract-player@example.test',
    jsonb_build_object(
      'first_name', 'Contract',
      'last_name', 'Player',
      'alias', 'ContractPlayer',
      'dob', '1991-01-01',
      'state', 'VIC'
    )
  );

UPDATE public.profiles
SET roles = ARRAY['alsa_committee', 'player']::text[]
WHERE id = '12000000-0000-4000-8000-000000000001';

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date,
  bank_bsb, bank_account_number, bank_account_name
)
VALUES (
  '12000000-0000-4000-8000-000000000010',
  'Final Browser Contract Event',
  2212,
  'open',
  DATE '2212-07-01',
  DATE '2212-07-03',
  '123-456',
  '987654321',
  'Private Contract Account'
);

INSERT INTO public.zltac_registrations (
  id, user_id, year, status, amount_owing, admin_note
)
VALUES
  (
    '12000000-0000-4000-8000-000000000011',
    '12000000-0000-4000-8000-000000000001',
    2212,
    'confirmed',
    1000,
    'committee subject private note'
  ),
  (
    '12000000-0000-4000-8000-000000000012',
    '12000000-0000-4000-8000-000000000002',
    2212,
    'confirmed',
    2000,
    'other subject private note'
  );

INSERT INTO public.payment_records (
  id, registration_id, amount, recorded_by, bank_reference, notes
)
VALUES
  (
    '12000000-0000-4000-8000-000000000021',
    '12000000-0000-4000-8000-000000000011',
    1000,
    '12000000-0000-4000-8000-000000000001',
    'CONTRACT-OWN',
    'own payment note'
  ),
  (
    '12000000-0000-4000-8000-000000000022',
    '12000000-0000-4000-8000-000000000012',
    2000,
    '12000000-0000-4000-8000-000000000001',
    'CONTRACT-OTHER',
    'other payment note'
  );

INSERT INTO public.legal_documents (
  id, document_type, version, file_path, original_filename,
  effective_date, uploaded_by, is_active, content_sha256,
  object_size, published_at
)
VALUES
  (
    '12000000-0000-4000-8000-000000000031',
    'code_of_conduct',
    2212,
    'legal/code_of_conduct/12000000-0000-4000-8000-000000000031.pdf',
    'contract-code.pdf',
    DATE '2212-01-01',
    '12000000-0000-4000-8000-000000000001',
    true,
    repeat('a', 64),
    1024,
    clock_timestamp()
  ),
  (
    '12000000-0000-4000-8000-000000000032',
    'under_18_form',
    2212,
    'legal/under_18_form/12000000-0000-4000-8000-000000000032.pdf',
    'contract-under-18.pdf',
    DATE '2212-01-01',
    '12000000-0000-4000-8000-000000000001',
    true,
    repeat('b', 64),
    1024,
    clock_timestamp()
  );

INSERT INTO public.legal_acceptances (
  id, user_id, document_id, event_year, ip_address, user_agent
)
VALUES
  (
    '12000000-0000-4000-8000-000000000041',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000031',
    2212,
    NULL,
    NULL
  ),
  (
    '12000000-0000-4000-8000-000000000042',
    '12000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000031',
    2212,
    NULL,
    NULL
  );

INSERT INTO public.under_18_approvals (
  id, user_id, event_year, document_id, status, submitted_at, notes
)
VALUES
  (
    '12000000-0000-4000-8000-000000000051',
    '12000000-0000-4000-8000-000000000001',
    2212,
    '12000000-0000-4000-8000-000000000032',
    'pending',
    clock_timestamp(),
    'own under-18 note'
  ),
  (
    '12000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000002',
    2212,
    '12000000-0000-4000-8000-000000000032',
    'pending',
    clock_timestamp(),
    'other under-18 note'
  );

-- Public Storage buckets serve bytes by exact object URL. Browser SQL roles
-- still must not be able to list or mutate the underlying object metadata.
INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'avatars',
    '12000000-0000-4000-8000-000000000001/contract-avatar.png'
  ),
  (
    'team-logos',
    '12000000-0000-4000-8000-000000000010/contract-logo.png'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '12000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  (SELECT count(*) FROM public.profiles),
  1::bigint,
  'a committee JWT sees only its own profile row'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.zltac_registrations),
  1::bigint,
  'a committee JWT sees only its own event registration'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.payment_records),
  1::bigint,
  'a committee JWT sees only payment records linked to its own registration'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.legal_acceptances),
  1::bigint,
  'a committee JWT sees only its own acknowledgement records'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.under_18_approvals),
  1::bigint,
  'a committee JWT sees only its own under-18 record'
);

SELECT extensions.throws_ok(
  $$SELECT bank_bsb FROM public.zltac_events WHERE year = 2212$$,
  '42501',
  'permission denied for table zltac_events',
  'authenticated roles cannot read private event banking fields directly'
);

SELECT extensions.throws_ok(
  $$SELECT admin_note FROM public.zltac_registrations WHERE year = 2212$$,
  '42501',
  'permission denied for table zltac_registrations',
  'authenticated roles cannot read registration committee notes'
);

SELECT extensions.throws_ok(
  $$SELECT id FROM public.team_members$$,
  '42501',
  'permission denied for table team_members',
  'team-member rows are available only through server-authoritative APIs'
);

SELECT extensions.is_empty(
  $$
    SELECT id
      FROM storage.objects
     WHERE bucket_id IN ('avatars', 'team-logos')
  $$,
  'authenticated browsers cannot enumerate public-bucket object metadata'
);

SELECT extensions.throws_matching(
  $$
    INSERT INTO storage.objects (bucket_id, name)
    VALUES (
      'team-logos',
      '12000000-0000-4000-8000-000000000010/browser-write.webp'
    )
  $$,
  'new row violates row-level security policy',
  'authenticated browsers cannot bypass the server-authorised logo route'
);

SELECT extensions.throws_ok(
  $$SELECT id FROM public.payment_records_history$$,
  '42501',
  'permission denied for table payment_records_history',
  'payment history is unavailable to browser roles'
);

SELECT extensions.throws_ok(
  $$SELECT id FROM public.profile_change_audit$$,
  '42501',
  'permission denied for table profile_change_audit',
  'profile audit records are unavailable to browser roles'
);

SELECT extensions.lives_ok(
  $$SELECT id, name, main_fee FROM public.public_zltac_events WHERE year = 2212$$,
  'the masked public event view remains readable'
);

SELECT extensions.lives_ok(
  $$
    UPDATE public.profiles
       SET phone = '0400000001'
     WHERE id = '12000000-0000-4000-8000-000000000001'
  $$,
  'an active user can still update a reviewed own-profile column'
);

SELECT extensions.is(
  (
    SELECT phone
    FROM public.profiles
    WHERE id = '12000000-0000-4000-8000-000000000001'
  ),
  '0400000001'::text,
  'the own-profile update is persisted'
);

SELECT extensions.is_empty(
  $$
    UPDATE public.profiles
       SET phone = '0400000002'
     WHERE id = '12000000-0000-4000-8000-000000000002'
    RETURNING id
  $$,
  'committee status does not permit a cross-user profile update'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.profiles
       SET roles = ARRAY['superadmin']::text[]
     WHERE id = '12000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table profiles',
  'a user cannot mutate server-managed profile roles'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.zltac_registrations (user_id, year)
    VALUES ('12000000-0000-4000-8000-000000000001', 2213)
  $$,
  '42501',
  'permission denied for table zltac_registrations',
  'registration writes remain service-authoritative'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.payment_records
       SET notes = 'browser rewrite'
     WHERE id = '12000000-0000-4000-8000-000000000021'
  $$,
  '42501',
  'permission denied for table payment_records',
  'payment writes remain service-authoritative'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.legal_acceptances
     WHERE id = '12000000-0000-4000-8000-000000000041'
  $$,
  '42501',
  'permission denied for table legal_acceptances',
  'acknowledgement records cannot be deleted by a browser role'
);

SELECT extensions.throws_ok(
  $$TRUNCATE TABLE public.backup_settings$$,
  '42501',
  'permission denied for table backup_settings',
  'browser roles cannot truncate operational tables'
);

RESET ROLE;

SELECT extensions.ok(
  to_regprocedure('public.can_write_team_logo(text)') IS NULL
  AND to_regprocedure('public.can_write_preteam_logo(text,text)') IS NULL,
  'retired browser Storage write helpers are absent'
);

SELECT extensions.is(
  (
    SELECT count(*)
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'storage'
       AND policy.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ),
  0::bigint,
  'no Storage policy is executable by a browser role'
);

SELECT * FROM extensions.finish();
ROLLBACK;
