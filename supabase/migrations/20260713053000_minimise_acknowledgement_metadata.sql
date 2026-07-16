-- Minimise acknowledgement metadata and preserve ordinary account/event cleanup.
--
-- Code-of-conduct and media-release acceptances are operational
-- acknowledgements, not an indefinite pseudonymous legal-evidence store. Keep
-- the accepted document version, digest, event, account, and timestamp while
-- the account/event exists. Delete the row through the existing CASCADE paths
-- when either owning record is removed.

BEGIN;

-- Request-network metadata is unnecessary for this acknowledgement workflow.
-- Scrub existing values before installing a fail-closed constraint so neither
-- direct SQL nor a future RPC regression can begin collecting it again.
-- The 040000 append-only trigger would correctly reject this one migration
-- update, so suspend and restore it inside the same transaction.
DROP TRIGGER IF EXISTS legal_acceptances_prevent_update
  ON public.legal_acceptances;

UPDATE public.legal_acceptances
   SET ip_address = NULL,
       user_agent = NULL
 WHERE ip_address IS NOT NULL
    OR user_agent IS NOT NULL;

CREATE TRIGGER legal_acceptances_prevent_update
  BEFORE UPDATE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_legal_acceptance_update();

ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_network_metadata_empty,
  ADD CONSTRAINT legal_acceptances_network_metadata_empty
    CHECK (ip_address IS NULL AND user_agent IS NULL) NOT VALID;

ALTER TABLE public.legal_acceptances
  VALIDATE CONSTRAINT legal_acceptances_network_metadata_empty;

COMMENT ON COLUMN public.legal_acceptances.ip_address IS
  'Deprecated compatibility column. A CHECK constraint requires NULL.';
COMMENT ON COLUMN public.legal_acceptances.user_agent IS
  'Deprecated compatibility column. A CHECK constraint requires NULL.';

-- Acknowledgements and under-18 workflow rows remain identified only while
-- their owning profile exists. No nullable subject link, correlation token, or
-- anonymisation marker is introduced.
ALTER TABLE public.legal_acceptances
  ALTER COLUMN user_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_fkey,
  ADD CONSTRAINT legal_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE NOT VALID;

ALTER TABLE public.under_18_approvals
  ALTER COLUMN user_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS under_18_approvals_user_id_fkey,
  ADD CONSTRAINT under_18_approvals_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE NOT VALID;

-- A reviewer account may be removed independently from the player. The
-- approved decision and its time remain coherent after the existing
-- approved_by ON DELETE SET NULL action clears reviewer attribution.
ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_decision_coherent,
  ADD CONSTRAINT under_18_approvals_decision_coherent CHECK (
    (
      status = 'approved'
      AND approved_at IS NOT NULL
    )
    OR
    (
      status IN ('pending', 'rejected')
      AND approved_at IS NULL
      AND approved_by IS NULL
    )
  ) NOT VALID;

-- Hard event deletion is an intentional superadmin workflow. These rows are
-- event-owned and must not turn acknowledgements or under-18 status into an
-- event-deletion blocker.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_event_year_fkey,
  ADD CONSTRAINT legal_acceptances_event_year_fkey
    FOREIGN KEY (event_year) REFERENCES public.zltac_events(year)
    ON DELETE CASCADE NOT VALID;

ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_event_year_fkey,
  ADD CONSTRAINT under_18_approvals_event_year_fkey
    FOREIGN KEY (event_year) REFERENCES public.zltac_events(year)
    ON DELETE CASCADE NOT VALID;

ALTER TABLE public.legal_acceptances
  VALIDATE CONSTRAINT legal_acceptances_user_id_fkey,
  VALIDATE CONSTRAINT legal_acceptances_event_year_fkey;

ALTER TABLE public.under_18_approvals
  VALIDATE CONSTRAINT under_18_approvals_user_id_fkey,
  VALIDATE CONSTRAINT under_18_approvals_event_year_fkey,
  VALIDATE CONSTRAINT under_18_approvals_decision_coherent;

-- Trigger execution does not require callers to invoke the trigger function
-- directly. Keep the append-only UPDATE guard out of every API role's RPC
-- surface, including service_role.
REVOKE ALL ON FUNCTION public.prevent_legal_acceptance_update()
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the publication immutability contract from 040000. The sole exception
-- permits a nested profile-delete trigger to clear uploaded_by before the
-- profile disappears. This avoids retaining an uploader account just because
-- it published an otherwise immutable document version.
CREATE OR REPLACE FUNCTION public.guard_legal_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_controlled_unlink boolean :=
    current_setting('alsa.unlinking_document_uploader', true) = 'on'
    AND pg_trigger_depth() > 1;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION
        'published required documents are immutable (id=%)', OLD.id
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
      'published required document is immutable (id=%); publish a new version instead',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_legal_document_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_legal_documents_immutable
  ON public.legal_documents;
CREATE TRIGGER trg_legal_documents_immutable
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_legal_document_immutable();

CREATE OR REPLACE FUNCTION public.unlink_legal_document_uploader_before_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous_setting text :=
    current_setting('alsa.unlinking_document_uploader', true);
BEGIN
  PERFORM set_config('alsa.unlinking_document_uploader', 'on', true);

  UPDATE public.legal_documents
     SET uploaded_by = NULL
   WHERE uploaded_by = OLD.id;

  PERFORM set_config(
    'alsa.unlinking_document_uploader',
    COALESCE(v_previous_setting, ''),
    true
  );
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'alsa.unlinking_document_uploader',
      COALESCE(v_previous_setting, ''),
      true
    );
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_legal_document_uploader_before_profile_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_unlink_legal_document_uploader
  ON public.profiles;
CREATE TRIGGER profiles_unlink_legal_document_uploader
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.unlink_legal_document_uploader_before_profile_delete();

-- The 040000 acceptance UPDATE guard remains in force. Do not install a DELETE
-- guard: lifecycle deletion is provided by the profile/event CASCADEs and the
-- locked event-deletion RPC, while browser and service roles lack direct DELETE.

COMMIT;
