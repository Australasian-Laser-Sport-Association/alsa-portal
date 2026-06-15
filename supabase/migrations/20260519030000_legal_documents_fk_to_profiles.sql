-- ============================================================
-- Migration: Re-point legal_* user FKs from auth.users to public.profiles
-- Date: 2026-05-19
-- Purpose:
--   The Phase 1 legal-documents migration (20260519020000) referenced
--   auth.users(id) directly for user FKs. The rest of the project
--   references public.profiles(id) for user FKs. This follow-up swaps
--   the FK targets to match convention.
--
--   profiles.id is 1:1 with auth.users.id (PK references it ON DELETE
--   CASCADE; populated by the handle_new_user() trigger). So:
--     - The column values stay the same.
--     - auth.uid() comparisons in RLS policies continue to work
--       unchanged — auth.uid() returns the uuid that equals both
--       auth.users.id and profiles.id.
--     - Tables are still empty (Phase 2 hasn't shipped), so no data
--       impact.
--
--   ON DELETE behaviour is also aligned with project convention:
--     - NOT NULL user FKs        → ON DELETE CASCADE
--     - Nullable created/by FKs  → ON DELETE SET NULL
-- ============================================================


-- legal_documents.uploaded_by  (nullable: SET NULL)
ALTER TABLE public.legal_documents
  DROP CONSTRAINT IF EXISTS legal_documents_uploaded_by_fkey,
  ADD  CONSTRAINT legal_documents_uploaded_by_fkey
       FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


-- legal_acceptances.user_id  (NOT NULL: CASCADE)
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_fkey,
  ADD  CONSTRAINT legal_acceptances_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


-- under_18_approvals.user_id  (NOT NULL UNIQUE: CASCADE)
ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_user_id_fkey,
  ADD  CONSTRAINT under_18_approvals_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


-- under_18_approvals.approved_by  (nullable: SET NULL)
ALTER TABLE public.under_18_approvals
  DROP CONSTRAINT IF EXISTS under_18_approvals_approved_by_fkey,
  ADD  CONSTRAINT under_18_approvals_approved_by_fkey
       FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
