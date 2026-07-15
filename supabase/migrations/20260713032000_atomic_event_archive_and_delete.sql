-- Wave B / Phase 2C: atomic ZLTAC event archive and deletion.
--
-- The previous API implementation performed several independent service-role
-- statements and trusted a caller-supplied year. A failure in the middle could
-- leave a partly archived/deleted event, and a mismatched year could remove data
-- belonging to a different event. These RPCs lock the event row, derive its year
-- inside the transaction, and expose execution only to service_role.

BEGIN;

-- Keep a durable, committee-readable record of destructive lifecycle actions.
-- event_id and actor_id intentionally have no foreign keys: the record must
-- survive deletion of either source row.
CREATE TABLE public.zltac_event_lifecycle_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL,
  event_year     integer NOT NULL,
  operation      text NOT NULL CHECK (operation IN ('archive', 'delete')),
  actor_id       uuid NOT NULL,
  event_snapshot jsonb NOT NULL,
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zltac_event_lifecycle_audit_event_idx
  ON public.zltac_event_lifecycle_audit (event_id, created_at DESC);
CREATE INDEX zltac_event_lifecycle_audit_year_idx
  ON public.zltac_event_lifecycle_audit (event_year, created_at DESC);

ALTER TABLE public.zltac_event_lifecycle_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY zltac_event_lifecycle_audit_committee_read
  ON public.zltac_event_lifecycle_audit
  FOR SELECT TO authenticated
  USING (public.is_committee());

REVOKE ALL PRIVILEGES
  ON TABLE public.zltac_event_lifecycle_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT
  ON TABLE public.zltac_event_lifecycle_audit
  TO authenticated, service_role;

-- These legal tables were originally scoped by a plain integer year. Add the
-- missing event foreign keys so a concurrent player submission cannot land
-- after the RPC's explicit delete and survive as an orphan. Fail rather than
-- silently discarding any pre-existing orphan that needs maintainer review.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.legal_acceptances la
      LEFT JOIN public.zltac_events e ON e.year = la.event_year
     WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot add legal_acceptances event FK: orphan event_year values exist.'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.under_18_approvals ua
      LEFT JOIN public.zltac_events e ON e.year = ua.event_year
     WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot add under_18_approvals event FK: orphan event_year values exist.'
      USING ERRCODE = '23503';
  END IF;
END;
$$;

ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_event_year_fkey
  FOREIGN KEY (event_year)
  REFERENCES public.zltac_events(year)
  ON DELETE CASCADE;

ALTER TABLE public.under_18_approvals
  ADD CONSTRAINT under_18_approvals_event_year_fkey
  FOREIGN KEY (event_year)
  REFERENCES public.zltac_events(year)
  ON DELETE CASCADE;

-- Once an event is archived, generic updates must not turn it back into an
-- active event. The API also rejects such writes, while this trigger supplies a
-- database invariant for service-role callers outside that route.
CREATE OR REPLACE FUNCTION public.prevent_zltac_event_unarchive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION 'Archived ZLTAC events cannot be returned to an active status.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.prevent_zltac_event_unarchive()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.prevent_zltac_event_unarchive()
  TO service_role;

CREATE TRIGGER zltac_events_prevent_unarchive
  BEFORE UPDATE OF status ON public.zltac_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_zltac_event_unarchive();

