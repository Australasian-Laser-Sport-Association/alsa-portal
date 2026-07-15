-- Wave B: make player-managed ZLTAC doubles and triples rosters atomic.
--
-- The API calls these SECURITY DEFINER functions with the authenticated user
-- id after verifying the bearer token. Browser roles cannot execute them.
-- Every operation is one database transaction and locks the event, roster,
-- and registration rows before validating or changing state.

BEGIN;

-- Refuse to install the cross-position guard over ambiguous live data. This is
-- intentionally fail-closed: duplicate members must be reconciled explicitly
-- before the release migration can proceed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT event_year, member_id, count(*) AS appearances
      FROM (
        SELECT event_year, player1_id AS member_id FROM public.doubles_pairs
        UNION ALL
        SELECT event_year, player2_id AS member_id FROM public.doubles_pairs
      ) members
      WHERE member_id IS NOT NULL
      GROUP BY event_year, member_id
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Duplicate doubles participants exist across roster positions. Reconcile them before applying this migration.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT event_year, member_id, count(*) AS appearances
      FROM (
        SELECT event_year, player1_id AS member_id FROM public.triples_teams
        UNION ALL
        SELECT event_year, player2_id AS member_id FROM public.triples_teams
        UNION ALL
        SELECT event_year, player3_id AS member_id FROM public.triples_teams
      ) members
      WHERE member_id IS NOT NULL
      GROUP BY event_year, member_id
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Duplicate triples participants exist across roster positions. Reconcile them before applying this migration.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.doubles_pairs
    WHERE confirmed
      AND (player1_id IS NULL OR player2_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'A confirmed doubles pair has a missing participant. Reconcile it before applying this migration.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.triples_teams
    WHERE (player2_confirmed AND player2_id IS NULL)
       OR (player3_confirmed AND player3_id IS NULL)
       OR (
         confirmed
         AND (
           player1_id IS NULL
           OR player2_id IS NULL
           OR player3_id IS NULL
           OR NOT player2_confirmed
           OR NOT player3_confirmed
         )
       )
  ) THEN
    RAISE EXCEPTION 'A triples team has incoherent confirmation state. Reconcile it before applying this migration.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- PostgreSQL cannot express uniqueness across several nullable player columns
-- with a normal UNIQUE constraint. A trigger takes deterministic transaction
-- advisory locks for every (format, year, member), then checks all positions.
-- This protects concurrent RPC calls and any future trusted direct-table path.
CREATE OR REPLACE FUNCTION public.enforce_side_event_roster_unique_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member uuid;
  v_members uuid[];
BEGIN
  IF TG_TABLE_NAME = 'doubles_pairs' THEN
    v_members := ARRAY[NEW.player1_id, NEW.player2_id]::uuid[];
  ELSIF TG_TABLE_NAME = 'triples_teams' THEN
    v_members := ARRAY[NEW.player1_id, NEW.player2_id, NEW.player3_id]::uuid[];
  ELSE
    RAISE EXCEPTION 'Unsupported side-event roster table'
      USING ERRCODE = '55000';
  END IF;

  FOR v_member IN
    SELECT DISTINCT member_id
    FROM unnest(v_members) AS members(member_id)
    WHERE member_id IS NOT NULL
    ORDER BY member_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        format('zltac-side-roster:%s:%s:%s', TG_TABLE_NAME, NEW.event_year, v_member),
        0
      )
    );

    IF TG_TABLE_NAME = 'doubles_pairs' AND EXISTS (
      SELECT 1
      FROM public.doubles_pairs roster
      WHERE roster.event_year = NEW.event_year
        AND roster.id IS DISTINCT FROM NEW.id
        AND v_member IN (roster.player1_id, roster.player2_id)
    ) THEN
      RAISE EXCEPTION 'Player is already assigned to a doubles pair for this event year.'
        USING ERRCODE = '23505';
    END IF;

    IF TG_TABLE_NAME = 'triples_teams' AND EXISTS (
      SELECT 1
      FROM public.triples_teams roster
      WHERE roster.event_year = NEW.event_year
        AND roster.id IS DISTINCT FROM NEW.id
        AND v_member IN (roster.player1_id, roster.player2_id, roster.player3_id)
    ) THEN
      RAISE EXCEPTION 'Player is already assigned to a triples team for this event year.'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.enforce_side_event_roster_unique_member()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.enforce_side_event_roster_unique_member()
  TO service_role;

