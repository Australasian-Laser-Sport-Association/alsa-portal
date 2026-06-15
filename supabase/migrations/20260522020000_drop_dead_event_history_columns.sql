-- ============================================================
-- Migration: Drop dead podium / side-event columns from zltac_event_history
-- Date: 2026-05-22
-- Purpose:
--   champion_team, runner_up_team, third_place_team, and side_event_results
--   were the legacy way of recording a year's team podium and side-event
--   results directly on zltac_event_history. They are superseded by the
--   zltac_event_placings table: both public surfaces (ZLTACYearDetail.jsx and
--   ZLTACLanding.jsx) render the podium and side events solely from
--   zltac_event_placings, which is owned by the AdminZLTACResults Tournaments
--   tab. These four columns were only ever written by the standalone
--   AdminEventHistory page (now removed) and were never displayed publicly.
--   Dropping them removes the duplicate, dead data path.
--
--   The sibling *_state columns (champion_state, runner_up_state,
--   third_place_state) were already dropped in
--   20260519010000_drop_unused_state_columns.sql.
--
--   The remaining extras on zltac_event_history (logo_url, full_results_text,
--   photo_urls, internal_notes) are retained and are now edited from the new
--   AdminZLTACResults "Extras" tab.
-- ============================================================

ALTER TABLE public.zltac_event_history
  DROP COLUMN champion_team,
  DROP COLUMN runner_up_team,
  DROP COLUMN third_place_team,
  DROP COLUMN side_event_results;
