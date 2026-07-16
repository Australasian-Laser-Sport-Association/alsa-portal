-- Make every volunteer signup mutation server-authoritative and transactional.
--
-- 13000 removed browser write grants from the volunteer tables, but the
-- player route still attempted authenticated-client writes. Besides making
-- the live PUT/DELETE path unusable, both player and committee workflows
-- performed parent/child changes in separate PostgREST requests. A late
-- failure could therefore leave an empty signup, lose pending role choices,
-- or partially apply a committee decision batch.

BEGIN;

CREATE OR REPLACE FUNCTION public._volunteer_signup_payload(
  p_signup_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'signup', jsonb_build_object(
      'id', signup.id,
      'notes', coalesce(signup.notes, ''),
      'created_at', signup.created_at,
      'roles', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'role_id', signup_role.role_id,
            'status', signup_role.status,
            'decided_at', signup_role.decided_at
          )
          ORDER BY signup_role.created_at, signup_role.role_id
        )
        FROM public.volunteer_signup_roles AS signup_role
        WHERE signup_role.signup_id = signup.id
      ), '[]'::jsonb)
    )
  )
  FROM public.volunteer_signups AS signup
  WHERE signup.id = p_signup_id
$$;

CREATE OR REPLACE FUNCTION public._assert_volunteer_committee_actor(
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'An active committee account is required.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.profiles AS actor
    WHERE actor.id = p_actor_id
      AND NOT coalesce(actor.suspended, false)
      AND NOT coalesce(actor.is_placeholder, false)
      AND actor.roles && ARRAY[
        'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
      ]::text[]
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active committee account is required.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_volunteer_role(
  p_actor_id uuid,
  p_role_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role public.volunteer_roles%ROWTYPE;
  v_make_default boolean := false;
  v_allowed_keys constant text[] := ARRAY[
    'code', 'name', 'short_description', 'target_count', 'min_count',
    'requires_experience', 'experience_notes', 'is_default',
    'sort_order', 'is_active'
  ]::text[];
BEGIN
  PERFORM public._assert_volunteer_committee_actor(p_actor_id);
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Volunteer role changes must be a non-empty object.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_changes) AS supplied(key)
    WHERE NOT supplied.key = ANY(v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'Volunteer role changes contain an unsupported field.'
      USING ERRCODE = '22023';
  END IF;

  IF p_role_id IS NULL AND NOT (
    p_changes ? 'code'
    AND p_changes ? 'name'
    AND p_changes ? 'short_description'
  ) THEN
    RAISE EXCEPTION 'Code, name, and short description are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'code'
     AND coalesce(p_changes->>'code', '') !~ '^[A-Z0-9]{1,5}$' THEN
    RAISE EXCEPTION 'Code must be 1-5 uppercase letters or numbers.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'name'
     AND nullif(btrim(p_changes->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Name is required.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'short_description'
     AND nullif(btrim(p_changes->>'short_description'), '') IS NULL THEN
    RAISE EXCEPTION 'Short description is required.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'target_count'
     AND p_changes->'target_count' <> 'null'::jsonb
     AND (
       jsonb_typeof(p_changes->'target_count') <> 'number'
       OR (p_changes->>'target_count')::numeric <> trunc((p_changes->>'target_count')::numeric)
       OR (p_changes->>'target_count')::numeric < 0
       OR (p_changes->>'target_count')::numeric > 2147483647
     ) THEN
    RAISE EXCEPTION 'Target count must be a non-negative whole number.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'min_count'
     AND p_changes->'min_count' <> 'null'::jsonb
     AND (
       jsonb_typeof(p_changes->'min_count') <> 'number'
       OR (p_changes->>'min_count')::numeric <> trunc((p_changes->>'min_count')::numeric)
       OR (p_changes->>'min_count')::numeric < 0
       OR (p_changes->>'min_count')::numeric > 2147483647
     ) THEN
    RAISE EXCEPTION 'Minimum count must be a non-negative whole number.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'sort_order'
     AND (
       jsonb_typeof(p_changes->'sort_order') <> 'number'
       OR (p_changes->>'sort_order')::numeric <> trunc((p_changes->>'sort_order')::numeric)
       OR (p_changes->>'sort_order')::numeric < 0
       OR (p_changes->>'sort_order')::numeric > 2147483647
     ) THEN
    RAISE EXCEPTION 'Sort order must be a non-negative whole number.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'requires_experience'
     AND jsonb_typeof(p_changes->'requires_experience') <> 'boolean' THEN
    RAISE EXCEPTION 'requires_experience must be boolean.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'is_default'
     AND jsonb_typeof(p_changes->'is_default') <> 'boolean' THEN
    RAISE EXCEPTION 'is_default must be boolean.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'is_active'
     AND jsonb_typeof(p_changes->'is_active') <> 'boolean' THEN
    RAISE EXCEPTION 'is_active must be boolean.' USING ERRCODE = '22023';
  END IF;

  -- An advisory lock also serializes the empty-table case, where row locks
  -- alone cannot prevent two concurrent default inserts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('public.volunteer_roles:configuration', 0)
  );
  PERFORM 1
    FROM public.volunteer_roles AS volunteer_role
   ORDER BY volunteer_role.id
   FOR UPDATE;

  v_make_default := p_changes ? 'is_default'
    AND (p_changes->>'is_default')::boolean;

  IF p_role_id IS NULL THEN
    INSERT INTO public.volunteer_roles (
      code, name, short_description, target_count, min_count,
      requires_experience, experience_notes, is_default,
      sort_order, is_active
    ) VALUES (
      p_changes->>'code',
      btrim(p_changes->>'name'),
      btrim(p_changes->>'short_description'),
      CASE WHEN p_changes->'target_count' = 'null'::jsonb THEN NULL ELSE (p_changes->>'target_count')::integer END,
      CASE WHEN p_changes->'min_count' = 'null'::jsonb THEN NULL ELSE (p_changes->>'min_count')::integer END,
      coalesce((p_changes->>'requires_experience')::boolean, false),
      nullif(btrim(p_changes->>'experience_notes'), ''),
      coalesce((p_changes->>'is_default')::boolean, false),
      coalesce((p_changes->>'sort_order')::integer, 0),
      coalesce((p_changes->>'is_active')::boolean, false)
    )
    RETURNING * INTO v_role;
  ELSE
    UPDATE public.volunteer_roles AS volunteer_role
       SET code = CASE WHEN p_changes ? 'code' THEN p_changes->>'code' ELSE volunteer_role.code END,
           name = CASE WHEN p_changes ? 'name' THEN btrim(p_changes->>'name') ELSE volunteer_role.name END,
           short_description = CASE WHEN p_changes ? 'short_description' THEN btrim(p_changes->>'short_description') ELSE volunteer_role.short_description END,
           target_count = CASE WHEN p_changes ? 'target_count' THEN CASE WHEN p_changes->'target_count' = 'null'::jsonb THEN NULL ELSE (p_changes->>'target_count')::integer END ELSE volunteer_role.target_count END,
           min_count = CASE WHEN p_changes ? 'min_count' THEN CASE WHEN p_changes->'min_count' = 'null'::jsonb THEN NULL ELSE (p_changes->>'min_count')::integer END ELSE volunteer_role.min_count END,
           requires_experience = CASE WHEN p_changes ? 'requires_experience' THEN (p_changes->>'requires_experience')::boolean ELSE volunteer_role.requires_experience END,
           experience_notes = CASE WHEN p_changes ? 'experience_notes' THEN nullif(btrim(p_changes->>'experience_notes'), '') ELSE volunteer_role.experience_notes END,
           is_default = CASE WHEN p_changes ? 'is_default' THEN (p_changes->>'is_default')::boolean ELSE volunteer_role.is_default END,
           sort_order = CASE WHEN p_changes ? 'sort_order' THEN (p_changes->>'sort_order')::integer ELSE volunteer_role.sort_order END,
           is_active = CASE WHEN p_changes ? 'is_active' THEN (p_changes->>'is_active')::boolean ELSE volunteer_role.is_active END
     WHERE volunteer_role.id = p_role_id
     RETURNING * INTO v_role;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Volunteer role not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF v_make_default THEN
    UPDATE public.volunteer_roles AS volunteer_role
       SET is_default = false
     WHERE volunteer_role.id <> v_role.id
       AND volunteer_role.is_default;
  END IF;

  RETURN jsonb_build_object('role', to_jsonb(v_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.mutate_own_volunteer_signup(
  p_actor_id uuid,
  p_registration_id uuid,
  p_action text,
  p_role_ids uuid[],
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year integer;
  v_event public.zltac_events%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
  v_signup public.volunteer_signups%ROWTYPE;
  v_role_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_actor_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and registration_id are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'action must be upsert or delete.'
      USING ERRCODE = '22023';
  END IF;
  IF p_action = 'upsert' AND char_length(coalesce(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'Volunteer notes must be 1000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  -- Follow the shared event -> registration -> profile lock order. The first
  -- unlocked lookup discovers the event key; every security decision is made
  -- again from locked rows below.
  SELECT registration.year
    INTO v_year
    FROM public.zltac_registrations AS registration
   WHERE registration.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_event
    FROM public.zltac_events AS event
   WHERE event.year = v_year
   FOR UPDATE;
  IF NOT FOUND
     OR v_event.status <> 'open'
     OR (
       v_event.event_starts_at IS NOT NULL
       AND statement_timestamp() >= v_event.event_starts_at
     ) THEN
    RAISE EXCEPTION 'Volunteer applications for this event are closed.'
      USING ERRCODE = '55000', HINT = 'VOLUNTEER_CLOSED';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations AS registration
   WHERE registration.id = p_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_registration.year IS DISTINCT FROM v_event.year
     OR v_registration.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'This registration does not belong to you.'
      USING ERRCODE = '42501';
  END IF;
  IF v_registration.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled registration cannot hold a volunteer signup.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
    FROM public.profiles AS actor
   WHERE actor.id = p_actor_id
     AND NOT coalesce(actor.suspended, false)
     AND NOT coalesce(actor.is_placeholder, false)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active portal account is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_action = 'upsert' THEN
    SELECT coalesce(array_agg(DISTINCT requested.role_id ORDER BY requested.role_id), ARRAY[]::uuid[])
      INTO v_role_ids
      FROM unnest(coalesce(p_role_ids, ARRAY[]::uuid[])) AS requested(role_id)
     WHERE requested.role_id IS NOT NULL;

    IF cardinality(v_role_ids) = 0 THEN
      RAISE EXCEPTION 'Select at least one role.' USING ERRCODE = '22023';
    END IF;
    IF cardinality(v_role_ids) > 50 THEN
      RAISE EXCEPTION 'No more than 50 volunteer roles may be selected.'
        USING ERRCODE = '22023';
    END IF;

    PERFORM 1
      FROM public.volunteer_roles AS volunteer_role
     WHERE volunteer_role.id = ANY(v_role_ids)
     ORDER BY volunteer_role.id
     FOR SHARE;
  END IF;

  SELECT *
    INTO v_signup
    FROM public.volunteer_signups AS signup
   WHERE signup.registration_id = p_registration_id
   FOR UPDATE;

  IF v_event.reg_close_date IS NOT NULL
     AND statement_timestamp() >= v_event.reg_close_date
     AND v_signup.id IS NOT NULL
     AND v_signup.created_at < v_event.reg_close_date THEN
    RAISE EXCEPTION 'Volunteer details are locked. Contact the committee to make changes.'
      USING ERRCODE = '55000', HINT = 'VOLUNTEER_LOCKED';
  END IF;

  IF v_signup.id IS NOT NULL THEN
    PERFORM 1
      FROM public.volunteer_signup_roles AS signup_role
     WHERE signup_role.signup_id = v_signup.id
     ORDER BY signup_role.id
     FOR UPDATE;
  END IF;

  IF p_action = 'delete' THEN
    IF v_signup.id IS NULL THEN
      RETURN jsonb_build_object('ok', true);
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.volunteer_signup_roles AS signup_role
      WHERE signup_role.signup_id = v_signup.id
        AND signup_role.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Contact committee to withdraw because you have an approved role.'
        USING ERRCODE = '55000', HINT = 'VOLUNTEER_APPROVED';
    END IF;

    DELETE FROM public.volunteer_signups AS signup
     WHERE signup.id = v_signup.id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Existing decided rows remain evidence even when omitted. Only a newly
  -- requested role must still be active.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_role_ids) AS requested(role_id)
    LEFT JOIN public.volunteer_signup_roles AS existing_signup_role
      ON existing_signup_role.signup_id = v_signup.id
     AND existing_signup_role.role_id = requested.role_id
    LEFT JOIN public.volunteer_roles AS volunteer_role
      ON volunteer_role.id = requested.role_id
    WHERE existing_signup_role.id IS NULL
      AND (volunteer_role.id IS NULL OR NOT volunteer_role.is_active)
  ) THEN
    RAISE EXCEPTION 'One or more selected roles are invalid or inactive.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.volunteer_signups (registration_id, notes)
  VALUES (p_registration_id, nullif(p_notes, ''))
  ON CONFLICT (registration_id) DO UPDATE
    SET notes = EXCLUDED.notes
  RETURNING * INTO v_signup;

  DELETE FROM public.volunteer_signup_roles AS signup_role
   WHERE signup_role.signup_id = v_signup.id
     AND signup_role.status = 'pending'
     AND NOT (signup_role.role_id = ANY(v_role_ids));

  INSERT INTO public.volunteer_signup_roles (signup_id, role_id, status)
  SELECT v_signup.id, requested.role_id, 'pending'
  FROM unnest(v_role_ids) AS requested(role_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.volunteer_signup_roles AS existing_signup_role
    WHERE existing_signup_role.signup_id = v_signup.id
      AND existing_signup_role.role_id = requested.role_id
  );

  RETURN public._volunteer_signup_payload(v_signup.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_volunteer_signup(
  p_actor_id uuid,
  p_registration_id uuid,
  p_role_ids uuid[],
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year integer;
  v_registration public.zltac_registrations%ROWTYPE;
  v_signup_id uuid;
  v_role_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM public._assert_volunteer_committee_actor(p_actor_id);
  IF p_registration_id IS NULL THEN
    RAISE EXCEPTION 'registration_id is required.' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'Volunteer notes must be 1000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT requested.role_id ORDER BY requested.role_id), ARRAY[]::uuid[])
    INTO v_role_ids
    FROM unnest(coalesce(p_role_ids, ARRAY[]::uuid[])) AS requested(role_id)
   WHERE requested.role_id IS NOT NULL;
  IF cardinality(v_role_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one role.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_role_ids) > 50 THEN
    RAISE EXCEPTION 'No more than 50 volunteer roles may be selected.'
      USING ERRCODE = '22023';
  END IF;
  SELECT registration.year
    INTO v_year
    FROM public.zltac_registrations AS registration
   WHERE registration.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
    FROM public.zltac_events AS event
   WHERE event.year = v_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations AS registration
   WHERE registration.id = p_registration_id
   FOR UPDATE;
  IF NOT FOUND OR v_registration.year IS DISTINCT FROM v_year THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_registration.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled registration cannot hold a volunteer signup.'
      USING ERRCODE = '55000';
  END IF;
  PERFORM 1
    FROM public.profiles AS target_profile
   WHERE target_profile.id = v_registration.user_id
     AND NOT coalesce(target_profile.suspended, false)
     AND NOT coalesce(target_profile.is_placeholder, false)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active player account is required.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.volunteer_roles AS volunteer_role
   WHERE volunteer_role.id = ANY(v_role_ids)
   ORDER BY volunteer_role.id
   FOR SHARE;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_role_ids) AS requested(role_id)
    LEFT JOIN public.volunteer_roles AS volunteer_role
      ON volunteer_role.id = requested.role_id
     AND volunteer_role.is_active
    WHERE volunteer_role.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more selected roles are invalid or inactive.'
      USING ERRCODE = '22023';
  END IF;

  SELECT signup.id
    INTO v_signup_id
    FROM public.volunteer_signups AS signup
   WHERE signup.registration_id = p_registration_id
   FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'created', false,
      'signup_id', v_signup_id
    );
  END IF;

  INSERT INTO public.volunteer_signups (registration_id, notes)
  VALUES (p_registration_id, nullif(p_notes, ''))
  RETURNING id INTO v_signup_id;

  INSERT INTO public.volunteer_signup_roles (
    signup_id, role_id, status, decided_by, decided_at
  )
  SELECT v_signup_id, requested.role_id, 'approved', p_actor_id, statement_timestamp()
  FROM unnest(v_role_ids) AS requested(role_id);

  RETURN jsonb_build_object(
    'created', true,
    'signup_id', v_signup_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_volunteer_role_decisions(
  p_actor_id uuid,
  p_signup_id uuid,
  p_decisions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public._assert_volunteer_committee_actor(p_actor_id);
  IF p_signup_id IS NULL THEN
    RAISE EXCEPTION 'signup_id is required.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_decisions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_decisions) = 0 THEN
    RAISE EXCEPTION 'role_decisions must be a non-empty array.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_decisions) > 50 THEN
    RAISE EXCEPTION 'No more than 50 role decisions may be submitted.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_decisions) AS decision(item)
    WHERE jsonb_typeof(decision.item) IS DISTINCT FROM 'object'
       OR coalesce(decision.item->>'role_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(decision.item->>'status', '') NOT IN ('pending', 'approved', 'declined')
  ) THEN
    RAISE EXCEPTION 'Each decision needs a valid role_id and status.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.volunteer_roles AS volunteer_role
   WHERE volunteer_role.id IN (
     SELECT (decision.item->>'role_id')::uuid
     FROM jsonb_array_elements(p_decisions) AS decision(item)
   )
   ORDER BY volunteer_role.id
   FOR SHARE;

  PERFORM 1
    FROM public.volunteer_signups AS signup
   WHERE signup.id = p_signup_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signup not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
    FROM public.volunteer_signup_roles AS signup_role
   WHERE signup_role.signup_id = p_signup_id
   ORDER BY signup_role.id
   FOR UPDATE;

  -- Existing inactive roles remain administrable evidence, but an inactive or
  -- missing role cannot be newly assigned to a signup.
  IF EXISTS (
    WITH parsed AS (
      SELECT (decision.item->>'role_id')::uuid AS role_id
      FROM jsonb_array_elements(p_decisions) AS decision(item)
    )
    SELECT 1
    FROM parsed
    LEFT JOIN public.volunteer_signup_roles AS existing_signup_role
      ON existing_signup_role.signup_id = p_signup_id
     AND existing_signup_role.role_id = parsed.role_id
    LEFT JOIN public.volunteer_roles AS volunteer_role
      ON volunteer_role.id = parsed.role_id
    WHERE existing_signup_role.id IS NULL
      AND (volunteer_role.id IS NULL OR NOT volunteer_role.is_active)
  ) THEN
    RAISE EXCEPTION 'One or more selected roles are invalid or inactive.'
      USING ERRCODE = '22023';
  END IF;

  WITH parsed AS (
    SELECT
      (decision.item->>'role_id')::uuid AS role_id,
      decision.item->>'status' AS status,
      decision.ordinality
    FROM jsonb_array_elements(p_decisions) WITH ORDINALITY AS decision(item, ordinality)
  ), deduplicated AS (
    SELECT DISTINCT ON (parsed.role_id)
      parsed.role_id,
      parsed.status
    FROM parsed
    ORDER BY parsed.role_id, parsed.ordinality DESC
  )
  INSERT INTO public.volunteer_signup_roles (
    signup_id, role_id, status, decided_by, decided_at
  )
  SELECT
    p_signup_id,
    deduplicated.role_id,
    deduplicated.status,
    CASE WHEN deduplicated.status = 'pending' THEN NULL ELSE p_actor_id END,
    CASE WHEN deduplicated.status = 'pending' THEN NULL ELSE statement_timestamp() END
  FROM deduplicated
  ON CONFLICT (signup_id, role_id) DO UPDATE
    SET status = EXCLUDED.status,
        decided_by = EXCLUDED.decided_by,
        decided_at = EXCLUDED.decided_at;

  RETURN jsonb_build_object('signup_id', p_signup_id);
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public._volunteer_signup_payload(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES
  ON FUNCTION public._assert_volunteer_committee_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.admin_upsert_volunteer_role(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.mutate_own_volunteer_signup(uuid,uuid,text,uuid[],text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.admin_create_volunteer_signup(uuid,uuid,uuid[],text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.admin_set_volunteer_role_decisions(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.admin_upsert_volunteer_role(uuid,uuid,jsonb)
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.mutate_own_volunteer_signup(uuid,uuid,text,uuid[],text)
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.admin_create_volunteer_signup(uuid,uuid,uuid[],text)
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.admin_set_volunteer_role_decisions(uuid,uuid,jsonb)
  TO service_role;

-- Keep the original browser-write boundary explicit even on drifted projects.
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.volunteer_signups, public.volunteer_signup_roles
  FROM anon, authenticated;

COMMIT;
