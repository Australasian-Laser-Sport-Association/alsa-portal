-- Contract phase for privileged content administration.
-- Apply only after 65000 and the API/frontend release have been deployed and
-- verified against the safe views and actor-explicit service mutation.

BEGIN;

-- A populated environment must prove that the deployed service/API path can
-- perform and attribute a real content mutation before the legacy browser
-- grants disappear. Migration 65000 creates this audit table empty, so any row
-- is durable evidence of a post-expand smoke action. Empty disposable
-- databases remain replayable in CI and local development.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles)
     AND NOT EXISTS (SELECT 1 FROM public.admin_content_mutation_audit) THEN
    RAISE EXCEPTION
      'ADMIN_CONTENT_CONTRACT_BLOCKED: complete an audited admin-content smoke mutation through the deployed API before applying 66000.'
      USING ERRCODE = '55000';
  END IF;

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
    RAISE EXCEPTION
      'ADMIN_ASSET_CONTRACT_BLOCKED: complete and finalize every signed-upload smoke through the deployed API before applying 66000.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Public-safe reads remain available through dedicated views, but browser
-- sessions can no longer mutate committee content directly.
REVOKE INSERT, UPDATE, DELETE ON
  public.document_categories,
  public.documents,
  public.cms_global,
  public.referee_questions,
  public.referee_test_settings,
  public.zltac_event_history,
  public.zltac_event_placings,
  public.zltac_legends,
  public.zltac_dynasties,
  public.zltac_hall_of_fame
FROM anon, authenticated;

-- Answer keys, internal history notes, and hidden editorial drafts are never
-- readable through their base tables after the cutover.
REVOKE SELECT ON
  public.referee_questions,
  public.referee_test_settings,
  public.zltac_event_history,
  public.zltac_legends,
  public.zltac_dynasties,
  public.zltac_hall_of_fame
FROM anon, authenticated;

-- Asset bytes stay browser-to-Storage so large referee videos do not traverse
-- a Vercel request body. The browser can write only with an exact-path,
-- non-upsert token issued by an authorised and rate-limited service route.
-- Public reads remain available through the branded asset proxy.
DROP POLICY IF EXISTS event_logos_committee ON storage.objects;
DROP POLICY IF EXISTS event_photos_committee ON storage.objects;
DROP POLICY IF EXISTS event_covers_committee ON storage.objects;
DROP POLICY IF EXISTS referee_test_media_committee ON storage.objects;
DROP POLICY IF EXISTS competition_banners_write ON storage.objects;

-- Earlier bucket migrations used ON CONFLICT DO NOTHING. Reassert the
-- production contract here so dashboard-created drift cannot preserve a
-- broader MIME list, larger object cap, or private/public mismatch.
UPDATE storage.buckets
SET public = true,
    file_size_limit = CASE id
      WHEN 'event-logos' THEN 2097152
      WHEN 'referee-test-media' THEN 26214400
      ELSE 5242880
    END,
    allowed_mime_types = CASE id
      WHEN 'referee-test-media' THEN
        ARRAY['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
      ELSE ARRAY['image/png','image/jpeg','image/webp']::text[]
    END
WHERE id IN (
  'event-logos',
  'event-photos',
  'event-covers',
  'referee-test-media',
  'competition-banners'
);

COMMENT ON FUNCTION public.admin_mutate_content(uuid, text, text, uuid, jsonb, jsonb) IS
  'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';

COMMIT;