DROP TRIGGER IF EXISTS doubles_pairs_unique_member_all_positions
  ON public.doubles_pairs;
CREATE TRIGGER doubles_pairs_unique_member_all_positions
  BEFORE INSERT OR UPDATE OF event_year, player1_id, player2_id
  ON public.doubles_pairs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_side_event_roster_unique_member();

DROP TRIGGER IF EXISTS triples_teams_unique_member_all_positions
  ON public.triples_teams;
CREATE TRIGGER triples_teams_unique_member_all_positions
  BEFORE INSERT OR UPDATE OF event_year, player1_id, player2_id, player3_id
  ON public.triples_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_side_event_roster_unique_member();

-- Confirmation coherence is a durable database invariant, not only an RPC
-- precheck. The migration preflight above gives a specific remediation error.
ALTER TABLE public.doubles_pairs
  DROP CONSTRAINT IF EXISTS doubles_pairs_confirmation_coherent;
ALTER TABLE public.doubles_pairs
  ADD CONSTRAINT doubles_pairs_confirmation_coherent
  CHECK (
    NOT confirmed
    OR (player1_id IS NOT NULL AND player2_id IS NOT NULL)
  );

ALTER TABLE public.triples_teams
  DROP CONSTRAINT IF EXISTS triples_teams_confirmation_coherent;
ALTER TABLE public.triples_teams
  ADD CONSTRAINT triples_teams_confirmation_coherent
  CHECK (
    (NOT player2_confirmed OR player2_id IS NOT NULL)
    AND (NOT player3_confirmed OR player3_id IS NOT NULL)
    AND (
      NOT confirmed
      OR (
        player1_id IS NOT NULL
        AND player2_id IS NOT NULL
        AND player3_id IS NOT NULL
        AND player2_confirmed
        AND player3_confirmed
      )
    )
  );

-- A normalized reservation row gives PostgreSQL a real UNIQUE key across all
-- nullable roster positions. The BEFORE trigger above provides an early,
-- readable conflict; this table is the race-proof invariant when concurrent
-- statements began with snapshots taken before either roster existed.
CREATE TABLE public.zltac_side_event_roster_members (
  format text NOT NULL CHECK (format IN ('doubles', 'triples')),
  event_year integer NOT NULL
    REFERENCES public.zltac_events(year) ON DELETE CASCADE,
  member_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  roster_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  PRIMARY KEY (format, event_year, member_id),
  UNIQUE (format, roster_id, slot)
);

ALTER TABLE public.zltac_side_event_roster_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES
  ON TABLE public.zltac_side_event_roster_members
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.zltac_side_event_roster_members
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_zltac_side_event_roster_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_format text;
  v_roster_id uuid;
BEGIN
  v_format := CASE TG_TABLE_NAME
    WHEN 'doubles_pairs' THEN 'doubles'
    WHEN 'triples_teams' THEN 'triples'
    ELSE NULL
  END;
  IF v_format IS NULL THEN
    RAISE EXCEPTION 'Unsupported side-event roster table.'
      USING ERRCODE = '55000';
  END IF;

  v_roster_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  DELETE FROM public.zltac_side_event_roster_members
   WHERE format = v_format
     AND roster_id = v_roster_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'doubles_pairs' THEN
    INSERT INTO public.zltac_side_event_roster_members (
      format, event_year, member_id, roster_id, slot
    )
    SELECT 'doubles', NEW.event_year, member_id, NEW.id, slot
    FROM (
      VALUES
        (NEW.player1_id, 1::smallint),
        (NEW.player2_id, 2::smallint)
    ) AS members(member_id, slot)
    WHERE member_id IS NOT NULL;
  ELSE
    INSERT INTO public.zltac_side_event_roster_members (
      format, event_year, member_id, roster_id, slot
    )
    SELECT 'triples', NEW.event_year, member_id, NEW.id, slot
    FROM (
      VALUES
        (NEW.player1_id, 1::smallint),
        (NEW.player2_id, 2::smallint),
        (NEW.player3_id, 3::smallint)
    ) AS members(member_id, slot)
    WHERE member_id IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.sync_zltac_side_event_roster_members()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.sync_zltac_side_event_roster_members()
  TO service_role;

