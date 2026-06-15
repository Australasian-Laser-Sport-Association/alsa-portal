-- ============================================================
-- Migration: Drop unused podium-state columns from zltac_event_history
-- Date: 2026-05-19
-- Purpose:
--   The columns champion_state, runner_up_state, third_place_state on
--   zltac_event_history were originally meant to hold the home-state of
--   the year's top-3 teams. They were never populated in any environment
--   and the public year-detail page now renders the podium from
--   zltac_event_placings (Phase 2 unification). Code references on
--   AdminEventHistory.jsx and ZLTACYearDetail.jsx were removed
--   alongside this migration.
-- ============================================================

ALTER TABLE public.zltac_event_history
  DROP COLUMN champion_state,
  DROP COLUMN runner_up_state,
  DROP COLUMN third_place_state;
