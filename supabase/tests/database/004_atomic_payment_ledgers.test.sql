CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Fixed high-range UUIDs make cleanup deterministic after an interrupted local run.
DELETE FROM public.payment_mutation_requests
 WHERE request_id::text LIKE '5906%';
DELETE FROM public.payment_records_history
 WHERE request_id::text LIKE '5906%';
DELETE FROM public.competitions WHERE id = '59020000-0000-4000-8000-000000000001';
DELETE FROM public.zltac_events WHERE id = '59030000-0000-4000-8000-000000000001';
DELETE FROM public.payment_records_history
 WHERE registration_id = '59040000-0000-4000-8000-000000000001'
    OR competition_registration_id IN (
      '59050000-0000-4000-8000-000000000001',
      '59050000-0000-4000-8000-000000000002'
    );
DELETE FROM public.profiles WHERE id IN (
  '59010000-0000-4000-8000-000000000002',
  '59010000-0000-4000-8000-000000000003',
  '59010000-0000-4000-8000-000000000004'
);

-- The governance migration intentionally prevents the active-superadmin count
-- from ever returning to zero. Keep this deterministic actor in the disposable
-- test database and make repeated local runs idempotent.
INSERT INTO public.profiles (id, first_name, alias, dob, roles)
VALUES (
  '59010000-0000-4000-8000-000000000001',
  'Payment Admin', 'PaymentAtomicAdmin', DATE '1980-01-01',
  ARRAY['superadmin', 'player']::text[]
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, first_name, alias, dob, roles, is_placeholder)
VALUES
  ('59010000-0000-4000-8000-000000000002', 'ZLTAC Player', 'PaymentAtomicZltac', DATE '1990-01-01', ARRAY['player']::text[], true),
  ('59010000-0000-4000-8000-000000000003', 'Competition Player', 'PaymentAtomicCompetition', DATE '1991-01-01', ARRAY['player']::text[], true),
  ('59010000-0000-4000-8000-000000000004', 'Concurrency Player', 'PaymentAtomicConcurrent', DATE '1992-01-01', ARRAY['player']::text[], true);

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date, timezone, main_fee
) VALUES (
  '59030000-0000-4000-8000-000000000001',
  'Atomic payments fixture', 2590, 'closed',
  DATE '2590-07-01', DATE '2590-07-03', 'Australia/Sydney', 5000
);

INSERT INTO public.zltac_registrations (
  id, user_id, year, status, amount_owing
) VALUES (
  '59040000-0000-4000-8000-000000000001',
  '59010000-0000-4000-8000-000000000002', 2590, 'confirmed', 5000
);

INSERT INTO public.competitions (
  id, slug, abbreviation, name, start_date, end_date,
  price_per_player, created_by
) VALUES (
  '59020000-0000-4000-8000-000000000001',
  'atomic-payments-2590', 'PAY', 'Atomic payments competition',
  DATE '2590-08-01', DATE '2590-08-02', 10000,
  '59010000-0000-4000-8000-000000000001'
);

INSERT INTO public.competition_registrations (
  id, competition_id, user_id, amount_owing
) VALUES
  (
    '59050000-0000-4000-8000-000000000001',
    '59020000-0000-4000-8000-000000000001',
    '59010000-0000-4000-8000-000000000003', 10000
  ),
  (
    '59050000-0000-4000-8000-000000000002',
    '59020000-0000-4000-8000-000000000001',
    '59010000-0000-4000-8000-000000000004', 10000
  );

