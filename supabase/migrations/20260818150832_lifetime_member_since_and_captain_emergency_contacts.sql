-- Keep the real lifetime-membership start date separate from the portal audit
-- timestamp, and allow captain registration to capture event-specific
-- emergency contacts without reading the legacy profile-level values.

BEGIN;

ALTER TABLE public.alsa_lifetime_members
  ADD COLUMN member_since date NOT NULL DEFAULT CURRENT_DATE;

UPDATE public.alsa_lifetime_members
   SET member_since = (granted_at AT TIME ZONE 'Australia/Sydney')::date;

ALTER TABLE public.alsa_lifetime_members
  ADD CONSTRAINT alsa_lifetime_members_member_since_valid
  CHECK (member_since >= DATE '1900-01-01');

COMMENT ON COLUMN public.alsa_lifetime_members.member_since IS
  'Date the person became a lifetime member. Separate from granted_at, which records when the portal status was created.';

-- Preserve the eight-argument function for migration-first rollout safety.
-- The new application calls this overload, which composes the existing atomic
-- team-creation transaction and updates the resulting registration before the
-- outer function returns. If either step fails, PostgreSQL rolls both back.
CREATE OR REPLACE FUNCTION public.create_zltac_captain_team(
  p_user_id uuid,
  p_year integer,
  p_name text,
  p_entry_type text,
  p_state text,
  p_home_venue text,
  p_colour text,
  p_logo_url text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_registration_id uuid;
BEGIN
  IF char_length(coalesce(p_emergency_contact_name, '')) > 120 THEN
    RAISE EXCEPTION 'Emergency contact name must be 120 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_emergency_contact_phone, '')) > 50 THEN
    RAISE EXCEPTION 'Emergency contact phone must be 50 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  v_result := public.create_zltac_captain_team(
    p_user_id,
    p_year,
    p_name,
    p_entry_type,
    p_state,
    p_home_venue,
    p_colour,
    p_logo_url
  );

  v_registration_id := nullif(v_result->>'registrationId', '')::uuid;
  IF v_registration_id IS NULL THEN
    RAISE EXCEPTION 'Captain registration was not returned.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.zltac_registrations
     SET emergency_contact_name = nullif(btrim(p_emergency_contact_name), ''),
         emergency_contact_phone = nullif(btrim(p_emergency_contact_phone), '')
   WHERE id = v_registration_id
     AND user_id = p_user_id
     AND year = p_year;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Captain registration changed while emergency contact details were being saved. Retry.'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_zltac_captain_team(
  uuid, integer, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_zltac_captain_team(
  uuid, integer, text, text, text, text, text, text, text, text
) TO service_role;

COMMIT;
