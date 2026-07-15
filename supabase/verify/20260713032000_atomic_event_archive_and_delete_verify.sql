-- Read-only verification for Wave B / Phase 2C atomic event lifecycle RPCs.
-- This intentionally verifies privileges and transactional primitives without
-- archiving/deleting a live event.

DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_table_oid oid;
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
  v_table_oid := to_regclass('public.zltac_event_lifecycle_audit');
  IF v_table_oid IS NULL THEN
    RAISE EXCEPTION 'zltac_event_lifecycle_audit is missing';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
     WHERE c.oid = v_table_oid
  ) THEN
    RAISE EXCEPTION 'zltac_event_lifecycle_audit does not have RLS enabled';
  END IF;

  IF v_contract_applied THEN
    IF EXISTS (
      SELECT 1
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'zltac_event_lifecycle_audit'
         AND policyname = 'zltac_event_lifecycle_audit_committee_read'
    ) OR has_any_column_privilege(
      'authenticated', 'public.zltac_event_lifecycle_audit', 'SELECT'
    ) THEN
      RAISE EXCEPTION 'event lifecycle audit remains browser-readable after 66000';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'zltac_event_lifecycle_audit'
       AND policyname = 'zltac_event_lifecycle_audit_committee_read'
       AND cmd = 'SELECT'
       AND roles = ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'committee read policy for event lifecycle audit is missing before 66000';
  END IF;

  IF has_table_privilege(
    'anon', 'public.zltac_event_lifecycle_audit', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'public.zltac_event_lifecycle_audit', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.zltac_event_lifecycle_audit', 'UPDATE'
  ) OR has_table_privilege(
    'authenticated', 'public.zltac_event_lifecycle_audit', 'DELETE'
  ) OR has_table_privilege(
    'service_role', 'public.zltac_event_lifecycle_audit', 'INSERT'
  ) OR has_table_privilege(
    'service_role', 'public.zltac_event_lifecycle_audit', 'UPDATE'
  ) OR has_table_privilege(
    'service_role', 'public.zltac_event_lifecycle_audit', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'event lifecycle audit has an unsafe direct-write privilege';
  END IF;

  IF NOT has_table_privilege(
    'service_role', 'public.zltac_event_lifecycle_audit', 'SELECT'
  ) OR (
    NOT v_contract_applied
    AND NOT has_table_privilege(
      'authenticated', 'public.zltac_event_lifecycle_audit', 'SELECT'
    )
  ) THEN
    RAISE EXCEPTION 'required event lifecycle audit privileges are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.legal_acceptances'::regclass
       AND conname = 'legal_acceptances_event_year_fkey'
       AND contype = 'f'
       AND confrelid = 'public.zltac_events'::regclass
       AND confdeltype = 'c'
       AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.under_18_approvals'::regclass
       AND conname = 'under_18_approvals_event_year_fkey'
       AND contype = 'f'
       AND confrelid = 'public.zltac_events'::regclass
       AND confdeltype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION
      'acknowledgement event-year constraints are not ON DELETE CASCADE';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    to_regprocedure('public.archive_zltac_event(uuid,uuid)'),
    to_regprocedure('public.delete_zltac_event(uuid,uuid)')
  ] LOOP
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'required event lifecycle function is missing';
    END IF;

    IF NOT (
      SELECT p.prosecdef
        FROM pg_proc p
       WHERE p.oid = v_function
    ) THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER', v_function;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc p
       WHERE p.oid = v_function
         AND p.proargnames[1:2] = ARRAY['event_id', 'actor_id']::text[]
         AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    ) THEN
      RAISE EXCEPTION '% has unsafe configuration or argument names', v_function;
    END IF;

    IF has_function_privilege('anon', v_function, 'EXECUTE')
      OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION '% remains executable from a browser role', v_function;
    END IF;

    IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role', v_function;
    END IF;

    v_definition := pg_get_functiondef(v_function);
    IF v_definition NOT ILIKE '%FOR UPDATE%' THEN
      RAISE EXCEPTION '% does not lock its event row', v_function;
    END IF;
    IF v_definition NOT ILIKE '%p.suspended = false%' THEN
      RAISE EXCEPTION '% does not reject attribution to suspended actors', v_function;
    END IF;
  END LOOP;

  v_definition := pg_get_functiondef(
    'public.archive_zltac_event(uuid,uuid)'::regprocedure
  );
  IF v_definition NOT ILIKE '%zltac_event_history%'
    OR v_definition NOT ILIKE '%historyCreated%'
    OR v_definition NOT ILIKE '%v_already_archived%' THEN
    RAISE EXCEPTION 'archive RPC lacks history preservation/idempotency logic';
  END IF;

  v_definition := pg_get_functiondef(
    'public.delete_zltac_event(uuid,uuid)'::regprocedure
  );
  IF v_definition NOT ILIKE '%DELETE FROM public.legal_acceptances%'
    OR v_definition NOT ILIKE '%DELETE FROM public.under_18_approvals%'
    OR v_definition NOT ILIKE '%DELETE FROM public.payments%'
    OR v_definition NOT ILIKE '%DELETE FROM public.zltac_events%'
    OR position('P_EVENT_YEAR' IN upper(v_definition)) > 0
    OR position('P_YEAR' IN upper(v_definition)) > 0 THEN
    RAISE EXCEPTION 'delete RPC does not derive and consistently apply event year';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.zltac_events'::regclass
       AND t.tgname = 'zltac_events_prevent_unarchive'
       AND t.tgenabled <> 'D'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'archived-event status guard trigger is missing or disabled';
  END IF;
END;
$$;
