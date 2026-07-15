-- Expand committee content administration behind actor-explicit service APIs.
-- This introduces masked replacement views; the later contract migration
-- denies legacy base-table access after the application cutover is verified.

BEGIN;

-- A document category can only classify documents in the same public scope.
-- The composite foreign key makes that invariant hold for every writer, while
-- preserving the existing category-delete behaviour.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.documents AS document
      JOIN public.document_categories AS category ON category.id = document.category_id
     WHERE document.scope IS DISTINCT FROM category.scope
  ) THEN
    RAISE EXCEPTION 'Existing document categories cross public scopes.' USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.document_categories
  ADD CONSTRAINT document_categories_id_scope_key UNIQUE (id, scope);
ALTER TABLE public.documents
  DROP CONSTRAINT documents_category_id_fkey;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_category_scope_fkey
  FOREIGN KEY (category_id, scope)
  REFERENCES public.document_categories(id, scope)
  ON UPDATE RESTRICT
  ON DELETE SET NULL (category_id);

-- Dynasty labels have product meaning, not just display meaning. Preserve it
-- for legacy expand-phase writers as well as the new service mutation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.zltac_dynasties AS dynasty
     WHERE NOT (
       pg_catalog.array_ndims(dynasty.years) = 1
       AND pg_catalog.array_lower(dynasty.years, 1) = 1
       AND pg_catalog.array_position(dynasty.years, NULL) IS NULL
       AND (
         (
           dynasty.category = 'three_peat'
           AND pg_catalog.cardinality(dynasty.years) = 3
           AND dynasty.years[2] = dynasty.years[1] + 1
           AND dynasty.years[3] = dynasty.years[2] + 1
         )
         OR (
           dynasty.category = 'back_to_back'
           AND pg_catalog.cardinality(dynasty.years) = 2
           AND dynasty.years[2] = dynasty.years[1] + 1
         )
       )
     )
  ) THEN
    RAISE EXCEPTION 'Existing dynasty years do not match their categories.' USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.zltac_dynasties
  ADD CONSTRAINT zltac_dynasties_category_years_check CHECK (
    pg_catalog.array_ndims(years) = 1
    AND pg_catalog.array_lower(years, 1) = 1
    AND pg_catalog.array_position(years, NULL) IS NULL
    AND (
      (
        category = 'three_peat'
        AND pg_catalog.cardinality(years) = 3
        AND years[2] = years[1] + 1
        AND years[3] = years[2] + 1
      )
      OR (
        category = 'back_to_back'
        AND pg_catalog.cardinality(years) = 2
        AND years[2] = years[1] + 1
      )
    )
  );

CREATE TABLE public.admin_content_mutation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  entity text NOT NULL,
  action text NOT NULL,
  record_id uuid,
  changed_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT admin_content_mutation_audit_entity_check CHECK (
    entity IN (
      'category', 'document', 'event', 'legend', 'dynasty', 'hall-of-fame',
      'question', 'question-bulk', 'settings', 'banner'
    )
  ),
  CONSTRAINT admin_content_mutation_audit_action_check CHECK (
    action IN ('create', 'update', 'delete', 'bulk-create', 'upsert')
  )
);

ALTER TABLE public.admin_content_mutation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_content_mutation_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_content_mutation_audit TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_admin_content_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Admin content audit records are append-only.'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_admin_content_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER admin_content_mutation_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_content_mutation_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_content_audit_mutation();

-- A successful signed-upload smoke must be durable before the final browser
-- Storage policies can be contracted. The API records a row only after the
-- service role reads the uploaded object's real metadata and verifies its
-- exact server-owned path, MIME, size, target, and actor.
CREATE TABLE public.admin_asset_upload_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  purpose text NOT NULL,
  scope_id uuid,
  bucket text NOT NULL,
  object_path text NOT NULL,
  object_size bigint NOT NULL CHECK (object_size > 0 AND object_size <= 26214400),
  content_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT admin_asset_upload_audit_purpose_check CHECK (
    purpose IN (
      'event-logo', 'event-photo', 'event-cover',
      'history-logo', 'history-photo',
      'referee-image', 'referee-video', 'competition-banner'
    )
  ),
  CONSTRAINT admin_asset_upload_audit_bucket_check CHECK (
    (purpose IN ('event-logo', 'history-logo') AND bucket = 'event-logos')
    OR (purpose IN ('event-photo', 'history-photo') AND bucket = 'event-photos')
    OR (purpose = 'event-cover' AND bucket = 'event-covers')
    OR (purpose IN ('referee-image', 'referee-video') AND bucket = 'referee-test-media')
    OR (purpose = 'competition-banner' AND bucket = 'competition-banners')
  ),
  CONSTRAINT admin_asset_upload_audit_path_unique UNIQUE (bucket, object_path)
);

ALTER TABLE public.admin_asset_upload_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_asset_upload_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.admin_asset_upload_audit TO service_role;
REVOKE ALL ON SEQUENCE public.admin_asset_upload_audit_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_asset_upload_audit_id_seq TO service_role;

CREATE TRIGGER admin_asset_upload_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_asset_upload_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_content_audit_mutation();

