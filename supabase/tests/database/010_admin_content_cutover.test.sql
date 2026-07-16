BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

INSERT INTO public.profiles (
  id, first_name, alias, dob, roles, suspended, is_placeholder
)
VALUES
  (
    '65000000-0000-4000-8000-000000000001',
    'Content committee', 'ContentCommittee650', DATE '1980-01-01',
    ARRAY['alsa_committee', 'player']::text[], false, false
  ),
  (
    '65000000-0000-4000-8000-000000000002',
    'Content player', 'ContentPlayer650', DATE '1990-01-01',
    ARRAY['player']::text[], false, false
  );

CREATE FUNCTION public.test_65000_throws_check_violation(p_sql text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION
  WHEN check_violation THEN
    RETURN true;
END;
$$;

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)',
    'EXECUTE'
  ),
  'only the server workflow role can invoke the actor-explicit content mutation'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.submit_referee_test_attempt(uuid,uuid,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.submit_referee_test_attempt(uuid,uuid,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.submit_referee_test_attempt(uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'only the server workflow role can submit a Rules Test attempt'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000002',
      'banner', 'upsert', NULL,
      '{"enabled":true,"message":"unauthorised"}'::jsonb,
      NULL
    )
  $$,
  '42501',
  'An active committee account is required.',
  'an ordinary account cannot use the service mutation contract'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'event', 'create', NULL,
      jsonb_build_object(
        'year', 2250,
        'name', 'Atomic content fixture',
        'location_city', 'Sydney',
        'start_date', '2250-07-01',
        'end_date', '2250-07-03',
        'internal_notes', 'committee-only fixture note'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'division', 'team', 'rank', 1,
          'name', 'Fixture champions', 'subtitle', 'First'
        ),
        jsonb_build_object(
          'division', 'solos', 'rank', 1,
          'name', 'Fixture solo champion', 'subtitle', ''
        )
      )
    )
  $$,
  'committee event history and placings are created in one mutation'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.zltac_event_history
     WHERE year = 2250
       AND name = 'Atomic content fixture'
       AND internal_notes = 'committee-only fixture note'
  )
  AND (
    SELECT count(*)
      FROM public.zltac_event_placings
     WHERE tournament_year = 2250
  ) = 2,
  'the event parent and both placing children commit together'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.admin_content_mutation_audit AS audit
      JOIN public.zltac_event_history AS history
        ON history.id = audit.record_id
     WHERE audit.actor_id = '65000000-0000-4000-8000-000000000001'
       AND audit.entity = 'event'
       AND audit.action = 'create'
       AND history.year = 2250
       AND audit.changed_keys @> ARRAY['internal_notes', 'placings']::text[]
  ),
  'the event mutation records actor, record, action, and changed fields'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.public_zltac_event_history
     WHERE year = 2250
       AND row_to_json(public_zltac_event_history)::text
           NOT LIKE '%committee-only fixture note%'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'public_zltac_event_history'
       AND column_name = 'internal_notes'
  ),
  'the public history surface retains the event but masks internal notes'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'event', 'update',
      (SELECT id FROM public.zltac_event_history WHERE year = 2250),
      '{"start_date":"2250-07-04"}'::jsonb,
      NULL
    )
  $$,
  '23514',
  'Event end date must be on or after its start date.',
  'a partial date update is validated against the final stored event'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.zltac_event_history
     WHERE year = 2250
       AND start_date = DATE '2250-07-01'
       AND end_date = DATE '2250-07-03'
  ),
  'an invalid partial date update leaves both original dates intact'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'event', 'update',
      (SELECT id FROM public.zltac_event_history WHERE year = 2250),
      '{"year":2251,"name":"Atomic content fixture updated"}'::jsonb,
      NULL
    )
  $$,
  'an event year update moves existing placings atomically'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.zltac_event_history
     WHERE year = 2251 AND name = 'Atomic content fixture updated'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.zltac_event_placings WHERE tournament_year = 2250
  )
  AND (
    SELECT count(*) FROM public.zltac_event_placings WHERE tournament_year = 2251
  ) = 2,
  'the successful parent update moves every placing to the new year'
);

CREATE FUNCTION public.test_65000_fail_placing_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name = 'Forced placing failure' THEN
    RAISE EXCEPTION 'forced placing failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_65000_fail_placing_insert
