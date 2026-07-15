-- Run after 20260615030000_profile_alias_audit.sql.

DO $$
DECLARE
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_contract_applied boolean := coalesce(
    obj_description(
      to_regprocedure('public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'),
      'pg_proc'
    ) = v_contract_marker,
    false
  );
BEGIN
  IF has_function_privilege(
    'authenticated', 'public.change_profile_alias(uuid, text, text, uuid, text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute change_profile_alias directly';
  END IF;
  IF v_contract_applied AND has_function_privilege(
    'anon', 'public.change_profile_alias(uuid, text, text, uuid, text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon can execute change_profile_alias after 66000';
  END IF;
  IF has_table_privilege('authenticated', 'public.profile_change_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profile_change_audit', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profile_change_audit', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated can mutate profile_change_audit';
  END IF;
  IF v_contract_applied THEN
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profile_change_audit'
        AND policyname = 'profile_change_audit_committee_read'
    ) OR has_any_column_privilege(
      'authenticated', 'public.profile_change_audit', 'SELECT'
    ) THEN
      RAISE EXCEPTION 'profile audit remains browser-readable after 66000';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profile_change_audit'
      AND policyname = 'profile_change_audit_committee_read'
  ) THEN
    RAISE EXCEPTION 'profile_change_audit committee read policy is missing before 66000';
  END IF;
  RAISE NOTICE 'PASS: alias RPC execution and audit-table writes are service-only';
END $$;
