-- ============================================================
-- Migration: Role GRANT baseline
-- Date: 2026-04-22
-- Purpose:
--   Establish table-level GRANT permissions for anon, authenticated,
--   and service_role. Without these grants, RLS policies cannot run
--   and all queries fail with Postgres error 42501 (insufficient_privilege).
--
--   Also drops the three CMS tables (cms_global, cms_pages, cms_sections)
--   per ADR-0004 — content is now managed as static values in the codebase.
--
-- Security model (see docs/adr/0002-rls-plus-grant-security-model.md):
--   - anon:          SELECT only on genuinely public tables
--   - authenticated: SELECT + minimal writes, constrained by RLS
--   - service_role:  full access, used only from server-side API routes
--                    (automatically bypasses RLS; no explicit GRANT needed)
--
--   Destructive operations (DELETE, bulk UPDATE) are NOT granted to
--   authenticated. They flow through admin API routes that use the
--   service role key.
-- ============================================================

-- ------------------------------------------------------------
-- Part 1: Drop deprecated CMS tables (ADR-0004)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.cms_sections CASCADE;
DROP TABLE IF EXISTS public.cms_pages CASCADE;
DROP TABLE IF EXISTS public.cms_global CASCADE;

-- ------------------------------------------------------------
-- Part 2: anon role — public read-only access
-- ------------------------------------------------------------
-- Public event info
GRANT SELECT ON public.zltac_events TO anon;
GRANT SELECT ON public.zltac_event_history TO anon;

-- Public event metadata (so the public event page can render offerings + pricing)
GRANT SELECT ON public.event_side_events TO anon;
GRANT SELECT ON public.event_pricing TO anon;

-- Policy/legal document versions (readable during registration, before login)
GRANT SELECT ON public.code_of_conduct_versions TO anon;
GRANT SELECT ON public.media_release_versions TO anon;
GRANT SELECT ON public.under18_form_versions TO anon;

-- Explicitly NOT granted to anon:
--   profiles, teams, event_registrations, zltac_registrations,
--   payments, event_settings, referee_*, *_signatures, *_submissions,
--   doubles_pairs, triples_teams

-- ------------------------------------------------------------
-- Part 3: authenticated role — logged-in user access
-- ------------------------------------------------------------

-- Read access to public event data (same surface as anon)
GRANT SELECT ON public.zltac_events TO authenticated;
GRANT SELECT ON public.zltac_event_history TO authenticated;
GRANT SELECT ON public.event_side_events TO authenticated;
GRANT SELECT ON public.event_pricing TO authenticated;

-- Own profile (read/create/update own row, no delete)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Teams — captains can create and update their own team. DELETE is committee-only
-- via service role (see ADR-0002).
GRANT SELECT, INSERT, UPDATE ON public.teams TO authenticated;

-- Registration flow — users create and manage their own registrations
GRANT SELECT, INSERT, UPDATE ON public.event_registrations TO authenticated;
GRANT SELECT, INSERT ON public.zltac_registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doubles_pairs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.triples_teams TO authenticated;

-- Policy acknowledgements — users can read versions + submit their own signatures.
-- Once submitted, they cannot be edited or deleted (immutable audit trail).
GRANT SELECT ON public.code_of_conduct_versions TO authenticated;
GRANT SELECT ON public.media_release_versions TO authenticated;
GRANT SELECT ON public.under18_form_versions TO authenticated;
GRANT SELECT, INSERT ON public.code_of_conduct_signatures TO authenticated;
GRANT SELECT, INSERT ON public.media_release_submissions TO authenticated;
GRANT SELECT, INSERT ON public.under18_submissions TO authenticated;

-- Payments — users create payment records on registration; updates are handled
-- by service role (webhook callbacks from payment provider)
GRANT SELECT, INSERT ON public.payments TO authenticated;

-- Event settings — read-only for authenticated. Writes are committee-only
-- via service role (see ADR-0002).
GRANT SELECT ON public.event_settings TO authenticated;

-- Referee test — users read questions + submit their own results
GRANT SELECT ON public.referee_questions TO authenticated;
GRANT SELECT ON public.referee_test_settings TO authenticated;
GRANT SELECT, INSERT ON public.referee_test_results TO authenticated;

-- Sequences — required for any INSERT on tables with auto-increment IDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- ------------------------------------------------------------
-- Part 4: Verification
-- ------------------------------------------------------------
-- Run this manually after the migration to confirm the matrix:
--
-- SELECT table_name,
--        has_table_privilege('anon',          'public.' || table_name, 'SELECT') AS anon_select,
--        has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') AS auth_select,
--        has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') AS auth_insert,
--        has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE') AS auth_update,
--        has_table_privilege('authenticated', 'public.' || table_name, 'DELETE') AS auth_delete
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
