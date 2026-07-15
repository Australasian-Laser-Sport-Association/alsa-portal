-- Legal PDFs are delivered only through the branded, database-authorized API.
-- The browser has no direct legal-document storage write policy.

BEGIN;

-- A populated portal must not lose direct bucket access until the replacement
-- publication flow has produced every required document and the uploaded
-- object is visible in Storage metadata. Empty disposable databases are
-- allowed through so clean local migration replay remains deterministic.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles)
     AND EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         'code_of_conduct',
         'media_release',
         'under_18_form'
       ]::text[]) AS required(document_type)
       WHERE NOT EXISTS (
         SELECT 1
         FROM public.legal_documents AS document
         WHERE document.document_type = required.document_type
           AND document.is_active
           AND document.published_at IS NOT NULL
           AND document.content_sha256 ~ '^[0-9a-f]{64}$'
           AND document.object_size BETWEEN 8 AND 4194304
           AND EXISTS (
             SELECT 1
             FROM storage.objects AS object
             WHERE object.bucket_id = 'legal-documents'
               AND object.name = document.file_path
           )
       )
     ) THEN
    RAISE EXCEPTION
      'LEGAL_STORAGE_CONTRACT_BLOCKED: publish and verify all required legal PDFs through the deployed server flow before applying 42000.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

UPDATE storage.buckets
   SET public = false,
       file_size_limit = 4194304,
       allowed_mime_types = ARRAY['application/pdf']
 WHERE id = 'legal-documents';

DROP POLICY IF EXISTS legal_docs_bucket_committee_write ON storage.objects;
DROP POLICY IF EXISTS legal_docs_bucket_public_read ON storage.objects;

COMMIT;
