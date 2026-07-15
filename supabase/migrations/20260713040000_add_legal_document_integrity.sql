-- Add cryptographic and publication evidence to required legal documents.
--
-- Existing rows remain readable to committee as legacy drafts. They are not
-- publicly served until a new immutable version is published through the
-- service-only publish_legal_document() function.

BEGIN;

ALTER TABLE public.legal_documents
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS object_size bigint,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS content_sha256 text;

ALTER TABLE public.legal_documents
  DROP CONSTRAINT IF EXISTS legal_documents_published_integrity,
  ADD CONSTRAINT legal_documents_published_integrity CHECK (
    (
      published_at IS NULL
      AND content_sha256 IS NULL
      AND object_size IS NULL
    )
    OR
    (
      published_at IS NOT NULL
      AND content_sha256 ~ '^[0-9a-f]{64}$'
      AND object_size BETWEEN 8 AND 4194304
      AND file_path ~ '^legal/(code_of_conduct|media_release|under_18_form)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
    )
  ) NOT VALID;

-- This can be validated after every legacy active row has been superseded by
-- a server-published version. NOT VALID still enforces the rule for all new or
-- changed rows.
ALTER TABLE public.legal_documents
  DROP CONSTRAINT IF EXISTS legal_documents_active_requires_publication,
  ADD CONSTRAINT legal_documents_active_requires_publication
    CHECK (NOT is_active OR published_at IS NOT NULL) NOT VALID;

ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_content_sha256_format,
  ADD CONSTRAINT legal_acceptances_content_sha256_format
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$') NOT VALID,
  DROP CONSTRAINT IF EXISTS legal_acceptances_content_sha256_required,
  ADD CONSTRAINT legal_acceptances_content_sha256_required
    CHECK (content_sha256 IS NOT NULL) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_published_file_path_uidx
  ON public.legal_documents (file_path)
  WHERE published_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_one_active_published_type_uidx
  ON public.legal_documents (document_type)
  WHERE is_active AND published_at IS NOT NULL;

-- Published evidence cannot be rewritten or removed. is_active remains the
-- only lifecycle flag that publication workflows may change later.
CREATE OR REPLACE FUNCTION public.guard_legal_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION
        'published required documents are immutable (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
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
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_legal_documents_immutable_delete
  ON public.legal_documents;
CREATE TRIGGER trg_legal_documents_immutable_delete
  BEFORE DELETE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_legal_document_immutable();

-- The database derives the acceptance digest from the locked active document.
-- A caller cannot substitute a digest, and publication cannot race the insert.
CREATE OR REPLACE FUNCTION public.stamp_legal_acceptance_content_sha256()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_digest text;
BEGIN
  SELECT d.content_sha256
    INTO v_digest
    FROM public.legal_documents AS d
   WHERE d.id = NEW.document_id
     AND d.is_active
     AND d.published_at IS NOT NULL
     AND d.content_sha256 IS NOT NULL
   FOR SHARE;

  IF v_digest IS NULL THEN
    RAISE EXCEPTION
      'required document is not an active published version'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.content_sha256 := v_digest;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_legal_acceptance_content_sha256()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS legal_acceptances_stamp_content_sha256
  ON public.legal_acceptances;
CREATE TRIGGER legal_acceptances_stamp_content_sha256
  BEFORE INSERT ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.stamp_legal_acceptance_content_sha256();

CREATE OR REPLACE FUNCTION public.prevent_legal_acceptance_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION
    'acknowledgement records are append-only (id=%)', OLD.id
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_legal_acceptance_update()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS legal_acceptances_prevent_update
  ON public.legal_acceptances;
CREATE TRIGGER legal_acceptances_prevent_update
  BEFORE UPDATE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_legal_acceptance_update();

