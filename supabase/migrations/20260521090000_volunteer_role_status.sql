-- =============================================================================
-- Volunteer system — Phase 4: per-role approval workflow.
--
-- Decisions are per-role: a single signup can have AEC approved, TC declined,
-- and COM pending at the same time. All existing role-rows default to 'pending'.
--
-- Apply pattern (matching Phase 1): this file is committed to the repo but NOT
-- pushed via the CLI — paste it into the Supabase SQL Editor and run manually.
-- =============================================================================

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.volunteer_signup_roles
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  ADD COLUMN decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN decided_at TIMESTAMPTZ;

CREATE INDEX volunteer_signup_roles_status_idx ON public.volunteer_signup_roles (status);

-- ── 2. RLS rework ────────────────────────────────────────────────────────────
-- Phase 1 used a single owner policy `volunteer_signup_roles_own` FOR ALL. Its
-- USING clause governs SELECT as well as DELETE, so we can't simply add a
-- `status = 'pending'` predicate there — that would also hide decided rows from
-- the owner, who must see their own approvals/declines. Split it into granular
-- per-command owner policies. Committee read/delete policies are unchanged.
DROP POLICY IF EXISTS "volunteer_signup_roles_own" ON public.volunteer_signup_roles;

-- Owner reads all their own role-rows (any status).
CREATE POLICY "volunteer_signup_roles_own_select" ON public.volunteer_signup_roles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.volunteer_signups s
    JOIN public.zltac_registrations r ON r.id = s.registration_id
    WHERE s.id = signup_id AND r.user_id = auth.uid()
  ));

-- Owner adds roles to their own signup; new rows must start 'pending'.
CREATE POLICY "volunteer_signup_roles_own_insert" ON public.volunteer_signup_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.volunteer_signups s
      JOIN public.zltac_registrations r ON r.id = s.registration_id
      WHERE s.id = signup_id AND r.user_id = auth.uid()
    )
  );

-- Owner removes only undecided (pending) role-rows. Decided rows are removable
-- by committee only (via the existing committee delete policy + service role).
CREATE POLICY "volunteer_signup_roles_own_delete" ON public.volunteer_signup_roles
  FOR DELETE TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.volunteer_signups s
      JOIN public.zltac_registrations r ON r.id = s.registration_id
      WHERE s.id = signup_id AND r.user_id = auth.uid()
    )
  );

-- No owner UPDATE policy: status changes are committee-only and happen through
-- the service-role admin route. The Phase-1 table GRANT already omits UPDATE for
-- authenticated, so owner UPDATEs are denied at the privilege level too.
