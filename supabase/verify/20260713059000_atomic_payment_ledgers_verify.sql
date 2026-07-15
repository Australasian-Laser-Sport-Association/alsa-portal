DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_parent_lock integer;
  v_ledger_lock integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_records'
       AND column_name = 'request_id' AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_records_history'
       AND column_name = 'request_id' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Payment idempotency/audit columns are missing.';
  END IF;

  IF to_regclass('public.payment_mutation_requests') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'payment_records_request_id_unique'
          AND indexdef ILIKE '%UNIQUE%WHERE (request_id IS NOT NULL)%'
     ) THEN
    RAISE EXCEPTION 'Payment mutation receipts or create uniqueness are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class table_class
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_class.relname = 'payment_mutation_requests'
      AND table_class.relrowsecurity
  ) OR has_table_privilege('authenticated', 'public.payment_mutation_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_mutation_requests', 'INSERT') THEN
    RAISE EXCEPTION 'Payment mutation receipts are not service-only.';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.record_zltac_payment(uuid,uuid,uuid,integer,timestamp with time zone,text,text)'::regprocedure,
    'public.update_zltac_payment(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.remove_zltac_payment(uuid,uuid,uuid)'::regprocedure,
    'public.record_competition_payment(uuid,uuid,uuid,integer,timestamp with time zone,text,text)'::regprocedure,
    'public.update_competition_payment(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.remove_competition_payment(uuid,uuid,uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Atomic payment function % has unsafe execute grants.', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
       WHERE procedure.oid = v_signature
         AND procedure.prosecdef
         AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION 'Atomic payment function % is not hardened.', v_signature;
    END IF;
  END LOOP;

  v_definition := pg_get_functiondef('public._lock_zltac_payment_context(uuid,uuid)'::regprocedure);
  v_parent_lock := strpos(v_definition, 'FROM public.zltac_registrations');
  v_ledger_lock := strpos(v_definition, 'FROM public.payment_records');
  IF v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
     OR v_parent_lock = 0 OR v_ledger_lock = 0 OR v_parent_lock >= v_ledger_lock THEN
    RAISE EXCEPTION 'ZLTAC payment context does not lock event, parent, then ledger.';
  END IF;

  v_definition := pg_get_functiondef('public._lock_competition_payment_context(uuid,uuid)'::regprocedure);
  v_parent_lock := strpos(v_definition, 'FROM public.competition_registrations');
  v_ledger_lock := strpos(v_definition, 'FROM public.payment_records');
  IF v_definition NOT ILIKE '%FROM public.competitions%FOR UPDATE%'
     OR v_parent_lock = 0 OR v_ledger_lock = 0 OR v_parent_lock >= v_ledger_lock
     OR v_definition NOT ILIKE '%suspended%' THEN
    RAISE EXCEPTION 'Competition payment context lacks ordered locks or active-manager enforcement.';
  END IF;

  v_definition := pg_get_functiondef('public._payment_ledger_response(uuid,uuid)'::regprocedure);
  IF v_definition NOT ILIKE '%UPDATE public.competition_registrations%'
     OR v_definition NOT ILIKE '%amount_paid%'
     OR v_definition NOT ILIKE '%payment_status%'
     OR v_definition NOT ILIKE '%jsonb_agg%' THEN
    RAISE EXCEPTION 'Canonical payment response does not atomically persist competition totals.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.record_competition_payment(uuid,uuid,uuid,integer,timestamp with time zone,text,text)'::regprocedure
  );
  v_parent_lock := strpos(v_definition, '_lock_competition_payment_context');
  v_ledger_lock := strpos(v_definition, '_replay_payment_request');
  IF v_definition NOT ILIKE '%_take_payment_request_lock%'
     OR v_definition NOT ILIKE '%_replay_payment_request%'
     OR v_definition NOT ILIKE '%_store_payment_request%'
     OR v_definition NOT ILIKE '%_payment_ledger_response%'
     OR v_parent_lock = 0 OR v_ledger_lock = 0 OR v_parent_lock >= v_ledger_lock THEN
    RAISE EXCEPTION 'Competition creates are not idempotent and atomic.';
  END IF;

  v_definition := pg_get_functiondef(
    'public.update_zltac_payment(uuid,uuid,uuid,jsonb)'::regprocedure
  );
  v_parent_lock := strpos(v_definition, '_lock_zltac_payment_context');
  v_ledger_lock := strpos(v_definition, '_replay_payment_request');
  IF v_definition NOT ILIKE '%_payment_request_target%'
     OR v_parent_lock = 0 OR v_ledger_lock = 0 OR v_parent_lock >= v_ledger_lock THEN
    RAISE EXCEPTION 'Payment retries can resolve before actor/scope authorization.';
  END IF;

  v_definition := pg_get_functiondef(
    'public._payment_request_target(uuid,text,text,uuid,uuid,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%actor_id IS DISTINCT FROM p_actor_id%'
     OR v_definition NOT ILIKE '%request_payload IS DISTINCT FROM p_request_payload%' THEN
    RAISE EXCEPTION 'Payment retry receipts are not actor and payload bound.';
  END IF;

  v_definition := pg_get_functiondef('public.log_payment_record_delete()'::regprocedure);
  IF v_definition NOT ILIKE '%app.payment_request_id%'
     OR v_definition NOT ILIKE '%request_id%' THEN
    RAISE EXCEPTION 'Delete audit trigger does not retain the mutation request id.';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.record_competition_payment(uuid,uuid,integer,timestamp with time zone,text,text)'::regprocedure,
    'public.update_competition_payment(uuid,uuid,jsonb)'::regprocedure,
    'public.remove_competition_payment(uuid,uuid)'::regprocedure,
    'public.edit_payment_record(uuid,jsonb,uuid)'::regprocedure,
    'public.delete_payment_record(uuid,uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Retired payment function % has unsafe execute grants.', v_signature;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc procedure
       WHERE procedure.oid = v_signature
         AND procedure.prosecdef
         AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION 'Retired payment function % is not hardened.', v_signature;
    END IF;

    v_definition := pg_get_functiondef(v_signature);
    IF v_definition NOT ILIKE '%RAISE EXCEPTION%payment workflow%'
       OR v_definition NOT ILIKE '%ERRCODE = ''55000''%' THEN
      RAISE EXCEPTION 'Retired payment function % no longer fails closed.', v_signature;
    END IF;
  END LOOP;
END;
$$;
