-- ============================================================
-- Migration: Add missing committee write grants on ZLTAC content tables
-- Date: 2026-05-19
-- Purpose:
--   Same fix as 20260519060000 (legal tables) applied to the four
--   ZLTAC content tables created in 20260519000000. Their migration
--   only set GRANT SELECT for authenticated, so committee writes via
--   the admin UIs (AdminZLTACHallOfFame, AdminZLTACResults — both
--   Tournaments and Standouts tabs) were silently blocked at the
--   GRANT layer before RLS could evaluate the committee_write policy.
--
--   The corresponding RLS policies remain the actual access barrier:
--     - zltac_hall_of_fame_committee_write
--     - zltac_event_placings_committee_write
--     - zltac_legends_committee_write
--     - zltac_dynasties_committee_write
--   All four require is_committee(), so non-committee authenticated
--   users still get 403 from RLS even after this GRANT widens.
-- ============================================================

GRANT INSERT, UPDATE, DELETE ON public.zltac_hall_of_fame    TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.zltac_event_placings  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.zltac_legends         TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.zltac_dynasties       TO authenticated;
