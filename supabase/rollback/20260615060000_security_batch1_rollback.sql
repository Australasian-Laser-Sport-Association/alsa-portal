-- Emergency rollback for 20260615060000_security_batch1.sql.
-- Run application rollback first so signing returns to the old upsert path.
-- This stops if duplicate attestations now exist because deleting legal evidence
-- automatically would be unacceptable.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.legal_acceptances
    GROUP BY user_id, document_id, event_year
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'duplicate legal attestations exist; do not restore the unique constraint until they are preserved and reconciled';
  END IF;
END $$;

DROP INDEX IF EXISTS public.legal_acceptances_user_document_year_accepted_idx;

ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_user_id_document_id_event_year_key
  UNIQUE (user_id, document_id, event_year);

GRANT INSERT, UPDATE, DELETE ON public.legal_acceptances TO authenticated;

DROP POLICY IF EXISTS legal_acceptances_committee_read ON public.legal_acceptances;
CREATE POLICY legal_acceptances_insert_own ON public.legal_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY legal_acceptances_update_own ON public.legal_acceptances
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY legal_acceptances_committee_all ON public.legal_acceptances
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

-- If suspension enforcement is still installed, restore its restrictive
-- guards alongside the reopened authenticated write path.
DO $$
BEGIN
  IF to_regprocedure('public.is_active_user()') IS NOT NULL THEN
    CREATE POLICY active_user_insert ON public.legal_acceptances
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.is_active_user());
    CREATE POLICY active_user_update ON public.legal_acceptances
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.is_active_user())
      WITH CHECK (public.is_active_user());
    CREATE POLICY active_user_delete ON public.legal_acceptances
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.is_active_user());
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('rollout_20260615.storage_bucket_config') IS NOT NULL THEN
    UPDATE storage.buckets b
    SET public = snapshot.public,
        file_size_limit = snapshot.file_size_limit,
        allowed_mime_types = snapshot.allowed_mime_types
    FROM rollout_20260615.storage_bucket_config snapshot
    WHERE b.id = snapshot.id;
  END IF;

  IF to_regclass('rollout_20260615.team_svg_references') IS NOT NULL THEN
    UPDATE public.teams target
    SET logo_url = snapshot.logo_url
    FROM rollout_20260615.team_svg_references snapshot
    WHERE target.id = snapshot.id;
  END IF;

  IF to_regclass('rollout_20260615.referee_svg_references') IS NOT NULL THEN
    UPDATE public.referee_questions target
    SET image_url = snapshot.image_url
    FROM rollout_20260615.referee_svg_references snapshot
    WHERE target.id = snapshot.id;
  END IF;
END $$;

COMMIT;
