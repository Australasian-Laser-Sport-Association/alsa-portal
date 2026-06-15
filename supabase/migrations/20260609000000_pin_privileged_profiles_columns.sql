-- 20260609000000_pin_privileged_profiles_columns.sql
-- Phase 2D: pin every privileged / service-role-only profiles column in the
-- profiles UPDATE WITH CHECK clauses, mirroring the existing `roles` pin.
--
-- Why: api/admin/users.js (and the placeholder create/claim paths) are
-- correctly guarded, but they write via the SERVICE ROLE or a SECURITY DEFINER
-- function — both bypass RLS — so they are not the only write paths. The
-- profiles UPDATE policies pinned `roles` (20260529000000) but left the other
-- privileged columns open, so straight from the anon browser client a caller
-- could mutate them on rows the endpoint logic would never allow:
--   - suspended      : committee could suspend/unsuspend anyone incl. a
--                      superadmin; any user could self-unsuspend.
--   - alsa_position  : committee/self could self-assign a committee title.
--   - is_placeholder : a user could flip their own account's placeholder flag.
--   - placeholder_email / alsa_member_id : a user could set identity/claim
--                      fields used by matching + membership logic.
--
-- Each pinned column below was confirmed to have NO anon-client write path:
--   roles            : set only by api/admin/users.js (service role, superadmin
--                      branch). [pinned since 20260529000000]
--   suspended        : set only by api/admin/users.js (service role).
--   alsa_position    : set only by api/admin/users.js (service role, superadmin
--                      roles branch).
--   is_placeholder   : set true only at placeholder creation
--                      (api/admin/event.js, service role); cleared only by
--                      claim_placeholder_profile, which is SECURITY DEFINER and
--                      DELETEs the placeholder row rather than UPDATEing the
--                      claimant's row — so pinning it cannot break a real user
--                      claiming a placeholder.
--   placeholder_email: set only at placeholder creation (service role); read
--                      (not written) by the claim RPC.
--   alsa_member_id   : only ever nulled by the superadmin reset branch of
--                      api/admin/users.js (service role).
-- The sole anon-client self-edit (src/pages/PlayerDashboard.jsx) writes only
-- first_name/last_name/dob/state/home_arena/phone/emergency_*/alias, so every
-- pin below is a no-op for legitimate edits (NEW = OLD).
--
-- NOT-NULL booleans (roles, suspended, is_placeholder) use `=`; nullable text
-- columns (alsa_position, placeholder_email, alsa_member_id) use
-- IS NOT DISTINCT FROM. profiles_update_superadmin is intentionally left
-- unrestricted (superadmin may change anything). These pins only constrain the
-- anon (RLS) path; the admin flows run under the service role / DEFINER and are
-- unaffected.
--
-- This migration changes ONLY the WITH CHECK clauses; USING clauses and the
-- existing `roles` pin are recreated byte-identical to their current text.

-- ---------------------------------------------------------------------------
-- 1. Self-update: keep the roles pin, add the remaining privileged-column pins.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND roles = (SELECT roles FROM public.profiles WHERE id = auth.uid())
    AND suspended = (SELECT suspended FROM public.profiles WHERE id = auth.uid())
    AND alsa_position IS NOT DISTINCT FROM (SELECT alsa_position FROM public.profiles WHERE id = auth.uid())
    AND is_placeholder = (SELECT is_placeholder FROM public.profiles WHERE id = auth.uid())
    AND placeholder_email IS NOT DISTINCT FROM (SELECT placeholder_email FROM public.profiles WHERE id = auth.uid())
    AND alsa_member_id IS NOT DISTINCT FROM (SELECT alsa_member_id FROM public.profiles WHERE id = auth.uid())
    AND created_by_admin_id IS NOT DISTINCT FROM (SELECT created_by_admin_id FROM public.profiles WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. Committee update: keep the roles pin, add the remaining privileged-column pins.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_update_committee ON public.profiles;

CREATE POLICY profiles_update_committee ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_committee())
  WITH CHECK (
    public.is_committee()
    AND roles = (SELECT p.roles FROM public.profiles p WHERE p.id = profiles.id)
    AND suspended = (SELECT p.suspended FROM public.profiles p WHERE p.id = profiles.id)
    AND alsa_position IS NOT DISTINCT FROM (SELECT p.alsa_position FROM public.profiles p WHERE p.id = profiles.id)
    AND is_placeholder = (SELECT p.is_placeholder FROM public.profiles p WHERE p.id = profiles.id)
    AND placeholder_email IS NOT DISTINCT FROM (SELECT p.placeholder_email FROM public.profiles p WHERE p.id = profiles.id)
    AND alsa_member_id IS NOT DISTINCT FROM (SELECT p.alsa_member_id FROM public.profiles p WHERE p.id = profiles.id)
    AND created_by_admin_id IS NOT DISTINCT FROM (SELECT p.created_by_admin_id FROM public.profiles p WHERE p.id = profiles.id)
  );

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually to revert to the prior pins — roles only):
--   DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
--   CREATE POLICY "profiles_update_own" ON public.profiles
--     FOR UPDATE TO authenticated
--     USING (id = auth.uid())
--     WITH CHECK (id = auth.uid() AND roles = (SELECT roles FROM public.profiles WHERE id = auth.uid()));
--
--   DROP POLICY IF EXISTS profiles_update_committee ON public.profiles;
--   CREATE POLICY profiles_update_committee ON public.profiles
--     FOR UPDATE TO authenticated
--     USING (public.is_committee())
--     WITH CHECK (
--       public.is_committee()
--       AND roles = (SELECT p.roles FROM public.profiles p WHERE p.id = profiles.id)
--     );
-- ---------------------------------------------------------------------------
