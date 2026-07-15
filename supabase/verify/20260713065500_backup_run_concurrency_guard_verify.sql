DO $$
DECLARE
  v_begin regprocedure := to_regprocedure(
    'public.begin_portal_backup_run(uuid,text,uuid)'
  );
  v_finish regprocedure := to_regprocedure(
    'public.finish_portal_backup_run(uuid,text,text[],jsonb,text,timestamp with time zone)'
  );
BEGIN
  IF v_begin IS NULL OR v_finish IS NULL THEN
    RAISE EXCEPTION 'Backup concurrency functions are missing.';
  END IF;

  IF obj_description(v_begin, 'pg_proc') IS DISTINCT FROM
       'BACKUP_RUN_CONCURRENCY_GUARD_655: service-only atomic singleton lease with stale-worker recovery.'
     OR obj_description(v_finish, 'pg_proc') IS DISTINCT FROM
       'BACKUP_RUN_CONCURRENCY_GUARD_655: service-only idempotent terminal transition.' THEN
    RAISE EXCEPTION 'Backup concurrency function contract marker is missing.';
  END IF;

  IF pg_get_functiondef(v_finish) NOT LIKE '%/admin-asset-upload-audit.csv%' THEN
    RAISE EXCEPTION 'The backup completion contract omits the asset-upload audit artifact.';
  END IF;

  IF has_function_privilege('anon', v_begin, 'EXECUTE')
     OR has_function_privilege('authenticated', v_begin, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_begin, 'EXECUTE')
     OR has_function_privilege('anon', v_finish, 'EXECUTE')
     OR has_function_privilege('authenticated', v_finish, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_finish, 'EXECUTE') THEN
    RAISE EXCEPTION 'Backup concurrency functions have unsafe execution grants.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'backup_runs'
       AND indexname = 'backup_runs_single_running_idx'
       AND indexdef ILIKE '%UNIQUE INDEX%'
       AND indexdef ILIKE '%WHERE (status = ''running''%'
  ) THEN
    RAISE EXCEPTION 'The singleton running-backup index is missing.';
  END IF;

  IF (
    SELECT count(*)
      FROM public.backup_runs
     WHERE status = 'running'
  ) > 1 THEN
    RAISE EXCEPTION 'More than one portal backup is marked running.';
  END IF;
END;
$$;
