-- Make the remaining ZLTAC registration writes transactional. Player
-- registration and confirmation now lock the event lifecycle row before any
-- profile or registration mutation. The committee editor composes its entire
-- save (including audited identity changes) in one transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_zltac_player(
  p_user_id uuid,
  p_event_year integer,
  p_dob date,
  p_emergency_contact_name text DEFAULT NULL,
  p_emergency_contact_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
  v_player_count integer;
  v_amount_owing integer;
BEGIN
  IF p_user_id IS NULL OR p_event_year IS NULL OR p_dob IS NULL THEN
    RAISE EXCEPTION 'A user, event year, and date of birth are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_event_year < 2000 OR p_event_year > 2200
     OR p_dob < DATE '1900-01-01' OR p_dob > current_date THEN
    RAISE EXCEPTION 'The event year or date of birth is invalid.'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_emergency_contact_name, '')) > 200
     OR char_length(coalesce(p_emergency_contact_phone, '')) > 100 THEN
    RAISE EXCEPTION 'Emergency contact details are too long.'
      USING ERRCODE = '22001';
  END IF;

  -- This lock serializes status/phase changes, cap decisions, placeholder
  -- creation, and every supported player registration for the event.
  v_event := public._lock_open_zltac_event(p_event_year);

  SELECT *
    INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_profile.suspended, false) OR coalesce(v_profile.is_placeholder, false) THEN
    RAISE EXCEPTION 'An active portal profile is required.'
      USING ERRCODE = '42501';
  END IF;

  -- DOB is identity evidence after the first event registration. Holding the
  -- profile lock makes the eligibility check and possible correction one
  -- transaction with the registration snapshot.
  IF v_profile.dob IS DISTINCT FROM p_dob THEN
    IF EXISTS (
      SELECT 1 FROM public.zltac_registrations registration
       WHERE registration.user_id = p_user_id
    ) OR EXISTS (
      SELECT 1 FROM public.competition_registrations registration
       WHERE registration.user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'Date of birth is locked after event registration.'
        USING ERRCODE = '55000', HINT = 'DOB_LOCKED';
    END IF;

    UPDATE public.profiles
       SET dob = p_dob
     WHERE id = p_user_id
    RETURNING * INTO v_profile;
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations
   WHERE user_id = p_user_id
     AND year = p_event_year
   FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'id', v_registration.id,
      'existing', true,
      'registration', jsonb_build_object(
        'id', v_registration.id,
        'user_id', v_registration.user_id,
        'year', v_registration.year,
        'side_events', v_registration.side_events,
        'has_confirmed_side_events', v_registration.has_confirmed_side_events,
        'dinner_guests', v_registration.dinner_guests,
        'has_confirmed_extras', v_registration.has_confirmed_extras,
        'dob_at_registration', v_registration.dob_at_registration
      ),
      'amountOwing', coalesce(v_registration.amount_owing, 0)
    );
  END IF;

  IF v_event.max_players IS NOT NULL AND v_event.max_players > 0 THEN
    SELECT count(*)
      INTO v_player_count
      FROM public.zltac_registrations registration
     WHERE registration.year = p_event_year;
    IF v_player_count >= v_event.max_players THEN
      RAISE EXCEPTION 'Registration cap of % reached. Contact the committee.',
        v_event.max_players
        USING ERRCODE = '23514', HINT = 'REGISTRATION_CAP_REACHED';
    END IF;
  END IF;

  INSERT INTO public.zltac_registrations (
    user_id,
    year,
    team_id,
    side_events,
    dinner_guests,
    emergency_contact_name,
    emergency_contact_phone,
    dob_at_registration,
    status
  ) VALUES (
    p_user_id,
    p_event_year,
    NULL,
    NULL,
    0,
    nullif(btrim(p_emergency_contact_name), ''),
    nullif(btrim(p_emergency_contact_phone), ''),
    p_dob,
    'pending'
  )
  RETURNING * INTO v_registration;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration.id);
  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = v_registration.id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_registration.id,
    'existing', false,
    'registration', jsonb_build_object(
      'id', v_registration.id,
      'user_id', v_registration.user_id,
      'year', v_registration.year,
      'side_events', v_registration.side_events,
      'has_confirmed_side_events', v_registration.has_confirmed_side_events,
      'dinner_guests', v_registration.dinner_guests,
      'has_confirmed_extras', v_registration.has_confirmed_extras,
      'dob_at_registration', v_registration.dob_at_registration
    ),
    'amountOwing', coalesce(v_amount_owing, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_zltac_player(uuid, integer, date, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_zltac_player(uuid, integer, date, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_zltac_registration_choices(
  p_user_id uuid,
  p_event_year integer,
  p_action text,
  p_side_events text[] DEFAULT NULL,
  p_dinner_guests integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
  v_side_events text[];
  v_slug text;
  v_amount_owing integer;
BEGIN
  IF p_user_id IS NULL OR p_event_year IS NULL
     OR p_action NOT IN ('confirm-side-events', 'confirm-extras') THEN
    RAISE EXCEPTION 'A user, event year, and confirmation action are required.'
      USING ERRCODE = '22023';
  END IF;

  v_event := public._lock_open_zltac_event(p_event_year);

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations
   WHERE user_id = p_user_id
     AND year = p_event_year
     AND status IN ('pending', 'confirmed')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active registration not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'confirm-side-events' THEN
    IF cardinality(coalesce(p_side_events, ARRAY[]::text[])) > 20 THEN
      RAISE EXCEPTION 'Too many side events were selected.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM unnest(coalesce(p_side_events, ARRAY[]::text[])) requested(slug)
       WHERE requested.slug IS NULL
          OR requested.slug !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    ) THEN
      RAISE EXCEPTION 'A side-event selection is invalid.' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(array_agg(requested.slug ORDER BY requested.first_position), ARRAY[]::text[])
      INTO v_side_events
      FROM (
        SELECT selected.slug, min(selected.ordinality) AS first_position
          FROM unnest(coalesce(p_side_events, ARRAY[]::text[]))
               WITH ORDINALITY AS selected(slug, ordinality)
         GROUP BY selected.slug
      ) requested;

    FOREACH v_slug IN ARRAY v_side_events LOOP
      IF v_slug = 'presentation-dinner'
         OR jsonb_typeof(coalesce(v_event.side_events, '[]'::jsonb)) <> 'array'
         OR NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(coalesce(v_event.side_events, '[]'::jsonb)) event_item
            WHERE event_item->>'slug' = v_slug
              AND coalesce((event_item->>'enabled')::boolean, false)
         ) THEN
        RAISE EXCEPTION 'One or more side events are not available for this event.'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    -- Roster membership is authoritative once a doubles/triples roster exists.
    -- A player must leave/disband that roster before removing the matching
    -- billable selection, otherwise the two data models drift apart.
    FOREACH v_slug IN ARRAY ARRAY['doubles', 'triples']::text[] LOOP
      IF NOT v_slug = ANY(v_side_events) AND EXISTS (
        SELECT 1
          FROM public.zltac_side_event_roster_members member
         WHERE member.format = v_slug
           AND member.event_year = p_event_year
           AND member.member_id = p_user_id
      ) THEN
        RAISE EXCEPTION 'Leave the existing % roster before removing that side event.', v_slug
          USING ERRCODE = '23514', HINT = 'SIDE_EVENT_ROSTER_EXISTS';
      END IF;
    END LOOP;

    UPDATE public.zltac_registrations
       SET side_events = v_side_events,
           has_confirmed_side_events = true
     WHERE id = v_registration.id;
  ELSE
    IF p_dinner_guests IS NULL OR p_dinner_guests < 0 OR p_dinner_guests > 10 THEN
      RAISE EXCEPTION 'dinner_guests must be an integer from 0 to 10.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.zltac_registrations
       SET dinner_guests = p_dinner_guests,
           has_confirmed_extras = true
     WHERE id = v_registration.id;
  END IF;

  v_amount_owing := public.recalculate_zltac_amount_owing(v_registration.id);
  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = v_registration.id;

  RETURN jsonb_build_object(
    'registration', jsonb_build_object(
      'id', v_registration.id,
      'user_id', v_registration.user_id,
      'year', v_registration.year,
      'side_events', v_registration.side_events,
      'has_confirmed_side_events', v_registration.has_confirmed_side_events,
      'dinner_guests', v_registration.dinner_guests,
      'has_confirmed_extras', v_registration.has_confirmed_extras,
      'dob_at_registration', v_registration.dob_at_registration
    ),
    'amountOwing', coalesce(v_amount_owing, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_zltac_registration_choices(uuid, integer, text, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_zltac_registration_choices(uuid, integer, text, text[], integer)
  TO service_role;

-- Preserve the 54000 update contract while changing its lock order to match
-- every event-first registration and roster mutation. Override attribution is
-- derived while the registration is locked instead of trusting route timing.
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
  v_initial_year integer;
  v_side_events text[];
  v_slug text;
  v_override_key text;
  v_override_value boolean;
  v_override_reason text;
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

  -- Read only the immutable routing key, lock its event, then re-read and lock
  -- the registration. A concurrent legacy year rewrite fails retryably.
  SELECT year INTO v_initial_year
    FROM public.zltac_registrations
   WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE year = v_initial_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for registration.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = p_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_registration.year IS DISTINCT FROM v_initial_year THEN
    RAISE EXCEPTION 'The registration changed while it was being edited.'
      USING ERRCODE = '40001';
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

  IF p_updates ? 'status' AND p_updates->>'status' = 'cancelled' THEN
    RAISE EXCEPTION 'Use cancel_zltac_registration for cancellation.'
      USING ERRCODE = '22023', HINT = 'CANCELLATION_WORKFLOW_REQUIRED';
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

  FOREACH v_override_key IN ARRAY ARRAY[
    'admin_override_coc', 'admin_override_media',
    'admin_override_ref_test', 'admin_override_u18'
  ]::text[] LOOP
    IF p_updates ? v_override_key THEN
      v_override_value := CASE
        WHEN p_updates->v_override_key = 'null'::jsonb THEN NULL
        ELSE (p_updates->>v_override_key)::boolean
      END;
      v_override_reason := btrim(coalesce(
        p_updates->>(v_override_key || '_reason'), ''
      ));
      IF v_override_value IS NOT NULL AND char_length(v_override_reason) < 5 THEN
        RAISE EXCEPTION '% must be at least 5 characters when % is set.',
          v_override_key || '_reason', v_override_key
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  UPDATE public.zltac_registrations registration SET
    side_events = CASE WHEN p_updates ? 'side_events' THEN v_side_events ELSE registration.side_events END,
    admin_note = CASE WHEN p_updates ? 'admin_note' THEN nullif(btrim(p_updates->>'admin_note'), '') ELSE registration.admin_note END,
    dinner_guests = CASE WHEN p_updates ? 'dinner_guests' THEN greatest(coalesce((p_updates->>'dinner_guests')::integer, 0), 0) ELSE registration.dinner_guests END,
    status = CASE WHEN p_updates ? 'status' THEN p_updates->>'status' ELSE registration.status END,
    has_confirmed_side_events = CASE WHEN p_updates ? 'has_confirmed_side_events' THEN coalesce((p_updates->>'has_confirmed_side_events')::boolean, false) ELSE registration.has_confirmed_side_events END,
    has_confirmed_extras = CASE WHEN p_updates ? 'has_confirmed_extras' THEN coalesce((p_updates->>'has_confirmed_extras')::boolean, false) ELSE registration.has_confirmed_extras END,
    emergency_contact_name = CASE WHEN p_updates ? 'emergency_contact_name' THEN nullif(btrim(p_updates->>'emergency_contact_name'), '') ELSE registration.emergency_contact_name END,
    emergency_contact_phone = CASE WHEN p_updates ? 'emergency_contact_phone' THEN nullif(btrim(p_updates->>'emergency_contact_phone'), '') ELSE registration.emergency_contact_phone END,
    admin_override_coc = CASE WHEN p_updates ? 'admin_override_coc' THEN (p_updates->>'admin_override_coc')::boolean ELSE registration.admin_override_coc END,
    admin_override_coc_reason = CASE WHEN p_updates ? 'admin_override_coc' THEN CASE WHEN (p_updates->>'admin_override_coc')::boolean IS NULL THEN NULL ELSE nullif(btrim(p_updates->>'admin_override_coc_reason'), '') END ELSE registration.admin_override_coc_reason END,
    admin_override_coc_set_by = CASE WHEN p_updates ? 'admin_override_coc' THEN CASE WHEN (p_updates->>'admin_override_coc')::boolean IS NULL THEN NULL WHEN registration.admin_override_coc IS NULL THEN p_actor_id ELSE registration.admin_override_coc_set_by END ELSE registration.admin_override_coc_set_by END,
    admin_override_coc_set_at = CASE WHEN p_updates ? 'admin_override_coc' THEN CASE WHEN (p_updates->>'admin_override_coc')::boolean IS NULL THEN NULL WHEN registration.admin_override_coc IS NULL THEN clock_timestamp() ELSE registration.admin_override_coc_set_at END ELSE registration.admin_override_coc_set_at END,
    admin_override_media = CASE WHEN p_updates ? 'admin_override_media' THEN (p_updates->>'admin_override_media')::boolean ELSE registration.admin_override_media END,
    admin_override_media_reason = CASE WHEN p_updates ? 'admin_override_media' THEN CASE WHEN (p_updates->>'admin_override_media')::boolean IS NULL THEN NULL ELSE nullif(btrim(p_updates->>'admin_override_media_reason'), '') END ELSE registration.admin_override_media_reason END,
    admin_override_media_set_by = CASE WHEN p_updates ? 'admin_override_media' THEN CASE WHEN (p_updates->>'admin_override_media')::boolean IS NULL THEN NULL WHEN registration.admin_override_media IS NULL THEN p_actor_id ELSE registration.admin_override_media_set_by END ELSE registration.admin_override_media_set_by END,
    admin_override_media_set_at = CASE WHEN p_updates ? 'admin_override_media' THEN CASE WHEN (p_updates->>'admin_override_media')::boolean IS NULL THEN NULL WHEN registration.admin_override_media IS NULL THEN clock_timestamp() ELSE registration.admin_override_media_set_at END ELSE registration.admin_override_media_set_at END,
    admin_override_ref_test = CASE WHEN p_updates ? 'admin_override_ref_test' THEN (p_updates->>'admin_override_ref_test')::boolean ELSE registration.admin_override_ref_test END,
    admin_override_ref_test_reason = CASE WHEN p_updates ? 'admin_override_ref_test' THEN CASE WHEN (p_updates->>'admin_override_ref_test')::boolean IS NULL THEN NULL ELSE nullif(btrim(p_updates->>'admin_override_ref_test_reason'), '') END ELSE registration.admin_override_ref_test_reason END,
    admin_override_ref_test_set_by = CASE WHEN p_updates ? 'admin_override_ref_test' THEN CASE WHEN (p_updates->>'admin_override_ref_test')::boolean IS NULL THEN NULL WHEN registration.admin_override_ref_test IS NULL THEN p_actor_id ELSE registration.admin_override_ref_test_set_by END ELSE registration.admin_override_ref_test_set_by END,
    admin_override_ref_test_set_at = CASE WHEN p_updates ? 'admin_override_ref_test' THEN CASE WHEN (p_updates->>'admin_override_ref_test')::boolean IS NULL THEN NULL WHEN registration.admin_override_ref_test IS NULL THEN clock_timestamp() ELSE registration.admin_override_ref_test_set_at END ELSE registration.admin_override_ref_test_set_at END,
    admin_override_u18 = CASE WHEN p_updates ? 'admin_override_u18' THEN (p_updates->>'admin_override_u18')::boolean ELSE registration.admin_override_u18 END,
    admin_override_u18_reason = CASE WHEN p_updates ? 'admin_override_u18' THEN CASE WHEN (p_updates->>'admin_override_u18')::boolean IS NULL THEN NULL ELSE nullif(btrim(p_updates->>'admin_override_u18_reason'), '') END ELSE registration.admin_override_u18_reason END,
    admin_override_u18_set_by = CASE WHEN p_updates ? 'admin_override_u18' THEN CASE WHEN (p_updates->>'admin_override_u18')::boolean IS NULL THEN NULL WHEN registration.admin_override_u18 IS NULL THEN p_actor_id ELSE registration.admin_override_u18_set_by END ELSE registration.admin_override_u18_set_by END,
    admin_override_u18_set_at = CASE WHEN p_updates ? 'admin_override_u18' THEN CASE WHEN (p_updates->>'admin_override_u18')::boolean IS NULL THEN NULL WHEN registration.admin_override_u18 IS NULL THEN clock_timestamp() ELSE registration.admin_override_u18_set_at END ELSE registration.admin_override_u18_set_at END
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

CREATE OR REPLACE FUNCTION public.admin_update_zltac_registration_bundle(
  p_actor_id uuid,
  p_registration_id uuid,
  p_bundle jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
  v_initial_year integer;
  v_updates jsonb;
  v_team_id uuid;
  v_doubles_partner_ids uuid[];
  v_triples_partner_ids uuid[];
  v_target_roles text[];
  v_amount_owing integer;
  v_amount_paid integer;
  v_allowed_keys constant text[] := ARRAY[
    'updates', 'team_id', 'doubles_partner_ids', 'triples_partner_ids',
    'state', 'alias', 'alias_reason'
  ]::text[];
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);
  IF p_registration_id IS NULL OR p_bundle IS NULL
     OR jsonb_typeof(p_bundle) <> 'object' THEN
    RAISE EXCEPTION 'A registration id and bundle object are required.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_bundle) key
     WHERE NOT key = ANY(v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'The registration bundle contains an unsupported field.'
      USING ERRCODE = '22023';
  END IF;

  v_updates := coalesce(p_bundle->'updates', '{}'::jsonb);
  IF jsonb_typeof(v_updates) <> 'object' THEN
    RAISE EXCEPTION 'updates must be an object.' USING ERRCODE = '22023';
  END IF;
  IF p_bundle ? 'doubles_partner_ids'
     AND jsonb_typeof(p_bundle->'doubles_partner_ids') <> 'array' THEN
    RAISE EXCEPTION 'doubles_partner_ids must be an array.' USING ERRCODE = '22023';
  END IF;
  IF p_bundle ? 'triples_partner_ids'
     AND jsonb_typeof(p_bundle->'triples_partner_ids') <> 'array' THEN
    RAISE EXCEPTION 'triples_partner_ids must be an array.' USING ERRCODE = '22023';
  END IF;

  SELECT year INTO v_initial_year
    FROM public.zltac_registrations
   WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE year = v_initial_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for registration.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = p_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_registration.year IS DISTINCT FROM v_initial_year THEN
    RAISE EXCEPTION 'The registration changed while it was being edited.'
      USING ERRCODE = '40001';
  END IF;
  IF v_event.status = 'archived' THEN
    RAISE EXCEPTION 'Archived event registrations are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF p_bundle ? 'team_id' AND p_bundle->'team_id' <> 'null'::jsonb THEN
    v_team_id := (p_bundle->>'team_id')::uuid;
  END IF;
  IF p_bundle ? 'doubles_partner_ids' THEN
    SELECT coalesce(array_agg(item.value::uuid ORDER BY item.ordinality), ARRAY[]::uuid[])
      INTO v_doubles_partner_ids
      FROM jsonb_array_elements_text(p_bundle->'doubles_partner_ids')
           WITH ORDINALITY item(value, ordinality)
     WHERE item.value IS NOT NULL;
    IF cardinality(v_doubles_partner_ids) > 1 THEN
      RAISE EXCEPTION 'doubles_partner_ids must contain at most one id.'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_bundle ? 'triples_partner_ids' THEN
    SELECT coalesce(array_agg(item.value::uuid ORDER BY item.ordinality), ARRAY[]::uuid[])
      INTO v_triples_partner_ids
      FROM jsonb_array_elements_text(p_bundle->'triples_partner_ids')
           WITH ORDINALITY item(value, ordinality)
     WHERE item.value IS NOT NULL;
    IF cardinality(v_triples_partner_ids) > 2 THEN
      RAISE EXCEPTION 'triples_partner_ids must contain at most two ids.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_updates <> '{}'::jsonb THEN
    PERFORM public.admin_update_zltac_registration(
      p_actor_id, p_registration_id, v_updates
    );
  END IF;

  IF p_bundle ? 'team_id' THEN
    PERFORM public.committee_set_zltac_team_roster(
      p_actor_id, v_registration.user_id, v_registration.year, v_team_id
    );
  END IF;
  IF p_bundle ? 'doubles_partner_ids' THEN
    PERFORM public.admin_replace_zltac_side_event_roster(
      p_actor_id, v_registration.user_id, v_registration.year,
      'doubles', v_doubles_partner_ids
    );
  END IF;
  IF p_bundle ? 'triples_partner_ids' THEN
    PERFORM public.admin_replace_zltac_side_event_roster(
      p_actor_id, v_registration.user_id, v_registration.year,
      'triples', v_triples_partner_ids
    );
  END IF;

  IF p_bundle ? 'state' OR p_bundle ? 'alias' THEN
    SELECT roles INTO v_target_roles
      FROM public.profiles
     WHERE id = v_registration.user_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_bundle ? 'state' THEN
    UPDATE public.profiles
       SET state = nullif(btrim(p_bundle->>'state'), '')
     WHERE id = v_registration.user_id;
  END IF;

  IF p_bundle ? 'alias' THEN
    IF 'superadmin' = ANY(coalesce(v_target_roles, ARRAY[]::text[]))
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles actor
          WHERE actor.id = p_actor_id
            AND NOT coalesce(actor.suspended, false)
            AND 'superadmin' = ANY(actor.roles)
       ) THEN
      RAISE EXCEPTION 'Only a superadmin can change a superadmin alias.'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.change_profile_alias(
      v_registration.user_id,
      p_bundle->>'alias',
      p_bundle->>'alias_reason',
      p_actor_id,
      'registration-editor'
    );
  END IF;

  v_amount_owing := public.recalculate_zltac_amount_owing(p_registration_id);
  SELECT coalesce(sum(record.amount), 0)::integer
    INTO v_amount_paid
    FROM public.payment_records record
   WHERE record.registration_id = p_registration_id;
  SELECT * INTO v_registration
    FROM public.zltac_registrations
   WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'registrationId', p_registration_id,
    'registration', to_jsonb(v_registration),
    'amountOwing', coalesce(v_amount_owing, 0),
    'amountPaid', coalesce(v_amount_paid, 0),
    'balance', coalesce(v_amount_owing, 0) - coalesce(v_amount_paid, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_zltac_registration_bundle(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_zltac_registration_bundle(uuid, uuid, jsonb)
  TO service_role;

-- Recorded money is durable evidence. Cancellation must stop before deleting
-- team/side-event evidence or allowing the FK cascade to remove the ledger.
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

  PERFORM 1
    FROM public.payment_records record
   WHERE record.registration_id = v_registration.id
   ORDER BY record.id
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'A registration with recorded payments cannot be cancelled.'
      USING ERRCODE = '55000', HINT = 'PAYMENT_RECORDS_EXIST';
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

COMMIT;
