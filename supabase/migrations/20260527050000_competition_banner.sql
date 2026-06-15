-- Phase 2b: header banner for pre-nationals competitions.
--
-- Mirrors the ZLTAC cover-photo pattern from 20260522010000_event_cover_photo.sql:
-- a public storage bucket, public-read policy, and a column on the parent table
-- that stores the full public URL (not just the storage path) so the public
-- detail page can render <img src> without a second lookup.
--
-- Differences from event-covers:
--   - Bucket name competition-banners scopes objects to pre-nats.
--   - Write policy admits superadmin (via public.is_superadmin()) AND any
--     competition_manager whose grant covers the competition encoded in the
--     object's first path segment. Pre-nats managers have no committee role,
--     so is_committee() does not apply.
--
-- Object path layout: <competition_id>/<timestamp>.<ext>. The UUID cast in
-- the write policy means a malformed path (anything that does not parse as
-- a UUID for the first segment) fails the predicate, denying the write.
-- Clients in this codebase always upload with the canonical layout.

-- -----------------------------------------------------------------------------
-- 1. Column on competitions
-- -----------------------------------------------------------------------------
-- Length and scheme validation lives in the API (validateContent in
-- api/superadmin/[resource].js). No CHECK constraint here so a future format
-- change does not require a column migration.

ALTER TABLE public.competitions
  ADD COLUMN banner_url text;


-- -----------------------------------------------------------------------------
-- 2. Storage bucket
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('competition-banners', 'competition-banners', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. Storage policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS competition_banners_public_read ON storage.objects;
DROP POLICY IF EXISTS competition_banners_write       ON storage.objects;

-- Public read (anon + authenticated) — matches every other image bucket
-- in this project.
CREATE POLICY competition_banners_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'competition-banners');

-- Write: superadmin (any path) OR a competition manager whose grant covers
-- the UUID at the first path segment.
CREATE POLICY competition_banners_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'competition-banners'
    AND (
      public.is_superadmin()
      OR (storage.foldername(name))[1]::uuid IN (
        SELECT competition_id
        FROM public.competition_managers
        WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bucket_id = 'competition-banners'
    AND (
      public.is_superadmin()
      OR (storage.foldername(name))[1]::uuid IN (
        SELECT competition_id
        FROM public.competition_managers
        WHERE user_id = auth.uid()
      )
    )
  );
