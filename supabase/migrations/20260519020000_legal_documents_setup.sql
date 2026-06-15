-- ============================================================
-- Migration: Legal documents framework — Phase 1 (schema + storage)
-- Date: 2026-05-19
-- Purpose:
--   Set up the schema, Storage bucket, and RLS for managing legal
--   documents (Code of Conduct, Media Release, Under 18 form) as
--   versioned PDFs uploaded by committee.
--
--   Phase 1 (this migration) — schema, RLS, storage bucket only.
--   Phase 2 — admin upload / version / publish UI.
--   Phase 3 — player hub display + acceptance flow.
--   No data is seeded; committee uploads PDFs via Phase 2 admin UI.
--
--   This new framework will eventually replace the legacy
--   code_of_conduct_versions / media_release_versions /
--   under18_form_versions + their *_signatures / *_submissions tables
--   from the initial schema. Both coexist until Phase 2/3 ship.
--
-- File path convention (enforced by application, not the bucket):
--
--   {document_type}/v{version}/{slugified-filename}.pdf
--
--   e.g.  code_of_conduct/v3/code-of-conduct-2026.pdf
--         media_release/v1/media-release.pdf
--         under_18_form/v2/under-18-parental-consent.pdf
--
-- FK convention note:
--   Per Phase 1 spec, legal_acceptances.user_id, legal_documents.uploaded_by,
--   under_18_approvals.user_id, and under_18_approvals.approved_by all
--   reference auth.users(id) directly. This is a deliberate departure
--   from the project's convention of referencing public.profiles(id);
--   joins to profile fields (name, alias) need an extra hop.
-- ============================================================


-- -----------------------------------------------------------------------------
-- 1. Storage bucket: legal-documents
-- -----------------------------------------------------------------------------
-- Public-readable (PDFs are publicly distributable). Writes are committee-only
-- via the is_committee() helper. 10 MB cap; PDF mime type only.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'legal-documents',
  'legal-documents',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS legal_docs_bucket_committee_write ON storage.objects;
DROP POLICY IF EXISTS legal_docs_bucket_public_read     ON storage.objects;

CREATE POLICY legal_docs_bucket_committee_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'legal-documents' AND public.is_committee())
  WITH CHECK (bucket_id = 'legal-documents' AND public.is_committee());

CREATE POLICY legal_docs_bucket_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'legal-documents');


-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- legal_documents: one row per (document_type, version). is_active marks the
-- currently-served version. requires_reacceptance flags substantive changes
-- that should re-prompt previously-accepted users.
CREATE TABLE public.legal_documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type          text NOT NULL
                           CHECK (document_type IN ('code_of_conduct', 'media_release', 'under_18_form')),
  version                integer NOT NULL,
  file_path              text NOT NULL,
  original_filename      text NOT NULL,
  effective_date         date NOT NULL,
  uploaded_by            uuid REFERENCES auth.users(id),
  uploaded_at            timestamptz NOT NULL DEFAULT now(),
  is_active              boolean NOT NULL DEFAULT true,
  requires_reacceptance  boolean NOT NULL DEFAULT false,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);

CREATE INDEX legal_documents_type_active_idx
  ON public.legal_documents (document_type, is_active);


-- legal_acceptances: immutable audit trail. One row per (user, document).
-- ip_address and user_agent are captured at acceptance time for compliance.
CREATE TABLE public.legal_acceptances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  ip_address   inet,
  user_agent   text,
  UNIQUE (user_id, document_id)
);

CREATE INDEX legal_acceptances_user_idx ON public.legal_acceptances (user_id);


-- under_18_approvals: one row per under-18 user. Status transitions are
-- committee-driven. submitted_at is set when the player flags they've emailed
-- the signed form; nullable so committee can also approve directly without
-- a player-side submission step.
CREATE TABLE public.under_18_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid REFERENCES auth.users(id),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 3. updated_at triggers
-- -----------------------------------------------------------------------------
-- legal_acceptances has no updated_at — acceptances are immutable.

CREATE TRIGGER legal_documents_touch_updated_at
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER under_18_approvals_touch_updated_at
  BEFORE UPDATE ON public.under_18_approvals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 4. GRANTs (mirrors role_grants_baseline.sql pattern)
-- -----------------------------------------------------------------------------

-- legal_documents: anyone can read the catalogue; only service_role / committee
-- (via RLS) writes.
GRANT SELECT ON public.legal_documents TO anon, authenticated;
GRANT ALL    ON public.legal_documents TO service_role;

-- legal_acceptances: authenticated users insert/read own rows (constrained by
-- RLS). Committee admin operations flow through service_role.
GRANT SELECT, INSERT ON public.legal_acceptances TO authenticated;
GRANT ALL            ON public.legal_acceptances TO service_role;

-- under_18_approvals: authenticated users read their own row only. All writes
-- are committee-driven via service_role.
GRANT SELECT ON public.under_18_approvals TO authenticated;
GRANT ALL    ON public.under_18_approvals TO service_role;


-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.legal_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.under_18_approvals  ENABLE ROW LEVEL SECURITY;


-- legal_documents: public read; committee for all (defence-in-depth backstop —
-- writes typically go via service_role from /api/admin/* routes).
CREATE POLICY legal_documents_public_read ON public.legal_documents
  FOR SELECT
  USING (true);

CREATE POLICY legal_documents_committee_write ON public.legal_documents
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- legal_acceptances: users SELECT/INSERT own rows. No UPDATE for users —
-- acceptances are immutable. Committee FOR ALL covers admin tooling.
CREATE POLICY legal_acceptances_select_own ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY legal_acceptances_insert_own ON public.legal_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY legal_acceptances_committee_all ON public.legal_acceptances
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- under_18_approvals: users SELECT own only. Inserts/updates are committee-only.
CREATE POLICY under_18_approvals_select_own ON public.under_18_approvals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY under_18_approvals_committee_all ON public.under_18_approvals
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());
