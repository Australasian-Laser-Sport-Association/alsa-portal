-- =============================================================================
-- Rules Test — per-section settings on referee_test_settings.
--
-- Splits the single pass_score / questions_per_test into explicit Safety and
-- General controls so each section is configured independently. The General_*
-- columns are seeded from the existing legacy values so current config is
-- preserved; Safety defaults to 10 questions @ 100% pass.
--
-- The legacy columns (pass_score, questions_per_test, time_limit_minutes) are
-- KEPT for back-compat but marked deprecated — the app no longer writes
-- pass_score/questions_per_test, and the timer (time_limit_minutes) has been
-- removed entirely.
-- =============================================================================

ALTER TABLE public.referee_test_settings
  ADD COLUMN safety_questions_per_test  integer NOT NULL DEFAULT 10,
  ADD COLUMN safety_pass_score          integer NOT NULL DEFAULT 100,
  ADD COLUMN general_questions_per_test integer NOT NULL DEFAULT 20,
  ADD COLUMN general_pass_score         integer NOT NULL DEFAULT 70;

-- Preserve existing configuration: copy the legacy single-section values into
-- the new General columns.
UPDATE public.referee_test_settings
  SET general_questions_per_test = questions_per_test,
      general_pass_score         = pass_score;

-- Mark legacy columns deprecated (kept for back-compat, no longer read/written).
COMMENT ON COLUMN public.referee_test_settings.pass_score IS
  'DEPRECATED — superseded by general_pass_score. Kept for back-compat; no longer written by the app.';
COMMENT ON COLUMN public.referee_test_settings.questions_per_test IS
  'DEPRECATED — superseded by general_questions_per_test. Kept for back-compat; no longer written by the app.';
COMMENT ON COLUMN public.referee_test_settings.time_limit_minutes IS
  'DEPRECATED — the Rules Test no longer has a timer. Kept for back-compat; no longer read or written.';
