-- Run after 20260615050000_private_backup_storage.sql.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'portal-backups' AND public) THEN
    RAISE EXCEPTION 'portal-backups bucket is public';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND 'authenticated' = ANY (roles)
      AND (qual ILIKE '%portal-backups%' OR with_check ILIKE '%portal-backups%')
  ) THEN
    RAISE EXCEPTION 'authenticated storage policy exposes portal-backups';
  END IF;
  IF has_table_privilege('authenticated', 'public.backup_runs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.backup_runs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.backup_runs', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated can mutate backup_runs';
  END IF;
  RAISE NOTICE 'PASS: backups are private and run metadata is read-only';
END $$;