-- Publication is the sole database transition that assigns evidence metadata,
-- versions a document, deactivates its predecessor, and activates the new row.
CREATE OR REPLACE FUNCTION public.publish_legal_document(
  p_document_type text,
  p_file_path text,
  p_original_filename text,
  p_effective_date date,
  p_uploaded_by uuid,
  p_requires_reacceptance boolean,
  p_notes text,
  p_content_sha256 text,
  p_object_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_next_version integer;
  v_document public.legal_documents;
  v_path_pattern text;
BEGIN
  IF p_document_type NOT IN (
    'code_of_conduct', 'media_release', 'under_18_form'
  ) THEN
    RAISE EXCEPTION 'invalid required document type'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_uploaded_by IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.profiles AS p
     WHERE p.id = p_uploaded_by
       AND NOT COALESCE(p.suspended, false)
       AND p.roles && ARRAY[
         'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
       ]::text[]
  ) THEN
    RAISE EXCEPTION 'publisher is not an active committee account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_path_pattern := '^legal/' || p_document_type ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$';

  IF p_file_path IS NULL OR p_file_path !~ v_path_pattern THEN
    RAISE EXCEPTION 'required document path must be a generated UUID PDF path'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_original_filename IS NULL
    OR length(btrim(p_original_filename)) NOT BETWEEN 1 AND 255
    OR p_original_filename ~ '[\\/]'
    OR p_original_filename ~ '[[:cntrl:]]'
    OR lower(p_original_filename) NOT LIKE '%.pdf' THEN
    RAISE EXCEPTION 'invalid original PDF filename'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'effective date is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_content_sha256 IS NULL OR p_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid SHA-256 digest'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_object_size IS NULL OR p_object_size NOT BETWEEN 8 AND 4194304 THEN
    RAISE EXCEPTION 'required PDF size is outside the supported range'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'notes are too long'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.legal_documents:' || p_document_type)
  );

  SELECT COALESCE(max(d.version), 0) + 1
    INTO v_next_version
    FROM public.legal_documents AS d
   WHERE d.document_type = p_document_type;

  UPDATE public.legal_documents
     SET is_active = false
   WHERE document_type = p_document_type
     AND is_active;

  INSERT INTO public.legal_documents (
    document_type,
    version,
    file_path,
    original_filename,
    effective_date,
    uploaded_by,
    uploaded_at,
    is_active,
    requires_reacceptance,
    notes,
    content_sha256,
    object_size,
    published_at
  ) VALUES (
    p_document_type,
    v_next_version,
    p_file_path,
    btrim(p_original_filename),
    p_effective_date,
    p_uploaded_by,
    clock_timestamp(),
    true,
    COALESCE(p_requires_reacceptance, true),
    NULLIF(btrim(p_notes), ''),
    p_content_sha256,
    p_object_size,
    clock_timestamp()
  )
  RETURNING * INTO v_document;

  RETURN to_jsonb(v_document);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_legal_document(
  text, text, text, date, uuid, boolean, text, text, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_legal_document(
  text, text, text, date, uuid, boolean, text, text, bigint
) TO service_role;

-- The final server route is deployed at the acknowledgement-expand checkpoint and
-- reconciles every publication before returning success. Keep this companion
-- function in the same expansion migration as publish_legal_document(); if it
-- were deferred until the later lifecycle phase, a committed phase-1 publish
-- would be reported as a server failure.
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
    RAISE EXCEPTION 'Complete required document identity is required.'
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

-- Browsers may read only active, fully-published catalogue rows. All legal
-- document writes now go through the authenticated server API.
DROP POLICY IF EXISTS legal_documents_public_read
  ON public.legal_documents;
DROP POLICY IF EXISTS legal_documents_committee_write
  ON public.legal_documents;
DROP POLICY IF EXISTS legal_documents_committee_read
  ON public.legal_documents;
DROP POLICY IF EXISTS legal_documents_acceptance_owner_read
  ON public.legal_documents;

CREATE POLICY legal_documents_public_read
  ON public.legal_documents
  FOR SELECT TO anon, authenticated
  USING (
    is_active
    AND published_at IS NOT NULL
    AND content_sha256 IS NOT NULL
    AND object_size IS NOT NULL
  );

CREATE POLICY legal_documents_committee_read
  ON public.legal_documents
  FOR SELECT TO authenticated
  USING (public.is_committee());

-- A player may still see metadata for an inactive version they personally
-- accepted. The private asset endpoint remains active-publication-only, so
-- this does not expose retired PDF content.
CREATE POLICY legal_documents_acceptance_owner_read
  ON public.legal_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.legal_acceptances AS acceptance
       WHERE acceptance.document_id = legal_documents.id
         AND acceptance.user_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.legal_documents FROM authenticated;
GRANT SELECT ON public.legal_documents TO anon, authenticated;

COMMIT;
