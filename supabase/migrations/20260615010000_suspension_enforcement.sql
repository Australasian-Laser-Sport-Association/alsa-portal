-- Enforce account suspension at every application boundary:
--   * role helpers fail closed for suspended profiles
--   * all authenticated writes require an active profile
--   * direct execution of the privileged placeholder-claim RPC is removed

BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND suspended = false
  );
$$;

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
      AND suspended = false
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
      AND suspended = false
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
  SELECT public.is_active_user() AND EXISTS (
    SELECT 1 FROM public.competition_managers
    WHERE competition_id = p_competition_id
      AND user_id = auth.uid()
  );
$$;

-- Add restrictive write policies to every current RLS-enabled public table.
-- Existing permissive ownership/role policies must still pass as before; these
-- policies add the non-negotiable active-account condition.
DO $$
DECLARE
  table_row record;
BEGIN
  FOR table_row IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_user_insert ON %I.%I', table_row.schema_name, table_row.table_name);
    EXECUTE format('DROP POLICY IF EXISTS active_user_update ON %I.%I', table_row.schema_name, table_row.table_name);
    EXECUTE format('DROP POLICY IF EXISTS active_user_delete ON %I.%I', table_row.schema_name, table_row.table_name);

    EXECUTE format(
      'CREATE POLICY active_user_insert ON %I.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.is_active_user())',
      table_row.schema_name, table_row.table_name
    );
    EXECUTE format(
      'CREATE POLICY active_user_update ON %I.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())',
      table_row.schema_name, table_row.table_name
    );
    EXECUTE format(
      'CREATE POLICY active_user_delete ON %I.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.is_active_user())',
      table_row.schema_name, table_row.table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS active_user_insert ON storage.objects;
DROP POLICY IF EXISTS active_user_update ON storage.objects;
DROP POLICY IF EXISTS active_user_delete ON storage.objects;

CREATE POLICY active_user_insert ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());

CREATE POLICY active_user_update ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY active_user_delete ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_active_user());

-- Legitimate claim flows already run through authenticated server endpoints.
REVOKE EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) TO service_role;

COMMIT;

