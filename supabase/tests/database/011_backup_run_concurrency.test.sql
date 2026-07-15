BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

INSERT INTO public.profiles (
  id, first_name, alias, dob, roles, suspended, is_placeholder
)
VALUES
  (
    '65500000-0000-4000-8000-000000000001',
    'Backup committee', 'BackupCommittee655', DATE '1980-01-01',
    ARRAY['alsa_committee', 'player']::text[], false, false
  ),
  (
    '65500000-0000-4000-8000-000000000002',
    'Backup player', 'BackupPlayer655', DATE '1990-01-01',
    ARRAY['player']::text[], false, false
  );

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.begin_portal_backup_run(uuid,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.begin_portal_backup_run(uuid,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.finish_portal_backup_run(uuid,text,text[],jsonb,text,timestamp with time zone)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.finish_portal_backup_run(uuid,text,text[],jsonb,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'backup lease transitions are service-only'
);

SELECT throws_ok(
  $$
    SELECT public.begin_portal_backup_run(
      '65500000-0000-4000-8000-000000000010',
      'test/unauthorised',
      '65500000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'An active committee account is required.',
  'an ordinary profile cannot be attributed as a manual backup actor'
);

SELECT lives_ok(
  $$
    SELECT public.begin_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'test/first',
      '65500000-0000-4000-8000-000000000001'
    )
  $$,
  'the first worker acquires the durable lease'
);

SELECT throws_ok(
  $$
    SELECT public.begin_portal_backup_run(
      '65500000-0000-4000-8000-000000000012',
      'test/concurrent',
      '65500000-0000-4000-8000-000000000001'
    )
  $$,
  '55P03',
  'A portal backup is already running.',
  'a concurrent worker is rejected while the lease is fresh'
);

SELECT lives_ok(
  $$
    SELECT public.begin_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'test/first',
      '65500000-0000-4000-8000-000000000001'
    )
  $$,
  'retrying the same begin request is idempotent'
);

SELECT lives_ok(
  $$
    UPDATE public.backup_runs
       SET object_paths = ARRAY[
         'test/first/registrations.csv',
         'test/first/payments.csv',
         'test/first/events.csv',
         'test/first/admin-asset-upload-audit.csv',
         'test/first/manifest.json'
       ]::text[]
     WHERE id = '65500000-0000-4000-8000-000000000011'
       AND status = 'running'
  $$,
  'the worker stages its exact artifact inventory before uploading'
);

SELECT throws_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'complete',
      ARRAY[
        'test/first/registrations.csv',
        'test/first/payments.csv',
        'test/first/events.csv',
        'test/first/admin-asset-upload-audit.csv',
        'test/first/manifest.json'
      ]::text[],
      NULL,
      NULL,
      clock_timestamp()
    )
  $$,
  '22023',
  'A complete backup requires its staged artifact set and a JSON manifest object.',
  'a complete run rejects a missing manifest'
);

SELECT throws_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'complete',
      ARRAY[]::text[],
      '{"files":5}'::jsonb,
      NULL,
      clock_timestamp()
    )
  $$,
  '22023',
  'A complete backup requires its staged artifact set and a JSON manifest object.',
  'a complete run rejects an empty artifact set'
);

SELECT throws_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'complete',
      ARRAY[
        'test/first/registrations.csv',
        'test/first/registrations.csv'
      ]::text[],
      '{"files":2}'::jsonb,
      NULL,
      clock_timestamp()
    )
  $$,
  '22023',
  'Backup object paths are blank, duplicated, or outside the run prefix.',
  'a terminal transition rejects duplicate object paths'
);

SELECT throws_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'complete',
      ARRAY['another-run/manifest.json']::text[],
      '{"files":1}'::jsonb,
      NULL,
      clock_timestamp()
    )
  $$,
  '22023',
  'Backup object paths are blank, duplicated, or outside the run prefix.',
  'a terminal transition rejects paths outside its run prefix'
);

SELECT lives_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'complete',
      ARRAY[
        'test/first/registrations.csv',
        'test/first/payments.csv',
        'test/first/events.csv',
        'test/first/admin-asset-upload-audit.csv',
        'test/first/manifest.json'
      ]::text[],
      '{"files":5}'::jsonb,
      NULL,
      clock_timestamp()
    )
  $$,
  'the active worker can complete and release the lease'
);

SELECT lives_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000011',
      'complete',
      ARRAY[
        'test/first/registrations.csv',
        'test/first/payments.csv',
        'test/first/events.csv',
        'test/first/admin-asset-upload-audit.csv',
        'test/first/manifest.json'
      ]::text[],
      '{"files":5}'::jsonb,
      NULL,
      clock_timestamp()
    )
  $$,
  'an identical terminal retry is idempotent'
);

SELECT lives_ok(
  $$
    SELECT public.begin_portal_backup_run(
      '65500000-0000-4000-8000-000000000013',
      'test/stale',
      NULL
    )
  $$,
  'a later cron worker acquires the released lease'
);

UPDATE public.backup_runs
   SET started_at = clock_timestamp() - interval '31 minutes'
 WHERE id = '65500000-0000-4000-8000-000000000013';

SELECT lives_ok(
  $$
    SELECT public.begin_portal_backup_run(
      '65500000-0000-4000-8000-000000000014',
      'test/recovered',
      NULL
    )
  $$,
  'the next worker atomically reclaims an expired lease'
);

SELECT is(
  (
    SELECT status
      FROM public.backup_runs
     WHERE id = '65500000-0000-4000-8000-000000000013'
  ),
  'failed',
  'the abandoned worker is retained as failed evidence'
);

SELECT is(
  (
    SELECT count(*)
      FROM public.backup_runs
     WHERE status = 'running'
  ),
  1::bigint,
  'exactly one worker owns the lease after recovery'
);

SELECT lives_ok(
  $$
    SELECT public.finish_portal_backup_run(
      '65500000-0000-4000-8000-000000000014',
      'failed',
      ARRAY['test/recovered/orphan.csv']::text[],
      NULL,
      'test cleanup',
      clock_timestamp()
    )
  $$,
  'a failed terminal transition also releases the lease'
);

SELECT is(
  (
    SELECT object_paths
      FROM public.backup_runs
     WHERE id = '65500000-0000-4000-8000-000000000014'
  ),
  ARRAY['test/recovered/orphan.csv']::text[],
  'a failed terminal transition preserves unconfirmed object paths for reconciliation'
);

SELECT * FROM finish();
ROLLBACK;
