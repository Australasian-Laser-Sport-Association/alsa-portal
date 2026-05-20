-- =============================================================================
-- Committee "manual override" flags on zltac_registrations.
--
-- For completion concerns that are NOT stored as a boolean on the registration
-- row — Code of Conduct + Media Release (legal_acceptances), Referee Test
-- (referee_test_results), Under-18 (under_18_approvals) — these let the
-- committee mark a concern satisfied when it was verified/waived OUTSIDE the
-- system, without fabricating the underlying record.
--
-- Semantics: a flag reads "satisfied" when (normal check) OR (override = true).
-- This deliberately avoids inserting a fake legal_acceptances row (which would
-- assert the player personally accepted, with a bogus ip_address / user_agent).
-- The Under-18 Approvals admin page remains the primary U18 workflow; the
-- override is a fast-path for "committee verified offline" cases. Pair any
-- override with admin_note for the audit trail.
-- =============================================================================

ALTER TABLE public.zltac_registrations
  ADD COLUMN admin_override_coc      boolean NOT NULL DEFAULT false,
  ADD COLUMN admin_override_media    boolean NOT NULL DEFAULT false,
  ADD COLUMN admin_override_ref_test boolean NOT NULL DEFAULT false,
  ADD COLUMN admin_override_u18      boolean NOT NULL DEFAULT false;
