-- Make the active-account requirement explicit in browser-owned Storage
-- policies and retire direct writes to the legacy payments table.
--
-- The global restrictive Storage policies remain defense in depth. Embedding
-- the active-account predicate in each avatar/team-logo ownership policy also
-- keeps those policies safe if a future migration changes the global policy
-- set. Legacy payment reads remain owner-scoped; every write stays behind the
-- actor-authorized service APIs and payment-ledger RPCs.

BEGIN;

-- A Storage policy executes under the caller's table privileges. Keep the
-- teams base table private by resolving captain ownership through a narrow,
-- actor-bound helper. Malformed object folders fail closed before the UUID
-- cast, while the UUID comparison retains the teams primary-key index.
-- Drop the dependent policy first so a replay also resets the definer owner
-- and ACL instead of preserving unexpected grants from a drifted function.
DROP POLICY IF EXISTS team_logos_captain_team_write ON storage.objects;
DROP FUNCTION IF EXISTS public.can_write_team_logo(text);

CREATE FUNCTION public.can_write_team_logo(p_folder text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id pg_catalog.uuid := (SELECT auth.uid());
  v_team_id pg_catalog.uuid;
BEGIN
  IF v_actor_id IS NULL
     OR NOT (SELECT public.is_active_user())
     OR p_folder IS NULL
     OR NOT pg_catalog.pg_input_is_valid(p_folder, 'uuid') THEN
    RETURN false;
  END IF;

  v_team_id := p_folder::pg_catalog.uuid;

  RETURN EXISTS (
    SELECT 1
    FROM public.teams AS team
    WHERE team.id = v_team_id
      AND team.captain_id = v_actor_id
  );
END;
$$;

ALTER FUNCTION public.can_write_team_logo(text) OWNER TO postgres;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.can_write_team_logo(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.can_write_team_logo(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_write_team_logo(text) IS
  'Storage RLS helper: true only for an active actor and a valid team UUID they captain.';

DROP POLICY IF EXISTS avatars_owner_write ON storage.objects;
CREATE POLICY avatars_owner_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (SELECT public.is_active_user())
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (SELECT public.is_active_user())
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS team_logos_owner_write ON storage.objects;
CREATE POLICY team_logos_owner_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'team-logos'
    AND (SELECT public.is_active_user())
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'team-logos'
    AND (SELECT public.is_active_user())
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY team_logos_captain_team_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'team-logos'
    AND (SELECT public.is_active_user())
    AND public.can_write_team_logo((storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'team-logos'
    AND (SELECT public.is_active_user())
    AND public.can_write_team_logo((storage.foldername(name))[1])
  );

-- Retain authenticated owner reads and explicit service-role access, but
-- remove every non-owner/non-service DML grant, including independently
-- granted columns and privileges inherited by a browser role.
DO $$
DECLARE
  v_columns text;
  v_owner oid;
  v_role_name name;
BEGIN
  SELECT relation.relowner
    INTO v_owner
    FROM pg_class AS relation
   WHERE relation.oid = 'public.payments'::regclass;

  SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO v_columns
    FROM pg_attribute AS attribute
   WHERE attribute.attrelid = 'public.payments'::regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;

  FOR v_role_name IN
    WITH table_dml_grantees AS (
      SELECT acl.grantee
      FROM pg_class AS relation
      CROSS JOIN LATERAL aclexplode(
        coalesce(relation.relacl, acldefault('r', relation.relowner))
      ) AS acl
      WHERE relation.oid = 'public.payments'::regclass
        AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    ),
    column_dml_grantees AS (
      SELECT acl.grantee
      FROM pg_attribute AS attribute
      CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
      WHERE attribute.attrelid = 'public.payments'::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND acl.privilege_type IN ('INSERT', 'UPDATE')
    )
    SELECT DISTINCT role_row.rolname
    FROM (
      SELECT grantee FROM table_dml_grantees
      UNION
      SELECT grantee FROM column_dml_grantees
    ) AS grant_row
    JOIN pg_roles AS role_row ON role_row.oid = grant_row.grantee
    WHERE role_row.oid <> v_owner
      AND role_row.rolname <> 'service_role'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments FROM %I',
      v_role_name
    );
    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.payments FROM %I',
        v_columns,
        v_role_name
      );
      EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.payments FROM %I',
        v_columns,
        v_role_name
      );
    END IF;
  END LOOP;

  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments FROM PUBLIC';
  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.payments FROM PUBLIC',
      v_columns
    );
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.payments FROM PUBLIC',
      v_columns
    );
  END IF;
END;
$$;

DROP POLICY IF EXISTS "payments_committee_all" ON public.payments;
DROP POLICY IF EXISTS "payments_own_read" ON public.payments;
CREATE POLICY "payments_own_read" ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payments TO service_role;

COMMIT;
