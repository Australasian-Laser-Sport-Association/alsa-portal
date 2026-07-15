DO $$
DECLARE
  v_mutate regprocedure := to_regprocedure(
    'public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'
  );
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_table text;
  v_view text;
  v_bucket record;
BEGIN
  IF v_mutate IS NULL
     OR obj_description(v_mutate, 'pg_proc') IS DISTINCT FROM v_contract_marker THEN
    RAISE EXCEPTION 'Admin content browser contract marker is missing.';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'document_categories',
    'documents',
    'cms_global',
    'referee_questions',
    'referee_test_settings',
    'zltac_event_history',
    'zltac_event_placings',
    'zltac_legends',
    'zltac_dynasties',
    'zltac_hall_of_fame'
  ] LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'Browser mutation privilege remains on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'referee_questions',
    'referee_test_settings',
    'zltac_event_history',
    'zltac_legends',
    'zltac_dynasties',
    'zltac_hall_of_fame'
  ] LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'Sensitive browser base-table SELECT remains on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_view IN ARRAY ARRAY[
    'referee_questions_public',
    'public_referee_test_settings',
    'public_zltac_event_history',
    'public_zltac_legends',
    'public_zltac_dynasties',
    'public_zltac_hall_of_fame'
  ] LOOP
    IF to_regclass(format('public.%I', v_view)) IS NULL
       OR NOT has_table_privilege('anon', format('public.%I', v_view), 'SELECT')
       OR NOT has_table_privilege('authenticated', format('public.%I', v_view), 'SELECT') THEN
      RAISE EXCEPTION 'Browser-safe replacement view % is unavailable.', v_view;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'referee_questions_public'
       AND column_name = 'correct_answer'
  ) OR EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_zltac_event_history'
       AND column_name = 'internal_notes'
  ) THEN
    RAISE EXCEPTION 'A browser-safe replacement view exposes a protected column.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = ANY (ARRAY[
         'event_logos_committee',
         'event_photos_committee',
         'event_covers_committee',
         'referee_test_media_committee',
         'competition_banners_write'
       ])
  ) THEN
    RAISE EXCEPTION 'A legacy privileged browser asset-write policy remains.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND cmd = 'SELECT'
       AND policyname = ANY (ARRAY[
         'event_logos_public_read',
         'event_photos_public_read',
         'event_covers_public_read',
         'referee_test_media_public_read',
         'competition_banners_public_read'
       ])
  ) <> 5 THEN
    RAISE EXCEPTION 'One or more public asset read policies are missing.';
  END IF;

  FOR v_bucket IN
    SELECT id, public, file_size_limit, allowed_mime_types
      FROM storage.buckets
     WHERE id IN (
       'event-logos', 'event-photos', 'event-covers',
       'referee-test-media', 'competition-banners'
     )
  LOOP
    IF v_bucket.public IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Public asset bucket % is not public.', v_bucket.id;
    END IF;
    IF v_bucket.file_size_limit IS DISTINCT FROM (CASE v_bucket.id
      WHEN 'event-logos' THEN 2097152
      WHEN 'referee-test-media' THEN 26214400
      ELSE 5242880
    END)::bigint THEN
      RAISE EXCEPTION 'Public asset bucket % has the wrong size cap.', v_bucket.id;
    END IF;
    IF v_bucket.allowed_mime_types IS DISTINCT FROM (CASE v_bucket.id
      WHEN 'referee-test-media' THEN
        ARRAY['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
      ELSE ARRAY['image/png','image/jpeg','image/webp']::text[]
    END) THEN
      RAISE EXCEPTION 'Public asset bucket % has the wrong MIME allowlist.', v_bucket.id;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM storage.buckets
     WHERE id IN (
       'event-logos', 'event-photos', 'event-covers',
       'referee-test-media', 'competition-banners'
     )
  ) <> 5 THEN
    RAISE EXCEPTION 'One or more required public asset buckets are missing.';
  END IF;

  IF to_regclass('public.admin_asset_upload_audit') IS NULL THEN
    RAISE EXCEPTION 'Admin asset upload audit evidence table is missing.';
  END IF;

  -- Disposable replay databases intentionally contain no profiles. A live
  -- environment must retain finalized evidence for every contracted upload
  -- purpose, matching the irreversible migration precondition.
  IF EXISTS (SELECT 1 FROM public.profiles)
     AND (
       SELECT pg_catalog.count(DISTINCT purpose)
         FROM public.admin_asset_upload_audit
        WHERE purpose IN (
          'event-logo', 'event-photo', 'event-cover',
          'history-logo', 'history-photo',
          'referee-image', 'referee-video', 'competition-banner'
        )
     ) <> 8 THEN
    RAISE EXCEPTION 'Finalized signed-upload evidence is incomplete.';
  END IF;
END;
$$;
