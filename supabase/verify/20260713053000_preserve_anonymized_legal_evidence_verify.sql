-- Read-only verification for pseudonymous legal-evidence retention.

DO $$
DECLARE
  v_profile_function regprocedure := to_regprocedure(
    'public.anonymize_legal_evidence_before_profile_delete()'
  );
  v_acceptance_function regprocedure := to_regprocedure(
    'public.prevent_legal_acceptance_update()'
  );
  v_under_18_function regprocedure := to_regprocedure(
    'public.guard_under_18_evidence_retention()'
  );
  v_document_function regprocedure := to_regprocedure(
    'public.guard_legal_document_immutable()'
  );
  v_function regprocedure;
  v_definition text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('legal_acceptances', 'subject_token', 'YES'),
        ('legal_acceptances', 'anonymized_at', 'YES'),
        ('under_18_approvals', 'subject_token', 'YES'),
        ('under_18_approvals', 'anonymized_at', 'YES'),
        ('under_18_approvals', 'reviewer_unlinked_at', 'YES'),
        ('legal_acceptances', 'user_id', 'YES'),
        ('under_18_approvals', 'user_id', 'YES')
      ) AS required(table_name, column_name, is_nullable)
     WHERE NOT EXISTS (
       SELECT 1
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required.column_name
          AND c.is_nullable = required.is_nullable
     )
  ) THEN
    RAISE EXCEPTION 'legal evidence retention columns are missing or incorrectly nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_subject_state_valid'
       AND contype = 'c'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_subject_state_valid'
       AND contype = 'c'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_decision_coherent'
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%reviewer_unlinked_at%'
  ) THEN
    RAISE EXCEPTION 'legal evidence retention checks are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_user_id_fkey'
       AND confrelid = 'public.profiles'::regclass
       AND confdeltype = 'r'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_user_id_fkey'
       AND confrelid = 'public.profiles'::regclass
       AND confdeltype = 'r'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'subject profile foreign keys are not validated RESTRICT links';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_event_year_fkey'
       AND confrelid = 'public.zltac_events'::regclass
       AND confdeltype = 'r'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_event_year_fkey'
       AND confrelid = 'public.zltac_events'::regclass
       AND confdeltype = 'r'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'event evidence foreign keys are not validated RESTRICT links';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'legal_acceptances_subject_token_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'under_18_approvals_subject_token_idx'
  ) THEN
    RAISE EXCEPTION 'subject-token indexes are missing';
  END IF;

  IF v_profile_function IS NULL
    OR v_acceptance_function IS NULL
    OR v_under_18_function IS NULL
    OR v_document_function IS NULL THEN
    RAISE EXCEPTION 'one or more legal evidence retention functions are missing';
  END IF;

  IF NOT (
    SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_profile_function
  ) THEN
    RAISE EXCEPTION 'profile-delete anonymization function is not SECURITY DEFINER';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    v_profile_function,
    v_acceptance_function,
    v_under_18_function,
    v_document_function
  ] LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
      OR has_function_privilege('authenticated', v_function, 'EXECUTE')
      OR has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION '% has an unsafe direct EXECUTE grant', v_function;
    END IF;
  END LOOP;

  v_definition := pg_get_functiondef(v_profile_function);
  IF v_definition NOT ILIKE '%gen_random_uuid()%'
    OR v_definition NOT ILIKE '%app.anonymizing_legal_evidence%'
    OR v_definition NOT ILIKE '%UPDATE public.legal_acceptances%'
    OR v_definition NOT ILIKE '%UPDATE public.under_18_approvals%'
    OR v_definition NOT ILIKE '%UPDATE public.legal_documents%'
    OR v_definition NOT ILIKE '%ip_address = NULL%'
    OR v_definition NOT ILIKE '%user_agent = NULL%'
    OR v_definition NOT ILIKE '%notes = CASE%'
  THEN
    RAISE EXCEPTION 'profile-delete function lacks required unlink and scrub operations';
  END IF;

  v_definition := pg_get_functiondef(v_acceptance_function);
  IF v_definition NOT ILIKE '%pg_trigger_depth()%'
    OR v_definition NOT ILIKE '%TG_OP = ''DELETE''%'
    OR v_definition NOT ILIKE '%OLD.user_id IS NOT NULL%'
    OR v_definition NOT ILIKE '%NEW.subject_token IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'legal acceptance guard lacks retention controls';
  END IF;

  v_definition := pg_get_functiondef(v_under_18_function);
  IF v_definition NOT ILIKE '%pg_trigger_depth()%'
    OR v_definition NOT ILIKE '%TG_OP = ''DELETE''%'
    OR v_definition NOT ILIKE '%OLD.anonymized_at IS NOT NULL%'
    OR v_definition NOT ILIKE '%reviewer_unlinked_at%'
  THEN
    RAISE EXCEPTION 'under-18 evidence guard lacks retention controls';
  END IF;

  v_definition := pg_get_functiondef(v_document_function);
  IF v_definition NOT ILIKE '%pg_trigger_depth()%'
    OR v_definition NOT ILIKE '%OLD.uploaded_by IS NOT NULL%'
    OR v_definition NOT ILIKE '%NEW.uploaded_by IS NULL%'
    OR v_definition NOT ILIKE '%published legal documents are immutable%'
  THEN
    RAISE EXCEPTION 'legal document immutability guard lost its controlled unlink';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_anonymize_retained_legal_evidence'
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
       AND tgname = 'legal_acceptances_prevent_delete'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.legal_acceptances'::regclass
       AND tgname = 'legal_acceptances_prevent_update'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.under_18_approvals'::regclass
       AND tgname = 'under_18_approvals_preserve_evidence'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'legal evidence retention triggers are missing or disabled';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.legal_acceptances
     WHERE NOT (
       (
         user_id IS NOT NULL
         AND subject_token IS NULL
         AND anonymized_at IS NULL
       )
       OR
       (
         user_id IS NULL
         AND subject_token IS NOT NULL
         AND anonymized_at IS NOT NULL
         AND ip_address IS NULL
         AND user_agent IS NULL
       )
     )
  ) THEN
    RAISE EXCEPTION 'legal acceptance pseudonymization state is inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.under_18_approvals
     WHERE NOT (
       (
         user_id IS NOT NULL
         AND subject_token IS NULL
         AND anonymized_at IS NULL
       )
       OR
       (
         user_id IS NULL
         AND subject_token IS NOT NULL
         AND anonymized_at IS NOT NULL
         AND notes IS NULL
         AND approved_by IS NULL
       )
     )
  ) THEN
    RAISE EXCEPTION 'under-18 pseudonymization state is inconsistent';
  END IF;

  IF EXISTS (
    SELECT subject_token
      FROM (
        SELECT subject_token, anonymized_at
          FROM public.legal_acceptances
         WHERE subject_token IS NOT NULL
        UNION ALL
        SELECT subject_token, anonymized_at
          FROM public.under_18_approvals
         WHERE subject_token IS NOT NULL
      ) evidence
     GROUP BY subject_token
    HAVING count(DISTINCT anonymized_at) <> 1
  ) THEN
    RAISE EXCEPTION 'one subject token spans inconsistent anonymization events';
  END IF;

  v_definition := pg_get_functiondef(
    'public.delete_zltac_event(uuid,uuid)'::regprocedure
  );
  IF v_definition NOT ILIKE '%DELETE FROM public.legal_acceptances%'
    OR v_definition NOT ILIKE '%DELETE FROM public.under_18_approvals%'
  THEN
    RAISE EXCEPTION 'event delete RPC no longer reaches the evidence retention guards';
  END IF;
END;
$$;
