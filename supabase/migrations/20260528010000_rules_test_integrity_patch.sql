-- =============================================================================
-- Rules Test integrity hardening:
--
--   1. referee_test_results: drop the FOR ALL self-policy that admitted
--      authenticated browser INSERTs; replace with self-read-only. Revoke
--      INSERT / UPDATE / DELETE so the ONLY write path is api/referee-test.js
--      via service-role.
--
--   2. referee_questions: drop the active-only read policy that let any
--      authenticated user select correct_answer alongside the question.
--      Committee SELECT is already covered by the existing FOR ALL
--      referee_questions_committee_write policy. Players now reach the
--      pool through a column-masked view (below) that omits correct_answer.
--
--   3. View public.referee_questions_public — definer-mode (security
--      invoker off), filtered to active rows. Mirrors the
--      public_event_roster / public_competition_roster pattern: the view
--      itself is the public surface; adding columns later requires a
--      migration. Both anon and authenticated get SELECT on the view so
--      the unauthenticated CMS preview keeps working too.
--
-- Per-method policy hygiene falls out of #1: the
-- FOR ALL is replaced with FOR SELECT, so a future UPDATE grant cannot
-- silently inherit write access.
-- =============================================================================


-- 1. Lock referee_test_results writes -----------------------------------------

DROP POLICY IF EXISTS referee_test_results_own ON public.referee_test_results;

CREATE POLICY referee_test_results_self_read ON public.referee_test_results
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- The existing referee_test_results_committee_read policy stays as-is.

REVOKE INSERT, UPDATE, DELETE ON public.referee_test_results FROM authenticated;
-- SELECT grant from role_grants_baseline stays so the self-read policy can
-- actually return rows. service_role keeps bypass for the API endpoint.


-- 2. Hide correct_answer from non-committee readers ---------------------------

DROP POLICY IF EXISTS referee_questions_read ON public.referee_questions;

-- Committee SELECT on the base table is covered by the existing
-- referee_questions_committee_write policy (FOR ALL TO authenticated USING
-- is_committee()), so the admin question manager keeps working unchanged.
-- Players now have zero policy admitting them on the base table; they
-- reach questions through referee_questions_public below.


-- 3. Column-masked view for player-facing reads -------------------------------

CREATE OR REPLACE VIEW public.referee_questions_public
WITH (security_invoker = false) AS
SELECT
  id,
  section,
  question,
  option_a,
  option_b,
  option_c,
  option_d,
  category,
  difficulty,
  image_url,
  video_url,
  created_at
FROM public.referee_questions
WHERE active = true;

GRANT SELECT ON public.referee_questions_public TO anon, authenticated;
