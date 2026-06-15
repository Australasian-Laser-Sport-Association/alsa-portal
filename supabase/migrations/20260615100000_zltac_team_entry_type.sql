-- Record whether a ZLTAC team enters via a state association or as a direct entry.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS entry_type text;

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_entry_type_check;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_entry_type_check
  CHECK (entry_type IS NULL OR entry_type IN ('state_association', 'direct_entry'));

CREATE OR REPLACE FUNCTION public.create_zltac_captain_team(
  p_user_id uuid,
  p_year integer,
  p_name text,
  p_entry_type text,
  p_state text,
  p_home_venue text,
  p_colour text,
  p_logo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_registration_id uuid;
  v_amount_owing integer;
BEGIN
  IF p_user_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'User and year are required' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL OR char_length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Team name is required and must be 80 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_entry_type, '')) NOT IN ('state_association', 'direct_entry') THEN
    RAISE EXCEPTION 'Invalid team entry type' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_state), '') IS NULL THEN
    RAISE EXCEPTION 'Team state is required' USING ERRCODE = '22023';
  END IF;
  IF btrim(p_state) NOT IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ') THEN
    RAISE EXCEPTION 'Invalid team state' USING ERRCODE = '22023';
  END IF;
  IF p_colour IS NOT NULL AND p_colour !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Invalid team colour' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE year = p_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status <> 'open'
     OR (v_event.reg_close_date IS NOT NULL AND now() >= v_event.reg_close_date) THEN
    RAISE EXCEPTION 'Registration is closed for this event.';
  END IF;

  INSERT INTO public.teams (
    name, captain_id, manager_id, event_id, format, status,
    entry_type, state, home_venue, colour, logo_url
  ) VALUES (
    btrim(p_name), p_user_id, p_user_id, v_event.id, 'team', 'draft',
    btrim(p_entry_type), btrim(p_state), nullif(btrim(p_home_venue), ''), p_colour, nullif(btrim(p_logo_url), '')
  )
  RETURNING * INTO v_team;

  INSERT INTO public.zltac_registrations (
    user_id, year, team_id, side_events, status
  ) VALUES (
    p_user_id, p_year, v_team.id, NULL, 'pending'
  )
  ON CONFLICT (user_id, year) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    side_events = NULL,
    status = 'pending'
  RETURNING id INTO v_registration_id;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration_id);

  DELETE FROM public.team_members tm
  USING public.teams t
  WHERE tm.team_id = t.id
    AND tm.user_id = p_user_id
    AND t.event_id = v_event.id
    AND tm.team_id <> v_team.id;

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, responded_at
  ) VALUES (
    v_team.id, p_user_id, ARRAY['manager', 'captain', 'player']::text[], 'accepted', now()
  )
  ON CONFLICT (team_id, user_id) DO UPDATE SET
    roles = EXCLUDED.roles,
    invite_status = 'accepted',
    responded_at = EXCLUDED.responded_at;

  RETURN jsonb_build_object(
    'team', to_jsonb(v_team),
    'registrationId', v_registration_id,
    'amountOwing', v_amount_owing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text, text) TO service_role;
