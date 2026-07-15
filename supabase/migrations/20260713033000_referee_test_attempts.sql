-- Server-issued, expiring, one-use referee-test attempts.

ALTER TABLE public.referee_test_settings
  ADD COLUMN attempt_ttl_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN retry_cooldown_minutes integer NOT NULL DEFAULT 15,
  ADD CONSTRAINT referee_test_settings_attempt_ttl_valid
    CHECK (attempt_ttl_minutes BETWEEN 5 AND 180),
  ADD CONSTRAINT referee_test_settings_retry_cooldown_valid
    CHECK (retry_cooldown_minutes BETWEEN 0 AND 1440);

CREATE TABLE public.referee_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'submitted', 'expired')),
  question_ids uuid[] NOT NULL CHECK (cardinality(question_ids) > 0),
  safety_total integer NOT NULL CHECK (safety_total >= 0),
  general_total integer NOT NULL CHECK (general_total >= 0),
  safety_pass_score integer NOT NULL CHECK (safety_pass_score BETWEEN 0 AND 100),
  general_pass_score integer NOT NULL CHECK (general_pass_score BETWEEN 0 AND 100),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  selected_answers jsonb,
  answer_summary jsonb,
  safety_correct integer,
  general_correct integer,
  score integer,
  passed boolean,
  CONSTRAINT referee_test_attempts_expiry_valid CHECK (expires_at > started_at),
  CONSTRAINT referee_test_attempts_result_coherent CHECK (
    (
      status = 'started'
      AND submitted_at IS NULL
      AND selected_answers IS NULL
      AND answer_summary IS NULL
      AND safety_correct IS NULL
      AND general_correct IS NULL
      AND score IS NULL
      AND passed IS NULL
    )
    OR (
      status = 'expired'
      AND submitted_at IS NULL
      AND selected_answers IS NULL
      AND answer_summary IS NULL
      AND safety_correct IS NULL
      AND general_correct IS NULL
      AND score IS NULL
      AND passed IS NULL
    )
    OR (
      status = 'submitted'
      AND submitted_at IS NOT NULL
      AND selected_answers IS NOT NULL
      AND answer_summary IS NOT NULL
      AND safety_correct IS NOT NULL
      AND general_correct IS NOT NULL
      AND score BETWEEN 0 AND 100
      AND passed IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX referee_test_attempts_one_open_per_user
  ON public.referee_test_attempts(user_id)
  WHERE status = 'started';

CREATE INDEX referee_test_attempts_user_started_idx
  ON public.referee_test_attempts(user_id, started_at DESC);

ALTER TABLE public.referee_test_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.referee_test_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.referee_test_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.start_referee_test_attempt(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_settings public.referee_test_settings%ROWTYPE;
  v_existing public.referee_test_attempts%ROWTYPE;
  v_attempt public.referee_test_attempts%ROWTYPE;
  v_safety_ids uuid[];
  v_general_ids uuid[];
  v_question_ids uuid[];
  v_last_failed_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_suspended boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User is required.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7331));

  SELECT suspended
    INTO v_suspended
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_suspended THEN
    RAISE EXCEPTION 'Suspended accounts cannot take the Rules Test.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.referee_test_results
    WHERE user_id = p_user_id AND passed = true
  ) THEN
    RAISE EXCEPTION 'The Rules Test has already been passed.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.referee_test_attempts
     SET status = 'expired'
   WHERE user_id = p_user_id
     AND status = 'started'
     AND expires_at <= v_now;

  SELECT *
    INTO v_existing
    FROM public.referee_test_attempts
   WHERE user_id = p_user_id
     AND status = 'started'
   FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'attempt_id', v_existing.id,
      'question_ids', to_jsonb(v_existing.question_ids),
      'expires_at', v_existing.expires_at,
      'safety_total', v_existing.safety_total,
      'general_total', v_existing.general_total,
      'safety_pass_score', v_existing.safety_pass_score,
      'general_pass_score', v_existing.general_pass_score,
      'resumed', true
    );
  END IF;

  SELECT *
    INTO v_settings
    FROM public.referee_test_settings
   WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rules Test settings are missing.' USING ERRCODE = '55000';
  END IF;

  SELECT submitted_at
    INTO v_last_failed_at
    FROM public.referee_test_attempts
   WHERE user_id = p_user_id
     AND status = 'submitted'
     AND passed = false
   ORDER BY submitted_at DESC
   LIMIT 1;

  IF v_last_failed_at IS NOT NULL
     AND v_last_failed_at + make_interval(mins => v_settings.retry_cooldown_minutes) > v_now THEN
    RAISE EXCEPTION 'A new Rules Test attempt is temporarily unavailable.'
      USING ERRCODE = '55P03',
            DETAIL = (v_last_failed_at + make_interval(mins => v_settings.retry_cooldown_minutes))::text;
  END IF;

  SELECT coalesce(array_agg(sample.id ORDER BY sample.random_order), ARRAY[]::uuid[])
    INTO v_safety_ids
    FROM (
      SELECT id, random() AS random_order
      FROM public.referee_questions
      WHERE active = true AND section = 'safety'
      ORDER BY random_order
      LIMIT v_settings.safety_questions_per_test
    ) AS sample;

  SELECT coalesce(array_agg(sample.id ORDER BY sample.random_order), ARRAY[]::uuid[])
    INTO v_general_ids
    FROM (
      SELECT id, random() AS random_order
      FROM public.referee_questions
      WHERE active = true AND section <> 'safety'
      ORDER BY random_order
      LIMIT v_settings.general_questions_per_test
    ) AS sample;

  v_question_ids := v_safety_ids || v_general_ids;
  IF cardinality(v_question_ids) = 0 THEN
    RAISE EXCEPTION 'No active Rules Test questions are available.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.referee_test_attempts (
    user_id,
    question_ids,
    safety_total,
    general_total,
    safety_pass_score,
    general_pass_score,
    started_at,
    expires_at
  ) VALUES (
    p_user_id,
    v_question_ids,
    cardinality(v_safety_ids),
    cardinality(v_general_ids),
    v_settings.safety_pass_score,
    v_settings.general_pass_score,
    v_now,
    v_now + make_interval(mins => v_settings.attempt_ttl_minutes)
  )
  RETURNING * INTO v_attempt;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'question_ids', to_jsonb(v_attempt.question_ids),
    'expires_at', v_attempt.expires_at,
    'safety_total', v_attempt.safety_total,
    'general_total', v_attempt.general_total,
    'safety_pass_score', v_attempt.safety_pass_score,
    'general_pass_score', v_attempt.general_pass_score,
    'resumed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_referee_test_attempt(
  p_attempt_id uuid,
  p_user_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.referee_test_attempts%ROWTYPE;
  v_answer_ids uuid[];
  v_answer_count integer;
  v_distinct_answer_count integer;
  v_scored_count integer;
  v_letters_valid boolean;
  v_safety_correct integer;
  v_general_correct integer;
  v_safety_pct integer;
  v_general_pct integer;
  v_score integer;
  v_passed boolean;
  v_breakdown jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_attempt_id IS NULL OR p_user_id IS NULL OR p_answers IS NULL
     OR jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Attempt, user, and answer array are required.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7331));

  SELECT *
    INTO v_attempt
    FROM public.referee_test_attempts
   WHERE id = p_attempt_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rules Test attempt not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.status <> 'started' THEN
    RAISE EXCEPTION 'This Rules Test attempt has already been closed.'
      USING ERRCODE = '55000';
  END IF;
  IF v_attempt.expires_at <= v_now THEN
    UPDATE public.referee_test_attempts SET status = 'expired' WHERE id = v_attempt.id;
    -- Raising here would roll the status update back with the surrounding RPC
    -- transaction. Return a closed outcome so expiry is durably recorded before
    -- the API maps it to HTTP 410.
    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'expired', true,
      'expires_at', v_attempt.expires_at
    );
  END IF;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT (answer->>'question_id')::uuid),
      coalesce(bool_and(answer->>'letter' IN ('a', 'b', 'c', 'd')), false),
      coalesce(array_agg((answer->>'question_id')::uuid), ARRAY[]::uuid[])
      INTO v_answer_count, v_distinct_answer_count, v_letters_valid, v_answer_ids
      FROM jsonb_array_elements(p_answers) AS submitted(answer);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Every answer needs a valid question ID.' USING ERRCODE = '22023';
  END;

  IF v_answer_count <> cardinality(v_attempt.question_ids)
     OR v_distinct_answer_count <> v_answer_count
     OR NOT v_letters_valid
     OR EXISTS (
       SELECT 1
       FROM unnest(v_attempt.question_ids) AS expected(question_id)
       WHERE NOT expected.question_id = ANY(v_answer_ids)
     ) THEN
    RAISE EXCEPTION 'Answers must match every question in the issued attempt exactly once.'
      USING ERRCODE = '22023';
  END IF;

  WITH submitted AS (
    SELECT
      (answer->>'question_id')::uuid AS question_id,
      answer->>'letter' AS selected_letter
    FROM jsonb_array_elements(p_answers) AS values(answer)
  ), scored AS (
    SELECT
      q.id,
      q.section,
      submitted.selected_letter,
      submitted.selected_letter = q.correct_answer AS is_correct,
      array_position(v_attempt.question_ids, q.id) AS issued_order
    FROM submitted
    JOIN public.referee_questions AS q ON q.id = submitted.question_id
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE section = 'safety' AND is_correct),
    count(*) FILTER (WHERE section <> 'safety' AND is_correct),
    jsonb_agg(
      jsonb_build_object(
        'question_id', id,
        'section', section,
        'selected_letter', selected_letter,
        'is_correct', is_correct
      ) ORDER BY issued_order
    )
    INTO v_scored_count, v_safety_correct, v_general_correct, v_breakdown
    FROM scored;

  IF v_scored_count <> cardinality(v_attempt.question_ids) THEN
    RAISE EXCEPTION 'One or more issued Rules Test questions no longer exist.'
      USING ERRCODE = '55000';
  END IF;

  v_safety_correct := coalesce(v_safety_correct, 0);
  v_general_correct := coalesce(v_general_correct, 0);
  v_safety_pct := CASE WHEN v_attempt.safety_total = 0 THEN 100
    ELSE round(v_safety_correct * 100.0 / v_attempt.safety_total)::integer END;
  v_general_pct := CASE WHEN v_attempt.general_total = 0 THEN 100
    ELSE round(v_general_correct * 100.0 / v_attempt.general_total)::integer END;
  v_score := round(
    (v_safety_correct + v_general_correct) * 100.0
      / (v_attempt.safety_total + v_attempt.general_total)
  )::integer;
  v_passed := v_safety_pct >= v_attempt.safety_pass_score
    AND v_general_pct >= v_attempt.general_pass_score;

  UPDATE public.referee_test_attempts
     SET status = 'submitted',
         submitted_at = v_now,
         selected_answers = p_answers,
         answer_summary = v_breakdown,
         safety_correct = v_safety_correct,
         general_correct = v_general_correct,
         score = v_score,
         passed = v_passed
   WHERE id = v_attempt.id;

  INSERT INTO public.referee_test_results (
    user_id,
    score,
    passed,
    taken_at,
    safety_correct,
    safety_total,
    general_correct,
    general_total,
    safety_passed,
    general_passed
  ) VALUES (
    p_user_id,
    v_score,
    v_passed,
    v_now,
    v_safety_correct,
    v_attempt.safety_total,
    v_general_correct,
    v_attempt.general_total,
    v_safety_pct >= v_attempt.safety_pass_score,
    v_general_pct >= v_attempt.general_pass_score
  )
  ON CONFLICT (user_id) DO UPDATE
    SET score = EXCLUDED.score,
        passed = EXCLUDED.passed,
        taken_at = EXCLUDED.taken_at,
        safety_correct = EXCLUDED.safety_correct,
        safety_total = EXCLUDED.safety_total,
        general_correct = EXCLUDED.general_correct,
        general_total = EXCLUDED.general_total,
        safety_passed = EXCLUDED.safety_passed,
        general_passed = EXCLUDED.general_passed;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'score', v_score,
    'passed', v_passed,
    'taken_at', v_now,
    'safety_correct', v_safety_correct,
    'safety_total', v_attempt.safety_total,
    'general_correct', v_general_correct,
    'general_total', v_attempt.general_total,
    'safety_passed', v_safety_pct >= v_attempt.safety_pass_score,
    'general_passed', v_general_pct >= v_attempt.general_pass_score
  );
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.start_referee_test_attempt(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.submit_referee_test_attempt(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_referee_test_attempt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_referee_test_attempt(uuid, uuid, jsonb) TO service_role;

COMMENT ON TABLE public.referee_test_attempts IS
  'Server-issued one-use Rules Test attempts. Answer keys are never returned to player clients.';
