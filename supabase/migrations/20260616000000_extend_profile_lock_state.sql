-- =============================================================================
-- Extend the profile self-service lock to cover state/territory
-- Date: 2026-06-16
-- =============================================================================
-- Builds on 20260608000000_alias_lock_trigger.sql. The alias was locked once a
-- player had registered for any competition; the same lock now applies to
-- state/territory. State is prefilled and written back at registration time, so
-- like the alias it must stop drifting once a registration row exists.
--
-- Same model as before:
--   * "Registered for any competition" is keyed directly by user_id across
--     public.zltac_registrations and public.competition_registrations.
--   * Service role (auth.uid() IS NULL) is exempt, so the committee admin API
--     can still change either field; enforcement applies only to a non-service
--     authenticated caller (the player editing their own profile).
--
-- Only the function body changes (now guarding both alias and state with
-- field-specific messages). The profiles_enforce_alias_lock trigger from the
-- original migration is unchanged and is not recreated here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_alias_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registered boolean;
BEGIN
  -- Service role (auth.uid() IS NULL) is exempt; committee can still edit.
  IF auth.uid() IS NOT NULL
     AND ( NEW.alias IS DISTINCT FROM OLD.alias
        OR NEW.state IS DISTINCT FROM OLD.state ) THEN
    SELECT EXISTS (SELECT 1 FROM public.zltac_registrations      WHERE user_id = OLD.id)
        OR EXISTS (SELECT 1 FROM public.competition_registrations WHERE user_id = OLD.id)
      INTO v_registered;
    IF v_registered THEN
      IF NEW.alias IS DISTINCT FROM OLD.alias THEN
        RAISE EXCEPTION 'Your alias is locked because you have registered for a competition. Contact the committee to change it.'
          USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'Your state/territory is locked because you have registered for a competition. Contact the committee to change it.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- ROLLBACK (restores the alias-only function body from
-- 20260608000000_alias_lock_trigger.sql; the trigger is untouched so this is
-- the only statement needed). Run as the table owner / service role:
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.enforce_alias_lock()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- BEGIN
--   -- Only act when the alias actually changes. Carrying the same alias forward
--   -- (or editing any other profile field) is never blocked.
--   IF NEW.alias IS DISTINCT FROM OLD.alias THEN
--
--     -- Service role (auth.uid() IS NULL) is exempt. Enforcement applies only to
--     -- a non-service authenticated caller (the player's own anon-client edit).
--     IF auth.uid() IS NOT NULL THEN
--       IF EXISTS (SELECT 1 FROM public.zltac_registrations      WHERE user_id = OLD.id)
--       OR EXISTS (SELECT 1 FROM public.competition_registrations WHERE user_id = OLD.id) THEN
--         RAISE EXCEPTION
--           'Your alias is locked because you have registered for a competition. Contact the committee to change it.'
--           USING ERRCODE = 'check_violation';
--       END IF;
--     END IF;
--
--   END IF;
--
--   RETURN NEW;
-- END;
-- $$;
-- =============================================================================
