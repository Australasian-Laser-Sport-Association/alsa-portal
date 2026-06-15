-- ============================================================
-- Migration: Drop legacy legal-document tables
-- Date: 2026-05-19
-- Purpose:
--   Phase 3 of the legal-documents swap. All code paths now read/write
--   the new tables (legal_documents, legal_acceptances, under_18_approvals)
--   from Phase 1/1.5. The six legacy tables are no longer referenced
--   anywhere in src/ or api/. Dropping them now.
--
--   CASCADE handles dependents: the event_year FK constraints added by
--   event_sweep.sql (20260424000000), the RLS policies set up in the
--   initial schema, and the table-level GRANTs from
--   role_grants_baseline.sql all go with the tables.
--
--   The 4 versions rows of code_of_conduct_versions and 1 signature row
--   in code_of_conduct_signatures are dropped. No backfill into the new
--   model — the new system uses PDF uploads, not inline text.
-- ============================================================

DROP TABLE IF EXISTS public.code_of_conduct_signatures  CASCADE;
DROP TABLE IF EXISTS public.code_of_conduct_versions    CASCADE;
DROP TABLE IF EXISTS public.media_release_submissions   CASCADE;
DROP TABLE IF EXISTS public.media_release_versions      CASCADE;
DROP TABLE IF EXISTS public.under18_submissions         CASCADE;
DROP TABLE IF EXISTS public.under18_form_versions       CASCADE;
