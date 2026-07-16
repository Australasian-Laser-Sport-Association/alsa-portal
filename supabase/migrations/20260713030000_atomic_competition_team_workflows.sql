-- Wave B / Phase 2A: make competition registration, team, invite, moderation,
-- and competition-payment mutations atomic and lifecycle-aware.
--
-- All application writes in this file are exposed only to service_role. Each
-- workflow locks the owning competition row first, which serializes mutations
-- against archive/window changes and gives every operation one transaction.

BEGIN;

-- ---------------------------------------------------------------------------
-- Database invariant: one accepted competition team per user
-- ---------------------------------------------------------------------------

ALTER TABLE public.team_members
  ADD COLUMN competition_id uuid
  REFERENCES public.competitions(id) ON DELETE CASCADE;

UPDATE public.team_members tm
   SET competition_id = t.competition_id
  FROM public.teams t
 WHERE t.id = tm.team_id
   AND t.competition_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE competition_id IS NOT NULL
       AND invite_status = 'accepted'
     GROUP BY competition_id, user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one accepted competition team per user: duplicate accepted memberships exist.'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.team_members tm
     WHERE tm.competition_id IS NOT NULL
       AND tm.invite_status = 'accepted'
       AND NOT EXISTS (
         SELECT 1
           FROM public.competition_registrations cr
          WHERE cr.competition_id = tm.competition_id
            AND cr.user_id = tm.user_id
            AND cr.team_id = tm.team_id
       )
  ) THEN
    RAISE EXCEPTION
      'Cannot enable atomic competition teams: an accepted membership lacks a matching registration team link.'
      USING ERRCODE = '23503';
  END IF;
END;
$$;

CREATE UNIQUE INDEX team_members_one_accepted_per_competition
  ON public.team_members (competition_id, user_id)
  WHERE competition_id IS NOT NULL
    AND invite_status = 'accepted';

CREATE OR REPLACE FUNCTION public.sync_team_member_competition_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
BEGIN
  SELECT t.competition_id
    INTO v_competition_id
    FROM public.teams t
   WHERE t.id = NEW.team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = '23503';
  END IF;

  -- Always derive this value. A caller cannot forge a different competition.
  NEW.competition_id := v_competition_id;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.sync_team_member_competition_id()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.sync_team_member_competition_id()
  TO service_role;

CREATE TRIGGER team_members_sync_competition_id
  BEFORE INSERT OR UPDATE OF team_id, competition_id
  ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_team_member_competition_id();

-- team_members has no browser mutation path. Remove the legacy broad grant so
-- committee sessions cannot bypass the service API and its transactions.
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.team_members
  FROM authenticated;

