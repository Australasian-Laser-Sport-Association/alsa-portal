-- Phase 3d: team_members invite flow.
--
-- Reuses the existing invite_status / invited_at / responded_at columns from
-- Phase B.1 (20260502000001_unified_teams_schema.sql) rather than introducing
-- a parallel "status" column. Plan-term mapping used throughout Phase 3d:
--   active   -> invite_status = 'accepted'
--   pending  -> invite_status = 'pending'
--   declined -> invite_status = 'declined'
--   removed  -> not stored; the row is DELETEd (matches Phase 3c disband
--              cascade and ZLTAC's captain.js:153 remove-player path)
-- accepted_at and declined_at collapse into the existing responded_at, which
-- is populated whenever invite_status transitions out of 'pending'.
--
-- This migration only adds the genuinely-new audit column + a lookup index for
-- the hub's "accepted + pending" roster panel. No backfill: pre-existing rows
-- (ZLTAC auto-add captains, Phase 3c create-team self-inserts) keep
-- invited_by = NULL.

ALTER TABLE public.team_members
  ADD COLUMN invited_by uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_team_members_status_team
  ON public.team_members (team_id, invite_status);