-- Compatibility signatures from before the request-id workflow remain only so
-- old migration verification and controlled callers receive an explicit,
-- fail-closed response. They must never regain mutation behavior.
SELECT throws_ok(
  $$
    SELECT public.record_competition_payment(
      '59010000-0000-4000-8000-000000000001'::uuid,
      '59050000-0000-4000-8000-000000000001'::uuid,
      100,
      NULL::timestamptz,
      'RETIRED-BANK'::text,
      'Retired signature'::text
    )
  $$,
  '55000',
  'A payment request id is required. Use the atomic payment workflow.',
  'retired competition payment create signature fails closed'
);
SELECT throws_ok(
  $$
    SELECT public.update_competition_payment(
      '59010000-0000-4000-8000-000000000001'::uuid,
      '59070000-0000-4000-8000-000000000001'::uuid,
      '{"notes":"must not run"}'::jsonb
    )
  $$,
  '55000',
  'A payment request id is required. Use the atomic payment workflow.',
  'retired competition payment update signature fails closed'
);
SELECT throws_ok(
  $$
    SELECT public.remove_competition_payment(
      '59010000-0000-4000-8000-000000000001'::uuid,
      '59070000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '55000',
  'A payment request id is required. Use the atomic payment workflow.',
  'retired competition payment delete signature fails closed'
);
SELECT throws_ok(
  $$
    SELECT public.edit_payment_record(
      '59070000-0000-4000-8000-000000000001'::uuid,
      '{"notes":"must not run"}'::jsonb,
      '59010000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '55000',
  'Use the scoped atomic payment workflow.',
  'retired unscoped payment edit helper fails closed'
);
SELECT throws_ok(
  $$
    SELECT public.delete_payment_record(
      '59070000-0000-4000-8000-000000000001'::uuid,
      '59010000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '55000',
  'Use the scoped atomic payment workflow.',
  'retired unscoped payment delete helper fails closed'
);

CREATE TEMP TABLE zltac_first AS
SELECT public.record_zltac_payment(
  '59010000-0000-4000-8000-000000000001',
  '59040000-0000-4000-8000-000000000001',
  '59060000-0000-4000-8000-000000000001',
  2500, TIMESTAMPTZ '2590-07-01 10:00:00+10', 'BANK-Z', 'Part payment'
) AS result;

CREATE TEMP TABLE zltac_replay AS
SELECT public.record_zltac_payment(
  '59010000-0000-4000-8000-000000000001',
  '59040000-0000-4000-8000-000000000001',
  '59060000-0000-4000-8000-000000000001',
  2500, TIMESTAMPTZ '2590-07-01 10:00:00+10', 'BANK-Z', 'Part payment'
) AS result;

SELECT is(
  (SELECT count(*) FROM public.payment_records WHERE request_id = '59060000-0000-4000-8000-000000000001'),
  1::bigint,
  'same-key ZLTAC create replay writes exactly one ledger row'
);
SELECT is(
  (SELECT result::text FROM zltac_replay),
  (SELECT result::text FROM zltac_first),
  'same-key ZLTAC create replay returns the original canonical response'
);
SELECT throws_ok(
  $$
    SELECT public.record_zltac_payment(
      '59010000-0000-4000-8000-000000000002',
      '59040000-0000-4000-8000-000000000001',
      '59060000-0000-4000-8000-000000000001',
      2500, TIMESTAMPTZ '2590-07-01 10:00:00+10', 'BANK-Z', 'Part payment'
    )
  $$,
  '42501',
  'An active committee account is required.',
  'a different actor is re-authorized and cannot read a stored replay response'
);
SELECT throws_ok(
  $$
    SELECT public.record_zltac_payment(
      '59010000-0000-4000-8000-000000000001',
      '59040000-0000-4000-8000-000000000001',
      '59060000-0000-4000-8000-000000000001',
      3000, TIMESTAMPTZ '2590-07-01 10:00:00+10', 'BANK-Z', 'Part payment'
    )
  $$,
  '23505',
  'This payment request id has already been used for a different action.',
  'a reused key with a different amount is rejected instead of leaking/replaying data'
);

CREATE TEMP TABLE zltac_payment AS
SELECT id FROM public.payment_records
 WHERE request_id = '59060000-0000-4000-8000-000000000001';

SELECT lives_ok(
  format(
    $$SELECT public.update_zltac_payment(
      '59010000-0000-4000-8000-000000000001', %L,
      '59060000-0000-4000-8000-000000000002',
      '{"amount":3000,"notes":"corrected"}'::jsonb
    )$$,
    (SELECT id FROM zltac_payment)
  ),
  'ZLTAC payment update commits ledger, audit, and summary atomically'
);
SELECT lives_ok(
  format(
    $$SELECT public.update_zltac_payment(
      '59010000-0000-4000-8000-000000000001', %L,
      '59060000-0000-4000-8000-000000000002',
      '{"amount":3000,"notes":"corrected"}'::jsonb
    )$$,
    (SELECT id FROM zltac_payment)
  ),
  'same-key ZLTAC update replay succeeds'
);
SELECT is(
  (SELECT count(*) FROM public.payment_records_history WHERE request_id = '59060000-0000-4000-8000-000000000002'),
  1::bigint,
  'same-key update creates one immutable history snapshot'
);

SELECT lives_ok(
  format(
    $$SELECT public.remove_zltac_payment(
      '59010000-0000-4000-8000-000000000001', %L,
      '59060000-0000-4000-8000-000000000003'
    )$$,
    (SELECT id FROM zltac_payment)
  ),
  'ZLTAC payment delete commits audit and summary atomically'
);
SELECT lives_ok(
  format(
    $$SELECT public.remove_zltac_payment(
      '59010000-0000-4000-8000-000000000001', %L,
      '59060000-0000-4000-8000-000000000003'
    )$$,
    (SELECT id FROM zltac_payment)
  ),
  'same-key delete replay succeeds after the ledger row is gone'
);
SELECT is(
  (SELECT count(*) FROM public.payment_records_history WHERE request_id = '59060000-0000-4000-8000-000000000003'),
  1::bigint,
  'same-key delete creates one immutable history snapshot'
);

CREATE TEMP TABLE competition_first AS
SELECT public.record_competition_payment(
  '59010000-0000-4000-8000-000000000001',
  '59050000-0000-4000-8000-000000000001',
  '59060000-0000-4000-8000-000000000004',
  4000, NULL, 'BANK-C', 'Part payment'
) AS result;

SELECT is(
  (SELECT amount_paid FROM public.competition_registrations WHERE id = '59050000-0000-4000-8000-000000000001'),
  4000::integer,
  'competition create persists the cached ledger total in the same transaction'
);
SELECT is(
  (SELECT payment_status FROM public.competition_registrations WHERE id = '59050000-0000-4000-8000-000000000001'),
  'partial'::text,
  'competition create persists the canonical payment status'
);

-- Force the final durable-receipt write to fail. The preceding payment insert
-- and parent recompute must roll back with it.
CREATE OR REPLACE FUNCTION pg_temp.fail_payment_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_id = '59060000-0000-4000-8000-000000000005'::uuid THEN
    RAISE EXCEPTION 'forced receipt failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_receipt_forced_failure
  BEFORE INSERT ON public.payment_mutation_requests
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_payment_receipt();

SELECT throws_ok(
  $$
    SELECT public.record_competition_payment(
      '59010000-0000-4000-8000-000000000001',
      '59050000-0000-4000-8000-000000000002',
      '59060000-0000-4000-8000-000000000005',
      3500, NULL, 'BANK-FAIL', 'Must roll back'
    )
  $$,
  'P0001',
  'forced receipt failure',
  'a failure after ledger mutation aborts the complete payment transaction'
);
DROP TRIGGER payment_receipt_forced_failure ON public.payment_mutation_requests;

SELECT is(
  (SELECT count(*) FROM public.payment_records WHERE request_id = '59060000-0000-4000-8000-000000000005'),
  0::bigint,
  'forced final-step failure leaves no payment row'
);
SELECT is(
  (SELECT amount_paid FROM public.competition_registrations WHERE id = '59050000-0000-4000-8000-000000000002'),
  0::integer,
  'forced final-step failure rolls back the cached parent total'
);

-- Two real database sessions submit the same request while the first keeps its
-- transaction open. The second must remain blocked, then replay exactly once.
-- These suites run only against `supabase test db`; `postgres` is the fixed
-- disposable local-stack password, never a hosted-project credential.
DO $concurrency$
DECLARE
  v_connection text := CASE
    WHEN version() ILIKE '%windows%' THEN format(
      'host=%s port=%s dbname=%s user=%s password=postgres',
      inet_server_addr(), inet_server_port(), current_database(), current_user
    )
    ELSE format(
      'host=%s port=%s dbname=%s user=%s password=postgres',
      inet_server_addr(), inet_server_port(), current_database(), current_user
    )
  END;
BEGIN
  PERFORM extensions.dblink_connect('payment_concurrent_1', v_connection);
  PERFORM extensions.dblink_connect('payment_concurrent_2', v_connection);
  PERFORM extensions.dblink_exec('payment_concurrent_1', 'BEGIN');
  PERFORM extensions.dblink_exec('payment_concurrent_2', 'BEGIN');
  PERFORM extensions.dblink_send_query(
    'payment_concurrent_1',
    $$SELECT public.record_competition_payment(
      '59010000-0000-4000-8000-000000000001',
      '59050000-0000-4000-8000-000000000002',
      '59060000-0000-4000-8000-000000000006',
      3000, NULL, 'BANK-RACE', 'Concurrent retry'
    )$$
  );
  PERFORM pg_sleep(0.1);
  PERFORM extensions.dblink_send_query(
    'payment_concurrent_2',
    $$SELECT public.record_competition_payment(
      '59010000-0000-4000-8000-000000000001',
      '59050000-0000-4000-8000-000000000002',
      '59060000-0000-4000-8000-000000000006',
      3000, NULL, 'BANK-RACE', 'Concurrent retry'
    )$$
  );
  PERFORM pg_sleep(0.2);
END;
$concurrency$;

SELECT is(
  extensions.dblink_is_busy('payment_concurrent_2')::bigint,
  1::bigint,
  'a concurrent retry waits behind the first transaction'
);

CREATE TEMP TABLE concurrent_first AS
SELECT result
  FROM extensions.dblink_get_result('payment_concurrent_1') AS response(result jsonb);
DO $$ BEGIN
  -- Drain the asynchronous command-status result before issuing COMMIT on the
  -- same dblink connection.
  PERFORM result
    FROM extensions.dblink_get_result('payment_concurrent_1', false) AS response(result text);
  PERFORM extensions.dblink_exec('payment_concurrent_1', 'COMMIT');
END $$;

CREATE TEMP TABLE concurrent_second AS
SELECT result
  FROM extensions.dblink_get_result('payment_concurrent_2') AS response(result jsonb);
DO $$ BEGIN
  PERFORM result
    FROM extensions.dblink_get_result('payment_concurrent_2', false) AS response(result text);
  PERFORM extensions.dblink_exec('payment_concurrent_2', 'COMMIT');
END $$;

SELECT is(
  (SELECT result::text FROM concurrent_second),
  (SELECT result::text FROM concurrent_first),
  'the waiting request receives the first transaction canonical response'
);
SELECT is(
  (SELECT count(*) FROM public.payment_records WHERE request_id = '59060000-0000-4000-8000-000000000006'),
  1::bigint,
  'concurrent same-key creates produce exactly one ledger row'
);
SELECT is(
  (SELECT amount_paid FROM public.competition_registrations WHERE id = '59050000-0000-4000-8000-000000000002'),
  3000::integer,
  'concurrent serialization leaves the cached parent total consistent'
);

DO $$ BEGIN
  PERFORM extensions.dblink_disconnect('payment_concurrent_1');
  PERFORM extensions.dblink_disconnect('payment_concurrent_2');
END $$;

DELETE FROM public.payment_mutation_requests
 WHERE request_id::text LIKE '5906%';
DELETE FROM public.payment_records_history
 WHERE request_id::text LIKE '5906%';
DELETE FROM public.competitions WHERE id = '59020000-0000-4000-8000-000000000001';
DELETE FROM public.zltac_events WHERE id = '59030000-0000-4000-8000-000000000001';
DELETE FROM public.payment_records_history
 WHERE registration_id = '59040000-0000-4000-8000-000000000001'
    OR competition_registration_id IN (
      '59050000-0000-4000-8000-000000000001',
      '59050000-0000-4000-8000-000000000002'
    );
DELETE FROM public.profiles WHERE id IN (
  '59010000-0000-4000-8000-000000000002',
  '59010000-0000-4000-8000-000000000003',
  '59010000-0000-4000-8000-000000000004'
);

SELECT * FROM finish();
