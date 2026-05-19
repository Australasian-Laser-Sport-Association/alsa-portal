-- ============================================================
-- Migration: Add event_year scoping to legal acceptances & approvals
-- Date: 2026-05-19
-- Purpose:
--   Phase 1 missed event_year scoping on legal_acceptances and
--   under_18_approvals. The legacy code_of_conduct_signatures /
--   media_release_submissions / under18_submissions tables all key on
--   (user_id, event_year); players re-acknowledge each tournament
--   year. This migration aligns the new tables with that model.
--
--   Both tables are empty (Phase 1 hasn't shipped data), so the new
--   NOT NULL column needs no default backfill.
--
--   event_year is a plain int (no FK to zltac_events.year), matching
--   the convention used by zltac_event_placings and the legacy
--   event_sweep.sql FKs already in use elsewhere.
-- ============================================================


-- ------------------------------------------------------------
-- 1. legal_acceptances: per-year acceptance
-- ------------------------------------------------------------

ALTER TABLE public.legal_acceptances
  ADD COLUMN event_year integer NOT NULL;

-- Swap the unique constraint: was (user_id, document_id),
-- now (user_id, document_id, event_year).
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_document_id_key;

ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_user_id_document_id_event_year_key
    UNIQUE (user_id, document_id, event_year);

-- Index for "all acceptances for year X" lookups
-- (captain.js, api/admin/registrations.js).
CREATE INDEX legal_acceptances_event_year_user_idx
  ON public.legal_acceptances (event_year, user_id);


-- ------------------------------------------------------------
-- 2. under_18_approvals: per-year approval
-- ------------------------------------------------------------

ALTER TABLE public.under_18_approvals
  ADD COLUMN event_year integer NOT NULL;

-- Swap the unique constraint: was UNIQUE (user_id),
-- now UNIQUE (user_id, event_year) so each year is approved separately.
ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_user_id_key;

ALTER TABLE public.under_18_approvals
  ADD CONSTRAINT under_18_approvals_user_id_event_year_key
    UNIQUE (user_id, event_year);

CREATE INDEX under_18_approvals_event_year_idx
  ON public.under_18_approvals (event_year);
