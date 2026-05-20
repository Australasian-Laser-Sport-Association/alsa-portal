-- =============================================================================
-- Rules Test — two-section structure (Safety + General Rules & Regulations).
--
-- The test (formerly "Referee Test" in the UI; table/column names kept) now
-- splits into two sections with different pass rules:
--   - Safety:  pass requires 100% (every safety question correct, no margin).
--   - General: pass uses the configurable referee_test_settings.pass_score.
--   - Overall pass = safety passed AND general passed.
--
-- 1. referee_questions.section — which section a question belongs to.
--    Defaults to 'general' so every existing question stays valid as a
--    General question with no manual backfill.
--
-- 2. referee_test_results section breakdown — nullable so legacy rows are
--    untouched. A legacy row (all section columns NULL) is treated by the UI
--    as a general-only pass: its `passed`/`score` remain authoritative.
-- =============================================================================

ALTER TABLE public.referee_questions
  ADD COLUMN section text NOT NULL DEFAULT 'general'
    CHECK (section IN ('safety', 'general'));

ALTER TABLE public.referee_test_results
  ADD COLUMN safety_correct  integer,
  ADD COLUMN safety_total    integer,
  ADD COLUMN general_correct integer,
  ADD COLUMN general_total   integer,
  ADD COLUMN safety_passed   boolean,
  ADD COLUMN general_passed  boolean;