CREATE OR REPLACE FUNCTION public.archive_zltac_event(
  event_id uuid,
  actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_history_id uuid;
  v_audit_id uuid;
  v_history_created boolean := false;
  v_already_archived boolean;
  v_team_count integer;
BEGIN
  IF $1 IS NULL OR $2 IS NULL THEN
    RAISE EXCEPTION 'event_id and actor_id are required'
      USING ERRCODE = '22023';
  END IF;

  -- The API verifies committee authority. This additional check prevents a
  -- service caller from attributing the action to a missing/suspended profile.
  PERFORM 1
    FROM public.profiles p
   WHERE p.id = $2
     AND p.suspended = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active actor profile not found.'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
    INTO v_event
    FROM public.zltac_events e
   WHERE e.id = $1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZLTAC event not found.'
      USING ERRCODE = 'P0002';
  END IF;

  v_already_archived := v_event.status = 'archived';

  SELECT h.id
    INTO v_history_id
    FROM public.zltac_event_history h
   WHERE h.year = v_event.year;

  IF NOT FOUND THEN
    SELECT count(*)::integer
      INTO v_team_count
      FROM public.teams t
     WHERE t.event_id = v_event.id
       AND t.format = 'team'
       AND t.status = 'approved';

    INSERT INTO public.zltac_event_history (
      year,
      name,
      location_city,
      location_state,
      location_venue,
      start_date,
      end_date,
      description,
      logo_url,
      photo_urls,
      team_count,
      is_cancelled,
      is_upcoming
    ) VALUES (
      v_event.year,
      v_event.name,
      v_event.location,
      NULL,
      v_event.venue,
      v_event.start_date,
      v_event.end_date,
      v_event.description,
      v_event.logo_url,
      v_event.photo_urls,
      v_team_count,
      false,
      false
    )
    RETURNING id INTO v_history_id;

    v_history_created := true;
  END IF;

  IF NOT v_already_archived THEN
    UPDATE public.zltac_events e
       SET status = 'archived',
           updated_at = now()
     WHERE e.id = v_event.id;
  END IF;

  -- A retry that changes no state creates no second audit row. Repairing a
  -- missing history row on an already-archived event is still recorded.
  IF NOT v_already_archived OR v_history_created THEN
    v_audit_id := gen_random_uuid();
    INSERT INTO public.zltac_event_lifecycle_audit (
      id,
      event_id,
      event_year,
      operation,
      actor_id,
      event_snapshot,
      summary
    ) VALUES (
      v_audit_id,
      v_event.id,
      v_event.year,
      'archive',
      $2,
      to_jsonb(v_event),
      jsonb_build_object(
        'history_id', v_history_id,
        'history_created', v_history_created,
        'already_archived', v_already_archived
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event.id,
    'year', v_event.year,
    'status', 'archived',
    'historyId', v_history_id,
    'historyCreated', v_history_created,
    'historySkipped', NOT v_history_created,
    'alreadyArchived', v_already_archived,
    'auditId', v_audit_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_zltac_event(
  event_id uuid,
  actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_audit_id uuid := gen_random_uuid();
  v_deleted_counts jsonb;
  v_previous_payment_actor text;
BEGIN
  IF $1 IS NULL OR $2 IS NULL THEN
    RAISE EXCEPTION 'event_id and actor_id are required'
      USING ERRCODE = '22023';
  END IF;

  -- Superadmin authority remains an API responsibility. Reject attribution to
  -- a missing/suspended profile even for a service-role caller.
  PERFORM 1
    FROM public.profiles p
   WHERE p.id = $2
     AND p.suspended = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active actor profile not found.'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
    INTO v_event
    FROM public.zltac_events e
   WHERE e.id = $1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZLTAC event not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Capture all event-owned records before the cascades run. The counts are a
  -- durable deletion receipt, not a caller-supplied estimate.
  SELECT jsonb_build_object(
    'registrations', (
      SELECT count(*) FROM public.zltac_registrations r
       WHERE r.year = v_event.year
    ),
    'teams', (
      SELECT count(*) FROM public.teams t
       WHERE t.event_id = v_event.id
    ),
    'teamMembers', (
      SELECT count(*) FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
       WHERE t.event_id = v_event.id
    ),
    'paymentRecords', (
      SELECT count(*) FROM public.payment_records pr
      JOIN public.zltac_registrations r ON r.id = pr.registration_id
       WHERE r.year = v_event.year
    ),
    'legacyPayments', (
      SELECT count(*) FROM public.payments p
       WHERE p.event_year = v_event.year
    ),
    'legalAcceptances', (
      SELECT count(*) FROM public.legal_acceptances la
       WHERE la.event_year = v_event.year
    ),
    'under18Approvals', (
      SELECT count(*) FROM public.under_18_approvals ua
       WHERE ua.event_year = v_event.year
    ),
    'doublesPairs', (
      SELECT count(*) FROM public.doubles_pairs dp
       WHERE dp.event_year = v_event.year
    ),
    'triplesTeams', (
      SELECT count(*) FROM public.triples_teams tt
       WHERE tt.event_year = v_event.year
    ),
    'volunteerSignups', (
      SELECT count(*) FROM public.volunteer_signups vs
      JOIN public.zltac_registrations r ON r.id = vs.registration_id
       WHERE r.year = v_event.year
    ),
    'volunteerSignupRoles', (
      SELECT count(*) FROM public.volunteer_signup_roles vsr
      JOIN public.volunteer_signups vs ON vs.id = vsr.signup_id
      JOIN public.zltac_registrations r ON r.id = vs.registration_id
       WHERE r.year = v_event.year
    ),
    'eventVolunteerSettings', (
      SELECT count(*) FROM public.event_volunteer_settings evs
       WHERE evs.event_id = v_event.id
    )
  ) INTO v_deleted_counts;

  INSERT INTO public.zltac_event_lifecycle_audit (
    id,
    event_id,
    event_year,
    operation,
    actor_id,
    event_snapshot,
    summary
  ) VALUES (
    v_audit_id,
    v_event.id,
    v_event.year,
    'delete',
    $2,
    to_jsonb(v_event),
    jsonb_build_object('deletedCounts', v_deleted_counts)
  );

  -- Delete these rows explicitly so the receipt matches the work performed.
  -- The legal-table cascade constraints above also close concurrent-insert
  -- races; legacy payments uses ON DELETE SET NULL and must be removed here.
  DELETE FROM public.legal_acceptances la
   WHERE la.event_year = v_event.year;
  DELETE FROM public.under_18_approvals ua
   WHERE ua.event_year = v_event.year;
  DELETE FROM public.payments p
   WHERE p.event_year = v_event.year;

  -- zltac_registrations, teams, side-event pairs, event settings and volunteer
  -- rows are removed by their existing ON DELETE CASCADE constraints. Pass the
  -- verified actor through the existing payment-record delete audit trigger.
  v_previous_payment_actor := current_setting('app.payment_changed_by', true);
  PERFORM set_config('app.payment_changed_by', $2::text, true);

  DELETE FROM public.zltac_events e
   WHERE e.id = v_event.id;

  PERFORM set_config(
    'app.payment_changed_by',
    coalesce(v_previous_payment_actor, ''),
    true
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'eventId', v_event.id,
    'year', v_event.year,
    'deletedCounts', v_deleted_counts,
    'auditId', v_audit_id
  );
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.archive_zltac_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.delete_zltac_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.archive_zltac_event(uuid, uuid)
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.delete_zltac_event(uuid, uuid)
  TO service_role;

COMMIT;
