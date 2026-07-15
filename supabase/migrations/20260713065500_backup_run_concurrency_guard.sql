-- Serialize portal backup jobs across cron and committee-triggered requests.
--
-- A serverless invocation cannot hold a PostgreSQL advisory lock while it
-- streams data to object storage. Instead, begin_portal_backup_run acquires a
-- transaction-scoped advisory lock, installs one durable `running` lease, and
-- commits before the external work starts. The partial unique index is a
-- second line of defence. A lease abandoned by a crashed invocation expires
-- after 30 minutes and is reconciled by the next begin call.

BEGIN;

DO $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.backup_runs
     WHERE status = 'running'
  ) > 1 THEN
    RAISE EXCEPTION
      'Multiple backup runs are already marked running. Reconcile them before applying 65500.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS backup_runs_single_running_idx
  ON public.backup_runs ((status))
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.begin_portal_backup_run(
  p_run_id uuid,
  p_object_prefix text,
  p_triggered_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.backup_runs%ROWTYPE;
  v_running public.backup_runs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_run_id IS NULL
     OR p_object_prefix IS NULL
     OR length(btrim(p_object_prefix)) = 0
     OR length(p_object_prefix) > 512 THEN
    RAISE EXCEPTION 'A valid backup run id and object prefix are required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_triggered_by IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.profiles AS actor
        WHERE actor.id = p_triggered_by
          AND NOT actor.suspended
          AND actor.roles && ARRAY[
            'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
          ]::text[]
     ) THEN
    RAISE EXCEPTION 'An active committee account is required.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(65500, 1);

  -- The same run id is safe to retry after an ambiguous network response.
  SELECT run.*
    INTO v_existing
    FROM public.backup_runs AS run
   WHERE run.id = p_run_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.object_prefix = p_object_prefix
       AND v_existing.triggered_by IS NOT DISTINCT FROM p_triggered_by::text
       AND v_existing.status = 'running' THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'object_prefix', v_existing.object_prefix,
        'started_at', v_existing.started_at,
        'resumed', true
      );
    END IF;

    RAISE EXCEPTION 'Backup run id is already in use.'
      USING ERRCODE = '23505';
  END IF;

  SELECT run.*
    INTO v_running
    FROM public.backup_runs AS run
   WHERE run.status = 'running'
   ORDER BY run.started_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_running.started_at > v_now - interval '30 minutes' THEN
    RAISE EXCEPTION 'A portal backup is already running.'
      USING ERRCODE = '55P03', HINT = 'BACKUP_ALREADY_RUNNING';
  END IF;

  IF FOUND THEN
    UPDATE public.backup_runs
       SET status = 'failed',
           failure_message = 'The backup worker stopped before releasing its 30-minute lease.',
           completed_at = v_now
     WHERE id = v_running.id
       AND status = 'running';
  END IF;

  INSERT INTO public.backup_runs (
    id,
    status,
    object_prefix,
    triggered_by,
    started_at
  )
  VALUES (
    p_run_id,
    'running',
    p_object_prefix,
    p_triggered_by::text,
    v_now
  );

  RETURN jsonb_build_object(
    'id', p_run_id,
    'status', 'running',
    'object_prefix', p_object_prefix,
    'started_at', v_now,
    'resumed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_portal_backup_run(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_portal_backup_run(uuid, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_portal_backup_run(
  p_run_id uuid,
  p_status text,
  p_object_paths text[],
  p_manifest jsonb,
  p_failure_message text,
  p_completed_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_run public.backup_runs%ROWTYPE;
  v_completed_at timestamptz := coalesce(p_completed_at, clock_timestamp());
BEGIN
  IF p_run_id IS NULL OR p_status NOT IN ('complete', 'failed') THEN
    RAISE EXCEPTION 'A valid run id and terminal backup status are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT run.*
    INTO v_run
    FROM public.backup_runs AS run
   WHERE run.id = p_run_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup run not found.' USING ERRCODE = 'P0002';
  END IF;

  IF cardinality(coalesce(p_object_paths, ARRAY[]::text[])) > 0
     AND (
       EXISTS (
         SELECT 1
           FROM unnest(p_object_paths) AS paths(object_path)
          WHERE object_path IS NULL
             OR length(btrim(object_path)) = 0
             OR left(object_path, length(v_run.object_prefix) + 1)
                  <> v_run.object_prefix || '/'
       )
       OR cardinality(p_object_paths) <> (
         SELECT count(DISTINCT object_path)
           FROM unnest(p_object_paths) AS paths(object_path)
       )
     ) THEN
    RAISE EXCEPTION 'Backup object paths are blank, duplicated, or outside the run prefix.'
      USING ERRCODE = '22023';
  END IF;

  IF p_status = 'complete'
     AND (
       jsonb_typeof(p_manifest) IS DISTINCT FROM 'object'
       OR p_object_paths IS DISTINCT FROM ARRAY[
         v_run.object_prefix || '/registrations.csv',
         v_run.object_prefix || '/payments.csv',
         v_run.object_prefix || '/events.csv',
         v_run.object_prefix || '/admin-asset-upload-audit.csv',
         v_run.object_prefix || '/manifest.json'
       ]::text[]
       OR (
         v_run.status = 'running'
         AND v_run.object_paths IS DISTINCT FROM p_object_paths
       )
     ) THEN
    RAISE EXCEPTION 'A complete backup requires its staged artifact set and a JSON manifest object.'
      USING ERRCODE = '22023';
  END IF;

  -- An identical terminal retry is idempotent. This matters when PostgreSQL
  -- committed the first call but the HTTP response was lost.
  IF v_run.status = p_status THEN
    IF v_run.object_paths IS DISTINCT FROM coalesce(p_object_paths, ARRAY[]::text[])
       OR (
         p_status = 'complete'
         AND v_run.manifest IS DISTINCT FROM p_manifest
       ) THEN
      RAISE EXCEPTION 'Terminal backup payload does not match the stored run.'
        USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'completed_at', v_run.completed_at,
      'resumed', true
    );
  END IF;

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'Backup run is already terminal.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.backup_runs
     SET status = p_status,
         -- Failed rows retain paths only when object deletion was not
         -- confirmed, so a later worker can safely reconcile private PII.
         object_paths = coalesce(p_object_paths, ARRAY[]::text[]),
         manifest = CASE WHEN p_status = 'complete' THEN p_manifest ELSE NULL END,
         failure_message = CASE
           WHEN p_status = 'failed' THEN left(coalesce(p_failure_message, 'Backup failed.'), 2000)
           ELSE NULL
         END,
         completed_at = v_completed_at
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'id', p_run_id,
    'status', p_status,
    'completed_at', v_completed_at,
    'resumed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finish_portal_backup_run(
  uuid, text, text[], jsonb, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_portal_backup_run(
  uuid, text, text[], jsonb, text, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.begin_portal_backup_run(uuid, text, uuid) IS
  'BACKUP_RUN_CONCURRENCY_GUARD_655: service-only atomic singleton lease with stale-worker recovery.';
COMMENT ON FUNCTION public.finish_portal_backup_run(uuid, text, text[], jsonb, text, timestamptz) IS
  'BACKUP_RUN_CONCURRENCY_GUARD_655: service-only idempotent terminal transition.';

COMMIT;
