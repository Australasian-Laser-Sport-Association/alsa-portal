-- Wave A: durable DOB-at-registration and under-18 document provenance.
--
-- This migration remains compatible with the current PlayerHub under-18
-- upsert. Browser users may only create/refresh their own pending submission;
-- they cannot write decision fields or rewrite a decided row. The new
-- document_id stays nullable until the browser moves to the service-only RPC.

BEGIN;

-- ---------------------------------------------------------------------------
-- Registration DOB snapshot
-- ---------------------------------------------------------------------------

ALTER TABLE public.zltac_registrations
  ADD COLUMN IF NOT EXISTS dob_at_registration date;

UPDATE public.zltac_registrations r
   SET dob_at_registration = p.dob
  FROM public.profiles p
 WHERE p.id = r.user_id
   AND r.dob_at_registration IS NULL
   AND p.dob IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.zltac_registrations'::regclass
      AND conname = 'zltac_registrations_dob_snapshot_valid'
  ) THEN
    ALTER TABLE public.zltac_registrations
      ADD CONSTRAINT zltac_registrations_dob_snapshot_valid
      CHECK (
        dob_at_registration IS NOT NULL
        AND dob_at_registration >= DATE '1900-01-01'
        AND dob_at_registration <= created_at::date
      ) NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_zltac_registration_dob_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dob date;
BEGIN
  IF NEW.dob_at_registration IS NULL THEN
    SELECT p.dob
      INTO v_dob
      FROM public.profiles p
     WHERE p.id = NEW.user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registration profile does not exist.'
        USING ERRCODE = '23503';
    END IF;

    NEW.dob_at_registration := v_dob;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_zltac_registration_dob_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.dob_at_registration IS DISTINCT FROM OLD.dob_at_registration THEN
    RAISE EXCEPTION 'Date of birth at registration is an immutable server snapshot.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.set_zltac_registration_dob_snapshot()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.guard_zltac_registration_dob_snapshot()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.set_zltac_registration_dob_snapshot()
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.guard_zltac_registration_dob_snapshot()
  TO service_role;

DROP TRIGGER IF EXISTS zltac_registrations_snapshot_dob
  ON public.zltac_registrations;
CREATE TRIGGER zltac_registrations_snapshot_dob
  BEFORE INSERT ON public.zltac_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_zltac_registration_dob_snapshot();

DROP TRIGGER IF EXISTS zltac_registrations_guard_dob_snapshot
  ON public.zltac_registrations;
CREATE TRIGGER zltac_registrations_guard_dob_snapshot
  BEFORE UPDATE OF dob_at_registration ON public.zltac_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_zltac_registration_dob_snapshot();

-- ---------------------------------------------------------------------------
-- Under-18 approval provenance and decision coherence
-- ---------------------------------------------------------------------------

ALTER TABLE public.under_18_approvals
  ADD COLUMN IF NOT EXISTS document_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.under_18_approvals'::regclass
      AND conname = 'under_18_approvals_document_id_fkey'
  ) THEN
    ALTER TABLE public.under_18_approvals
      ADD CONSTRAINT under_18_approvals_document_id_fkey
      FOREIGN KEY (document_id)
      REFERENCES public.legal_documents(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.under_18_approvals'::regclass
      AND conname = 'under_18_approvals_decision_coherent'
  ) THEN
    ALTER TABLE public.under_18_approvals
      ADD CONSTRAINT under_18_approvals_decision_coherent
      CHECK (
        (
          status = 'approved'
          AND approved_at IS NOT NULL
          AND approved_by IS NOT NULL
        )
        OR
        (
          status IN ('pending', 'rejected')
          AND approved_at IS NULL
          AND approved_by IS NULL
        )
      ) NOT VALID;
  END IF;

END;
$$;

CREATE INDEX IF NOT EXISTS under_18_approvals_document_id_idx
  ON public.under_18_approvals (document_id)
  WHERE document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_under_18_document_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.document_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.legal_documents d
       WHERE d.id = NEW.document_id
         AND d.document_type = 'under_18_form'
     ) THEN
    RAISE EXCEPTION 'Under-18 approvals must reference an under-18 form document.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.guard_under_18_document_reference()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.guard_under_18_document_reference()
  TO service_role;

DROP TRIGGER IF EXISTS under_18_approvals_guard_document_reference
  ON public.under_18_approvals;