CREATE TRIGGER doubles_pairs_sync_normalized_members
  AFTER INSERT OR UPDATE OF event_year, player1_id, player2_id OR DELETE
  ON public.doubles_pairs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_zltac_side_event_roster_members();

CREATE TRIGGER triples_teams_sync_normalized_members
  AFTER INSERT OR UPDATE OF event_year, player1_id, player2_id, player3_id OR DELETE
  ON public.triples_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_zltac_side_event_roster_members();

INSERT INTO public.zltac_side_event_roster_members (
  format, event_year, member_id, roster_id, slot
)
SELECT 'doubles', pair.event_year, members.member_id, pair.id, members.slot
FROM public.doubles_pairs pair
CROSS JOIN LATERAL (
  VALUES
    (pair.player1_id, 1::smallint),
    (pair.player2_id, 2::smallint)
) AS members(member_id, slot)
WHERE members.member_id IS NOT NULL;

INSERT INTO public.zltac_side_event_roster_members (
  format, event_year, member_id, roster_id, slot
)
SELECT 'triples', team.event_year, members.member_id, team.id, members.slot
FROM public.triples_teams team
CROSS JOIN LATERAL (
  VALUES
    (team.player1_id, 1::smallint),
    (team.player2_id, 2::smallint),
    (team.player3_id, 3::smallint)
) AS members(member_id, slot)
WHERE members.member_id IS NOT NULL;

