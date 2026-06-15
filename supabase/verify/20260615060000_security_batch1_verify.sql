-- Run after 20260615060000_security_batch1.sql. This script is read-only and
-- raises an exception on the first failed security invariant.

DO $$
DECLARE
  v_mimes text[];
BEGIN
  IF has_table_privilege('authenticated', 'public.legal_acceptances', 'INSERT')
     OR has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.legal_acceptances', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated still has legal_acceptances write privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.legal_acceptances'::regclass
      AND conname = 'legal_acceptances_user_id_document_id_event_year_key'
  ) THEN
    RAISE EXCEPTION 'legal acceptance uniqueness constraint still overwrites re-attestations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'legal_acceptances'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND 'authenticated' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'authenticated legal_acceptances write policy still exists';
  END IF;

  SELECT allowed_mime_types INTO v_mimes
  FROM storage.buckets WHERE id = 'team-logos';
  IF 'image/svg+xml' = ANY (coalesce(v_mimes, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'team-logos still permits SVG';
  END IF;

  SELECT allowed_mime_types INTO v_mimes
  FROM storage.buckets WHERE id = 'referee-test-media';
  IF 'image/svg+xml' = ANY (coalesce(v_mimes, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'referee-test-media still permits SVG';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teams
    WHERE logo_url IS NOT NULL
      AND lower(split_part(logo_url, '?', 1)) LIKE '%.svg'
  ) THEN
    RAISE EXCEPTION 'team records still reference SVG logos';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referee_questions
    WHERE image_url IS NOT NULL
      AND lower(split_part(image_url, '?', 1)) LIKE '%.svg'
  ) THEN
    RAISE EXCEPTION 'referee questions still reference SVG images';
  END IF;

  RAISE NOTICE 'PASS: security batch 1 database invariants hold';
END $$;
