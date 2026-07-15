-- Make legal acceptance and under-18 decisions atomic with the event lifecycle.
--
-- These writes are service-only RPCs. Each RPC locks the event before the
-- registration, published document, and evidence row so an archive or version
-- switch cannot race a legal record into an invalid state.

BEGIN;

-- ---------------------------------------------------------------------------
-- Publication outcome reconciliation
-- ---------------------------------------------------------------------------

-- A lost HTTP response does not reveal whether publish_legal_document()
-- committed. Taking its exact advisory lock waits out any still-running
-- publication of this document type before checking the immutable object
-- identity. A NULL result therefore proves that no committed row owns it.
-- Migration 040000 first creates this function for the phase-1 publication
-- checkpoint; this CREATE OR REPLACE deliberately reasserts the same contract
-- beside the later legal lifecycle functions.
CREATE OR REPLACE FUNCTION public.reconcile_legal_document_publication(
  p_document_type text,
  p_file_path text,
  p_content_sha256 text,
  p_object_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document public.legal_documents%ROWTYPE;
BEGIN
  IF p_document_type NOT IN (
    'code_of_conduct', 'media_release', 'under_18_form'
  ) OR p_file_path IS NULL
    OR p_content_sha256 IS NULL
    OR p_object_size IS NULL THEN
    RAISE EXCEPTION 'Complete legal document identity is required.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.legal_documents:' || p_document_type)
  );

  SELECT *
    INTO v_document
    FROM public.legal_documents AS document
   WHERE document.document_type = p_document_type
     AND document.file_path = p_file_path
     AND document.content_sha256 = p_content_sha256
     AND document.object_size = p_object_size
     AND document.published_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_document);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_legal_document_publication(
  text, text, text, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_legal_document_publication(
  text, text, text, bigint
) TO service_role;

-- ---------------------------------------------------------------------------
-- Player legal acceptance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_legal_document(
  p_user_id uuid,
  p_event_year integer,
  p_document_id uuid,
  p_ip_address inet,
  p_user_agent text
)
RETURNS public.legal_acceptances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_status text;
  v_suspended boolean;
  v_result public.legal_acceptances%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_event_year IS NULL
    OR p_document_id IS NULL THEN
    RAISE EXCEPTION 'User, event year, and document are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_user_agent IS NOT NULL AND length(p_user_agent) > 1024 THEN
    RAISE EXCEPTION 'User agent exceeds the supported length.'
      USING ERRCODE = '22023';
  END IF;

  SELECT event.status
    INTO v_event_status
    FROM public.zltac_events AS event
   WHERE event.year = p_event_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Only open or closed events can accept legal documents.'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(profile.suspended, false)
    INTO v_suspended
    FROM public.zltac_registrations AS registration
    JOIN public.profiles AS profile ON profile.id = registration.user_id
   WHERE registration.user_id = p_user_id
     AND registration.year = p_event_year
     AND registration.status IN ('pending', 'confirmed')
   FOR UPDATE OF registration
   FOR SHARE OF profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active registration is required before signing.'
      USING ERRCODE = '23503';
  END IF;
  IF v_suspended THEN
    RAISE EXCEPTION 'Suspended accounts cannot accept legal documents.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.legal_documents AS document
   WHERE document.id = p_document_id
     AND document.document_type IN ('code_of_conduct', 'media_release')
     AND document.is_active
     AND document.published_at IS NOT NULL
     AND document.content_sha256 IS NOT NULL
     AND document.object_size IS NOT NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The legal document is not an active published version.'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.legal_acceptances (
    user_id,
    document_id,
    event_year,
    accepted_at,
    ip_address,
    user_agent
  ) VALUES (
    p_user_id,
    p_document_id,
    p_event_year,
    clock_timestamp(),
    p_ip_address,
    p_user_agent
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_legal_document(
  uuid, integer, uuid, inet, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_legal_document(
  uuid, integer, uuid, inet, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- Player under-18 submission
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_under_18_approval(
  p_user_id uuid,
  p_event_year integer,
  p_document_id uuid
)
RETURNS public.under_18_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_status text;
  v_dob date;
  v_registration_status text;
  v_suspended boolean;
  v_start_date date;
  v_starts_at timestamptz;
  v_timezone text;
  v_cutoff_date date;
  v_eighteenth_birthday date;
  v_existing_status text;
  v_result public.under_18_approvals%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_event_year IS NULL OR p_document_id IS NULL THEN
    RAISE EXCEPTION 'User, event year, and document are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    event.status,
    event.start_date,
    event.event_starts_at,
    event.timezone
    INTO v_event_status, v_start_date, v_starts_at, v_timezone
    FROM public.zltac_events AS event
   WHERE event.year = p_event_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Only open or closed events can accept under-18 submissions.'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    registration.dob_at_registration,
    registration.status,
    coalesce(profile.suspended, false)
    INTO v_dob, v_registration_status, v_suspended
    FROM public.zltac_registrations AS registration
    JOIN public.profiles AS profile ON profile.id = registration.user_id
   WHERE registration.user_id = p_user_id
     AND registration.year = p_event_year
   FOR UPDATE OF registration
   FOR SHARE OF profile;
  IF NOT FOUND OR v_registration_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Register for this event before submitting an under-18 form.'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_suspended THEN
    RAISE EXCEPTION 'Suspended accounts cannot submit an under-18 form.'
      USING ERRCODE = '42501';
  END IF;
  IF v_dob IS NULL THEN
    RAISE EXCEPTION 'A date of birth is required before submitting an under-18 form.'
      USING ERRCODE = '23514';
  END IF;

  IF v_start_date IS NOT NULL THEN
    v_cutoff_date := v_start_date;
  ELSIF v_starts_at IS NOT NULL
        AND v_timezone IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_timezone_names
           WHERE name = v_timezone
        ) THEN
    v_cutoff_date := (v_starts_at AT TIME ZONE v_timezone)::date;
  ELSE
    RAISE EXCEPTION 'The event needs a valid local start date and timezone before under-18 forms can be submitted.'
      USING ERRCODE = '23514';
  END IF;

  IF v_dob < DATE '1900-01-01' OR v_dob > v_cutoff_date THEN
    RAISE EXCEPTION 'The registration date of birth is invalid for this event.'
      USING ERRCODE = '23514';
  END IF;

  v_eighteenth_birthday :=
    make_date(
      extract(year FROM v_dob)::integer + 18,
      extract(month FROM v_dob)::integer,
      1
    ) + (extract(day FROM v_dob)::integer - 1);

  IF v_cutoff_date >= v_eighteenth_birthday THEN
    RAISE EXCEPTION 'An under-18 approval is not required for this registration.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
    FROM public.legal_documents AS document
   WHERE document.id = p_document_id
     AND document.document_type = 'under_18_form'
     AND document.is_active
     AND document.published_at IS NOT NULL
     AND document.content_sha256 IS NOT NULL
     AND document.object_size IS NOT NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The under-18 document is not an active published version.'
      USING ERRCODE = '23503';
  END IF;

  SELECT approval.status
    INTO v_existing_status
    FROM public.under_18_approvals AS approval
   WHERE approval.user_id = p_user_id
     AND approval.event_year = p_event_year
   FOR UPDATE;
  IF FOUND AND v_existing_status = 'approved' THEN
    RAISE EXCEPTION 'This under-18 approval has already been approved.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.under_18_approvals (
    user_id,
    event_year,
    document_id,
    status,
    submitted_at,
    approved_at,
    approved_by,
    notes
  ) VALUES (
    p_user_id,
    p_event_year,
    p_document_id,
    'pending',
    clock_timestamp(),
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (user_id, event_year) DO UPDATE
    SET document_id = EXCLUDED.document_id,
        status = 'pending',
        submitted_at = EXCLUDED.submitted_at,
        approved_at = NULL,
        approved_by = NULL,
        notes = NULL
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_under_18_approval(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_under_18_approval(uuid, integer, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Committee under-18 create and decision workflows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.committee_create_under_18_approval(
  p_actor_id uuid,
  p_user_id uuid,
  p_event_year integer,
  p_status text,
  p_notes text
)
RETURNS public.under_18_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_suspended boolean;
  v_actor_roles text[];
  v_event_status text;
  v_subject_suspended boolean;
  v_document_id uuid;
  v_notes text;
  v_result public.under_18_approvals%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_event_year IS NULL THEN
    RAISE EXCEPTION 'Actor, player, and event year are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL
    OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid under-18 approval status.'
      USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'Approval notes exceed the supported length.'
      USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');

  SELECT
    coalesce(profile.suspended, false),
    coalesce(profile.roles, ARRAY[]::text[])
    INTO v_actor_suspended, v_actor_roles
    FROM public.profiles AS profile
   WHERE profile.id = p_actor_id
   FOR SHARE;
  IF NOT FOUND
    OR v_actor_suspended
    OR NOT v_actor_roles && ARRAY[
      'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
    ]::text[] THEN
    RAISE EXCEPTION 'An active committee account is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT event.status
    INTO v_event_status
    FROM public.zltac_events AS event
   WHERE event.year = p_event_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for year.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Only open or closed events can accept under-18 approval changes.'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(profile.suspended, false)
    INTO v_subject_suspended
    FROM public.zltac_registrations AS registration
    JOIN public.profiles AS profile ON profile.id = registration.user_id
   WHERE registration.user_id = p_user_id
     AND registration.year = p_event_year
     AND registration.status IN ('pending', 'confirmed')
   FOR UPDATE OF registration
   FOR SHARE OF profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active event registration is required.'
      USING ERRCODE = '23503';
  END IF;
  IF v_subject_suspended THEN
    RAISE EXCEPTION 'A suspended player cannot receive an under-18 decision.'
      USING ERRCODE = '23514';
  END IF;

  SELECT document.id
    INTO v_document_id
    FROM public.legal_documents AS document
   WHERE document.document_type = 'under_18_form'
     AND document.is_active
     AND document.published_at IS NOT NULL
     AND document.content_sha256 IS NOT NULL
     AND document.object_size IS NOT NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active published under-18 form is required.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM 1
    FROM public.under_18_approvals AS approval
   WHERE approval.user_id = p_user_id
     AND approval.event_year = p_event_year
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'This player already has an approval record for that year.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.under_18_approvals (
    user_id,
    event_year,
    document_id,
    status,
    submitted_at,
    approved_at,
    approved_by,
    notes
  ) VALUES (
    p_user_id,
    p_event_year,
    v_document_id,
    p_status,
    NULL,
    CASE WHEN p_status = 'approved' THEN clock_timestamp() ELSE NULL END,
    CASE WHEN p_status = 'approved' THEN p_actor_id ELSE NULL END,
    v_notes
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.committee_create_under_18_approval(
  uuid, uuid, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.committee_create_under_18_approval(
  uuid, uuid, integer, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.committee_decide_under_18_approval(
  p_actor_id uuid,
  p_approval_id uuid,
  p_status text,
  p_notes text
)
RETURNS public.under_18_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_suspended boolean;
  v_actor_roles text[];
  v_subject_id uuid;
  v_event_year integer;
  v_initial_document_id uuid;
  v_initial_anonymized_at timestamptz;
  v_event_status text;
  v_subject_suspended boolean;
  v_active_document_id uuid;
  v_notes text;
  v_approval public.under_18_approvals%ROWTYPE;
  v_result public.under_18_approvals%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_approval_id IS NULL THEN
    RAISE EXCEPTION 'Actor and approval are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL
    OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid under-18 approval status.'
      USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'Approval notes exceed the supported length.'
      USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');

  SELECT
    coalesce(profile.suspended, false),
    coalesce(profile.roles, ARRAY[]::text[])
    INTO v_actor_suspended, v_actor_roles
    FROM public.profiles AS profile
   WHERE profile.id = p_actor_id
   FOR SHARE;
  IF NOT FOUND
    OR v_actor_suspended
    OR NOT v_actor_roles && ARRAY[
      'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
    ]::text[] THEN
    RAISE EXCEPTION 'An active committee account is required.'
      USING ERRCODE = '42501';
  END IF;

  -- Read identity first so the common lock order can start with the event.
  -- The row is locked and rechecked after its event, registration, and active
  -- form have been locked.
  SELECT
    approval.user_id,
    approval.event_year,
    approval.document_id,
    approval.anonymized_at
    INTO
      v_subject_id,
      v_event_year,
      v_initial_document_id,
      v_initial_anonymized_at
    FROM public.under_18_approvals AS approval
   WHERE approval.id = p_approval_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval record not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_subject_id IS NULL OR v_initial_anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Anonymized under-18 evidence cannot be changed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT event.status
    INTO v_event_status
    FROM public.zltac_events AS event
   WHERE event.year = v_event_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for approval.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Only open or closed events can accept under-18 approval changes.'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(profile.suspended, false)
    INTO v_subject_suspended
    FROM public.zltac_registrations AS registration
    JOIN public.profiles AS profile ON profile.id = registration.user_id
   WHERE registration.user_id = v_subject_id
     AND registration.year = v_event_year
     AND registration.status IN ('pending', 'confirmed')
   FOR UPDATE OF registration
   FOR SHARE OF profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active event registration is required.'
      USING ERRCODE = '23503';
  END IF;
  IF v_subject_suspended THEN
    RAISE EXCEPTION 'A suspended player cannot receive an under-18 decision.'
      USING ERRCODE = '23514';
  END IF;

  SELECT document.id
    INTO v_active_document_id
    FROM public.legal_documents AS document
   WHERE document.document_type = 'under_18_form'
     AND document.is_active
     AND document.published_at IS NOT NULL
     AND document.content_sha256 IS NOT NULL
     AND document.object_size IS NOT NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active published under-18 form is required.'
      USING ERRCODE = '23503';
  END IF;

  SELECT *
    INTO v_approval
    FROM public.under_18_approvals AS approval
   WHERE approval.id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval record not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_approval.user_id IS DISTINCT FROM v_subject_id
    OR v_approval.event_year IS DISTINCT FROM v_event_year
    OR v_approval.document_id IS DISTINCT FROM v_initial_document_id
    OR v_approval.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'The approval identity changed concurrently. Please try again.'
      USING ERRCODE = '40001';
  END IF;

  -- A legacy NULL provenance can be bound during its first committee action.
  -- Never rewrite an existing submission to claim that a newer form was used.
  IF v_approval.document_id IS NOT NULL
    AND v_approval.document_id IS DISTINCT FROM v_active_document_id THEN
    RAISE EXCEPTION 'The player must resubmit the current under-18 form before a decision.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.under_18_approvals AS approval
     SET document_id = coalesce(v_approval.document_id, v_active_document_id),
         status = p_status,
         notes = v_notes,
         approved_at = CASE
           WHEN p_status = 'approved'
             THEN coalesce(v_approval.approved_at, clock_timestamp())
           ELSE NULL
         END,
         approved_by = CASE
           WHEN p_status = 'approved'
             THEN coalesce(v_approval.approved_by, p_actor_id)
           ELSE NULL
         END
   WHERE approval.id = p_approval_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.committee_decide_under_18_approval(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.committee_decide_under_18_approval(
  uuid, uuid, text, text
) TO service_role;

-- SELECT remains available to the server routes. Every evidence mutation now
-- crosses one of the locked functions above, including service-role writes.
REVOKE INSERT, UPDATE, DELETE ON public.legal_acceptances
  FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.under_18_approvals
  FROM anon, authenticated, service_role;

COMMIT;
