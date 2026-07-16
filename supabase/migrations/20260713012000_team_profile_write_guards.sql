-- Wave A: protect team control fields and profile identity fields while the
-- remaining browser clients are moved to service-role APIs.

BEGIN;

-- ---------------------------------------------------------------------------
-- Team status, scope, and ownership
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_authenticated_team_control_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Supported captain and committee mutations run through service-role APIs.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.captain_id IS DISTINCT FROM auth.uid()
       OR (NEW.manager_id IS NOT NULL AND NEW.manager_id IS DISTINCT FROM auth.uid())
       OR NEW.status IS DISTINCT FROM 'draft'
       OR NEW.rejection_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Team ownership and review fields must be set by the server.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.competition_id IS DISTINCT FROM OLD.competition_id
     OR NEW.captain_id IS DISTINCT FROM OLD.captain_id
     OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.entry_type IS DISTINCT FROM OLD.entry_type THEN
    RAISE EXCEPTION 'Team status, scope, ownership, format, and entry type are server-managed.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.guard_authenticated_team_control_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.guard_authenticated_team_control_fields()
  TO service_role;

DROP TRIGGER IF EXISTS teams_guard_authenticated_control_fields
  ON public.teams;
CREATE TRIGGER teams_guard_authenticated_control_fields
  BEFORE INSERT OR UPDATE ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_authenticated_team_control_fields();

-- ---------------------------------------------------------------------------
-- Profile email mirror, date of birth, and server-owned access state
-- ---------------------------------------------------------------------------

-- The reviewed server build checks the permanent-access tombstone during
-- every authenticated API request, including the legal-publication smoke in
-- phase 1. Add the nullable columns in this early expansion migration, while
-- the full state constraints and mutation RPC remain in 61000. The browser
-- guard below prevents the still-broad legacy profile grant from writing the
-- new server-owned fields during the maintenance window.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_revoked_by uuid
    REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.guard_profile_email_and_dob()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_email text;
BEGIN
  IF NEW.dob IS NOT NULL
     AND (NEW.dob < DATE '1900-01-01' OR NEW.dob > current_date) THEN
    RAISE EXCEPTION 'Date of birth must be between 1900-01-01 and today.'
      USING ERRCODE = '22007';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.access_revoked_at IS NOT NULL OR NEW.access_revoked_by IS NOT NULL THEN
        RAISE EXCEPTION 'Profile access state is managed by the server.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.access_revoked_at IS DISTINCT FROM OLD.access_revoked_at
       OR NEW.access_revoked_by IS DISTINCT FROM OLD.access_revoked_by THEN
      RAISE EXCEPTION 'Profile access state is managed by the server.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- profiles.email is a mirror of auth.users.email. A browser-context write
  -- may carry only the canonical value. This also permits the trusted
  -- auth.users email-sync trigger even if its originating request has a UID.
  IF auth.uid() IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.email IS DISTINCT FROM OLD.email
     ) THEN
    SELECT u.email
      INTO v_auth_email
      FROM auth.users u
     WHERE u.id = NEW.id;

    IF NOT FOUND OR NEW.email IS DISTINCT FROM v_auth_email THEN
      RAISE EXCEPTION 'Profile email is managed by the authentication service.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NEW.dob IS DISTINCT FROM OLD.dob
     AND (
       EXISTS (
         SELECT 1
         FROM public.zltac_registrations r
         WHERE r.user_id = OLD.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.competition_registrations r
         WHERE r.user_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION 'Date of birth is locked after event registration. Contact the committee to correct it.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.guard_profile_email_and_dob()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.guard_profile_email_and_dob()
  TO service_role;

DROP TRIGGER IF EXISTS profiles_guard_identity_insert ON public.profiles;
CREATE TRIGGER profiles_guard_identity_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_email_and_dob();

DROP TRIGGER IF EXISTS profiles_guard_identity_update ON public.profiles;
CREATE TRIGGER profiles_guard_identity_update
  BEFORE UPDATE OF email, dob, access_revoked_at, access_revoked_by
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_email_and_dob();

COMMIT;
