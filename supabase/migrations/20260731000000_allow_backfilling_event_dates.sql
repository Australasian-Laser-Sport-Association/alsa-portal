-- Allow an unset ZLTAC event date to be filled in after registrations exist.
--
-- Problem
-- -------
-- committee_save_zltac_event() treats start_date and end_date as "critical" and
-- freezes them once any registration or team exists, or once the event closes.
-- Freezing a date that was never set is a trap rather than a protection: an
-- event opened without dates can never be given them, and there is no in-app
-- way out.
--
-- The knock-on is worse than a missing label. under18Requirement() needs an
-- event date to compute age at event. With no date it returns
-- 'missing_or_invalid_event_date', so EVERY player on the roster - adults
-- included - is reported as failing the under-18 and identity checks and can
-- never become event-ready.
--
-- Fix
-- ---
-- Treat start_date/end_date as critical only when a value already exists.
-- NULL -> value is a backfill and stays permitted; value -> anything (including
-- back to NULL) remains frozen. Every other critical field is unchanged, and
-- the actor still has to pass _assert_zltac_committee_actor().
--
-- This is a whole-function replacement because PostgreSQL has no partial
-- function patch. Only the two start_date/end_date lines of v_critical_changed
-- differ from 20260713058000_config_and_roster_integrity.sql.

BEGIN;

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
      -- Backfilling a date that was never set is permitted; changing or
      -- clearing one that already exists is not.
      OR (v_event.start_date IS NOT NULL
          AND v_candidate.start_date IS DISTINCT FROM v_event.start_date)
      OR (v_event.end_date IS NOT NULL
          AND v_candidate.end_date IS DISTINCT FROM v_event.end_date)
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
        'Pricing, requirements, capacity, side events, and registration windows are frozen once registrations exist or the event closes. Event dates may still be filled in if they were never set.'
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

COMMIT;

-- =============================================================================
-- ROLLBACK (commented out - re-apply the prior definition to revert)
-- =============================================================================
-- Re-run the committee_save_zltac_event() body from
-- 20260713058000_config_and_roster_integrity.sql, which treats start_date and
-- end_date as unconditionally critical.
