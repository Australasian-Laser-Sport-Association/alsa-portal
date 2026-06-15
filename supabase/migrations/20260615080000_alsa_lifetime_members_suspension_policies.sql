-- Add suspended-user enforcement to the ALSA lifetime member committee write
-- surface. This table was introduced after the broad suspension-enforcement
-- migration, so it needs the same restrictive write guards explicitly.

BEGIN;

DROP POLICY IF EXISTS active_user_insert ON public.alsa_lifetime_members;
DROP POLICY IF EXISTS active_user_update ON public.alsa_lifetime_members;
DROP POLICY IF EXISTS active_user_delete ON public.alsa_lifetime_members;

CREATE POLICY active_user_insert ON public.alsa_lifetime_members
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());

CREATE POLICY active_user_update ON public.alsa_lifetime_members
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY active_user_delete ON public.alsa_lifetime_members
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_active_user());

COMMIT;
