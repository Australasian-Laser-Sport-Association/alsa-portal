-- Guard legal document identity fields.
--
-- Required documents are versioned by inserting a new legal_documents row and
-- deactivating older rows. This trigger prevents out-of-band edits from
-- rewriting what an existing acceptance points at.

CREATE OR REPLACE FUNCTION public.guard_legal_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version
    OR NEW.document_type IS DISTINCT FROM OLD.document_type
    OR NEW.file_path IS DISTINCT FROM OLD.file_path
    OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
    OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
  THEN
    RAISE EXCEPTION
      'legal_documents identity columns are immutable (id=%); create a new version row instead',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_legal_document_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_legal_documents_immutable ON public.legal_documents;
CREATE TRIGGER trg_legal_documents_immutable
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_legal_document_immutable();
