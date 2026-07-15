-- Read-only verification for immutable required-document publication.

DO $$
DECLARE
  v_publish regprocedure := to_regprocedure(
    'public.publish_legal_document(text,text,text,date,uuid,boolean,text,text,bigint)'
  );
  v_reconcile regprocedure := to_regprocedure(
    'public.reconcile_legal_document_publication(text,text,text,bigint)'
  );
  v_definition text;
  v_reconcile_definition text;
BEGIN
  IF v_publish IS NULL OR v_reconcile IS NULL THEN
    RAISE EXCEPTION 'legal publication functions are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'legal_documents'
       AND column_name = 'content_sha256'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'legal_documents'
       AND column_name = 'object_size'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'legal_documents'
       AND column_name = 'published_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'legal_acceptances'
       AND column_name = 'content_sha256'
  ) THEN
    RAISE EXCEPTION 'legal evidence columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.legal_documents'::regclass
       AND conname = 'legal_documents_published_integrity'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.legal_documents'::regclass
       AND conname = 'legal_documents_active_requires_publication'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_content_sha256_required'
  ) THEN
    RAISE EXCEPTION 'legal evidence constraints are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'legal_documents_published_file_path_uidx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'legal_documents_one_active_published_type_uidx'
  ) THEN
    RAISE EXCEPTION 'legal publication uniqueness indexes are missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.legal_documents', 'INSERT')
    OR has_table_privilege('authenticated', 'public.legal_documents', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.legal_documents', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated still has direct legal document writes';
  END IF;

  IF has_function_privilege('anon', v_publish, 'EXECUTE')
    OR has_function_privilege('authenticated', v_publish, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_publish, 'EXECUTE')
    OR has_function_privilege('anon', v_reconcile, 'EXECUTE')
    OR has_function_privilege('authenticated', v_reconcile, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_reconcile, 'EXECUTE') THEN
    RAISE EXCEPTION 'legal publication functions have unsafe EXECUTE privileges';
  END IF;

  IF NOT (
    SELECT p.prosecdef FROM pg_proc AS p WHERE p.oid = v_publish
  ) OR NOT (
    SELECT p.prosecdef FROM pg_proc AS p WHERE p.oid = v_reconcile
  ) THEN
    RAISE EXCEPTION 'legal publication functions are not SECURITY DEFINER';
  END IF;

  v_definition := pg_get_functiondef(v_publish);
  IF v_definition NOT ILIKE '%pg_advisory_xact_lock%'
    OR v_definition NOT ILIKE '%UPDATE public.legal_documents%'
    OR v_definition NOT ILIKE '%INSERT INTO public.legal_documents%'
    OR v_definition NOT ILIKE '%clock_timestamp()%'
    OR v_definition NOT ILIKE '%p.suspended%'
  THEN
    RAISE EXCEPTION 'publish_legal_document() lacks required transactional guards';
  END IF;

  v_reconcile_definition := pg_get_functiondef(v_reconcile);
  IF v_reconcile_definition NOT ILIKE '%pg_advisory_xact_lock%'
    OR v_reconcile_definition NOT ILIKE '%document.document_type = p_document_type%'
    OR v_reconcile_definition NOT ILIKE '%document.file_path = p_file_path%'
    OR v_reconcile_definition NOT ILIKE '%document.content_sha256 = p_content_sha256%'
    OR v_reconcile_definition NOT ILIKE '%document.object_size = p_object_size%'
    OR v_reconcile_definition NOT ILIKE '%document.published_at IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'reconcile_legal_document_publication() lacks immutable identity guards';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.legal_acceptances'::regclass
       AND tgname = 'legal_acceptances_stamp_content_sha256'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.legal_documents'::regclass
       AND tgname = 'trg_legal_documents_immutable_delete'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.legal_acceptances'::regclass
       AND tgname = 'legal_acceptances_prevent_update'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'legal evidence triggers are missing or disabled';
  END IF;

  IF EXISTS (
    SELECT document_type
      FROM public.legal_documents
     WHERE is_active AND published_at IS NOT NULL
     GROUP BY document_type
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple active published legal documents exist for one type';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.legal_documents
     WHERE published_at IS NOT NULL
       AND (
         content_sha256 !~ '^[0-9a-f]{64}$'
         OR object_size NOT BETWEEN 8 AND 4194304
       )
  ) THEN
    RAISE EXCEPTION 'published legal document evidence is malformed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'legal_documents'
       AND policyname = 'legal_documents_public_read'
       AND cmd = 'SELECT'
       AND qual ILIKE '%is_active%'
       AND qual ILIKE '%published_at%'
       AND qual ILIKE '%content_sha256%'
  ) THEN
    RAISE EXCEPTION 'public legal document read policy is not publication-scoped';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'legal_documents'
       AND policyname = 'legal_documents_acceptance_owner_read'
       AND cmd = 'SELECT'
       AND qual ILIKE '%legal_acceptances%'
       AND qual ILIKE '%auth.uid()%'
  ) THEN
    RAISE EXCEPTION 'acceptance owners cannot read retired evidence metadata';
  END IF;
END;
$$;
