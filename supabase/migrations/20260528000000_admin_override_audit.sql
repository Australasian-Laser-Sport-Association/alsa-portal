-- =============================================================================
-- Admin override audit columns on zltac_registrations.
--
-- Each of the four override booleans (coc / media / ref_test / u18) gains
-- three nullable trailing columns:
--   {key}_set_by   uuid REFERENCES profiles(id)
--   {key}_set_at   timestamptz
--   {key}_reason   text
--
-- Semantics (enforced at the API layer in api/admin/event.js PATCH):
--   When {key} transitions false -> true: write all three. _reason must be
--     at least 5 characters; the API rejects with 400 otherwise.
--   When {key} transitions true -> false: clear all three.
--   When {key} stays true and the admin edits _reason in place: update
--     _reason; leave _set_by / _set_at as the original setter (the audit
--     records who first granted the override, not who last touched it).
--   When {key} stays false: no-op.
--
-- Current-state-only audit: there is no separate history table. Once an
-- override is toggled off and re-set later, the previous setter / reason
-- is gone. A permanent history log would be a separate migration.
-- =============================================================================

ALTER TABLE public.zltac_registrations
  ADD COLUMN admin_override_coc_set_by      uuid REFERENCES public.profiles(id),
  ADD COLUMN admin_override_coc_set_at      timestamptz,
  ADD COLUMN admin_override_coc_reason      text,
  ADD COLUMN admin_override_media_set_by    uuid REFERENCES public.profiles(id),
  ADD COLUMN admin_override_media_set_at    timestamptz,
  ADD COLUMN admin_override_media_reason    text,
  ADD COLUMN admin_override_ref_test_set_by uuid REFERENCES public.profiles(id),
  ADD COLUMN admin_override_ref_test_set_at timestamptz,
  ADD COLUMN admin_override_ref_test_reason text,
  ADD COLUMN admin_override_u18_set_by      uuid REFERENCES public.profiles(id),
  ADD COLUMN admin_override_u18_set_at      timestamptz,
  ADD COLUMN admin_override_u18_reason      text;
