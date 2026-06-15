-- Emergency rollback for 20260615010000_suspension_enforcement.sql.
-- Run only after rolling application code back to a compatible deploy.

BEGIN;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE policyname IN ('active_user_insert', 'active_user_update', 'active_user_delete')
      AND schemaname IN ('public', 'storage')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.is_committee()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND roles && ARRAY['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND roles && ARRAY['superadmin']::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.is_competition_manager(p_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competition_managers
    WHERE competition_id = p_competition_id
      AND user_id = auth.uid()
  );
$$;

DROP FUNCTION IF EXISTS public.is_active_user();

GRANT EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) TO authenticated;

COMMIT;
