-- ============================================================
-- Migration: Add missing committee write grants on legal tables
-- Date: 2026-05-19
-- Purpose:
--   Phase 1 of the legal documents framework only granted SELECT
--   to authenticated for legal_documents / under_18_approvals (and
--   SELECT, INSERT for legal_acceptances). The RLS policies for these
--   tables include committee_write / committee_all clauses, but the
--   GRANT layer blocks writes before RLS is even evaluated, so
--   committee users were getting 42501 permission denied from the
--   admin UI. Player flows worked because legal_acceptances had
--   INSERT and those are the only writes a player makes.
--
--   This migration adds the missing INSERT / UPDATE / DELETE grants.
--   The existing RLS policies remain the actual access barrier:
--     - legal_documents:    committee_write requires is_committee()
--     - legal_acceptances:  users restricted to user_id = auth.uid();
--                           committee_all covers admin tooling
--     - under_18_approvals: committee_all requires is_committee()
--
--   RLS therefore still blocks a non-committee user from inserting
--   into legal_documents or under_18_approvals, and still blocks a
--   player from impersonating another user_id on legal_acceptances.
-- ============================================================

GRANT INSERT, UPDATE, DELETE ON public.legal_documents     TO authenticated;
GRANT         UPDATE, DELETE ON public.legal_acceptances   TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.under_18_approvals  TO authenticated;
