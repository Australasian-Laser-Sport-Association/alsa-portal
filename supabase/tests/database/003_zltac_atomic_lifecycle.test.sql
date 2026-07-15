BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Keep the partial unique index deterministic if a developer runs this test
-- against a disposable database that already has an open event.
UPDATE public.zltac_events SET status = 'draft' WHERE status = 'open';

INSERT INTO public.profiles (id, first_name, alias, dob, roles)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Committee', 'AtomicCommittee', DATE '1980-01-01', ARRAY['zltac_committee', 'player']::text[]),
  ('a1000000-0000-4000-8000-000000000002', 'Subject', 'AtomicSubject', DATE '1990-01-01', ARRAY['player']::text[]),
  ('a1000000-0000-4000-8000-000000000003', 'Partner One', 'AtomicPartnerOne', DATE '1991-01-01', ARRAY['player']::text[]),
  ('a1000000-0000-4000-8000-000000000004', 'Partner Two', 'AtomicPartnerTwo', DATE '1992-01-01', ARRAY['player']::text[]);

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date,
  reg_open_date, reg_close_date, event_starts_at, timezone,
  main_fee, side_events
) VALUES (
  'a2000000-0000-4000-8000-000000000001',
  'Atomic lifecycle fixture',
  2196,
  'open',
  DATE '2196-07-01',
  DATE '2196-07-03',
  clock_timestamp() - interval '1 day',
  clock_timestamp() + interval '30 days',
  clock_timestamp() + interval '31 days',
  'Australia/Sydney',
  1000,
  '[{"slug":"doubles","enabled":true,"price":500},{"slug":"triples","enabled":true,"price":700}]'::jsonb
);

INSERT INTO public.zltac_registrations (id, user_id, year, status)
VALUES
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 2196, 'pending'),
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 2196, 'pending'),
  ('a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', 2196, 'pending');

SELECT lives_ok(
  $$
    SELECT public.admin_replace_zltac_side_event_roster(
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002',
      2196,
      'doubles',
      ARRAY['a1000000-0000-4000-8000-000000000003']::uuid[]
    )
  $$,
  'committee doubles replacement succeeds as one transaction'
);

SELECT is(
  (SELECT count(*) FROM public.doubles_pairs WHERE event_year = 2196),
  1::bigint,
  'the first atomic replacement creates one doubles roster'
);
SELECT ok(
  (SELECT 'doubles' = ANY(side_events) FROM public.zltac_registrations WHERE user_id = 'a1000000-0000-4000-8000-000000000003'),
  'the first partner receives matching selection and pricing state'
);

SELECT lives_ok(
  $$
    SELECT public.admin_replace_zltac_side_event_roster(
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002',
      2196,
      'doubles',
      ARRAY['a1000000-0000-4000-8000-000000000004']::uuid[]
    )
  $$,
  'replacing a doubles partner is atomic'
);
SELECT ok(
  (SELECT NOT 'doubles' = ANY(coalesce(side_events, ARRAY[]::text[])) FROM public.zltac_registrations WHERE user_id = 'a1000000-0000-4000-8000-000000000003'),
  'a displaced partner loses stale selection and pricing state'
);
SELECT ok(
  (SELECT 'doubles' = ANY(side_events) FROM public.zltac_registrations WHERE user_id = 'a1000000-0000-4000-8000-000000000004'),
  'the replacement partner gains selection and pricing state'
);

SELECT lives_ok(
  $$
    SELECT public.cancel_zltac_registration(
      'a1000000-0000-4000-8000-000000000002', 2196
    )
  $$,
  'registration cancellation removes its linked rosters atomically'
);
SELECT is(
  (SELECT count(*) FROM public.zltac_registrations WHERE user_id = 'a1000000-0000-4000-8000-000000000002' AND year = 2196),
  0::bigint,
  'the cancelled registration is removed'
);
SELECT is(
  (SELECT count(*) FROM public.doubles_pairs WHERE event_year = 2196),
  0::bigint,
  'cancellation cannot strand a doubles roster'
);
SELECT ok(
  (SELECT NOT 'doubles' = ANY(coalesce(side_events, ARRAY[]::text[])) FROM public.zltac_registrations WHERE user_id = 'a1000000-0000-4000-8000-000000000004'),
  'cancellation removes stale partner pricing state'
);

UPDATE public.profiles
SET suspended = true
WHERE id = 'a1000000-0000-4000-8000-000000000003';

SELECT throws_ok(
  $$
    SELECT public.admin_replace_zltac_side_event_roster(
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      2196,
      'doubles',
      ARRAY['a1000000-0000-4000-8000-000000000003']::uuid[]
    )
  $$,
  '23503',
  'Every participant needs an active, non-suspended registration for the exact event year.',
  'suspended accounts cannot be put back on an official side-event roster'
);

UPDATE public.zltac_events SET status = 'archived' WHERE year = 2196;
SELECT throws_ok(
  $$
    SELECT public.admin_update_zltac_registration(
      'a1000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000004',
      '{"admin_note":"late mutation"}'::jsonb
    )
  $$,
  '55000',
  'Archived event registrations are immutable.',
  'archived event registrations reject committee mutations'
);

INSERT INTO public.referee_test_attempts (
  id, user_id, status, question_ids,
  safety_total, general_total, safety_pass_score, general_pass_score,
  started_at, expires_at
) VALUES (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000004',
  'started',
  ARRAY['a5000000-0000-4000-8000-000000000001']::uuid[],
  0, 1, 100, 70,
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '1 hour'
);

CREATE TEMP TABLE expired_attempt_result ON COMMIT DROP AS
SELECT public.submit_referee_test_attempt(
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000004',
  '[{"question_id":"a5000000-0000-4000-8000-000000000001","letter":"a"}]'::jsonb
) AS result;

SELECT ok(
  (SELECT (result->>'expired')::boolean FROM expired_attempt_result),
  'an expired submission returns a structured expired outcome'
);
SELECT is(
  (SELECT status FROM public.referee_test_attempts WHERE id = 'a4000000-0000-4000-8000-000000000001'),
  'expired'::text,
  'the expired attempt state persists after the RPC returns'
);

SELECT * FROM finish();
ROLLBACK;
