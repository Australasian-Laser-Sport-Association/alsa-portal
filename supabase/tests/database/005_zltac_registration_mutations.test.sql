BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

UPDATE public.zltac_events SET status = 'draft' WHERE status = 'open';

INSERT INTO public.profiles (id, first_name, alias, dob, roles, suspended)
VALUES
  ('c1000000-0000-4000-8000-000000000001', 'Atomic admin', 'RegistrationAtomicAdmin', DATE '1980-01-01', ARRAY['zltac_committee', 'player']::text[], false),
  ('c1000000-0000-4000-8000-000000000002', 'Cap first', 'RegistrationCapFirst', DATE '1990-01-01', ARRAY['player']::text[], false),
  ('c1000000-0000-4000-8000-000000000003', 'Cap second', 'RegistrationCapSecond', DATE '1991-01-01', ARRAY['player']::text[], false),
  ('c1000000-0000-4000-8000-000000000004', 'Bundle subject', 'RegistrationBundleSubject', DATE '1992-01-01', ARRAY['player']::text[], false),
  ('c1000000-0000-4000-8000-000000000005', 'Missing registration', 'RegistrationMissingPartner', DATE '1993-01-01', ARRAY['player']::text[], false);

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date,
  reg_open_date, reg_close_date, event_starts_at, timezone,
  max_players, main_fee, processing_fee_pct, side_events
) VALUES
  (
    'c2000000-0000-4000-8000-000000000001',
    'Atomic registration open', 2188, 'open',
    DATE '2188-07-01', DATE '2188-07-03',
    clock_timestamp() - interval '1 day',
    clock_timestamp() + interval '30 days',
    clock_timestamp() + interval '31 days',
    'Australia/Sydney', 1, 1000, 0,
    '[{"slug":"doubles","enabled":true,"price":500},{"slug":"triples","enabled":true,"price":700}]'::jsonb
  ),
  (
    'c2000000-0000-4000-8000-000000000002',
    'Atomic registration draft', 2189, 'draft',
    DATE '2189-07-01', DATE '2189-07-03',
    NULL, NULL, NULL, 'Australia/Sydney', NULL, 1000, 0,
    '[{"slug":"doubles","enabled":true,"price":500}]'::jsonb
  );

SELECT throws_ok(
  $$
    SELECT public.register_zltac_player(
      'c1000000-0000-4000-8000-000000000002', 2189,
      DATE '1990-01-01', NULL, NULL
    )
  $$,
  '55000',
  'The event is not open for roster changes.',
  'draft events reject player registration inside the event lock'
);

CREATE TEMP TABLE first_registration_result ON COMMIT DROP AS
SELECT public.register_zltac_player(
  'c1000000-0000-4000-8000-000000000002', 2188,
  DATE '1990-01-01', ' Helper ', ' 0400 000 000 '
) AS result;

SELECT ok(
  (SELECT (result->>'ok')::boolean FROM first_registration_result),
  'the final available registration slot succeeds'
);
SELECT is(
  (
    SELECT count(*)
      FROM first_registration_result,
           jsonb_object_keys(result->'registration') field
  ),
  8::bigint,
  'player registration returns only the former eight-field allow-list'
);
SELECT ok(
  (SELECT NOT (result->'registration' ?| ARRAY[
    'admin_note', 'admin_override_coc', 'admin_override_coc_reason',
    'admin_override_coc_set_by', 'payment_reference', 'amount_owing'
  ]) FROM first_registration_result),
  'player registration never exposes committee or payment fields'
);

SELECT throws_ok(
  $$
    SELECT public.register_zltac_player(
      'c1000000-0000-4000-8000-000000000003', 2188,
      DATE '1991-01-01', NULL, NULL
    )
  $$,
  '23514',
  'Registration cap of 1 reached. Contact the committee.',
  'the event lock makes the cap boundary authoritative'
);
SELECT is(
  (SELECT count(*) FROM public.zltac_registrations WHERE year = 2188),
  1::bigint,
  'a rejected cap-boundary registration creates no row'
);

