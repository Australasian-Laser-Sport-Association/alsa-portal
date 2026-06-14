-- Run after 20260615010000_suspension_enforcement.sql.

DO $$
DECLARE
  missing_count integer;
BEGIN
  IF has_function_privilege('authenticated', 'public.claim_placeholder_profile(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still execute claim_placeholder_profile directly';
  END IF;

  SELECT count(*) INTO missing_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relrowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = n.nspname
        AND p.tablename = c.relname
        AND p.policyname = 'active_user_insert'
        AND p.permissive = 'RESTRICTIVE'
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION '% RLS-enabled public tables lack suspension write policies', missing_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'active_user_update'
      AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'storage.objects lacks suspension enforcement';
  END IF;

  RAISE NOTICE 'PASS: suspension enforcement invariants hold';
END $$;

