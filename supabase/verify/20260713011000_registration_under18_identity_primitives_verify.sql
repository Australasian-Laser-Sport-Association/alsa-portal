-- Verify Wave A registration DOB snapshot and under-18 primitives.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'zltac_registrations'
      AND column_name = 'dob_at_registration'
      AND data_type = 'date'
  ) THEN
    RAISE EXCEPTION 'zltac_registrations.dob_at_registration is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'under_18_approvals'
      AND column_name = 'document_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'under_18_approvals.document_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.zltac_registrations'::regclass
      AND conname = 'zltac_registrations_dob_snapshot_valid'
  ) THEN
    RAISE EXCEPTION 'registration DOB snapshot constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.under_18_approvals'::regclass
      AND conname = 'under_18_approvals_document_id_fkey'
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.under_18_approvals'::regclass
      AND conname = 'under_18_approvals_decision_coherent'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'under-18 provenance or decision constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'zltac_registrations'
      AND t.tgname = 'zltac_registrations_snapshot_dob'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'under_18_approvals'
      AND t.tgname = 'under_18_approvals_guard_owner_write'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'under_18_approvals'
      AND t.tgname = 'under_18_approvals_guard_document_reference'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'a DOB snapshot or under-18 guard trigger is missing';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.submit_under_18_approval(uuid,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute submit_under_18_approval';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.submit_under_18_approval(uuid,integer,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.submit_under_18_approval(uuid,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'under-18 submit RPC is executable by a browser role';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.guard_under_18_owner_write()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.guard_under_18_document_reference()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'an under-18 trigger function is directly executable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'under_18_approvals'
      AND policyname = 'under_18_approvals_select_own'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'own under-18 SELECT policy was removed';
  END IF;

  IF to_regprocedure(
    'public.committee_create_under_18_approval(uuid,uuid,integer,text,text)'
  ) IS NOT NULL THEN
    IF has_table_privilege(
      'service_role', 'public.under_18_approvals', 'INSERT'
    ) OR has_table_privilege(
      'service_role', 'public.under_18_approvals', 'UPDATE'
    ) OR has_table_privilege(
      'service_role', 'public.under_18_approvals', 'DELETE'
    ) THEN
      RAISE EXCEPTION '55000 RPC cutover still permits direct under-18 writes';
    END IF;
  ELSIF NOT has_table_privilege(
    'service_role', 'public.under_18_approvals', 'INSERT'
  ) OR NOT has_table_privilege(
    'service_role', 'public.under_18_approvals', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'service_role under-18 writes are unavailable before RPC cutover';
  END IF;
END;
$$;

-- These rows require preflight remediation before the NOT VALID constraints
-- can be validated in a later migration. Zero rows is the target state.
SELECT 'registration_snapshot_missing_with_profile_dob' AS check_name, count(*) AS row_count
FROM public.zltac_registrations r
JOIN public.profiles p ON p.id = r.user_id
WHERE r.dob_at_registration IS NULL
  AND p.dob IS NOT NULL
UNION ALL
SELECT 'registration_snapshot_missing', count(*)
FROM public.zltac_registrations
WHERE dob_at_registration IS NULL
UNION ALL
SELECT 'registration_snapshot_after_registration', count(*)
FROM public.zltac_registrations
WHERE dob_at_registration > created_at::date
UNION ALL
SELECT 'under18_incoherent_decision', count(*)
FROM public.under_18_approvals
WHERE NOT (
  (status = 'approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
  OR
  (status IN ('pending', 'rejected') AND approved_at IS NULL AND approved_by IS NULL)
)
UNION ALL
SELECT 'under18_submitted_without_document', count(*)
FROM public.under_18_approvals
WHERE submitted_at IS NOT NULL
  AND document_id IS NULL
UNION ALL
SELECT 'registration_under18_cutoff_missing_or_invalid', count(*)
FROM public.zltac_registrations r
JOIN public.zltac_events e ON e.year = r.year
WHERE e.start_date IS NULL
  AND (
    e.event_starts_at IS NULL
    OR e.timezone IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_timezone_names tz WHERE tz.name = e.timezone
    )
  )
UNION ALL
SELECT 'registration_dob_invalid_for_event_start', count(*)
FROM public.zltac_registrations r
JOIN public.zltac_events e ON e.year = r.year
WHERE r.dob_at_registration IS NOT NULL
  AND (
    r.dob_at_registration < DATE '1900-01-01'
    OR (
      e.start_date IS NOT NULL
      AND r.dob_at_registration > e.start_date
    )
    OR (
      e.start_date IS NULL
      AND e.event_starts_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_timezone_names tz WHERE tz.name = e.timezone
      )
      AND r.dob_at_registration > (e.event_starts_at AT TIME ZONE e.timezone)::date
    )
  );
