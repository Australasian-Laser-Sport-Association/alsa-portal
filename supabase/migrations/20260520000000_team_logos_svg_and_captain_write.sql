-- ============================================================
-- Migration: team-logos bucket — allow SVG + permit captains to write to {team_id}/...
-- Date: 2026-05-20
-- Purpose:
--   1. Extend the team-logos bucket's allowed_mime_types to include
--      image/svg+xml. SVGs are served from the Storage CDN (a different
--      origin) and rendered exclusively via <img src=...> in the app
--      (see comment in CaptainHub.jsx alongside the team logo render),
--      so cross-origin script execution from a malicious SVG is not a
--      risk in the app's origin.
--
--   2. Add an RLS policy on storage.objects so a team captain can
--      INSERT/UPDATE/DELETE objects under team-logos/{team_id}/... for
--      teams they captain. Complements the existing
--      team_logos_owner_write policy (still in force) which keys writes
--      by {user_id}/... — that path is used by CaptainRegister.jsx for
--      the initial logo at team creation time. Both policies remain;
--      PostgreSQL permissive policies are OR'd.
-- ============================================================

-- 1. Allow SVG uploads.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
 WHERE id = 'team-logos';


-- 2. Captain-by-team-id write policy.
DROP POLICY IF EXISTS team_logos_captain_team_write ON storage.objects;

CREATE POLICY team_logos_captain_team_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'team-logos'
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND t.captain_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'team-logos'
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND t.captain_id = auth.uid()
    )
  );
