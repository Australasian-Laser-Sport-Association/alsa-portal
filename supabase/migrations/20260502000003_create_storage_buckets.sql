-- Create storage buckets and policies.
-- These were missing after a previous Supabase project migration.
-- Codebase references all 4 names; verified via grep across src/ and api/.

-- ─── Bucket creation ───────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',      'avatars',      true, 2097152, ARRAY['image/png','image/jpeg','image/webp']),
  ('team-logos',   'team-logos',   true, 2097152, ARRAY['image/png','image/jpeg','image/webp']),
  ('event-logos',  'event-logos',  true, 2097152, ARRAY['image/png','image/jpeg','image/webp']),
  ('event-photos', 'event-photos', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ─── Drop existing policies if any ─────────────────────────────────
DROP POLICY IF EXISTS avatars_owner_write      ON storage.objects;
DROP POLICY IF EXISTS avatars_public_read      ON storage.objects;
DROP POLICY IF EXISTS team_logos_owner_write   ON storage.objects;
DROP POLICY IF EXISTS team_logos_public_read   ON storage.objects;
DROP POLICY IF EXISTS event_logos_committee    ON storage.objects;
DROP POLICY IF EXISTS event_logos_public_read  ON storage.objects;
DROP POLICY IF EXISTS event_photos_committee   ON storage.objects;
DROP POLICY IF EXISTS event_photos_public_read ON storage.objects;

-- ─── avatars ────────────────────────────────────────────────────────
-- Each user can only write to their own folder ({user_id}/avatar.ext)
CREATE POLICY avatars_owner_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY avatars_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- ─── team-logos ─────────────────────────────────────────────────────
-- Captains write to their own folder ({user_id}/{timestamp}.ext)
CREATE POLICY team_logos_owner_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'team-logos' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'team-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY team_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'team-logos');

-- ─── event-logos ────────────────────────────────────────────────────
-- Committee only (uses is_committee() helper)
CREATE POLICY event_logos_committee ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'event-logos' AND is_committee())
  WITH CHECK (bucket_id = 'event-logos' AND is_committee());

CREATE POLICY event_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'event-logos');

-- ─── event-photos ───────────────────────────────────────────────────
-- Committee only
CREATE POLICY event_photos_committee ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'event-photos' AND is_committee())
  WITH CHECK (bucket_id = 'event-photos' AND is_committee());

CREATE POLICY event_photos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'event-photos');