BEFORE INSERT ON public.zltac_event_placings
FOR EACH ROW EXECUTE FUNCTION public.test_65000_fail_placing_insert();

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'event', 'update',
      (SELECT id FROM public.zltac_event_history WHERE year = 2251),
      '{"name":"Must roll back"}'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'division', 'team', 'rank', 1,
          'name', 'Forced placing failure', 'subtitle', ''
        )
      )
    )
  $$,
  'P0001',
  'forced placing failure',
  'a late placing failure aborts the whole event update'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.zltac_event_history
     WHERE year = 2251 AND name = 'Atomic content fixture updated'
  )
  AND (
    SELECT count(*) FROM public.zltac_event_placings WHERE tournament_year = 2251
  ) = 2
  AND NOT EXISTS (
    SELECT 1 FROM public.zltac_event_placings
     WHERE tournament_year = 2251 AND name = 'Forced placing failure'
  ),
  'the failed child replacement restores the earlier parent and placings'
);

DROP TRIGGER test_65000_fail_placing_insert ON public.zltac_event_placings;
DROP FUNCTION public.test_65000_fail_placing_insert();

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'event', 'delete',
      (SELECT id FROM public.zltac_event_history WHERE year = 2251),
      '{}'::jsonb,
      NULL
    )
  $$,
  'event deletion removes the event and its placings atomically'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.zltac_event_history WHERE year = 2251
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.zltac_event_placings WHERE tournament_year = 2251
  )
  AND EXISTS (
    SELECT 1
      FROM public.admin_content_mutation_audit
     WHERE actor_id = '65000000-0000-4000-8000-000000000001'
       AND entity = 'event'
       AND action = 'delete'
  ),
  'the event, children, and attributed deletion audit finish together'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'category', 'create', NULL,
      '{"scope":"alsa","name":"ALSA category 650","sort_order":650}'::jsonb,
      NULL
    )
  $$,
  'an ALSA document category can be created through the server contract'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'category', 'create', NULL,
      '{"scope":"zltac","name":"ZLTAC category 650","sort_order":651}'::jsonb,
      NULL
    )
  $$,
  'a ZLTAC document category can be created through the server contract'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'document', 'create', NULL,
      jsonb_build_object(
        'scope', 'alsa',
        'category_id', (
          SELECT id::text FROM public.document_categories
           WHERE name = 'ZLTAC category 650'
        ),
        'name', 'Cross-scope create 650',
        'url', '/documents/cross-scope-create-650.pdf',
        'sort_order', 650
      ),
      NULL
    )
  $$,
  '23514',
  'Document category must belong to the document scope.',
  'a direct RPC document create cannot link across scopes'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.documents WHERE name = 'Cross-scope create 650'
  ),
  'the rejected cross-scope document create leaves no partial row'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'document', 'create', NULL,
      jsonb_build_object(
        'scope', 'alsa',
        'category_id', (
          SELECT id::text FROM public.document_categories
           WHERE name = 'ALSA category 650'
        ),
        'name', 'Linked ALSA document 650',
        'url', '/documents/linked-alsa-650.pdf',
        'sort_order', 651
      ),
      NULL
    )
  $$,
  'a same-scope category/document link succeeds'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'document', 'update',
      (SELECT id FROM public.documents WHERE name = 'Linked ALSA document 650'),
      '{"scope":"zltac"}'::jsonb,
      NULL
    )
  $$,
  '23514',
  'Document category must belong to the document scope.',
  'a document scope-only patch is validated against its existing category'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'document', 'update',
      (SELECT id FROM public.documents WHERE name = 'Linked ALSA document 650'),
      jsonb_build_object(
        'category_id', (
          SELECT id::text FROM public.document_categories
           WHERE name = 'ZLTAC category 650'
        )
      ),
      NULL
    )
  $$,
  '23514',
  'Document category must belong to the document scope.',
  'a document category-only patch cannot create a cross-scope link'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'category', 'update',
      (SELECT id FROM public.document_categories WHERE name = 'ALSA category 650'),
      '{"scope":"zltac"}'::jsonb,
      NULL
    )
  $$,
  '23514',
  'A category cannot move across scopes while it has linked documents.',
  'a category scope patch cannot strand its linked documents'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.documents AS document
      JOIN public.document_categories AS category
        ON category.id = document.category_id
     WHERE document.name = 'Linked ALSA document 650'
       AND document.scope = 'alsa'
       AND category.scope = 'alsa'
       AND category.name = 'ALSA category 650'
  ),
  'all rejected cross-scope patches retain the original valid link'
);

