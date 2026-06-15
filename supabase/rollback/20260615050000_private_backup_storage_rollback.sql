-- Rollback for 20260615050000_private_backup_storage.sql.
-- This refuses to delete backup records or Storage objects. Supabase blocks
-- direct SQL deletion of buckets, so the empty private bucket is intentionally
-- left in place and may be removed later through the Storage API or Dashboard.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.backup_runs LIMIT 1) THEN
    RAISE EXCEPTION 'backup_runs contains history; export/preserve it before cleanup';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'portal-backups'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'portal-backups contains objects; remove them through the Storage API first';
  END IF;
END $$;

DROP TABLE public.backup_runs;

COMMIT;
