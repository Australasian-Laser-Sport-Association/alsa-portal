-- =============================================================================
-- Fix team_logos_captain_team_write — folder computed from the object path
-- Date: 2026-06-06
-- =============================================================================
-- The deployed team_logos_captain_team_write policy (migration 20260520000000)
-- computed the folder from the wrong column: its EXISTS subquery called
-- storage.foldername(t.name) — the teams.name text column — instead of the
-- storage object's path (the policy-row's `name`). teams.name is a free-text
-- team name, so (storage.foldername(t.name))[1] never equals a team id and the
-- WITH CHECK never matched. Result: every CaptainHub logo upload to the
-- {team_id}/{timestamp}.ext path was rejected with "new row violates row-level
-- security policy", regardless of team status. (CaptainRegister uploads to a
-- {user_id}/... path, which is allowed by the separate team_logos_owner_write
-- policy — which is why team creation logos worked but hub replacement didn't.)
--
-- This migration recreates the policy so the folder is computed at the top level
-- from `name` (the object path), and matches its first segment against the set
-- of team ids the caller captains.
--
-- NOTE: this policy is intentionally status-agnostic. It checks only
-- captain ownership (teams.captain_id = auth.uid()); it does NOT reference
-- teams.status. Logo (and colour) edits stay available on a locked team
-- (pending/approved) by design — the Batch-1 lock freezes name/roster, not
-- cosmetics.
-- =============================================================================

DROP POLICY IF EXISTS team_logos_captain_team_write ON storage.objects;

CREATE POLICY team_logos_captain_team_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'team-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text FROM public.teams t WHERE t.captain_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'team-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text FROM public.teams t WHERE t.captain_id = auth.uid()
    )
  );


-- =============================================================================
-- ROLLBACK — restore the prior (buggy) definition from 20260520000000, which
-- computed the folder from teams.name (storage.foldername(t.name)) instead of
-- the object path, so it never matched:
-- -----------------------------------------------------------------------------
-- DROP POLICY IF EXISTS team_logos_captain_team_write ON storage.objects;
--
-- CREATE POLICY team_logos_captain_team_write ON storage.objects
--   FOR ALL TO authenticated
--   USING (
--     bucket_id = 'team-logos'
--     AND EXISTS (
--       SELECT 1 FROM public.teams t
--       WHERE t.id::text = (storage.foldername(t.name))[1]
--         AND t.captain_id = auth.uid()
--     )
--   )
--   WITH CHECK (
--     bucket_id = 'team-logos'
--     AND EXISTS (
--       SELECT 1 FROM public.teams t
--       WHERE t.id::text = (storage.foldername(t.name))[1]
--         AND t.captain_id = auth.uid()
--     )
--   );
-- =============================================================================
