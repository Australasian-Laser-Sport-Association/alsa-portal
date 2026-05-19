-- ============================================================
-- Migration: Add historic_note column to zltac_event_history
-- Date: 2026-05-19
-- Purpose:
--   Phase-1 backfill missed two text fields from the static
--   src/data/zltacHistory.js: per-year `notes` (which maps to the
--   existing zltac_event_history.description column) and the
--   per-year `historicNote` (used only by 1999 as a sub-heading
--   above the location label in the YearCard).
--
--   description was unused after the Phase-1 insert; backfill of
--   that column happens in the companion script
--   scripts/backfill-zltac-event-notes.mjs. This migration only
--   adds the historic_note column needed for the second field.
-- ============================================================

ALTER TABLE public.zltac_event_history
  ADD COLUMN historic_note text;