-- Lock and validate the shared event/registration context. Registrations are
-- locked in UUID order so two requests with the same players cannot deadlock.
CREATE OR REPLACE FUNCTION public._lock_zltac_side_event_context(
  p_event_year integer,
  p_slug text,
  p_participants uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_participants uuid[];
  v_eligible_count integer;
BEGIN
  IF p_event_year IS NULL
     OR p_slug IS NULL
     OR p_slug NOT IN ('doubles', 'triples') THEN
    RAISE EXCEPTION 'A valid event year and side-event format are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT member_id ORDER BY member_id)
    INTO v_participants
    FROM unnest(coalesce(p_participants, ARRAY[]::uuid[])) AS members(member_id)
   WHERE member_id IS NOT NULL;

  IF coalesce(cardinality(v_participants), 0) = 0 THEN
    RAISE EXCEPTION 'At least one participant is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_event
    FROM public.zltac_events
   WHERE year = p_event_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event.status <> 'open'
     OR (v_event.reg_open_date IS NOT NULL AND now() < v_event.reg_open_date)
     OR (v_event.reg_close_date IS NOT NULL AND now() >= v_event.reg_close_date)
     OR (v_event.event_starts_at IS NOT NULL AND now() >= v_event.event_starts_at) THEN
    RAISE EXCEPTION 'The event is not open for side-event roster changes.'
      USING ERRCODE = '55000';
  END IF;

  IF jsonb_typeof(coalesce(v_event.side_events, '[]'::jsonb)) <> 'array'
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(coalesce(v_event.side_events, '[]'::jsonb)) = 'array'
             THEN coalesce(v_event.side_events, '[]'::jsonb)
           ELSE '[]'::jsonb
         END
       ) AS side_event(item)
       WHERE side_event.item->>'slug' = p_slug
         AND coalesce((side_event.item->>'enabled')::boolean, false)
     ) THEN
    RAISE EXCEPTION 'The selected side event is not available for this event.'
      USING ERRCODE = '23514';
  END IF;

  -- Lock both registrations and profiles so a concurrent suspension cannot
  -- race a roster mutation. Suspended accounts are never eligible for an
  -- official side-event roster, even when an old registration still exists.
  PERFORM profile.id
    FROM public.profiles profile
   WHERE profile.id = ANY(v_participants)
   ORDER BY profile.id
   FOR KEY SHARE;

  PERFORM registration.id
    FROM public.zltac_registrations registration
   WHERE registration.year = p_event_year
     AND registration.user_id = ANY(v_participants)
   ORDER BY registration.user_id
   FOR UPDATE;

  SELECT count(*)
    INTO v_eligible_count
    FROM public.zltac_registrations registration
    JOIN public.profiles profile
      ON profile.id = registration.user_id
   WHERE registration.year = p_event_year
     AND registration.user_id = ANY(v_participants)
     AND registration.status IN ('pending', 'confirmed')
     AND NOT coalesce(profile.suspended, false);

  IF v_eligible_count <> cardinality(v_participants) THEN
    RAISE EXCEPTION 'Every participant needs an active, non-suspended registration for the exact event year.'
      USING ERRCODE = '23503';
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public._lock_zltac_side_event_context(integer, text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public._lock_zltac_side_event_context(integer, text, uuid[])
  TO service_role;

-- Update the selected side-event slug and price in the same transaction as the
-- roster. Callers keep their slug when changing partners; former other members
-- lose it after a roster is dissolved, matching the existing product contract.
CREATE OR REPLACE FUNCTION public._set_zltac_side_event_membership(
  p_user_id uuid,
  p_event_year integer,
  p_slug text,
  p_selected boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration public.zltac_registrations%ROWTYPE;
  v_new_side_events text[];
BEGIN
  IF p_user_id IS NULL
     OR p_event_year IS NULL
     OR p_slug IS NULL
     OR p_slug NOT IN ('doubles', 'triples')
     OR p_selected IS NULL THEN
    RAISE EXCEPTION 'A valid side-event membership change is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations
   WHERE user_id = p_user_id
     AND year = p_event_year
   FOR UPDATE;
  IF NOT FOUND OR v_registration.status = 'cancelled' THEN
    RAISE EXCEPTION 'Eligible registration not found for side-event member.'
      USING ERRCODE = '23503';
  END IF;

  IF p_selected THEN
    IF p_slug = ANY(coalesce(v_registration.side_events, ARRAY[]::text[])) THEN
      RETURN;
    END IF;
    v_new_side_events := array_append(
      coalesce(v_registration.side_events, ARRAY[]::text[]),
      p_slug
    );
  ELSE
    IF NOT p_slug = ANY(coalesce(v_registration.side_events, ARRAY[]::text[])) THEN
      RETURN;
    END IF;
    v_new_side_events := array_remove(v_registration.side_events, p_slug);
  END IF;

  UPDATE public.zltac_registrations
     SET side_events = v_new_side_events
   WHERE id = v_registration.id;
  PERFORM public.recalculate_zltac_amount_owing(v_registration.id);
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public._set_zltac_side_event_membership(uuid, integer, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public._set_zltac_side_event_membership(uuid, integer, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mutate_zltac_doubles_roster(
  p_user_id uuid,
  p_action text,
  p_event_year integer DEFAULT NULL,
  p_roster_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pair public.doubles_pairs%ROWTYPE;
  v_partner_is_placeholder boolean := false;
  v_other_member uuid;
BEGIN
  IF p_user_id IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('create', 'confirm', 'delete') THEN
    RAISE EXCEPTION 'Invalid doubles roster operation.'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'create' THEN
    IF p_event_year IS NULL OR p_partner_id IS NULL OR p_partner_id = p_user_id THEN
      RAISE EXCEPTION 'Event year and a different partner are required.'
        USING ERRCODE = '22023';
    END IF;

    PERFORM public._lock_zltac_side_event_context(
      p_event_year,
      'doubles',
      ARRAY[p_user_id, p_partner_id]::uuid[]
    );

    SELECT is_placeholder
      INTO v_partner_is_placeholder
      FROM public.profiles
     WHERE id = p_partner_id;

    INSERT INTO public.doubles_pairs (
      event_year, player1_id, player2_id, confirmed
    ) VALUES (
      p_event_year, p_user_id, p_partner_id, coalesce(v_partner_is_placeholder, false)
    )
    RETURNING * INTO v_pair;

    PERFORM public._set_zltac_side_event_membership(
      p_user_id, p_event_year, 'doubles', true
    );
    IF coalesce(v_partner_is_placeholder, false) THEN
      PERFORM public._set_zltac_side_event_membership(
        p_partner_id, p_event_year, 'doubles', true
      );
    END IF;

    RETURN to_jsonb(v_pair);
  END IF;

  IF p_roster_id IS NULL THEN
    RAISE EXCEPTION 'Doubles roster id is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_pair
    FROM public.doubles_pairs
   WHERE id = p_roster_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doubles pair not found.'
      USING ERRCODE = 'P0002';
  END IF;
  IF p_event_year IS NOT NULL AND p_event_year <> v_pair.event_year THEN
    RAISE EXCEPTION 'Doubles pair belongs to a different event year.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public._lock_zltac_side_event_context(
    v_pair.event_year,
    'doubles',
    ARRAY[v_pair.player1_id, v_pair.player2_id]::uuid[]
  );

  IF p_action = 'confirm' THEN
    IF v_pair.player2_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Only the invited doubles partner can confirm.'
        USING ERRCODE = '42501';
    END IF;
    IF v_pair.confirmed THEN
      RETURN to_jsonb(v_pair);
    END IF;

    UPDATE public.doubles_pairs
       SET confirmed = true
     WHERE id = v_pair.id
    RETURNING * INTO v_pair;
    PERFORM public._set_zltac_side_event_membership(
      p_user_id, v_pair.event_year, 'doubles', true
    );
    RETURN to_jsonb(v_pair);
  END IF;

  IF NOT (
    p_user_id = ANY(
      array_remove(ARRAY[v_pair.player1_id, v_pair.player2_id]::uuid[], NULL)
    )
  ) THEN
    RAISE EXCEPTION 'Only a doubles participant can remove the pair.'
      USING ERRCODE = '42501';
  END IF;

  v_other_member := CASE
    WHEN v_pair.player1_id = p_user_id THEN v_pair.player2_id
    ELSE v_pair.player1_id
  END;
  DELETE FROM public.doubles_pairs WHERE id = v_pair.id;
  IF v_other_member IS NOT NULL THEN
    PERFORM public._set_zltac_side_event_membership(
      v_other_member, v_pair.event_year, 'doubles', false
    );
  END IF;

  RETURN jsonb_build_object('deleted', true, 'id', v_pair.id);
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.mutate_zltac_doubles_roster(uuid, text, integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.mutate_zltac_doubles_roster(uuid, text, integer, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mutate_zltac_triples_roster(
  p_user_id uuid,
  p_action text,
  p_event_year integer DEFAULT NULL,
  p_roster_id uuid DEFAULT NULL,
  p_slot integer DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team public.triples_teams%ROWTYPE;
  v_partner_is_placeholder boolean := false;
  v_dropped_member uuid;
  v_other_member uuid;
BEGIN
  IF p_user_id IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('create', 'add-slot', 'confirm', 'clear-slot', 'disband') THEN
    RAISE EXCEPTION 'Invalid triples roster operation.'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'create' THEN
    IF p_event_year IS NULL
       OR p_slot IS NULL
       OR p_slot NOT IN (2, 3)
       OR p_partner_id IS NULL
       OR p_partner_id = p_user_id THEN
      RAISE EXCEPTION 'Event year, slot 2 or 3, and a different partner are required.'
        USING ERRCODE = '22023';
    END IF;

    PERFORM public._lock_zltac_side_event_context(
      p_event_year,
      'triples',
      ARRAY[p_user_id, p_partner_id]::uuid[]
    );
    SELECT is_placeholder
      INTO v_partner_is_placeholder
      FROM public.profiles
     WHERE id = p_partner_id;

    IF p_slot = 2 THEN
      INSERT INTO public.triples_teams (
        event_year, player1_id, player2_id, player3_id,
        player2_confirmed, player3_confirmed, confirmed
      ) VALUES (
        p_event_year, p_user_id, p_partner_id, NULL,
        coalesce(v_partner_is_placeholder, false), false, false
      )
      RETURNING * INTO v_team;
    ELSE
      INSERT INTO public.triples_teams (
        event_year, player1_id, player2_id, player3_id,
        player2_confirmed, player3_confirmed, confirmed
      ) VALUES (
        p_event_year, p_user_id, NULL, p_partner_id,
        false, coalesce(v_partner_is_placeholder, false), false
      )
      RETURNING * INTO v_team;
    END IF;

    PERFORM public._set_zltac_side_event_membership(
      p_user_id, p_event_year, 'triples', true
    );
    IF coalesce(v_partner_is_placeholder, false) THEN
      PERFORM public._set_zltac_side_event_membership(
        p_partner_id, p_event_year, 'triples', true
      );
    END IF;
    RETURN to_jsonb(v_team);
  END IF;

  IF p_roster_id IS NULL THEN
    RAISE EXCEPTION 'Triples roster id is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_team
    FROM public.triples_teams
   WHERE id = p_roster_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Triples team not found.'
      USING ERRCODE = 'P0002';
  END IF;
  IF p_event_year IS NOT NULL AND p_event_year <> v_team.event_year THEN
    RAISE EXCEPTION 'Triples team belongs to a different event year.'
      USING ERRCODE = '23514';
  END IF;

  IF p_action IN ('add-slot', 'clear-slot')
     AND (p_slot IS NULL OR p_slot NOT IN (2, 3)) THEN
    RAISE EXCEPTION 'Triples slot must be 2 or 3.'
      USING ERRCODE = '22023';
  END IF;
  IF p_action = 'confirm'
     AND (p_slot IS NULL OR p_slot NOT IN (2, 3)) THEN
    RAISE EXCEPTION 'Confirmation slot must be 2 or 3.'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'add-slot' THEN
    IF v_team.player1_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Only the triples organiser can add players.'
        USING ERRCODE = '42501';
    END IF;
    IF v_team.confirmed THEN
      RAISE EXCEPTION 'A confirmed triples team is locked.'
        USING ERRCODE = '55000';
    END IF;
    IF p_partner_id IS NULL
       OR p_partner_id = ANY(
         array_remove(
           ARRAY[v_team.player1_id, v_team.player2_id, v_team.player3_id]::uuid[],
           NULL
         )
       ) THEN
      RAISE EXCEPTION 'A different partner is required.'
        USING ERRCODE = '22023';
    END IF;
    IF (p_slot = 2 AND v_team.player2_id IS NOT NULL)
       OR (p_slot = 3 AND v_team.player3_id IS NOT NULL) THEN
      RAISE EXCEPTION 'The requested triples slot is already occupied.'
        USING ERRCODE = '55000';
    END IF;

    PERFORM public._lock_zltac_side_event_context(
      v_team.event_year,
      'triples',
      ARRAY[
        v_team.player1_id,
        v_team.player2_id,
        v_team.player3_id,
        p_partner_id
      ]::uuid[]
    );
    SELECT is_placeholder
      INTO v_partner_is_placeholder
      FROM public.profiles
     WHERE id = p_partner_id;

    IF p_slot = 2 THEN
      UPDATE public.triples_teams
         SET player2_id = p_partner_id,
             player2_confirmed = coalesce(v_partner_is_placeholder, false),
             confirmed = (
               coalesce(v_partner_is_placeholder, false)
               AND player3_id IS NOT NULL
               AND player3_confirmed
             )
       WHERE id = v_team.id
      RETURNING * INTO v_team;
    ELSE
      UPDATE public.triples_teams
         SET player3_id = p_partner_id,
             player3_confirmed = coalesce(v_partner_is_placeholder, false),
             confirmed = (
               coalesce(v_partner_is_placeholder, false)
               AND player2_id IS NOT NULL
               AND player2_confirmed
             )
       WHERE id = v_team.id
      RETURNING * INTO v_team;
    END IF;

    IF coalesce(v_partner_is_placeholder, false) THEN
      PERFORM public._set_zltac_side_event_membership(
        p_partner_id, v_team.event_year, 'triples', true
      );
    END IF;
    RETURN to_jsonb(v_team);
  END IF;

  PERFORM public._lock_zltac_side_event_context(
    v_team.event_year,
    'triples',
    ARRAY[v_team.player1_id, v_team.player2_id, v_team.player3_id]::uuid[]
  );

  IF p_action = 'confirm' THEN
    IF (p_slot = 2 AND v_team.player2_id IS DISTINCT FROM p_user_id)
       OR (p_slot = 3 AND v_team.player3_id IS DISTINCT FROM p_user_id) THEN
      RAISE EXCEPTION 'Only the invited player can confirm this slot.'
        USING ERRCODE = '42501';
    END IF;
    IF v_team.confirmed
       OR (p_slot = 2 AND v_team.player2_confirmed)
       OR (p_slot = 3 AND v_team.player3_confirmed) THEN
      RETURN to_jsonb(v_team);
    END IF;

    IF p_slot = 2 THEN
      UPDATE public.triples_teams
         SET player2_confirmed = true,
             confirmed = (player3_id IS NOT NULL AND player3_confirmed)
       WHERE id = v_team.id
      RETURNING * INTO v_team;
    ELSE
      UPDATE public.triples_teams
         SET player3_confirmed = true,
             confirmed = (player2_id IS NOT NULL AND player2_confirmed)
       WHERE id = v_team.id
      RETURNING * INTO v_team;
    END IF;
    PERFORM public._set_zltac_side_event_membership(
      p_user_id, v_team.event_year, 'triples', true
    );
    RETURN to_jsonb(v_team);
  END IF;

  IF p_action = 'clear-slot' THEN
    IF v_team.player1_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Only the triples organiser can clear a slot.'
        USING ERRCODE = '42501';
    END IF;
    IF v_team.confirmed THEN
      RAISE EXCEPTION 'A confirmed triples team is locked.'
        USING ERRCODE = '55000';
    END IF;
    IF (p_slot = 2 AND (v_team.player2_id IS NULL OR v_team.player2_confirmed))
       OR (p_slot = 3 AND (v_team.player3_id IS NULL OR v_team.player3_confirmed)) THEN
      RAISE EXCEPTION 'Only an occupied, unconfirmed slot can be cleared.'
        USING ERRCODE = '55000';
    END IF;

    v_dropped_member := CASE
      WHEN p_slot = 2 THEN v_team.player2_id
      ELSE v_team.player3_id
    END;
    IF p_slot = 2 THEN
      UPDATE public.triples_teams
         SET player2_id = NULL,
             player2_confirmed = false,
             confirmed = false
       WHERE id = v_team.id
      RETURNING * INTO v_team;
    ELSE
      UPDATE public.triples_teams
         SET player3_id = NULL,
             player3_confirmed = false,
             confirmed = false
       WHERE id = v_team.id
      RETURNING * INTO v_team;
    END IF;
    PERFORM public._set_zltac_side_event_membership(
      v_dropped_member, v_team.event_year, 'triples', false
    );
    RETURN to_jsonb(v_team);
  END IF;

  IF NOT (
    p_user_id = ANY(
      array_remove(
        ARRAY[v_team.player1_id, v_team.player2_id, v_team.player3_id]::uuid[],
        NULL
      )
    )
  ) THEN
    RAISE EXCEPTION 'Only a triples participant can disband the team.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.triples_teams WHERE id = v_team.id;
  FOREACH v_other_member IN ARRAY ARRAY[
    v_team.player1_id,
    v_team.player2_id,
    v_team.player3_id
  ]::uuid[]
  LOOP
    IF v_other_member IS NOT NULL AND v_other_member <> p_user_id THEN
      PERFORM public._set_zltac_side_event_membership(
        v_other_member, v_team.event_year, 'triples', false
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('deleted', true, 'id', v_team.id);
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.mutate_zltac_triples_roster(uuid, text, integer, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.mutate_zltac_triples_roster(uuid, text, integer, uuid, integer, uuid)
  TO service_role;

COMMIT;
