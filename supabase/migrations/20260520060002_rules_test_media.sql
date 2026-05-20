-- =============================================================================
-- Rules Test — per-question media attachments (image + video).
--
-- 1. referee_questions.image_url / video_url — optional. A question can be
--    text-only (both NULL), image-attached, video-attached, or both (rare).
--
-- 2. Storage bucket `referee-test-media` for committee-uploaded media.
--    - Public read (test-takers must see media during the test).
--    - Committee-only writes via the is_committee() helper (modelled on the
--      event-logos / event-photos buckets in 20260502000003).
--    - 25 MB per file; image + short instructional video mime types.
--    - Idempotent: if the bucket already exists, extend the allowed mime types
--      and size limit instead of erroring.
-- =============================================================================

-- 1. Columns ------------------------------------------------------------------
ALTER TABLE public.referee_questions
  ADD COLUMN image_url text,
  ADD COLUMN video_url text;

-- 2. Bucket -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'referee-test-media',
  'referee-test-media',
  true,
  26214400, -- 25 MB
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','video/mp4','video/webm']
)
ON CONFLICT (id) DO UPDATE
  SET allowed_mime_types = EXCLUDED.allowed_mime_types,
      file_size_limit    = EXCLUDED.file_size_limit,
      public             = EXCLUDED.public;

-- 3. Policies -----------------------------------------------------------------
-- Committee writes anywhere in the bucket (path is organisational only);
-- everyone reads (public test display).
DROP POLICY IF EXISTS referee_test_media_committee  ON storage.objects;
DROP POLICY IF EXISTS referee_test_media_public_read ON storage.objects;

CREATE POLICY referee_test_media_committee ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'referee-test-media' AND is_committee())
  WITH CHECK (bucket_id = 'referee-test-media' AND is_committee());

CREATE POLICY referee_test_media_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'referee-test-media');