-- Serialize grading with question administration. A submission that waits for
-- an admin's ACCESS EXCLUSIVE lock takes its deadline timestamp only after both
-- the question-table lock and any attempt-row wait, so it cannot grade against
-- changed answers using a stale pre-expiry timestamp.
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
  v_now timestamptz;
BEGIN
  IF p_attempt_id IS NULL OR p_user_id IS NULL OR p_answers IS NULL
     OR jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Attempt, user, and answer array are required.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7331));

  LOCK TABLE public.referee_questions IN ACCESS SHARE MODE;

  SELECT *
    INTO v_attempt
    FROM public.referee_test_attempts
   WHERE id = p_attempt_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rules Test attempt not found.' USING ERRCODE = 'P0002';
  END IF;

  v_now := pg_catalog.clock_timestamp();
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

REVOKE ALL ON FUNCTION public.submit_referee_test_attempt(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_referee_test_attempt(uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_mutate_content(
  p_actor_id uuid,
  p_entity text,
  p_action text,
  p_record_id uuid,
  p_data jsonb,
  p_placings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_record jsonb;
  v_record_id uuid;
  v_old_year integer;
  v_event_year integer;
  v_count integer := 0;
  v_changed_keys text[] := ARRAY[]::text[];
  v_category public.document_categories%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_question public.referee_questions%ROWTYPE;
  v_question_changed boolean := false;
  v_target_scope text;
  v_target_category_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_entity IS NULL OR p_action IS NULL THEN
    RAISE EXCEPTION 'Actor, entity, and action are required.' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Content data must be an object.' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'delete' AND p_data <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Delete data must be empty.' USING ERRCODE = '22023';
  END IF;
  IF p_placings IS NOT NULL
     AND (p_entity <> 'event' OR p_action NOT IN ('create', 'update')) THEN
    RAISE EXCEPTION 'Placings are only valid while saving an event.' USING ERRCODE = '22023';
  END IF;

  SELECT profile.*
    INTO v_actor
    FROM public.profiles AS profile
   WHERE profile.id = p_actor_id
   FOR UPDATE;
  IF NOT FOUND
     OR coalesce(v_actor.suspended, false)
     OR coalesce(v_actor.is_placeholder, false)
     OR NOT (
       coalesce(v_actor.roles, ARRAY[]::text[])
       && ARRAY['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']::text[]
     ) THEN
    RAISE EXCEPTION 'An active committee account is required.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(key ORDER BY key), ARRAY[]::text[])
    INTO v_changed_keys
    FROM jsonb_object_keys(p_data) AS keys(key);
  IF p_placings IS NOT NULL THEN
    v_changed_keys := array_append(v_changed_keys, 'placings');
  END IF;

  IF p_entity = 'category' THEN
    IF p_data - ARRAY['scope', 'name', 'sort_order']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported category field.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO public.document_categories AS category (scope, name, sort_order)
      VALUES (
        p_data ->> 'scope',
        p_data ->> 'name',
        coalesce((p_data ->> 'sort_order')::integer, 0)
      )
      RETURNING category.id, to_jsonb(category) INTO v_record_id, v_record;
    ELSIF p_action = 'update' THEN
      SELECT category.* INTO v_category
        FROM public.document_categories AS category
       WHERE category.id = p_record_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Content record not found.' USING ERRCODE = 'P0002';
      END IF;
      v_target_scope := CASE WHEN p_data ? 'scope' THEN p_data ->> 'scope' ELSE v_category.scope END;
      IF EXISTS (
        SELECT 1 FROM public.documents AS document
         WHERE document.category_id = p_record_id
           AND document.scope IS DISTINCT FROM v_target_scope
      ) THEN
        RAISE EXCEPTION 'A category cannot move across scopes while it has linked documents.' USING ERRCODE = '23514';
      END IF;
      UPDATE public.document_categories AS category
         SET scope = CASE WHEN p_data ? 'scope' THEN p_data ->> 'scope' ELSE category.scope END,
             name = CASE WHEN p_data ? 'name' THEN p_data ->> 'name' ELSE category.name END,
             sort_order = CASE WHEN p_data ? 'sort_order' THEN (p_data ->> 'sort_order')::integer ELSE category.sort_order END
       WHERE category.id = p_record_id
       RETURNING category.id, to_jsonb(category) INTO v_record_id, v_record;
    ELSIF p_action = 'delete' THEN
      DELETE FROM public.document_categories AS category
       WHERE category.id = p_record_id
       RETURNING category.id, to_jsonb(category) INTO v_record_id, v_record;
    ELSE
      RAISE EXCEPTION 'Invalid category action.' USING ERRCODE = '22023';
    END IF;

  ELSIF p_entity = 'document' THEN
    IF p_data - ARRAY['scope', 'category_id', 'name', 'url', 'description', 'sort_order']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported document field.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'create' THEN
      v_target_scope := p_data ->> 'scope';
      v_target_category_id := nullif(p_data ->> 'category_id', '')::uuid;
      IF v_target_category_id IS NOT NULL THEN
        PERFORM 1 FROM public.document_categories AS category
         WHERE category.id = v_target_category_id
           AND category.scope = v_target_scope
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Document category must belong to the document scope.' USING ERRCODE = '23514';
        END IF;
      END IF;
      INSERT INTO public.documents AS document (
        scope, category_id, name, url, description, sort_order
      ) VALUES (
        p_data ->> 'scope', nullif(p_data ->> 'category_id', '')::uuid,
        p_data ->> 'name', p_data ->> 'url', nullif(p_data ->> 'description', ''),
        coalesce((p_data ->> 'sort_order')::integer, 0)
      )
      RETURNING document.id, to_jsonb(document) INTO v_record_id, v_record;
    ELSIF p_action = 'update' THEN
      SELECT document.* INTO v_document
        FROM public.documents AS document
       WHERE document.id = p_record_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Content record not found.' USING ERRCODE = 'P0002';
      END IF;
      v_target_scope := CASE WHEN p_data ? 'scope' THEN p_data ->> 'scope' ELSE v_document.scope END;
      v_target_category_id := CASE WHEN p_data ? 'category_id'
        THEN nullif(p_data ->> 'category_id', '')::uuid ELSE v_document.category_id END;
      IF v_target_category_id IS NOT NULL THEN
        PERFORM 1 FROM public.document_categories AS category
         WHERE category.id = v_target_category_id
           AND category.scope = v_target_scope
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Document category must belong to the document scope.' USING ERRCODE = '23514';
        END IF;
      END IF;
      UPDATE public.documents AS document
         SET scope = CASE WHEN p_data ? 'scope' THEN p_data ->> 'scope' ELSE document.scope END,
             category_id = CASE WHEN p_data ? 'category_id' THEN nullif(p_data ->> 'category_id', '')::uuid ELSE document.category_id END,
             name = CASE WHEN p_data ? 'name' THEN p_data ->> 'name' ELSE document.name END,
             url = CASE WHEN p_data ? 'url' THEN p_data ->> 'url' ELSE document.url END,
             description = CASE WHEN p_data ? 'description' THEN nullif(p_data ->> 'description', '') ELSE document.description END,
             sort_order = CASE WHEN p_data ? 'sort_order' THEN (p_data ->> 'sort_order')::integer ELSE document.sort_order END
       WHERE document.id = p_record_id
       RETURNING document.id, to_jsonb(document) INTO v_record_id, v_record;
    ELSIF p_action = 'delete' THEN
      DELETE FROM public.documents AS document
       WHERE document.id = p_record_id
       RETURNING document.id, to_jsonb(document) INTO v_record_id, v_record;
    ELSE
      RAISE EXCEPTION 'Invalid document action.' USING ERRCODE = '22023';
    END IF;

  ELSIF p_entity = 'event' THEN
    IF p_data - ARRAY[
      'year', 'name', 'location_venue', 'location_city', 'location_state',
      'location_country', 'start_date', 'end_date', 'description', 'historic_note',
      'team_count', 'is_cancelled', 'is_upcoming', 'mvp_name', 'mvp_alias',
      'logo_url', 'full_results_text', 'photo_urls', 'internal_notes'
    ]::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported event-history field.' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'create' THEN
      INSERT INTO public.zltac_event_history AS history (
        year, name, location_venue, location_city, location_state,
        location_country, start_date, end_date, description, historic_note,
        team_count, is_cancelled, is_upcoming, mvp_name, mvp_alias,
        logo_url, full_results_text, photo_urls, internal_notes
      ) VALUES (
        (p_data ->> 'year')::integer,
        p_data ->> 'name',
        nullif(p_data ->> 'location_venue', ''),
        nullif(p_data ->> 'location_city', ''),
        nullif(p_data ->> 'location_state', ''),
        nullif(p_data ->> 'location_country', ''),
        nullif(p_data ->> 'start_date', '')::date,
        nullif(p_data ->> 'end_date', '')::date,
        nullif(p_data ->> 'description', ''),
        nullif(p_data ->> 'historic_note', ''),
        nullif(p_data ->> 'team_count', '')::integer,
        coalesce((p_data ->> 'is_cancelled')::boolean, false),
        coalesce((p_data ->> 'is_upcoming')::boolean, false),
        nullif(p_data ->> 'mvp_name', ''),
        nullif(p_data ->> 'mvp_alias', ''),
        nullif(p_data ->> 'logo_url', ''),
        nullif(p_data ->> 'full_results_text', ''),
        CASE WHEN p_data ? 'photo_urls' AND p_data -> 'photo_urls' <> 'null'::jsonb
          THEN ARRAY(SELECT jsonb_array_elements_text(p_data -> 'photo_urls'))
          ELSE NULL END,
        nullif(p_data ->> 'internal_notes', '')
      )
      RETURNING history.id, history.year, to_jsonb(history)
        INTO v_record_id, v_event_year, v_record;
      v_old_year := v_event_year;
    ELSIF p_action = 'update' THEN
      SELECT history.year
        INTO v_old_year
        FROM public.zltac_event_history AS history
       WHERE history.id = p_record_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'History record not found.' USING ERRCODE = 'P0002';
      END IF;
      UPDATE public.zltac_event_history AS history
         SET year = CASE WHEN p_data ? 'year' THEN (p_data ->> 'year')::integer ELSE history.year END,
             name = CASE WHEN p_data ? 'name' THEN p_data ->> 'name' ELSE history.name END,
             location_venue = CASE WHEN p_data ? 'location_venue' THEN nullif(p_data ->> 'location_venue', '') ELSE history.location_venue END,
             location_city = CASE WHEN p_data ? 'location_city' THEN nullif(p_data ->> 'location_city', '') ELSE history.location_city END,
             location_state = CASE WHEN p_data ? 'location_state' THEN nullif(p_data ->> 'location_state', '') ELSE history.location_state END,
             location_country = CASE WHEN p_data ? 'location_country' THEN nullif(p_data ->> 'location_country', '') ELSE history.location_country END,
             start_date = CASE WHEN p_data ? 'start_date' THEN nullif(p_data ->> 'start_date', '')::date ELSE history.start_date END,
             end_date = CASE WHEN p_data ? 'end_date' THEN nullif(p_data ->> 'end_date', '')::date ELSE history.end_date END,
             description = CASE WHEN p_data ? 'description' THEN nullif(p_data ->> 'description', '') ELSE history.description END,
             historic_note = CASE WHEN p_data ? 'historic_note' THEN nullif(p_data ->> 'historic_note', '') ELSE history.historic_note END,
             team_count = CASE WHEN p_data ? 'team_count' THEN nullif(p_data ->> 'team_count', '')::integer ELSE history.team_count END,
             is_cancelled = CASE WHEN p_data ? 'is_cancelled' THEN (p_data ->> 'is_cancelled')::boolean ELSE history.is_cancelled END,
             is_upcoming = CASE WHEN p_data ? 'is_upcoming' THEN (p_data ->> 'is_upcoming')::boolean ELSE history.is_upcoming END,
             mvp_name = CASE WHEN p_data ? 'mvp_name' THEN nullif(p_data ->> 'mvp_name', '') ELSE history.mvp_name END,
             mvp_alias = CASE WHEN p_data ? 'mvp_alias' THEN nullif(p_data ->> 'mvp_alias', '') ELSE history.mvp_alias END,
             logo_url = CASE WHEN p_data ? 'logo_url' THEN nullif(p_data ->> 'logo_url', '') ELSE history.logo_url END,
             full_results_text = CASE WHEN p_data ? 'full_results_text' THEN nullif(p_data ->> 'full_results_text', '') ELSE history.full_results_text END,
             photo_urls = CASE WHEN p_data ? 'photo_urls'
               THEN CASE WHEN p_data -> 'photo_urls' = 'null'::jsonb THEN NULL
                 ELSE ARRAY(SELECT jsonb_array_elements_text(p_data -> 'photo_urls')) END
               ELSE history.photo_urls END,
             internal_notes = CASE WHEN p_data ? 'internal_notes' THEN nullif(p_data ->> 'internal_notes', '') ELSE history.internal_notes END
       WHERE history.id = p_record_id
       RETURNING history.id, history.year, to_jsonb(history)
        INTO v_record_id, v_event_year, v_record;
    ELSIF p_action = 'delete' THEN
      SELECT history.year
        INTO v_old_year
        FROM public.zltac_event_history AS history
       WHERE history.id = p_record_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'History record not found.' USING ERRCODE = 'P0002';
      END IF;
      DELETE FROM public.zltac_event_placings WHERE tournament_year = v_old_year;
      DELETE FROM public.zltac_event_history AS history
       WHERE history.id = p_record_id
       RETURNING history.id, history.year, to_jsonb(history)
        INTO v_record_id, v_event_year, v_record;
    ELSE
      RAISE EXCEPTION 'Invalid event-history action.' USING ERRCODE = '22023';
    END IF;

    IF p_action IN ('create', 'update') THEN
      IF v_record ->> 'start_date' IS NOT NULL
         AND v_record ->> 'end_date' IS NOT NULL
         AND (v_record ->> 'end_date')::date < (v_record ->> 'start_date')::date THEN
        RAISE EXCEPTION 'Event end date must be on or after its start date.' USING ERRCODE = '23514';
      END IF;
      IF coalesce((v_record ->> 'is_cancelled')::boolean, false)
         AND coalesce((v_record ->> 'is_upcoming')::boolean, false) THEN
        RAISE EXCEPTION 'An event cannot be both cancelled and upcoming.' USING ERRCODE = '23514';
      END IF;
      IF p_placings IS NOT NULL THEN
        IF jsonb_typeof(p_placings) <> 'array' THEN
          RAISE EXCEPTION 'Placings must be an array.' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1
            FROM jsonb_array_elements(p_placings) AS item(value)
           WHERE jsonb_typeof(item.value) <> 'object'
              OR item.value - ARRAY['division', 'rank', 'name', 'subtitle']::text[] <> '{}'::jsonb
        ) THEN
          RAISE EXCEPTION 'A placing contains unsupported fields.' USING ERRCODE = '22023';
        END IF;
        DELETE FROM public.zltac_event_placings
         WHERE tournament_year = v_event_year
            OR tournament_year = v_old_year;
        INSERT INTO public.zltac_event_placings (
          tournament_year, division, rank, name, subtitle, display_order
        )
        SELECT
          v_event_year,
          item.value ->> 'division',
          (item.value ->> 'rank')::integer,
          item.value ->> 'name',
          nullif(item.value ->> 'subtitle', ''),
          item.ordinality::integer
        FROM jsonb_array_elements(p_placings) WITH ORDINALITY AS item(value, ordinality);
      ELSIF v_old_year IS DISTINCT FROM v_event_year THEN
        UPDATE public.zltac_event_placings
           SET tournament_year = v_event_year
         WHERE tournament_year = v_old_year;
      END IF;
      SELECT count(*) INTO v_count
        FROM public.zltac_event_placings
       WHERE tournament_year = v_event_year;
      v_record := v_record || jsonb_build_object('placing_count', v_count);
    END IF;

  ELSIF p_entity = 'legend' THEN
    IF p_data - ARRAY['alias', 'titles', 'summary', 'display_order', 'is_visible']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported legend field.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO public.zltac_legends AS legend (alias, titles, summary, display_order, is_visible)
      VALUES (
        p_data ->> 'alias', nullif(p_data ->> 'titles', ''), nullif(p_data ->> 'summary', ''),
        coalesce((p_data ->> 'display_order')::integer, 0), coalesce((p_data ->> 'is_visible')::boolean, true)
      ) RETURNING legend.id, to_jsonb(legend) INTO v_record_id, v_record;
    ELSIF p_action = 'update' THEN
      UPDATE public.zltac_legends AS legend
         SET alias = CASE WHEN p_data ? 'alias' THEN p_data ->> 'alias' ELSE legend.alias END,
             titles = CASE WHEN p_data ? 'titles' THEN nullif(p_data ->> 'titles', '') ELSE legend.titles END,
             summary = CASE WHEN p_data ? 'summary' THEN nullif(p_data ->> 'summary', '') ELSE legend.summary END,
             display_order = CASE WHEN p_data ? 'display_order' THEN (p_data ->> 'display_order')::integer ELSE legend.display_order END,
             is_visible = CASE WHEN p_data ? 'is_visible' THEN (p_data ->> 'is_visible')::boolean ELSE legend.is_visible END
       WHERE legend.id = p_record_id
       RETURNING legend.id, to_jsonb(legend) INTO v_record_id, v_record;
    ELSIF p_action = 'delete' THEN
      DELETE FROM public.zltac_legends AS legend WHERE legend.id = p_record_id
      RETURNING legend.id, to_jsonb(legend) INTO v_record_id, v_record;
    ELSE
      RAISE EXCEPTION 'Invalid legend action.' USING ERRCODE = '22023';
    END IF;

  ELSIF p_entity = 'dynasty' THEN
    IF p_data - ARRAY['team_name', 'category', 'years', 'note', 'display_order', 'is_visible']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported dynasty field.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO public.zltac_dynasties AS dynasty (team_name, category, years, note, display_order, is_visible)
      VALUES (
        p_data ->> 'team_name', p_data ->> 'category',
        ARRAY(SELECT jsonb_array_elements_text(p_data -> 'years'))::integer[],
        nullif(p_data ->> 'note', ''), coalesce((p_data ->> 'display_order')::integer, 0),
        coalesce((p_data ->> 'is_visible')::boolean, true)
      ) RETURNING dynasty.id, to_jsonb(dynasty) INTO v_record_id, v_record;
    ELSIF p_action = 'update' THEN
      UPDATE public.zltac_dynasties AS dynasty
         SET team_name = CASE WHEN p_data ? 'team_name' THEN p_data ->> 'team_name' ELSE dynasty.team_name END,
             category = CASE WHEN p_data ? 'category' THEN p_data ->> 'category' ELSE dynasty.category END,
             years = CASE WHEN p_data ? 'years' THEN ARRAY(SELECT jsonb_array_elements_text(p_data -> 'years'))::integer[] ELSE dynasty.years END,
             note = CASE WHEN p_data ? 'note' THEN nullif(p_data ->> 'note', '') ELSE dynasty.note END,
             display_order = CASE WHEN p_data ? 'display_order' THEN (p_data ->> 'display_order')::integer ELSE dynasty.display_order END,
             is_visible = CASE WHEN p_data ? 'is_visible' THEN (p_data ->> 'is_visible')::boolean ELSE dynasty.is_visible END
       WHERE dynasty.id = p_record_id
       RETURNING dynasty.id, to_jsonb(dynasty) INTO v_record_id, v_record;
    ELSIF p_action = 'delete' THEN
      DELETE FROM public.zltac_dynasties AS dynasty WHERE dynasty.id = p_record_id
      RETURNING dynasty.id, to_jsonb(dynasty) INTO v_record_id, v_record;
    ELSE
      RAISE EXCEPTION 'Invalid dynasty action.' USING ERRCODE = '22023';
    END IF;
    IF p_action IN ('create', 'update') AND EXISTS (
      SELECT 1
        FROM public.zltac_dynasties AS dynasty
       WHERE dynasty.id = v_record_id
         AND NOT (
           (
             dynasty.category = 'three_peat'
             AND cardinality(dynasty.years) = 3
             AND dynasty.years[2] = dynasty.years[1] + 1
             AND dynasty.years[3] = dynasty.years[2] + 1
           )
           OR (
             dynasty.category = 'back_to_back'
             AND cardinality(dynasty.years) = 2
             AND dynasty.years[2] = dynasty.years[1] + 1
           )
         )
    ) THEN
      RAISE EXCEPTION 'Dynasty years do not match its category.' USING ERRCODE = '23514';
    END IF;

  ELSIF p_entity = 'hall-of-fame' THEN
    IF p_data - ARRAY['real_name', 'alias', 'induction_year', 'contribution', 'photo_url', 'display_order', 'is_visible']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported hall-of-fame field.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO public.zltac_hall_of_fame AS inductee (
        real_name, alias, induction_year, contribution, photo_url, display_order, is_visible
      ) VALUES (
        p_data ->> 'real_name', nullif(p_data ->> 'alias', ''), (p_data ->> 'induction_year')::integer,
        nullif(p_data ->> 'contribution', ''), nullif(p_data ->> 'photo_url', ''),
        coalesce((p_data ->> 'display_order')::integer, 0), coalesce((p_data ->> 'is_visible')::boolean, true)
      ) RETURNING inductee.id, to_jsonb(inductee) INTO v_record_id, v_record;
    ELSIF p_action = 'update' THEN
      UPDATE public.zltac_hall_of_fame AS inductee
         SET real_name = CASE WHEN p_data ? 'real_name' THEN p_data ->> 'real_name' ELSE inductee.real_name END,
             alias = CASE WHEN p_data ? 'alias' THEN nullif(p_data ->> 'alias', '') ELSE inductee.alias END,
             induction_year = CASE WHEN p_data ? 'induction_year' THEN (p_data ->> 'induction_year')::integer ELSE inductee.induction_year END,
             contribution = CASE WHEN p_data ? 'contribution' THEN nullif(p_data ->> 'contribution', '') ELSE inductee.contribution END,
             photo_url = CASE WHEN p_data ? 'photo_url' THEN nullif(p_data ->> 'photo_url', '') ELSE inductee.photo_url END,
             display_order = CASE WHEN p_data ? 'display_order' THEN (p_data ->> 'display_order')::integer ELSE inductee.display_order END,
             is_visible = CASE WHEN p_data ? 'is_visible' THEN (p_data ->> 'is_visible')::boolean ELSE inductee.is_visible END
       WHERE inductee.id = p_record_id
       RETURNING inductee.id, to_jsonb(inductee) INTO v_record_id, v_record;
    ELSIF p_action = 'delete' THEN
      DELETE FROM public.zltac_hall_of_fame AS inductee WHERE inductee.id = p_record_id
      RETURNING inductee.id, to_jsonb(inductee) INTO v_record_id, v_record;
    ELSE
      RAISE EXCEPTION 'Invalid hall-of-fame action.' USING ERRCODE = '22023';
    END IF;

  ELSIF p_entity = 'question' THEN
    IF p_data - ARRAY[
      'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
      'category', 'difficulty', 'active', 'section', 'image_url', 'video_url'
    ]::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported Rules Test question field.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO public.referee_questions AS question (
        question, option_a, option_b, option_c, option_d, correct_answer,
        category, difficulty, active, section, image_url, video_url
      ) VALUES (
        p_data ->> 'question', p_data ->> 'option_a', p_data ->> 'option_b',
        p_data ->> 'option_c', p_data ->> 'option_d', p_data ->> 'correct_answer',
        coalesce(p_data ->> 'category', 'General'), coalesce(p_data ->> 'difficulty', 'medium'),
        coalesce((p_data ->> 'active')::boolean, true), coalesce(p_data ->> 'section', 'general'),
        nullif(p_data ->> 'image_url', ''), nullif(p_data ->> 'video_url', '')
      ) RETURNING question.id, to_jsonb(question) INTO v_record_id, v_record;
    ELSIF p_action IN ('update', 'delete') THEN
      -- Attempt creation samples referee_questions before inserting its
      -- question_ids. ACCESS EXCLUSIVE makes an admin mutation wait for an
      -- in-flight sampler and prevents a new sampler until this transaction
      -- finishes, closing the sample-before-attempt-insert race.
      LOCK TABLE public.referee_questions IN ACCESS EXCLUSIVE MODE;
      SELECT question.* INTO v_question
        FROM public.referee_questions AS question
       WHERE question.id = p_record_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Content record not found.' USING ERRCODE = 'P0002';
      END IF;

      v_question_changed := p_action = 'delete' OR (
        (p_data ? 'question' AND (p_data ->> 'question') IS DISTINCT FROM v_question.question)
        OR (p_data ? 'option_a' AND (p_data ->> 'option_a') IS DISTINCT FROM v_question.option_a)
        OR (p_data ? 'option_b' AND (p_data ->> 'option_b') IS DISTINCT FROM v_question.option_b)
        OR (p_data ? 'option_c' AND (p_data ->> 'option_c') IS DISTINCT FROM v_question.option_c)
        OR (p_data ? 'option_d' AND (p_data ->> 'option_d') IS DISTINCT FROM v_question.option_d)
        OR (p_data ? 'correct_answer' AND (p_data ->> 'correct_answer') IS DISTINCT FROM v_question.correct_answer)
        OR (p_data ? 'category' AND (p_data ->> 'category') IS DISTINCT FROM v_question.category)
        OR (p_data ? 'difficulty' AND (p_data ->> 'difficulty') IS DISTINCT FROM v_question.difficulty)
        OR (p_data ? 'active' AND (p_data ->> 'active')::boolean IS DISTINCT FROM v_question.active)
        OR (p_data ? 'section' AND (p_data ->> 'section') IS DISTINCT FROM v_question.section)
        OR (p_data ? 'image_url' AND nullif(p_data ->> 'image_url', '') IS DISTINCT FROM v_question.image_url)
        OR (p_data ? 'video_url' AND nullif(p_data ->> 'video_url', '') IS DISTINCT FROM v_question.video_url)
      );
      IF v_question_changed THEN
        -- READ COMMITTED sees every attempt committed before this statement.
        -- The exclusive question lock prevents a new attempt from sampling
        -- this question until the mutation commits, so one check is race-safe
        -- without a conflicting attempts-table lock.
        IF EXISTS (
          SELECT 1
            FROM public.referee_test_attempts AS attempt
           WHERE attempt.status = 'started'
             AND attempt.expires_at > pg_catalog.clock_timestamp()
             AND p_record_id = ANY(attempt.question_ids)
        ) THEN
          RAISE EXCEPTION 'Question is part of an active Rules Test attempt.' USING ERRCODE = '55000';
        END IF;
      END IF;

      IF p_action = 'update' THEN
      UPDATE public.referee_questions AS question
         SET question = CASE WHEN p_data ? 'question' THEN p_data ->> 'question' ELSE question.question END,
             option_a = CASE WHEN p_data ? 'option_a' THEN p_data ->> 'option_a' ELSE question.option_a END,
             option_b = CASE WHEN p_data ? 'option_b' THEN p_data ->> 'option_b' ELSE question.option_b END,
             option_c = CASE WHEN p_data ? 'option_c' THEN p_data ->> 'option_c' ELSE question.option_c END,
             option_d = CASE WHEN p_data ? 'option_d' THEN p_data ->> 'option_d' ELSE question.option_d END,
             correct_answer = CASE WHEN p_data ? 'correct_answer' THEN p_data ->> 'correct_answer' ELSE question.correct_answer END,
             category = CASE WHEN p_data ? 'category' THEN p_data ->> 'category' ELSE question.category END,
             difficulty = CASE WHEN p_data ? 'difficulty' THEN p_data ->> 'difficulty' ELSE question.difficulty END,
             active = CASE WHEN p_data ? 'active' THEN (p_data ->> 'active')::boolean ELSE question.active END,
             section = CASE WHEN p_data ? 'section' THEN p_data ->> 'section' ELSE question.section END,
             image_url = CASE WHEN p_data ? 'image_url' THEN nullif(p_data ->> 'image_url', '') ELSE question.image_url END,
             video_url = CASE WHEN p_data ? 'video_url' THEN nullif(p_data ->> 'video_url', '') ELSE question.video_url END
       WHERE question.id = p_record_id
       RETURNING question.id, to_jsonb(question) INTO v_record_id, v_record;
      ELSE
        DELETE FROM public.referee_questions AS question WHERE question.id = p_record_id
        RETURNING question.id, to_jsonb(question) INTO v_record_id, v_record;
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid Rules Test question action.' USING ERRCODE = '22023';
    END IF;

  ELSIF p_entity = 'question-bulk' THEN
    IF p_action <> 'bulk-create'
       OR p_data - ARRAY['rows']::text[] <> '{}'::jsonb
       OR jsonb_typeof(p_data -> 'rows') <> 'array' THEN
      RAISE EXCEPTION 'Invalid Rules Test bulk import.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.referee_questions (
      question, option_a, option_b, option_c, option_d, correct_answer,
      category, difficulty, active, section, image_url, video_url
    )
    SELECT
      row.value ->> 'question', row.value ->> 'option_a', row.value ->> 'option_b',
      row.value ->> 'option_c', row.value ->> 'option_d', row.value ->> 'correct_answer',
      coalesce(row.value ->> 'category', 'General'), coalesce(row.value ->> 'difficulty', 'medium'),
      coalesce((row.value ->> 'active')::boolean, true), coalesce(row.value ->> 'section', 'general'),
      nullif(row.value ->> 'image_url', ''), nullif(row.value ->> 'video_url', '')
    FROM jsonb_array_elements(p_data -> 'rows') AS row(value);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_record := jsonb_build_object('count', v_count);

  ELSIF p_entity = 'settings' THEN
    IF p_action <> 'upsert'
       OR p_data - ARRAY[
         'safety_questions_per_test', 'safety_pass_score',
         'general_questions_per_test', 'general_pass_score'
       ]::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid Rules Test settings action.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.referee_test_settings AS settings (
      id, safety_questions_per_test, safety_pass_score,
      general_questions_per_test, general_pass_score, updated_at
    ) VALUES (
      1, (p_data ->> 'safety_questions_per_test')::integer,
      (p_data ->> 'safety_pass_score')::integer,
      (p_data ->> 'general_questions_per_test')::integer,
      (p_data ->> 'general_pass_score')::integer, pg_catalog.now()
    )
    ON CONFLICT (id) DO UPDATE SET
      safety_questions_per_test = EXCLUDED.safety_questions_per_test,
      safety_pass_score = EXCLUDED.safety_pass_score,
      general_questions_per_test = EXCLUDED.general_questions_per_test,
      general_pass_score = EXCLUDED.general_pass_score,
      updated_at = pg_catalog.now()
    RETURNING to_jsonb(settings) INTO v_record;

  ELSIF p_entity = 'banner' THEN
    IF p_action <> 'upsert'
       OR p_data - ARRAY['enabled', 'message']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid site banner action.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cms_global AS banner (key, value, last_updated_at)
    VALUES (
      'site_banner',
      jsonb_build_object('enabled', (p_data ->> 'enabled')::boolean, 'message', p_data ->> 'message'),
      pg_catalog.now()
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      last_updated_at = pg_catalog.now()
    RETURNING to_jsonb(banner) INTO v_record;

  ELSE
    RAISE EXCEPTION 'Unknown admin content entity.' USING ERRCODE = '22023';
  END IF;

  IF p_action IN ('update', 'delete') AND v_record IS NULL THEN
    RAISE EXCEPTION 'Content record not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_content_mutation_audit (
    actor_id, entity, action, record_id, changed_keys
  ) VALUES (
    p_actor_id, p_entity, p_action, v_record_id, v_changed_keys
  );

  IF p_action = 'delete' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF p_entity = 'question-bulk' THEN
    RETURN jsonb_build_object('ok', true, 'count', v_count);
  END IF;
  RETURN jsonb_build_object('record', v_record);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mutate_content(uuid, text, text, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_mutate_content(uuid, text, text, uuid, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.admin_mutate_content(uuid, text, text, uuid, jsonb, jsonb) IS
  'Actor-explicit, service-only committee content mutation with atomic event/placing saves and attributed audit records.';

-- Expand phase: add safe read surfaces before any legacy browser grant is
-- removed. The contract migration runs only after the API and new consumers
-- have been deployed and verified.
CREATE OR REPLACE VIEW public.public_zltac_event_history
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  history.id,
  history.year,
  history.name,
  history.location_city,
  history.location_state,
  history.location_venue,
  history.start_date,
  history.end_date,
  history.description,
  history.logo_url,
  history.mvp_name,
  history.mvp_alias,
  history.full_results_text,
  history.photo_urls,
  history.created_at,
  history.updated_at,
  history.is_cancelled,
  history.is_upcoming,
  history.team_count,
  history.location_country,
  history.historic_note
FROM public.zltac_event_history AS history;

CREATE OR REPLACE VIEW public.public_zltac_legends
WITH (security_barrier = true, security_invoker = false) AS
SELECT legend.* FROM public.zltac_legends AS legend WHERE legend.is_visible;

CREATE OR REPLACE VIEW public.public_zltac_dynasties
WITH (security_barrier = true, security_invoker = false) AS
SELECT dynasty.* FROM public.zltac_dynasties AS dynasty WHERE dynasty.is_visible;

CREATE OR REPLACE VIEW public.public_zltac_hall_of_fame
WITH (security_barrier = true, security_invoker = false) AS
SELECT inductee.* FROM public.zltac_hall_of_fame AS inductee WHERE inductee.is_visible;

CREATE OR REPLACE VIEW public.public_referee_test_settings
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  settings.id,
  settings.safety_questions_per_test,
  settings.safety_pass_score,
  settings.general_questions_per_test,
  settings.general_pass_score
FROM public.referee_test_settings AS settings;

REVOKE ALL ON
  public.public_zltac_event_history,
  public.public_zltac_legends,
  public.public_zltac_dynasties,
  public.public_zltac_hall_of_fame,
  public.public_referee_test_settings
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON
  public.public_zltac_event_history,
  public.public_zltac_legends,
  public.public_zltac_dynasties,
  public.public_zltac_hall_of_fame,
  public.public_referee_test_settings
TO anon, authenticated, service_role;

COMMENT ON VIEW public.public_zltac_event_history IS
  'Public historical event data with internal_notes removed.';
COMMENT ON VIEW public.public_zltac_legends IS
  'Visible public ZLTAC legends only.';
COMMENT ON VIEW public.public_zltac_dynasties IS
  'Visible public ZLTAC dynasties only.';
COMMENT ON VIEW public.public_zltac_hall_of_fame IS
  'Visible public ZLTAC Hall of Fame entries only.';
COMMENT ON VIEW public.public_referee_test_settings IS
  'Public-safe referee test sample sizes and pass thresholds.';

COMMIT;
