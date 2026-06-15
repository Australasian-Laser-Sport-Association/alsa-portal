-- 20260529000000_security_pass1_criticals.sql
-- Database access hardening.
-- Covers:
--   - remove logged-out access to event bank details
--   - protect admin-only registration columns from user self-updates
--   - restrict profile role edits to superadmins
--
-- Related API hardening is handled separately in code.

-- ---------------------------------------------------------------------------
-- 1. Bank details: stop logged-out (anon) clients reading them via PostgREST.
--    Authenticated keeps SELECT (the player payment panel needs to show where
--    to transfer). Committee write path is unchanged.
-- ---------------------------------------------------------------------------
REVOKE SELECT (bank_bsb, bank_account_number, bank_account_name)
  ON public.zltac_events FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Lock admin-only columns on zltac_registrations against player self-UPDATE.
--    RLS lets a player UPDATE their own row (side_events / extras confirm), but
--    the WITH CHECK does not pin the money / override columns. This trigger
--    blocks any non-committee change to those columns.
--
--    IMPORTANT: the guard keys off auth.uid() IS NOT NULL so that server-side
--    recomputes running under the service role (auth.uid() IS NULL) are allowed
--    -- otherwise the side-events/extras confirm flow (which recomputes
--    amount_owing on the server) would 500. Committee/superadmin also pass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_registration_admin_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_committee() THEN
    IF NEW.amount_owing            IS DISTINCT FROM OLD.amount_owing
    OR NEW.payment_reference       IS DISTINCT FROM OLD.payment_reference
    OR NEW.admin_note              IS DISTINCT FROM OLD.admin_note
    OR NEW.admin_override_coc      IS DISTINCT FROM OLD.admin_override_coc
    OR NEW.admin_override_media    IS DISTINCT FROM OLD.admin_override_media
    OR NEW.admin_override_ref_test IS DISTINCT FROM OLD.admin_override_ref_test
    OR NEW.admin_override_u18      IS DISTINCT FROM OLD.admin_override_u18 THEN
      RAISE EXCEPTION 'Cannot modify protected registration fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_registration_admin_fields ON public.zltac_registrations;
CREATE TRIGGER trg_protect_registration_admin_fields
  BEFORE UPDATE ON public.zltac_registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_registration_admin_fields();

-- ---------------------------------------------------------------------------
-- 3. Stop non-superadmin committee from rewriting profiles.roles.
--    The old committee UPDATE policy had no WITH CHECK, so is_committee() alone
--    let committee users set roles directly
--    from the browser client. Split into two policies:
--      - committee may edit profile fields but NOT roles
--      - superadmin may change anything (including roles)
--    Self-edits remain governed by profiles_update_own (roles already locked).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_update_committee ON public.profiles;

CREATE POLICY profiles_update_committee ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_committee())
  WITH CHECK (
    public.is_committee()
    AND roles = (SELECT p.roles FROM public.profiles p WHERE p.id = profiles.id)
  );

CREATE POLICY profiles_update_superadmin ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually if a flow breaks):
--   GRANT SELECT (bank_bsb, bank_account_number, bank_account_name)
--     ON public.zltac_events TO anon;
--   DROP TRIGGER IF EXISTS trg_protect_registration_admin_fields ON public.zltac_registrations;
--   DROP FUNCTION IF EXISTS public.protect_registration_admin_fields();
--   DROP POLICY IF EXISTS profiles_update_superadmin ON public.profiles;
--   DROP POLICY IF EXISTS profiles_update_committee ON public.profiles;
--   CREATE POLICY profiles_update_committee ON public.profiles
--     FOR UPDATE TO authenticated USING (public.is_committee());
-- ---------------------------------------------------------------------------