UPDATE public.zltac_events SET max_players = NULL WHERE year = 2188;
SELECT lives_ok(
  $$
    SELECT public.register_zltac_player(
      'c1000000-0000-4000-8000-000000000003', 2188,
      DATE '1991-01-01', NULL, NULL
    )
  $$,
  'registration succeeds after the cap is deliberately removed'
);
SELECT lives_ok(
  $$
    SELECT public.register_zltac_player(
      'c1000000-0000-4000-8000-000000000004', 2188,
      DATE '1992-01-01', NULL, NULL
    )
  $$,
  'the admin bundle subject has an active registration'
);

INSERT INTO public.zltac_registrations (id, user_id, year, status)
VALUES (
  'c3000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000003', 2189, 'pending'
);
SELECT throws_ok(
  $$
    SELECT public.confirm_zltac_registration_choices(
      'c1000000-0000-4000-8000-000000000003', 2189,
      'confirm-extras', NULL, 1
    )
  $$,
  '55000',
  'The event is not open for roster changes.',
  'draft events reject extras confirmation inside the same lifecycle lock'
);

-- A malformed configured price forces recalculation to fail after the update.
-- The surrounding function transaction must roll the choice update back.
UPDATE public.zltac_events
   SET side_events = '[{"slug":"doubles","enabled":true,"price":"not-an-integer"},{"slug":"triples","enabled":true,"price":700}]'::jsonb
 WHERE year = 2188;
SELECT throws_ok(
  $$
    SELECT public.confirm_zltac_registration_choices(
      'c1000000-0000-4000-8000-000000000004', 2188,
      'confirm-side-events', ARRAY['doubles']::text[], NULL
    )
  $$,
  '22P02',
  'invalid input syntax for type integer: "not-an-integer"',
  'pricing recalculation failure aborts the whole confirmation'
);
SELECT ok(
  (
    SELECT NOT has_confirmed_side_events
       AND NOT 'doubles' = ANY(coalesce(side_events, ARRAY[]::text[]))
      FROM public.zltac_registrations
     WHERE user_id = 'c1000000-0000-4000-8000-000000000004'
       AND year = 2188
  ),
  'failed recalculation leaves the prior selections and confirmation flag intact'
);
UPDATE public.zltac_events
   SET side_events = '[{"slug":"doubles","enabled":true,"price":500},{"slug":"triples","enabled":true,"price":700}]'::jsonb
 WHERE year = 2188;

-- The valid doubles replacement runs before the invalid triples partner. The
-- late triples failure must roll back both the registration edit and doubles.
SELECT throws_ok(
  $$
    SELECT public.admin_update_zltac_registration_bundle(
      'c1000000-0000-4000-8000-000000000001',
      (SELECT id FROM public.zltac_registrations
        WHERE user_id = 'c1000000-0000-4000-8000-000000000004' AND year = 2188),
      jsonb_build_object(
        'updates', '{"admin_note":"must roll back"}'::jsonb,
        'doubles_partner_ids', jsonb_build_array('c1000000-0000-4000-8000-000000000003'::uuid),
        'triples_partner_ids', jsonb_build_array('c1000000-0000-4000-8000-000000000005'::uuid)
      )
    )
  $$,
  '23503',
  'Every participant needs an active, non-suspended registration for the exact event year.',
  'a late invalid partner aborts the full admin registration bundle'
);
SELECT is(
  (
    SELECT admin_note FROM public.zltac_registrations
     WHERE user_id = 'c1000000-0000-4000-8000-000000000004' AND year = 2188
  ),
  NULL::text,
  'the earlier registration update rolls back after a late partner failure'
);
SELECT is(
  (
    SELECT count(*) FROM public.doubles_pairs
     WHERE event_year = 2188
       AND 'c1000000-0000-4000-8000-000000000004' IN (player1_id, player2_id)
  ),
  0::bigint,
  'the earlier doubles replacement rolls back after a late triples failure'
);