CREATE TRIGGER under_18_approvals_guard_document_reference
  BEFORE INSERT OR UPDATE OF document_id ON public.under_18_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_under_18_document_reference();

CREATE OR REPLACE FUNCTION public.guard_under_18_owner_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Committee workflows use the service role and therefore have no auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid()
       OR NEW.status IS DISTINCT FROM 'pending'
       OR NEW.submitted_at IS NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.approved_by IS NOT NULL
       OR NEW.notes IS NOT NULL
       OR NEW.document_id IS NOT NULL THEN
      RAISE EXCEPTION 'Players may only create their own pending under-18 submission.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- Until the API cutover, the existing upsert may refresh submitted_at on an
  -- undecided row. Every identity, provenance, and decision field is pinned.
  IF OLD.user_id IS DISTINCT FROM auth.uid()
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.event_year IS DISTINCT FROM OLD.event_year
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR OLD.status IS DISTINCT FROM 'pending'
     OR NEW.status IS DISTINCT FROM 'pending'
     OR NEW.submitted_at IS NULL
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    RAISE EXCEPTION 'Players may only refresh their own pending under-18 submission.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.guard_under_18_owner_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.guard_under_18_owner_write()
  TO service_role;

DROP TRIGGER IF EXISTS under_18_approvals_guard_owner_write
  ON public.under_18_approvals;
CREATE TRIGGER under_18_approvals_guard_owner_write
  BEFORE INSERT OR UPDATE ON public.under_18_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_under_18_owner_write();

DROP POLICY IF EXISTS under_18_approvals_owner_insert
  ON public.under_18_approvals;
CREATE POLICY under_18_approvals_owner_insert
  ON public.under_18_approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND submitted_at IS NOT NULL
    AND approved_at IS NULL
    AND approved_by IS NULL
    AND notes IS NULL
    AND document_id IS NULL
  );

DROP POLICY IF EXISTS under_18_approvals_owner_update
  ON public.under_18_approvals;
CREATE POLICY under_18_approvals_owner_update
  ON public.under_18_approvals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND submitted_at IS NOT NULL
    AND approved_at IS NULL
    AND approved_by IS NULL
  );

-- API contract:
--   submit_under_18_approval(uuid, integer, uuid)
--   -> public.under_18_approvals
-- The API must derive p_user_id from its verified session. This function is
-- intentionally not callable with an authenticated browser JWT.
CREATE OR REPLACE FUNCTION public.submit_under_18_approval(
  p_user_id uuid,
  p_event_year integer,
  p_document_id uuid
)
RETURNS public.under_18_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dob date;
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
    r.dob_at_registration,
    p.suspended,
    e.start_date,
    e.event_starts_at,
    e.timezone
    INTO v_dob, v_suspended, v_start_date, v_starts_at, v_timezone
    FROM public.zltac_registrations r
    JOIN public.profiles p ON p.id = r.user_id
    JOIN public.zltac_events e ON e.year = r.year
   WHERE r.user_id = p_user_id
     AND r.year = p_event_year
   FOR UPDATE OF r;

  IF NOT FOUND THEN
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

  -- Canonical age cutoff: the event's stored local start_date wins. If it is
  -- absent, convert event_starts_at to the configured IANA timezone and use
  -- that local date. Missing/invalid event configuration fails closed.
  IF v_start_date IS NOT NULL THEN
    v_cutoff_date := v_start_date;
  ELSIF v_starts_at IS NOT NULL
        AND v_timezone IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_timezone_names WHERE name = v_timezone
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

  -- Construct from the first of the birth month so 29 February normalises to
  -- 1 March in a non-leap eighteenth year, matching the browser/API contract.
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
    FROM public.legal_documents d
   WHERE d.id = p_document_id
     AND d.document_type = 'under_18_form'
     AND d.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The under-18 document is not active.'
      USING ERRCODE = '23503';
  END IF;

  SELECT a.status
    INTO v_existing_status
    FROM public.under_18_approvals a
   WHERE a.user_id = p_user_id
     AND a.event_year = p_event_year
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

REVOKE ALL PRIVILEGES
  ON FUNCTION public.submit_under_18_approval(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.submit_under_18_approval(uuid, integer, uuid)
  TO service_role;

COMMIT;
