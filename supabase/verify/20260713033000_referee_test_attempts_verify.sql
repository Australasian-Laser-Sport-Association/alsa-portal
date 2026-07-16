-- Verify the referee-test attempt model and service-only execution boundary.

DO $$
DECLARE
  function_signature text;
BEGIN
  IF to_regclass('public.referee_test_attempts') IS NULL THEN
    RAISE EXCEPTION 'referee_test_attempts table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.referee_test_attempts'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on referee_test_attempts';
  END IF;

  IF has_table_privilege('anon', 'public.referee_test_attempts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referee_test_attempts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referee_test_attempts', 'INSERT') THEN
    RAISE EXCEPTION 'referee_test_attempts is directly browser-accessible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = 'public.referee_test_attempts'::regclass
      AND indexrelid = 'public.referee_test_attempts_one_open_per_user'::regclass
      AND indisunique
      AND indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'one-open-attempt invariant is missing';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.start_referee_test_attempt(uuid)',
    'public.submit_referee_test_attempt(uuid,uuid,jsonb)'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected RPC % is missing', function_signature;
    END IF;
    IF has_function_privilege('anon', function_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', function_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC % has incorrect execute grants', function_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE oid = to_regprocedure(function_signature)
        AND prosecdef
        AND proconfig @> ARRAY['search_path=pg_catalog, public']
    ) THEN
      RAISE EXCEPTION 'RPC % is not security-definer with a pinned path', function_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'referee_test_settings'
      AND column_name = 'attempt_ttl_minutes'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'referee_test_settings'
      AND column_name = 'retry_cooldown_minutes'
  ) THEN
    RAISE EXCEPTION 'attempt timing settings are missing';
  END IF;
END
$$;