SELECT lives_ok(
  $$
    SELECT public.admin_update_zltac_registration_bundle(
      'c1000000-0000-4000-8000-000000000001',
      (SELECT id FROM public.zltac_registrations
        WHERE user_id = 'c1000000-0000-4000-8000-000000000004' AND year = 2188),
      jsonb_build_object(
        'updates', '{"admin_note":"identity bundle"}'::jsonb,
        'state', 'VIC',
        'alias', 'RegistrationBundleUpdated',
        'alias_reason', 'Corrected at player request'
      )
    )
  $$,
  'profile state and audited alias compose with registration edits'
);
SELECT ok(
  (
    SELECT profile.state = 'VIC'
       AND profile.alias = 'RegistrationBundleUpdated'
       AND registration.admin_note = 'identity bundle'
      FROM public.profiles profile
      JOIN public.zltac_registrations registration ON registration.user_id = profile.id
     WHERE profile.id = 'c1000000-0000-4000-8000-000000000004'
       AND registration.year = 2188
  ),
  'the successful bundle commits registration and identity fields together'
);
SELECT is(
  (
    SELECT count(*) FROM public.profile_change_audit
     WHERE target_profile_id = 'c1000000-0000-4000-8000-000000000004'
       AND new_value = 'RegistrationBundleUpdated'
       AND changed_by = 'c1000000-0000-4000-8000-000000000001'
       AND source = 'registration-editor'
  ),
  1::bigint,
  'the bundle preserves the existing alias audit contract'
);

SELECT throws_ok(
  $$
    SELECT public.admin_update_zltac_registration(
      'c1000000-0000-4000-8000-000000000001',
      (SELECT id FROM public.zltac_registrations
        WHERE user_id = 'c1000000-0000-4000-8000-000000000004' AND year = 2188),
      '{"status":"cancelled"}'::jsonb
    )
  $$,
  '22023',
  'Use cancel_zltac_registration for cancellation.',
  'generic admin edits cannot bypass the guarded cancellation workflow'
);
SELECT is(
  (
    SELECT status FROM public.zltac_registrations
     WHERE user_id = 'c1000000-0000-4000-8000-000000000004' AND year = 2188
  ),
  'pending'::text,
  'rejected status-only cancellation leaves the registration active'
);

SELECT lives_ok(
  $$
    SELECT public.admin_replace_zltac_side_event_roster(
      'c1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000002', 2188,
      'doubles', ARRAY['c1000000-0000-4000-8000-000000000003']::uuid[]
    )
  $$,
  'a doubles roster is created for drift and cancellation checks'
);
SELECT throws_ok(
  $$
    SELECT public.confirm_zltac_registration_choices(
      'c1000000-0000-4000-8000-000000000002', 2188,
      'confirm-side-events', ARRAY[]::text[], NULL
    )
  $$,
  '23514',
  'Leave the existing doubles roster before removing that side event.',
  'player confirmation cannot remove a side event while its roster still exists'
);
SELECT ok(
  (
    SELECT 'doubles' = ANY(side_events)
      FROM public.zltac_registrations
     WHERE user_id = 'c1000000-0000-4000-8000-000000000002' AND year = 2188
  ),
  'rejected deselection preserves roster-aligned pricing state'
);

INSERT INTO public.payment_records (registration_id, amount, recorded_by, bank_reference)
SELECT id, 1000, 'c1000000-0000-4000-8000-000000000001', 'ATOMIC-PAYMENT'
  FROM public.zltac_registrations
 WHERE user_id = 'c1000000-0000-4000-8000-000000000002' AND year = 2188;
SELECT throws_ok(
  $$
    SELECT public.cancel_zltac_registration(
      'c1000000-0000-4000-8000-000000000002', 2188
    )
  $$,
  '55000',
  'A registration with recorded payments cannot be cancelled.',
  'recorded payment evidence blocks cancellation'
);
SELECT is(
  (
    SELECT count(*) FROM public.zltac_registrations
     WHERE user_id = 'c1000000-0000-4000-8000-000000000002' AND year = 2188
  ),
  1::bigint,
  'payment-blocked cancellation preserves the registration'
);
SELECT is(
  (SELECT count(*) FROM public.doubles_pairs WHERE event_year = 2188),
  1::bigint,
  'payment-blocked cancellation stops before deleting side-event evidence'
);
SELECT is(
  (SELECT count(*) FROM public.payment_records WHERE bank_reference = 'ATOMIC-PAYMENT'),
  1::bigint,
  'payment-blocked cancellation preserves the payment ledger row'
);

SELECT * FROM finish();
ROLLBACK;
