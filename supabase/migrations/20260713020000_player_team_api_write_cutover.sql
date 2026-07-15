-- Wave A final cutover: apply only after PlayerHub and CaptainHub mutations use
-- the service-role APIs/RPCs deployed with this wave.
--
-- Own-row and public SELECT policies remain in place. Committee/server writes
-- continue through service_role. Owner write policies are removed so an
-- accidental future table grant does not silently restore the browser path.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.under_18_approvals'::regclass
      AND conname = 'under_18_approvals_document_required'
  ) THEN
    -- Existing legacy rows remain available for explicit remediation, while
    -- every new or updated row must identify the exact form version.
    ALTER TABLE public.under_18_approvals
      ADD CONSTRAINT under_18_approvals_document_required
      CHECK (document_id IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.zltac_registrations
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.under_18_approvals
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.teams
  FROM authenticated;

-- A table-level REVOKE does not remove independently granted column
-- privileges. Remove any such drift without hard-coding a column inventory.
DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'zltac_registrations',
    'under_18_approvals',
    'teams'
  ] LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_columns
      FROM information_schema.column_privileges cp
      JOIN information_schema.columns c
        USING (table_catalog, table_schema, table_name, column_name)
     WHERE cp.table_schema = 'public'
       AND cp.table_name = v_table
       AND cp.grantee = 'authenticated'
       AND cp.privilege_type = 'INSERT';

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM authenticated',
        v_columns,
        v_table
      );
    END IF;

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_columns
      FROM information_schema.column_privileges cp
      JOIN information_schema.columns c
        USING (table_catalog, table_schema, table_name, column_name)
     WHERE cp.table_schema = 'public'
       AND cp.table_name = v_table
       AND cp.grantee = 'authenticated'
       AND cp.privilege_type = 'UPDATE';

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM authenticated',
        v_columns,
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS zltac_registrations_insert_own
  ON public.zltac_registrations;
DROP POLICY IF EXISTS zltac_registrations_update_own
  ON public.zltac_registrations;
DROP POLICY IF EXISTS zltac_registrations_delete_own
  ON public.zltac_registrations;

DROP POLICY IF EXISTS under_18_approvals_owner_insert
  ON public.under_18_approvals;
DROP POLICY IF EXISTS under_18_approvals_owner_update
  ON public.under_18_approvals;

DROP POLICY IF EXISTS teams_captain_insert ON public.teams;
DROP POLICY IF EXISTS teams_captain_update ON public.teams;

COMMIT;
