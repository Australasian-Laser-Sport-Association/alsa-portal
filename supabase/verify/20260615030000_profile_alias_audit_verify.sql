-- Run after 20260615030000_profile_alias_audit.sql.

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.change_profile_alias(uuid, text, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute change_profile_alias directly';
  END IF;
  IF has_table_privilege('authenticated', 'public.profile_change_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profile_change_audit', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profile_change_audit', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated can mutate profile_change_audit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profile_change_audit'
      AND policyname = 'profile_change_audit_committee_read'
  ) THEN
    RAISE EXCEPTION 'profile_change_audit committee read policy is missing';
  END IF;
  RAISE NOTICE 'PASS: alias RPC execution and audit-table writes are service-only';
END $$;
