-- Close the residual TRUNCATE grant on the consent/approval evidence tables.
--
-- 20260713055000_legal_event_lifecycle_integrity.sql revoked INSERT, UPDATE and
-- DELETE from service_role on legal_acceptances and under_18_approvals so that
-- "every evidence mutation now crosses one of the locked functions". The
-- original GRANT ALL in 20260519020000_legal_documents_setup.sql also carried
-- TRUNCATE, which that revoke did not name, so it survived.
--
-- TRUNCATE is strictly more destructive than the DELETE that was withheld: a
-- service-role caller cannot remove one consent record but can erase the entire
-- table in a single statement, taking the audit trail with it.
--
-- 20260713061000_profile_governance_and_evidence_guards.sql already names
-- TRUNCATE explicitly when hardening public.profiles, so this brings the
-- evidence tables in line with the established pattern rather than introducing
-- a new rule.
--
-- SELECT is retained: the server routes still read these tables. Writes
-- continue to flow through the locked SECURITY DEFINER functions.

BEGIN;

REVOKE TRUNCATE ON public.legal_acceptances  FROM PUBLIC, anon, authenticated, service_role;
REVOKE TRUNCATE ON public.under_18_approvals FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (commented out - run this block manually to revert this migration)
-- =============================================================================
-- GRANT TRUNCATE ON public.legal_acceptances  TO service_role;
-- GRANT TRUNCATE ON public.under_18_approvals TO service_role;