SELECT ok(
  public.test_65000_throws_check_violation($sql$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'dynasty', 'create', NULL,
      jsonb_build_object(
        'team_name', 'Invalid three peat 650',
        'category', 'three_peat',
        'years', jsonb_build_array(2240, 2241, 2243),
        'display_order', 650,
        'is_visible', true
      ),
      NULL
    )
  $sql$),
  'a three-peat must contain exactly three consecutive years'
);

SELECT ok(
  public.test_65000_throws_check_violation($sql$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'dynasty', 'create', NULL,
      jsonb_build_object(
        'team_name', 'Invalid back to back 650',
        'category', 'back_to_back',
        'years', jsonb_build_array(2240, 2241, 2242),
        'display_order', 651,
        'is_visible', true
      ),
      NULL
    )
  $sql$),
  'a back-to-back must contain exactly two consecutive years'
);

SELECT ok(
  public.test_65000_throws_check_violation($sql$
    INSERT INTO public.zltac_dynasties (
      team_name, category, years, display_order, is_visible
    ) VALUES (
      'Direct invalid dynasty 650',
      'back_to_back',
      ARRAY[2240, 2242]::integer[],
      654,
      true
    )
  $sql$),
  'the durable dynasty CHECK rejects an invalid direct base-table insert'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'dynasty', 'create', NULL,
      jsonb_build_object(
        'team_name', 'Valid back to back 650',
        'category', 'back_to_back',
        'years', jsonb_build_array(2240, 2241),
        'display_order', 652,
        'is_visible', true
      ),
      NULL
    )
  $$,
  'a canonical back-to-back dynasty succeeds'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'dynasty', 'create', NULL,
      jsonb_build_object(
        'team_name', 'Valid three peat 650',
        'category', 'three_peat',
        'years', jsonb_build_array(2240, 2241, 2242),
        'display_order', 653,
        'is_visible', true
      ),
      NULL
    )
  $$,
  'a canonical three-peat dynasty succeeds'
);

SELECT ok(
  public.test_65000_throws_check_violation($sql$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'dynasty', 'update',
      (SELECT id FROM public.zltac_dynasties WHERE team_name = 'Valid back to back 650'),
      '{"years":[2240,2242]}'::jsonb,
      NULL
    )
  $sql$),
  'a dynasty years-only patch cannot make the sequence nonconsecutive'
);

SELECT ok(
  public.test_65000_throws_check_violation($sql$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'dynasty', 'update',
      (SELECT id FROM public.zltac_dynasties WHERE team_name = 'Valid back to back 650'),
      '{"category":"three_peat"}'::jsonb,
      NULL
    )
  $sql$),
  'a dynasty category-only patch is validated against the existing years'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.zltac_dynasties
     WHERE team_name = 'Valid back to back 650'
       AND category = 'back_to_back'
       AND years = ARRAY[2240, 2241]::integer[]
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public.zltac_dynasties
     WHERE team_name IN (
       'Invalid three peat 650',
       'Invalid back to back 650',
       'Direct invalid dynasty 650'
     )
  ),
  'rejected dynasty mutations leave only canonical stored rows'
);

INSERT INTO public.zltac_legends (alias, is_visible, display_order)
VALUES
  ('Visible legend 650', true, 650),
  ('Hidden legend 650', false, 651);

INSERT INTO public.zltac_dynasties (
  team_name, category, years, is_visible, display_order
)
VALUES
  ('Visible dynasty 650', 'back_to_back', ARRAY[2248, 2249], true, 650),
  ('Hidden dynasty 650', 'three_peat', ARRAY[2248, 2249, 2250], false, 651);