-- ---------------------------------------------------------------------------
-- Shared locked lifecycle and manager-authorisation helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_open_competition(
  p_competition_id uuid
)
RETURNS public.competitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition public.competitions%ROWTYPE;
BEGIN
  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'competition_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_competition
    FROM public.competitions
   WHERE id = p_competition_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_competition.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This competition has been archived.' USING ERRCODE = '55000';
  END IF;

  IF v_competition.registration_open_at IS NOT NULL
     AND clock_timestamp() < v_competition.registration_open_at THEN
    RAISE EXCEPTION 'Registration is not yet open for this competition.'
      USING ERRCODE = '55000';
  END IF;

  IF v_competition.registration_close_at IS NOT NULL
     AND clock_timestamp() >= v_competition.registration_close_at THEN
    RAISE EXCEPTION 'Registration has closed for this competition.'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_competition;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_competition_manager(
  p_actor_id uuid,
  p_competition_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = p_actor_id
       AND p.roles && ARRAY[
         'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
       ]::text[]
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.competition_managers cm
     WHERE cm.competition_id = p_competition_id
       AND cm.user_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorised to manage this competition.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-registration and cancellation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_for_competition(
  p_user_id uuid,
  p_competition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_open_competition(p_competition_id);

  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
     AND NOT coalesce(suspended, false)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active profile is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.competition_registrations
   WHERE competition_id = p_competition_id
     AND user_id = p_user_id
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'You are already registered for this competition.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.competition_registrations (competition_id, user_id)
  VALUES (p_competition_id, p_user_id)
  RETURNING id INTO v_registration_id;

  RETURN jsonb_build_object('registration_id', v_registration_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_competition_registration(
  p_user_id uuid,
  p_competition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration public.competition_registrations%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_caller_member public.team_members%ROWTYPE;
  v_other_accepted integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_open_competition(p_competition_id);

  SELECT *
    INTO v_registration
    FROM public.competition_registrations
   WHERE competition_id = p_competition_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not registered for this competition.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_registration.payment_status IN ('paid', 'partial', 'overpaid') THEN
    RAISE EXCEPTION
      'You have already made a payment for this event. Contact the event organiser to arrange a refund.'
      USING ERRCODE = '55000';
  END IF;

  -- Lock all of this user's competition memberships, including pending
  -- invites, before changing either membership or registration state.
  PERFORM 1
    FROM public.team_members
   WHERE competition_id = p_competition_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF v_registration.team_id IS NULL AND EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE competition_id = p_competition_id
       AND user_id = p_user_id
       AND invite_status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Registration team link is inconsistent with accepted membership.'
      USING ERRCODE = '23503';
  END IF;

  IF v_registration.team_id IS NOT NULL THEN
    SELECT *
      INTO v_team
      FROM public.teams
     WHERE id = v_registration.team_id
       AND competition_id = p_competition_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registration team is invalid.' USING ERRCODE = '23503';
    END IF;

    PERFORM 1 FROM public.team_members WHERE team_id = v_team.id FOR UPDATE;

    SELECT *
      INTO v_caller_member
      FROM public.team_members
     WHERE team_id = v_team.id
       AND user_id = p_user_id
       AND invite_status = 'accepted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Accepted team membership is missing.' USING ERRCODE = '23503';
    END IF;

    IF 'captain' = ANY(v_caller_member.roles) THEN
      SELECT count(*)
        INTO v_other_accepted
        FROM public.team_members
       WHERE team_id = v_team.id
         AND invite_status = 'accepted'
         AND user_id <> p_user_id;

      IF v_other_accepted > 0 THEN
        RAISE EXCEPTION
          'Transfer captaincy or remove all team members before cancelling registration.'
          USING ERRCODE = '55000';
      END IF;

      -- team_members cascades and registration team links become NULL via FK.
      DELETE FROM public.teams WHERE id = v_team.id;
    ELSE
      DELETE FROM public.team_members WHERE id = v_caller_member.id;
      UPDATE public.competition_registrations
         SET team_id = NULL
       WHERE id = v_registration.id;
    END IF;
  END IF;

  DELETE FROM public.team_members
   WHERE competition_id = p_competition_id
     AND user_id = p_user_id
     AND invite_status = 'pending';

  DELETE FROM public.competition_registrations
   WHERE id = v_registration.id;

  RETURN jsonb_build_object('deleted', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Captain team workflows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_competition_team(
  p_actor_id uuid,
  p_competition_id uuid,
  p_name text,
  p_colour text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration public.competition_registrations%ROWTYPE;
  v_team_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Team name must be between 1 and 50 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF p_colour IS NULL OR NOT (
    upper(p_colour) = ANY(ARRAY[
      '#00E6FF', '#FF3B30', '#0A84FF', '#FF9F0A',
      '#BF5AF2', '#FF375F', '#30D158', '#64D2FF'
    ]::text[])
  ) THEN
    RAISE EXCEPTION 'colour must be one of the team palette values'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_open_competition(p_competition_id);

  SELECT *
    INTO v_registration
    FROM public.competition_registrations
   WHERE competition_id = p_competition_id
     AND user_id = p_actor_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You must register for the competition before creating a team.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.team_members
   WHERE competition_id = p_competition_id
     AND user_id = p_actor_id
   FOR UPDATE;

  IF v_registration.team_id IS NOT NULL OR EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE competition_id = p_competition_id
       AND user_id = p_actor_id
       AND invite_status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'You are already on a team for this competition.'
      USING ERRCODE = '23505';
  END IF;

  -- Creating a team resolves any outstanding invitations for this competition.
  UPDATE public.team_members
     SET invite_status = 'declined', responded_at = now()
   WHERE competition_id = p_competition_id
     AND user_id = p_actor_id
     AND invite_status = 'pending';

  INSERT INTO public.teams (
    competition_id, name, colour, captain_id, manager_id, status, format
  ) VALUES (
    p_competition_id, btrim(p_name), upper(p_colour),
    p_actor_id, p_actor_id, 'pending', 'team'
  )
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, responded_at, invited_by
  ) VALUES (
    v_team_id, p_actor_id, ARRAY['captain']::text[], 'accepted', now(), NULL
  );

  UPDATE public.competition_registrations
     SET team_id = v_team_id
   WHERE id = v_registration.id;

  RETURN jsonb_build_object('team_id', v_team_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_team(
  p_actor_id uuid,
  p_team_id uuid,
  p_name text DEFAULT NULL,
  p_colour text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
  v_member public.team_members%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and team_id are required' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL AND p_colour IS NULL THEN
    RAISE EXCEPTION 'No editable fields supplied.' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NOT NULL
     AND char_length(btrim(p_name)) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Team name must be between 1 and 50 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF p_colour IS NOT NULL AND NOT (
    upper(p_colour) = ANY(ARRAY[
      '#00E6FF', '#FF3B30', '#0A84FF', '#FF9F0A',
      '#BF5AF2', '#FF375F', '#30D158', '#64D2FF'
    ]::text[])
  ) THEN
    RAISE EXCEPTION 'colour must be one of the team palette values'
      USING ERRCODE = '22023';
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM public.teams
   WHERE id = p_team_id;
  IF NOT FOUND OR v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);

  PERFORM 1
    FROM public.teams
   WHERE id = p_team_id
     AND competition_id = v_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.competition_registrations
   WHERE team_id = p_team_id FOR UPDATE;
  PERFORM 1 FROM public.team_members
   WHERE team_id = p_team_id FOR UPDATE;

  SELECT * INTO v_member
    FROM public.team_members
   WHERE team_id = p_team_id
     AND user_id = p_actor_id
     AND invite_status = 'accepted';
  IF NOT FOUND OR NOT ('captain' = ANY(v_member.roles)) THEN
    RAISE EXCEPTION 'Only the team captain can edit team details.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.teams
     SET name = CASE WHEN p_name IS NULL THEN name ELSE btrim(p_name) END,
         colour = CASE WHEN p_colour IS NULL THEN colour ELSE upper(p_colour) END
   WHERE id = p_team_id;

  RETURN jsonb_build_object('team_id', p_team_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.disband_competition_team(
  p_actor_id uuid,
  p_team_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
  v_member public.team_members%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and team_id are required' USING ERRCODE = '22023';
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND OR v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);
  PERFORM 1 FROM public.teams
   WHERE id = p_team_id AND competition_id = v_competition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.competition_registrations
   WHERE team_id = p_team_id FOR UPDATE;
  PERFORM 1 FROM public.team_members
   WHERE team_id = p_team_id FOR UPDATE;

  SELECT * INTO v_member
    FROM public.team_members
   WHERE team_id = p_team_id
     AND user_id = p_actor_id
     AND invite_status = 'accepted';
  IF NOT FOUND OR NOT ('captain' = ANY(v_member.roles)) THEN
    RAISE EXCEPTION 'Only the team captain can disband the team.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_members
     WHERE team_id = p_team_id
       AND invite_status = 'accepted'
       AND user_id <> p_actor_id
  ) THEN
    RAISE EXCEPTION 'Remove all team members before disbanding.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.teams WHERE id = p_team_id;
  RETURN jsonb_build_object('deleted', true, 'team_id', p_team_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Invite, response, remove, and leave workflows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invite_competition_team_member(
  p_actor_id uuid,
  p_team_id uuid,
  p_invitee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
  v_caller public.team_members%ROWTYPE;
  v_registration public.competition_registrations%ROWTYPE;
  v_membership_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_team_id IS NULL OR p_invitee_id IS NULL THEN
    RAISE EXCEPTION 'actor_id, team_id, and invitee_user_id are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_actor_id = p_invitee_id THEN
    RAISE EXCEPTION 'The captain is already on this team.' USING ERRCODE = '22023';
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND OR v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);
  PERFORM 1 FROM public.teams
   WHERE id = p_team_id AND competition_id = v_competition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.team_members
   WHERE team_id = p_team_id OR (
     competition_id = v_competition_id AND user_id = p_invitee_id
   )
   FOR UPDATE;

  SELECT * INTO v_caller
    FROM public.team_members
   WHERE team_id = p_team_id
     AND user_id = p_actor_id
     AND invite_status = 'accepted';
  IF NOT FOUND OR NOT ('captain' = ANY(v_caller.roles)) THEN
    RAISE EXCEPTION 'Only the team captain can invite players.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_registration
    FROM public.competition_registrations
   WHERE competition_id = v_competition_id
     AND user_id = p_invitee_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Player must register for this competition before they can be invited.'
      USING ERRCODE = '22023';
  END IF;

  -- Hold the target profile stable for the transaction and reject suspended
  -- accounts even when they still have an old competition registration.
  PERFORM 1
    FROM public.profiles
   WHERE id = p_invitee_id
     AND NOT coalesce(suspended, false)
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A suspended account cannot be invited to an official roster.'
      USING ERRCODE = '42501';
  END IF;
  IF v_registration.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'Player is already on a team in this competition.'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE competition_id = v_competition_id
       AND user_id = p_invitee_id
       AND invite_status IN ('accepted', 'pending')
  ) THEN
    RAISE EXCEPTION 'Player is already on a team in this competition.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.team_members (
    team_id, user_id, roles, invite_status, invited_at, responded_at, invited_by
  ) VALUES (
    p_team_id, p_invitee_id, ARRAY['player']::text[],
    'pending', now(), NULL, p_actor_id
  )
  ON CONFLICT (team_id, user_id) DO UPDATE
    SET roles = ARRAY['player']::text[],
        invite_status = 'pending',
        invited_at = now(),
        responded_at = NULL,
        invited_by = EXCLUDED.invited_by
  RETURNING id INTO v_membership_id;

  RETURN jsonb_build_object('membership_id', v_membership_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_competition_team_invite(
  p_actor_id uuid,
  p_membership_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
  v_target public.team_members%ROWTYPE;
  v_registration public.competition_registrations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and membership_id are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'action must be "accept" or "decline"'
      USING ERRCODE = '22023';
  END IF;

  SELECT tm.competition_id INTO v_competition_id
    FROM public.team_members tm
   WHERE tm.id = p_membership_id;
  IF NOT FOUND OR v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);

  SELECT * INTO v_target
    FROM public.team_members
   WHERE id = p_membership_id
     AND competition_id = v_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_target.user_id <> p_actor_id THEN
    RAISE EXCEPTION 'This invite is not addressed to you.'
      USING ERRCODE = '42501';
  END IF;
  IF v_target.invite_status <> 'pending' THEN
    RAISE EXCEPTION 'This invite has already been resolved.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1 FROM public.teams
   WHERE id = v_target.team_id AND competition_id = v_competition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_registration
    FROM public.competition_registrations
   WHERE competition_id = v_competition_id
     AND user_id = p_actor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You must remain registered to respond to this invite.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.team_members
   WHERE competition_id = v_competition_id
     AND user_id = p_actor_id
   FOR UPDATE;

  IF p_action = 'decline' THEN
    UPDATE public.team_members
       SET invite_status = 'declined', responded_at = now()
     WHERE id = p_membership_id;
    RETURN jsonb_build_object('membership_id', p_membership_id, 'action', 'decline');
  END IF;

  IF v_registration.team_id IS NOT NULL OR EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE competition_id = v_competition_id
       AND user_id = p_actor_id
       AND invite_status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'You are already on a team in this competition.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.team_members
     SET invite_status = 'accepted', responded_at = now()
   WHERE id = p_membership_id;

  UPDATE public.competition_registrations
     SET team_id = v_target.team_id
   WHERE id = v_registration.id;

  UPDATE public.team_members
     SET invite_status = 'declined', responded_at = now()
   WHERE competition_id = v_competition_id
     AND user_id = p_actor_id
     AND invite_status = 'pending'
     AND id <> p_membership_id;

  RETURN jsonb_build_object('membership_id', p_membership_id, 'action', 'accept');
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_competition_team_member(
  p_actor_id uuid,
  p_membership_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
  v_target public.team_members%ROWTYPE;
  v_caller public.team_members%ROWTYPE;
  v_caller_is_captain boolean := false;
  v_caller_is_self boolean;
  v_remaining_accepted integer;
BEGIN
  IF p_actor_id IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and membership_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM public.team_members
   WHERE id = p_membership_id;
  IF NOT FOUND OR v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Membership not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);

  SELECT * INTO v_target
    FROM public.team_members
   WHERE id = p_membership_id
     AND competition_id = v_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.teams
   WHERE id = v_target.team_id AND competition_id = v_competition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.team_members
   WHERE team_id = v_target.team_id FOR UPDATE;
  PERFORM 1 FROM public.competition_registrations
   WHERE competition_id = v_competition_id
     AND (team_id = v_target.team_id OR user_id = v_target.user_id)
   FOR UPDATE;

  SELECT * INTO v_caller
    FROM public.team_members
   WHERE team_id = v_target.team_id
     AND user_id = p_actor_id
     AND invite_status = 'accepted';
  IF FOUND THEN
    v_caller_is_captain := 'captain' = ANY(v_caller.roles);
  END IF;
  v_caller_is_self := v_target.user_id = p_actor_id;

  IF v_caller_is_captain AND v_caller_is_self THEN
    RAISE EXCEPTION 'Captains cannot remove themselves. Disband the team instead.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_caller_is_captain AND (
    NOT v_caller_is_self OR v_target.invite_status <> 'accepted'
  ) THEN
    RAISE EXCEPTION 'You do not have permission to remove this membership.'
      USING ERRCODE = '42501';
  END IF;

  IF v_target.invite_status = 'accepted'
     AND 'captain' = ANY(v_target.roles)
     AND EXISTS (
       SELECT 1 FROM public.team_members
        WHERE team_id = v_target.team_id
          AND id <> v_target.id
          AND invite_status = 'accepted'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members
        WHERE team_id = v_target.team_id
          AND id <> v_target.id
          AND invite_status = 'accepted'
          AND 'captain' = ANY(roles)
     ) THEN
    RAISE EXCEPTION
      'You are the only captain. Transfer captaincy or remove other members first.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.team_members WHERE id = v_target.id;

  IF v_target.invite_status = 'accepted' THEN
    SELECT count(*) INTO v_remaining_accepted
      FROM public.team_members
     WHERE team_id = v_target.team_id
       AND invite_status = 'accepted';

    IF v_remaining_accepted = 0 THEN
      DELETE FROM public.teams WHERE id = v_target.team_id;
    ELSE
      UPDATE public.competition_registrations
         SET team_id = NULL
       WHERE competition_id = v_competition_id
         AND user_id = v_target.user_id
         AND team_id = v_target.team_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('deleted', true, 'membership_id', p_membership_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Manager roster moderation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.moderate_competition_team(
  p_actor_id uuid,
  p_team_id uuid,
  p_status text DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and team_id are required' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL AND p_name IS NULL THEN
    RAISE EXCEPTION 'No moderation fields supplied.' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Invalid team status.' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NOT NULL
     AND char_length(btrim(p_name)) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Team name must be between 1 and 50 characters.'
      USING ERRCODE = '22023';
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND OR v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);
  PERFORM public.assert_competition_manager(p_actor_id, v_competition_id);

  PERFORM 1 FROM public.teams
   WHERE id = p_team_id AND competition_id = v_competition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.team_members WHERE team_id = p_team_id FOR UPDATE;
  PERFORM 1 FROM public.competition_registrations
   WHERE team_id = p_team_id FOR UPDATE;

  UPDATE public.teams
     SET status = coalesce(p_status, status),
         name = CASE WHEN p_name IS NULL THEN name ELSE btrim(p_name) END
   WHERE id = p_team_id;

  RETURN jsonb_build_object('team_id', p_team_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Competition billing writes with the same lifecycle lock
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_competition_payment(
  p_actor_id uuid,
  p_registration_id uuid,
  p_amount integer,
  p_recorded_at timestamptz DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_competition_id uuid;
  v_payment_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and registration_id are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Payment amount must be non-zero.' USING ERRCODE = '22023';
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM public.competition_registrations
   WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition registration not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);
  PERFORM public.assert_competition_manager(p_actor_id, v_competition_id);
  PERFORM 1 FROM public.competition_registrations
   WHERE id = p_registration_id
     AND competition_id = v_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition registration not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.payment_records (
    competition_registration_id, amount, recorded_at,
    recorded_by, bank_reference, notes
  ) VALUES (
    p_registration_id, p_amount, coalesce(p_recorded_at, now()),
    p_actor_id, nullif(btrim(p_bank_reference), ''), nullif(btrim(p_notes), '')
  )
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'registration_id', p_registration_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_payment(
  p_actor_id uuid,
  p_payment_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration_id uuid;
  v_competition_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and payment_id are required' USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Payment changes must be a non-empty object.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_changes) AS k(key)
     WHERE NOT (k.key = ANY(ARRAY[
       'amount', 'recorded_at', 'bank_reference', 'notes'
     ]::text[]))
  ) THEN
    RAISE EXCEPTION 'Payment changes contain an unsupported field.'
      USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'amount'
     AND coalesce((p_changes ->> 'amount')::integer, 0) = 0 THEN
    RAISE EXCEPTION 'Payment amount must be non-zero.' USING ERRCODE = '22023';
  END IF;

  SELECT pr.competition_registration_id, cr.competition_id
    INTO v_registration_id, v_competition_id
    FROM public.payment_records pr
    JOIN public.competition_registrations cr
      ON cr.id = pr.competition_registration_id
   WHERE pr.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition payment record not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);
  PERFORM public.assert_competition_manager(p_actor_id, v_competition_id);
  PERFORM 1 FROM public.competition_registrations
   WHERE id = v_registration_id FOR UPDATE;
  PERFORM 1 FROM public.payment_records
   WHERE id = p_payment_id FOR UPDATE;

  PERFORM public.edit_payment_record(p_payment_id, p_changes, p_actor_id);
  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'registration_id', v_registration_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_competition_payment(
  p_actor_id uuid,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration_id uuid;
  v_competition_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and payment_id are required' USING ERRCODE = '22023';
  END IF;

  SELECT pr.competition_registration_id, cr.competition_id
    INTO v_registration_id, v_competition_id
    FROM public.payment_records pr
    JOIN public.competition_registrations cr
      ON cr.id = pr.competition_registration_id
   WHERE pr.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition payment record not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_open_competition(v_competition_id);
  PERFORM public.assert_competition_manager(p_actor_id, v_competition_id);
  PERFORM 1 FROM public.competition_registrations
   WHERE id = v_registration_id FOR UPDATE;
  PERFORM 1 FROM public.payment_records
   WHERE id = p_payment_id FOR UPDATE;

  PERFORM public.delete_payment_record(p_payment_id, p_actor_id);
  RETURN jsonb_build_object(
    'deleted', true,
    'payment_id', p_payment_id,
    'registration_id', v_registration_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: server routes only
-- ---------------------------------------------------------------------------

REVOKE ALL PRIVILEGES ON FUNCTION public.lock_open_competition(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.assert_competition_manager(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.register_for_competition(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_competition_registration(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_competition_team(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_competition_team(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.disband_competition_team(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.invite_competition_team_member(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.respond_competition_team_invite(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.remove_competition_team_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.moderate_competition_team(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.record_competition_payment(uuid, uuid, integer, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_competition_payment(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.remove_competition_payment(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lock_open_competition(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_competition_manager(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_for_competition(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_competition_registration(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_competition_team(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_competition_team(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.disband_competition_team(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.invite_competition_team_member(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_competition_team_invite(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_competition_team_member(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.moderate_competition_team(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_competition_payment(uuid, uuid, integer, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_competition_payment(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_competition_payment(uuid, uuid) TO service_role;

COMMIT;
