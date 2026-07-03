-- Allow players to self-submit and update their own under-18 approval record.
-- Previously only select_own + committee_all existed, so the PlayerHub upsert
-- was denied for players (0 rows ever created). Applied to production 2026-07-03.
-- Restrictive active_user_* suspension policies still apply on top.

CREATE POLICY under_18_approvals_owner_insert ON public.under_18_approvals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY under_18_approvals_owner_update ON public.under_18_approvals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
