-- Read-only verification for acknowledgement metadata minimisation and lifecycle cleanup.

DO $$
DECLARE
  v_unlink_function regprocedure := to_regprocedure(
    'public.unlink_legal_document_uploader_before_profile_delete()'
  );
  v_acceptance_function regprocedure := to_regprocedure(
    'public.prevent_legal_acceptance_update()'
  );
  v_document_function regprocedure := to_regprocedure(
    'public.guard_legal_document_immutable()'
  );
  v_function regprocedure;
  v_definition text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'legal_acceptances'
          AND column_name IN ('subject_token', 'anonymized_at'))
         OR
         (table_name = 'under_18_approvals'
          AND column_name IN (
            'subject_token', 'anonymized_at', 'reviewer_unlinked_at'
          ))
       )
  ) THEN
    RAISE EXCEPTION 'pseudonymous acknowledgement-retention columns still exist';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('legal_acceptances', 'under_18_approvals')
       AND column_name = 'user_id'
       AND is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'acknowledgement subject links are unexpectedly nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_network_metadata_empty'
       AND contype = 'c'
       AND convalidated
       AND pg_get_constraintdef(oid) ILIKE '%ip_address IS NULL%'
       AND pg_get_constraintdef(oid) ILIKE '%user_agent IS NULL%'
  ) OR EXISTS (
    SELECT 1
      FROM public.legal_acceptances
     WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'acknowledgement network metadata is not empty and constrained';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_user_id_fkey'
       AND confrelid = 'public.profiles'::regclass
       AND confdeltype = 'c'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_user_id_fkey'
       AND confrelid = 'public.profiles'::regclass
       AND confdeltype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'profile-owned acknowledgement rows do not cascade on delete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_event_year_fkey'
       AND confrelid = 'public.zltac_events'::regclass
       AND confdeltype = 'c'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_event_year_fkey'
       AND confrelid = 'public.zltac_events'::regclass
       AND confdeltype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'event-owned acknowledgement rows do not cascade on delete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_decision_coherent'
       AND contype = 'c'
       AND convalidated
       AND pg_get_constraintdef(oid) ILIKE '%approved_at IS NOT NULL%'
       AND pg_get_constraintdef(oid) NOT ILIKE '%reviewer_unlinked_at%'
  ) THEN
    RAISE EXCEPTION 'under-18 decision coherence does not support reviewer unlink';
  END IF;

  IF to_regprocedure(
       'public.anonymize_legal_evidence_before_profile_delete()'
     ) IS NOT NULL
    OR to_regprocedure('public.guard_under_18_evidence_retention()') IS NOT NULL
    OR EXISTS (
      SELECT 1
        FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN (
           'profiles_anonymize_retained_legal_evidence',
           'legal_acceptances_prevent_delete',
           'under_18_approvals_preserve_evidence'
         )
    ) THEN
    RAISE EXCEPTION 'indefinite pseudonymous retention objects still exist';
  END IF;

  IF v_unlink_function IS NULL
    OR v_acceptance_function IS NULL
    OR v_document_function IS NULL THEN
    RAISE EXCEPTION 'one or more acknowledgement integrity functions are missing';
  END IF;

  IF NOT (
    SELECT procedure.prosecdef
      FROM pg_proc AS procedure
     WHERE procedure.oid = v_unlink_function
  ) THEN
    RAISE EXCEPTION 'document-uploader unlink function is not SECURITY DEFINER';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    v_unlink_function,
    v_acceptance_function,
    v_document_function
  ] LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
      OR has_function_privilege('authenticated', v_function, 'EXECUTE')
      OR has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION '% has an unsafe direct EXECUTE grant', v_function;
    END IF;
  END LOOP;

  v_definition := pg_get_functiondef(v_unlink_function);
  IF v_definition NOT ILIKE '%alsa.unlinking_document_uploader%'
    OR v_definition NOT ILIKE '%UPDATE public.legal_documents%'
    OR v_definition NOT ILIKE '%uploaded_by = NULL%'
  THEN
    RAISE EXCEPTION 'profile-delete function lacks controlled uploader unlink';
  END IF;

  v_definition := pg_get_functiondef(v_acceptance_function);
  IF v_definition NOT ILIKE '%acknowledgement records are append-only%'
    OR v_definition ILIKE '%TG_OP = ''DELETE''%'
  THEN
    RAISE EXCEPTION 'legal acceptance UPDATE guard lost its scoped contract';
  END IF;

  v_definition := pg_get_functiondef(v_document_function);
  IF v_definition NOT ILIKE '%pg_trigger_depth()%'
    OR v_definition NOT ILIKE '%alsa.unlinking_document_uploader%'
    OR v_definition NOT ILIKE '%OLD.uploaded_by IS NOT NULL%'
    OR v_definition NOT ILIKE '%NEW.uploaded_by IS NULL%'
    OR v_definition NOT ILIKE '%published required documents are immutable%'
  THEN
    RAISE EXCEPTION 'required-document immutability guard lost its controlled unlink';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_unlink_legal_document_uploader'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
       AND pg_get_triggerdef(oid) ILIKE '%BEFORE DELETE%'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.legal_documents'::regclass
       AND tgname = 'trg_legal_documents_immutable'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
       AND pg_get_triggerdef(oid) ILIKE '%BEFORE UPDATE%'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.legal_acceptances'::regclass
       AND tgname = 'legal_acceptances_prevent_update'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
       AND pg_get_triggerdef(oid) ILIKE '%BEFORE UPDATE%'
  ) THEN
    RAISE EXCEPTION 'acknowledgement integrity triggers are missing or disabled';
  END IF;

  v_definition := pg_get_functiondef(
    'public.delete_zltac_event(uuid,uuid)'::regprocedure
  );
  IF v_definition NOT ILIKE '%DELETE FROM public.legal_acceptances%'
    OR v_definition NOT ILIKE '%DELETE FROM public.under_18_approvals%'
  THEN
    RAISE EXCEPTION 'event delete RPC no longer performs acknowledgement cleanup';
  END IF;
END;
$$;
