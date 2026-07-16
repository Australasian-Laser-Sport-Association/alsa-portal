-- Serialize privileged configuration and ZLTAC team mutations behind
-- service-only database workflows. These functions lock the owning event or
-- competition before inspecting dependent rows, so registration/configuration
-- races cannot leave prices, rosters, or payment references inconsistent.

BEGIN;

-- ---------------------------------------------------------------------------
-- ZLTAC event configuration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.committee_save_zltac_event(
  p_actor_id uuid,
  p_event_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_candidate public.zltac_events%ROWTYPE;
  v_saved public.zltac_events%ROWTYPE;
  v_has_dependants boolean := false;
  v_is_closed boolean := false;
  v_critical_changed boolean := false;
  v_unknown_key text;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);

  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Event changes must be a non-empty JSON object.'
      USING ERRCODE = '22023';
  END IF;

  SELECT key INTO v_unknown_key
    FROM jsonb_object_keys(p_changes) AS input(key)
   WHERE NOT (key = ANY(ARRAY[
     'name', 'year', 'status', 'start_date', 'end_date', 'location', 'venue',
     'description', 'logo_url', 'cover_photo_url', 'hero_text', 'photo_urls',
     'main_fee', 'team_fee', 'dinner_guest_price', 'processing_fee_pct',
     'bank_bsb', 'bank_account_number', 'bank_account_name', 'side_events',
     'timezone', 'reg_open_date', 'reg_close_date', 'event_starts_at',
     'max_teams', 'max_players', 'max_players_per_team', 'require_coc',
     'require_ref_test', 'require_payment', 'allow_side_events_only',
     'enable_waitlist', 'committee_email', 'payments_override'
   ]::text[]))
   LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported event field: %', v_unknown_key
      USING ERRCODE = '22023';
  END IF;

  IF p_event_id IS NULL THEN
    v_candidate := jsonb_populate_record(NULL::public.zltac_events, p_changes);
    v_candidate.id := gen_random_uuid();
    v_candidate.status := coalesce(v_candidate.status, 'draft');
    v_candidate.main_fee := coalesce(v_candidate.main_fee, 0);
    v_candidate.team_fee := coalesce(v_candidate.team_fee, 0);
    v_candidate.dinner_guest_price := coalesce(v_candidate.dinner_guest_price, 6500);
    v_candidate.processing_fee_pct := coalesce(v_candidate.processing_fee_pct, 2.5);
    v_candidate.require_coc := coalesce(v_candidate.require_coc, true);
    v_candidate.require_ref_test := coalesce(v_candidate.require_ref_test, true);
    v_candidate.require_payment := coalesce(v_candidate.require_payment, true);
    v_candidate.allow_side_events_only := coalesce(v_candidate.allow_side_events_only, false);
    v_candidate.enable_waitlist := coalesce(v_candidate.enable_waitlist, false);
    v_candidate.photo_urls := coalesce(v_candidate.photo_urls, ARRAY[]::text[]);
    v_candidate.timezone := coalesce(nullif(btrim(v_candidate.timezone), ''), 'Australia/Melbourne');
    v_candidate.created_at := clock_timestamp();
    v_candidate.updated_at := v_candidate.created_at;
  ELSE
    -- Lock the event before checking registrations or applying any change.
    SELECT * INTO v_event
      FROM public.zltac_events
     WHERE id = p_event_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Event not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status = 'archived' THEN
      RAISE EXCEPTION 'Archived events are immutable.' USING ERRCODE = '55000';
    END IF;

    v_candidate := jsonb_populate_record(v_event, p_changes);
    v_candidate.id := v_event.id;
    v_candidate.created_at := v_event.created_at;
    v_candidate.updated_at := clock_timestamp();

    SELECT EXISTS (
      SELECT 1 FROM public.zltac_registrations registration
       WHERE registration.year = v_event.year
    ) OR EXISTS (
      SELECT 1 FROM public.teams team
       WHERE team.event_id = v_event.id
    ) INTO v_has_dependants;

    v_is_closed := v_event.status = 'closed'
      OR (v_event.reg_close_date IS NOT NULL
          AND clock_timestamp() >= v_event.reg_close_date)
      OR (v_event.event_starts_at IS NOT NULL
          AND clock_timestamp() >= v_event.event_starts_at)
      OR (v_event.end_date IS NOT NULL AND current_date > v_event.end_date);

    v_critical_changed :=
      v_candidate.year IS DISTINCT FROM v_event.year
      OR v_candidate.start_date IS DISTINCT FROM v_event.start_date
      OR v_candidate.end_date IS DISTINCT FROM v_event.end_date
      OR v_candidate.main_fee IS DISTINCT FROM v_event.main_fee
      OR v_candidate.team_fee IS DISTINCT FROM v_event.team_fee
      OR v_candidate.dinner_guest_price IS DISTINCT FROM v_event.dinner_guest_price
      OR v_candidate.processing_fee_pct IS DISTINCT FROM v_event.processing_fee_pct
      OR v_candidate.side_events IS DISTINCT FROM v_event.side_events
      OR v_candidate.reg_open_date IS DISTINCT FROM v_event.reg_open_date
      OR v_candidate.reg_close_date IS DISTINCT FROM v_event.reg_close_date
      OR v_candidate.event_starts_at IS DISTINCT FROM v_event.event_starts_at
      OR v_candidate.max_teams IS DISTINCT FROM v_event.max_teams
      OR v_candidate.max_players IS DISTINCT FROM v_event.max_players
      OR v_candidate.max_players_per_team IS DISTINCT FROM v_event.max_players_per_team
      OR v_candidate.require_coc IS DISTINCT FROM v_event.require_coc
      OR v_candidate.require_ref_test IS DISTINCT FROM v_event.require_ref_test
      OR v_candidate.require_payment IS DISTINCT FROM v_event.require_payment
      OR v_candidate.allow_side_events_only IS DISTINCT FROM v_event.allow_side_events_only
      OR v_candidate.enable_waitlist IS DISTINCT FROM v_event.enable_waitlist;

    IF (v_has_dependants OR v_is_closed) AND v_critical_changed THEN
      RAISE EXCEPTION
        'Pricing, requirements, capacity, side events, and registration windows are frozen once registrations exist or the event closes.'
        USING ERRCODE = '55000';
    END IF;

    IF (v_has_dependants OR v_is_closed)
       AND v_candidate.status IS DISTINCT FROM v_event.status
       AND NOT (v_event.status = 'open' AND v_candidate.status = 'closed') THEN
      RAISE EXCEPTION
        'Only the open-to-closed lifecycle transition is allowed after registrations exist.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  v_candidate.name := btrim(v_candidate.name);
  IF nullif(v_candidate.name, '') IS NULL OR char_length(v_candidate.name) > 120 THEN
    RAISE EXCEPTION 'Event name is required and must be 120 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.year IS NULL OR v_candidate.year < 1999
     OR v_candidate.year > extract(year FROM current_date)::integer + 10 THEN
    RAISE EXCEPTION 'A valid event year is required.' USING ERRCODE = '22023';
  END IF;
  IF v_candidate.status NOT IN ('draft', 'open', 'closed') THEN
    RAISE EXCEPTION 'A valid non-archived event status is required.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.start_date IS NOT NULL AND v_candidate.end_date IS NOT NULL
     AND v_candidate.end_date < v_candidate.start_date THEN
    RAISE EXCEPTION 'Event end date must be on or after its start date.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.reg_open_date IS NOT NULL AND v_candidate.reg_close_date IS NOT NULL
     AND v_candidate.reg_close_date < v_candidate.reg_open_date THEN
    RAISE EXCEPTION 'Registration close must be on or after registration open.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.main_fee < 0 OR v_candidate.team_fee < 0
     OR v_candidate.dinner_guest_price < 0
     OR v_candidate.processing_fee_pct < 0
     OR v_candidate.processing_fee_pct > 100 THEN
    RAISE EXCEPTION 'Event prices and processing percentage must be non-negative.'
      USING ERRCODE = '22023';
  END IF;
  IF (v_candidate.max_teams IS NOT NULL AND v_candidate.max_teams < 1)
     OR (v_candidate.max_players IS NOT NULL AND v_candidate.max_players < 1)
     OR (v_candidate.max_players_per_team IS NOT NULL
         AND v_candidate.max_players_per_team < 1) THEN
    RAISE EXCEPTION 'Event capacities must be positive when supplied.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.side_events IS NOT NULL
     AND jsonb_typeof(v_candidate.side_events) <> 'array' THEN
    RAISE EXCEPTION 'side_events must be an array.' USING ERRCODE = '22023';
  END IF;

  IF p_event_id IS NULL THEN
    INSERT INTO public.zltac_events
    SELECT v_candidate.*
    RETURNING * INTO v_saved;
  ELSE
    UPDATE public.zltac_events SET
      name = v_candidate.name,
      year = v_candidate.year,
      location = v_candidate.location,
      venue = v_candidate.venue,
      start_date = v_candidate.start_date,
      end_date = v_candidate.end_date,
      status = v_candidate.status,
      description = v_candidate.description,
      logo_url = v_candidate.logo_url,
      main_fee = v_candidate.main_fee,
      team_fee = v_candidate.team_fee,
      dinner_guest_price = v_candidate.dinner_guest_price,
      processing_fee_pct = v_candidate.processing_fee_pct,
      side_events = v_candidate.side_events,
      reg_open_date = v_candidate.reg_open_date,
      reg_close_date = v_candidate.reg_close_date,
      require_coc = v_candidate.require_coc,
      require_ref_test = v_candidate.require_ref_test,
      require_payment = v_candidate.require_payment,
      max_teams = v_candidate.max_teams,
      max_players = v_candidate.max_players,
      max_players_per_team = v_candidate.max_players_per_team,
      allow_side_events_only = v_candidate.allow_side_events_only,
      enable_waitlist = v_candidate.enable_waitlist,
      updated_at = v_candidate.updated_at,
      hero_text = v_candidate.hero_text,
      photo_urls = v_candidate.photo_urls,
      bank_bsb = v_candidate.bank_bsb,
      bank_account_number = v_candidate.bank_account_number,
      bank_account_name = v_candidate.bank_account_name,
      event_starts_at = v_candidate.event_starts_at,
      committee_email = v_candidate.committee_email,
      cover_photo_url = v_candidate.cover_photo_url,
      payments_override = v_candidate.payments_override,
      timezone = v_candidate.timezone
    WHERE id = p_event_id
    RETURNING * INTO v_saved;
  END IF;

  RETURN to_jsonb(v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.committee_save_zltac_event(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.committee_save_zltac_event(uuid, uuid, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Committee ZLTAC team review/settings
-- ---------------------------------------------------------------------------

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
  v_event_id uuid;
  v_event public.zltac_events%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_candidate public.teams%ROWTYPE;
  v_saved public.teams%ROWTYPE;
  v_candidate_registration public.zltac_registrations%ROWTYPE;
  v_unknown_key text;
  v_roster_changed boolean;
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

  SELECT key INTO v_unknown_key
    FROM jsonb_object_keys(p_changes) AS input(key)
   WHERE NOT (key = ANY(ARRAY[
     'name', 'state', 'home_venue', 'entry_type', 'format', 'colour',
     'logo_url', 'manager_id', 'captain_id', 'status', 'rejection_reason'
   ]::text[]))
   LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported team field: %', v_unknown_key
      USING ERRCODE = '22023';
  END IF;

  -- Discover the owner without taking a team lock, then lock in the canonical
  -- event-first order used by registration/roster workflows.
  SELECT event_id INTO v_event_id
    FROM public.teams
   WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Only ZLTAC teams can be edited here.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE id = v_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'archived' THEN
    RAISE EXCEPTION 'Archived event teams are immutable.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_team
    FROM public.teams
   WHERE id = p_team_id
     AND event_id = v_event.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team changed events while it was being edited. Retry.'
      USING ERRCODE = '40001';
  END IF;

  -- Lock all rows whose ownership/roles may be reconciled below.
  PERFORM 1 FROM public.zltac_registrations registration
   WHERE registration.year = v_event.year
   ORDER BY registration.id
   FOR UPDATE;
  PERFORM 1 FROM public.team_members member
   JOIN public.teams event_team ON event_team.id = member.team_id
   WHERE event_team.event_id = v_event.id
   ORDER BY member.id
   FOR UPDATE OF member;

  IF p_mode = 'review' THEN
    SELECT key INTO v_unknown_key
      FROM jsonb_object_keys(p_changes) AS input(key)
     WHERE key NOT IN ('status', 'rejection_reason')
     LIMIT 1;
    IF v_unknown_key IS NOT NULL THEN
      RAISE EXCEPTION 'Review updates may change only status and rejection reason.'
        USING ERRCODE = '22023';
    END IF;
    IF v_team.status = 'draft' THEN
      RAISE EXCEPTION 'Team has not been submitted for approval yet.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  v_candidate := jsonb_populate_record(v_team, p_changes);
  v_candidate.id := v_team.id;
  v_candidate.event_id := v_team.event_id;
  v_candidate.competition_id := v_team.competition_id;
  v_candidate.created_at := v_team.created_at;

  v_candidate.name := btrim(v_candidate.name);
  IF nullif(v_candidate.name, '') IS NULL OR char_length(v_candidate.name) > 80 THEN
    RAISE EXCEPTION 'Team name is required and must be 80 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.state IS NOT NULL
     AND v_candidate.state NOT IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ') THEN
    RAISE EXCEPTION 'A valid team state is required.' USING ERRCODE = '22023';
  END IF;
  IF v_candidate.home_venue IS NOT NULL
     AND char_length(v_candidate.home_venue) > 120 THEN
    RAISE EXCEPTION 'Home venue must be 120 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.entry_type IS NOT NULL
     AND v_candidate.entry_type NOT IN ('state_association', 'direct_entry') THEN
    RAISE EXCEPTION 'Invalid entry type.' USING ERRCODE = '22023';
  END IF;
  IF v_candidate.format NOT IN ('team', 'doubles', 'triples') THEN
    RAISE EXCEPTION 'Invalid team format.' USING ERRCODE = '22023';
  END IF;
  IF v_candidate.status NOT IN ('draft', 'pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid team status.' USING ERRCODE = '22023';
  END IF;
  IF v_candidate.status = 'rejected'
     AND nullif(btrim(v_candidate.rejection_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A rejected team requires a rejection reason.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.colour IS NOT NULL
     AND v_candidate.colour !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Invalid team colour.' USING ERRCODE = '22023';
  END IF;
  IF v_candidate.captain_id IS NULL THEN
    RAISE EXCEPTION 'A captain is required.' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'review' THEN
    IF v_candidate.status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Review status must be approved or rejected.'
        USING ERRCODE = '22023';
    END IF;
    IF v_candidate.status = 'rejected'
       AND nullif(btrim(v_candidate.rejection_reason), '') IS NULL THEN
      RAISE EXCEPTION 'A reason is required to reject a team.'
        USING ERRCODE = '22023';
    END IF;
    IF v_candidate.status = 'approved' THEN
      v_candidate.rejection_reason := NULL;
    END IF;
  END IF;

  v_roster_changed :=
    v_candidate.captain_id IS DISTINCT FROM v_team.captain_id
    OR v_candidate.manager_id IS DISTINCT FROM v_team.manager_id
    OR v_candidate.status IS DISTINCT FROM v_team.status
    OR v_candidate.format IS DISTINCT FROM v_team.format
    OR v_candidate.entry_type IS DISTINCT FROM v_team.entry_type;
  IF v_roster_changed AND (
    v_event.status <> 'open'
    OR (v_event.reg_open_date IS NOT NULL AND clock_timestamp() < v_event.reg_open_date)
    OR (v_event.reg_close_date IS NOT NULL AND clock_timestamp() >= v_event.reg_close_date)
    OR (v_event.event_starts_at IS NOT NULL AND clock_timestamp() >= v_event.event_starts_at)
  ) THEN
    RAISE EXCEPTION 'Roster, status, and format changes require an open event.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1 FROM public.profiles profile
   WHERE profile.id = v_candidate.captain_id
     AND NOT coalesce(profile.suspended, false)
     AND NOT coalesce(profile.is_placeholder, false)
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The captain must have an active player profile.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_candidate_registration
    FROM public.zltac_registrations registration
   WHERE registration.user_id = v_candidate.captain_id
     AND registration.year = v_event.year
     AND registration.status IN ('pending', 'confirmed')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The captain must have an active registration for this event.'
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.teams other_team
     WHERE other_team.event_id = v_event.id
       AND other_team.id <> v_team.id
       AND (other_team.captain_id = v_candidate.captain_id
            OR other_team.manager_id = v_candidate.captain_id)
  ) THEN
    RAISE EXCEPTION 'The new captain already leads another team for this event.'
      USING ERRCODE = '23505';
  END IF;

  IF v_candidate.manager_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles profile
     WHERE profile.id = v_candidate.manager_id
       AND NOT coalesce(profile.suspended, false)
       AND NOT coalesce(profile.is_placeholder, false)
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The manager must have an active profile.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.teams SET
    name = v_candidate.name,
    state = v_candidate.state,
    home_venue = v_candidate.home_venue,
    entry_type = v_candidate.entry_type,
    format = v_candidate.format,
    colour = v_candidate.colour,
    logo_url = v_candidate.logo_url,
    manager_id = v_candidate.manager_id,
    captain_id = v_candidate.captain_id,
    status = v_candidate.status,
    rejection_reason = v_candidate.rejection_reason
  WHERE id = v_team.id
  RETURNING * INTO v_saved;

  IF v_candidate.captain_id IS DISTINCT FROM v_team.captain_id THEN
    -- Move the new captain's official registration and roster membership in
    -- the same transaction. Any capacity/integrity failure rolls back the
    -- team update as well.
    UPDATE public.zltac_registrations
       SET team_id = v_team.id
     WHERE id = v_candidate_registration.id;

    DELETE FROM public.team_members member
    USING public.teams event_team
    WHERE member.team_id = event_team.id
      AND event_team.event_id = v_event.id
      AND member.user_id = v_candidate.captain_id
      AND member.team_id <> v_team.id;

    UPDATE public.team_members
       SET roles = array_remove(roles, 'captain')
     WHERE team_id = v_team.id
       AND user_id = v_team.captain_id;
    DELETE FROM public.team_members
     WHERE team_id = v_team.id
       AND user_id = v_team.captain_id
       AND cardinality(roles) = 0;

    PERFORM public.recalculate_zltac_amount_owing(v_candidate_registration.id);
  END IF;

  IF v_candidate.manager_id IS DISTINCT FROM v_team.manager_id
     AND v_team.manager_id IS NOT NULL THEN
    UPDATE public.team_members
       SET roles = array_remove(roles, 'manager')
     WHERE team_id = v_team.id
       AND user_id = v_team.manager_id;
    DELETE FROM public.team_members
     WHERE team_id = v_team.id
       AND user_id = v_team.manager_id
       AND cardinality(roles) = 0;
  END IF;

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, responded_at
  ) VALUES (
    v_team.id,
    v_candidate.captain_id,
    ARRAY['captain', 'player']::text[]
      || CASE WHEN v_candidate.manager_id = v_candidate.captain_id
              THEN ARRAY['manager']::text[] ELSE ARRAY[]::text[] END,
    'accepted',
    clock_timestamp()
  )
  ON CONFLICT (team_id, user_id) DO UPDATE SET
    roles = ARRAY(
      SELECT DISTINCT role_name
      FROM unnest(
        public.team_members.roles
        || ARRAY['captain', 'player']::text[]
        || CASE WHEN v_candidate.manager_id = v_candidate.captain_id
                THEN ARRAY['manager']::text[] ELSE ARRAY[]::text[] END
      ) AS role_name
    ),
    invite_status = 'accepted',
    responded_at = EXCLUDED.responded_at;

  IF v_candidate.manager_id IS NOT NULL
     AND v_candidate.manager_id <> v_candidate.captain_id THEN
    INSERT INTO public.team_members (
      team_id, user_id, roles, invite_status, responded_at
    ) VALUES (
      v_team.id, v_candidate.manager_id, ARRAY['manager']::text[],
      'accepted', clock_timestamp()
    )
    ON CONFLICT (team_id, user_id) DO UPDATE SET
      roles = ARRAY(
        SELECT DISTINCT role_name
        FROM unnest(public.team_members.roles || ARRAY['manager']::text[]) AS role_name
      ),
      invite_status = 'accepted',
      responded_at = EXCLUDED.responded_at;
  END IF;

  RETURN to_jsonb(v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.committee_update_zltac_team(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.committee_update_zltac_team(uuid, uuid, jsonb, text)
  TO service_role;

-- Captain presentation edits and team submission used to perform ownership,
-- lifecycle, roster-count, and status writes as separate API statements.
-- Keep those checks under the same event lock as every roster mutation.
CREATE OR REPLACE FUNCTION public.captain_mutate_zltac_team(
  p_actor_id uuid,
  p_team_id uuid,
  p_event_id uuid,
  p_action text,
  p_changes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_candidate public.teams%ROWTYPE;
  v_saved public.teams%ROWTYPE;
  v_roster_count integer;
  v_unknown_key text;
  v_identity_changed boolean;
BEGIN
  IF p_actor_id IS NULL OR p_team_id IS NULL OR p_event_id IS NULL
     OR p_action NOT IN ('settings', 'submit') THEN
    RAISE EXCEPTION 'actor_id, team_id, event_id, and a valid action are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'Team changes must be a JSON object.' USING ERRCODE = '22023';
  END IF;

  -- The event id is part of the signed-in captain's request contract, so it
  -- can be locked before the team. A mismatched team is rejected after this
  -- canonical first lock rather than reversing lock order.
  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status <> 'open'
     OR (v_event.reg_open_date IS NOT NULL AND clock_timestamp() < v_event.reg_open_date)
     OR (v_event.reg_close_date IS NOT NULL AND clock_timestamp() >= v_event.reg_close_date)
     OR (v_event.event_starts_at IS NOT NULL AND clock_timestamp() >= v_event.event_starts_at) THEN
    RAISE EXCEPTION 'Registration is not open for this event.' USING ERRCODE = '55000';
  END IF;

  PERFORM 1 FROM public.profiles profile
   WHERE profile.id = p_actor_id
     AND NOT coalesce(profile.suspended, false)
     AND NOT coalesce(profile.is_placeholder, false)
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active captain account is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_team
    FROM public.teams
   WHERE id = p_team_id
     AND event_id = v_event.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found for event.' USING ERRCODE = 'P0002';
  END IF;
  IF v_team.captain_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Only the team captain can change this team.'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the canonical roster and membership rows before either checking or
  -- changing status. Concurrent add/remove operations use the same event lock.
  PERFORM 1 FROM public.zltac_registrations registration
   WHERE registration.year = v_event.year
     AND registration.team_id = v_team.id
   ORDER BY registration.id
   FOR UPDATE;
  PERFORM 1 FROM public.team_members member
   WHERE member.team_id = v_team.id
   ORDER BY member.id
   FOR UPDATE;

  IF p_action = 'settings' THEN
    IF p_changes = '{}'::jsonb THEN
      RAISE EXCEPTION 'No editable team fields supplied.' USING ERRCODE = '22023';
    END IF;
    SELECT key INTO v_unknown_key
      FROM jsonb_object_keys(p_changes) AS input(key)
     WHERE key NOT IN ('name', 'state', 'home_venue', 'colour', 'logo_url')
     LIMIT 1;
    IF v_unknown_key IS NOT NULL THEN
      RAISE EXCEPTION 'Unsupported captain team field: %', v_unknown_key
        USING ERRCODE = '22023';
    END IF;

    v_candidate := jsonb_populate_record(v_team, p_changes);
    v_candidate.id := v_team.id;
    v_candidate.event_id := v_team.event_id;
    v_candidate.competition_id := v_team.competition_id;
    v_candidate.captain_id := v_team.captain_id;
    v_candidate.manager_id := v_team.manager_id;
    v_candidate.status := v_team.status;
    v_candidate.format := v_team.format;
    v_candidate.entry_type := v_team.entry_type;
    v_candidate.rejection_reason := v_team.rejection_reason;
    v_candidate.created_at := v_team.created_at;

    v_candidate.name := btrim(v_candidate.name);
    v_candidate.state := btrim(v_candidate.state);
    v_candidate.home_venue := nullif(btrim(v_candidate.home_venue), '');
    v_candidate.colour := nullif(btrim(v_candidate.colour), '');
    v_candidate.logo_url := nullif(btrim(v_candidate.logo_url), '');
    IF nullif(v_candidate.name, '') IS NULL OR char_length(v_candidate.name) > 80 THEN
      RAISE EXCEPTION 'Team name is required and must be 80 characters or fewer.'
        USING ERRCODE = '22023';
    END IF;
    IF v_candidate.state NOT IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ') THEN
      RAISE EXCEPTION 'A valid team state is required.' USING ERRCODE = '22023';
    END IF;
    IF v_candidate.home_venue IS NOT NULL
       AND char_length(v_candidate.home_venue) > 120 THEN
      RAISE EXCEPTION 'Home venue must be 120 characters or fewer.'
        USING ERRCODE = '22023';
    END IF;
    IF v_candidate.colour IS NOT NULL
       AND v_candidate.colour !~ '^#[0-9A-Fa-f]{6}$' THEN
      RAISE EXCEPTION 'Invalid team colour.' USING ERRCODE = '22023';
    END IF;

    v_identity_changed := v_candidate.name IS DISTINCT FROM v_team.name
      OR v_candidate.state IS DISTINCT FROM v_team.state
      OR v_candidate.home_venue IS DISTINCT FROM v_team.home_venue;
    IF v_team.status IN ('pending', 'approved') AND v_identity_changed THEN
      RAISE EXCEPTION
        'Team name, state, and home venue are locked after submission. Colour and logo may still be updated while registration is open.'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.teams SET
      name = v_candidate.name,
      state = v_candidate.state,
      home_venue = v_candidate.home_venue,
      colour = v_candidate.colour,
      logo_url = v_candidate.logo_url
    WHERE id = v_team.id
    RETURNING * INTO v_saved;

    RETURN jsonb_build_object('team', to_jsonb(v_saved));
  END IF;

  IF p_changes <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Submit does not accept editable fields.' USING ERRCODE = '22023';
  END IF;
  IF v_team.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Team is already % and cannot be submitted again.', v_team.status
      USING ERRCODE = '55000';
  END IF;

  -- Every official roster row must represent an active profile and must have
  -- exactly the corresponding accepted player membership. Conversely, an
  -- accepted player membership may not float without its registration link.
  IF EXISTS (
    SELECT 1
      FROM public.zltac_registrations registration
      LEFT JOIN public.profiles profile ON profile.id = registration.user_id
     WHERE registration.team_id = v_team.id
       AND registration.year = v_event.year
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
     WHERE registration.team_id = v_team.id
       AND registration.year = v_event.year
       AND NOT EXISTS (
         SELECT 1 FROM public.team_members member
          WHERE member.team_id = v_team.id
            AND member.user_id = registration.user_id
            AND member.invite_status = 'accepted'
            AND 'player' = ANY(member.roles)
       )
  ) OR EXISTS (
    SELECT 1
      FROM public.team_members member
     WHERE member.team_id = v_team.id
       AND member.invite_status = 'accepted'
       AND 'player' = ANY(member.roles)
       AND NOT EXISTS (
         SELECT 1 FROM public.zltac_registrations registration
          WHERE registration.team_id = v_team.id
            AND registration.year = v_event.year
            AND registration.user_id = member.user_id
            AND registration.status IN ('pending', 'confirmed')
       )
  ) THEN
    RAISE EXCEPTION 'Team membership and registration roster are inconsistent.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members member
     WHERE member.team_id = v_team.id
       AND member.user_id = p_actor_id
       AND member.invite_status = 'accepted'
       AND 'captain' = ANY(member.roles)
       AND 'player' = ANY(member.roles)
  ) THEN
    RAISE EXCEPTION 'Captain membership is missing or inconsistent.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_roster_count
    FROM public.zltac_registrations registration
    JOIN public.profiles profile ON profile.id = registration.user_id
   WHERE registration.team_id = v_team.id
     AND registration.year = v_event.year
     AND registration.status IN ('pending', 'confirmed')
     AND NOT coalesce(profile.suspended, false)
     AND NOT coalesce(profile.is_placeholder, false);
  IF v_roster_count < 5 THEN
    RAISE EXCEPTION 'A team needs at least 5 eligible players to submit (currently %).',
      v_roster_count USING ERRCODE = '22023';
  END IF;

  UPDATE public.teams
     SET status = 'pending', rejection_reason = NULL
   WHERE id = v_team.id
   RETURNING * INTO v_saved;

  RETURN jsonb_build_object(
    'status', v_saved.status,
    'count', v_roster_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_mutate_zltac_team(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captain_mutate_zltac_team(uuid, uuid, uuid, text, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Competition configuration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_competition_config(
  p_actor_id uuid,
  p_competition_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_competition public.competitions%ROWTYPE;
  v_candidate public.competitions%ROWTYPE;
  v_saved public.competitions%ROWTYPE;
  v_actor_roles text[];
  v_is_superadmin boolean;
  v_has_registrations boolean;
  v_is_closed boolean;
  v_locked_changed boolean;
  v_unknown_key text;
BEGIN
  IF p_actor_id IS NULL OR p_competition_id IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'actor_id, competition_id, and non-empty changes are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_competition
    FROM public.competitions
   WHERE id = p_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competition.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived competitions are immutable.' USING ERRCODE = '55000';
  END IF;

  SELECT profile.roles INTO v_actor_roles
    FROM public.profiles profile
   WHERE profile.id = p_actor_id
     AND NOT coalesce(profile.suspended, false)
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active account is required.' USING ERRCODE = '42501';
  END IF;
  v_is_superadmin := 'superadmin' = ANY(v_actor_roles);

  IF NOT v_is_superadmin THEN
    PERFORM 1 FROM public.competition_managers manager
     WHERE manager.competition_id = p_competition_id
       AND manager.user_id = p_actor_id
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not authorised to edit this competition.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT key INTO v_unknown_key
    FROM jsonb_object_keys(p_changes) AS input(key)
   WHERE NOT (key = ANY(ARRAY[
     'name', 'start_date', 'end_date', 'registration_open_at',
     'registration_close_at', 'price_per_player', 'bank_account_name',
     'bank_bsb', 'bank_account_number', 'payment_info_visible', 'archived_at',
     'description', 'links', 'banner_url', 'abbreviation'
   ]::text[]))
   LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported competition field: %', v_unknown_key
      USING ERRCODE = '22023';
  END IF;

  IF p_changes ? 'archived_at' THEN
    IF NOT v_is_superadmin THEN
      RAISE EXCEPTION 'Only superadmins can archive a competition.'
        USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p_changes)) <> 1
       OR p_changes->'archived_at' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Archive must be a standalone, one-way operation.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.competitions
       SET archived_at = clock_timestamp()
     WHERE id = p_competition_id
     RETURNING * INTO v_saved;
    RETURN to_jsonb(v_saved);
  END IF;

  v_candidate := jsonb_populate_record(v_competition, p_changes);
  v_candidate.id := v_competition.id;
  v_candidate.slug := v_competition.slug;
  v_candidate.created_by := v_competition.created_by;
  v_candidate.created_at := v_competition.created_at;
  v_candidate.archived_at := v_competition.archived_at;
  v_candidate.name := btrim(v_candidate.name);
  IF v_candidate.abbreviation IS NOT NULL THEN
    v_candidate.abbreviation := upper(nullif(btrim(v_candidate.abbreviation), ''));
  END IF;
  IF v_candidate.banner_url IS NOT NULL THEN
    v_candidate.banner_url := nullif(btrim(v_candidate.banner_url), '');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.competition_registrations registration
     WHERE registration.competition_id = p_competition_id
  ) INTO v_has_registrations;
  v_is_closed :=
    (v_competition.registration_close_at IS NOT NULL
     AND clock_timestamp() >= v_competition.registration_close_at)
    OR current_date > v_competition.end_date;

  v_locked_changed :=
    v_candidate.registration_open_at IS DISTINCT FROM v_competition.registration_open_at
    OR v_candidate.registration_close_at IS DISTINCT FROM v_competition.registration_close_at
    OR v_candidate.price_per_player IS DISTINCT FROM v_competition.price_per_player
    OR v_candidate.bank_account_name IS DISTINCT FROM v_competition.bank_account_name
    OR v_candidate.bank_bsb IS DISTINCT FROM v_competition.bank_bsb
    OR v_candidate.bank_account_number IS DISTINCT FROM v_competition.bank_account_number
    OR v_candidate.payment_info_visible IS DISTINCT FROM v_competition.payment_info_visible
    OR v_candidate.abbreviation IS DISTINCT FROM v_competition.abbreviation;
  IF (v_has_registrations OR v_is_closed) AND v_locked_changed THEN
    RAISE EXCEPTION
      'Registration windows, price, payment settings, and abbreviation are frozen once registrations exist or registration closes.'
      USING ERRCODE = '55000';
  END IF;

  IF nullif(v_candidate.name, '') IS NULL OR char_length(v_candidate.name) > 200 THEN
    RAISE EXCEPTION 'Competition name is required and must be 200 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.end_date < v_candidate.start_date THEN
    RAISE EXCEPTION 'end_date must be on or after start_date.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.registration_open_at IS NOT NULL
     AND v_candidate.registration_close_at IS NOT NULL
     AND v_candidate.registration_close_at < v_candidate.registration_open_at THEN
    RAISE EXCEPTION 'registration_close_at must be on or after registration_open_at.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.price_per_player IS NOT NULL AND v_candidate.price_per_player < 0 THEN
    RAISE EXCEPTION 'price_per_player must be non-negative cents.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.abbreviation IS NOT NULL
     AND v_candidate.abbreviation !~ '^[A-Z0-9]{2,8}$' THEN
    RAISE EXCEPTION 'abbreviation must be 2 to 8 uppercase letters or digits.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.competitions SET
    name = v_candidate.name,
    start_date = v_candidate.start_date,
    end_date = v_candidate.end_date,
    registration_open_at = v_candidate.registration_open_at,
    registration_close_at = v_candidate.registration_close_at,
    price_per_player = v_candidate.price_per_player,
    bank_account_name = v_candidate.bank_account_name,
    bank_bsb = v_candidate.bank_bsb,
    bank_account_number = v_candidate.bank_account_number,
    payment_info_visible = v_candidate.payment_info_visible,
    abbreviation = v_candidate.abbreviation,
    description = v_candidate.description,
    links = v_candidate.links,
    banner_url = v_candidate.banner_url
  WHERE id = p_competition_id
  RETURNING * INTO v_saved;

  RETURN to_jsonb(v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.update_competition_config(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_competition_config(uuid, uuid, jsonb)
  TO service_role;

-- Authenticated browsers use the masked public view or server APIs. A
-- table-level grant exposes bank instructions regardless of column-level RLS.
REVOKE SELECT ON TABLE public.competitions FROM authenticated;

-- Public roster surfaces must immediately hide suspended accounts. Keep the
-- established columns and grants so this remains migration-first deployable.
CREATE OR REPLACE VIEW public.public_zltac_teams
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  team.id,
  team.event_id,
  team.name,
  team.status,
  team.logo_url,
  captain.alias AS captain_alias,
  captain.state AS captain_state
FROM public.teams AS team
JOIN public.zltac_events AS event ON event.id = team.event_id
LEFT JOIN public.profiles AS captain
  ON captain.id = team.captain_id
 AND NOT coalesce(captain.suspended, false)
WHERE team.status = 'approved'
  AND event.status IN ('open', 'closed', 'archived');

CREATE OR REPLACE VIEW public.public_event_roster
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  registration.team_id,
  registration.year,
  registration.side_events,
  profile.alias,
  profile.state
FROM public.zltac_registrations AS registration
JOIN public.profiles AS profile
  ON profile.id = registration.user_id
 AND NOT coalesce(profile.suspended, false)
JOIN public.zltac_events AS event ON event.year = registration.year
LEFT JOIN public.teams AS team
  ON team.id = registration.team_id
 AND team.event_id = event.id
 AND team.status = 'approved'
WHERE event.status IN ('open', 'closed', 'archived')
  AND registration.status <> 'cancelled'
  AND (registration.team_id IS NULL OR team.id IS NOT NULL);

CREATE OR REPLACE VIEW public.public_competition_roster_safe
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  competition.id AS competition_id,
  competition.slug AS competition_slug,
  team.id AS team_id,
  team.name AS team_name,
  team.colour AS team_colour,
  profile.alias,
  CASE
    WHEN member.roles @> ARRAY['captain']::text[] THEN 'captain'
    WHEN member.id IS NOT NULL THEN 'player'
    ELSE NULL
  END AS role_in_team
FROM public.competition_registrations AS registration
JOIN public.competitions AS competition
  ON competition.id = registration.competition_id
JOIN public.profiles AS profile
  ON profile.id = registration.user_id
 AND NOT coalesce(profile.suspended, false)
LEFT JOIN public.team_members AS member
  ON member.user_id = registration.user_id
 AND member.team_id = registration.team_id
 AND member.invite_status = 'accepted'
LEFT JOIN public.teams AS team
  ON team.id = registration.team_id
 AND team.competition_id = competition.id
 AND team.status = 'approved'
WHERE competition.archived_at IS NULL
  AND (
    competition.registration_close_at IS NULL
    OR competition.registration_close_at > pg_catalog.now()
  )
  AND (registration.team_id IS NULL OR team.id IS NOT NULL);

REVOKE ALL ON public.public_zltac_teams, public.public_event_roster,
  public.public_competition_roster_safe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_zltac_teams, public.public_event_roster,
  public.public_competition_roster_safe TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.committee_save_zltac_event(uuid, uuid, jsonb) IS
  'Service-only, lifecycle-locked creation and configuration of ZLTAC events.';
COMMENT ON FUNCTION public.committee_update_zltac_team(uuid, uuid, jsonb, text) IS
  'Service-only, event-first committee ZLTAC team update with roster reconciliation.';
COMMENT ON FUNCTION public.captain_mutate_zltac_team(uuid, uuid, uuid, text, jsonb) IS
  'Service-only, event-first captain presentation and submission workflow.';
COMMENT ON FUNCTION public.update_competition_config(uuid, uuid, jsonb) IS
  'Service-only, competition-locked manager configuration update.';
COMMENT ON VIEW public.public_event_roster IS
  'Alias-only public ZLTAC roster; excludes cancelled, suspended, and unapproved participants.';
COMMENT ON VIEW public.public_competition_roster_safe IS
  'Alias-only approved competition roster excluding suspended profiles.';

COMMIT;
