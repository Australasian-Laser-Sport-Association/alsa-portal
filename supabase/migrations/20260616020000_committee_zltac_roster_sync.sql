-- =============================================================================
-- Committee ZLTAC roster edits must keep zltac_registrations and team_members
-- synchronized in one transaction.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.committee_set_zltac_team_roster(
  p_user_id uuid,
  p_year integer,
  p_team_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_destination_event_id uuid;
  v_registration_id uuid;
  v_team_ids uuid[];
  v_amount_owing integer;
BEGIN
  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE year = p_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year' USING ERRCODE = 'P0002';
  END IF;

  IF p_team_id IS NOT NULL THEN
    SELECT event_id INTO v_destination_event_id
      FROM public.teams
     WHERE id = p_team_id
     FOR UPDATE;

    IF NOT FOUND OR v_destination_event_id IS NULL THEN
      RAISE EXCEPTION 'Destination team is not a ZLTAC team.' USING ERRCODE = '22023';
    END IF;

    IF v_destination_event_id IS DISTINCT FROM v_event.id THEN
      RAISE EXCEPTION 'Destination team belongs to a different event year.' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.zltac_registrations
     SET team_id = p_team_id
   WHERE user_id = p_user_id
     AND year = p_year
  RETURNING id INTO v_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is not registered for this event year.' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_team_ids
    FROM public.teams
   WHERE event_id = v_event.id;

  IF cardinality(v_team_ids) > 0 THEN
    IF p_team_id IS NULL THEN
      DELETE FROM public.team_members
       WHERE user_id = p_user_id
         AND team_id = ANY(v_team_ids);
    ELSE
      DELETE FROM public.team_members
       WHERE user_id = p_user_id
         AND team_id = ANY(v_team_ids)
         AND team_id <> p_team_id;
    END IF;
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

REVOKE ALL ON FUNCTION public.committee_set_zltac_team_roster(uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.committee_set_zltac_team_roster(uuid, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.committee_set_zltac_team_roster(uuid, integer, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.committee_set_zltac_team_roster(uuid, integer, uuid) TO service_role;
