-- Read-only verification for atomic legal and under-18 event workflows.

DO $$
DECLARE
  v_reconcile regprocedure := to_regprocedure(
    'public.reconcile_legal_document_publication(text,text,text,bigint)'
  );
  v_accept regprocedure := to_regprocedure(
    'public.accept_legal_document(uuid,integer,uuid,inet,text)'
  );
  v_submit regprocedure := to_regprocedure(
    'public.submit_under_18_approval(uuid,integer,uuid)'
  );
  v_create regprocedure := to_regprocedure(
    'public.committee_create_under_18_approval(uuid,uuid,integer,text,text)'
  );
  v_decide regprocedure := to_regprocedure(
    'public.committee_decide_under_18_approval(uuid,uuid,text,text)'
  );
  v_function regprocedure;
  v_definition text;
BEGIN
  IF v_reconcile IS NULL
    OR v_accept IS NULL
    OR v_submit IS NULL
    OR v_create IS NULL
    OR v_decide IS NULL THEN
    RAISE EXCEPTION 'One or more legal lifecycle RPCs are missing.';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    v_reconcile, v_accept, v_submit, v_create, v_decide
  ]
  LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
      OR has_function_privilege('authenticated', v_function, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Legal lifecycle RPC % has unsafe EXECUTE privileges.', v_function;
    END IF;
    IF NOT (SELECT procedure.prosecdef FROM pg_proc AS procedure WHERE procedure.oid = v_function) THEN
      RAISE EXCEPTION 'Legal lifecycle RPC % is not SECURITY DEFINER.', v_function;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc AS procedure
       WHERE procedure.oid = v_function
         AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION 'Legal lifecycle RPC % has an unsafe search_path.', v_function;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.legal_acceptances', 'INSERT')
    OR has_table_privilege('anon', 'public.legal_acceptances', 'UPDATE')
    OR has_table_privilege('anon', 'public.legal_acceptances', 'DELETE')
    OR has_table_privilege('authenticated', 'public.legal_acceptances', 'INSERT')
    OR has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.legal_acceptances', 'DELETE')
    OR has_table_privilege('service_role', 'public.legal_acceptances', 'INSERT')
    OR has_table_privilege('service_role', 'public.legal_acceptances', 'UPDATE')
    OR has_table_privilege('service_role', 'public.legal_acceptances', 'DELETE') THEN
    RAISE EXCEPTION 'legal_acceptances still permits direct mutations.';
  END IF;

  IF has_table_privilege('anon', 'public.under_18_approvals', 'INSERT')
    OR has_table_privilege('anon', 'public.under_18_approvals', 'UPDATE')
    OR has_table_privilege('anon', 'public.under_18_approvals', 'DELETE')
    OR has_table_privilege('authenticated', 'public.under_18_approvals', 'INSERT')
    OR has_table_privilege('authenticated', 'public.under_18_approvals', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.under_18_approvals', 'DELETE')
    OR has_table_privilege('service_role', 'public.under_18_approvals', 'INSERT')
    OR has_table_privilege('service_role', 'public.under_18_approvals', 'UPDATE')
    OR has_table_privilege('service_role', 'public.under_18_approvals', 'DELETE') THEN
    RAISE EXCEPTION 'under_18_approvals still permits direct mutations.';
  END IF;

  v_definition := pg_get_functiondef(v_reconcile);
  IF v_definition NOT ILIKE '%pg_advisory_xact_lock%'
    OR v_definition NOT ILIKE '%public.legal_documents:%'
    OR v_definition NOT ILIKE '%document.file_path = p_file_path%'
    OR v_definition NOT ILIKE '%document.content_sha256 = p_content_sha256%'
    OR v_definition NOT ILIKE '%document.object_size = p_object_size%'
    OR v_definition NOT ILIKE '%document.published_at IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'Publication reconciliation lacks its serialization boundary.';
  END IF;

  v_definition := pg_get_functiondef(v_accept);
  IF v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
    OR v_definition NOT ILIKE '%FROM public.zltac_registrations%FOR UPDATE OF registration%'
    OR v_definition NOT ILIKE '%FROM public.legal_documents%FOR SHARE%'
    OR v_definition NOT ILIKE '%v_event_status NOT IN (''open'', ''closed'')%'
    OR v_definition NOT ILIKE '%document.document_type IN (''code_of_conduct'', ''media_release'')%'
    OR v_definition NOT ILIKE '%INSERT INTO public.legal_acceptances%'
  THEN
    RAISE EXCEPTION 'accept_legal_document() lacks required lifecycle locks.';
  END IF;

  v_definition := pg_get_functiondef(v_submit);
  IF v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
    OR v_definition NOT ILIKE '%FROM public.zltac_registrations%FOR UPDATE OF registration%'
    OR v_definition NOT ILIKE '%FROM public.legal_documents%FOR SHARE%'
    OR v_definition NOT ILIKE '%FROM public.under_18_approvals%FOR UPDATE%'
    OR v_definition NOT ILIKE '%v_event_status NOT IN (''open'', ''closed'')%'
    OR v_definition NOT ILIKE '%document.published_at IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'submit_under_18_approval() lacks required lifecycle locks.';
  END IF;

  v_definition := pg_get_functiondef(v_create);
  IF v_definition NOT ILIKE '%''advisor''%'
    OR v_definition NOT ILIKE '%profile.suspended%'
    OR v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
    OR v_definition NOT ILIKE '%FROM public.zltac_registrations%FOR UPDATE OF registration%'
    OR v_definition NOT ILIKE '%FROM public.legal_documents%FOR SHARE%'
    OR v_definition NOT ILIKE '%FROM public.under_18_approvals%FOR UPDATE%'
    OR v_definition NOT ILIKE '%v_event_status NOT IN (''open'', ''closed'')%'
    OR v_definition NOT ILIKE '%INSERT INTO public.under_18_approvals%'
  THEN
    RAISE EXCEPTION 'committee_create_under_18_approval() lacks required controls.';
  END IF;

  v_definition := pg_get_functiondef(v_decide);
  IF v_definition NOT ILIKE '%''advisor''%'
    OR v_definition NOT ILIKE '%profile.suspended%'
    OR v_definition NOT ILIKE '%FROM public.zltac_events%FOR UPDATE%'
    OR v_definition NOT ILIKE '%FROM public.zltac_registrations%FOR UPDATE OF registration%'
    OR v_definition NOT ILIKE '%FROM public.legal_documents%FOR SHARE%'
    OR v_definition NOT ILIKE '%FROM public.under_18_approvals%FOR UPDATE%'
    OR v_definition NOT ILIKE '%v_event_status NOT IN (''open'', ''closed'')%'
    OR v_definition NOT ILIKE '%v_approval.document_id IS DISTINCT FROM v_initial_document_id%'
    OR v_definition NOT ILIKE '%v_approval.document_id IS DISTINCT FROM v_active_document_id%'
    OR v_definition NOT ILIKE '%UPDATE public.under_18_approvals%'
  THEN
    RAISE EXCEPTION 'committee_decide_under_18_approval() lacks required controls.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'legal_documents_published_file_path_uidx'
       AND indexdef ILIKE '%UNIQUE%file_path%'
  ) THEN
    RAISE EXCEPTION 'Published legal file paths are not unique for reconciliation.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.under_18_approvals AS approval
      JOIN public.legal_documents AS document ON document.id = approval.document_id
     WHERE approval.anonymized_at IS NULL
       AND document.document_type <> 'under_18_form'
  ) THEN
    RAISE EXCEPTION 'An under-18 approval references the wrong document type.';
  END IF;
END;
$$;
