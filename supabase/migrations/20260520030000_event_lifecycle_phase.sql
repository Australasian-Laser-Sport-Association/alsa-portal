-- ============================================================
-- Migration: Event lifecycle phase boundaries
-- Date: 2026-05-20
-- Purpose:
--   Add columns to support a player-mutation lifecycle on ZLTAC events:
--
--     open    → players can edit registrations
--     locked  → registration locked; payments still accepted; only
--               committee can edit player rosters / side events / partners
--     closed  → event under way; no further mutations
--
--   Boundaries:
--     • reg_close_date (existing timestamptz) marks the open → locked edge.
--       This column is repurposed from "registration closes" labelling text
--       (it had no server-side effect prior to this migration) into the
--       enforced lock threshold. The UI now labels it "Registration locks at".
--     • event_starts_at (NEW, timestamptz, nullable) marks the locked →
--       closed edge. Distinct from start_date (DATE precision), which is
--       too coarse for the boundary check.
--
--   admin_note on zltac_registrations captures the optional reason
--   committee enters when applying admin-driven roster/partner/team
--   changes via the Admin Registrations edit modal. Stored verbatim;
--   not surfaced to the player.
--
--   Both new columns are nullable. Existing event rows continue to behave
--   as 'open' indefinitely until populated (eventPhase helper treats null
--   thresholds as "boundary never crossed").
-- ============================================================

ALTER TABLE public.zltac_events
  ADD COLUMN event_starts_at timestamptz;

ALTER TABLE public.zltac_registrations
  ADD COLUMN admin_note text;
