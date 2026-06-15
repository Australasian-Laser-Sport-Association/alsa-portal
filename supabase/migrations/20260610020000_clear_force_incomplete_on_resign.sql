-- When a player (re)signs the Code of Conduct or Media Release, clear any
-- committee force-incomplete override on their registration so the new
-- attestation actually counts. A force-incomplete (admin_override_* = false)
-- was a committee decision that the prior record did not satisfy the
-- requirement; a fresh signature supersedes it. NULL (follow real completion)
-- and true (force complete) are left untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.clear_force_incomplete_on_resign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_doc_type text;
BEGIN
  SELECT document_type INTO v_doc_type
  FROM public.legal_documents
  WHERE id = NEW.document_id;

  IF v_doc_type = 'code_of_conduct' THEN
    UPDATE public.zltac_registrations
      SET admin_override_coc        = NULL,
          admin_override_coc_reason = NULL,
          admin_override_coc_set_by = NULL,
          admin_override_coc_set_at = NULL
      WHERE user_id = NEW.user_id
        AND year    = NEW.event_year
        AND admin_override_coc = false;
  ELSIF v_doc_type = 'media_release' THEN
    UPDATE public.zltac_registrations
      SET admin_override_media        = NULL,
          admin_override_media_reason = NULL,
          admin_override_media_set_by = NULL,
          admin_override_media_set_at = NULL
      WHERE user_id = NEW.user_id
        AND year    = NEW.event_year
        AND admin_override_media = false;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER clear_force_incomplete_on_resign
  AFTER INSERT OR UPDATE OF accepted_at ON public.legal_acceptances
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_force_incomplete_on_resign();

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- DROP TRIGGER IF EXISTS clear_force_incomplete_on_resign ON public.legal_acceptances;
-- DROP FUNCTION IF EXISTS public.clear_force_incomplete_on_resign();
-- COMMIT;
