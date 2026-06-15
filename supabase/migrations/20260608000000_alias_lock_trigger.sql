-- =============================================================================
-- Self-service alias lock — server-authoritative BEFORE UPDATE trigger
-- Date: 2026-06-08
-- =============================================================================
-- A player may freely change their own alias UNTIL they have registered for
-- their first competition. After that, self-service alias changes are blocked
-- and only the committee (service-role admin path, api/admin/users.js) can
-- change it. The alias is baked into payment_reference at registration-insert
-- time (see 20260514000000_payment_tracking.sql), so once any registration row
-- exists the alias must stop drifting from the frozen reference.
--
-- "Registered for any competition" spans BOTH flows and is keyed directly by
-- user_id (no team/captain/roster hop):
--   * public.zltac_registrations.user_id      (ZLTAC; pending rows count)
--   * public.competition_registrations.user_id (pre-nats / competitions)
--
-- Authorisation model (mirrors enforce_zltac_team_lock): the service role
-- (auth.uid() IS NULL) ALWAYS passes — the committee admin API writes as
-- service_role and must stay able to change any alias. Enforcement applies only
-- to a non-service authenticated caller (a player editing their own profile via
-- the anon client).
--
-- RLS cannot express this: a WITH CHECK policy sees only the NEW row and has no
-- OLD.alias, so it cannot detect that the alias changed. A BEFORE UPDATE trigger
-- (which has both OLD and NEW) is the right tool.
-- =============================================================================


-- profiles BEFORE UPDATE — alias lock once a registration exists (non-service).
CREATE OR REPLACE FUNCTION public.enforce_alias_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when the alias actually changes. Carrying the same alias forward
  -- (or editing any other profile field) is never blocked.
  IF NEW.alias IS DISTINCT FROM OLD.alias THEN

    -- Service role (auth.uid() IS NULL) is exempt. Enforcement applies only to
    -- a non-service authenticated caller (the player's own anon-client edit).
    IF auth.uid() IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.zltac_registrations      WHERE user_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.competition_registrations WHERE user_id = OLD.id) THEN
        RAISE EXCEPTION
          'Your alias is locked because you have registered for a competition. Contact the committee to change it.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort alphabetically BEFORE profiles_touch_updated_at so it fires
-- first (Postgres runs BEFORE triggers in trigger-name order). If it raises,
-- the statement aborts before updated_at is touched.
DROP TRIGGER IF EXISTS profiles_enforce_alias_lock ON public.profiles;
CREATE TRIGGER profiles_enforce_alias_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_alias_lock();


-- =============================================================================
-- ROLLBACK (run as the table owner / service role to undo this migration):
-- -----------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS profiles_enforce_alias_lock ON public.profiles;
-- DROP FUNCTION IF EXISTS public.enforce_alias_lock();
-- =============================================================================
