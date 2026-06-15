-- Rollback for 20260615030000_profile_alias_audit.sql.
-- The application must be rolled back first because new code calls the RPC.
-- Audit history is never deleted implicitly.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profile_change_audit LIMIT 1) THEN
    RAISE EXCEPTION
      'profile_change_audit contains evidence; export/preserve it before destructive cleanup';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.change_profile_alias(uuid, text, text, uuid, text);
DROP TABLE public.profile_change_audit;

COMMIT;
