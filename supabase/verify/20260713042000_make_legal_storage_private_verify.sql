-- Read-only verification for private legal-document storage.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM storage.buckets
     WHERE id = 'legal-documents'
       AND public = false
       AND file_size_limit = 4194304
       AND allowed_mime_types = ARRAY['application/pdf']::text[]
  ) THEN
    RAISE EXCEPTION 'legal-documents bucket is missing or not private/PDF-only';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname IN (
         'legal_docs_bucket_committee_write',
         'legal_docs_bucket_public_read'
       )
  ) THEN
    RAISE EXCEPTION 'direct legal-document storage policies still exist';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND permissive = 'PERMISSIVE'
       AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
       AND (
         COALESCE(qual, '') ILIKE '%legal-documents%'
         OR COALESCE(with_check, '') ILIKE '%legal-documents%'
       )
  ) THEN
    RAISE EXCEPTION 'another permissive browser policy exposes legal storage';
  END IF;
END;
$$;