INSERT INTO public.zltac_hall_of_fame (
  real_name, induction_year, is_visible, display_order
)
VALUES
  ('Visible inductee 650', 2250, true, 650),
  ('Hidden inductee 650', 2250, false, 651);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.public_zltac_legends
     WHERE alias = 'Visible legend 650'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.public_zltac_legends
     WHERE alias = 'Hidden legend 650'
  )
  AND EXISTS (
    SELECT 1 FROM public.public_zltac_dynasties
     WHERE team_name = 'Visible dynasty 650'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.public_zltac_dynasties
     WHERE team_name = 'Hidden dynasty 650'
  )
  AND EXISTS (
    SELECT 1 FROM public.public_zltac_hall_of_fame
     WHERE real_name = 'Visible inductee 650'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.public_zltac_hall_of_fame
     WHERE real_name = 'Hidden inductee 650'
  ),
  'public editorial views retain visible records and hide every draft fixture'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'settings', 'upsert',
      '65000000-0000-4000-8000-000000000901',
      jsonb_build_object(
        'safety_questions_per_test', 12,
        'safety_pass_score', 90,
        'general_questions_per_test', 24,
        'general_pass_score', 75
      ),
      NULL
    )
  $$,
  'committee Rules Test settings upsert succeeds through the server contract'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.public_referee_test_settings
     WHERE id = 1
       AND safety_questions_per_test = 12
       AND safety_pass_score = 90
       AND general_questions_per_test = 24
       AND general_pass_score = 75
  )
  AND has_table_privilege(
    'anon', 'public.public_referee_test_settings', 'SELECT'
  )
  AND has_table_privilege(
    'authenticated', 'public.public_referee_test_settings', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.referee_test_settings', 'SELECT'
  ),
  'public-safe Rules Test settings remain readable without base-table access'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'question-bulk', 'bulk-create',
      '65000000-0000-4000-8000-000000000902',
      jsonb_build_object(
        'rows', jsonb_build_array(
          jsonb_build_object(
            'question', 'Bulk audit fixture question?',
            'option_a', 'A', 'option_b', 'B',
            'option_c', 'C', 'option_d', 'D',
            'correct_answer', 'a',
            'category', 'Audit fixture',
            'difficulty', 'medium',
            'active', true,
            'section', 'general',
            'image_url', '',
            'video_url', ''
          )
        )
      ),
      NULL
    )
  $$,
  'bulk question creation succeeds through the server contract'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.referee_questions
     WHERE question = 'Bulk audit fixture question?'
  )
  AND EXISTS (
    SELECT 1
      FROM public.admin_content_mutation_audit
     WHERE actor_id = '65000000-0000-4000-8000-000000000001'
       AND entity = 'settings'
       AND action = 'upsert'
       AND record_id IS NULL
  )
  AND EXISTS (
    SELECT 1
      FROM public.admin_content_mutation_audit
     WHERE actor_id = '65000000-0000-4000-8000-000000000001'
       AND entity = 'question-bulk'
       AND action = 'bulk-create'
       AND record_id IS NULL
  ),
  'singleton and bulk audits ignore caller-supplied record ids'
);

INSERT INTO public.referee_test_attempts (
  id, user_id, status, question_ids,
  safety_total, general_total,
  safety_pass_score, general_pass_score,
  expires_at
)
VALUES (
  '65000000-0000-4000-8000-000000000903',
  '65000000-0000-4000-8000-000000000002',
  'started',
  ARRAY[(
    SELECT id FROM public.referee_questions
     WHERE question = 'Bulk audit fixture question?'
  )]::uuid[],
  0, 1, 90, 75,
  pg_catalog.clock_timestamp() + interval '1 hour'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'question', 'update',
      (SELECT id FROM public.referee_questions
        WHERE question = 'Bulk audit fixture question?'),
      '{"correct_answer":"b"}'::jsonb,
      NULL
    )
  $$,
  '55000',
  'Question is part of an active Rules Test attempt.',
  'an active attempt freezes the answer key it was issued'
);

SELECT throws_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'question', 'delete',
      (SELECT id FROM public.referee_questions
        WHERE question = 'Bulk audit fixture question?'),
      '{}'::jsonb,
      NULL
    )
  $$,
  '55000',
  'Question is part of an active Rules Test attempt.',
  'an active attempt prevents deletion of an issued question'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM public.referee_questions
     WHERE question = 'Bulk audit fixture question?'
  )
  AND EXISTS (
    SELECT 1
      FROM public.referee_test_attempts
     WHERE id = '65000000-0000-4000-8000-000000000903'
       AND status = 'started'
  ),
  'rejected active-attempt question mutations preserve both records'
);

UPDATE public.referee_test_attempts
   SET started_at = pg_catalog.clock_timestamp() - interval '2 hours',
       expires_at = pg_catalog.clock_timestamp() - interval '1 hour'
 WHERE id = '65000000-0000-4000-8000-000000000903';

SELECT is(
  (
    public.submit_referee_test_attempt(
      '65000000-0000-4000-8000-000000000903',
      '65000000-0000-4000-8000-000000000002',
      '[]'::jsonb
    )->>'expired'
  ),
  'true',
  'submission rechecks the deadline after locking and returns an expired outcome'
);

SELECT is(
  (
    SELECT status
      FROM public.referee_test_attempts
     WHERE id = '65000000-0000-4000-8000-000000000903'
  ),
  'expired',
  'an expired submission durably closes the attempt before returning'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'question', 'update',
      (SELECT id FROM public.referee_questions
        WHERE question = 'Bulk audit fixture question?'),
      '{"correct_answer":"b"}'::jsonb,
      NULL
    )
  $$,
  'an expired attempt no longer blocks an answer-key update'
);

