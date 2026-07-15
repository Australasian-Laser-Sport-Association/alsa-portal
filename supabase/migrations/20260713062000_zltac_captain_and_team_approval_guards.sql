-- Close the remaining captain-team and committee-approval integrity gaps.
-- Captain team creation now preserves an existing registration, roster moves
-- cannot steal a player from another team, and approval revalidates the same
-- roster invariants enforced when a captain submits a team.

BEGIN;

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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
  v_has_registration boolean := false;
  v_amount_owing integer;
BEGIN
  IF p_user_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'User and year are required.' USING ERRCODE = '22023';
  END IF;
  IF p_year < 2000 OR p_year > 2200 THEN
    RAISE EXCEPTION 'Invalid event year.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL OR char_length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Team name is required and must be 80 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_entry_type, '')) NOT IN ('state_association', 'direct_entry') THEN
    RAISE EXCEPTION 'Invalid team entry type.' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_state, '')) NOT IN (
    'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ'
  ) THEN
    RAISE EXCEPTION 'Invalid team state.' USING ERRCODE = '22023';
  END IF;
  IF p_home_venue IS NOT NULL AND char_length(btrim(p_home_venue)) > 120 THEN
    RAISE EXCEPTION 'Home venue must be 120 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF p_colour IS NOT NULL
     AND nullif(btrim(p_colour), '') IS NOT NULL
     AND btrim(p_colour) !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Invalid team colour.' USING ERRCODE = '22023';
  END IF;

  -- Every supported roster mutation takes this event lock first. The helper
  -- also enforces status, registration-open/close, and event-start bounds.
  v_event := public._lock_open_zltac_event(p_year);

  SELECT *
    INTO v_profile
    FROM public.profiles profile
   WHERE profile.id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_profile.suspended, false)
     OR coalesce(v_profile.is_placeholder, false) THEN
    RAISE EXCEPTION 'An active portal profile is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations registration
   WHERE registration.user_id = p_user_id
     AND registration.year = p_year
   FOR UPDATE;
  v_has_registration := FOUND;

  IF v_has_registration THEN
    IF v_registration.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'Only an active event registration can create a team.'
        USING ERRCODE = '23514';
    END IF;
    IF v_registration.team_id IS NOT NULL THEN
      RAISE EXCEPTION 'This registration already belongs to a team.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_profile.dob IS NULL THEN
    RAISE EXCEPTION 'A date of birth is required before creating a team.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.teams existing_team
     WHERE existing_team.event_id = v_event.id
       AND (
         existing_team.captain_id = p_user_id
         OR existing_team.manager_id = p_user_id
       )
  ) THEN
    RAISE EXCEPTION 'This account already leads a team for this event.'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.team_members member
      JOIN public.teams member_team ON member_team.id = member.team_id
     WHERE member.user_id = p_user_id
       AND member.invite_status = 'accepted'
       AND 'player' = ANY(member.roles)
       AND member_team.event_id = v_event.id
  ) THEN
    RAISE EXCEPTION 'This registration already has an accepted team membership.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.teams (
    name, captain_id, manager_id, event_id, format, status,
    entry_type, state, home_venue, colour, logo_url
  ) VALUES (
    btrim(p_name), p_user_id, p_user_id, v_event.id, 'team', 'draft',
    btrim(p_entry_type), btrim(p_state), nullif(btrim(p_home_venue), ''),
    nullif(btrim(p_colour), ''), nullif(btrim(p_logo_url), '')
  )
  RETURNING * INTO v_team;

  IF v_has_registration THEN
    -- Change only team ownership. Side-event selections, confirmation flags,
    -- status, emergency details, DOB evidence, and payment data stay intact.
    UPDATE public.zltac_registrations
       SET team_id = v_team.id
     WHERE id = v_registration.id
       AND team_id IS NULL
       AND status IN ('pending', 'confirmed')
    RETURNING * INTO v_registration;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The registration changed while the team was being created. Retry.'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    INSERT INTO public.zltac_registrations (
      user_id, year, team_id, side_events, dinner_guests,
      emergency_contact_name, emergency_contact_phone,
      dob_at_registration, status
    ) VALUES (
      p_user_id, p_year, v_team.id, NULL, 0,
      v_profile.emergency_contact_name, v_profile.emergency_contact_phone,
      v_profile.dob, 'pending'
    )
    RETURNING * INTO v_registration;
  END IF;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration.id);

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, responded_at
  ) VALUES (
    v_team.id, p_user_id, ARRAY['manager', 'captain', 'player']::text[],
    'accepted', clock_timestamp()
  )
  ON CONFLICT (team_id, user_id) DO UPDATE SET
    roles = ARRAY(
      SELECT DISTINCT role_name
        FROM unnest(
          public.team_members.roles
          || ARRAY['manager', 'captain', 'player']::text[]
        ) AS role_name
    ),
    invite_status = 'accepted',
    responded_at = EXCLUDED.responded_at;

  RETURN jsonb_build_object(
    'team', to_jsonb(v_team),
    'registrationId', v_registration.id,
    'amountOwing', v_amount_owing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_zltac_captain_team(
  uuid, integer, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_zltac_captain_team(
  uuid, integer, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.add_zltac_team_player(
  p_captain_id uuid,
  p_player_id uuid,
  p_team_id uuid,
  p_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
  v_amount_owing integer;
BEGIN
  IF p_captain_id IS NULL OR p_player_id IS NULL
     OR p_team_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'Captain, player, team, and year are required.'
      USING ERRCODE = '22023';
  END IF;

  v_event := public._lock_open_zltac_event(p_year);

  SELECT *
    INTO v_team
    FROM public.teams team
   WHERE team.id = p_team_id
     AND team.event_id = v_event.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found for event.' USING ERRCODE = 'P0002';
  END IF;
  IF v_team.captain_id IS DISTINCT FROM p_captain_id THEN
    RAISE EXCEPTION 'Only the team captain can add players.'
      USING ERRCODE = '42501';
  END IF;
  IF v_team.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'This team is locked while it is under review or approved.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
    FROM public.profiles profile
   WHERE profile.id = p_player_id
     AND NOT coalesce(profile.suspended, false)
     AND NOT coalesce(profile.is_placeholder, false)
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The player must have an active portal profile.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations registration
   WHERE registration.user_id = p_player_id
     AND registration.year = p_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_registration.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Only an active event registration can join a team.'
      USING ERRCODE = '23514';
  END IF;
  IF v_registration.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'This player already belongs to a team.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.teams other_team
     WHERE other_team.event_id = v_event.id
       AND other_team.id <> v_team.id
       AND (
         other_team.captain_id = p_player_id
         OR other_team.manager_id = p_player_id
       )
  ) OR EXISTS (
    SELECT 1
      FROM public.team_members member
      JOIN public.teams member_team ON member_team.id = member.team_id
     WHERE member.user_id = p_player_id
       AND member.team_id <> v_team.id
       AND member.invite_status = 'accepted'
       AND 'player' = ANY(member.roles)
       AND member_team.event_id = v_event.id
  ) THEN
    RAISE EXCEPTION 'This player already belongs to another team.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.zltac_registrations
     SET team_id = v_team.id
   WHERE id = v_registration.id
     AND team_id IS NULL
     AND status IN ('pending', 'confirmed')
  RETURNING * INTO v_registration;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The registration changed while the player was being added. Retry.'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, responded_at
  ) VALUES (
    v_team.id, p_player_id, ARRAY['player']::text[],
    'accepted', clock_timestamp()
  )
  ON CONFLICT (team_id, user_id) DO UPDATE SET
    roles = ARRAY(
      SELECT DISTINCT role_name
        FROM unnest(public.team_members.roles || ARRAY['player']::text[]) AS role_name
    ),
    invite_status = 'accepted',
    responded_at = EXCLUDED.responded_at;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration.id);
  RETURN jsonb_build_object(
    'registrationId', v_registration.id,
    'amountOwing', v_amount_owing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.add_zltac_team_player(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_zltac_team_player(uuid, uuid, uuid, integer)
  TO service_role;

-- Keep the mature settings/reconciliation implementation from 58000 as an
-- owner-only implementation detail. The public service-role entry point below
-- constrains status changes and performs approval validation around it.
ALTER FUNCTION public.committee_update_zltac_team(uuid, uuid, jsonb, text)
  RENAME TO committee_update_zltac_team_pre_62000;

REVOKE ALL ON FUNCTION public.committee_update_zltac_team_pre_62000(
  uuid, uuid, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._assert_zltac_team_approvable(
  p_team_id uuid,
  p_event_id uuid,
  p_event_year integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_captain_id uuid;
  v_roster_count integer;
BEGIN
  SELECT team.captain_id
    INTO v_captain_id
    FROM public.teams team
   WHERE team.id = p_team_id
     AND team.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found for event.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.zltac_registrations registration
      LEFT JOIN public.profiles profile ON profile.id = registration.user_id
     WHERE registration.team_id = p_team_id
       AND registration.year = p_event_year
       AND (
         registration.status NOT IN ('pending', 'confirmed')
         OR profile.id IS NULL
         OR coalesce(profile.suspended, false)
         OR coalesce(profile.is_placeholder, false)
       )
  ) THEN
    RAISE EXCEPTION 'The team roster contains an ineligible or inactive player.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.zltac_registrations registration
     WHERE registration.team_id = p_team_id
       AND registration.year = p_event_year
       AND NOT EXISTS (
         SELECT 1
           FROM public.team_members member
          WHERE member.team_id = p_team_id
            AND member.user_id = registration.user_id
            AND member.invite_status = 'accepted'
            AND 'player' = ANY(member.roles)
       )
  ) OR EXISTS (
    SELECT 1
      FROM public.team_members member
     WHERE member.team_id = p_team_id
       AND member.invite_status = 'accepted'
       AND 'player' = ANY(member.roles)
       AND NOT EXISTS (
         SELECT 1
           FROM public.zltac_registrations registration
          WHERE registration.team_id = p_team_id
            AND registration.year = p_event_year
            AND registration.user_id = member.user_id
            AND registration.status IN ('pending', 'confirmed')
       )
  ) THEN
    RAISE EXCEPTION 'Team membership and registration roster are inconsistent.'
      USING ERRCODE = '23514';
  END IF;

  IF v_captain_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.team_members member
      JOIN public.zltac_registrations registration
        ON registration.user_id = member.user_id
       AND registration.team_id = member.team_id
       AND registration.year = p_event_year
       AND registration.status IN ('pending', 'confirmed')
     WHERE member.team_id = p_team_id
       AND member.user_id = v_captain_id
       AND member.invite_status = 'accepted'
       AND 'captain' = ANY(member.roles)
       AND 'player' = ANY(member.roles)
  ) THEN
    RAISE EXCEPTION 'Captain membership is missing or inconsistent.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO v_roster_count
    FROM public.zltac_registrations registration
    JOIN public.profiles profile ON profile.id = registration.user_id
   WHERE registration.team_id = p_team_id
     AND registration.year = p_event_year
     AND registration.status IN ('pending', 'confirmed')
     AND NOT coalesce(profile.suspended, false)
     AND NOT coalesce(profile.is_placeholder, false);
  IF v_roster_count < 5 THEN
    RAISE EXCEPTION 'A team needs at least 5 eligible players for approval (currently %).',
      v_roster_count USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_zltac_team_approvable(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.committee_update_zltac_team(
  p_actor_id uuid,
  p_team_id uuid,
  p_changes jsonb,
  p_mode text DEFAULT 'settings'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_event_id uuid;
  v_unknown_key text;
  v_requested_status text;
  v_result jsonb;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);
  IF p_team_id IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'team_id and non-empty changes are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('settings', 'review') THEN
    RAISE EXCEPTION 'Invalid team update mode.' USING ERRCODE = '22023';
  END IF;

  SELECT team.event_id
    INTO v_event_id
    FROM public.teams team
   WHERE team.id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Only ZLTAC teams can be edited here.' USING ERRCODE = '22023';
  END IF;

  -- Match the event-first lock order used by every supported roster mutation.
  SELECT *
    INTO v_event
    FROM public.zltac_events event
   WHERE event.id = v_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT *
    INTO v_team
    FROM public.teams team
   WHERE team.id = p_team_id
     AND team.event_id = v_event.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team changed events while it was being edited. Retry.'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
    FROM public.zltac_registrations registration
   WHERE registration.team_id = p_team_id
     AND registration.year = v_event.year
   ORDER BY registration.id
   FOR UPDATE;
  PERFORM 1
    FROM public.team_members member
   WHERE member.team_id = p_team_id
   ORDER BY member.id
   FOR UPDATE;

  IF p_mode = 'settings' THEN
    SELECT key
      INTO v_unknown_key
      FROM jsonb_object_keys(p_changes) AS input(key)
     WHERE key NOT IN (
       'name', 'state', 'home_venue', 'entry_type', 'format', 'colour',
       'logo_url', 'manager_id', 'captain_id'
     )
     LIMIT 1;
    IF v_unknown_key IS NOT NULL THEN
      RAISE EXCEPTION 'Team status is changed only through the dedicated review action.'
        USING ERRCODE = '22023';
    END IF;

    v_result := public.committee_update_zltac_team_pre_62000(
      p_actor_id, p_team_id, p_changes, 'settings'
    );

    -- Settings edits on an already-approved team must not leave its roster in
    -- a state that could never pass approval today.
    IF (v_result->>'status') = 'approved' THEN
      PERFORM public._assert_zltac_team_approvable(
        p_team_id, v_event.id, v_event.year
      );
    END IF;
    RETURN v_result;
  END IF;

  SELECT key
    INTO v_unknown_key
    FROM jsonb_object_keys(p_changes) AS input(key)
   WHERE key NOT IN ('status', 'rejection_reason')
   LIMIT 1;
  IF v_unknown_key IS NOT NULL OR NOT (p_changes ? 'status') THEN
    RAISE EXCEPTION 'Review updates require status and may include only rejection reason.'
      USING ERRCODE = '22023';
  END IF;
  IF v_team.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending team can be reviewed.' USING ERRCODE = '55000';
  END IF;

  v_requested_status := p_changes->>'status';
  IF v_requested_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Review status must be approved or rejected.'
      USING ERRCODE = '22023';
  END IF;
  IF v_requested_status = 'approved' THEN
    PERFORM public._assert_zltac_team_approvable(
      p_team_id, v_event.id, v_event.year
    );
  END IF;

  v_result := public.committee_update_zltac_team_pre_62000(
    p_actor_id, p_team_id, p_changes, 'review'
  );

  IF v_requested_status = 'approved' THEN
    PERFORM public._assert_zltac_team_approvable(
      p_team_id, v_event.id, v_event.year
    );
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.committee_update_zltac_team(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.committee_update_zltac_team(uuid, uuid, jsonb, text)
  TO service_role;

COMMIT;
