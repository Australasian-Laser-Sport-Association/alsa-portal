-- =============================================================================
-- Event cover photo: per-event hero banner image on the public event page.
-- =============================================================================
-- Adds a nullable cover_photo_url column to zltac_events and an event-covers
-- storage bucket. Mirrors the event-photos bucket: public read, committee-only
-- write via is_committee(), 5MB limit, png/jpeg/webp. Objects are stored under
-- event-covers/{event_id}/{timestamp}.{ext}.


-- -----------------------------------------------------------------------------
-- 1. Column on zltac_events
-- -----------------------------------------------------------------------------

ALTER TABLE public.zltac_events
  ADD COLUMN IF NOT EXISTS cover_photo_url text;


-- -----------------------------------------------------------------------------
-- 2. Storage bucket
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('event-covers', 'event-covers', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if any (idempotent, matches the create_storage_buckets style).
DROP POLICY IF EXISTS event_covers_committee   ON storage.objects;
DROP POLICY IF EXISTS event_covers_public_read ON storage.objects;

-- Committee only (uses is_committee() helper), matching event-logos / event-photos.
CREATE POLICY event_covers_committee ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'event-covers' AND is_committee())
  WITH CHECK (bucket_id = 'event-covers' AND is_committee());

CREATE POLICY event_covers_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'event-covers');
