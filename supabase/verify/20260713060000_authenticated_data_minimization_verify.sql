DO $$
DECLARE
  v_column text;
  v_registration_safe constant text[] := ARRAY[
    'id', 'user_id', 'team_id', 'year', 'side_events', 'dinner_guests',
    'emergency_contact_name', 'emergency_contact_phone', 'status',
    'has_confirmed_side_events', 'has_confirmed_extras', 'created_at',
    'payment_reference', 'amount_owing', 'dob_at_registration'
  ]::text[];
  v_registration_private constant text[] := ARRAY[
    'admin_note', 'admin_override_coc', 'admin_override_media',
    'admin_override_ref_test', 'admin_override_u18',
    'admin_override_coc_set_by', 'admin_override_coc_set_at',
    'admin_override_coc_reason', 'admin_override_media_set_by',
    'admin_override_media_set_at', 'admin_override_media_reason',
    'admin_override_ref_test_set_by', 'admin_override_ref_test_set_at',
    'admin_override_ref_test_reason', 'admin_override_u18_set_by',
    'admin_override_u18_set_at', 'admin_override_u18_reason'
  ]::text[];
  v_legal_safe constant text[] := ARRAY[
    'id', 'document_type', 'version', 'original_filename', 'effective_date',
    'is_active', 'requires_reacceptance', 'content_sha256', 'object_size',
    'published_at'
  ]::text[];
BEGIN
  IF has_any_column_privilege('authenticated', 'public.zltac_events', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated retains a zltac_events base-table SELECT privilege';
  END IF;

  FOREACH v_column IN ARRAY ARRAY[
    'bank_bsb', 'bank_account_number', 'bank_account_name', 'payments_override'
  ]::text[] LOOP
    IF has_column_privilege('authenticated', 'public.zltac_events', v_column, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated can SELECT private event column: %', v_column;
    END IF;
  END LOOP;

  IF has_any_column_privilege('authenticated', 'public.teams', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated retains a teams base-table SELECT privilege';
  END IF;

  IF has_table_privilege('authenticated', 'public.legal_documents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.zltac_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated retains a broad legal or registration SELECT grant';
  END IF;

  FOREACH v_column IN ARRAY v_legal_safe LOOP
    IF NOT has_column_privilege(
      'authenticated', 'public.legal_documents', v_column, 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated lost safe legal metadata column: %', v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY ARRAY[
    'file_path', 'uploaded_by', 'uploaded_at', 'notes', 'created_at', 'updated_at'
  ]::text[] LOOP
    IF has_column_privilege('authenticated', 'public.legal_documents', v_column, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated can SELECT private legal column: %', v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY v_registration_safe LOOP
    IF NOT has_column_privilege(
      'authenticated', 'public.zltac_registrations', v_column, 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated lost safe own-registration column: %', v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY v_registration_private LOOP
    IF has_column_privilege(
      'authenticated', 'public.zltac_registrations', v_column, 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated can SELECT private registration column: %', v_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'zltac_registrations'
       AND policyname = 'zltac_registrations_committee_read'
  ) THEN
    RAISE EXCEPTION 'committee browser cross-user registration policy remains';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.public_zltac_events', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.own_zltac_teams', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated safe event/team views are not readable';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_zltac_events'
       AND column_name IN (
         'bank_bsb', 'bank_account_number', 'bank_account_name', 'payments_override'
       )
  ) THEN
    RAISE EXCEPTION 'public_zltac_events exposes payment instructions';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'own_zltac_teams'
       AND column_name IN ('captain_id', 'manager_id', 'competition_id')
  ) THEN
    RAISE EXCEPTION 'own_zltac_teams exposes ownership identifiers';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.zltac_events', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.teams', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.legal_documents', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.zltac_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'service-role API access was reduced';
  END IF;
END;
$$;
