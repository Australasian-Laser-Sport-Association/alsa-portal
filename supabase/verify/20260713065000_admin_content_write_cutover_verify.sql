DO $$
DECLARE
  v_mutate regprocedure := to_regprocedure(
    'public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'
  );
  v_submit regprocedure := to_regprocedure(
    'public.submit_referee_test_attempt(uuid,uuid,jsonb)'
  );
  v_audit_guard regprocedure := to_regprocedure(
    'public.prevent_admin_content_audit_mutation()'
  );
  v_definition text;
  v_submit_definition text;
  v_submit_advisory_pos integer;
  v_submit_question_lock_pos integer;
  v_submit_attempt_select_pos integer;
  v_submit_attempt_row_lock_pos integer;
  v_submit_not_found_pos integer;
  v_submit_now_pos integer;
  v_submit_status_pos integer;
  v_submit_expiry_pos integer;
  v_question_lock_pos integer;
  v_question_select_pos integer;
  v_question_update_pos integer;
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_table text;
  v_view text;
BEGIN
  IF v_mutate IS NULL OR v_submit IS NULL OR v_audit_guard IS NULL THEN
    RAISE EXCEPTION 'Admin content mutation contracts are missing.';
  END IF;

  IF has_function_privilege('anon', v_mutate, 'EXECUTE')
     OR has_function_privilege('authenticated', v_mutate, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_mutate, 'EXECUTE') THEN
    RAISE EXCEPTION 'Admin content mutation has unsafe execute grants.';
  END IF;

  IF has_function_privilege('anon', v_submit, 'EXECUTE')
     OR has_function_privilege('authenticated', v_submit, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_submit, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rules Test submission has unsafe execute grants.';
  END IF;

  IF has_function_privilege('anon', v_audit_guard, 'EXECUTE')
     OR has_function_privilege('authenticated', v_audit_guard, 'EXECUTE')
     OR has_function_privilege('service_role', v_audit_guard, 'EXECUTE') THEN
    RAISE EXCEPTION 'Admin content audit trigger function is directly executable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc AS procedure
     WHERE procedure.oid = v_mutate
       AND procedure.prosecdef
       AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_proc AS procedure
     WHERE procedure.oid = v_submit
       AND procedure.prosecdef
       AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_proc AS procedure
     WHERE procedure.oid = v_audit_guard
       AND procedure.prosecdef
       AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) THEN
    RAISE EXCEPTION 'Admin content functions are not hardened.';
  END IF;

  v_submit_definition := pg_get_functiondef(v_submit);
  v_submit_advisory_pos := strpos(
    lower(v_submit_definition),
    'perform pg_advisory_xact_lock'
  );
  v_submit_question_lock_pos := strpos(
    lower(v_submit_definition),
    'lock table public.referee_questions in access share mode'
  );
  v_submit_attempt_select_pos := strpos(
    lower(v_submit_definition),
    'from public.referee_test_attempts'
  );
  v_submit_attempt_row_lock_pos := strpos(
    lower(v_submit_definition),
    'for update;'
  );
  v_submit_not_found_pos := strpos(
    lower(v_submit_definition),
    'if not found then'
  );
  v_submit_now_pos := strpos(
    lower(v_submit_definition),
    'v_now := pg_catalog.clock_timestamp()'
  );
  v_submit_status_pos := strpos(
    lower(v_submit_definition),
    'if v_attempt.status <> ''started'' then'
  );
  v_submit_expiry_pos := strpos(
    lower(v_submit_definition),
    'if v_attempt.expires_at <= v_now then'
  );
  IF v_submit_advisory_pos = 0
     OR v_submit_question_lock_pos = 0
     OR v_submit_attempt_select_pos = 0
     OR v_submit_attempt_row_lock_pos = 0
     OR v_submit_not_found_pos = 0
     OR v_submit_now_pos = 0
     OR v_submit_status_pos = 0
     OR v_submit_expiry_pos = 0
     OR NOT (
       v_submit_advisory_pos < v_submit_question_lock_pos
       AND v_submit_question_lock_pos < v_submit_attempt_select_pos
       AND v_submit_attempt_select_pos < v_submit_attempt_row_lock_pos
       AND v_submit_attempt_row_lock_pos < v_submit_not_found_pos
       AND v_submit_not_found_pos < v_submit_now_pos
       AND v_submit_now_pos < v_submit_status_pos
       AND v_submit_status_pos < v_submit_expiry_pos
     )
     OR regexp_count(
       v_submit_definition,
       'LOCK TABLE public.referee_questions IN ACCESS SHARE MODE',
       1,
       'i'
     ) <> 1
     OR v_submit_definition NOT ILIKE
       '%UPDATE public.referee_test_attempts SET status = ''expired''%'
     OR v_submit_definition NOT ILIKE '%''expired'', true%'
  THEN
    RAISE EXCEPTION 'Rules Test submission lost its deadline-safe lock and timestamp order.';
  END IF;

  v_definition := pg_get_functiondef(v_mutate);
  v_question_lock_pos := strpos(
    lower(v_definition),
    'lock table public.referee_questions in access exclusive mode'
  );
  v_question_select_pos := strpos(
    lower(v_definition),
    'select question.* into v_question'
  );
  v_question_update_pos := strpos(
    lower(v_definition),
    'update public.referee_questions as question'
  );
  IF v_definition NOT ILIKE '%profile.id = p_actor_id%'
     OR v_definition NOT ILIKE '%FOR UPDATE%'
     OR v_definition NOT ILIKE '%suspended%'
     OR v_definition NOT ILIKE '%is_placeholder%'
     OR v_definition NOT ILIKE '%superadmin%'
     OR v_definition NOT ILIKE '%alsa_committee%'
     OR v_definition NOT ILIKE '%zltac_committee%'
     OR v_definition NOT ILIKE '%advisor%'
     OR v_definition NOT ILIKE '%active committee account is required%'
     OR v_definition NOT ILIKE '%INSERT INTO public.admin_content_mutation_audit%'
     OR v_definition NOT ILIKE '%DELETE FROM public.zltac_event_placings%'
     OR v_definition NOT ILIKE '%INSERT INTO public.zltac_event_placings%'
     OR v_definition NOT ILIKE '%UPDATE public.zltac_event_placings%'
     OR v_definition NOT ILIKE '%Document category must belong to the document scope%'
     OR v_definition NOT ILIKE '%A category cannot move across scopes while it has linked documents%'
     OR v_definition NOT ILIKE '%Event end date must be on or after its start date%'
     OR v_definition NOT ILIKE '%Dynasty years do not match its category%'
     OR v_question_lock_pos = 0
     OR v_question_select_pos = 0
     OR v_question_update_pos = 0
     OR v_question_lock_pos >= v_question_select_pos
     OR v_question_lock_pos >= v_question_update_pos
     OR regexp_count(
       v_definition,
       'Question is part of an active Rules Test attempt',
       1,
       'i'
     ) <> 1
     OR v_definition NOT ILIKE '%Question is part of an active Rules Test attempt%'
     OR v_definition !~* 'v_record_id[[:space:]]+uuid[[:space:]]*;'
     OR v_definition ILIKE '%v_record_id uuid := p_record_id%'
  THEN
    RAISE EXCEPTION 'Admin content mutation lost an authorization, integrity, audit, or atomicity guard.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_record
     WHERE constraint_record.conrelid = 'public.document_categories'::regclass
       AND constraint_record.conname = 'document_categories_id_scope_key'
       AND constraint_record.contype = 'u'
       AND constraint_record.convalidated
       AND pg_get_constraintdef(constraint_record.oid)
         ILIKE 'UNIQUE (id, scope)%'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_record
     WHERE constraint_record.conrelid = 'public.documents'::regclass
       AND constraint_record.conname = 'documents_category_scope_fkey'
       AND constraint_record.contype = 'f'
       AND constraint_record.convalidated
       AND pg_get_constraintdef(constraint_record.oid)
         ILIKE '%FOREIGN KEY (category_id, scope)%REFERENCES document_categories(id, scope)%ON UPDATE RESTRICT%ON DELETE SET NULL (category_id)%'
  ) THEN
    RAISE EXCEPTION 'Composite document/category scope constraints are missing or unvalidated.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_record
     WHERE constraint_record.conrelid = 'public.zltac_dynasties'::regclass
       AND constraint_record.conname = 'zltac_dynasties_category_years_check'
       AND constraint_record.contype = 'c'
       AND constraint_record.convalidated
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%array_ndims(years) = 1%'
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%array_lower(years, 1) = 1%'
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%array_position(years%NULL%IS NULL%'
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%category = ''three_peat''%'
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%cardinality(years) = 3%'
       AND pg_get_constraintdef(constraint_record.oid) ~*
         'years[[]3[]][[:space:]]*=[[:space:]]*[(]?years[[]2[]][[:space:]]*[+][[:space:]]*1[)]?'
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%category = ''back_to_back''%'
       AND pg_get_constraintdef(constraint_record.oid) ILIKE '%cardinality(years) = 2%'
       AND pg_get_constraintdef(constraint_record.oid) ~*
         'years[[]2[]][[:space:]]*=[[:space:]]*[(]?years[[]1[]][[:space:]]*[+][[:space:]]*1[)]?'
  ) THEN
    RAISE EXCEPTION 'Canonical dynasty category/year CHECK is missing or unvalidated.';
  END IF;

  IF to_regclass('public.admin_content_mutation_audit') IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_class AS relation
        WHERE relation.oid = 'public.admin_content_mutation_audit'::regclass
          AND relation.relrowsecurity
     ) THEN
    RAISE EXCEPTION 'Admin content audit table is missing RLS.';
  END IF;

  IF has_table_privilege('anon', 'public.admin_content_mutation_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.admin_content_mutation_audit', 'SELECT')
     OR has_table_privilege('anon', 'public.admin_content_mutation_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.admin_content_mutation_audit', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'SELECT')
     OR has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'INSERT')
     OR has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'UPDATE')
     OR has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'DELETE')
     OR has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.admin_content_mutation_audit', 'TRIGGER') THEN
    RAISE EXCEPTION 'Admin content audit table has unsafe direct privileges.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger
     WHERE trigger.tgrelid = 'public.admin_content_mutation_audit'::regclass
       AND trigger.tgname = 'admin_content_mutation_audit_immutable'
       AND NOT trigger.tgisinternal
       AND (trigger.tgtype & 1) <> 0
       AND (trigger.tgtype & 2) <> 0
       AND (trigger.tgtype & 16) <> 0
       AND (trigger.tgtype & 8) <> 0
       AND trigger.tgenabled <> 'D'
  ) OR pg_get_functiondef(v_audit_guard) NOT ILIKE '%RAISE EXCEPTION%append-only%55000%' THEN
    RAISE EXCEPTION 'Admin content audit rows are not append-only.';
  END IF;

  -- 65000 is the expand checkpoint. Existing browser consumers must keep
  -- working until the separately deployable 66000 contract is applied. The
  -- 66000-owned marker lets the final-state verification runner revisit this
  -- file without weakening the actual expansion checkpoint.
  IF obj_description(v_mutate, 'pg_proc') IS DISTINCT FROM v_contract_marker THEN
    FOREACH v_table IN ARRAY ARRAY[
      'document_categories',
      'documents',
      'cms_global',
      'zltac_event_history',
      'zltac_event_placings',
      'zltac_legends',
      'zltac_dynasties',
      'zltac_hall_of_fame'
    ] LOOP
      IF NOT has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
         OR NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
        RAISE EXCEPTION '65000 removed a legacy public read grant from public.%', v_table;
      END IF;
    END LOOP;

    FOREACH v_table IN ARRAY ARRAY[
      'referee_questions',
      'referee_test_settings'
    ] LOOP
      IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
        RAISE EXCEPTION '65000 removed a legacy authenticated read grant from public.%', v_table;
      END IF;
    END LOOP;

    FOREACH v_table IN ARRAY ARRAY[
      'document_categories',
      'documents',
      'cms_global',
      'zltac_event_placings',
      'zltac_legends',
      'zltac_dynasties',
      'zltac_hall_of_fame'
    ] LOOP
      IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
         OR NOT has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
         OR NOT has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
        RAISE EXCEPTION '65000 contracted a legacy admin write grant on public.%', v_table;
      END IF;
    END LOOP;
  ELSE
    FOREACH v_table IN ARRAY ARRAY[
      'document_categories',
      'documents',
      'cms_global',
      'referee_questions',
      'referee_test_settings',
      'zltac_event_history',
      'zltac_event_placings',
      'zltac_legends',
      'zltac_dynasties',
      'zltac_hall_of_fame'
    ] LOOP
      IF has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
         OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
         OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
         OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
         OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
         OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
        RAISE EXCEPTION '66000 marker exists but browser mutation remains on public.%', v_table;
      END IF;
    END LOOP;

    FOREACH v_table IN ARRAY ARRAY[
      'referee_questions',
      'referee_test_settings',
      'zltac_event_history',
      'zltac_legends',
      'zltac_dynasties',
      'zltac_hall_of_fame'
    ] LOOP
      IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
         OR has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
        RAISE EXCEPTION '66000 marker exists but sensitive base SELECT remains on public.%', v_table;
      END IF;
    END LOOP;
  END IF;

  FOREACH v_view IN ARRAY ARRAY[
    'public_zltac_event_history',
    'public_zltac_legends',
    'public_zltac_dynasties',
    'public_zltac_hall_of_fame',
    'public_referee_test_settings'
  ] LOOP
    IF to_regclass(format('public.%I', v_view)) IS NULL
       OR NOT has_table_privilege('anon', format('public.%I', v_view), 'SELECT')
       OR NOT has_table_privilege('authenticated', format('public.%I', v_view), 'SELECT')
       OR NOT has_table_privilege('service_role', format('public.%I', v_view), 'SELECT')
       OR EXISTS (
         SELECT 1
           FROM pg_class AS relation
          WHERE relation.oid = to_regclass(format('public.%I', v_view))
            AND NOT (
              coalesce(relation.reloptions, ARRAY[]::text[]) @> ARRAY['security_barrier=true']::text[]
              AND coalesce(relation.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=false']::text[]
            )
       ) THEN
      RAISE EXCEPTION 'Public-safe view % is missing, ungranted, or not hardened.', v_view;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_zltac_event_history'
       AND column_name = 'internal_notes'
  ) OR pg_get_viewdef('public.public_zltac_event_history'::regclass, true)
       ILIKE '%internal_notes%' THEN
    RAISE EXCEPTION 'Public history view exposes internal_notes.';
  END IF;

  IF pg_get_viewdef('public.public_zltac_legends'::regclass, true)
       NOT ILIKE '%WHERE%is_visible%'
     OR pg_get_viewdef('public.public_zltac_dynasties'::regclass, true)
       NOT ILIKE '%WHERE%is_visible%'
     OR pg_get_viewdef('public.public_zltac_hall_of_fame'::regclass, true)
       NOT ILIKE '%WHERE%is_visible%' THEN
    RAISE EXCEPTION 'A public editorial view no longer filters hidden drafts.';
  END IF;

  IF EXISTS (
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_referee_test_settings'
    EXCEPT
    SELECT unnest(ARRAY[
      'id',
      'safety_questions_per_test',
      'safety_pass_score',
      'general_questions_per_test',
      'general_pass_score'
    ]::text[])
  ) OR (
    SELECT count(*)
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_referee_test_settings'
  ) <> 5 THEN
    RAISE EXCEPTION 'Public Rules Test settings view exposes unexpected columns.';
  END IF;

  IF to_regclass('public.admin_asset_upload_audit') IS NULL
     OR NOT has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.admin_asset_upload_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.admin_asset_upload_audit', 'SELECT')
     OR has_table_privilege('anon', 'public.admin_asset_upload_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.admin_asset_upload_audit', 'INSERT')
     OR has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'UPDATE')
     OR has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'DELETE')
     OR has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.admin_asset_upload_audit', 'TRIGGER') THEN
    RAISE EXCEPTION 'Admin asset upload audit ACL contract is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.admin_asset_upload_audit'::regclass
       AND tgname = 'admin_asset_upload_audit_immutable'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Admin asset upload audit immutability trigger is missing.';
  END IF;
END;
$$;
