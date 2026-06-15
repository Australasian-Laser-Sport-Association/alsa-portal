-- Security remediation batch 1:
--   * legal acceptances are append-only and written through the server API
--   * active SVG content is no longer accepted in public media buckets
--   * existing SVG database references are detached from user-facing records

BEGIN;

-- Legal acceptances are evidence records. The browser only needs SELECT access;
-- the authenticated API derives user_id and writes with the service role.
DROP POLICY IF EXISTS legal_acceptances_insert_own ON public.legal_acceptances;
DROP POLICY IF EXISTS legal_acceptances_update_own ON public.legal_acceptances;
DROP POLICY IF EXISTS legal_acceptances_committee_all ON public.legal_acceptances;
DROP POLICY IF EXISTS active_user_insert ON public.legal_acceptances;
DROP POLICY IF EXISTS active_user_update ON public.legal_acceptances;
DROP POLICY IF EXISTS active_user_delete ON public.legal_acceptances;

REVOKE INSERT, UPDATE, DELETE ON public.legal_acceptances FROM authenticated;

CREATE POLICY legal_acceptances_committee_read ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (public.is_committee());

-- Preserve every re-attestation instead of overwriting the previous evidence.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_document_id_event_year_key;

CREATE INDEX IF NOT EXISTS legal_acceptances_user_document_year_accepted_idx
  ON public.legal_acceptances (user_id, document_id, event_year, accepted_at DESC);

-- SVG is active document content, not a safe public-upload image format.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'team-logos';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'
]
WHERE id = 'referee-test-media';

-- Stop the application from presenting any previously uploaded SVG objects.
-- The storage objects are removed separately through the Storage API so object
-- metadata and backing storage stay consistent.
UPDATE public.teams
SET logo_url = NULL
WHERE logo_url IS NOT NULL
  AND lower(split_part(logo_url, '?', 1)) LIKE '%.svg';

UPDATE public.referee_questions
SET image_url = NULL
WHERE image_url IS NOT NULL
  AND lower(split_part(image_url, '?', 1)) LIKE '%.svg';

COMMIT;
