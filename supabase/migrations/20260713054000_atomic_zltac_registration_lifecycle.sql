-- Close the remaining ZLTAC roster transaction gaps. Player cancellation,
-- committee side-event replacement/deletion, committee team moves, and
-- placeholder creation each execute as one service-only database transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public._assert_zltac_committee_actor(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.profiles profile
     WHERE profile.id = p_actor_id
       AND NOT coalesce(profile.suspended, false)
       AND profile.roles && ARRAY[
         'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
       ]::text[]
  ) THEN
    RAISE EXCEPTION 'An active committee account is required.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_zltac_committee_actor(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assert_zltac_committee_actor(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public._lock_open_zltac_event(p_event_year integer)
RETURNS public.zltac_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
BEGIN
  IF p_event_year IS NULL THEN
    RAISE EXCEPTION 'event_year is required.' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_event
    FROM public.zltac_events
   WHERE year = p_event_year
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year.' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.status <> 'open'
     OR (v_event.reg_open_date IS NOT NULL AND clock_timestamp() < v_event.reg_open_date)
     OR (v_event.reg_close_date IS NOT NULL AND clock_timestamp() >= v_event.reg_close_date)
     OR (v_event.event_starts_at IS NOT NULL AND clock_timestamp() >= v_event.event_starts_at) THEN
    RAISE EXCEPTION 'The event is not open for roster changes.'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION public._lock_open_zltac_event(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lock_open_zltac_event(integer)
  TO service_role;

-- Reconcile one registration after a roster mutation. Missing registrations
-- are tolerated only for cleanup of legacy inconsistent data.
CREATE OR REPLACE FUNCTION public._reconcile_zltac_side_event_member(
  p_user_id uuid,
  p_event_year integer,
  p_slug text,
  p_selected boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration public.zltac_registrations%ROWTYPE;
  v_side_events text[];
BEGIN
  IF p_user_id IS NULL OR p_slug NOT IN ('doubles', 'triples') THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations
   WHERE user_id = p_user_id
     AND year = p_event_year
   FOR UPDATE;
  IF NOT FOUND OR v_registration.status = 'cancelled' THEN
    RETURN;
  END IF;

  IF p_selected THEN
    IF p_slug = ANY(coalesce(v_registration.side_events, ARRAY[]::text[])) THEN
      RETURN;
    END IF;
    v_side_events := array_append(
      coalesce(v_registration.side_events, ARRAY[]::text[]), p_slug
    );
  ELSE
    IF NOT p_slug = ANY(coalesce(v_registration.side_events, ARRAY[]::text[])) THEN
      RETURN;
    END IF;
    v_side_events := array_remove(v_registration.side_events, p_slug);
  END IF;

  UPDATE public.zltac_registrations
     SET side_events = v_side_events
   WHERE id = v_registration.id;
  PERFORM public.recalculate_zltac_amount_owing(v_registration.id);
END;
$$;

REVOKE ALL ON FUNCTION public._reconcile_zltac_side_event_member(uuid, integer, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reconcile_zltac_side_event_member(uuid, integer, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_zltac_registration(
  p_user_id uuid,
  p_event_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration public.zltac_registrations%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_roster_ids uuid[];
  v_other_members uuid[];
  v_member uuid;
  v_doubles_deleted integer := 0;
  v_triples_deleted integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._lock_open_zltac_event(p_event_year);

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations
   WHERE user_id = p_user_id
     AND year = p_event_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_registration.team_id IS NOT NULL THEN
    SELECT * INTO v_team
      FROM public.teams
     WHERE id = v_registration.team_id
     FOR UPDATE;
    IF FOUND AND v_team.captain_id = p_user_id THEN
      RAISE EXCEPTION 'The team captain must disband the team before cancelling.'
        USING ERRCODE = '55000', HINT = 'CAPTAIN_BLOCKED';
    END IF;

    DELETE FROM public.team_members
     WHERE team_id = v_registration.team_id
       AND user_id = p_user_id;
  END IF;

  SELECT coalesce(array_agg(DISTINCT member.roster_id), ARRAY[]::uuid[])
    INTO v_roster_ids
    FROM public.zltac_side_event_roster_members member
   WHERE member.format = 'doubles'
     AND member.event_year = p_event_year
     AND member.member_id = p_user_id;

  IF cardinality(v_roster_ids) > 0 THEN
    PERFORM 1 FROM public.doubles_pairs
     WHERE id = ANY(v_roster_ids) ORDER BY id FOR UPDATE;
    SELECT coalesce(array_agg(DISTINCT member.member_id), ARRAY[]::uuid[])
      INTO v_other_members
      FROM public.zltac_side_event_roster_members member
     WHERE member.format = 'doubles'
       AND member.roster_id = ANY(v_roster_ids)
       AND member.member_id <> p_user_id;
    DELETE FROM public.doubles_pairs WHERE id = ANY(v_roster_ids);
    GET DIAGNOSTICS v_doubles_deleted = ROW_COUNT;
    FOREACH v_member IN ARRAY v_other_members LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.zltac_side_event_roster_members member
         WHERE member.format = 'doubles'
           AND member.event_year = p_event_year
           AND member.member_id = v_member
      ) THEN
        PERFORM public._reconcile_zltac_side_event_member(
          v_member, p_event_year, 'doubles', false
        );
      END IF;
    END LOOP;
  END IF;

  SELECT coalesce(array_agg(DISTINCT member.roster_id), ARRAY[]::uuid[])
    INTO v_roster_ids
    FROM public.zltac_side_event_roster_members member
   WHERE member.format = 'triples'
     AND member.event_year = p_event_year
     AND member.member_id = p_user_id;

  IF cardinality(v_roster_ids) > 0 THEN
    PERFORM 1 FROM public.triples_teams
     WHERE id = ANY(v_roster_ids) ORDER BY id FOR UPDATE;
    SELECT coalesce(array_agg(DISTINCT member.member_id), ARRAY[]::uuid[])
      INTO v_other_members
      FROM public.zltac_side_event_roster_members member
     WHERE member.format = 'triples'
       AND member.roster_id = ANY(v_roster_ids)
       AND member.member_id <> p_user_id;
    DELETE FROM public.triples_teams WHERE id = ANY(v_roster_ids);
    GET DIAGNOSTICS v_triples_deleted = ROW_COUNT;
    FOREACH v_member IN ARRAY v_other_members LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.zltac_side_event_roster_members member
         WHERE member.format = 'triples'
           AND member.event_year = p_event_year
           AND member.member_id = v_member
      ) THEN
        PERFORM public._reconcile_zltac_side_event_member(
          v_member, p_event_year, 'triples', false
        );
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.zltac_registrations WHERE id = v_registration.id;

  RETURN jsonb_build_object(
    'deleted', true,
    'registration_id', v_registration.id,
    'doubles_deleted', v_doubles_deleted,
    'triples_deleted', v_triples_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_zltac_registration(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_zltac_registration(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_replace_zltac_side_event_roster(
  p_actor_id uuid,
  p_subject_id uuid,
  p_event_year integer,
  p_format text,
  p_partner_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_partners uuid[] := array_remove(coalesce(p_partner_ids, ARRAY[]::uuid[]), NULL);
  v_members uuid[];
  v_affected_rosters uuid[];
  v_affected_members uuid[];
  v_member uuid;
  v_roster_id uuid;
  v_distinct_partner_count integer;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);

  IF p_subject_id IS NULL OR p_format NOT IN ('doubles', 'triples') THEN
    RAISE EXCEPTION 'A subject and valid side-event format are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT partner_id)
    INTO v_distinct_partner_count
    FROM unnest(v_partners) AS partner(partner_id);
  IF v_distinct_partner_count <> cardinality(v_partners)
     OR p_subject_id = ANY(v_partners) THEN
    RAISE EXCEPTION 'Side-event participants must be distinct.'
      USING ERRCODE = '22023';
  END IF;
  IF (p_format = 'doubles' AND cardinality(v_partners) > 1)
     OR (p_format = 'triples' AND cardinality(v_partners) > 2) THEN
    RAISE EXCEPTION 'The side-event roster has too many partners.'
      USING ERRCODE = '22023';
  END IF;

  v_members := array_prepend(p_subject_id, v_partners);
  IF cardinality(v_partners) > 0 THEN
    PERFORM public._lock_zltac_side_event_context(
      p_event_year, p_format, v_members
    );
  ELSE
    -- Cleanup remains possible after a committee disables a side event, while
    -- still respecting the event roster lock.
    PERFORM public._lock_open_zltac_event(p_event_year);
    PERFORM 1
      FROM public.zltac_registrations registration
     WHERE registration.user_id = p_subject_id
       AND registration.year = p_event_year
       AND registration.status IN ('pending', 'confirmed')
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active registration not found for side-event member.'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT coalesce(array_agg(DISTINCT member.roster_id), ARRAY[]::uuid[])
    INTO v_affected_rosters
    FROM public.zltac_side_event_roster_members member
   WHERE member.format = p_format
     AND member.event_year = p_event_year
     AND member.member_id = ANY(v_members);

  SELECT coalesce(array_agg(DISTINCT member.member_id), ARRAY[]::uuid[])
    INTO v_affected_members
    FROM public.zltac_side_event_roster_members member
   WHERE member.format = p_format
     AND member.roster_id = ANY(v_affected_rosters);

  IF cardinality(v_affected_rosters) > 0 THEN
    IF p_format = 'doubles' THEN
      PERFORM 1 FROM public.doubles_pairs
       WHERE id = ANY(v_affected_rosters) ORDER BY id FOR UPDATE;
      DELETE FROM public.doubles_pairs WHERE id = ANY(v_affected_rosters);
    ELSE
      PERFORM 1 FROM public.triples_teams
       WHERE id = ANY(v_affected_rosters) ORDER BY id FOR UPDATE;
      DELETE FROM public.triples_teams WHERE id = ANY(v_affected_rosters);
    END IF;
  END IF;

  FOREACH v_member IN ARRAY v_affected_members LOOP
    IF NOT v_member = ANY(v_members) AND NOT EXISTS (
      SELECT 1 FROM public.zltac_side_event_roster_members member
       WHERE member.format = p_format
         AND member.event_year = p_event_year
         AND member.member_id = v_member
    ) THEN
      PERFORM public._reconcile_zltac_side_event_member(
        v_member, p_event_year, p_format, false
      );
    END IF;
  END LOOP;

  IF cardinality(v_partners) > 0 THEN
    IF p_format = 'doubles' THEN
      INSERT INTO public.doubles_pairs (
        event_year, player1_id, player2_id, confirmed
      ) VALUES (
        p_event_year, p_subject_id, v_partners[1], true
      ) RETURNING id INTO v_roster_id;
    ELSE
      INSERT INTO public.triples_teams (
        event_year, player1_id, player2_id, player3_id,
        player2_confirmed, player3_confirmed, confirmed
      ) VALUES (
        p_event_year, p_subject_id, v_partners[1], v_partners[2],
        v_partners[1] IS NOT NULL, v_partners[2] IS NOT NULL,
        v_partners[1] IS NOT NULL AND v_partners[2] IS NOT NULL
      ) RETURNING id INTO v_roster_id;
    END IF;
  END IF;

  FOREACH v_member IN ARRAY v_members LOOP
    PERFORM public._reconcile_zltac_side_event_member(
      v_member,
      p_event_year,
      p_format,
      v_roster_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object(
    'format', p_format,
    'roster_id', v_roster_id,
    'deleted_rosters', cardinality(v_affected_rosters),
    'members', v_members
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_replace_zltac_side_event_roster(uuid, uuid, integer, text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_replace_zltac_side_event_roster(uuid, uuid, integer, text, uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_zltac_side_event_roster(
  p_actor_id uuid,
  p_format text,
  p_roster_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_year integer;
  v_subject_id uuid;
  v_result jsonb;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);
  IF p_format = 'doubles' THEN
    SELECT event_year, player1_id
      INTO v_event_year, v_subject_id
      FROM public.doubles_pairs
     WHERE id = p_roster_id;
  ELSIF p_format = 'triples' THEN
    SELECT event_year, player1_id
      INTO v_event_year, v_subject_id
      FROM public.triples_teams
     WHERE id = p_roster_id;
  ELSE
    RAISE EXCEPTION 'Invalid side-event format.' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Side-event roster not found.' USING ERRCODE = 'P0002';
  END IF;

  v_result := public.admin_replace_zltac_side_event_roster(
    p_actor_id, v_subject_id, v_event_year, p_format, ARRAY[]::uuid[]
  );
  RETURN v_result || jsonb_build_object('deleted', true, 'id', p_roster_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_zltac_side_event_roster(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_zltac_side_event_roster(uuid, text, uuid)
  TO service_role;

-- Add the actor to the committee team-roster function and enforce the same
-- event lock as every other official roster mutation.
CREATE OR REPLACE FUNCTION public.committee_set_zltac_team_roster(
  p_actor_id uuid,
  p_user_id uuid,
  p_year integer,
  p_team_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_destination_event_id uuid;
  v_registration_id uuid;
  v_team_ids uuid[];
  v_amount_owing integer;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);
  v_event := public._lock_open_zltac_event(p_year);

  PERFORM 1 FROM public.profiles
   WHERE id = p_user_id
     AND NOT coalesce(suspended, false)
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active player profile is required.' USING ERRCODE = '42501';
  END IF;

  IF p_team_id IS NOT NULL THEN
    SELECT event_id INTO v_destination_event_id
      FROM public.teams
     WHERE id = p_team_id
     FOR UPDATE;
    IF NOT FOUND OR v_destination_event_id IS NULL
       OR v_destination_event_id IS DISTINCT FROM v_event.id THEN
      RAISE EXCEPTION 'Destination team belongs to a different event.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.zltac_registrations
     SET team_id = p_team_id
   WHERE user_id = p_user_id
     AND year = p_year
     AND status IN ('pending', 'confirmed')
  RETURNING id INTO v_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_team_ids
    FROM public.teams
   WHERE event_id = v_event.id;

  IF cardinality(v_team_ids) > 0 THEN
    DELETE FROM public.team_members
     WHERE user_id = p_user_id
       AND team_id = ANY(v_team_ids)
       AND (p_team_id IS NULL OR team_id <> p_team_id);
  END IF;

  IF p_team_id IS NOT NULL THEN
    INSERT INTO public.team_members (
      team_id, user_id, roles, invite_status, responded_at
    ) VALUES (
      p_team_id, p_user_id, ARRAY['player']::text[], 'accepted', now()
    )
    ON CONFLICT (team_id, user_id) DO UPDATE SET
      roles = CASE
        WHEN 'player' = ANY(public.team_members.roles) THEN public.team_members.roles
        ELSE array_append(public.team_members.roles, 'player')
      END,
      invite_status = 'accepted',
      responded_at = EXCLUDED.responded_at;
  END IF;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration_id);
  RETURN jsonb_build_object(
    'registrationId', v_registration_id,
    'team_id', p_team_id,
    'amountOwing', coalesce(v_amount_owing, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.committee_set_zltac_team_roster(uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.committee_set_zltac_team_roster(uuid, uuid, integer, uuid)
  TO service_role;

DROP FUNCTION IF EXISTS public.committee_set_zltac_team_roster(uuid, integer, uuid);

CREATE OR REPLACE FUNCTION public.admin_create_placeholder_zltac_registration(
  p_actor_id uuid,
  p_event_year integer,
  p_first_name text,
  p_last_name text,
  p_alias text,
  p_placeholder_email text,
  p_phone text,
  p_state text,
  p_dob date,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_team_id uuid,
  p_side_events text[],
  p_dinner_guests integer,
  p_doubles_partner_id uuid,
  p_triples_partner_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_profile_id uuid := gen_random_uuid();
  v_registration public.zltac_registrations%ROWTYPE;
  v_side_events text[];
  v_slug text;
  v_profile jsonb;
  v_amount_owing integer;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);
  v_event := public._lock_open_zltac_event(p_event_year);

  IF nullif(btrim(p_first_name), '') IS NULL
     OR nullif(btrim(p_alias), '') IS NULL
     OR p_dob IS NULL THEN
    RAISE EXCEPTION 'First name, alias, and date of birth are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_dob < DATE '1900-01-01' OR p_dob > current_date THEN
    RAISE EXCEPTION 'Date of birth is invalid.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE lower(alias) = lower(btrim(p_alias))
  ) THEN
    RAISE EXCEPTION 'That alias is already in use.' USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(array_agg(DISTINCT slug ORDER BY slug), ARRAY[]::text[])
    INTO v_side_events
    FROM unnest(coalesce(p_side_events, ARRAY[]::text[])) AS requested(slug)
   WHERE nullif(btrim(slug), '') IS NOT NULL;
  IF p_doubles_partner_id IS NOT NULL AND NOT 'doubles' = ANY(v_side_events) THEN
    v_side_events := array_append(v_side_events, 'doubles');
  END IF;
  IF cardinality(array_remove(coalesce(p_triples_partner_ids, ARRAY[]::uuid[]), NULL)) > 0
     AND NOT 'triples' = ANY(v_side_events) THEN
    v_side_events := array_append(v_side_events, 'triples');
  END IF;

  FOREACH v_slug IN ARRAY v_side_events LOOP
    IF jsonb_typeof(coalesce(v_event.side_events, '[]'::jsonb)) <> 'array'
       OR NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(coalesce(v_event.side_events, '[]'::jsonb)) item
          WHERE item->>'slug' = v_slug
            AND coalesce((item->>'enabled')::boolean, false)
       ) THEN
      RAISE EXCEPTION 'A selected side event is not enabled for this event.'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.profiles (
    id, is_placeholder, created_by_admin_id, first_name, last_name, alias,
    placeholder_email, phone, state, dob,
    emergency_contact_name, emergency_contact_phone
  ) VALUES (
    v_profile_id, true, p_actor_id, btrim(p_first_name),
    nullif(btrim(p_last_name), ''), btrim(p_alias),
    nullif(btrim(p_placeholder_email), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_state), ''), p_dob,
    nullif(btrim(p_emergency_contact_name), ''),
    nullif(btrim(p_emergency_contact_phone), '')
  );

  INSERT INTO public.zltac_registrations (
    user_id, year, team_id, side_events, dinner_guests,
    emergency_contact_name, emergency_contact_phone,
    dob_at_registration, status
  ) VALUES (
    v_profile_id, p_event_year, NULL,
    CASE WHEN cardinality(v_side_events) > 0 THEN v_side_events ELSE NULL END,
    greatest(coalesce(p_dinner_guests, 0), 0),
    nullif(btrim(p_emergency_contact_name), ''),
    nullif(btrim(p_emergency_contact_phone), ''),
    p_dob, 'pending'
  ) RETURNING * INTO v_registration;

  IF p_team_id IS NOT NULL THEN
    PERFORM public.committee_set_zltac_team_roster(
      p_actor_id, v_profile_id, p_event_year, p_team_id
    );
  END IF;
  IF p_doubles_partner_id IS NOT NULL THEN
    PERFORM public.admin_replace_zltac_side_event_roster(
      p_actor_id, v_profile_id, p_event_year, 'doubles',
      ARRAY[p_doubles_partner_id]::uuid[]
    );
  END IF;
  IF cardinality(array_remove(coalesce(p_triples_partner_ids, ARRAY[]::uuid[]), NULL)) > 0 THEN
    PERFORM public.admin_replace_zltac_side_event_roster(
      p_actor_id, v_profile_id, p_event_year, 'triples',
      p_triples_partner_ids
    );
  END IF;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration.id);
  SELECT jsonb_build_object(
    'id', profile.id,
    'first_name', profile.first_name,
    'last_name', profile.last_name,
    'alias', profile.alias,
    'is_placeholder', profile.is_placeholder
  ) INTO v_profile
    FROM public.profiles profile
   WHERE profile.id = v_profile_id;

  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = v_registration.id;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'registration', to_jsonb(v_registration),
    'amountOwing', coalesce(v_amount_owing, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_placeholder_zltac_registration(
  uuid, integer, text, text, text, text, text, text, date, text, text,
  uuid, text[], integer, uuid, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_placeholder_zltac_registration(
  uuid, integer, text, text, text, text, text, text, date, text, text,
  uuid, text[], integer, uuid, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_zltac_registration(
  p_actor_id uuid,
  p_registration_id uuid,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration public.zltac_registrations%ROWTYPE;
  v_event public.zltac_events%ROWTYPE;
  v_side_events text[];
  v_slug text;
  v_amount_owing integer;
  v_allowed_keys constant text[] := ARRAY[
    'side_events', 'admin_note', 'dinner_guests', 'status',
    'has_confirmed_side_events', 'has_confirmed_extras',
    'emergency_contact_name', 'emergency_contact_phone',
    'admin_override_coc', 'admin_override_coc_reason',
    'admin_override_coc_set_by', 'admin_override_coc_set_at',
    'admin_override_media', 'admin_override_media_reason',
    'admin_override_media_set_by', 'admin_override_media_set_at',
    'admin_override_ref_test', 'admin_override_ref_test_reason',
    'admin_override_ref_test_set_by', 'admin_override_ref_test_set_at',
    'admin_override_u18', 'admin_override_u18_reason',
    'admin_override_u18_set_by', 'admin_override_u18_set_at'
  ]::text[];
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);
  IF p_registration_id IS NULL
     OR p_updates IS NULL
     OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'A registration id and update object are required.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_updates) key
     WHERE NOT key = ANY(v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'The registration update contains an unsupported field.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = p_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE year = v_registration.year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for registration.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'archived' THEN
    RAISE EXCEPTION 'Archived event registrations are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF (
    v_event.status <> 'open'
    OR (v_event.reg_open_date IS NOT NULL AND clock_timestamp() < v_event.reg_open_date)
    OR (v_event.reg_close_date IS NOT NULL AND clock_timestamp() >= v_event.reg_close_date)
    OR (v_event.event_starts_at IS NOT NULL AND clock_timestamp() >= v_event.event_starts_at)
  ) AND p_updates ?| ARRAY[
    'side_events', 'dinner_guests', 'status',
    'has_confirmed_side_events', 'has_confirmed_extras'
  ]::text[] THEN
    RAISE EXCEPTION 'The event roster and billable selections are locked.'
      USING ERRCODE = '55000';
  END IF;

  IF p_updates ? 'side_events' THEN
    IF p_updates->'side_events' = 'null'::jsonb THEN
      v_side_events := NULL;
    ELSIF jsonb_typeof(p_updates->'side_events') <> 'array' THEN
      RAISE EXCEPTION 'side_events must be an array.' USING ERRCODE = '22023';
    ELSE
      SELECT coalesce(array_agg(DISTINCT value ORDER BY value), ARRAY[]::text[])
        INTO v_side_events
        FROM jsonb_array_elements_text(p_updates->'side_events') item(value);
      FOREACH v_slug IN ARRAY v_side_events LOOP
        IF jsonb_typeof(coalesce(v_event.side_events, '[]'::jsonb)) <> 'array'
           OR NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(coalesce(v_event.side_events, '[]'::jsonb)) event_item
              WHERE event_item->>'slug' = v_slug
                AND coalesce((event_item->>'enabled')::boolean, false)
           ) THEN
          RAISE EXCEPTION 'A selected side event is not enabled for this event.'
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.zltac_registrations registration SET
    side_events = CASE WHEN p_updates ? 'side_events' THEN v_side_events ELSE registration.side_events END,
    admin_note = CASE WHEN p_updates ? 'admin_note' THEN nullif(p_updates->>'admin_note', '') ELSE registration.admin_note END,
    dinner_guests = CASE WHEN p_updates ? 'dinner_guests' THEN greatest(coalesce((p_updates->>'dinner_guests')::integer, 0), 0) ELSE registration.dinner_guests END,
    status = CASE WHEN p_updates ? 'status' THEN p_updates->>'status' ELSE registration.status END,
    has_confirmed_side_events = CASE WHEN p_updates ? 'has_confirmed_side_events' THEN coalesce((p_updates->>'has_confirmed_side_events')::boolean, false) ELSE registration.has_confirmed_side_events END,
    has_confirmed_extras = CASE WHEN p_updates ? 'has_confirmed_extras' THEN coalesce((p_updates->>'has_confirmed_extras')::boolean, false) ELSE registration.has_confirmed_extras END,
    emergency_contact_name = CASE WHEN p_updates ? 'emergency_contact_name' THEN nullif(p_updates->>'emergency_contact_name', '') ELSE registration.emergency_contact_name END,
    emergency_contact_phone = CASE WHEN p_updates ? 'emergency_contact_phone' THEN nullif(p_updates->>'emergency_contact_phone', '') ELSE registration.emergency_contact_phone END,
    admin_override_coc = CASE WHEN p_updates ? 'admin_override_coc' THEN (p_updates->>'admin_override_coc')::boolean ELSE registration.admin_override_coc END,
    admin_override_coc_reason = CASE WHEN p_updates ? 'admin_override_coc_reason' THEN nullif(p_updates->>'admin_override_coc_reason', '') ELSE registration.admin_override_coc_reason END,
    admin_override_coc_set_by = CASE WHEN p_updates ? 'admin_override_coc_set_by' THEN (p_updates->>'admin_override_coc_set_by')::uuid ELSE registration.admin_override_coc_set_by END,
    admin_override_coc_set_at = CASE WHEN p_updates ? 'admin_override_coc_set_at' THEN (p_updates->>'admin_override_coc_set_at')::timestamptz ELSE registration.admin_override_coc_set_at END,
    admin_override_media = CASE WHEN p_updates ? 'admin_override_media' THEN (p_updates->>'admin_override_media')::boolean ELSE registration.admin_override_media END,
    admin_override_media_reason = CASE WHEN p_updates ? 'admin_override_media_reason' THEN nullif(p_updates->>'admin_override_media_reason', '') ELSE registration.admin_override_media_reason END,
    admin_override_media_set_by = CASE WHEN p_updates ? 'admin_override_media_set_by' THEN (p_updates->>'admin_override_media_set_by')::uuid ELSE registration.admin_override_media_set_by END,
    admin_override_media_set_at = CASE WHEN p_updates ? 'admin_override_media_set_at' THEN (p_updates->>'admin_override_media_set_at')::timestamptz ELSE registration.admin_override_media_set_at END,
    admin_override_ref_test = CASE WHEN p_updates ? 'admin_override_ref_test' THEN (p_updates->>'admin_override_ref_test')::boolean ELSE registration.admin_override_ref_test END,
    admin_override_ref_test_reason = CASE WHEN p_updates ? 'admin_override_ref_test_reason' THEN nullif(p_updates->>'admin_override_ref_test_reason', '') ELSE registration.admin_override_ref_test_reason END,
    admin_override_ref_test_set_by = CASE WHEN p_updates ? 'admin_override_ref_test_set_by' THEN (p_updates->>'admin_override_ref_test_set_by')::uuid ELSE registration.admin_override_ref_test_set_by END,
    admin_override_ref_test_set_at = CASE WHEN p_updates ? 'admin_override_ref_test_set_at' THEN (p_updates->>'admin_override_ref_test_set_at')::timestamptz ELSE registration.admin_override_ref_test_set_at END,
    admin_override_u18 = CASE WHEN p_updates ? 'admin_override_u18' THEN (p_updates->>'admin_override_u18')::boolean ELSE registration.admin_override_u18 END,
    admin_override_u18_reason = CASE WHEN p_updates ? 'admin_override_u18_reason' THEN nullif(p_updates->>'admin_override_u18_reason', '') ELSE registration.admin_override_u18_reason END,
    admin_override_u18_set_by = CASE WHEN p_updates ? 'admin_override_u18_set_by' THEN (p_updates->>'admin_override_u18_set_by')::uuid ELSE registration.admin_override_u18_set_by END,
    admin_override_u18_set_at = CASE WHEN p_updates ? 'admin_override_u18_set_at' THEN (p_updates->>'admin_override_u18_set_at')::timestamptz ELSE registration.admin_override_u18_set_at END
  WHERE registration.id = p_registration_id
  RETURNING * INTO v_registration;

  v_amount_owing := public.recalculate_zltac_amount_owing(p_registration_id);
  RETURN jsonb_build_object(
    'registration', to_jsonb(v_registration),
    'amountOwing', coalesce(v_amount_owing, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_zltac_registration(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_zltac_registration(uuid, uuid, jsonb)
  TO service_role;

COMMIT;
