-- Preserve legal acceptance and under-18 decision evidence when an account is
-- permanently deleted. The retained rows are pseudonymous: their subject and
-- reviewer profile links are severed, direct identifiers are scrubbed, and an
-- opaque per-subject token preserves correlation between that subject's rows.

BEGIN;

ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS subject_token uuid,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

ALTER TABLE public.under_18_approvals
  ADD COLUMN IF NOT EXISTS subject_token uuid,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewer_unlinked_at timestamptz;

ALTER TABLE public.legal_acceptances
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.under_18_approvals
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_subject_state_valid,
  ADD CONSTRAINT legal_acceptances_subject_state_valid CHECK (
    (
      user_id IS NOT NULL
      AND subject_token IS NULL
      AND anonymized_at IS NULL
    )
    OR
    (
      user_id IS NULL
      AND subject_token IS NOT NULL
      AND anonymized_at IS NOT NULL
      AND ip_address IS NULL
      AND user_agent IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_subject_state_valid,
  ADD CONSTRAINT under_18_approvals_subject_state_valid CHECK (
    (
      user_id IS NOT NULL
      AND subject_token IS NULL
      AND anonymized_at IS NULL
    )
    OR
    (
      user_id IS NULL
      AND subject_token IS NOT NULL
      AND anonymized_at IS NOT NULL
      AND notes IS NULL
      AND approved_by IS NULL
    )
  ) NOT VALID;

-- An approved decision remains coherent after its reviewer's account link is
-- severed. reviewer_unlinked_at records that controlled lifecycle event without
-- retaining another person identifier.
ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_decision_coherent,
  ADD CONSTRAINT under_18_approvals_decision_coherent CHECK (
    (
      status = 'approved'
      AND approved_at IS NOT NULL
      AND (approved_by IS NOT NULL OR reviewer_unlinked_at IS NOT NULL)
    )
    OR
    (
      status IN ('pending', 'rejected')
      AND approved_at IS NULL
      AND approved_by IS NULL
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS legal_acceptances_subject_token_idx
  ON public.legal_acceptances (subject_token)
  WHERE subject_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS under_18_approvals_subject_token_idx
  ON public.under_18_approvals (subject_token)
  WHERE subject_token IS NOT NULL;

COMMENT ON COLUMN public.legal_acceptances.subject_token IS
  'Opaque per-subject token retained after account deletion; not an account identifier.';
COMMENT ON COLUMN public.legal_acceptances.anonymized_at IS
  'When direct subject identifiers were removed. Retention duration awaits an approved schedule.';
COMMENT ON COLUMN public.under_18_approvals.subject_token IS
  'Opaque per-subject token retained after account deletion; not an account identifier.';
COMMENT ON COLUMN public.under_18_approvals.anonymized_at IS
  'When direct subject identifiers and free-text notes were removed. Retention duration awaits an approved schedule.';
COMMENT ON COLUMN public.under_18_approvals.reviewer_unlinked_at IS
  'When an approval reviewer profile link was removed during account deletion.';

-- A profile delete first severs the subject links. RESTRICT then prevents any
-- delete path that does not pass through that controlled trigger workflow.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_fkey,
  ADD CONSTRAINT legal_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_user_id_fkey,
  ADD CONSTRAINT under_18_approvals_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id)
    ON DELETE RESTRICT NOT VALID;

-- Events with retained evidence must be archived. Both the explicit DELETEs
-- in delete_zltac_event() and these RESTRICT constraints prevent hard deletion.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_event_year_fkey,
  ADD CONSTRAINT legal_acceptances_event_year_fkey
    FOREIGN KEY (event_year) REFERENCES public.zltac_events(year)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_event_year_fkey,
  ADD CONSTRAINT under_18_approvals_event_year_fkey
    FOREIGN KEY (event_year) REFERENCES public.zltac_events(year)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.legal_acceptances
  VALIDATE CONSTRAINT legal_acceptances_user_id_fkey,
  VALIDATE CONSTRAINT legal_acceptances_event_year_fkey,
  VALIDATE CONSTRAINT legal_acceptances_subject_state_valid;

ALTER TABLE public.under_18_approvals
  VALIDATE CONSTRAINT under_18_approvals_user_id_fkey,
  VALIDATE CONSTRAINT under_18_approvals_event_year_fkey,
  VALIDATE CONSTRAINT under_18_approvals_subject_state_valid;

-- Keep the 40000 publication immutability contract. The sole new exception is
-- a nested, profile-delete-triggered uploaded_by unlink. The updated_at touch
-- trigger may also advance during that controlled update.
CREATE OR REPLACE FUNCTION public.guard_legal_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_controlled_unlink boolean :=
    current_setting('app.anonymizing_legal_evidence', true) = 'on'
    AND pg_trigger_depth() > 1;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION
        'published legal documents are immutable (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF v_controlled_unlink
    AND OLD.uploaded_by IS NOT NULL
    AND NEW.uploaded_by IS NULL
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.version IS NOT DISTINCT FROM OLD.version
    AND NEW.document_type IS NOT DISTINCT FROM OLD.document_type
    AND NEW.file_path IS NOT DISTINCT FROM OLD.file_path
    AND NEW.original_filename IS NOT DISTINCT FROM OLD.original_filename
    AND NEW.effective_date IS NOT DISTINCT FROM OLD.effective_date
    AND NEW.uploaded_at IS NOT DISTINCT FROM OLD.uploaded_at
    AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
    AND NEW.requires_reacceptance IS NOT DISTINCT FROM OLD.requires_reacceptance
    AND NEW.notes IS NOT DISTINCT FROM OLD.notes
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND NEW.content_sha256 IS NOT DISTINCT FROM OLD.content_sha256
    AND NEW.object_size IS NOT DISTINCT FROM OLD.object_size
    AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
  THEN
    RETURN NEW;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version
    OR NEW.document_type IS DISTINCT FROM OLD.document_type
    OR NEW.file_path IS DISTINCT FROM OLD.file_path
    OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
    OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
    OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
    OR NEW.requires_reacceptance IS DISTINCT FROM OLD.requires_reacceptance
    OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
    OR NEW.object_size IS DISTINCT FROM OLD.object_size
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  THEN
    RAISE EXCEPTION
      'legal document evidence is immutable (id=%); publish a new version instead',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_legal_document_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

-- Recreate both sides of the invariant explicitly rather than depending on
-- the older migration that first installed the UPDATE trigger.
DROP TRIGGER IF EXISTS trg_legal_documents_immutable
  ON public.legal_documents;
CREATE TRIGGER trg_legal_documents_immutable
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_legal_document_immutable();

-- Legal acceptances stay append-only. A nested profile deletion may perform
-- exactly one transition from identified to pseudonymous evidence. Every later
-- update and every delete remains prohibited, including for service_role.
CREATE OR REPLACE FUNCTION public.prevent_legal_acceptance_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_controlled_anonymization boolean :=
    current_setting('app.anonymizing_legal_evidence', true) = 'on'
    AND pg_trigger_depth() > 1;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Retained legal acceptance evidence cannot be deleted. Archive the related event instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_controlled_anonymization
    AND OLD.user_id IS NOT NULL
    AND NEW.user_id IS NULL
    AND OLD.subject_token IS NULL
    AND NEW.subject_token IS NOT NULL
    AND OLD.anonymized_at IS NULL
    AND NEW.anonymized_at IS NOT NULL
    AND NEW.ip_address IS NULL
    AND NEW.user_agent IS NULL
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
    AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at
    AND NEW.event_year IS NOT DISTINCT FROM OLD.event_year
    AND NEW.content_sha256 IS NOT DISTINCT FROM OLD.content_sha256
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'legal acceptance evidence is append-only (id=%)', OLD.id
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_legal_acceptance_update()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS legal_acceptances_prevent_update
  ON public.legal_acceptances;
CREATE TRIGGER legal_acceptances_prevent_update
  BEFORE UPDATE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_legal_acceptance_update();

DROP TRIGGER IF EXISTS legal_acceptances_prevent_delete
  ON public.legal_acceptances;
CREATE TRIGGER legal_acceptances_prevent_delete
  BEFORE DELETE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_legal_acceptance_update();

CREATE OR REPLACE FUNCTION public.guard_under_18_evidence_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_controlled_unlink boolean :=
    current_setting('app.anonymizing_legal_evidence', true) = 'on'
    AND pg_trigger_depth() > 1;
  v_reviewer_unchanged boolean;
  v_reviewer_unlinked boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Retained under-18 decision evidence cannot be deleted. Archive the related event instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.subject_token IS NOT NULL
      OR NEW.anonymized_at IS NOT NULL
      OR NEW.reviewer_unlinked_at IS NOT NULL THEN
      RAISE EXCEPTION
        'under-18 retention markers are assigned only during account deletion'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_reviewer_unchanged :=
    NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
    AND NEW.reviewer_unlinked_at IS NOT DISTINCT FROM OLD.reviewer_unlinked_at;
  v_reviewer_unlinked :=
    OLD.approved_by IS NOT NULL
    AND NEW.approved_by IS NULL
    AND NEW.reviewer_unlinked_at IS NOT NULL;

  -- Exact subject anonymization. Reviewer attribution is always severed on an
  -- anonymized subject row, so that row is fully locked from this point on.
  IF v_controlled_unlink
    AND OLD.user_id IS NOT NULL
    AND NEW.user_id IS NULL
    AND OLD.subject_token IS NULL
    AND NEW.subject_token IS NOT NULL
    AND OLD.anonymized_at IS NULL
    AND NEW.anonymized_at IS NOT NULL
    AND NEW.notes IS NULL
    AND NEW.approved_by IS NULL
    AND (v_reviewer_unchanged OR v_reviewer_unlinked)
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
    AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
    AND NEW.event_year IS NOT DISTINCT FROM OLD.event_year
    AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
  THEN
    RETURN NEW;
  END IF;

  -- A reviewer account may be deleted while the evidence subject remains.
  -- Only the reviewer FK and its unlink timestamp may change in that path.
  IF v_controlled_unlink
    AND v_reviewer_unlinked
    AND OLD.anonymized_at IS NULL
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    AND NEW.subject_token IS NOT DISTINCT FROM OLD.subject_token
    AND NEW.anonymized_at IS NOT DISTINCT FROM OLD.anonymized_at
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
    AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
    AND NEW.notes IS NOT DISTINCT FROM OLD.notes
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
    AND NEW.event_year IS NOT DISTINCT FROM OLD.event_year
    AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
  THEN
    RETURN NEW;
  END IF;

  IF OLD.anonymized_at IS NOT NULL
    OR NEW.user_id IS NULL
    OR NEW.subject_token IS NOT NULL
    OR NEW.anonymized_at IS NOT NULL
    OR NEW.reviewer_unlinked_at IS DISTINCT FROM OLD.reviewer_unlinked_at THEN
    RAISE EXCEPTION
      'retained under-18 decision evidence is immutable (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_under_18_evidence_retention()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS under_18_approvals_preserve_evidence
  ON public.under_18_approvals;
CREATE TRIGGER under_18_approvals_preserve_evidence
  BEFORE INSERT OR UPDATE OR DELETE ON public.under_18_approvals
  FOR EACH ROW EXECUTE FUNCTION public.guard_under_18_evidence_retention();

CREATE OR REPLACE FUNCTION public.anonymize_legal_evidence_before_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subject_token uuid := gen_random_uuid();
  v_unlinked_at timestamptz := clock_timestamp();
  v_previous_setting text :=
    current_setting('app.anonymizing_legal_evidence', true);
BEGIN
  PERFORM set_config('app.anonymizing_legal_evidence', 'on', true);

  -- uploaded_by is an account FK on immutable document evidence. Only this
  -- nested lifecycle update may clear it.
  UPDATE public.legal_documents
     SET uploaded_by = NULL
   WHERE uploaded_by = OLD.id;

  UPDATE public.legal_acceptances
     SET user_id = NULL,
         subject_token = v_subject_token,
         anonymized_at = v_unlinked_at,
         ip_address = NULL,
         user_agent = NULL
   WHERE user_id = OLD.id;

  UPDATE public.under_18_approvals
     SET user_id = CASE WHEN user_id = OLD.id THEN NULL ELSE user_id END,
         subject_token = CASE
           WHEN user_id = OLD.id THEN v_subject_token ELSE subject_token
         END,
         anonymized_at = CASE
           WHEN user_id = OLD.id THEN v_unlinked_at ELSE anonymized_at
         END,
         notes = CASE WHEN user_id = OLD.id THEN NULL ELSE notes END,
         approved_by = CASE
           WHEN user_id = OLD.id OR approved_by = OLD.id THEN NULL
           ELSE approved_by
         END,
         reviewer_unlinked_at = CASE
           WHEN approved_by IS NOT NULL
             AND (user_id = OLD.id OR approved_by = OLD.id)
             THEN v_unlinked_at
           ELSE reviewer_unlinked_at
         END
   WHERE user_id = OLD.id
      OR approved_by = OLD.id;

  PERFORM set_config(
    'app.anonymizing_legal_evidence',
    COALESCE(v_previous_setting, ''),
    true
  );
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'app.anonymizing_legal_evidence',
      COALESCE(v_previous_setting, ''),
      true
    );
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_legal_evidence_before_profile_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_anonymize_retained_legal_evidence
  ON public.profiles;
CREATE TRIGGER profiles_anonymize_retained_legal_evidence
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.anonymize_legal_evidence_before_profile_delete();

COMMIT;