SELECT is(
  (
    SELECT correct_answer
      FROM public.referee_questions
     WHERE question = 'Bulk audit fixture question?'
  ),
  'b',
  'the answer-key update commits after the attempt expires'
);

SELECT lives_ok(
  $$
    SELECT public.admin_mutate_content(
      '65000000-0000-4000-8000-000000000001',
      'question', 'delete',
      (SELECT id FROM public.referee_questions
        WHERE question = 'Bulk audit fixture question?'),
      '{}'::jsonb,
      NULL
    )
  $$,
  'an expired attempt no longer blocks question deletion'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM public.referee_questions
     WHERE question = 'Bulk audit fixture question?'
  )
  AND EXISTS (
    SELECT 1
      FROM public.referee_test_attempts
     WHERE id = '65000000-0000-4000-8000-000000000903'
       AND expires_at < pg_catalog.clock_timestamp()
  ),
  'post-expiry deletion removes the question without erasing attempt evidence'
);

SELECT throws_ok(
  $$
    UPDATE public.admin_content_mutation_audit
       SET changed_keys = ARRAY['tampered']::text[]
     WHERE actor_id = '65000000-0000-4000-8000-000000000001'
       AND entity = 'settings'
  $$,
  '55000',
  'Admin content audit records are append-only.',
  'an attributed audit record cannot be updated'
);

SELECT ok(
  has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'REFERENCES'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_content_mutation_audit', 'TRIGGER'
  ),
  'the service role can read but cannot directly mutate or truncate content audit evidence'
);

SELECT ok(
  has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'SELECT'
  )
  AND has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'REFERENCES'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.admin_asset_upload_audit', 'TRIGGER'
  )
  AND NOT has_table_privilege(
    'anon', 'public.admin_asset_upload_audit', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.admin_asset_upload_audit', 'SELECT'
  ),
  'only the service workflow can append and read signed-upload audit evidence'
);

INSERT INTO public.admin_asset_upload_audit (
  actor_id,
  purpose,
  scope_id,
  bucket,
  object_path,
  object_size,
  content_type
)
VALUES (
  '65000000-0000-4000-8000-000000000001',
  'event-logo',
  '65000000-0000-4000-8000-000000000101',
  'event-logos',
  'events/65000000-0000-4000-8000-000000000101/logos/65000000-0000-4000-8000-000000000102.png',
  1024,
  'image/png'
);

SELECT throws_ok(
  $$
    UPDATE public.admin_asset_upload_audit
       SET object_size = 2048
     WHERE purpose = 'event-logo'
       AND scope_id = '65000000-0000-4000-8000-000000000101'
  $$,
  '55000',
  'Admin content audit records are append-only.',
  'finalized signed-upload evidence cannot be updated'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        'document_categories',
        'documents',
        'cms_global',
        'referee_questions',
        'referee_test_settings',
        'zltac_event_history',
        'zltac_event_placings',
        'zltac_legends',
        'zltac_dynasties',
        'zltac_hall_of_fame'
      ]::text[]) AS content_table(name)
     WHERE has_table_privilege(
       'anon', format('public.%I', content_table.name), 'INSERT'
     )
        OR has_table_privilege(
       'anon', format('public.%I', content_table.name), 'UPDATE'
     )
        OR has_table_privilege(
       'anon', format('public.%I', content_table.name), 'DELETE'
     )
        OR has_table_privilege(
       'authenticated', format('public.%I', content_table.name), 'INSERT'
     )
        OR has_table_privilege(
       'authenticated', format('public.%I', content_table.name), 'UPDATE'
     )
        OR has_table_privilege(
       'authenticated', format('public.%I', content_table.name), 'DELETE'
     )
  ),
  'no browser role can mutate any cut-over content table directly'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        'referee_questions',
        'referee_test_settings',
        'zltac_event_history',
        'zltac_legends',
        'zltac_dynasties',
        'zltac_hall_of_fame'
      ]::text[]) AS sensitive_table(name)
     WHERE has_table_privilege(
       'anon', format('public.%I', sensitive_table.name), 'SELECT'
     )
        OR has_table_privilege(
       'authenticated', format('public.%I', sensitive_table.name), 'SELECT'
     )
  ),
  'browser roles cannot bypass safe views through sensitive base tables'
);

DROP FUNCTION public.test_65000_throws_check_violation(text);

SELECT * FROM finish();
ROLLBACK;
