-- Serialize ZLTAC capacity checks and make captain team creation one database
-- transaction. These triggers protect every write path, including future APIs.

CREATE OR REPLACE FUNCTION public.enforce_zltac_team_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_teams integer;
  v_team_count integer;
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_teams INTO v_max_teams
    FROM public.zltac_events
   WHERE id = NEW.event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZLTAC event not found' USING ERRCODE = '23503';
  END IF;

  IF v_max_teams IS NOT NULL AND v_max_teams > 0 THEN
    SELECT count(*) INTO v_team_count
      FROM public.teams
     WHERE event_id = NEW.event_id;
    IF v_team_count >= v_max_teams THEN
      RAISE EXCEPTION 'Maximum number of teams (%) reached for this event.', v_max_teams;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_enforce_zltac_capacity ON public.teams;
CREATE TRIGGER teams_enforce_zltac_capacity
  BEFORE INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_zltac_team_capacity();

CREATE OR REPLACE FUNCTION public.enforce_zltac_registration_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_players integer;
  v_player_count integer;
BEGIN
  SELECT max_players INTO v_max_players
    FROM public.zltac_events
   WHERE year = NEW.year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZLTAC event not found' USING ERRCODE = '23503';
  END IF;

  -- BEFORE INSERT also runs for INSERT ... ON CONFLICT DO UPDATE. Existing
  -- registrations do not consume another player slot.
  IF EXISTS (
    SELECT 1 FROM public.zltac_registrations
    WHERE user_id = NEW.user_id AND year = NEW.year
  ) THEN
    RETURN NEW;
  END IF;

  IF v_max_players IS NOT NULL AND v_max_players > 0 THEN
    SELECT count(*) INTO v_player_count
      FROM public.zltac_registrations
     WHERE year = NEW.year;
    IF v_player_count >= v_max_players THEN
      RAISE EXCEPTION 'Registration cap of % reached. Contact the committee.', v_max_players;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zltac_registrations_enforce_event_capacity ON public.zltac_registrations;
-- PostgreSQL orders BEFORE INSERT triggers by name. The existing roster-lock
-- guard (`trg_...`) runs first, these capacity guards run next, and payment
-- reference generation (`...set_payment_reference`) runs last.
CREATE TRIGGER zltac_registrations_enforce_event_capacity
  BEFORE INSERT ON public.zltac_registrations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_zltac_registration_capacity();

CREATE OR REPLACE FUNCTION public.enforce_zltac_roster_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_year integer;
  v_max_players integer;
  v_roster_count integer;
BEGIN
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
     AND NEW.year IS NOT DISTINCT FROM OLD.year THEN
    RETURN NEW;
  END IF;

  SELECT e.year, e.max_players_per_team
    INTO v_event_year, v_max_players
    FROM public.teams t
    JOIN public.zltac_events e ON e.id = t.event_id
   WHERE t.id = NEW.team_id
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team is not a ZLTAC team' USING ERRCODE = '23503';
  END IF;
  IF v_event_year <> NEW.year THEN
    RAISE EXCEPTION 'Team belongs to a different event year' USING ERRCODE = '23514';
  END IF;

  IF v_max_players IS NOT NULL AND v_max_players > 0 THEN
    SELECT count(*) INTO v_roster_count
      FROM public.zltac_registrations
     WHERE team_id = NEW.team_id
       AND year = NEW.year
       AND id <> NEW.id;
    IF v_roster_count >= v_max_players THEN
      RAISE EXCEPTION 'Team is full (%/%). Contact the committee.', v_max_players, v_max_players;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zltac_registrations_enforce_roster_capacity ON public.zltac_registrations;
DROP TRIGGER IF EXISTS zltac_registrations_enforce_roster_capacity_insert ON public.zltac_registrations;
DROP TRIGGER IF EXISTS zltac_registrations_enforce_roster_capacity_update ON public.zltac_registrations;
CREATE TRIGGER zltac_registrations_enforce_roster_capacity_insert
  BEFORE INSERT ON public.zltac_registrations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_zltac_roster_capacity();
-- On UPDATE, the existing roster-lock and protected-admin-field guards both
-- run first by name. This trigger only validates a changed team_id/year and
-- does not mutate or duplicate either guard's protected fields.
CREATE TRIGGER zltac_registrations_enforce_roster_capacity_update
  BEFORE UPDATE OF team_id, year ON public.zltac_registrations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_zltac_roster_capacity();

