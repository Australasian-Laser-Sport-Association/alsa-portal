BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '60000000-0000-4000-8000-000000000001',
  'privacy-fixture@example.test',
  '{"first_name":"Private","last_name":"Player","alias":"PrivacyPlayer","dob":"1990-01-01"}'::jsonb
);

INSERT INTO public.zltac_events (
  id, name, year, status, bank_bsb, bank_account_number, bank_account_name
) VALUES (
  '60000000-0000-4000-8000-000000000002',
  'Privacy Test Event',
  2191,
  'open',
  '123-456',
  '987654321',
  'Private Association Account'
);

INSERT INTO public.zltac_registrations (
  id, user_id, year, status, amount_owing, admin_note, dob_at_registration
) VALUES (
  '60000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000001',
  2191,
  'confirmed',
  1000,
  'committee-only note',
  DATE '1990-01-01'
);

INSERT INTO public.teams (
  id, name, captain_id, status, event_id, format, entry_type
) VALUES (
  '60000000-0000-4000-8000-000000000005',
  'Private Owner Team',
  '60000000-0000-4000-8000-000000000001',
  'pending',
  '60000000-0000-4000-8000-000000000002',
  'team',
  'direct_entry'
);

INSERT INTO public.legal_documents (
  id, document_type, version, file_path, original_filename, effective_date,
  uploaded_by, is_active, notes, content_sha256, object_size, published_at
) VALUES (
  '60000000-0000-4000-8000-000000000004',
  'code_of_conduct',
  99,
  'legal/code_of_conduct/60000000-0000-4000-8000-000000000004.pdf',
  'conduct.pdf',
  CURRENT_DATE,
  '60000000-0000-4000-8000-000000000001',
  true,
  'private publication note',
  repeat('a', 64),
  42,
  now()
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '60000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$SELECT bank_bsb FROM public.zltac_events WHERE year = 2191$$,
  '42501',
  'permission denied for table zltac_events',
  'authenticated users cannot read event bank instructions directly'
);

SELECT extensions.throws_ok(
  $$SELECT captain_id FROM public.teams$$,
  '42501',
  'permission denied for table teams',
  'authenticated users cannot read team ownership identifiers directly'
);

SELECT extensions.throws_ok(
  $$SELECT file_path FROM public.legal_documents WHERE version = 99$$,
  '42501',
  'permission denied for table legal_documents',
  'authenticated users cannot read raw legal storage paths'
);

SELECT extensions.throws_ok(
  $$SELECT admin_note FROM public.zltac_registrations WHERE year = 2191$$,
  '42501',
  'permission denied for table zltac_registrations',
  'authenticated users cannot read committee registration notes'
);

SELECT extensions.lives_ok(
  $$SELECT id, name, main_fee FROM public.public_zltac_events WHERE year = 2191$$,
  'the masked event discovery view remains readable'
);

SELECT extensions.is(
  (
    SELECT viewer_role
      FROM public.own_zltac_teams
     WHERE id = '60000000-0000-4000-8000-000000000005'
  ),
  'captain'::text,
  'the actor-scoped team view preserves legitimate owner access'
);

SELECT extensions.lives_ok(
  $$SELECT id, amount_owing FROM public.zltac_registrations WHERE year = 2191$$,
  'safe own-registration columns remain readable'
);

SELECT extensions.lives_ok(
  $$SELECT id, document_type, original_filename FROM public.legal_documents WHERE version = 99$$,
  'safe published legal metadata remains readable'
);

SELECT * FROM extensions.finish();
ROLLBACK;