CREATE OR REPLACE FUNCTION public.recalculate_zltac_amount_owing(p_registration_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal integer;
  v_processing_pct numeric;
  v_amount_owing integer;
BEGIN
  SELECT
    coalesce(e.main_fee, 0)
      + CASE WHEN r.team_id IS NOT NULL THEN coalesce(e.team_fee, 0) ELSE 0 END
      + coalesce((
          SELECT sum(coalesce((se.item->>'price')::integer, 0))::integer
          FROM jsonb_array_elements(coalesce(e.side_events, '[]'::jsonb)) AS se(item)
          WHERE coalesce((se.item->>'enabled')::boolean, false)
            AND se.item->>'slug' <> 'presentation-dinner'
            AND se.item->>'slug' = ANY(coalesce(r.side_events, ARRAY[]::text[]))
        ), 0)
      + coalesce(r.dinner_guests, 0) * coalesce(e.dinner_guest_price, 0),
    coalesce(e.processing_fee_pct, 0)
  INTO v_subtotal, v_processing_pct
  FROM public.zltac_registrations r
  JOIN public.zltac_events e ON e.year = r.year
  WHERE r.id = p_registration_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration not found' USING ERRCODE = 'P0002';
  END IF;

  v_amount_owing := v_subtotal + round((v_subtotal * v_processing_pct) / 100.0)::integer;
  UPDATE public.zltac_registrations
     SET amount_owing = v_amount_owing
   WHERE id = p_registration_id;
  RETURN v_amount_owing;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_zltac_captain_team(
  p_user_id uuid,
  p_year integer,
  p_name text,
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
    state, home_venue, colour, logo_url
  ) VALUES (
    btrim(p_name), p_user_id, p_user_id, v_event.id, 'team', 'draft',
    btrim(p_state), nullif(btrim(p_home_venue), ''), p_colour, nullif(btrim(p_logo_url), '')
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

CREATE OR REPLACE FUNCTION public.add_zltac_team_player(
  p_captain_id uuid,
  p_player_id uuid,
  p_team_id uuid,
  p_year integer
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
  SELECT * INTO v_event FROM public.zltac_events WHERE year = p_year FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status <> 'open'
     OR (v_event.reg_close_date IS NOT NULL AND now() >= v_event.reg_close_date) THEN
    RAISE EXCEPTION 'Registration is closed for this event.';
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.event_id IS DISTINCT FROM v_event.id THEN
    RAISE EXCEPTION 'Team not found for event' USING ERRCODE = 'P0002';
  END IF;
  IF v_team.captain_id IS DISTINCT FROM p_captain_id THEN
    RAISE EXCEPTION 'Only the team captain can add players';
  END IF;
  IF v_team.status IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'This team is locked while it is under review or approved.';
  END IF;

  UPDATE public.zltac_registrations
     SET team_id = p_team_id
   WHERE user_id = p_player_id
     AND year = p_year
  RETURNING id INTO v_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.team_members tm
  USING public.teams t
  WHERE tm.team_id = t.id
    AND tm.user_id = p_player_id
    AND t.event_id = v_event.id
    AND tm.team_id <> p_team_id;

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, responded_at
  ) VALUES (
    p_team_id, p_player_id, ARRAY['player']::text[], 'accepted', now()
  )
  ON CONFLICT (team_id, user_id) DO UPDATE SET
    roles = EXCLUDED.roles,
    invite_status = 'accepted',
    responded_at = EXCLUDED.responded_at;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration_id);
  RETURN jsonb_build_object(
    'registrationId', v_registration_id,
    'amountOwing', v_amount_owing
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.disband_zltac_team(
  p_captain_id uuid,
  p_team_id uuid,
  p_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_registration_ids uuid[];
  v_registration_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.zltac_events WHERE year = p_year FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status <> 'open'
     OR (v_event.reg_close_date IS NOT NULL AND now() >= v_event.reg_close_date) THEN
    RAISE EXCEPTION 'Registration is closed for this event.';
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.event_id IS DISTINCT FROM v_event.id THEN
    RAISE EXCEPTION 'Team not found for event' USING ERRCODE = 'P0002';
  END IF;
  IF v_team.captain_id IS DISTINCT FROM p_captain_id THEN
    RAISE EXCEPTION 'Only the team captain can disband the team';
  END IF;
  IF v_team.status IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'This team is locked while it is under review or approved.';
  END IF;

  WITH affected AS (
    UPDATE public.zltac_registrations
       SET team_id = NULL
     WHERE team_id = p_team_id
       AND year = p_year
    RETURNING id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_registration_ids
    FROM affected;

  DELETE FROM public.team_members WHERE team_id = p_team_id;
  DELETE FROM public.teams WHERE id = p_team_id;

  FOREACH v_registration_id IN ARRAY v_registration_ids LOOP
    PERFORM public.recalculate_zltac_amount_owing(v_registration_id);
  END LOOP;

  RETURN jsonb_build_object('affectedRegistrations', cardinality(v_registration_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_zltac_team_player(
  p_captain_id uuid,
  p_player_id uuid,
  p_team_id uuid,
  p_year integer
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
  SELECT * INTO v_event FROM public.zltac_events WHERE year = p_year FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status <> 'open'
     OR (v_event.reg_close_date IS NOT NULL AND now() >= v_event.reg_close_date) THEN
    RAISE EXCEPTION 'Registration is closed for this event.';
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.event_id IS DISTINCT FROM v_event.id THEN
    RAISE EXCEPTION 'Team not found for event' USING ERRCODE = 'P0002';
  END IF;
  IF v_team.captain_id IS DISTINCT FROM p_captain_id THEN
    RAISE EXCEPTION 'Only the team captain can remove players';
  END IF;
  IF p_player_id = v_team.captain_id THEN
    RAISE EXCEPTION 'The captain cannot be removed from their own team' USING ERRCODE = '22023';
  END IF;
  IF v_team.status IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'This team is locked while it is under review or approved.';
  END IF;

  UPDATE public.zltac_registrations
     SET team_id = NULL
   WHERE user_id = p_player_id
     AND team_id = p_team_id
     AND year = p_year
  RETURNING id INTO v_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration not found on this team' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.team_members
   WHERE team_id = p_team_id
     AND user_id = p_player_id;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration_id);
  RETURN jsonb_build_object(
    'registrationId', v_registration_id,
    'amountOwing', v_amount_owing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_zltac_amount_owing(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_zltac_team_player(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disband_zltac_team(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_zltac_team_player(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_zltac_amount_owing(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.add_zltac_team_player(uuid, uuid, uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.disband_zltac_team(uuid, uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_zltac_team_player(uuid, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_zltac_amount_owing(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_zltac_captain_team(uuid, integer, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_zltac_team_player(uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.disband_zltac_team(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_zltac_team_player(uuid, uuid, uuid, integer) TO service_role;
